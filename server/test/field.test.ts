/**
 * Golden bytes for the in-game (CField) packets: the user-enter-field record, the leave-field
 * record and the move path. Every expectation here is derived from the read order of the client's
 * own decoder (`sub_520680`, `sub_4953A0`), documented in FINDINGS 4.11 - if one of these fails,
 * the codec and the document disagree and both need a second look.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PacketReader } from "../src/protocol/packet.ts";
import { toHex } from "../src/protocol/frame.ts";
import { readMovePath, writeMovePath, pathStart, type MovePath } from "../src/protocol/movepath.ts";
import {
  FIELD_OPCODE,
  describeClientFieldPacket,
  encodeClientAttack,
  encodeClientInteract,
  readClientAttack,
  type ClientAttack,
  encodeClientUserMove,
  readClientInteract,
  readClientUserMove,
  describeFieldPacket,
  describeFieldOpcode,
  encodeSetField,
  encodeUserEnterField,
  encodeUserLeaveField,
  encodeUserMove,
  readSetField,
  readUserEnterField,
  readUserMove,
  writeUserEnterField,
  type UserEnterField,
} from "../src/protocol/field.ts";
import { PacketWriter } from "../src/protocol/packet.ts";
import { zeroStats, type CharacterData } from "../src/protocol/chardata.ts";

const samplePath: MovePath = {
  originX: -300,
  originY: 200,
  elements: [
    { attr: 0, x: 100, y: -50, vx: 1, vy: -2, action: 4, foothold: 7, duration: 120 },
    { attr: 1, x: -1, y: 2, vx: 0, vy: 0, action: 0, foothold: 0, duration: 300 },
  ],
};

test("move path is byte exact", () => {
  const writer = new PacketWriter(64);
  writeMovePath(writer, samplePath);
  assert.equal(
    toHex(writer.toBytes()),
    "d4fec80002" + "006400ceff0100feff0407007800" + "01ffff0200000000000000002c01",
  );
});

test("move path round trip keeps every field and its sign", () => {
  const writer = new PacketWriter(64);
  writeMovePath(writer, samplePath);
  const decoded = readMovePath(new PacketReader(writer.toBytes()));
  assert.deepEqual(decoded, samplePath);
  assert.deepEqual(pathStart(decoded), { x: 100, y: -50 });
});

test("an empty move path is legal and still writes its count", () => {
  const writer = new PacketWriter(8);
  writeMovePath(writer, { originX: 0, originY: 0, elements: [] });
  assert.equal(toHex(writer.toBytes()), "0000000000");
  assert.deepEqual(readMovePath(new PacketReader(writer.toBytes())).elements, []);
});

test("a truncated path is refused instead of half decoded", () => {
  const writer = new PacketWriter(64);
  writeMovePath(writer, samplePath);
  const bytes = writer.toBytes();
  assert.throws(() => readMovePath(new PacketReader(bytes.slice(0, bytes.length - 1))), /38|underflow/i);
});

test("more elements than a u8 can count is refused", () => {
  const elements = Array.from({ length: 256 }, () => ({
    attr: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    action: 0,
    foothold: 0,
    duration: 1,
  }));
  assert.throws(
    () => writeMovePath(new PacketWriter(8192), { originX: 0, originY: 0, elements }),
    /at most 255 elements/,
  );
});

const sampleUser: UserEnterField = {
  characterId: 1000,
  name: "Bob",
  unknown64: 1,
  avatarKey: 0x11223344,
  unknownA: 0,
  unknownB: 0,
  avatarItems: [1040000, 30000],
  x: 10,
  y: -20,
  action: 1,
  foothold: 3,
};

test("user enter field is byte exact (opcode, name string, avatar list, position)", () => {
  const bytes = encodeUserEnterField(sampleUser);
  assert.equal(
    toHex(bytes),
    "1c" +
      "e8030000" + // characterId 1000
      "0300426f62" + // "Bob" with its u16 length
      "01" + // unknown64
      "44332211" + // avatarKey
      "00000000" +
      "00000000" +
      "80de0f00" + // 1040000
      "30750000" + // 30000
      "00000000" + // avatar terminator
      "0a00" + // x
      "ecff" + // y (-20)
      "01" + // action
      "0300", // foothold
  );
});

test("user enter field round trips, including an empty avatar list", () => {
  const decoded = readUserEnterField(new PacketReader(encodeUserEnterField(sampleUser), 1));
  assert.deepEqual(decoded, sampleUser);
  const bare: UserEnterField = { ...sampleUser, avatarItems: [] };
  const written = new PacketWriter(64);
  writeUserEnterField(written, bare);
  assert.deepEqual(readUserEnterField(new PacketReader(written.toBytes())), bare);
});

test("user move is the id plus the path, byte exact and round-trippable", () => {
  const bytes = encodeUserMove({ characterId: 1000, path: samplePath });
  assert.equal(
    toHex(bytes),
    "22" + "e8030000" + "d4fec80002" + "006400ceff0100feff0407007800" + "01ffff0200000000000000002c01",
  );
  assert.deepEqual(readUserMove(new PacketReader(bytes, 1)), { characterId: 1000, path: samplePath });
});

test("leave field carries exactly the character id", () => {
  const bytes = encodeUserLeaveField(1000);
  assert.equal(toHex(bytes), "1de8030000");
});

test("set field carries mode, the three unknown words and a CharacterData", () => {
  const stats = zeroStats();
  stats.id = 1000;
  stats.name = "Bob";
  const character: CharacterData = { flags: 1, stats };
  const bytes = encodeSetField({ mode: 0, full: true, unknownA: 1, unknownB: 2, unknownC: 3, character });
  assert.equal(bytes[0], FIELD_OPCODE.setField);
  assert.equal(toHex(bytes.slice(0, 15)), "160001010000000200000003000000");
  const decoded = readSetField(new PacketReader(bytes, 1));
  // The character codec fills in the blocks a bare `flags` implies (FINDINGS 4.9), so compare the
  // parts this test owns instead of the whole record.
  assert.equal(decoded.character.flags, character.flags);
  assert.deepEqual(decoded.character.stats, stats);
  assert.equal(decoded.unknownC, 3);
});

test("the 0x16 form without CharacterData is refused, not mis-parsed", () => {
  assert.throws(() => readSetField(new PacketReader(Uint8Array.from([0, 0, 1, 2, 3]))), /not decoded yet/);
});

test("describeFieldPacket names the opcodes it can read and stays quiet about the rest", () => {
  assert.equal(
    describeFieldPacket(encodeUserMove({ characterId: 1000, path: samplePath })),
    "0x22 CUserPool: characterId=1000 elements=2 first=(100,-50) action=4 fh=7",
  );
  assert.match(describeFieldPacket(encodeUserEnterField(sampleUser)) ?? "", /name="Bob" avatar=2 items at \(10,-20\)/);
  assert.equal(describeFieldPacket(encodeUserLeaveField(1000)), "0x1d CUserPool: characterId=1000");
  assert.equal(describeFieldPacket(Uint8Array.from([0x2e, 1, 2])), "0x2e CMobPool (fields not decoded yet)");
  assert.equal(describeFieldPacket(Uint8Array.from([0x01])), undefined);
});

test("every opcode range of the CField router maps to its subsystem", () => {
  assert.equal(describeFieldOpcode(0x16), "0x16 CStage(set-field)");
  assert.equal(describeFieldOpcode(0x1c), "0x1c CUserPool");
  assert.equal(describeFieldOpcode(0x2d), "0x2d CUserPool");
  assert.equal(describeFieldOpcode(0x2e), "0x2e CMobPool");
  assert.equal(describeFieldOpcode(0x38), "0x38 CNpcPool");
  assert.equal(describeFieldOpcode(0x42), "0x42 CRewardPool");
  assert.equal(describeFieldOpcode(0x46), "0x46 CQuestMan");
  assert.equal(describeFieldOpcode(0x49), "0x49 field dialogs");
  assert.equal(describeFieldOpcode(0x4d), "0x4d CUIMessenger");
  assert.equal(describeFieldOpcode(0x50), "0x50 CMiniRoomBaseDlg");
});

test("the client's own move packet is the stage byte plus the same path (0x0E)", () => {
  const bytes = encodeClientUserMove({ stageByte: 7, path: samplePath });
  assert.equal(
    toHex(bytes),
    "0e07" + "d4fec80002" + "006400ceff0100feff0407007800" + "01ffff0200000000000000002c01",
  );
  assert.deepEqual(readClientUserMove(new PacketReader(bytes, 1)), { stageByte: 7, path: samplePath });
});

test("the portal/object click request is kind plus name (0x0D)", () => {
  const bytes = encodeClientInteract({ kind: -1, name: "west00" });
  assert.equal(toHex(bytes), "0dffffffff" + "0600776573743030");
  assert.deepEqual(readClientInteract(new PacketReader(bytes, 1)), { kind: -1, name: "west00" });
});

/**
 * The `0x0F` swing. Its bytes come straight from the writer in `sub_512F90` (FINDINGS 4.13.1):
 * header `u8 hits|count<<4`, `u32 clicked id`, `u8 facing<<7|action`, `u8 target cap`, then one
 * 11-byte record per target plus `hits` damage words. If this test fails, the codec and the
 * document disagree about the client's own byte order.
 */
test("attack (0x0F) is byte exact, header and per-target records", () => {
  const attack: ClientAttack = {
    hits: 3,
    targetCount: 1,
    clickedMobId: 0x30,
    facingLeft: true,
    action: 0x11,
    targetCap: 6,
    targets: [{ mobId: 0x10, hitAnimation: -1, x: 100, y: 200, sequence: 5, damages: [11, 12, 13] }],
  };
  const bytes = encodeClientAttack(attack);
  assert.equal(
    toHex(bytes),
    // 0f | 03|1<<4 | 30 00 00 00 | 80|11 | 06 | 10 00 00 00 | ff | 64 00 | c8 00 | 05 00 | 0b 00 0c 00 0d 00
    "0f13300000009106" + "10000000ff" + "6400c8000500" + "0b000c000d00",
  );
  const read = readClientAttack(new PacketReader(bytes, 1));
  assert.deepEqual(read, { ...attack, targetCount: 1 });
});

test("attack round trips several targets and keeps the signed hit animation", () => {
  const targets = [
    { mobId: 0x10, hitAnimation: -1, x: 0, y: 0, sequence: 0x1234, damages: [1] },
    { mobId: 0x11, hitAnimation: 0x7f, x: 0xffff, y: 0x8000, sequence: 0x1234, damages: [1] },
  ];
  const attack: ClientAttack = {
    hits: 1,
    targetCount: targets.length,
    clickedMobId: 0,
    facingLeft: false,
    action: 0x20,
    targetCap: 6,
    targets,
  };
  const read = readClientAttack(new PacketReader(encodeClientAttack(attack), 1));
  assert.deepEqual(read.targets, targets);
  assert.equal(read.targetCount, 2);
  assert.equal(read.targets[0]!.hitAnimation, -1); // not 0xff
});

test("an attack without a target is still a legal packet", () => {
  const bytes = encodeClientAttack({
    hits: 1,
    targetCount: 0,
    clickedMobId: 0,
    facingLeft: false,
    action: 0x20,
    targetCap: 6,
    targets: [],
  });
  assert.equal(toHex(bytes), "0f01000000002006");
  assert.equal(readClientAttack(new PacketReader(bytes, 1)).targets.length, 0);
});

test("a target must carry exactly hits damage values, and 15 targets is the cap", () => {
  const base = {
    hits: 2,
    targetCount: 1,
    clickedMobId: 0,
    facingLeft: false,
    action: 0x20,
    targetCap: 6,
  };
  assert.throws(
    () =>
      encodeClientAttack({
        ...base,
        targets: [{ mobId: 1, hitAnimation: 0, x: 0, y: 0, sequence: 0, damages: [1] }],
      }),
    /exactly 2 damage/,
  );
  const many = Array.from({ length: 16 }, (_, i) => ({
    mobId: i,
    hitAnimation: 0,
    x: 0,
    y: 0,
    sequence: 0,
    damages: [1, 2],
  }));
  assert.throws(() => encodeClientAttack({ ...base, targets: many }), /at most 15 targets/);
});

test("describeClientFieldPacket names the three client field packets and stays quiet otherwise", () => {
  const attack = encodeClientAttack({
    hits: 2,
    targetCount: 1,
    clickedMobId: 0x30,
    facingLeft: true,
    action: 0x11,
    targetCap: 6,
    targets: [{ mobId: 0x10, hitAnimation: -1, x: 100, y: 200, sequence: 5, damages: [11, 12] }],
  });
  const text = describeClientFieldPacket(attack)!;
  assert.match(text, /^0x0f attack: left action=17 hits=2 cap=6 clicked=48 targets=1 16@\(100,200\)\[11\+12\] anim=-1$/);
  assert.equal(describeClientFieldPacket(new Uint8Array([0x7f, 1, 2, 3])), undefined);
  assert.match(describeClientFieldPacket(new Uint8Array([0x0f, 0x41]))!, /^0x0f \(truncated: packet underflow/);
});

/**
 * The magic (`0x10`) and skill (`0x11`) attacks reuse `0x0F`'s header order and its 11-byte target
 * record - only two things differ, and both are visible here: `0x10` writes one extra `u16` right
 * after the header, and its high nibble is a "second object exists" flag (`sub_513C80` writes
 * `16 * (v129 != nullptr)`) rather than a count. If a capture ever shows a different record shape,
 * this test is the one that has to change.
 */
test("magic attack (0x10) is the same record plus one extra u16", () => {
  const attack: ClientAttack = {
    hits: 2,
    targetCount: 1,
    clickedMobId: 0x30,
    facingLeft: true,
    action: 0x11,
    targetCap: 6,
    unknownU16: 0x1234,
    targets: [{ mobId: 0x10, hitAnimation: -1, x: 100, y: 200, sequence: 5, damages: [11, 12] }],
  };
  const bytes = encodeClientAttack(attack, 0x10);
  assert.equal(toHex(bytes), "10123000000091063412" + "10000000ff6400c8000500" + "0b000c00");
  assert.deepEqual(readClientAttack(new PacketReader(bytes, 1), 0x10), attack);
  assert.match(describeClientFieldPacket(bytes)!, /^0x10 attack: left action=17 hits=2/);
});

test("skill attack (0x11) is the same record with no extra u16", () => {
  const attack: ClientAttack = {
    hits: 1,
    targetCount: 1,
    clickedMobId: 0x30,
    facingLeft: false,
    action: 0x20,
    targetCap: 6,
    targets: [{ mobId: 0x10, hitAnimation: 3, x: 100, y: 200, sequence: 5, damages: [9] }],
  };
  const bytes = encodeClientAttack(attack, 0x11);
  assert.equal(toHex(bytes), "1111300000002006" + "10000000036400c8000500" + "0900");
  assert.deepEqual(readClientAttack(new PacketReader(bytes, 1), 0x11), attack);
  assert.match(describeClientFieldPacket(bytes)!, /^0x11 attack: right action=32/);
});
