import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { CaptureServer, toJsonl, type CaptureRecord } from "../src/net/capture.ts";
import { fromHex, toHex } from "../src/protocol/frame.ts";
import { CipherState } from "../src/protocol/cipher.ts";
import {
  HANDSHAKE_BODY_BYTES,
  HANDSHAKE_TOTAL_BYTES,
  encodeHandshake,
  encodeSessionPacket,
} from "../src/protocol/session.ts";

function connectTo(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1" }, () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitFor(records: CaptureRecord[], predicate: (r: CaptureRecord) => boolean, timeoutMs = 2000) {
  return new Promise<CaptureRecord>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = records.find(predicate);
      if (hit) return resolve(hit);
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out waiting for record"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** build a wire packet: u16 header + u16 bodyLength + body */
function wire(header: number, bodyHex: string): Uint8Array {
  const body = fromHex(bodyHex);
  const out = new Uint8Array(body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint16(0, header, true);
  view.setUint16(2, body.length, true);
  out.set(body, 4);
  return out;
}

test("capture (framed): decodes the 4-byte header and reports the body length", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "framed", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    socket.write(wire(0x00d3, "aabbcc"));
    const record = await waitFor(records, (r) => r.kind === "frame");
    assert.equal(record.dir, "c2s");
    assert.equal(record.len, 7); // 4 header + 3 body
    assert.equal(record.header, 0x00d3);
    assert.equal(record.bodyLength, 3);
    assert.equal(record.hex, "d3000300aabbcc");
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (framed): reassembles a frame split across two writes", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "framed", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const packet = wire(0x0102, "0102030405");
    socket.write(packet.subarray(0, 3));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(records.filter((r) => r.kind === "frame").length, 0, "must not emit a partial frame");
    socket.write(packet.subarray(3));
    const record = await waitFor(records, (r) => r.kind === "frame");
    assert.equal(record.header, 0x0102);
    assert.equal(record.hex, toHex(packet));
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture: falls back to a raw dump when the framing assumption fails", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "framed", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    // declared body length 0xFFFF is far past the client's 1460 receive buffer
    const junk = "0000ffff0102030405";
    socket.write(fromHex(junk));
    const error = await waitFor(records, (r) => r.kind === "framing-error");
    assert.ok(error.len >= 4, "the failing chunk must be recorded, not dropped");
    assert.match(error.note ?? "", /exceeds the 1460 cap/);
    // every byte of the failing chunk must still reach the trace (TCP may split it)
    const raw = records.filter((r) => r.kind === "raw").map((r) => r.hex).join("");
    assert.ok(junk.startsWith(raw) && raw.length > 0, `raw fallback lost data: ${raw}`);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (raw mode): records every chunk verbatim", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "raw", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    socket.write(fromHex("010203"));
    const record = await waitFor(records, (r) => r.kind === "raw");
    assert.equal(record.hex, "010203");
    assert.equal(record.len, 3);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture: lifecycle records and JSONL serialization", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "framed", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    assert.equal(records[0]!.kind, "server-info");
    const socket = await connectTo(info.port);
    await waitFor(records, (r) => r.kind === "connect");
    socket.end();
    await once(socket, "close");
    await waitFor(records, (r) => r.kind === "disconnect");
    const lines = toJsonl(records).trim().split("\n");
    assert.equal(lines.length, records.length);
    const parsed = JSON.parse(lines[0]!) as CaptureRecord;
    assert.equal(parsed.kind, "server-info");
    assert.ok(records.every((r, i) => r.seq === i), "sequence numbers must be monotonic");
  } finally {
    await server.stop();
  }
});

test("capture (session): adopts the handshake seeds and records decrypted opcodes", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "session", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const handshake = encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES).fill(0x41), 0xaabbccdd, 0x11223344);
    const sender = new CipherState(0x11223344); // the client's receive seed is our send state
    const packet = encodeSessionPacket(fromHex("0a0102"), sender);

    // one write, so the handshake and the first packet share a chunk
    socket.write(Buffer.concat([Buffer.from(handshake), Buffer.from(packet)]));

    const handshakeRecord = await waitFor(records, (r) => r.kind === "handshake");
    assert.equal(handshakeRecord.len, HANDSHAKE_TOTAL_BYTES);
    assert.deepEqual(handshakeRecord.seeds, { sendSeed: 0xaabbccdd, recvSeed: 0x11223344 });

    const frame = await waitFor(records, (r) => r.kind === "frame");
    assert.equal(frame.opcode, 0x0a);
    assert.equal(frame.headerOk, true);
    assert.equal(frame.plainHex, "0a0102");
    assert.equal(frame.bodyLength, 3);
    assert.equal(frame.note, undefined);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (session): an undecodable chunk is flagged once and then dumped raw", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", mode: "session", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    // 4 bytes that look like a header with an impossible body length arrive before any handshake:
    // the session deframer sees 211 bytes of "handshake" and must not accept it as one.
    const junk = new Uint8Array(HANDSHAKE_TOTAL_BYTES);
    junk.fill(0xff);
    socket.write(Buffer.from(junk));
    const error = await waitFor(records, (r) => r.kind === "framing-error");
    assert.match(error.note ?? "", /handshake|seed|length/i);
    const raw = await waitFor(records, (r) => r.kind === "raw");
    assert.ok(raw.hex.length > 0);
    socket.destroy();
  } finally {
    await server.stop();
  }
});
