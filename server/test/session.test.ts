import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CipherState,
  CLIENT_SEND_MAGIC,
  SERVER_SEND_MAGIC,
  CLIENT_VERSION,
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
  LEGACY_HANDSHAKE_BODY_BYTES,
  LEGACY_HANDSHAKE_TOTAL_BYTES,
  HANDSHAKE_VERSION,
  SessionDeframer,
  decodeLegacyHandshake,
  describePacket,
  encodeLegacyHandshake,
  encodeSessionPacket,
} from "../src/protocol/session.ts";
import { FramingError, fromHex, toHex } from "../src/protocol/frame.ts";

test("key schedule uses the MSVC rand LCG constants", () => {
  assert.equal(nextState(0), LCG_INCREMENT);
  assert.equal(nextState(1), (LCG_MULTIPLIER + LCG_INCREMENT) >>> 0);
  // wraps modulo 2^32
  assert.equal(
    nextState(0xffffffff),
    (Math.imul(0xffffffff, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0,
  );
});

test("key byte is the low byte, header magic the XOR of 0xD3 with the high word", () => {
  const state = 0x1234_5678;
  assert.equal(keyByteOf(state), 0x78);
  assert.equal(headerMagicOf(state), (0xd3 ^ 0x1234) & 0xffff);
  assert.equal(headerMagicOf(0x0000_0000), CLIENT_SEND_MAGIC);
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

test("legacy handshake encoder emits 211 bytes with its 199-byte body and two seeds", () => {
  const body = new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES).fill(0x41);
  const wire = encodeLegacyHandshake(body, 0xaabbccdd, 0x11223344);
  assert.equal(wire.length, LEGACY_HANDSHAKE_TOTAL_BYTES);
  assert.equal(new DataView(wire.buffer).getUint16(0, true), 211);
  assert.equal(new DataView(wire.buffer).getUint16(2, true), 199);

  const decoded = decodeLegacyHandshake(wire);
  assert.deepEqual(decoded.body, body);
  // tail offsets in the original: 4 + bodyLength and 8 + bodyLength (=> 203 / 207)
  assert.equal(decoded.sendSeed, 0xaabbccdd);
  assert.equal(decoded.recvSeed, 0x11223344);
  assert.equal(
    new DataView(wire.buffer).getUint32(4 + LEGACY_HANDSHAKE_BODY_BYTES, true),
    0xaabbccdd,
  );
});

test("legacy handshake decoder rejects lengths outside its fixed 211-byte model", () => {
  const good = encodeLegacyHandshake(new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES), 1, 2);
  // This pins the old parser shape only; it is not a target short-greeting conformance test.
  assert.throws(() => decodeLegacyHandshake(good.subarray(0, 210)), FramingError);
  const tooLong = new Uint8Array(212);
  tooLong.set(good);
  assert.throws(() => decodeLegacyHandshake(tooLong), FramingError);
});

test("session packet: plaintext 4-byte header, encrypted body, opcode = body[0]", () => {
  const send = new CipherState(0x0badf00d);
  const body = fromHex("2a00deadbeef");
  const wire = encodeSessionPacket(body, send, "c2s");

  const view = new DataView(wire.buffer);
  assert.equal(view.getUint16(0, true), headerMagicOf(0x0badf00d, CLIENT_SEND_MAGIC));
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
    encodeSessionPacket(fromHex("0100aa"), sender, "c2s"),
    encodeSessionPacket(fromHex("0200ff00ff"), sender, "c2s"),
    encodeSessionPacket(fromHex("0a00"), sender, "c2s"),
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

test("session deframer consumes the legacy 211-byte opening and seeds from it", () => {
  const body = new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES).fill(0x33);
  const handshake = encodeLegacyHandshake(body, 0x11223344, 0x55667788);
  const sender = new CipherState(0x55667788); // the client's receive seed drives our send state
  const packet = encodeSessionPacket(fromHex("0a00"), sender, "c2s");

  const deframer = new SessionDeframer(); // no state: expect the handshake
  assert.equal(deframer.awaitingHandshake, true);
  const stream = new Uint8Array(handshake.length + packet.length);
  stream.set(handshake, 0);
  stream.set(packet, handshake.length);

  const events = [
    ...deframer.push(stream.subarray(0, 100)),
    ...deframer.push(stream.subarray(100)),
  ];
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
  const good = encodeSessionPacket(fromHex("0a00"), sender, "c2s");
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

test("the two directions use different header magic (measured, not cosmetic)", () => {
  // cipher.ts: the client writes 0xD3 ^ HIWORD(state) (sub_43AD50 -> sub_4A2030) but verifies
  // 0xFF2C ^ HIWORD(state) (sub_43AFA0). A server that echoes the client's own magic gets an
  // immediate AVCDisconnectException, so this difference is pinned by a test.
  assert.equal(CLIENT_SEND_MAGIC, 0x00d3);
  assert.equal(SERVER_SEND_MAGIC, 0xff2c);
  assert.equal(CLIENT_SEND_MAGIC ^ SERVER_SEND_MAGIC, 0xffff);

  const seed = 0x1234abcd;
  const c2s = encodeSessionPacket(fromHex("0a00"), new CipherState(seed), "c2s");
  const s2c = encodeSessionPacket(fromHex("0a00"), new CipherState(seed), "s2c");
  assert.equal(new DataView(c2s.buffer).getUint16(0, true), 0xd3 ^ 0x1234);
  assert.equal(new DataView(s2c.buffer).getUint16(0, true), 0xff2c ^ 0x1234);
  // same key byte, so the bodies are identical - only the header differs
  assert.deepEqual([...c2s.slice(4)], [...s2c.slice(4)]);

  // and each decoder only accepts its own direction
  const asClient = new SessionDeframer({ recvState: new CipherState(seed) });
  assert.equal((asClient.push(c2s)[0] as { headerOk: boolean }).headerOk, true);
  const asServer = new SessionDeframer({
    recvState: new CipherState(seed),
    expectedMagic: SERVER_SEND_MAGIC,
  });
  assert.equal((asServer.push(s2c)[0] as { headerOk: boolean }).headerOk, true);
  const wrong = new SessionDeframer({ recvState: new CipherState(seed) });
  assert.equal((wrong.push(s2c)[0] as { headerOk: boolean }).headerOk, false);
});

test("a body over the client's 1456-byte limit is refused, not silently truncated", () => {
  const send = new CipherState(1);
  assert.throws(() => encodeSessionPacket(new Uint8Array(1457), send), FramingError);
  assert.equal(encodeSessionPacket(new Uint8Array(1456), send).length, 1460);
});

test("0xD3 remains the version/magic constant; the 211-byte encoder is legacy only", () => {
  // ADR-166: 0xD3 is a version value and the archived EXE uses it in session-header logic.
  // Its sub_43A410 path compares offset 0, which does not match the corrected target layout:
  // [u16 length][u16 version=0x00D3] with a short greeting. The assertions below pin current
  // legacy encoder behavior only; they are not evidence that the target greeting is 211 bytes.
  assert.equal(CLIENT_VERSION, 211);
  assert.equal(HANDSHAKE_VERSION, CLIENT_VERSION, "one definition, not two copies of 211");
  assert.equal(HANDSHAKE_VERSION, CLIENT_VERSION);
  assert.equal(CLIENT_SEND_MAGIC, CLIENT_VERSION, "the client writes its version as the magic");
  assert.equal(SERVER_SEND_MAGIC, ~CLIENT_VERSION & 0xffff);
  assert.equal(SERVER_SEND_MAGIC, 0xff2c);
  // Preserve current legacy-model invariants until the target short greeting is implemented.
  assert.equal(LEGACY_HANDSHAKE_TOTAL_BYTES, 211);
  assert.equal(LEGACY_HANDSHAKE_BODY_BYTES, 199);
  const wire = encodeLegacyHandshake(new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES), 1, 2);
  assert.equal(wire.length, 211);
  assert.equal(new DataView(wire.buffer).getUint16(0, true), CLIENT_VERSION);
  // Target-format assertion is deliberately separate: version follows the 2-byte length prefix.
  assert.equal(CLIENT_VERSION, 0x00d3);
});

test("legacy handshake body round-trips under the obsolete 199-byte model", () => {
  // sub_418610 copies 199 bytes into a local in the archived listing, but that path has not been
  // mapped to the target short greeting. This test only pins the current legacy encoder/decoder;
  // it does not establish that the target client ignores a 199-byte block.
  for (const fill of [0x00, 0xff, 0x5a]) {
    const body = new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES).fill(fill);
    const decoded = decodeLegacyHandshake(encodeLegacyHandshake(body, 7, 8));
    assert.equal(decoded.body.length, LEGACY_HANDSHAKE_BODY_BYTES);
    assert.equal(decoded.body[0], fill);
    assert.equal(decoded.sendSeed, 7);
    assert.equal(decoded.recvSeed, 8);
  }
  // The legacy encoder enforces its fixed-size body; this constraint is not a target-wire rule.
  assert.throws(
    () => encodeLegacyHandshake(new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES + 1), 1, 2),
    FramingError,
  );
  assert.throws(
    () => encodeLegacyHandshake(new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES - 1), 1, 2),
    FramingError,
  );
});
