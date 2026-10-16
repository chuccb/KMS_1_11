import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader, PacketWriter } from "../src/protocol/packet.ts";
import { toHex } from "../src/protocol/frame.ts";
import {
  CHAR_FLAG_ITEMS,
  CHAR_FLAG_STATS,
  CHARACTER_NAME_BYTES,
  CHARACTER_NAME_MAX,
  CHARACTER_STATS_BYTES,
  characterDataOf,
  nameFieldBytes,
  readCharacterData,
  readCharacterStats,
  writeCharacterStats,
  type CharacterStats,
} from "../src/protocol/chardata.ts";
import {
  CREATE_CHARACTER_RESULT,
  LOGIN_OPCODE,
  LOGIN_RESULT,
  NAME_CHECK_RESULT,
  encodeCreateCharacterResult,
  encodeDeleteCharacterResult,
  encodeLoginResult,
  encodeNameCheckResult,
  encodeSelectCharacterResult,
  encodeWorldSelectResult,
  ipv4WireValue,
} from "../src/protocol/replies.ts";
import {
  CHECK_NAME_APPEARANCE_WORDS,
  decodeClientPacket,
  encodeClientPacket,
  type ClientPacket,
} from "../src/protocol/login.ts";

/** A stat block with a distinct value per field, so any reordering shows up as a diff. */
function sampleStats(): CharacterStats {
  return {
    id: 0x11223344,
    name: "Hero",
    gender: 1,
    appearanceA: 0x00010002,
    appearanceB: 0x00030004,
    unknown26: 0x05,
    hair: 0x00060007,
    level: 0x08,
    job: 0x0109,
    str: 0x020a,
    dex: 0x030b,
    int: 0x040c,
    luk: 0x050d,
    hp: 0x060e,
    maxHp: 0x070f,
    mp: 0x0810,
    maxMp: 0x0911,
    ap: 0x0a12,
    sp: 0x0b13,
    exp: 0x0c141516,
    fame: 0x0d17,
    mesos: 0x101c1d1e,
    mapId: 0x111f2021,
    unknown101: 0x12,
  };
}

test("the stat block is 69 bytes and reads back field for field", () => {
  const stats = sampleStats();
  const writer = new PacketWriter();
  writeCharacterStats(writer, stats);
  const bytes = writer.toBytes();
  assert.equal(bytes.length, CHARACTER_STATS_BYTES);
  assert.deepEqual(readCharacterStats(new PacketReader(bytes)), stats);
});

test("the stat block layout is byte-exact against sub_45D840's read order", () => {
  const writer = new PacketWriter();
  writeCharacterStats(writer, sampleStats());
  const hex = toHex(writer.toBytes());
  // id(4) name(13) gender(1) appearanceA(4) appearanceB(4) unknown26(1) hair(4) level(1)
  assert.equal(
    hex.slice(0, 2 * (4 + CHARACTER_NAME_BYTES + 1 + 4 + 4 + 1 + 4 + 1)),
    "44332211" + toHex(nameFieldBytes("Hero")) + "01" + "02000100" + "04000300" + "05" + "07000600" + "08",
  );
  // job..sp are eleven u16 in this order: job str dex int luk hp maxHp mp maxMp ap sp
  assert.equal(
    hex.slice(2 * 32, 2 * 54),
    "0901" + "0a02" + "0b03" + "0c04" + "0d05" + "0e06" + "0f07" + "1008" + "1109" + "120a" + "130b",
  );
  // exp(u32) fame(u16) mesos(u32) mapId(u32) unknown101(u8)
  assert.equal(hex.slice(2 * 54), "1615140c" + "170d" + "1e1d1c10" + "21201f11" + "12");
});

test("the name field is 13 raw bytes, NUL padded, and rejects what the client cannot hold", () => {
  assert.equal(toHex(nameFieldBytes("AB")), "4142" + "00".repeat(11));
  assert.throws(() => nameFieldBytes("x".repeat(CHARACTER_NAME_MAX + 1)), RangeError);
  assert.throws(() => nameFieldBytes("н"), RangeError);
});

test("a stat-only CharacterData is one flags byte plus one 69-byte stat block (CHAR_FLAG_STATS)", () => {
  const bytes = encodeWorldSelectResult(LOGIN_RESULT.ok, [characterDataOf(sampleStats())]);
  // opcode(1) result(1) count(1) flags(1) stats(69)
  assert.equal(bytes.length, 3 + 1 + CHARACTER_STATS_BYTES);
  const reader = new PacketReader(bytes);
  assert.equal(reader.readByte(), LOGIN_OPCODE.worldSelect);
  assert.equal(reader.readByte(), LOGIN_RESULT.ok);
  assert.equal(reader.readByte(), 1);
  const data = readCharacterData(reader);
  assert.equal(data.flags, CHAR_FLAG_STATS);
  assert.deepEqual(data.stats, sampleStats());
  assert.equal(reader.exhausted, true);
});

test("an item block with nothing in it is a legal, empty block", () => {
  const data = characterDataOf(sampleStats());
  const bytes = encodeWorldSelectResult(LOGIN_RESULT.ok, [{ ...data, flags: CHAR_FLAG_STATS | CHAR_FLAG_ITEMS }]);
  // flags + stats + (two empty worn groups) + (empty equip tab: capacity, terminator, 0 records)
  assert.equal(bytes.length, 3 + 1 + CHARACTER_STATS_BYTES + 1 + 1 + 1 + 1 + 1);
  const reader = new PacketReader(bytes);
  reader.readByte();
  reader.readByte();
  reader.readByte();
  const back = readCharacterData(reader);
  const items = back.items;
  assert.ok(items, "flags 0x02 makes the decoder produce an item block");
  assert.equal(items.worn.size, 0);
  assert.equal(items.inventories[0]!.capacity, 0);
  assert.deepEqual(back.stats, sampleStats());
  assert.equal(reader.exhausted, true);

  assert.throws(
    () => encodeWorldSelectResult(LOGIN_RESULT.ok, [{ flags: 0x80, stats: sampleStats() }]),
    /at most 0x7f/,
  );
});

test("a failed login reply is a single result byte", () => {
  for (const result of [LOGIN_RESULT.wrongPassword, LOGIN_RESULT.alreadyConnected, LOGIN_RESULT.systemError]) {
    assert.equal(toHex(encodeLoginResult(result)), `01${result.toString(16).padStart(2, "0")}`);
  }
});

test("the result codes are the client's own, and each one means what its message says", () => {
  // The three handlers that read this byte group the codes the same way (`sub_4D0DB0`,
  // `sub_54E250`, `sub_432FB0`), and the strings behind them are in the client's `.rdata`. The
  // numbers are what a server must send; the *meanings* are what reading the Hex-Rays symbol names
  // got wrong once (see `LOGIN_RESULT`), so both are pinned here.
  assert.equal(LOGIN_RESULT.erasedOrStopped, 2, "지워지거나 접속 중지된 아이디입니다.");
  assert.equal(LOGIN_RESULT.erasedOrStopped2, 3);
  assert.equal(LOGIN_RESULT.wrongPassword, 4, "잘못된 패스워드입니다.");
  assert.equal(LOGIN_RESULT.notRegistered, 5, "등록되지 않은 아이디입니다.");
  assert.equal(LOGIN_RESULT.alreadyConnected, 7, "현재 접속중인 아이디이거나, 현재 서버점검중입니다.");
  assert.equal(LOGIN_RESULT.systemError, 0xff, "시스템 오류로 접속 할 수 없습니다.");
  assert.deepEqual(
    [LOGIN_RESULT.systemError6, LOGIN_RESULT.systemError8, LOGIN_RESULT.systemError9],
    [6, 8, 9],
    "the client has four codes for the one system-error string",
  );
});

test("a successful login reply carries the account info and the world list", () => {
  const bytes = encodeLoginResult(LOGIN_RESULT.ok, {
    account: { app4: 0x00000007, app8: 2, app9: 1 },
    worlds: [
      { name: "Scania", unknownId: 0 },
      { name: "Bera", unknownId: 1 },
    ],
  });
  const reader = new PacketReader(bytes);
  assert.equal(reader.readByte(), LOGIN_OPCODE.login);
  assert.equal(reader.readByte(), LOGIN_RESULT.ok);
  assert.equal(reader.readU32(), 7);
  assert.equal(reader.readByte(), 2);
  assert.equal(reader.readByte(), 1);
  assert.equal(reader.readByte(), 2, "world count");
  assert.equal(reader.readAsciiString(), "Scania");
  assert.equal(reader.readU32(), 0);
  assert.equal(reader.readAsciiString(), "Bera");
  assert.equal(reader.readU32(), 1);
  assert.equal(reader.exhausted, true);
});

test("the world-select reply never pads past the three slots the client has", () => {
  const three = [1, 2, 3].map((n) => characterDataOf({ id: n, name: `C${n}` }));
  const bytes = encodeWorldSelectResult(LOGIN_RESULT.ok, three);
  assert.equal(bytes[2], 3);
  assert.throws(
    () => encodeWorldSelectResult(LOGIN_RESULT.ok, [1, 2, 3, 4].map((n) => characterDataOf({ id: n, name: `C${n}` }))),
    RangeError,
  );
  // An empty world is legal: the client zeroes all three slots.
  assert.equal(toHex(encodeWorldSelectResult(LOGIN_RESULT.ok, [])), "020000");
});

test("the IPv4 field goes out in network order, the port as a little-endian u16", () => {
  assert.equal(ipv4WireValue("127.0.0.1"), 0x0100007f);
  assert.equal(ipv4WireValue("10.0.0.255"), 0xff00000a);
  assert.throws(() => ipv4WireValue("1.2.3"), RangeError);
  assert.throws(() => ipv4WireValue("1.2.3.400"), RangeError);

  const bytes = encodeSelectCharacterResult(LOGIN_RESULT.ok, { ip: "127.0.0.1", port: 0x8484, characterId: 0xdeadbeef });
  assert.equal(toHex(bytes), "0300" + "7f000001" + "8484" + "efbeadde");
});

test("a redirect is mandatory when the client is told to enter the game", () => {
  assert.throws(() => encodeSelectCharacterResult(LOGIN_RESULT.ok), /game server address/);
  assert.equal(toHex(encodeSelectCharacterResult(LOGIN_RESULT.alreadyConnected)), "0307");
});

test("the name-check reply is a string plus a signed byte", () => {
  assert.equal(toHex(encodeNameCheckResult("Hero", NAME_CHECK_RESULT.taken)), "04" + "04004865726f" + "01");
  assert.equal(toHex(encodeNameCheckResult("Hero", NAME_CHECK_RESULT.failed)), "04" + "04004865726f" + "ff");
  assert.throws(() => encodeNameCheckResult("Hero", 200), RangeError);
});

test("the create reply is the one place 0 means failure - and a refused create sends just that", () => {
  // 0x05 is the one reply in this chain where 0 is the *failure*: `sub_4329A0` reads one byte and
  // only decodes a record when it is non-zero. A create reply carrying LOGIN_RESULT.ok would show
  // "캐릭터 생성에 실패했습니다" and throw the record away.
  const created = encodeCreateCharacterResult(characterDataOf(sampleStats()));
  assert.equal(created[0], LOGIN_OPCODE.createCharacter);
  assert.equal(created[1], CREATE_CHARACTER_RESULT.created);
  assert.notEqual(created[1], 0, "a zero result byte is the client's failure path");
  assert.equal(created[2], CHAR_FLAG_STATS);
  const back = readCharacterData(new PacketReader(created, 2));
  assert.deepEqual(back.stats, sampleStats(), "the record starts right after the result byte");

  // A refusal is the opcode and one zero byte: no record for the client to read.
  assert.equal(toHex(encodeCreateCharacterResult()), "0500");

  // The answer to a delete request is opcode 0x06, echoing the id and a non-zero flag.
  assert.equal(toHex(encodeDeleteCharacterResult(0x11223344, 1)), "064433221101");
  assert.throws(() => encodeDeleteCharacterResult(1, 0), /CTerminateException/);
});

test("the client's four CCharSelect requests decode and re-encode", () => {
  const packets: ClientPacket[] = [
    { kind: "select-character", opcode: 0x03, characterId: 0x11223344 },
    { kind: "create-character", opcode: 0x05, name: "Hero" },
    {
      kind: "check-name",
      opcode: 0x06,
      name: "Hero",
      appearance: Array.from({ length: CHECK_NAME_APPEARANCE_WORDS }, (_, i) => i + 1),
    },
    { kind: "delete-character", opcode: 0x07, characterId: 0x11223344 },
  ];
  for (const packet of packets) {
    const bytes = encodeClientPacket(packet);
    assert.deepEqual(decodeClientPacket(bytes), packet);
  }
});

test("a check-name request with fewer than ten appearance words is an error, not a silent truncation", () => {
  const short = new PacketWriter().writeByte(0x06).writeAsciiString("Hero").writeU32(1).toBytes();
  assert.throws(() => decodeClientPacket(short), /underflow/);
});
