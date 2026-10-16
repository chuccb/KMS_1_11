import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FramingError,
  PacketReader,
  U16LengthDeframer,
  U16LengthFramer,
  fromHex,
  toHex,
} from "../src/protocol/frame.ts";

test("framer writes a u16 LE length that includes the header", () => {
  const framer = new U16LengthFramer();
  const wire = framer.encode(fromHex("aabbcc"));
  assert.equal(toHex(wire), "0500aabbcc"); // total = 2 header + 3 payload
});

test("framer rejects frames beyond the client receive buffer", () => {
  const framer = new U16LengthFramer();
  assert.throws(() => framer.encode(new Uint8Array(1459)), FramingError);
});

test("deframer yields complete frames and buffers a partial tail", () => {
  const deframer = new U16LengthDeframer();
  const framer = new U16LengthFramer();
  const a = framer.encode(fromHex("0102"));
  const b = framer.encode(fromHex("030405"));

  const first = deframer.push(new Uint8Array([...a, ...b.slice(0, 2)]));
  assert.equal(first.length, 1);
  assert.equal(toHex(first[0]!.payload), "0102");
  assert.equal(deframer.bufferedBytes, 2);

  const second = deframer.push(b.slice(2));
  assert.equal(second.length, 1);
  assert.equal(toHex(second[0]!.payload), "030405");
  assert.equal(deframer.bufferedBytes, 0);
});

test("deframer handles a frame split one byte at a time", () => {
  const wire = new U16LengthFramer().encode(fromHex("deadbeef"));
  const deframer = new U16LengthDeframer();
  const frames = [];
  for (const byte of wire) frames.push(...deframer.push(new Uint8Array([byte])));
  assert.equal(frames.length, 1);
  assert.equal(toHex(frames[0]!.payload), "deadbeef");
});

test("deframer rejects a declared length outside the client buffer", () => {
  const deframer = new U16LengthDeframer();
  // 0xFFFF declared -> above the 1460 receive buffer used by sub_43A410
  assert.throws(() => deframer.push(fromHex("ffff00")), FramingError);
});

test("deframer supports the length-excludes-header variant for experiments", () => {
  const deframer = new U16LengthDeframer({ lengthIncludesHeader: false });
  const frames = deframer.push(fromHex("0200aabb"));
  assert.equal(frames.length, 1);
  assert.equal(toHex(frames[0]!.payload), "aabb");
});

test("packet reader decodes little-endian integers", () => {
  const reader = new PacketReader(fromHex("ff" + "3412" + "78ff" + "ffffffff"));
  assert.equal(reader.u8(), 0xff);
  assert.equal(reader.u16(), 0x1234);
  assert.equal(reader.i16(), -136); // 0xff78
  assert.equal(reader.u32(), 0xffffffff);
  assert.equal(reader.remaining, 0);
});

test("packet reader throws instead of returning garbage when it runs out", () => {
  const reader = new PacketReader(fromHex("01"));
  assert.equal(reader.u8(), 1);
  assert.throws(() => reader.u16(), FramingError);
});

test("signed 32-bit values survive the reader", () => {
  assert.equal(new PacketReader(fromHex("ffffffff")).i32(), -1);
  assert.equal(new PacketReader(fromHex("00ffffff")).i32(), -256);
});
