import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { CaptureServer, toJsonl, type CaptureRecord } from "../src/net/capture.ts";
import { fromHex, toHex } from "../src/protocol/frame.ts";
import { CipherState } from "../src/protocol/cipher.ts";
import {
  DEFAULT_HANDSHAKE_BODY_BYTES,
  MIN_HANDSHAKE_WIRE_BYTES,
  encodeHandshake,
  encodeSessionPacket,
} from "../src/protocol/session.ts";

function connectTo(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1" }, () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitFor(
  records: CaptureRecord[],
  predicate: (r: CaptureRecord) => boolean,
  timeoutMs = 2000,
) {
  return new Promise<CaptureRecord>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = records.find(predicate);
      if (hit) return resolve(hit);
      if (Date.now() - started > timeoutMs)
        return reject(new Error("timed out waiting for record"));
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
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "framed",
    onRecord: (r) => records.push(r),
  });
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
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "framed",
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const packet = wire(0x0102, "0102030405");
    socket.write(packet.subarray(0, 3));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      records.filter((r) => r.kind === "frame").length,
      0,
      "must not emit a partial frame",
    );
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
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "framed",
    onRecord: (r) => records.push(r),
  });
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
    const raw = records
      .filter((r) => r.kind === "raw")
      .map((r) => r.hex)
      .join("");
    assert.ok(junk.startsWith(raw) && raw.length > 0, `raw fallback lost data: ${raw}`);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (raw mode): records every chunk verbatim", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "raw",
    onRecord: (r) => records.push(r),
  });
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
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "framed",
    onRecord: (r) => records.push(r),
  });
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
    assert.ok(
      records.every((r, i) => r.seq === i),
      "sequence numbers must be monotonic",
    );
  } finally {
    await server.stop();
  }
});

test("capture (session): adopts the handshake seeds and records decrypted opcodes", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "session",
    handshake: "off", // this test plays the client: it sends the handshake itself
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const handshake = encodeHandshake(
      new Uint8Array(DEFAULT_HANDSHAKE_BODY_BYTES).fill(0x41),
      0xaabbccdd,
      0x11223344,
    );
    const sender = new CipherState(0x11223344); // the client's receive seed is our send state
    const packet = encodeSessionPacket(fromHex("0a0102"), sender, "c2s"); // client -> server

    // one write, so the handshake and the first packet share a chunk
    socket.write(Buffer.concat([Buffer.from(handshake), Buffer.from(packet)]));

    const handshakeRecord = await waitFor(records, (r) => r.kind === "handshake");
    assert.equal(handshakeRecord.len, MIN_HANDSHAKE_WIRE_BYTES);
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
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "session",
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    // An all-0xff prefix exceeds the checked client's 1460-byte greeting payload cap.
    const junk = new Uint8Array(MIN_HANDSHAKE_WIRE_BYTES);
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

test("capture (session): sends the handshake itself, since the 2003 client speaks second", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "session",
    handshake: { clientSendSeed: 0x01020304, clientRecvSeed: 0x05060708 },
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const sent = await waitFor(records, (r) => r.kind === "handshake");
    assert.equal(sent.dir, "s2c");
    assert.equal(sent.len, MIN_HANDSHAKE_WIRE_BYTES);
    // the seed we told the client to send with is the state we decrypt with
    assert.deepEqual(sent.seeds, { sendSeed: 0x01020304, recvSeed: 0x05060708 });

    // a client answering with that seed must be decoded without any handshake of its own
    const client = new CipherState(0x01020304);
    socket.write(Buffer.from(encodeSessionPacket(fromHex("1a00"), client, "c2s")));
    const frame = await waitFor(records, (r) => r.kind === "frame");
    assert.equal(frame.opcode, 0x1a);
    assert.equal(frame.headerOk, true);
    assert.equal(frame.plainHex, "1a00");
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (session): sends the minimal length-prefixed greeting with both seeds", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "session",
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const sent = await waitFor(records, (r) => r.kind === "handshake");
    const bytes = fromHex(sent.hex);
    assert.equal(bytes.length, MIN_HANDSHAKE_WIRE_BYTES);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint16(0, true), 12, "length counts bytes after the prefix");
    assert.equal(view.getUint16(2, true), 0x00d3);
    assert.equal(view.getUint16(4, true), 0);
    assert.equal(view.getUint32(6, true), sent.seeds!.sendSeed);
    assert.equal(view.getUint32(10, true), sent.seeds!.recvSeed);
    assert.equal(sent.bodyLength, 0);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test(
  "capture CLI applies --handshake-body with auto seeds and honors --host",
  { timeout: 15000 },
  async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "server/src/cli.ts",
        "capture",
        "--port",
        "0",
        "--host",
        "127.0.0.1",
        "--handshake-body",
        "0041ff",
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const stdoutReader = child.stdout.getReader();
    const stderrText = new Response(child.stderr).text();
    let stdout = "";
    let socket: Socket | undefined;
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`capture CLI did not start: ${stdout}`)),
          10000,
        );
        const readOutput = async () => {
          try {
            const { done, value } = await stdoutReader.read();
            if (done) {
              clearTimeout(timeout);
              reject(new Error(`capture CLI closed before listening: ${stdout}`));
              return;
            }
            stdout += new TextDecoder().decode(value, { stream: true });
            const match = stdout.match(/capture listening on 127\.0\.0\.1:(\d+)/);
            if (match) {
              clearTimeout(timeout);
              resolve(Number(match[1]));
              return;
            }
            void readOutput();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        };
        void readOutput();
        void child.exited.then((status) => {
          if (!stdout.includes("capture listening on")) {
            clearTimeout(timeout);
            reject(new Error(`capture CLI exited ${status}: ${stdout}`));
          }
        });
      });

      socket = await connectTo(port);
      const greeting = await new Promise<Uint8Array>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const onData = (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks);
          if (bytes.length < 2) return;
          const total = bytes.readUInt16LE(0) + 2;
          if (bytes.length >= total) {
            socket!.off("data", onData);
            resolve(new Uint8Array(bytes.subarray(0, total)));
          }
        };
        socket!.on("data", onData);
        socket!.once("error", reject);
      });
      const view = new DataView(greeting.buffer, greeting.byteOffset, greeting.byteLength);
      assert.equal(greeting.length, MIN_HANDSHAKE_WIRE_BYTES + 3);
      assert.equal(view.getUint16(0, true), 15);
      assert.equal(view.getUint16(2, true), 0x00d3);
      assert.equal(view.getUint16(4, true), 3);
      assert.equal(toHex(greeting.slice(6, 9)), "0041ff");
    } finally {
      socket?.destroy();
      child.kill("SIGTERM");
      await child.exited;
      await stdoutReader.cancel().catch(() => {});
      await stderrText;
    }
  },
);

test("capture (session): caller counted bytes shift the seeds and payload length", async () => {
  const records: CaptureRecord[] = [];
  const body = fromHex("0041ff");
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "session",
    handshake: { body },
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    const sent = await waitFor(records, (r) => r.kind === "handshake");
    const bytes = fromHex(sent.hex);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const payloadLength = MIN_HANDSHAKE_WIRE_BYTES - 2 + body.length;
    const sendSeedOffset = 6 + body.length;

    assert.equal(bytes.length, MIN_HANDSHAKE_WIRE_BYTES + body.length);
    assert.equal(view.getUint16(0, true), payloadLength);
    assert.equal(view.getUint16(4, true), body.length);
    assert.deepEqual(bytes.slice(6, sendSeedOffset), body);
    assert.equal(view.getUint32(sendSeedOffset, true), sent.seeds!.sendSeed);
    assert.equal(view.getUint32(sendSeedOffset + 4, true), sent.seeds!.recvSeed);
    assert.equal(sent.bodyLength, body.length);
    socket.destroy();
  } finally {
    await server.stop();
  }
});

test("capture (session): handshake off waits for a client-sent handshake", async () => {
  const records: CaptureRecord[] = [];
  const server = new CaptureServer({
    port: 0,
    host: "127.0.0.1",
    mode: "session",
    handshake: "off",
    onRecord: (r) => records.push(r),
  });
  const info = await server.start();
  try {
    const socket = await connectTo(info.port);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      records.filter((r) => r.kind === "handshake").length,
      0,
      "nothing is sent unprompted",
    );
    socket.write(Buffer.from(encodeHandshake(new Uint8Array(DEFAULT_HANDSHAKE_BODY_BYTES), 7, 9)));
    const received = await waitFor(records, (r) => r.kind === "handshake");
    assert.equal(received.dir, "c2s");
    assert.deepEqual(received.seeds, { sendSeed: 7, recvSeed: 9 });
    socket.destroy();
  } finally {
    await server.stop();
  }
});
