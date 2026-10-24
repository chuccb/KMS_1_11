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
  DEFAULT_HANDSHAKE_BODY_BYTES,
  MIN_HANDSHAKE_WIRE_BYTES,
  HANDSHAKE_VERSION,
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
  assert.equal(
    nextState(0xffffffff),
    (Math.imul(0xffffffff, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0,
  );
});

test("key byte is the low byte, header magic the XOR of 0xD3 with the high word", () => {
  const state = 0x1234_5678;
  assert.equal(keyByteOf(state), 0x78);
  assert.equal(headerMagicOf(state), (0xd3 ^ 0x1234) & 0xffff);
  assert.equal(headerMagicOf(0xc6b926dd), 0xc66a);
  assert.equal(headerMagicOf(0xb8544265), 0xb887);
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

test("greeting layout follows the EXE parser: payload-length prefix, version, counted bytes, seeds", () => {
  const body = fromHex("414243");
  const trailing = fromHex("dead");
  const wire = encodeHandshake(body, 0xaabbccdd, 0x11223344, trailing);
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  const payloadLength = 12 + body.length + trailing.length;

  assert.equal(wire.length, payloadLength + 2);
  assert.equal(view.getUint16(0, true), payloadLength, "prefix excludes its own 2 bytes");
  assert.equal(view.getUint16(2, true), 0x00d3, "version immediately follows the prefix");
  assert.equal(view.getUint16(4, true), body.length);
  assert.equal(toHex(wire.slice(6, 6 + body.length)), "414243");
  assert.equal(view.getUint32(6 + body.length, true), 0xaabbccdd);
  assert.equal(view.getUint32(10 + body.length, true), 0x11223344);
  assert.equal(toHex(wire.slice(14 + body.length)), "dead");

  const decoded = decodeHandshake(wire);
  assert.equal(decoded.version, 0x00d3);
  assert.deepEqual(decoded.body, body);
  assert.equal(decoded.sendSeed, 0xaabbccdd);
  assert.equal(decoded.recvSeed, 0x11223344);
  assert.deepEqual(decoded.trailing, trailing);
});

test("an empty counted string yields the 14-byte minimal greeting accepted by the client", () => {
  const wire = encodeHandshake(new Uint8Array(0), 0xaabbccdd, 0x11223344);
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  assert.equal(DEFAULT_HANDSHAKE_BODY_BYTES, 0);
  assert.equal(MIN_HANDSHAKE_WIRE_BYTES, 14);
  assert.equal(wire.length, MIN_HANDSHAKE_WIRE_BYTES);
  assert.equal(view.getUint16(0, true), 12, "u16 prefix counts payload bytes, not itself");
  assert.equal(view.getUint16(2, true), 0x00d3);
  assert.equal(view.getUint16(4, true), 0);
  assert.equal(view.getUint32(6, true), 0xaabbccdd);
  assert.equal(view.getUint32(10, true), 0x11223344);
  assert.deepEqual(decodeHandshake(wire).body, new Uint8Array(0));
});

test("greeting decoder rejects truncation, invalid version, impossible string length, and oversize prefix", () => {
  const good = encodeHandshake(new Uint8Array(0), 1, 2);
  assert.throws(() => decodeHandshake(good.subarray(0, 13)), FramingError);
  assert.throws(() => decodeHandshake(new Uint8Array([...good, 0])), FramingError);

  const wrongVersion = good.slice();
  new DataView(wrongVersion.buffer).setUint16(2, 0x00d2, true);
  assert.throws(() => decodeHandshake(wrongVersion), /version/);

  const impossibleString = good.slice();
  new DataView(impossibleString.buffer).setUint16(4, 1, true);
  assert.throws(() => decodeHandshake(impossibleString), /fewer than 8 bytes/);

  const oversizedPrefix = new Uint8Array([0xb5, 0x05]); // 0x05b5 = 1461, above the 1460-byte cap
  assert.throws(() => decodeHandshake(oversizedPrefix), /exceeds the 1460-byte client buffer/);
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

test("session deframer waits for the counted payload, then decodes the greeting and server packet", () => {
  const greetingTail = fromHex("99ee");
  const handshake = encodeHandshake(fromHex("33"), 0x11223344, 0x55667788, greetingTail);
  const sender = new CipherState(0x55667788); // the client's receive seed drives server -> client sends
  const packet = encodeSessionPacket(fromHex("0a00"), sender, "s2c");
  const stream = new Uint8Array(handshake.length + packet.length);
  stream.set(handshake, 0);
  stream.set(packet, handshake.length);

  const deframer = new SessionDeframer({ expectedMagic: SERVER_SEND_MAGIC });
  assert.equal(deframer.awaitingHandshake, true);
  assert.deepEqual(deframer.push(stream.subarray(0, 5)), []);
  assert.equal(deframer.awaitingHandshake, true);
  const events = deframer.push(stream.subarray(5));

  assert.equal(deframer.failure, undefined);
  assert.equal(events.length, 2);
  const [first, second] = events;
  assert.equal(first!.kind, "handshake");
  if (first!.kind !== "handshake") throw new Error("unreachable");
  assert.equal(first!.handshake.version, 0x00d3);
  assert.equal(first!.handshake.sendSeed, 0x11223344);
  assert.equal(first!.handshake.recvSeed, 0x55667788);
  assert.deepEqual(first!.handshake.trailing, greetingTail);
  assert.equal(deframer.awaitingHandshake, false);
  assert.equal(second!.kind, "packet");
  if (second!.kind !== "packet") throw new Error("unreachable");
  assert.equal(second!.opcode, 0x0a);
  assert.equal(second!.headerOk, true);
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

test("version is a greeting field and is separately reused as the c2s session-header magic", () => {
  assert.equal(CLIENT_VERSION, 0x00d3);
  assert.equal(HANDSHAKE_VERSION, CLIENT_VERSION);
  assert.equal(CLIENT_SEND_MAGIC, CLIENT_VERSION);
  assert.equal(SERVER_SEND_MAGIC, ~CLIENT_VERSION & 0xffff);
  assert.equal(SERVER_SEND_MAGIC, 0xff2c);

  const wire = encodeHandshake(new Uint8Array(0), 1, 2);
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  assert.equal(view.getUint16(0, true), 12, "length is independent from version");
  assert.equal(view.getUint16(2, true), CLIENT_VERSION);
  assert.equal(wire.length, 14);
});

test("the counted greeting bytes round-trip at variable lengths", () => {
  for (const body of [new Uint8Array(0), fromHex("00"), fromHex("5a00ff")]) {
    const decoded = decodeHandshake(encodeHandshake(body, 7, 8));
    assert.deepEqual(decoded.body, body);
    assert.equal(decoded.sendSeed, 7);
    assert.equal(decoded.recvSeed, 8);
    assert.deepEqual(decoded.trailing, new Uint8Array(0));
  }
  assert.throws(
    () => encodeHandshake(new Uint8Array(1449), 1, 2),
    /exceeds the 1460-byte client buffer/,
  );
});
