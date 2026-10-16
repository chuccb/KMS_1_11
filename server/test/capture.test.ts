import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { CaptureServer, toJsonl, type CaptureRecord } from "../src/net/capture.ts";
import { U16LengthFramer, fromHex } from "../src/protocol/frame.ts";

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

test("capture (framed): decodes the u16 length prefix and reports an opcode candidate", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    // opcode 0x000d then two payload bytes, wrapped by the client's framing
    socket.write(new U16LengthFramer().encode(fromHex("0d00aaff")));
    const record = await waitFor(records, (r) => r.kind === "frame");
    assert.equal(record.dir, "c2s");
    assert.equal(record.len, 6); // 2 header + 4 payload
    assert.equal(record.opcodeCandidate, 0x000d);
    assert.equal(record.hex, "06000d00aaff");
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (framed): reassembles a frame split across two writes", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const wire = new U16LengthFramer().encode(fromHex("0102030405"));
    socket.write(wire.subarray(0, 3));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(records.filter((r) => r.kind === "frame").length, 0, "must not emit a partial frame");
    socket.write(wire.subarray(3));
    const record = await waitFor(records, (r) => r.kind === "frame");
    assert.equal(record.opcodeCandidate, 0x0201);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture: falls back to a raw dump when the framing assumption fails", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", onRecord: (r) => records.push(r) });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    // declared length 0xFFFF is far beyond the client's 1460 receive buffer
    socket.write(fromHex("ffff0102030405"));
    const error = await waitFor(records, (r) => r.kind === "framing-error");
    assert.equal(error.len, 7, "the failing chunk must be recorded, not dropped");
    const raw = await waitFor(records, (r) => r.kind === "raw");
    assert.equal(raw.hex, "ffff0102030405");
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
  const server = new CaptureServer({ port: 0, host: "127.0.0.1", onRecord: (r) => records.push(r) });
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
