/**
 * `0x0D` - the stat diff. The point of these tests is the **wire widths** (several differ from
 * `CharacterData`, see the header of `src/protocol/stat.ts`) and the flag
 * order, so the golden vectors are written out by hand from the disassembly of `sub_45E0D0` rather
 * than derived from the table under test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  STAT_DIFF_FIELDS,
  STAT_OPCODE,
  describeStatUpdate,
  diffStats,
  encodeStatUpdate,
  readStatUpdate,
  statDiffFlag,
  statDiffFlags,
} from "../src/protocol/stat.ts";
import {
  characterDataOf,
  startingCharacterItems,
  zeroStats,
  type CharacterStats,
} from "../src/protocol/chardata.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

/** The fields of a record that a diff can carry, all different from `zeroStats()`. */
function wornRecord(): CharacterStats {
  const stats = zeroStats();
  stats.appearanceA = 0x01020304;
  stats.appearanceB = 0x0a0b0c0d;
  stats.unknown26 = 0x1a;
  stats.hair = 0x64;
  stats.level = 0x2a;
  stats.job = 0x1234;
  stats.str = 0x11;
  stats.dex = 0x22;
  stats.int = 0x33;
  stats.luk = 0x44;
  stats.hp = 0x0102;
  stats.maxHp = 0x0203;
  stats.mp = 0x0304;
  stats.maxMp = 0x0405;
  stats.ap = 0x0006;
  stats.sp = 0x0007;
  stats.exp = 0x01020304;
  stats.fame = 0xff;
  stats.mesos = 0x0a;
  return stats;
}

test("a two-field diff is byte for byte what the client reads", () => {
  // level is flag bit 4 (`0x10`), exp bit 16 (`0x10000`) -> flags 0x00010010.
  const body = encodeStatUpdate({ diff: { level: 2, exp: 5 } });
  assert.equal(hex(body), "0d 00 10 00 01 00 02 05 00 00 00 00 00 00 00");
  assert.equal(body[0], STAT_OPCODE);
  // The trailing `u32` is the temporary-stat duration word: 0 = the client returns immediately.
  assert.equal(body.length, 1 + 1 + 4 + 1 + 4 + 4);
});

test("every field is written in flag order, with the widths the diff reader uses", () => {
  const body = encodeStatUpdate({ diff: { ...wornRecord() } });
  // ack = 0, flags = 0x0007ffff (all 19 fields), then one field per bit from 0x01 upwards.
  assert.equal(
    hex(body),
    [
      "0d 00 ff ff 07 00",
      "04 03 02 01", // 0x00001 appearanceA  u32
      "0d 0c 0b 0a", // 0x00002 appearanceB  u32
      "1a 00 00 00", // 0x00004 unknown26    u32 on the wire (1 byte kept in memory)
      "64 00 00 00", // 0x00008 hair         u32
      "2a", //          0x00010 level        u8
      "34 12", //       0x00020 job          u16
      "11", //          0x00040 str          u8  - NOT the u16 CharacterData uses
      "22", //          0x00080 dex          u8
      "33", //          0x00100 int          u8
      "44", //          0x00200 luk          u8
      "02 01", //       0x00400 hp           u16
      "03 02", //       0x00800 maxHp        u16
      "04 03", //       0x01000 mp           u16
      "05 04", //       0x02000 maxMp        u16
      "06 00", //       0x04000 ap           u16
      "07 00", //       0x08000 sp           s16
      "04 03 02 01", // 0x10000 exp          u32
      "ff 00 00 00", // 0x20000 fame         u32 on the wire (2 bytes kept in memory)
      "0a 00 00 00", // 0x40000 mesos        u32
      "00 00 00 00", // durationMs
    ].join(" "),
  );
  // 1 opcode + 1 ack + 4 flags + 47 field bytes + 4 panel flags.
  assert.equal(body.length, 57);
});

test("the flag bits are the reader's order, checked one field at a time", () => {
  assert.equal(statDiffFlag("appearanceA"), 0x01);
  assert.equal(statDiffFlag("unknown26"), 0x04);
  assert.equal(statDiffFlag("level"), 0x10);
  assert.equal(statDiffFlag("job"), 0x20);
  assert.equal(statDiffFlag("str"), 0x40);
  assert.equal(statDiffFlag("hp"), 0x400);
  assert.equal(statDiffFlag("sp"), 0x8000);
  assert.equal(statDiffFlag("exp"), 0x10000);
  assert.equal(statDiffFlag("fame"), 0x20000);
  assert.equal(statDiffFlag("mesos"), 0x40000);
  assert.equal(statDiffFlags({}), 0);
  assert.equal(statDiffFlags({ level: 1, hp: 2 }), 0x410);
  // 19 bits, no more: 0x7ffff is the highest flags word this codec can ever build.
  assert.equal(STAT_DIFF_FIELDS.length, 19);
  assert.equal(statDiffFlags({ ...wornRecord() }), 0x7ffff);
});

test("a diff round-trips through the reader", () => {
  const diff = { exp: 1234, level: 12, hp: 40, sp: -3, unknown26: 7 };
  const body = encodeStatUpdate({ diff });
  const back = readStatUpdate(new PacketReader(body, 1));
  assert.deepEqual(back, { ack: false, diff });
  assert.ok(back.ack === false);
});

test("the ack byte is on the wire because the client reads it", () => {
  const body = encodeStatUpdate({ ack: true, diff: { level: 3 } });
  assert.equal(body[1], 1);
  assert.equal(readStatUpdate(new PacketReader(body, 1)).ack, true);
  assert.equal(
    encodeStatUpdate({ diff: { level: 3 } })[1],
    0,
    "default is 0: a stat update answers nothing",
  );
});

test("describe names every field it found", () => {
  assert.equal(describeStatUpdate({ diff: { level: 2, exp: 5 } }), "ack=0 level=2 exp=5");
  assert.equal(describeStatUpdate({ ack: true, diff: {} }), "ack=1 (no fields)");
});

test("wide 0x0D slots cannot exceed the narrower CharacterData storage", () => {
  const unknown26 = encodeStatUpdate({ diff: { unknown26: 0xff } });
  assert.equal(hex(unknown26.slice(6, 10)), "ff 00 00 00", "unknown26 remains a u32 on the wire");
  assert.deepEqual(readStatUpdate(new PacketReader(unknown26, 1)).diff, { unknown26: 0xff });
  assert.throws(
    () => encodeStatUpdate({ diff: { unknown26: 0x100 } }),
    /unknown26.*u8\) cannot hold 256.*retains only u8 from this u32 diff field/s,
  );

  const fame = encodeStatUpdate({ diff: { fame: 0xffff } });
  assert.equal(hex(fame.slice(6, 10)), "ff ff 00 00", "fame remains a u32 on the wire");
  assert.throws(
    () => encodeStatUpdate({ diff: { fame: 0x10000 } }),
    /fame.*u16\) cannot hold 65536.*retains only u16 from this u32 diff field/s,
  );
});

test("values that do not fit the client's reader are refused, not truncated", () => {
  // The sharp edge: `str` is ONE byte in this packet while the record holds it in a u16 pair.
  assert.throws(
    () => encodeStatUpdate({ diff: { str: 0x100 } }),
    /u8\) cannot hold 256.*FINDINGS 4\.21\.1/s,
  );
  assert.throws(() => encodeStatUpdate({ diff: { level: 0x100 } }), RangeError);
  assert.throws(() => encodeStatUpdate({ diff: { hp: 0x10000 } }), RangeError);
  assert.throws(() => encodeStatUpdate({ diff: { exp: 0x100000000 } }), RangeError);
  assert.throws(() => encodeStatUpdate({ diff: { level: -1 } }), RangeError);
  assert.throws(() => encodeStatUpdate({ diff: { exp: 1.5 } }), /not an integer/);
  // `sp` is the one signed field (`sub_45DD80`), so its own limits apply.
  assert.throws(() => encodeStatUpdate({ diff: { sp: 0x8000 } }), /s16\) cannot hold 32768/);
  assert.equal(
    readStatUpdate(new PacketReader(encodeStatUpdate({ diff: { sp: -1 } }), 1)).diff.sp,
    -1,
  );
});

test("a nonzero duration requires a complete temporary-stat tail", () => {
  const body = encodeStatUpdate({ diff: { level: 1 } });
  body[body.length - 4] = 1; // durationMs = 1, NOT effect mask = 1
  assert.throws(() => readStatUpdate(new PacketReader(body, 1)));
});

test("diffStats reports exactly the fields that changed", () => {
  const before = zeroStats();
  const after = { ...before, exp: 15, level: 2, hp: 50 };
  assert.deepEqual(diffStats(before, after), { level: 2, hp: 50, exp: 15 });
  assert.deepEqual(diffStats(before, { ...before }), {});
  // The five fields the client never reads in this packet are not in the diff, even when they differ.
  const moved = { ...before, mapId: 12345, id: 9, name: "x", gender: 1, spawnPortalIndex: 3 };
  assert.deepEqual(diffStats(before, moved), {});
});

test("the diff and CharacterData agree on which fields exist", () => {
  const record = characterDataOf(wornRecord(), startingCharacterItems());
  const all = new Set(Object.keys(record.stats));
  const carried = new Set(STAT_DIFF_FIELDS.map((field) => field.name as string));
  for (const name of carried) assert.ok(all.has(name), `${name} is not a field of CharacterStats`);
  // Everything else is either the identity or only ever travels inside CharacterData (FINDINGS 4.21.1).
  assert.deepEqual([...all].filter((name) => !carried.has(name)).sort(), [
    "gender",
    "id",
    "mapId",
    "name",
    "spawnPortalIndex",
  ]);
});
