import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CipherState,
  HEADER_MAGIC,
  LCG_INCREMENT,
  LCG_MULTIPLIER,
  decryptBody,
  encryptBody,
  headerMagicOf,
  keyByteOf,
  nextState,
  swapNibbles,
} from "../src/protocol/cipher.ts";
import {
  HANDSHAKE_BODY_BYTES,
  HANDSHAKE_TOTAL_BYTES,
  SessionDeframer,
  decodeHandshake,
  describePacket,
  encodeHandshake,
  encodeSessionPacket,
} from "../src/protocol/session.ts";
import { FramingError, fromHex, toHex } from "../src/protocol/frame.ts";

test("key schedule uses the MSVC rand LCG constants", () => {
  assert.equal(nextState(0), LCG_INCREMENT);
  assert.equal(nextState(1), (LCG_MULTIPLIER + LCG_INCREMENT) >>> 0);
  // wraps modulo 2^32
  assert.equal(nextState(0xffffffff), (Math.imul(0xffffffff, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0);
});

test("key byte is the low byte, header magic the XOR of 0xD3 with the high word", () => {
  const state = 0x1234_5678;
  assert.equal(keyByteOf(state), 0x78);
  assert.equal(headerMagicOf(state), (0xd3 ^ 0x1234) & 0xffff);
  assert.equal(headerMagicOf(0x0000_0000), HEADER_MAGIC);
});

test("nibble swap is self-inverse", () => {
  for (const b of [0x00, 0x0f, 0xf0, 0xa5, 0xff, 0x37]) {
    assert.equal(swapNibbles(swapNibbles(b)), b);
  }
  assert.equal(swapNibbles(0xab), 0xba);
});

test("encrypt/decrypt round-trip per the binary's formulas", () => {
  const state = 0xdead_beef;
  const key = keyByteOf(state);
  const plain = fromHex("0d0011223344ff");
  const cipher = encryptBody(plain, state);
  // encrypt: key ^ swapNibbles(plain)   (sub_4A2030)
  assert.equal(cipher[0], key ^ swapNibbles(plain[0]!));
  // decrypt: swapNibbles(key ^ cipher)  (sub_4A1B90)
  assert.deepEqual(decryptBody(cipher, state), plain);
});

test("cipher state advances exactly once per packet", () => {
  const state = new CipherState(0x12345678);
  const before = state.raw;
  state.encrypt(fromHex("0102"));
  assert.equal(state.raw, nextState(before));
  state.decrypt(fromHex("0102"));
  assert.equal(state.raw, nextState(nextState(before)));
});

test("handshake is exactly 211 bytes with 199 body bytes and two seeds", () => {
  const body = new Uint8Array(HANDSHAKE_BODY_BYTES).fill(0x41);
  const wire = encodeHandshake(body, 0xaabbccdd, 0x11223344);
  assert.equal(wire.length, HANDSHAKE_TOTAL_BYTES);
  assert.equal(new DataView(wire.buffer).getUint16(0, true), 211);
  assert.equal(new DataView(wire.buffer).getUint16(2, true), 199);

  const decoded = decodeHandshake(wire);
  assert.deepEqual(decoded.body, body);
  // tail offsets in the original: 4 + bodyLength and 8 + bodyLength (=> 203 / 207)
  assert.equal(decoded.sendSeed, 0xaabbccdd);
  assert.equal(decoded.recvSeed, 0x11223344);
  assert.equal(new DataView(wire.buffer).getUint32(4 + HANDSHAKE_BODY_BYTES, true), 0xaabbccdd);
});

test("handshake decoder rejects the lengths that make the client throw", () => {
  const good = encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES), 1, 2);
  // > 211 -> CPatchException path, < 211 -> CTerminateException path
  assert.throws(() => decodeHandshake(good.subarray(0, 210)), FramingError);
  const tooLong = new Uint8Array(212);
  tooLong.set(good);
  assert.throws(() => decodeHandshake(tooLong), FramingError);
});

test("session packet: plaintext 4-byte header, encrypted body, opcode = body[0]", () => {
  const send = new CipherState(0x0badf00d);
  const body = fromHex("2a00deadbeef");
  const wire = encodeSessionPacket(body, send);

  const view = new DataView(wire.buffer);
  assert.equal(view.getUint16(0, true), headerMagicOf(0x0badf00d));
  assert.equal(view.getUint16(2, true), body.length);
  assert.equal(wire.length, body.length + 4);
  // the body on the wire must not equal the plaintext (non-trivial key)
  assert.notEqual(toHex(wire.slice(4)), toHex(body));
});

test("session deframer decrypts and reports opcodes, and the peer mirrors the state", () => {
  // server side -> client: the client's recv seed is the sender state here
  const recvSeed = 0x00c0ffee;
  const sender = new CipherState(recvSeed);
  const receiver = new CipherState(recvSeed);

  const wires = [
    encodeSessionPacket(fromHex("0100aa"), sender),
    encodeSessionPacket(fromHex("0200ff00ff"), sender),
    encodeSessionPacket(fromHex("0a00"), sender),
  ];

  const deframer = new SessionDeframer({ recvState: receiver });
  // split the stream at an awkward boundary to prove reassembly
  const all = new Uint8Array(wires.reduce((n, w) => n + w.length, 0));
  let offset = 0;
  for (const w of wires) {
    all.set(w, offset);
    offset += w.length;
  }
  const first = deframer.push(all.subarray(0, 5));
  assert.equal(first.length, 0);
  const events = [...first, ...deframer.push(all.subarray(5))];
  assert.equal(deframer.failure, undefined);
  assert.deepEqual(
    events.map((e) => (e.kind === "packet" ? e.opcode : -1)),
    [0x01, 0x02, 0x0a],
  );
  const second = events[1]!;
  assert.equal(second.kind, "packet");
  if (second.kind !== "packet") throw new Error("unreachable");
  assert.deepEqual(second.plain, fromHex("0200ff00ff"));
  assert.equal(second.headerOk, true);
  assert.equal(describePacket(events[2]!).includes("opcode=0x0a"), true);
});

test("session deframer consumes a 211-byte handshake first and seeds from it", () => {
  const body = new Uint8Array(HANDSHAKE_BODY_BYTES).fill(0x33);
  const handshake = encodeHandshake(body, 0x11223344, 0x55667788);
  const sender = new CipherState(0x55667788); // the client's receive seed drives our send state
  const packet = encodeSessionPacket(fromHex("0a00"), sender);

  const deframer = new SessionDeframer(); // no state: expect the handshake
  assert.equal(deframer.awaitingHandshake, true);
  const stream = new Uint8Array(handshake.length + packet.length);
  stream.set(handshake, 0);
  stream.set(packet, handshake.length);

  const events = [...deframer.push(stream.subarray(0, 100)), ...deframer.push(stream.subarray(100))];
  assert.equal(events.length, 2);
  const [first, second] = events;
  assert.equal(first!.kind, "handshake");
  if (first!.kind !== "handshake") throw new Error("unreachable");
  assert.equal(first!.handshake.recvSeed, 0x55667788);
  assert.equal(deframer.awaitingHandshake, false);
  assert.equal(second!.kind, "packet");
  if (second!.kind !== "packet") throw new Error("unreachable");
  assert.equal(second!.opcode, 0x0a);
  assert.deepEqual(second!.plain, fromHex("0a00"));
});

test("session deframer records a bad length instead of throwing away valid packets", () => {
  const state = new CipherState(1);
  const sender = new CipherState(1);
  const good = encodeSessionPacket(fromHex("0a00"), sender);
  const deframer = new SessionDeframer({ recvState: state });
  const stream = new Uint8Array(good.length + 4);
  stream.set(good, 0);
  stream.set(fromHex("d300ffff"), good.length); // declared body length far past the 1460 cap

  const events = deframer.push(stream);
  assert.equal(events.length, 1, "the valid packet before the bad length must survive");
  assert.equal(events[0]!.kind, "packet");
  assert.match(deframer.failure ?? "", /exceeds the 1460 cap/);
  assert.deepEqual(deframer.push(fromHex("0a00")), [], "a failed deframer stops decoding");
});
