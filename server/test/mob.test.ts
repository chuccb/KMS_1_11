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
  MOB_PRESENCE_KEEP,
  MOB_PRESENCE_REMOVE,
  describeMobAnim,
  describeMobEnterField,
  encodeMobAnim,
  encodeMobAppear,
  encodeMobEnterField,
  encodeMobLeaveDelayed,
  encodeMobRemove,
  encodeMobStat,
  readMobAnim,
  readMobEnterField,
  readMobLeaveDelayed,
  readMobPresence,
  readMobStat,
  type MobEnterField,
} from "../src/protocol/mob.ts";
import { FIELD_OPCODE, describeFieldPacket } from "../src/protocol/field.ts";

/** Offset of each field inside an encoded `0x2F`, opcode byte included. */
const AT = { opcode: 0, mobId: 1, templateId: 5, x: 9, y: 11, facing: 13, unknownA: 14, unknownB: 16, animFlags: 18, channels: 22 };

const NO_CHANNELS = AT.channels;

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
  const text = describeFieldPacket(bytes) ?? "";
  assert.match(text, /mobId=1/);
  assert.match(text, /template=120100/);
  assert.match(text, /facing=0/);
  assert.match(text, /animChannels=1/);
  assert.equal(text.includes("not decoded"), false, "0x2F is decoded now");
  assert.equal(FIELD_OPCODE.setField, 0x16, "0x2F is a CMobPool opcode inside the 0x2E-0x37 range");

  const truncated = describeFieldPacket(new Uint8Array([MOB_OPCODE.enterField, 1, 0, 0])) ?? "";
  assert.match(truncated, /truncated/, "a bad packet is reported, not thrown at the caller");
});

test("describeMobEnterField says what a log line needs", () => {
  assert.equal(
    describeMobEnterField({ ...MUSHROOM, facing: 3, channels: [{ index: 1, delay: 2 }] }),
    "mobId=1 template=120100 at (509,300) facing=1 animChannels=1",
  );
  assert.equal(describeMobEnterField(MUSHROOM), "mobId=1 template=120100 at (509,300) facing=0 animChannels=0");
});

// ---------------------------------------------------------------------------
// 0x30 / 0x31 / 0x34 - the packets that take a mob's HP away (FINDINGS 4.17)
// ---------------------------------------------------------------------------

/** Offset of each field inside an encoded `0x30`/`0x31`/`0x34`, opcode byte included. */
const AT_LEAVE = { opcode: 0, mobId: 1, delayMs: 5 };
const AT_PRESENCE = { opcode: 0, flag: 1, mobId: 2 };
const AT_STAT = { opcode: 0, mobId: 1, mp: 5 };

test("0x30 is mobId + a signed delay, and a negative delay survives the wire", () => {
  const bytes = encodeMobLeaveDelayed({ mobId: 0xfeedface, delayMs: -1 });
  assert.equal(MOB_OPCODE.leaveDelayed, 0x30);
  assert.equal(bytes.length, 7);
  assert.equal(bytes[AT_LEAVE.opcode], MOB_OPCODE.leaveDelayed);
  assert.equal(u32(bytes, AT_LEAVE.mobId), 0xfeedface);
  assert.equal(s16(bytes, AT_LEAVE.delayMs), -1, "negative = remove at once, not a u16");
  assert.deepEqual(readMobLeaveDelayed(new PacketReader(bytes, 1)), { mobId: 0xfeedface, delayMs: -1 });

  const zero = encodeMobLeaveDelayed({ mobId: 1, delayMs: 0 });
  assert.equal(s16(zero, AT_LEAVE.delayMs), 0, "0 = the die animation starts now");
  assert.deepEqual(readMobLeaveDelayed(new PacketReader(zero, 1)), { mobId: 1, delayMs: 0 });
});

test("0x31 flag=0 is the removal, flag=1 keeps the mob: same header, different tail", () => {
  const remove = encodeMobRemove(7);
  assert.equal(MOB_OPCODE.presence, 0x31);
  assert.equal(remove.length, 6, "a removal carries nothing but the id");
  assert.equal(remove[AT_PRESENCE.opcode], MOB_OPCODE.presence);
  assert.equal(remove[AT_PRESENCE.flag], MOB_PRESENCE_REMOVE);
  assert.equal(u32(remove, AT_PRESENCE.mobId), 7);
  assert.deepEqual(readMobPresence(new PacketReader(remove, 1)), { flag: 0, mobId: 7 });

  const appear = encodeMobAppear(9, 1210102, { x: -289, y: 1441, facing: 1 });
  assert.equal(appear[AT_PRESENCE.flag], MOB_PRESENCE_KEEP);
  assert.equal(u32(appear, AT_PRESENCE.mobId), 9);
  assert.equal(u32(appear, 6), 1210102, "the template id follows the id");
  assert.deepEqual(readMobPresence(new PacketReader(appear, 1)), { flag: 1, mobId: 9 });
});

test("0x31 flag=1 reuses the 0x2F body byte for byte after templateId", () => {
  // `sub_491630` reads a templateId and then calls the same `CMob::Init`, so the tails have to be
  // identical - this is the test that keeps the two encoders from drifting apart.
  const tail = { x: -289, y: 1441, facing: 1, unknownA: 5, unknownB: 6, channels: [{ index: 3, delay: 7 }] };
  const appear = encodeMobAppear(9, 1210102, tail);
  const enterWidth = encodeMobEnterField({ mobId: 9, templateId: 1210102, ...tail });
  assert.deepEqual(
    [...appear.slice(10)],
    [...enterWidth.slice(9)],
    "after the template id the bytes are the same 0x2F body",
  );
  const decoded = readMobEnterField(new PacketReader(enterWidth, 1));
  assert.equal(decoded.x, -289);
  assert.equal(decoded.y, 1441);
  assert.equal(decoded.channels?.[0]?.index, 3);
});

test("0x34 is mobId + the mob's MP, 7 bytes", () => {
  const bytes = encodeMobStat({ mobId: 0x01020304, mp: 2500 });
  assert.equal(MOB_OPCODE.stat, 0x34);
  assert.equal(bytes.length, 7);
  assert.equal(bytes[AT_STAT.opcode], MOB_OPCODE.stat);
  assert.equal(u32(bytes, AT_STAT.mobId), 0x01020304);
  assert.equal(u16(bytes, AT_STAT.mp), 2500);
  assert.deepEqual(readMobStat(new PacketReader(bytes, 1)), { mobId: 0x01020304, mp: 2500 });
  assert.equal(u16(encodeMobStat({ mobId: 1, mp: 0x1ffff }), AT_STAT.mp), 0xffff, "the wire is a u16");
});

test("the field dispatcher reads the three death packets back as text", () => {
  assert.equal(describeFieldPacket(encodeMobLeaveDelayed({ mobId: 4, delayMs: 0 })), "0x30 CMobPool: mobId=4 leave: the die animation starts in 0ms");
  assert.equal(describeFieldPacket(encodeMobLeaveDelayed({ mobId: 4, delayMs: -1 })), "0x30 CMobPool: mobId=4 leave: removed at once");
  assert.equal(describeFieldPacket(encodeMobRemove(4)), "0x31 CMobPool: mobId=4 presence=removed");
  const appear = encodeMobAppear(4, 120100, { x: 1, y: 2, facing: 0 });
  assert.equal(describeFieldPacket(appear), "0x31 CMobPool: mobId=4 presence=kept (created if unknown)");
  assert.equal(describeFieldPacket(encodeMobStat({ mobId: 4, mp: 200 })), "0x34 CMobPool: mobId=4 mp=200");
  assert.match(describeFieldPacket(new Uint8Array([MOB_OPCODE.stat, 1])) ?? "", /truncated/);
});

test("the 0x31 tail is only read for an id the pool does not have", () => {
  // The client returns before `CMob::Init` when it knows the id, which is why a plain `0x31 flag=1`
  // needs no body at all: only a respawn (whose corpse was already removed) carries the tail.
  const appear = encodeMobAppear(9, 0, { x: 0, y: 0, facing: 0 });
  assert.equal(appear.length, 23, "flag + id + templateId + the 13-byte Init body");
  const reader = new PacketReader(appear, 1);
  assert.deepEqual(readMobPresence(reader), { flag: 1, mobId: 9 });
  assert.equal(reader.remaining, 17, "templateId (4) + the Init body (13) are left for CMob::Init");
});

test("0x35 is the animation block on its own, after a mobId", () => {
  // sub_492380 case '5' -> sub_488E10 -> sub_4C6CE0(mob + 136, packet, now), the same decoder
  // CMob::Init uses for the tail of 0x2F - so the body is exactly that block.
  const channels = new Array(MOB_CHANNEL_COUNT).fill(undefined);
  channels[2] = { index: 10, delay: 4 };
  const bytes = encodeMobAnim({ mobId: 0x01020304, channels });
  assert.equal(MOB_OPCODE.anim, 0x35);
  assert.equal(bytes[0], 0x35);
  assert.equal(u32(bytes, 1), 0x01020304);
  assert.equal(u32(bytes, 5), 1 << 2, "only channel 2 is switched on");
  assert.deepEqual([s16(bytes, 9), s16(bytes, 11)], [10, 4]);
  assert.equal(bytes.length, 13);
  assert.deepEqual(readMobAnim(new PacketReader(bytes, 1)), { mobId: 0x01020304, channels });
});

test("0x35 with no channels is the id plus a zero flag word - i.e. \"switch every channel off\"", () => {
  const bytes = encodeMobAnim({ mobId: 7 });
  assert.deepEqual([...bytes], [0x35, 7, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(readMobAnim(new PacketReader(bytes, 1)), { mobId: 7 }, "no channels means the key is absent");
  assert.equal(describeMobAnim(readMobAnim(new PacketReader(bytes, 1))), "mobId=7 channels=none");
});

test("0x35 describes its channels without naming them", () => {
  const channels = new Array(MOB_CHANNEL_COUNT).fill(undefined);
  channels[0] = { index: 13, delay: 72 };
  channels[6] = { index: -1, delay: 0 };
  const text = describeMobAnim(readMobAnim(new PacketReader(encodeMobAnim({ mobId: 3, channels }), 1)));
  assert.equal(text, "mobId=3 channels=0=(13,72) 6=(-1,0)");
  assert.equal(
    describeFieldPacket(encodeMobAnim({ mobId: 3, channels })),
    "0x35 CMobPool(mob animation): mobId=3 channels=0=(13,72) 6=(-1,0)",
  );
  assert.match(describeFieldPacket(new Uint8Array([0x35, 1])) ?? "", /truncated/);
});

test("the 0x35 block is byte for byte the block a 0x2F carries", () => {
  const channels = new Array(MOB_CHANNEL_COUNT).fill(undefined);
  channels[1] = { index: 7, delay: 2 };
  channels[4] = { index: 9, delay: 0 };
  const anim = encodeMobAnim({ mobId: 1, channels });
  const enter = encodeMobEnterField({ mobId: 1, templateId: 5, x: 0, y: 0, facing: 0, channels });
  // The block starts at byte 5 of 0x35 (opcode + mobId) and at byte 18 of 0x2F (opcode, mobId,
  // templateId, x, y, facing, unknownA, unknownB); both then run to the end of the packet.
  assert.deepEqual([...anim.slice(5)], [...enter.slice(AT.animFlags)], "one decoder, one encoding");
});
