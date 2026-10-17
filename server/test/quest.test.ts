/**
 * NPC dialogue: the `0x47` packet, the `0x15` answer, the CP949 encoder every string goes through,
 * and the lines themselves (which come out of `Npc/<id>.img`, not out of this file).
 *
 * The codec half is byte-exact and needs no archive: the goldens below were produced by the client's
 * own reader order (FINDINGS 4.23) and a change to any of them fails here first. The dialogue half
 * needs `Data.wz`, because the lines are the archive's (`info/speak`) and a server that could invent
 * an NPC's words is exactly what this module refuses to be.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WzArchive } from "../src/wz/archive.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  QUEST_ANSWER,
  QUEST_REPLY_OPCODE,
  QUEST_TALK,
  QUEST_TALK_OPCODE,
  describeQuestReply,
  describeQuestTalk,
  encodeQuestReply,
  encodeQuestTalk,
  readQuestReply,
  readQuestTalk,
  type QuestTalk,
} from "../src/protocol/quest.ts";
import { decodeCp949, encodeCp949 } from "../src/protocol/cp949.ts";
import { NpcTalk, dialogueFromInfo, npcDialogueFrom, npcDialogueProvider } from "../src/game/dialogue.ts";
import {
  FIELD_OPCODE,
  describeClientFieldPacket,
  describeFieldOpcode,
  describeFieldPacket,
} from "../src/protocol/field.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

const HEX = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

function roundTrip(packet: QuestTalk): QuestTalk {
  const bytes = encodeQuestTalk(packet);
  const parsed = readQuestTalk(new PacketReader(bytes, 1));
  assert.equal(HEX(bytes).slice(0, 2), QUEST_TALK_OPCODE.toString(16), "the packet opens with 0x47");
  return parsed;
}

// ---------------------------------------------------------------------------
// 0x47: the five shapes
// ---------------------------------------------------------------------------

test("0x47 say: u8 unknown, u32 npcId, u8 sub-op, CP949 text, two ignored bytes", () => {
  const bytes = encodeQuestTalk({
    unknownA: 0,
    npcId: 7,
    body: { kind: "say", message: "안녕하세요!", unknownA: 0, unknownB: 0 },
  });
  assert.equal(
    HEX(bytes),
    "47" + // the opcode
      "00" + // unknownA: read and never used by the client
      "07000000" + // npcId: also ignored by the client; this server's own meaning
      "00" + // sub-op 0 = say (dialog kind 0)
      "0b00" + // 11 bytes of text
      "bec8b3e7c7cfbcbcbfe421" + // "안녕하세요!" in CP949
      "0000", // the two bytes sub_535C60 stores; the client's own notice box passes 0, 0
  );
  assert.deepEqual(roundTrip({ unknownA: 0, npcId: 7, body: { kind: "say", message: "안녕하세요!", unknownA: 0, unknownB: 0 } }), {
    unknownA: 0,
    npcId: 7,
    body: { kind: "say", message: "안녕하세요!", unknownA: 0, unknownB: 0 },
  });
});

test("0x47 say carries the two extra bytes verbatim (sub_535C60 stores them)", () => {
  const bytes = encodeQuestTalk({
    unknownA: 1,
    npcId: 7,
    body: { kind: "say", message: "안녕", unknownA: 2, unknownB: 3 },
  });
  assert.equal(HEX(bytes), "470107000000000400bec8b3e70203");
  const parsed = roundTrip({ unknownA: 1, npcId: 7, body: { kind: "say", message: "안녕", unknownA: 2, unknownB: 3 } });
  assert.deepEqual(parsed.body, { kind: "say", message: "안녕", unknownA: 2, unknownB: 3 });
  assert.equal(parsed.unknownA, 1);
});

test("0x47 confirm (dialog kind 1) is the message and nothing else", () => {
  const bytes = encodeQuestTalk({ unknownA: 0, npcId: 259, body: { kind: "confirm", message: "정말로?" } });
  assert.equal(HEX(bytes), "470003010000010700c1a4b8bbb7ce3f");
  assert.equal(bytes.length, 16);
  assert.deepEqual(roundTrip({ unknownA: 0, npcId: 259, body: { kind: "confirm", message: "정말로?" } }).body, {
    kind: "confirm",
    message: "정말로?",
  });
});

test("0x47 askText: message, default text, then two s16 that are a length range", () => {
  const packet: QuestTalk = {
    unknownA: 0,
    npcId: 3,
    body: { kind: "askText", message: "길드명을 입력하십시오.", defaultText: "abc", minLength: 4, maxLength: 12 },
  };
  const bytes = encodeQuestTalk(packet);
  assert.equal(
    HEX(bytes),
    "4700" +
      "03000000" +
      "02" + // sub-op 2 = askText, and the dialog it builds is kind 3
      "1600b1e6b5e5b8edc0bb20c0d4b7c2c7cfbdcabdc3bfc02e" + // "길드명을 입력하십시오." (22 bytes)
      "0300616263" + // "abc" (3 bytes)
      "0400" + // minLength 4
      "0c00", // maxLength 12
  );
  assert.deepEqual(roundTrip(packet).body, packet.body);
});

test("0x47 askText's two numbers are signed: a negative minimum survives", () => {
  const bytes = encodeQuestTalk({
    unknownA: 0,
    npcId: 1,
    body: { kind: "askText", message: "x", defaultText: "", minLength: -1, maxLength: 12 },
  });
  assert.equal(HEX(bytes), "470001000000020100780000ffff0c00");
  const parsed = readQuestTalk(new PacketReader(bytes, 1));
  assert.deepEqual(parsed.body, { kind: "askText", message: "x", defaultText: "", minLength: -1, maxLength: 12 });
});

test("0x47 askNumber: three u32 - default, minimum, maximum (the client's own caller order)", () => {
  const packet: QuestTalk = {
    unknownA: 0,
    npcId: 3,
    body: { kind: "askNumber", message: "얼마를 드리시겠습니까?", defaultValue: 1, min: 1, max: 50000 },
  };
  const bytes = encodeQuestTalk(packet);
  assert.equal(
    HEX(bytes),
    "4700" +
      "03000000" +
      "03" + // sub-op 3 = askNumber, dialog kind 2
      "1600" + "bef3b8b6b8a620b5e5b8aebdc3b0dabdc0b4cfb1ee3f" + // "얼마를 드리시겠습니까?" (22 bytes)
      "01000000" + // default 1 - the client's own mesos dialog passes (1, 1, mesos)
      "01000000" + // min 1
      "50c30000", // max 50000
  );
  assert.deepEqual(roundTrip(packet).body, packet.body);
});

test("0x47 kind 4 keeps its shape and is never built by the game layer", () => {
  const bytes = encodeQuestTalk({ unknownA: 0, npcId: 9, body: { kind: "menu", message: "메뉴" } });
  assert.equal(HEX(bytes), "470009000000040400b8deb4ba");
  assert.deepEqual(roundTrip({ unknownA: 0, npcId: 9, body: { kind: "menu", message: "메뉴" } }).body, {
    kind: "menu",
    message: "메뉴",
  });
});

test("0x47 refuses a sub-op the client has no branch for", () => {
  const bytes = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x05]);
  assert.throws(() => readQuestTalk(new PacketReader(bytes)), /sub-op 5/);
});

test("0x47 describes itself in one line, in every shape", () => {
  assert.equal(
    describeQuestTalk({ unknownA: 0, npcId: 2003, body: { kind: "say", message: "한 줄\n둘째 줄", unknownA: 0, unknownB: 0 } }),
    'talk to npc 2003: say "한 줄" (0,0)',
    "only the first line of a multi-line text is quoted",
  );
  assert.equal(
    describeQuestTalk({ unknownA: 0, npcId: 1, body: { kind: "confirm", message: "정말?" } }),
    'talk to npc 1: confirm "정말?"',
  );
  assert.equal(
    describeQuestTalk({ unknownA: 0, npcId: 1, body: { kind: "askText", message: "이름?", defaultText: "abc", minLength: 4, maxLength: 12 } }),
    'talk to npc 1: askText "이름?" default="abc" length=4..12',
  );
  assert.equal(
    describeQuestTalk({ unknownA: 0, npcId: 1, body: { kind: "askNumber", message: "얼마?", defaultValue: 1, min: 1, max: 50000 } }),
    'talk to npc 1: askNumber "얼마?" default=1 range=1..50000',
  );
  assert.equal(
    describeQuestTalk({ unknownA: 0, npcId: 1, body: { kind: "menu", message: "메뉴" } }),
    'talk to npc 1: menu(kind 4) "메뉴"',
  );
});

test("the field describer knows 0x47 by name and decodes it whole", () => {
  assert.match(
    describeFieldPacket(Uint8Array.from([QUEST_TALK_OPCODE]))!,
    /^0x47 CQuestMan\(npc dialog\): \(truncated: /,
    "an opcode byte on its own is a cut-short body, not a silently empty dialog",
  );
  const bytes = encodeQuestTalk({ unknownA: 0, npcId: 2003, body: { kind: "say", message: "안녕", unknownA: 0, unknownB: 0 } });
  assert.equal(
    describeFieldPacket(bytes),
    '0x47 CQuestMan(npc dialog): talk to npc 2003: say "안녕" (0,0)',
  );
});

// ---------------------------------------------------------------------------
// 0x15: the client's answer
// ---------------------------------------------------------------------------

test("0x15: u8 sub-op, u8 answer, and the text/number only for a primary answer", () => {
  assert.equal(HEX(encodeQuestReply({ kind: "say", answer: QUEST_ANSWER.primary })), "150001");
  assert.equal(HEX(encodeQuestReply({ kind: "say", answer: QUEST_ANSWER.none })), "1500ff");
  assert.equal(HEX(encodeQuestReply({ kind: "confirm", answer: QUEST_ANSWER.secondary })), "150100");
  assert.equal(HEX(encodeQuestReply({ kind: "askText", answer: QUEST_ANSWER.primary, text: "길드" })), "1502010400b1e6b5e5");
  assert.equal(
    HEX(encodeQuestReply({ kind: "askText", answer: QUEST_ANSWER.secondary })),
    "150200",
    "a cancelled text input carries nothing: sub_4A5F40 writes the answer byte only",
  );
  assert.equal(HEX(encodeQuestReply({ kind: "askNumber", answer: QUEST_ANSWER.primary, value: 1234 })), "150301d2040000");
  assert.equal(HEX(encodeQuestReply({ kind: "menu", answer: QUEST_ANSWER.primary, value: 0xffffffff })), "150401ffffffff");
});

test("0x15 round-trips, and the answer byte is what the client can produce", () => {
  const cases = [
    { kind: "say" as const, answer: 1 },
    { kind: "say" as const, answer: 0 },
    { kind: "say" as const, answer: 255 },
    { kind: "askText" as const, answer: 1, text: "로빈" },
    { kind: "askNumber" as const, answer: 1, value: 0xffffffff },
    { kind: "askNumber" as const, answer: 0xff },
    { kind: "menu" as const, answer: 1, value: 3 },
    { kind: "confirm" as const, answer: 0xff },
  ];
  for (const reply of cases) {
    const bytes = encodeQuestReply(reply);
    assert.equal(bytes[0], QUEST_REPLY_OPCODE);
    assert.deepEqual(readQuestReply(new PacketReader(bytes, 1)), reply, HEX(bytes));
  }
});

test("0x15 refuses a sub-op outside the five the client can send", () => {
  assert.throws(() => readQuestReply(new PacketReader(Uint8Array.from([0x05, 0x01]))), /sub-op 5/);
});

test("0x15 describes itself in one line", () => {
  assert.equal(describeQuestReply({ kind: "say", answer: 1 }), "15 talk answer: primary");
  assert.equal(describeQuestReply({ kind: "confirm", answer: 0 }), "15 talk answer: secondary");
  assert.equal(describeQuestReply({ kind: "say", answer: 0xff }), "15 talk answer: no answer");
  assert.equal(describeQuestReply({ kind: "askText", answer: 1, text: "로빈" }), '15 talk answer: primary "로빈"');
  assert.equal(describeQuestReply({ kind: "askNumber", answer: 1, value: 42 }), "15 talk answer: primary 42");
  assert.equal(describeQuestReply({ kind: "say", answer: 7 }), "15 talk answer: answer 7");
  // The client -> server describer names its own opcode, the way "33 object click" does.
  assert.equal(
    describeClientFieldPacket(encodeQuestReply({ kind: "say", answer: 1 })),
    "15 talk answer: primary",
  );
});

// ---------------------------------------------------------------------------
// CP949
// ---------------------------------------------------------------------------

test("CP949: the client's code page, with ASCII and Korean pinned down", () => {
  assert.equal(HEX(encodeCp949("abc")), "616263", "ASCII is itself");
  assert.equal(HEX(encodeCp949("로빈")), "b7cebaf3");
  assert.equal(decodeCp949(encodeCp949("리나 로빈")), "리나 로빈");
  assert.equal(HEX(encodeCp949("안녕하세요!")), "bec8b3e7c7cfbcbcbfe421");
  // The code page is wider than Korean: hanja, kana, Greek and Cyrillic are all in it.
  assert.equal(HEX(encodeCp949("中文")), "f1e9d9fe");
  assert.equal(decodeCp949(encodeCp949("日本語 Ω")), "日本語 Ω");
});

test("CP949: a character the code page does not have throws instead of arriving as mojibake", () => {
  // Latin-1's accented letters are *not* in CP949 (that is CP1252), nor are emoji.
  assert.throws(() => encodeCp949("À"), /U\+c0/);
  assert.throws(() => encodeCp949("로빈😀"), /U\+1f600/);
});

// ---------------------------------------------------------------------------
// the lines themselves: Npc/<id>.img -> info/speak
// ---------------------------------------------------------------------------

test("an NPC's lines come out of its own image, in index order", needsArchive, () => {
  const robin = npcDialogueFrom(archive!, 2003);
  assert.ok(robin, "Npc/0002003.img has to be in Data.wz");
  assert.equal(robin.name, "로빈");
  assert.equal(robin.quest, "begin5", "info/quest is carried, never interpreted");
  assert.equal(robin.lines.length, 4);
  assert.equal(robin.lines[0], "여기는 몬스터들이 나오니까 특히 조심해야 해!");
  assert.equal(robin.lines[3], "강한 몬스터라면 힘을 합쳐보는건 어때?");

  const rina = npcDialogueFrom(archive!, 1010100);
  assert.equal(rina?.name, "리나");
  assert.equal(rina?.quest, "rina");
  assert.equal(rina?.lines.length, 4);
});

test("an NPC with no info/speak says nothing (it is not a dialogue with empty lines)", needsArchive, () => {
  // 메이플운수 중형택시 carries info/quest but no info/speak - a real case, not a hypothetical one.
  const taxi = npcDialogueFrom(archive!, 1012000);
  assert.equal(taxi?.name, "메이플운수 중형택시");
  assert.deepEqual(taxi?.lines, []);
  assert.equal(npcDialogueFrom(archive!, 1), undefined, "no Npc/0000001.img in this archive");
});

test("the provider caches per id, like every other archive provider", needsArchive, () => {
  const provider = npcDialogueProvider(archive!);
  const first = provider(2003);
  assert.equal(provider(2003), first);
  assert.equal(provider(1010100)?.name, "리나");
});

test("dialogueFromInfo sorts by the index the key spells and drops what is not a line", () => {
  const info = {
    name: "테스트",
    quest: "",
    speak: {
      props: [
        { name: "1", value: "second" },
        { name: "0", value: "first" },
        { name: "x", value: "not an index" },
        { name: "2", value: "" },
      ],
    },
  };
  const dialogue = dialogueFromInfo(1, info);
  assert.deepEqual(dialogue.lines, ["first", "second"], "empty and non-numeric entries are not lines");
  assert.equal(dialogue.quest, undefined, "an empty quest name is not a quest name");
  assert.deepEqual(dialogueFromInfo(2, {}).lines, []);
});

// ---------------------------------------------------------------------------
// one conversation
// ---------------------------------------------------------------------------

test("NpcTalk walks the lines and stops at the last one", () => {
  const talk = new NpcTalk(4, 2003, ["one", "two"]);
  assert.equal(talk.npcId, 4);
  assert.equal(talk.lineCount, 2);
  assert.equal(talk.lineIndex, 0);
  const first = readQuestTalk(new PacketReader(talk.packet(), 1));
  assert.deepEqual(first, { unknownA: 0, npcId: 4, body: { kind: "say", message: "one", unknownA: 0, unknownB: 0 } });

  const second = talk.advance();
  assert.ok(second);
  assert.equal(talk.lineIndex, 1);
  assert.equal(readQuestTalk(new PacketReader(second, 1)).body.message, "two");
  assert.equal(talk.advance(), undefined, "the last line has no successor: the talk is over");
  assert.equal(talk.lineIndex, 1, "and asking again does not move it");
});

test("a talk with nothing to say cannot be built", () => {
  assert.throws(() => new NpcTalk(1, 2003, []), /nothing to say/);
});

test("the opcode numbers are the ones the binary routes", () => {
  assert.equal(FIELD_OPCODE.questTalk, QUEST_TALK_OPCODE);
  assert.equal(QUEST_TALK_OPCODE, 0x47);
  assert.equal(QUEST_REPLY_OPCODE, 0x15);
  assert.deepEqual(QUEST_TALK, { say: 0, confirm: 1, askText: 2, askNumber: 3, menu: 4 });
  assert.equal(describeFieldOpcode(0x46), "0x46 CQuestMan(no handler)");
  assert.equal(describeFieldOpcode(0x47), "0x47 CQuestMan(npc dialog)");
  assert.equal(describeFieldOpcode(0x48), "0x48 CQuestMan(no handler)");
});
