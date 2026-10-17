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
  ATTACK_RELAY_OPCODE,
  FIELD_OPCODE,
  USER_EFFECT_LEVEL_UP,
  USER_MESSAGE_CHAT,
  describeClientChat,
  describeClientFieldPacket,
  describeUserChat,
  CLIENT_FIELD_OPCODE,
  encodeClientAttack,
  encodeClientChat,
  encodeClientInteract,
  encodeUserChat,
  encodeUserEffect,
  readClientChat,
  readUserChat,
  readUserEffect,
  describeUserEffect,
  encodeClientMobAttack,
  readClientAttack,
  readClientMobAttack,
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
  USER_MESSAGE_FIND_ANSWER,
  USER_MESSAGE_WHISPER_ANSWER,
  USER_REQUEST_KIND,
  describeClientUserRequest,
  describeUserFindAnswer,
  describeUserWhisperAnswer,
  encodeClientUserRequest,
  encodeUserFindAnswer,
  encodeUserWhisperAnswer,
  readClientUserRequest,
  readUserFindAnswer,
  readUserWhisperAnswer,
  encodeClientStatReport,
  readClientStatReport,
  encodeClientUseItem,
  readClientUseItem,
  describeClientUseItem,
  USE_ITEM_OPCODES,
  EMOTION_NAMES,
  EMOTION_MAX,
  EMOTION_NEUTRAL,
  EMOTION_HIT,
  emotionName,
  encodeClientEmotion,
  readClientEmotion,
  describeClientEmotion,
  encodeUserEmotion,
  readUserEmotion,
  describeUserEmotion,
  encodeUserAttack,
  encodeClientChangeSlot,
  readClientChangeSlot,
  describeClientChangeSlot,
  encodeUserLook,
  readUserLook,
  describeUserLook,
  LOOK_FLAG,
  readUserAttack,
  describeUserAttack,
  type UserAttack,
  describeClientStatReport,
  type UserEnterField,
} from "../src/protocol/field.ts";
import { PacketWriter } from "../src/protocol/packet.ts";
import { zeroStats, type CharacterData } from "../src/protocol/chardata.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";

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
  face: 0x11223344,
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
      "44332211" + // face (the drawn face id; 0x11223344 is deliberate nonsense)
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
  const bytes = encodeSetField({ mode: 0, full: true, randomSeedA: 1, randomSeedB: 2, randomSeedC: 3, character });
  assert.equal(bytes[0], FIELD_OPCODE.setField);
  assert.equal(toHex(bytes.slice(0, 15)), "160001010000000200000003000000");
  const decoded = readSetField(new PacketReader(bytes, 1));
  // The character codec fills in the blocks a bare `flags` implies (FINDINGS 4.9), so compare the
  // parts this test owns instead of the whole record.
  assert.equal(decoded.character.flags, character.flags);
  assert.deepEqual(decoded.character.stats, stats);
  assert.equal(decoded.randomSeedC, 3);
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
  // `0x01` is not a field opcode at all; the two app-level ones below the range are.
  assert.equal(describeFieldPacket(Uint8Array.from([0x01])), undefined);
  assert.equal(describeFieldPacket(Uint8Array.from([0x0c])), undefined);
});

test("every opcode range of the CField router maps to its subsystem", () => {
  assert.equal(describeFieldOpcode(0x16), "0x16 CStage(set-field)");
  assert.equal(describeFieldOpcode(0x1c), "0x1c CUserPool");
  assert.equal(describeFieldOpcode(0x2d), "0x2d CUserPool");
  assert.equal(describeFieldOpcode(0x2e), "0x2e CMobPool");
  assert.equal(describeFieldOpcode(0x38), "0x38 CNpcPool(no handler)");
  assert.equal(describeFieldOpcode(0x39), "0x39 CNpcPool(npc appear)");
  assert.equal(describeFieldOpcode(0x3a), "0x3a CNpcPool(npc leave)");
  assert.equal(describeFieldOpcode(0x3b), "0x3b CNpcPool(npc walk)");
  assert.equal(describeFieldOpcode(0x3c), "0x3c CNpcPool(id only)");
  assert.equal(describeFieldOpcode(0x3d), "0x3d CNpcPool(action + move path)");
  assert.equal(describeFieldOpcode(0x3e), "0x3e CNpcPool(id only)");
  assert.equal(describeFieldOpcode(0x40), "0x40 CNpcPool(id only)");
  assert.equal(describeFieldOpcode(0x41), "0x41 CNpcPool(no handler)");
  assert.equal(describeFieldOpcode(0x42), "0x42 CRewardPool(no handler)");
  assert.equal(describeFieldOpcode(0x43), "0x43 CRewardPool(drop appear)");
  assert.equal(describeFieldOpcode(0x44), "0x44 CRewardPool(drop gone)");
  assert.equal(describeFieldOpcode(0x45), "0x45 CRewardPool(no handler)");
  assert.equal(describeFieldOpcode(0x46), "0x46 CQuestMan(no handler)");
  assert.equal(describeFieldOpcode(0x47), "0x47 CQuestMan(npc dialog)");
  assert.equal(describeFieldOpcode(0x48), "0x48 CQuestMan(no handler)");
  assert.equal(describeFieldOpcode(0x49), "0x49 field dialogs(no handler)");
  assert.equal(describeFieldOpcode(0x4a), "0x4a CShopDlg(open)");
  assert.equal(describeFieldOpcode(0x4b), "0x4b CShopDlg(result)");
  assert.equal(describeFieldOpcode(0x4c), "0x4c field dialogs(no handler)");
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
 * header `u8 hits|count<<4`, `u32 clicked id`, `u8 facing<<7|action`, `u8 speed` (the step the
 * sender hands its own `sub_508690` - FINDINGS 4.13.1c), then one 11-byte record per target plus
 * `hits` damage words. If this test fails, the codec and the document disagree about the client's
 * own byte order.
 */
test("attack (0x0F) is byte exact, header and per-target records", () => {
  const attack: ClientAttack = {
    hits: 3,
    targetCount: 1,
    skillId: 0x30,
    facingLeft: true,
    action: 0x11,
    speed: 6,
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
    skillId: 0,
    facingLeft: false,
    action: 0x20,
    speed: 6,
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
    skillId: 0,
    facingLeft: false,
    action: 0x20,
    speed: 6,
    targets: [],
  });
  assert.equal(toHex(bytes), "0f01000000002006");
  assert.equal(readClientAttack(new PacketReader(bytes, 1)).targets.length, 0);
});

test("a target must carry exactly hits damage values, and 15 targets is the cap", () => {
  const base = {
    hits: 2,
    targetCount: 1,
    skillId: 0,
    facingLeft: false,
    action: 0x20,
    speed: 6,
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
    skillId: 0x30,
    facingLeft: true,
    action: 0x11,
    speed: 6,
    targets: [{ mobId: 0x10, hitAnimation: -1, x: 100, y: 200, sequence: 5, damages: [11, 12] }],
  });
  const text = describeClientFieldPacket(attack)!;
  assert.match(text, /^0x0f attack: left action=17 hits=2 speed=6 skill=48 targets=1 16@\(100,200\)\[11\+12\] anim=-1$/);
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
    skillId: 0x30,
    facingLeft: true,
    action: 0x11,
    speed: 6,
    projectileSlot: 0x1234,
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
    skillId: 0x30,
    facingLeft: false,
    action: 0x20,
    speed: 6,
    targets: [{ mobId: 0x10, hitAnimation: 3, x: 100, y: 200, sequence: 5, damages: [9] }],
  };
  const bytes = encodeClientAttack(attack, 0x11);
  assert.equal(toHex(bytes), "1111300000002006" + "10000000036400c8000500" + "0900");
  assert.deepEqual(readClientAttack(new PacketReader(bytes, 1), 0x11), attack);
  assert.match(describeClientFieldPacket(bytes)!, /^0x11 attack: right action=32/);
});

test("mob attack (0x2c): the mob's own action, as the client reports it", () => {
  // The action byte is the same encoding 0x33 uses, and attack1 is action 10 - which is exactly what
  // the picker hands over: `*p_n13 = v46[..] + 10` (FINDINGS 4.20).
  const attack = {
    mobId: 0x01020304,
    flags: 0x11,
    actionByte: (10 << 1) | 1,
    positionX: -5,
    positionY: 300,
    tail: new Uint8Array([1, 2, 3]),
  };
  const bytes = encodeClientMobAttack(attack);
  assert.equal(CLIENT_FIELD_OPCODE.mobAttack, 0x2c);
  assert.equal(CLIENT_FIELD_OPCODE.attack, 0x0f, "0x0f is the player's swing, 0x2c is the mob's");
  // opcode | mobId | flags | (attack1<<1)|left | x=-5 y=300 packed as x|y<<16 | tail
  assert.equal(toHex(bytes), "2c" + "04030201" + "11" + "15" + "fbff2c01" + "010203");
  assert.deepEqual(readClientMobAttack(new PacketReader(bytes, 1)), {
    ...attack,
    action: 10,
    facing: 1,
    hasPosition: true,
  });
});

test("mob attack (0x2c) without a position, and the 0xff reset form", () => {
  const bytes = encodeClientMobAttack({
    mobId: 7,
    flags: 0x10,
    actionByte: (13 << 1) | 0,
    positionX: 0,
    positionY: 0,
    tail: new Uint8Array(0),
  });
  assert.equal(toHex(bytes), "2c07000000101a00000000");
  const back = readClientMobAttack(new PacketReader(bytes, 1));
  assert.equal(back.hasPosition, false);
  assert.equal(back.action, 13);
  assert.equal(back.tail.length, 0);
  assert.equal("action" in back, true);

  // `sub_4885D0(mob, -1, 0, 0, 0)` writes the signed byte straight through, so 0xFF is "reset".
  const reset = readClientMobAttack(new PacketReader(encodeClientMobAttack({
    mobId: 7, flags: 0, actionByte: 0xff, positionX: 0, positionY: 0, tail: new Uint8Array(0),
  }), 1));
  assert.equal(reset.action, undefined);
  assert.equal("action" in reset, false, "no undefined key, so JSON and deepEqual stay honest");
});

test("the mob-attack describer names the action and says how much it did not read", () => {
  const bytes = encodeClientMobAttack({
    mobId: 42, flags: 0x11, actionByte: (0 << 1) | 1, positionX: -1, positionY: 2,
    tail: new Uint8Array([9, 9]),
  });
  assert.equal(
    describeClientFieldPacket(bytes),
    "0x2c mob attack: mobId=42 move,left flags=0x11 at (-1,2) tail=2B",
  );
  const noPosition = encodeClientMobAttack({
    mobId: 42, flags: 1, actionByte: 10 << 1, positionX: 0, positionY: 0, tail: new Uint8Array(0),
  });
  assert.equal(describeClientFieldPacket(noPosition), "0x2c mob attack: mobId=42 attack1,right flags=0x1 tail=0B");
  assert.match(describeClientFieldPacket(new Uint8Array([0x2c, 1]))!, /truncated/);
});

test("chat: 0x12 out is one string, 0x1a back is the speaker's name and the same bytes", () => {
  // What the client sends (`sub_470C70`, FINDINGS 4.13): the opcode and one string, nothing else.
  const said = encodeClientChat({ text: encodeCp949("안녕") });
  assert.equal(CLIENT_FIELD_OPCODE.chat, 0x12);
  assert.equal(toHex(said), "12" + "0400" + "bec8b3e7");
  assert.deepEqual(readClientChat(new PacketReader(said, 1)), { text: Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7]) });
  assert.equal(describeClientChat(readClientChat(new PacketReader(said, 1))), "0x12 chat: 안녕");
  assert.equal(describeClientFieldPacket(said), "0x12 chat: 안녕");

  // What the field sends (`sub_472910`'s jump table case 0x12): the sub-op, then the name and the
  // text as two strings - the name first, because the client formats them as "%s>> %s".
  const line = encodeUserChat({ name: "Hero", text: encodeCp949("안녕") });
  assert.equal(FIELD_OPCODE.userMessage, 0x1a);
  assert.equal(USER_MESSAGE_CHAT, 0x12);
  assert.equal(toHex(line), "1a12" + "0400" + "4865726f" + "0400" + "bec8b3e7");
  assert.deepEqual(readUserChat(new PacketReader(line, 1)), {
    name: "Hero",
    text: Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7]),
  });
  assert.equal(describeUserChat(readUserChat(new PacketReader(line, 1))), 'chat "Hero": 안녕');
  assert.equal(describeFieldOpcode(0x1a), "0x1a CField(user message)");
  assert.equal(describeFieldPacket(line), '0x1a CField(user message): chat "Hero": 안녕');
});

test("0x1a's other sub-ops are refused instead of read as chat", () => {
  // `sub_472910` has four cases, all of them two-strings-or-fewer display messages, and only 0x12 is
  // chat. 0x22 is the whisper refusal: one name, and the client's line is "'name' refuses whispers".
  const refusal = Uint8Array.from([0x1a, 0x22, 0x03, 0x00, 0x41, 0x42, 0x43]);
  assert.throws(() => readUserChat(new PacketReader(refusal, 1)), /sub-op 0x22 is not chat \(0x12\)/);
  assert.match(describeFieldPacket(refusal)!, /^0x1a CField\(user message\): \(unreadable: .*not chat/);
  // A chat packet that runs out mid-string is still an error, not a short line.
  assert.throws(() => readUserChat(new PacketReader(Uint8Array.from([0x1a, 0x12, 0x04, 0x00, 0x41]), 1)));
});

test("0x23: the kind byte picks find (0x05) from whisper (0x06), then name-before-text", () => {
  // `sub_4717D0` writes `(v6 + 1) | 4` where v6 is "the text is non-empty" (`.text:00471859`), then
  // its 3rd argument (the name at the `/귓속말` call site - the one `sub_524A00` validates) and
  // finally its 2nd (the text).
  assert.equal(CLIENT_FIELD_OPCODE.userRequest, 0x23);
  assert.equal(USER_REQUEST_KIND.find, 0x05);
  assert.equal(USER_REQUEST_KIND.whisper, 0x06);
  assert.equal(USER_REQUEST_KIND.balloon, 0x22);

  const find = encodeClientUserRequest({ kind: USER_REQUEST_KIND.find, name: "Alt" });
  assert.equal(toHex(find), "23" + "05" + "0300" + "416c74");
  assert.deepEqual(readClientUserRequest(new PacketReader(find, 1)), {
    kind: USER_REQUEST_KIND.find,
    name: "Alt",
  });
  assert.equal(describeClientUserRequest(readClientUserRequest(new PacketReader(find, 1))), '0x23 find "Alt"');
  assert.equal(describeClientFieldPacket(find), '0x23 find "Alt"');

  const whisper = encodeClientUserRequest({
    kind: USER_REQUEST_KIND.whisper,
    name: "Alt",
    text: encodeCp949("안녕"),
  });
  assert.equal(toHex(whisper), "23" + "06" + "0300" + "416c74" + "0400" + "bec8b3e7");
  assert.deepEqual(readClientUserRequest(new PacketReader(whisper, 1)), {
    kind: USER_REQUEST_KIND.whisper,
    name: "Alt",
    text: Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7]),
  });
  assert.equal(
    describeClientUserRequest(readClientUserRequest(new PacketReader(whisper, 1))),
    '0x23 whisper "Alt": 안녕',
  );

  // The client's own balloon request is the third kind (`0x20 | 2`), and it is read like a whisper -
  // only the server's answer differs, and there is none yet (FINDINGS 4.31).
  const balloon = encodeClientUserRequest({
    kind: USER_REQUEST_KIND.balloon,
    name: "Hero",
    text: Uint8Array.from([0x68, 0x69]),
  });
  assert.equal(toHex(balloon), "23" + "22" + "0400" + "4865726f" + "0200" + "6869");
  assert.equal(
    describeClientUserRequest(readClientUserRequest(new PacketReader(balloon, 1))),
    '0x23 balloon "Hero": hi',
  );

  // A kind nobody has a body for is refused, not half-read: 0x04 alone is the whisper family with
  // neither bit set, i.e. a text-less whisper, which the client cannot build.
  assert.throws(
    () => readClientUserRequest(new PacketReader(Uint8Array.from([0x23, 0x04, 0x01, 0x00, 0x41]), 1)),
    /0x23 kind 0x4 is not a user request/,
  );
});

test("the two 0x1a answers: a map id for a find, one flag byte for a whisper", () => {
  // `sub_472910` case 0x09: `string name` + `u32 mapId`; `0xFFFFFFFF` is the "-1" that makes the
  // client print "'name'님을 찾지 못했습니다", anything else an id it loads `Map/Map/%09d.img` from.
  assert.equal(USER_MESSAGE_FIND_ANSWER, 0x09);
  const found = encodeUserFindAnswer({ name: "Alt", mapId: 2000000 });
  assert.equal(toHex(found), "1a" + "09" + "0300" + "416c74" + "80841e00");
  assert.deepEqual(readUserFindAnswer(new PacketReader(found, 1)), { name: "Alt", mapId: 2000000 });
  assert.equal(describeUserFindAnswer(readUserFindAnswer(new PacketReader(found, 1))), 'find answer "Alt": map 2000000');
  assert.equal(describeFieldPacket(found), '0x1a CField(user message): find answer "Alt": map 2000000');

  const missing = encodeUserFindAnswer({ name: "Nobody", mapId: -1 });
  assert.equal(toHex(missing), "1a" + "09" + "0600" + "4e6f626f6479" + "ffffffff");
  assert.equal(
    describeUserFindAnswer(readUserFindAnswer(new PacketReader(missing, 1))),
    'find answer "Nobody": not found',
  );

  // `sub_472910` case 0x0A: `string name` + `u8 flag`. Only zero-ness is read, so the encoder's own
  // choice of 1 for "delivered" is not part of the format - and there is no text in the packet: the
  // sender's client prints "name<< text" from the text it kept locally.
  assert.equal(USER_MESSAGE_WHISPER_ANSWER, 0x0a);
  const delivered = encodeUserWhisperAnswer({ name: "Alt", delivered: true });
  assert.equal(toHex(delivered), "1a" + "0a" + "0300" + "416c74" + "01");
  assert.deepEqual(readUserWhisperAnswer(new PacketReader(delivered, 1)), { name: "Alt", delivered: true });
  assert.equal(
    describeFieldPacket(delivered),
    '0x1a CField(user message): whisper answer "Alt": delivered',
  );
  const refused = readUserWhisperAnswer(
    new PacketReader(encodeUserWhisperAnswer({ name: "Nope", delivered: false }), 1),
  );
  assert.equal(refused.delivered, false);
  assert.equal(describeUserWhisperAnswer(refused), 'whisper answer "Nope": not found');

  // Each reader refuses the other's sub-op, the way `readUserChat` refuses both.
  assert.throws(() => readUserFindAnswer(new PacketReader(delivered, 1)), /is not a find answer/);
  assert.throws(() => readUserWhisperAnswer(new PacketReader(found, 1)), /is not a whisper answer/);
});

test("the level-up effect (0x29) names a user, and one byte says which effect", () => {
  // `sub_51D590` reads the u32 and resolves it in the pool; `sub_522300` then reads one byte, and 0
  // is the level-up: `Effect/BasicEff.img/LevelUp` + the "LevelUp" sound, built over that user.
  const effect = { characterId: 7, effect: USER_EFFECT_LEVEL_UP };
  const bytes = encodeUserEffect(effect);
  assert.equal(FIELD_OPCODE.userEffect, 0x29);
  assert.equal(USER_EFFECT_LEVEL_UP, 0);
  assert.equal(toHex(bytes), "29" + "07000000" + "00");
  assert.deepEqual(readUserEffect(new PacketReader(bytes, 1)), effect);
  assert.equal(describeUserEffect(effect), "level-up effect for characterId=7");
  assert.equal(describeFieldOpcode(0x29), "0x29 CUserPool(user effect)");
  assert.equal(
    describeFieldPacket(bytes),
    "0x29 CUserPool(user effect): level-up effect for characterId=7",
  );
  // The second branch of `sub_522300` reads another u32; what it plays is not located, so a packet
  // that says 1 is refused rather than half-read (`0x1A`'s non-chat sub-ops get the same treatment).
  const unlocated = Uint8Array.from([0x29, 0x07, 0x00, 0x00, 0x00, 0x01, 0x2a, 0x00, 0x00, 0x00]);
  assert.throws(() => readUserEffect(new PacketReader(unlocated, 1)), /effect 1 is not the located one/);
  assert.match(describeFieldPacket(unlocated)!, /not the located one/);
});

test("the player's own HP/MP change (0x1c) travels as a signed delta of the record", () => {
  // `sub_55B870` is the only writer, and the disassembly gives every width: `push $0x1c` +
  // `call 0x4a1ea0` for the opcode, `movl $0x1400,(%ecx,%eax,1)` for the flags word, two `mov %cx`
  // (s16) for the deltas, and `mov %cl` for the trailing byte (.text:0055B88A-0055B9E1).
  assert.equal(CLIENT_FIELD_OPCODE.statReport, 0x1c);

  // The damage path: `sub_5114A0` reports `-damage`, once per hit it rolled locally. The client
  // always writes **both** fields (`sub_55B870(-damage, 0, 0)` -> flags 0x1400, mp delta 0), which
  // is what these bytes are; the flags word follows the fields the caller gave, so a faithful
  // replay of the client names both.
  const damage = { hpDelta: -30, mpDelta: 0, flag: 0 };
  const bytes = encodeClientStatReport(damage);
  assert.equal(toHex(bytes), "1c" + "00140000" + "e2ff" + "0000" + "00");
  assert.deepEqual(readClientStatReport(new PacketReader(bytes, 1)), damage);
  assert.equal(describeClientStatReport(damage), "hpDelta=-30 mpDelta=0 flag=0");
  assert.equal(describeClientFieldPacket(bytes), "0x1c stat report: hpDelta=-30 mpDelta=0 flag=0");

  // The map's own regeneration: `sub_558950` sends both fields, positive, and its flag byte is 1
  // when the recovery was item-driven (HP +10, MP +3 per 10000 ms).
  const regen = { hpDelta: 10, mpDelta: 3, flag: 1 };
  assert.equal(toHex(encodeClientStatReport(regen)), "1c" + "00140000" + "0a00" + "0300" + "01");
  assert.deepEqual(readClientStatReport(new PacketReader(encodeClientStatReport(regen), 1)), regen);

  // The format allows either field alone: the flags word decides what is on the wire.
  const mpOnly = { mpDelta: -5, flag: 0 };
  assert.equal(toHex(encodeClientStatReport(mpOnly)), "1c" + "00100000" + "fbff" + "00");
  assert.deepEqual(readClientStatReport(new PacketReader(encodeClientStatReport(mpOnly), 1)), mpOnly);

  // A delta is an s16: one that does not fit is refused instead of wrapped, and a flag bit nobody
  // has located is refused instead of half-read (the same rule the 0x0d panel block gets).
  assert.throws(() => encodeClientStatReport({ hpDelta: 0x8000, flag: 0 }), /cannot hold 32768/);
  const unknownBit = Uint8Array.from([0x1c, 0x01, 0x14, 0x00, 0x00, 0x00]);
  assert.throws(() => readClientStatReport(new PacketReader(unknownBit, 1)), /only the hp \(0x400\)/);
  assert.match(describeClientFieldPacket(unknownBit)!, /only the hp \(0x400\)/);
});

test("using an item out of the USE tab (0x18/0x19) is a slot and an item id, nothing else", () => {
  // Two senders, one shape. The disassembly gives the widths: `push $0x18` at .text:0055B311 and
  // `push $0x19` at .text:0055B501 for the opcode, then `mov %cx` (the client's own `__int16`
  // parameter, sub_55B2C0 `a2`) and `mov %ecx` (`Args`, the item id) in both.
  assert.equal(CLIENT_FIELD_OPCODE.useItem, 0x18);
  assert.equal(CLIENT_FIELD_OPCODE.useMapItem, 0x19);
  assert.deepEqual([...USE_ITEM_OPCODES], [0x18, 0x19]);

  // A red potion in the USE tab's third slot: `sub_462DC0` sends exactly these 7 bytes, and the
  // client keeps nothing back - what the potion does only happens when the server answers.
  const potion = { slot: 3, itemId: 2000000 };
  const bytes = encodeClientUseItem(potion);
  assert.equal(toHex(bytes), "18" + "0300" + "80841e00"); // 2000000 = 0x001E8480, little endian
  assert.deepEqual(readClientUseItem(new PacketReader(bytes, 1)), potion);
  assert.equal(describeClientUseItem(potion), "slot=3 itemId=2000000");
  assert.equal(describeClientFieldPacket(bytes), "0x18 use item: slot=3 itemId=2000000");

  // The 203 family shares it (`sub_55B4B0`, 마을 귀환 주문서 = 2030000): the item id is what
  // decides which family - and therefore which handler - the same two fields mean.
  const scroll = { slot: 1, itemId: 2030000 };
  const scrollBytes = encodeClientUseItem(scroll, CLIENT_FIELD_OPCODE.useMapItem);
  assert.equal(toHex(scrollBytes), "19" + "0100" + "b0f91e00"); // 2030000 = 0x001EF9B0
  assert.deepEqual(readClientUseItem(new PacketReader(scrollBytes, 1)), scroll);
  assert.equal(describeClientFieldPacket(scrollBytes), "0x19 use item: slot=1 itemId=2030000");

  // The opcode cannot be a third value, and an item id cannot leave the u32: the two traps that
  // would otherwise write a packet the client's own reader would misread.
  assert.throws(() => encodeClientUseItem(potion, 0x1a), /not one of the use-item opcodes/);
  assert.throws(() => readClientUseItem(new PacketReader(Uint8Array.from([0x1a, 0x00, 0x00]), 1), 0x1a), /0x18, 0x19/);
  assert.throws(() => encodeClientUseItem({ slot: 1, itemId: 0x1_0000_0000 }), /does not fit the u32/);
});

test("an emotion is one u32 in both directions, and the nine faces are the client's own table", () => {
  // Where the table comes from: `sub_408400` indexes the wide-string array at .data:0x5B20D8 with
  // `n8 > 8 ? 0 : n8` and looks the result up in the face image, and `Character/Face/00020000.img`
  // really does carry a node of each of those names next to `default`.
  assert.deepEqual(
    [...EMOTION_NAMES],
    ["blink", "hit", "smile", "troubled", "cry", "angry", "bewildered", "stunned", "vomit"],
  );
  assert.equal(EMOTION_MAX, 8);
  assert.equal(EMOTION_NEUTRAL, 0);
  // The sentinel that ties the table to the binary: the client shows `1` on itself when it is hit
  // (`sub_5114A0`: `sub_509790(this, 1, 1500)`), and entry 1 is "hit".
  assert.equal(EMOTION_HIT, 1);
  assert.equal(emotionName(EMOTION_HIT), "hit");
  assert.equal(emotionName(0), "blink");
  assert.equal(emotionName(-1), undefined, "the constructor's -1 is \"no face\", not a name");
  assert.equal(emotionName(9), undefined, "and the drawer clamps anything above 8 to 0");

  // c2s `0x13`: what the F-keys send, `[0x13][u32 emotion]`.
  assert.equal(CLIENT_FIELD_OPCODE.emotion, 0x13);
  const smile = { emotion: 2 };
  const bytes = encodeClientEmotion(smile);
  assert.equal(toHex(bytes), "13" + "02000000");
  assert.deepEqual(readClientEmotion(new PacketReader(bytes, 1)), smile);
  assert.equal(describeClientEmotion(smile), "emotion 2 (smile)");
  assert.equal(describeClientFieldPacket(bytes), "0x13 emotion: emotion 2 (smile)");

  // s2c `0x27`: the same face, but on somebody: `[0x27][u32 characterId][u32 emotion]`.
  assert.equal(FIELD_OPCODE.userEmotion, 0x27);
  const over = { characterId: 44, emotion: 5 };
  const out = encodeUserEmotion(over);
  assert.equal(toHex(out), "27" + "2c000000" + "05000000");
  assert.deepEqual(readUserEmotion(new PacketReader(out, 1)), over);
  assert.equal(describeUserEmotion(over), "characterId=44 emotion=5 (angry)");
  assert.equal(describeFieldPacket(out), "0x27 CUserPool(user emotion): characterId=44 emotion=5 (angry)");

  // The range is the client's own (`sub_509790` tests `n8 <= 8`): nothing outside 0..8 is a face, so
  // neither direction will carry one.
  assert.throws(() => encodeClientEmotion({ emotion: 9 }), /not a face/);
  assert.throws(() => encodeUserEmotion({ characterId: 1, emotion: 0xffffffff }), /not a face/);
  assert.throws(
    () => readClientEmotion(new PacketReader(Uint8Array.from([0x13, 0x09, 0, 0, 0]), 1)),
    /not a face/,
  );
});

/**
 * `0x23`: one user's swing, as everybody else sees it (FINDINGS 4.11.7b). The body is
 * `sub_5209C0`'s read order, and it is the same packing the attacker's own `0x0F` uses - so the
 * golden bytes below describe exactly the swing the `0x0F` test sends, minus the three things only
 * the attacker knows (the clicked object, and each mob's x/y and sequence). If this fails, the
 * codec and the reader in the document disagree.
 */
test("user attack (0x23) is byte exact: the swing, for everyone but the attacker", () => {
  const swing: UserAttack = {
    characterId: 0x30,
    hits: 2,
    skillLevel: 0,
    skillId: 0,
    facingLeft: true,
    action: 0x11,
    speed: 2,
    afterimage: 0,
    projectileItemId: 0,
    targets: [{ mobId: 0x10, hitAnimation: -1, damages: [11, 12] }],
  };
  const bytes = encodeUserAttack(swing);
  assert.equal(
    toHex(bytes),
    // 23 | 30 00 00 00 | 02|1<<4 | 00 | 80|11 | 02 | 00 | 00 00 00 00 | 10 00 00 00 | ff | 0b 00 0c 00
    "2330000000120091020000000000" + "10000000ff" + "0b000c00",
  );
  assert.deepEqual(readUserAttack(new PacketReader(bytes, 1)), swing);
  assert.equal(FIELD_OPCODE.userAttack, 0x23);
  assert.equal(
    describeUserAttack(swing),
    "characterId=48 left action=17 hits=2 speed=2 afterimage=0 skill=0/0 targets=1 16[11+12] anim=-1",
  );
  assert.equal(
    describeFieldPacket(bytes),
    "0x23 CUserPool(user attack): characterId=48 left action=17 hits=2 speed=2 afterimage=0 " +
      "skill=0/0 targets=1 16[11+12] anim=-1",
  );
  // A whiff is a swing too: no target records, but the header is still there.
  const whiffBytes = encodeUserAttack({ ...swing, hits: 1, targets: [] });
  assert.equal(toHex(whiffBytes), "23" + "30000000" + "01" + "00" + "91" + "02" + "00" + "00000000");
  assert.deepEqual(readUserAttack(new PacketReader(whiffBytes, 1)).targets, []);
});

/**
 * The two other halves of the family: `0x24` (a shot) and `0x25` (a magic cast) are the *same* body
 * as `0x23` - one reader, one writer - and only the opcode byte differs. That byte is what picks the
 * renderer on the receiving client (`sub_521400` vs `sub_521AD0`, FINDINGS 4.11.7c), so the relay's
 * whole job is to mirror the client opcode onto it (`ATTACK_RELAY_OPCODE`); an opcode outside the
 * three has no relay at all.
 */
test("the relay mirrors each client attack as the opcode whose receiver renders it", () => {
  assert.deepEqual(ATTACK_RELAY_OPCODE, {
    [CLIENT_FIELD_OPCODE.attack]: FIELD_OPCODE.userAttack,
    [CLIENT_FIELD_OPCODE.shootAttack]: FIELD_OPCODE.userShootAttack,
    [CLIENT_FIELD_OPCODE.magicAttack]: FIELD_OPCODE.userMagicAttack,
  });
  const relayTable: Record<number, number | undefined> = ATTACK_RELAY_OPCODE;
  assert.equal(relayTable[CLIENT_FIELD_OPCODE.chat], undefined, "a chat is not an attack");
  assert.equal(relayTable[0x99], undefined, "and neither is anything else");

  // A claw's shot: the trailing u32 is the star's item id (2070000 = the family `sub_521400` tests
  // with `bottom / 10000 == 207`), which is also the family `sub_511630` picks a projectile by.
  const shot: UserAttack = {
    characterId: 0x30,
    hits: 1,
    skillLevel: 0,
    skillId: 0,
    facingLeft: false,
    action: 0x2e,
    speed: 1,
    afterimage: 0,
    projectileItemId: 2070000,
    targets: [{ mobId: 0x10, hitAnimation: -1, damages: [7] }],
  };
  const shotBytes = encodeUserAttack(shot, FIELD_OPCODE.userShootAttack);
  assert.equal(toHex(shotBytes), "24" + "30000000" + "11" + "00" + "2e" + "01" + "00" + "f0951f00" + "10000000ff" + "0700");
  assert.deepEqual(readUserAttack(new PacketReader(shotBytes, 1)), shot);
  assert.match(describeFieldPacket(shotBytes)!, /^0x24 CUserPool\(user attack, shot\): characterId=48/);

  const castBytes = encodeUserAttack({ ...shot, projectileItemId: 0 }, FIELD_OPCODE.userMagicAttack);
  assert.equal(castBytes[0], FIELD_OPCODE.userMagicAttack);
  assert.equal(castBytes.length, shotBytes.length, "the body is the same record");
  assert.match(describeFieldPacket(castBytes)!, /^0x25 CUserPool\(user attack, magic\): characterId=48/);
});

test("a 0x23 skill level adds the skill id, and level 0 leaves it out", () => {
  const base: UserAttack = {
    characterId: 7,
    hits: 1,
    skillLevel: 0,
    skillId: 0,
    facingLeft: false,
    action: 0x20,
    speed: 3,
    afterimage: 1,
    projectileItemId: 0,
    targets: [{ mobId: 5, hitAnimation: 0, damages: [9] }],
  };
  const plain = encodeUserAttack(base);
  const skilled = encodeUserAttack({ ...base, skillLevel: 3, skillId: 1001003 });
  assert.equal(skilled.length, plain.length + 4, "only the id is extra");
  const read = readUserAttack(new PacketReader(skilled, 1));
  assert.equal(read.skillLevel, 3);
  assert.equal(read.skillId, 1001003);
  assert.equal(readUserAttack(new PacketReader(plain, 1)).skillId, 0);
  // Field 7 is read whatever the opcode is: only 0x24's handler receives it, but it is on the wire.
  assert.equal(read.projectileItemId, 0);
});

test("a 0x23 target record with mobId 0 is refused, and hits must match the header", () => {
  const base: UserAttack = {
    characterId: 1,
    hits: 2,
    skillLevel: 0,
    skillId: 0,
    facingLeft: false,
    action: 1,
    speed: 2,
    afterimage: 0,
    projectileItemId: 0,
    targets: [],
  };
  // A zero id means "empty slot" to the reader, which then reads no animation and no damages - so
  // a record like that would silently shift every following record.
  assert.throws(
    () => encodeUserAttack({ ...base, targets: [{ mobId: 0, hitAnimation: 0, damages: [1, 2] }] }),
    /mobId 0 has no tail/,
  );
  assert.throws(
    () => encodeUserAttack({ ...base, targets: [{ mobId: 9, hitAnimation: 0, damages: [1] }] }),
    /exactly 2 damage/,
  );
  const many = Array.from({ length: 16 }, (_, i) => ({ mobId: i + 1, hitAnimation: 0, damages: [1, 2] }));
  assert.throws(() => encodeUserAttack({ ...base, targets: many }), /at most 15 targets/);
});

/**
 * `0x17`: the inventory window moved something (FINDINGS 4.34.1). One sender (`sub_55ACB0`) packs its
 * four arguments in order, so the golden bytes below are simply those arguments - the interesting half
 * is the two conventions they carry: a negative slot on tab 1 is a *worn* item, and `toSlot = 0` is the
 * ground. The client itself moves nothing: the window follows the `0x0B` the server answers with.
 */
test("change slot (0x17) is the window's four fields, signed and byte exact", () => {
  assert.equal(CLIENT_FIELD_OPCODE.changeSlot, 0x17);
  // What `sub_4636B0` sends for a double-clicked cap: tab 1, the equip tab's slot 2, the part the
  // caller derived from the item id (1002000 -> cap -> 1, as a negative slot), and the literal -1.
  const equip = { tab: 1, fromSlot: 2, toSlot: -1, count: -1 };
  const bytes = encodeClientChangeSlot(equip);
  assert.equal(toHex(bytes), "17010200ffffffff");
  assert.deepEqual(readClientChangeSlot(new PacketReader(bytes, 1)), equip);
  assert.equal(describeClientChangeSlot(equip), "tab 1 slot 2 -> worn 1 count=-1");
  assert.equal(describeClientFieldPacket(bytes), "0x17 change slot: tab 1 slot 2 -> worn 1 count=-1");

  // What `sub_463BE0` sends after "몇 개나 버리시겠습니까?": the ground is slot 0 and the count is how
  // many of the stack to throw away.
  const drop = { tab: 3, fromSlot: 4, toSlot: 0, count: 5 };
  const dropBytes = encodeClientChangeSlot(drop);
  assert.equal(toHex(dropBytes), "1703040000000500");
  assert.deepEqual(readClientChangeSlot(new PacketReader(dropBytes, 1)), drop);
  assert.equal(describeClientChangeSlot(drop), "tab 3 slot 4 -> ground count=5");
  assert.equal(describeClientFieldPacket(dropBytes), "0x17 change slot: tab 3 slot 4 -> ground count=5");
});

/**
 * `0x28`: one user's look, for everybody else (FINDINGS 4.11.8). `sub_5221A0` reads the flags word
 * first and then only the words the bits announce - which is why an absent field is *no bytes* rather
 * than a zero: writing the face unconditionally would shift the id list by four.
 */
test("user look (0x28) is a flags word, a face, and a keep-or-replace id list", () => {
  assert.equal(FIELD_OPCODE.userLook, 0x28);
  assert.deepEqual(LOOK_FLAG, { face: 0x1, unknown4: 0x4, unknown8: 0x8 });

  // The form an equip sends: no face (nothing about the head changed), and the new list.
  const worn = { characterId: 44, avatarItems: [30000, 1002000] };
  const bytes = encodeUserLook(worn);
  assert.equal(toHex(bytes), "282c000000000000000130750000104a0f0000000000");
  assert.deepEqual(readUserLook(new PacketReader(bytes, 1)), worn);
  assert.equal(describeUserLook(worn), "characterId=44 avatar=2 items [30000,1002000]");
  assert.equal(
    describeFieldPacket(bytes),
    "0x28 CUserPool(user look): characterId=44 avatar=2 items [30000,1002000]",
  );

  // A face with no list is legal and partial: the `u8` is 0, which is `sub_5221A0`'s `memcpy` branch -
  // the client keeps the worn items it already has and only the head changes.
  const faceOnly = { characterId: 44, face: 20000 };
  assert.equal(toHex(encodeUserLook(faceOnly)), "282c00000001000000204e000000");
  assert.deepEqual(readUserLook(new PacketReader(encodeUserLook(faceOnly), 1)), faceOnly);
  assert.equal(describeUserLook(faceOnly), "characterId=44 face=20000 avatar=keep");

  // An empty list is not the same thing as "keep": the `u8` still says a list follows, so a client
  // with this packet is drawn with a bare look (which is what a `0x1C` with no items means too).
  const bare = { characterId: 7, avatarItems: [] };
  assert.deepEqual(readUserLook(new PacketReader(encodeUserLook(bare), 1)), bare);
  assert.equal(describeUserLook(bare), "characterId=7 avatar=0 items []");

  // The two words the client reads and drops: they only ever go out when a caller learned one from a
  // real packet, and their bits come from the same word as the face's.
  const withUnknowns = { characterId: 7, unknownA: 1, unknownB: 2, avatarItems: [30000] };
  const unknownBytes = encodeUserLook(withUnknowns);
  assert.equal(toHex(unknownBytes), "28070000000c0000000100000002000000013075000000000000");
  assert.deepEqual(readUserLook(new PacketReader(unknownBytes, 1)), withUnknowns);
  assert.equal(describeUserLook(withUnknowns), "characterId=7 unknownA=1 unknownB=2 avatar=1 items [30000]");

  // A 0 in the list would end it early, so the writer refuses instead of silently truncating.
  assert.throws(() => encodeUserLook({ characterId: 1, avatarItems: [30000, 0] }), /ends at the first 0/);
  assert.throws(() => encodeUserLook({ characterId: 1, avatarItems: [0] }), /ends at the first 0/);
});
