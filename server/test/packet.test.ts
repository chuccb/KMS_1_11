import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader, PacketUnderflowError, PacketWriter, readOpcode } from "../src/protocol/packet.ts";
import { decodeClientPacket, encodeClientPacket } from "../src/protocol/login.ts";
import { fromHex, toHex } from "../src/protocol/frame.ts";

test("u16/u32 are little-endian and unsigned", () => {
  const bytes = new PacketWriter().writeU16(0x1234).writeU32(0x89abcdef).toBytes();
  assert.equal(toHex(bytes), "3412efcdab89");
  const reader = new PacketReader(bytes);
  assert.equal(reader.readU16(), 0x1234);
  assert.equal(reader.readU32(), 0x89abcdef);
  assert.equal(reader.exhausted, true);
});

test("u32 handles the full unsigned range", () => {
  const reader = new PacketReader(new PacketWriter().writeU32(0xffffffff).toBytes());
  assert.equal(reader.readU32(), 0xffffffff);
});

test("a string is a u16 byte-length followed by the bytes (sub_4303C0)", () => {
  const bytes = new PacketWriter().writeAsciiString("admin").toBytes();
  assert.equal(toHex(bytes), "050061646d696e");
  const reader = new PacketReader(bytes);
  assert.equal(reader.readAsciiString(), "admin");
  assert.equal(reader.exhausted, true);
});

test("a 256-byte string still uses a u16 length, not a length escape", () => {
  const text = "x".repeat(256);
  const bytes = new PacketWriter().writeAsciiString(text).toBytes();
  assert.equal(bytes.length, 2 + 256);
  assert.equal(bytes[0], 0x00);
  assert.equal(bytes[1], 0x01);
  assert.equal(new PacketReader(bytes).readAsciiString(), text);
});

test("reading past the end throws the client's error, it does not return undefined", () => {
  const reader = new PacketReader(fromHex("01"));
  assert.equal(reader.readByte(), 1);
  assert.throws(() => reader.readByte(), PacketUnderflowError);
  assert.throws(() => new PacketReader(fromHex("01")).readU32(), PacketUnderflowError);
  const error = new PacketUnderflowError(4, 1);
  assert.equal(error.code, 38); // the client throws ZException(38) from sub_45DC40
  assert.match(error.message, /underflow/);
});

test("a u16 length that runs past the body is an underflow", () => {
  // length says 8 bytes but only 2 are present
  const reader = new PacketReader(fromHex("08000061"));
  assert.throws(() => reader.readStringBytes(), PacketUnderflowError);
});

test("readOpcode is the body's first byte and refuses an empty body", () => {
  assert.equal(readOpcode(fromHex("0b00")), 0x0b);
  assert.throws(() => readOpcode(new Uint8Array(0)), PacketUnderflowError);
});

test("non-byte characters are rejected instead of silently mangled", () => {
  assert.throws(() => new PacketWriter().writeAsciiString("한"), RangeError);
});

test("login request decodes to the two strings the client wrote (opcode 0x01)", () => {
  // sub_4D0B20: byte 0x01, then sub_430230(&buf, id), sub_430230(&buf, pw)
  const body = fromHex("01050061646d696e040031323334"); // \x01 "admin" "1234"
  const packet = decodeClientPacket(body);
  assert.equal(packet.kind, "login-request");
  if (packet.kind !== "login-request") throw new Error("unreachable");
  assert.equal(packet.username, "admin");
  assert.equal(packet.password, "1234");
  assert.equal(toHex(encodeClientPacket(packet)), toHex(body));
});

test("world select, handshake reply and echo decode (0x02 / 0x04 / 0x08)", () => {
  const world = decodeClientPacket(fromHex("0203"));
  assert.deepEqual(world, { kind: "world-select", opcode: 0x02, worldId: 3 });

  const handshake = decodeClientPacket(fromHex("04efbeadde"));
  assert.deepEqual(handshake, { kind: "handshake-reply", opcode: 0x04, value: 0xdeadbeef });

  const echo = decodeClientPacket(fromHex("0878563412"));
  assert.deepEqual(echo, { kind: "echo", opcode: 0x08, value: 0x12345678 });
});

test("an unmapped opcode keeps its bytes instead of being dropped", () => {
  const packet = decodeClientPacket(fromHex("25aabbcc"));
  assert.equal(packet.kind, "unknown");
  if (packet.kind !== "unknown") throw new Error("unreachable");
  assert.equal(packet.opcode, 0x25);
  assert.equal(toHex(packet.body), "aabbcc");
  assert.equal(toHex(encodeClientPacket(packet)), "25aabbcc");
});
