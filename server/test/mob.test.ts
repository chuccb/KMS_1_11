/**
 * `0x2F` (mob enter field) - the packet that decides whether a monster is on screen.
 *
 * The layout comes from `sub_4924A0` + `CMob::Init` (`sub_484ED0`), see `src/protocol/mob.ts` and
 * FINDINGS 4.15. Byte offsets are asserted directly, not just through the round-trip, because the
 * encoding is the contract with a 2003 client we cannot ask - a round-trip test agrees with itself
 * even when the field order is wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PacketReader, PacketUnderflowError } from "../src/protocol/packet.ts";
import {
  MOB_CHANNEL_COUNT,
  MOB_OPCODE,
  describeMobEnterField,
  encodeMobEnterField,
  readMobEnterField,
  type MobEnterField,
} from "../src/protocol/mob.ts";
import { FIELD_OPCODE, describeFieldPacket } from "../src/protocol/field.ts";

/** Offset of each field inside an encoded `0x2F`, opcode byte included. */
const AT = { opcode: 0, mobId: 1, templateId: 5, x: 9, y: 11, facing: 13, unknownA: 14, unknownB: 16, animFlags: 18, channels: 22 };

const NO_CHANNELS = AT.channels;
const WITH_ONE_CHANNEL = AT.channels + 4;

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function s16(bytes: Uint8Array, offset: number): number {
  return (u16(bytes, offset) << 16) >> 16;
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) + bytes[offset + 3]! * 0x1000000) >>> 0;
}

/** The mob the WZ `life` list of `001000000.img` spawns first (`Mob/0120100.img`). */
const MUSHROOM: MobEnterField = { mobId: 1, templateId: 120100, x: 509, y: 300, facing: 0 };

test("0x2F encodes the field order from CMob::Init, opcode byte first", () => {
  const bytes = encodeMobEnterField({ ...MUSHROOM, unknownA: 0x1234, unknownB: 0x5678 });
  assert.equal(bytes.length, NO_CHANNELS, "no channels means a 22-byte packet");
  assert.equal(bytes[AT.opcode], MOB_OPCODE.enterField);
  assert.equal(MOB_OPCODE.enterField, 0x2f);
  assert.equal(u32(bytes, AT.mobId), 1);
  assert.equal(u32(bytes, AT.templateId), 120100);
  assert.equal(s16(bytes, AT.x), 509);
  assert.equal(s16(bytes, AT.y), 300);
  assert.equal(bytes[AT.facing], 0);
  assert.equal(u16(bytes, AT.unknownA), 0x1234);
  assert.equal(u16(bytes, AT.unknownB), 0x5678);
  assert.equal(u32(bytes, AT.animFlags), 0, "no channels set none of the flag bits");
});

test("0x2F round-trips, including negative coordinates and the channel block", () => {
  const body: MobEnterField = {
    mobId: 0xdeadbeef,
    templateId: 1210102,
    x: -289,
    y: 1441,
    facing: 1,
    unknownA: 5,
    unknownB: 6,
    channels: [{ index: 3, delay: 7 }, undefined, { index: -1, delay: 0 }],
  };
  const bytes = encodeMobEnterField(body);
  assert.equal(bytes.length, NO_CHANNELS + 2 * 4, "two set channels add 4 bytes each");
  const decoded = readMobEnterField(new PacketReader(bytes, 1));
  assert.equal(decoded.mobId, body.mobId);
  assert.equal(decoded.templateId, body.templateId);
  assert.equal(decoded.facing, body.facing);
  assert.equal(decoded.unknownA, 5);
  assert.equal(decoded.unknownB, 6);
  assert.equal(decoded.x, -289, "x is signed, not a masked u16");
  assert.equal(decoded.y, 1441);
  assert.deepEqual(
    decoded.channels,
    [{ index: 3, delay: 7 }, undefined, { index: -1, delay: 0 }].concat(new Array(4).fill(undefined)),
    "a check-width dense array, gaps included",
  );
});

test("channel index i is flag bit 1 << i, and gaps leave their bit clear", () => {
  const channels = new Array(MOB_CHANNEL_COUNT).fill(undefined);
  channels[0] = { index: 1, delay: 2 };
  channels[3] = { index: 4, delay: 5 };
  channels[6] = { index: 6, delay: 7 };
  const bytes = encodeMobEnterField({ ...MUSHROOM, channels });
  assert.equal(u32(bytes, AT.animFlags), 0b1001001, "bits 0, 3 and 6");
  assert.equal(bytes.length, NO_CHANNELS + 3 * 4, "the flag word carries no data of its own");
  // The index/delay pairs follow in bit order, so bit 0 comes first and bit 6 last.
  assert.deepEqual(
    [0, 1, 2].map((n) => [s16(bytes, AT.channels + n * 4), s16(bytes, AT.channels + n * 4 + 2)]),
    [[1, 2], [4, 5], [6, 7]],
  );
  const decoded = readMobEnterField(new PacketReader(bytes, 1));
  assert.deepEqual(decoded.channels, channels, "an undefined entry stays undefined");
  assert.equal(decoded.channels?.length, MOB_CHANNEL_COUNT, "dense, so gaps cannot be skipped");
});

test("channel bits 7 and up do not exist: extra channels are dropped, not shifted", () => {
  const channels = new Array(MOB_CHANNEL_COUNT + 3).fill(undefined);
  channels[MOB_CHANNEL_COUNT] = { index: 9, delay: 9 };
  const bytes = encodeMobEnterField({ ...MUSHROOM, channels });
  assert.equal(u32(bytes, AT.animFlags), 0, "bit 7 would be an opcode the client does not read");
  assert.equal(bytes.length, NO_CHANNELS);
});

test("0x2F defaults: unknownA/B and the channel block are zero, facing keeps only bit 0", () => {
  const bytes = encodeMobEnterField({ ...MUSHROOM, facing: 0xff });
  assert.equal(bytes.length, NO_CHANNELS);
  assert.equal(u16(bytes, AT.unknownA), 0, "a ZMap lookup miss is handled, so 0 is legal");
  assert.equal(u16(bytes, AT.unknownB), 0);
  assert.equal(u32(bytes, AT.animFlags), 0);
  const decoded = readMobEnterField(new PacketReader(bytes, 1));
  assert.equal(decoded.facing, 0xff, "the wire keeps the byte; only the client masks bit 0");
  assert.equal(decoded.channels, undefined, "no channels means the property is absent, not empty");
});

test("a truncated 0x2F throws instead of decoding a mob somewhere it is not", () => {
  const full = encodeMobEnterField({ ...MUSHROOM, channels: [{ index: 1, delay: 2 }] });
  for (let cut = 0; cut < full.length - 1; cut++) {
    const short = full.slice(0, full.length - 1 - cut);
    assert.throws(
      () => readMobEnterField(new PacketReader(short, 1)),
      PacketUnderflowError,
      `a ${short.length}-byte packet must not decode`,
    );
  }
  const reader = new PacketReader(full, 1);
  const exactly = readMobEnterField(reader);
  assert.equal(exactly.channels?.[0]?.index, 1);
  assert.equal(reader.remaining, 0, "the full packet is consumed exactly");
});

test("the field dispatcher describes 0x2F instead of calling it undecoded", () => {
  const bytes = encodeMobEnterField({ ...MUSHROOM, channels: [{ index: 1, delay: 2 }] });
  const text = describeFieldPacket(bytes);
  assert.match(text, /mobId=1/);
  assert.match(text, /template=120100/);
  assert.match(text, /facing=0/);
  assert.match(text, /animChannels=1/);
  assert.equal(text.includes("not decoded"), false, "0x2F is decoded now");
  assert.equal(FIELD_OPCODE.setField, 0x16, "0x2F is a CMobPool opcode inside the 0x2E-0x37 range");

  const truncated = describeFieldPacket(new Uint8Array([MOB_OPCODE.enterField, 1, 0, 0]));
  assert.match(truncated, /truncated/, "a bad packet is reported, not thrown at the caller");
});

test("describeMobEnterField says what a log line needs", () => {
  assert.equal(
    describeMobEnterField({ ...MUSHROOM, facing: 3, channels: [{ index: 1, delay: 2 }] }),
    "mobId=1 template=120100 at (509,300) facing=1 animChannels=1",
  );
  assert.equal(describeMobEnterField(MUSHROOM), "mobId=1 template=120100 at (509,300) facing=0 animChannels=0");
});
