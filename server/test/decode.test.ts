import { test } from "node:test";
import assert from "node:assert/strict";
import { CipherState } from "../src/protocol/cipher.ts";
import { encodeHandshake, encodeSessionPacket, HANDSHAKE_BODY_BYTES } from "../src/protocol/session.ts";
import { toHex } from "../src/protocol/frame.ts";
import { decodeTrace, type TraceRecord } from "../src/net/decode.ts";

const SEND_SEED = 0xaabbccdd;
const RECV_SEED = 0x11223344;

/** A trace as the capture harness would write it: frames in wire order. */
function traceOf(seed: number, bodies: Uint8Array[], dir: "c2s" | "s2c" = "c2s"): TraceRecord[] {
  const state = new CipherState(seed);
  let t = 0;
  return bodies.map((body) => {
    const wire = encodeSessionPacket(body, state);
    const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
    t += 5;
    return {
      t,
      conn: 1,
      dir,
      kind: "frame",
      len: wire.length,
      hex: toHex(wire),
      header: view.getUint16(0, true),
      bodyLength: view.getUint16(2, true),
    };
  });
}

test("decode adopts the seeds from a 211-byte handshake and decrypts what follows", () => {
  const handshake = encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES).fill(0x5a), SEND_SEED, RECV_SEED);
  const records: TraceRecord[] = [
    { t: 0, conn: 1, dir: "s2c", kind: "frame", len: handshake.length, hex: toHex(handshake), header: 211, bodyLength: HANDSHAKE_BODY_BYTES },
    ...traceOf(RECV_SEED, [Uint8Array.from([0x07, 0x01, 0x02, 0x03])]),
  ];
  const result = decodeTrace(records);
  assert.equal(result.handshake?.sendSeed, SEND_SEED);
  assert.equal(result.handshake?.recvSeed, RECV_SEED);
  assert.equal(result.packets.length, 2);
  const packet = result.packets[1]!;
  assert.equal(packet.headerOk, true);
  assert.equal(packet.opcode, 0x07);
  assert.equal(packet.bodyHex, "07010203");
});

test("decode round-trips a whole session, one LCG step per packet", () => {
  const bodies = [
    Uint8Array.from([0x0a, 0x00]),
    Uint8Array.from([0x14, 0xff, 0xff, 0xff, 0xff]),
    Uint8Array.from([0x01]),
  ];
  const result = decodeTrace(traceOf(RECV_SEED, bodies), { recvSeed: RECV_SEED });
  assert.equal(result.packets.length, bodies.length);
  for (const [i, packet] of result.packets.entries()) {
    assert.equal(packet.headerOk, true, `packet ${i} header drifted`);
    assert.equal(packet.bodyHex, toHex(bodies[i]!));
    assert.equal(packet.opcode, bodies[i]![0]);
  }
});

test("decode flags a header mismatch instead of printing garbage", () => {
  const records = traceOf(RECV_SEED, [Uint8Array.from([0x0a, 0x00])]);
  records[0]!.hex = records[0]!.hex!.replace(/^..../, "0000"); // corrupt the header only
  const result = decodeTrace(records, { recvSeed: RECV_SEED });
  assert.equal(result.packets[0]!.headerOk, false);
  assert.equal(result.packets[0]!.expectedHeader, (0xd3 ^ ((RECV_SEED >>> 16) & 0xffff)) & 0xffff);
});

test("decode reports packets it cannot key rather than guessing", () => {
  const result = decodeTrace(traceOf(RECV_SEED, [Uint8Array.from([0x0a])]));
  const packet = result.packets[0]!;
  assert.equal(packet.bodyHex, "");
  assert.match(packet.note ?? "", /no seed/);
});
