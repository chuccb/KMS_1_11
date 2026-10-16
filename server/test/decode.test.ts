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
    const wire = encodeSessionPacket(body, state, dir);
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
  // The server opens the session (as the 2003 client expects), assigning the client its seeds.
  const handshake = encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES).fill(0x5a), SEND_SEED, RECV_SEED);
  const records: TraceRecord[] = [
    { t: 0, conn: 1, dir: "s2c", kind: "handshake", len: handshake.length, hex: toHex(handshake), bodyLength: HANDSHAKE_BODY_BYTES },
    ...traceOf(SEND_SEED, [Uint8Array.from([0x07, 0x01, 0x02, 0x03])]), // the client sends with u32#1
  ];
  const result = decodeTrace(records);
  assert.equal(result.handshake?.clientSendSeed, SEND_SEED);
  assert.equal(result.handshake?.clientRecvSeed, RECV_SEED);
  assert.equal(result.packets.length, 2);
  const packet = result.packets[1]!;
  assert.equal(packet.headerOk, true);
  assert.equal(packet.opcode, 0x07);
  assert.equal(packet.bodyHex, "07010203");
});

test("decode keys the two directions from the handshake, not from one shared seed", () => {
  // The bug this pins: a server-sent handshake assigns u32#1 to the CLIENT's send state, so c2s
  // packets use it and s2c packets use u32#2. Keying both from one seed decodes one direction
  // into plausible-looking garbage and flags the header, which is how it was caught.
  const handshake = encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES), 0x11223344, 0x55667788);
  const records: TraceRecord[] = [
    { t: 0, conn: 1, dir: "s2c", kind: "handshake", len: 211, hex: toHex(handshake), bodyLength: HANDSHAKE_BODY_BYTES },
    ...traceOf(0x55667788, [Uint8Array.from([0x0a, 0xaa])], "s2c"), // server -> client uses u32#2
    ...traceOf(0x11223344, [Uint8Array.from([0x1a, 0xbb])], "c2s"), // client -> server uses u32#1
  ];
  const result = decodeTrace(records);
  const [, s2c, c2s] = result.packets;
  assert.equal(s2c!.opcode, 0x0a);
  assert.equal(s2c!.headerOk, true);
  assert.equal(c2s!.opcode, 0x1a);
  assert.equal(c2s!.headerOk, true);
});

test("decode of a client-sent handshake seeds the server's states instead", () => {
  // With --handshake off the client dictates the seeds; then the SERVER sends with u32#1.
  const handshake = encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES), 0x0a0b0c0d, 0x0e0f1011);
  const records: TraceRecord[] = [
    { t: 0, conn: 1, dir: "c2s", kind: "handshake", len: 211, hex: toHex(handshake), bodyLength: HANDSHAKE_BODY_BYTES },
    ...traceOf(0x0a0b0c0d, [Uint8Array.from([0x01, 0x02])], "s2c"),
  ];
  const result = decodeTrace(records);
  assert.equal(result.packets[1]!.headerOk, true);
  assert.equal(result.packets[1]!.bodyHex, "0102");
});

test("decode round-trips a whole session, one LCG step per packet", () => {
  const bodies = [
    Uint8Array.from([0x0a, 0x00]),
    Uint8Array.from([0x14, 0xff, 0xff, 0xff, 0xff]),
    Uint8Array.from([0x01]),
  ];
  const result = decodeTrace(traceOf(RECV_SEED, bodies), { c2sSeed: RECV_SEED });
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
  const result = decodeTrace(records, { c2sSeed: RECV_SEED });
  assert.equal(result.packets[0]!.headerOk, false);
  assert.equal(result.packets[0]!.expectedHeader, (0xd3 ^ ((RECV_SEED >>> 16) & 0xffff)) & 0xffff);
});

test("decode reports packets it cannot key rather than guessing", () => {
  const result = decodeTrace(traceOf(RECV_SEED, [Uint8Array.from([0x0a])]));
  const packet = result.packets[0]!;
  assert.equal(packet.bodyHex, "");
  assert.match(packet.note ?? "", /no seed/);
});
