/**
 * The protocol catalogue: **one machine-readable list of every packet this repo can actually
 * decode**, with the fields that are known and the function that proves them.
 *
 * Why a module and not a document: the opcode tables are spread over `login.ts`, `replies.ts` and
 * `field.ts` (each one carrying its own comments), so "what do we know?" was answerable only by
 * reading three files and FINDINGS. This module is the index of that knowledge and nothing else -
 * it declares no numbers of its own, it references the `*_OPCODE` constants, and every `codecs`
 * entry has to resolve to a real exported function (`test/schema.test.ts` fails if it stops doing
 * that). The evidence column is the promise: if a row says `byte-exact`, the codec behind it is
 * byte for byte the client's own reader/writer, not a guess.
 *
 * Rule for adding a row (same as everywhere in this repo): only list what has evidence. A packet
 * whose fields are not located gets `status: "skeleton"` and a `fields: []`, never invented names.
 */
import * as chardata from "./chardata.ts";
import * as drop from "./drop.ts";
import * as field from "./field.ts";
import * as inventory from "./inventory.ts";
import * as login from "./login.ts";
import * as mob from "./mob.ts";
import * as movepath from "./movepath.ts";
import * as npc from "./npc.ts";
import * as quest from "./quest.ts";
import * as shop from "./shop.ts";
import * as stat from "./stat.ts";
import * as packet from "./packet.ts";
import * as replies from "./replies.ts";

export type PacketDirection = "c2s" | "s2c";
/**
 * When the packet exists. `any` is not a third stage: it is the client handling the opcode *before*
 * it looks at the current stage at all (`0x07`/`0x08` in `sub_43B170`, FINDINGS 4) - so it is a
 * packet of every stage, and saying "login" or "field" about it would be a lie either way.
 */
export type PacketStage = "any" | "login" | "field";

/**
 * `byte-exact` - the codec mirrors the client's reader/writer field for field and has golden bytes
 * in `test/`. `partial` - the fields listed are proven but the payload continues with something
 * not located yet. `skeleton` - only the opcode and its handler are known.
 */
export type PacketStatus = "byte-exact" | "partial" | "skeleton";

export interface SchemaField {
  name: string;
  /** Wire type as the client reads it: `u8`/`s8`/`u16`/`s16`/`u32`/`string`/`bool`/a codec name. */
  type: string;
  note?: string;
}

export interface PacketSchema {
  opcode: number;
  direction: PacketDirection;
  stage: PacketStage;
  name: string;
  status: PacketStatus;
  /** Where the layout comes from: the client function plus the FINDINGS section. */
  evidence: string;
  /** Exported codec functions in `src/protocol/**` - the test resolves every name. */
  codecs: string[];
  fields: SchemaField[];
}

/** Strings on the wire are `u16 length` + raw bytes (FINDINGS 4.4). */
const STRING = "string";

/** Why three of the diff fields are not the width `CharacterData` uses (`sub_45E0D0` vs `sub_45D840`). */
const STAT_DIFF_WIDTH_WARNINGS: Record<string, string | undefined> = {
  unknown26: " - u32 here, a single byte in CharacterData",
  str: " - ONE byte here, two in CharacterData",
  dex: " - ONE byte here, two in CharacterData",
  int: " - ONE byte here, two in CharacterData",
  luk: " - ONE byte here, two in CharacterData",
  fame: " - u32 here, two bytes in CharacterData",
};

export const PACKETS: readonly PacketSchema[] = [
  // ---------------------------------------------------------------- login stage, client -> server
  {
    opcode: login.CLIENT_OPCODE.loginRequest,
    direction: "c2s",
    stage: "login",
    name: "loginRequest",
    status: "byte-exact",
    evidence: "FINDINGS 4.8 (CTitle)",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [
      { name: "account", type: STRING, note: "the CTitle input boxes' contents, no encoding applied" },
      { name: "password", type: STRING },
    ],
  },
  {
    opcode: login.CLIENT_OPCODE.worldSelect,
    direction: "c2s",
    stage: "login",
    name: "worldSelect",
    status: "byte-exact",
    evidence: "FINDINGS 4.8 (CWorldSelect)",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [{ name: "worldIndex", type: "u8" }],
  },
  {
    opcode: login.CLIENT_OPCODE.selectCharacter,
    direction: "c2s",
    stage: "login",
    name: "selectCharacter",
    status: "byte-exact",
    evidence: "FINDINGS 4.8 (CCharSelect, sub_431620)",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [{ name: "characterId", type: "u32" }],
  },
  {
    opcode: login.CLIENT_OPCODE.handshakeReply,
    direction: "c2s",
    stage: "login",
    name: "handshakeReply",
    status: "byte-exact",
    evidence: "FINDINGS 2 / 4.8: the id the 0x03 reply handed out, echoed to the game server",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [{ name: "characterId", type: "u32", note: "CWvsApp+0x14, set from the 0x03 reply" }],
  },
  {
    opcode: login.CLIENT_OPCODE.createCharacter,
    direction: "c2s",
    stage: "login",
    name: "createCharacter",
    status: "byte-exact",
    evidence: "FINDINGS 4.8 (name + the appearance the 0x06 dialog produced)",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [
      { name: "name", type: STRING },
      { name: "appearance", type: `u32[${login.CHECK_NAME_APPEARANCE_WORDS}]` },
    ],
  },
  {
    opcode: login.CLIENT_OPCODE.checkName,
    direction: "c2s",
    stage: "login",
    name: "checkName",
    status: "byte-exact",
    evidence: "FINDINGS 4.8 (sub_431620(1002))",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [
      { name: "name", type: STRING },
      { name: "appearance", type: `u32[${login.CHECK_NAME_APPEARANCE_WORDS}]` },
    ],
  },
  {
    opcode: login.CLIENT_OPCODE.deleteCharacter,
    direction: "c2s",
    stage: "login",
    name: "deleteCharacter",
    status: "byte-exact",
    evidence: "FINDINGS 4.8 (sub_431620(1001))",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [{ name: "characterId", type: "u32" }],
  },
  {
    opcode: login.CLIENT_OPCODE.echoReply,
    direction: "c2s",
    stage: "any",
    name: "echo",
    status: "byte-exact",
    evidence: "FINDINGS 4.2 / 4.30 (sub_43B170 case 8 -> sub_43B280: the client echoes the u32 back)",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [{ name: "value", type: "u32", note: "the value the server pinged with, echoed verbatim" }],
  },

  {
    opcode: replies.LOGIN_OPCODE.echo,
    direction: "s2c",
    stage: "any",
    name: "echo",
    status: "byte-exact",
    evidence: "FINDINGS 4.2 / 4.30 (the heartbeat: net/heartbeat.ts sends it, the client's echo proves the session is alive)",
    codecs: ["encodeEcho"],
    fields: [{ name: "value", type: "u32", note: "a counter in this build; the client echoes it and reads nothing into it" }],
  },

  // ---------------------------------------------------------------- login stage, server -> client
  {
    opcode: replies.LOGIN_OPCODE.login,
    direction: "s2c",
    stage: "login",
    name: "loginResult",
    status: "partial",
    evidence: "FINDINGS 4.8 (sub_4D0DB0 switches on the result byte)",
    codecs: ["encodeLoginResult"],
    fields: [
      { name: "result", type: "u8", note: "LOGIN_RESULT: 0/1/>=10 continue, 2..9/0xff are refusals" },
      { name: "worlds", type: "u8 count + {string name, u32 unknownId}[]", note: "only when result continues" },
    ],
  },
  {
    opcode: replies.LOGIN_OPCODE.worldSelect,
    direction: "s2c",
    stage: "login",
    name: "worldSelectResult",
    status: "partial",
    evidence: "FINDINGS 4.8",
    codecs: ["encodeWorldSelectResult"],
    fields: [
      { name: "result", type: "u8" },
      { name: "characters", type: "u8 count + CharacterData[]", note: "the client fills exactly three slots and zeroes the rest (sub_54E250)" },
    ],
  },
  {
    opcode: replies.LOGIN_OPCODE.selectCharacter,
    direction: "s2c",
    stage: "login",
    name: "selectCharacterResult",
    status: "byte-exact",
    evidence: "FINDINGS 4.8: result byte, then the game server address, then the id to echo",
    codecs: ["encodeSelectCharacterResult"],
    fields: [
      { name: "result", type: "u8" },
      { name: "ip", type: "u32", note: "network byte order (`ipv4WireValue`)" },
      { name: "port", type: "u16" },
      { name: "characterId", type: "u32" },
    ],
  },
  {
    opcode: replies.LOGIN_OPCODE.nameCheckResult,
    direction: "s2c",
    stage: "login",
    name: "nameCheckResult",
    status: "byte-exact",
    evidence: "FINDINGS 4.8",
    codecs: ["encodeNameCheckResult"],
    fields: [
      { name: "name", type: STRING },
      { name: "result", type: "s8", note: "NAME_CHECK_RESULT" },
    ],
  },
  {
    opcode: replies.LOGIN_OPCODE.createCharacter,
    direction: "s2c",
    stage: "login",
    name: "createCharacterResult",
    status: "partial",
    evidence: "FINDINGS 4.8 / 4.9: result byte plus a whole CharacterData",
    codecs: ["encodeCreateCharacterResult"],
    fields: [
      { name: "result", type: "u8", note: "CREATE_CHARACTER_RESULT: **0 = failed**, non-zero = a record follows (sub_4329A0)" },
      { name: "character", type: "CharacterData", note: "chardata.ts, flags tell which blocks follow" },
    ],
  },
  {
    opcode: replies.LOGIN_OPCODE.deleteResult,
    direction: "s2c",
    stage: "login",
    name: "deleteResult",
    status: "byte-exact",
    evidence: "FINDINGS 4.8",
    codecs: ["encodeDeleteCharacterResult"],
    fields: [
      { name: "characterId", type: "u32", note: "the id the client sent; it must match a slot on screen" },
      { name: "flag", type: "u8", note: "non-zero: 0 makes the client throw CTerminateException 570425350 (sub_432890)" },
    ],
  },

  // ---------------------------------------------------------------- field stage, client -> server
  {
    opcode: field.CLIENT_FIELD_OPCODE.userMove,
    direction: "c2s",
    stage: "field",
    name: "userMove",
    status: "byte-exact",
    evidence: "FINDINGS 4.11.6 (CVecCtrlUser::SendMove, sub_542C40)",
    codecs: ["readClientUserMove", "encodeClientUserMove"],
    fields: [
      { name: "stageByte", type: "u8", note: "*(CStage+0x9C); role not located, kept in place" },
      { name: "path", type: "CMovePath", note: "movepath.ts, 14 bytes per element" },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.interact,
    direction: "c2s",
    stage: "field",
    name: "interact",
    status: "byte-exact",
    evidence: "FINDINGS 4.11.6 / 4.13 / 4.32 (CField::SendInteract, sub_472590)",
    codecs: ["readClientInteract", "encodeClientInteract"],
    fields: [
      {
        name: "kind",
        type: "s32",
        note: "-1 = the object under the cursor, 0 = the revive dialog (sub_4E9E70), a map id = the GM /헉맵 command",
      },
      { name: "name", type: STRING, note: "the clicked object's name; empty for a revive" },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.attack,
    direction: "c2s",
    stage: "field",
    name: "attack",
    status: "byte-exact",
    evidence: "FINDINGS 4.13.1 (sub_512F90)",
    codecs: ["readClientAttack", "encodeClientAttack"],
    fields: [
      { name: "hits", type: "u8 (nibble)", note: "damage numbers per mob, 1..15" },
      { name: "targetCount", type: "u8 (nibble)", note: "sub_491E90 returns at most 6" },
      { name: "clickedMobId", type: "u32" },
      { name: "facingLeft", type: "bool (bit 7)" },
      { name: "action", type: "u8 (bits 0..6)", note: "index into dword_5B2144" },
      { name: "targetCap", type: "u8", note: "sub_4BE8B0, clamped to 0..6" },
      {
        name: "targets",
        type: "u32 mobId, s8 hitAnimation, u16 x, u16 y, u16 sequence, u16 damage[hits]",
      },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.magicAttack,
    direction: "c2s",
    stage: "field",
    name: "magicAttack",
    status: "partial",
    evidence: "FINDINGS 4.13.1b (sub_513C80): same record, one extra u16, nibble is a presence flag",
    codecs: ["readClientAttack", "encodeClientAttack"],
    fields: [
      { name: "hits", type: "u8 (nibble)" },
      { name: "hasSecondObject", type: "u8 (nibble)", note: "16 * (v129 != nullptr), so 0 or 1" },
      { name: "clickedMobId", type: "u32" },
      { name: "facingLeft", type: "bool (bit 7)" },
      { name: "action", type: "u8 (bits 0..6)" },
      { name: "targetCap", type: "u8" },
      { name: "unknownU16", type: "u16", note: "read off the local user before the packet is built" },
      { name: "targets", type: "same 11-byte record + hits damages" },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.skillAttack,
    direction: "c2s",
    stage: "field",
    name: "skillAttack",
    status: "partial",
    evidence: "FINDINGS 4.13.1b (sub_514D30): the whole record sits under if (v36 != nullptr)",
    codecs: ["readClientAttack", "encodeClientAttack"],
    fields: [
      { name: "hits", type: "u8 (nibble)" },
      { name: "hasSecondObject", type: "u8 (nibble)" },
      { name: "clickedMobId", type: "u32" },
      { name: "facingLeft", type: "bool (bit 7)" },
      { name: "action", type: "u8 (bits 0..6)" },
      { name: "targetCap", type: "u8" },
      { name: "targets", type: "same 11-byte record + hits damages" },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.chat,
    direction: "c2s",
    stage: "field",
    name: "chat",
    status: "byte-exact",
    evidence: "FINDINGS 4.13 / 4.26 (sub_470C70: one string, and nothing else)",
    codecs: ["readClientChat", "encodeClientChat", "describeClientChat"],
    fields: [
      { name: "text", type: STRING, note: "kept as bytes: the server relays it, it never reads it" },
    ],
  },
  {
    opcode: 0x22,
    direction: "c2s",
    stage: "field",
    name: "gmNotice",
    status: "partial",
    evidence: "FINDINGS 4.13 (/헉공지 0, /헉경고 1, sub_470E10) - only reachable with the GM flag",
    codecs: [],
    fields: [
      { name: "kind", type: "u8", note: "0 = notice, 1 = warning" },
      { name: "text", type: STRING },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.userRequest,
    direction: "c2s",
    stage: "field",
    name: "userRequest",
    status: "byte-exact",
    evidence:
      "FINDINGS 4.31 (sub_4717D0: the kind byte is `(hasText + 1) | 4` at .text:00471859, the name is written before the text)",
    codecs: ["readClientUserRequest", "encodeClientUserRequest", "describeClientUserRequest"],
    fields: [
      {
        name: "kind",
        type: "u8",
        note: "0x05 find / 0x06 whisper / 0x22 the client's own balloon request (0x20 | 2)",
      },
      { name: "name", type: STRING, note: "the target by name - the packet carries no character id" },
      { name: "text", type: STRING, note: "only the kinds with a body carry it" },
    ],
  },
  {
    opcode: 0x25,
    direction: "c2s",
    stage: "field",
    name: "trade",
    status: "skeleton",
    evidence: "FINDINGS 4.13 (/교환, sub_471A40, and the trade dialogs)",
    codecs: [],
    fields: [],
  },
  {
    opcode: 0x26,
    direction: "c2s",
    stage: "field",
    name: "party",
    status: "partial",
    evidence: "FINDINGS 4.13 (party create/leave/invite/kick, sub_471CD0..sub_4722E0)",
    codecs: [],
    fields: [
      { name: "op", type: "u8", note: "which party action; the invite reply is `u8 2 + u32 inviterId`" },
    ],
  },
  {
    opcode: 0x27,
    direction: "c2s",
    stage: "field",
    name: "gmValues",
    status: "partial",
    evidence: "FINDINGS 4.13 (/헉창조 0 + u32, /헉소멸 1 + u8, /헉경험치 2 + u32; sub_470E10)",
    codecs: [],
    fields: [
      { name: "op", type: "u8" },
      { name: "value", type: "u32 or u8", note: "width depends on op; GM flag only" },
    ],
  },

  // ---------------------------------------------------------------- field stage, server -> client
  {
    opcode: field.FIELD_OPCODE.setField,
    direction: "s2c",
    stage: "field",
    name: "setField",
    status: "partial",
    evidence: "FINDINGS 4.11 (CStage base, sub_4C2780)",
    codecs: ["readSetField", "encodeSetField"],
    fields: [
      { name: "mode", type: "u8", note: "spawn mode, kept at CField+156 (sub_468E00)" },
      { name: "full", type: "u8", note: "non-zero means the three seed parts and a CharacterData follow" },
      { name: "randomSeedA", type: "u32", note: "field RNG seed part 1 (sub_4C7930 -> sub_48A900)" },
      { name: "randomSeedB", type: "u32", note: "seed part 2 - the client's Random() is the inverse" },
      { name: "randomSeedC", type: "u32", note: "seed part 3 - damage rolls become reproducible" },
      { name: "character", type: "CharacterData", note: "its mapId field is what gets loaded (Map/Map/%09d.img)" },
    ],
  },
  {
    opcode: field.FIELD_OPCODE.userEffect,
    direction: "s2c",
    stage: "field",
    name: "userEffect",
    status: "partial",
    evidence: "FINDINGS 4.27 (CUserPool 0x29 -> sub_522300; the id is read by sub_51D590)",
    codecs: ["readUserEffect", "encodeUserEffect", "describeUserEffect"],
    fields: [
      { name: "characterId", type: "u32", note: "resolved in the pool; an unknown id drops the packet" },
      { name: "effect", type: "u8", note: "0 = level-up; 1 reads another u32 and is not located" },
    ],
  },
  {
    opcode: field.FIELD_OPCODE.userMessage,
    direction: "s2c",
    stage: "field",
    name: "userMessage",
    status: "partial",
    evidence:
      "FINDINGS 4.26 / 4.31 (CField 0x1A -> sub_472910; its four jump-table cases are 0x09, 0x0A, 0x12, 0x22)",
    codecs: [
      "readUserChat",
      "encodeUserChat",
      "describeUserChat",
      "readUserFindAnswer",
      "encodeUserFindAnswer",
      "describeUserFindAnswer",
      "readUserWhisperAnswer",
      "encodeUserWhisperAnswer",
      "describeUserWhisperAnswer",
    ],
    fields: [
      {
        name: "subOp",
        type: "u8",
        note:
          "0x12 chat (also the delivered whisper's line) / 0x09 find answer / 0x0A whisper answer / " +
          "0x22 whisper refusal (shape known, no client input sets it - no codec)",
      },
      { name: "name", type: STRING, note: "the speaker - there is no character id in this packet" },
      {
        name: "text",
        type: STRING,
        note: "0x12 only; 0x09 has a u32 mapId instead, 0x0A a u8 flag, 0x22 nothing else",
      },
    ],
  },
  {
    opcode: field.FIELD_OPCODE.userEnterField,
    direction: "s2c",
    stage: "field",
    name: "userEnterField",
    status: "partial",
    evidence: "FINDINGS 4.11 (CUserPool 0x1C, sub_51CFE0 + CUserRemote::Init sub_520680)",
    codecs: ["readUserEnterField", "writeUserEnterField", "encodeUserEnterField"],
    fields: [
      { name: "characterId", type: "u32", note: "equal to our own id means 'this is me', the client skips it" },
      { name: "name", type: STRING },
      { name: "unknown64", type: "u8" },
      { name: "avatarKey", type: "u32" },
      { name: "avatarItems", type: "u32[] until 0" },
      { name: "x", type: "s16" },
      { name: "y", type: "s16" },
      { name: "action", type: "u8" },
      { name: "foothold", type: "u16" },
    ],
  },
  {
    opcode: field.FIELD_OPCODE.userLeaveField,
    direction: "s2c",
    stage: "field",
    name: "userLeaveField",
    status: "byte-exact",
    evidence: "FINDINGS 4.11 (CUserPool 0x1D, sub_51D280)",
    codecs: ["encodeUserLeaveField"],
    fields: [{ name: "characterId", type: "u32" }],
  },
  {
    opcode: field.FIELD_OPCODE.userMove,
    direction: "s2c",
    stage: "field",
    name: "userMove",
    status: "byte-exact",
    evidence: "FINDINGS 4.11 (CUserPool 0x22, sub_51D590 branch)",
    codecs: ["readUserMove", "encodeUserMove"],
    fields: [
      { name: "characterId", type: "u32" },
      { name: "path", type: "CMovePath" },
    ],
  },
  {
    opcode: mob.MOB_OPCODE.enterField,
    direction: "s2c",
    stage: "field",
    name: "mobEnterField",
    status: "partial",
    evidence: "FINDINGS 4.12.1/4.15 (CMobPool 0x2F, sub_4924A0 + CMob::Init sub_484ED0; sent for every map spawn)",
    codecs: ["encodeMobEnterField", "readMobEnterField", "describeMobEnterField"],
    fields: [
      { name: "mobId", type: "u32", note: "pool key; a second 0x2F for a known id has no fields at all" },
      { name: "templateId", type: "u32", note: "read only when the id is new: 1210100 = Mob/0120100.img" },
      { name: "x", type: "s16" },
      { name: "y", type: "s16" },
      { name: "facing", type: "u8", note: "only bit 0 is read (0 = right, 1 = left)" },
      { name: "unknownA", type: "u16", note: "ZMap lookup only, meaning open; a miss is handled" },
      { name: "unknownB", type: "u16", note: "second lookup, feeds sub_53D310 with a template field" },
      { name: "animFlags", type: "u32", note: "bits 1..0x40 switch on one channel each (sub_4C6CE0)" },
      { name: "animChannels", type: "s16 x2 per bit", note: "(index, delay in 100 ms ticks)" },
    ],
  },
  {
    opcode: mob.MOB_OPCODE.move,
    direction: "s2c",
    stage: "field",
    name: "mobMove",
    status: "partial",
    evidence: "FINDINGS 4.16 (CMobPool 0x33, sub_492380 -> sub_488BC0; .lst .text:00488BC0)",
    codecs: ["encodeMobMove", "readMobMove", "describeMobMove"],
    fields: [
      { name: "mobId", type: "u32", note: "pool lookup by id (sub_492400)" },
      { name: "actionByte", type: "u8", note: "bit 7 = keep the current animation, bit 0 = facing, bits 1..6 = action index" },
      { name: "value", type: "u32", note: "open meaning; reaches sub_488E30 for the attack actions only, so 0 for a walk" },
      { name: "path", type: "CMovePath", note: "read after the u32, always (sub_4967C0 -> sub_4953A0)" },
    ],
  },
  {
    opcode: mob.MOB_OPCODE.leaveDelayed,
    direction: "s2c",
    stage: "field",
    name: "mobLeaveDelayed",
    status: "byte-exact",
    evidence: "FINDINGS 4.16/4.17 (CMobPool 0x30, sub_4926B0; the timed queue sub_492100 plays the die action)",
    codecs: ["encodeMobLeaveDelayed", "readMobLeaveDelayed", "describeMobLeaveDelayed"],
    fields: [
      { name: "mobId", type: "u32" },
      {
        name: "delayMs",
        type: "s16",
        note: ">= 0: the die animation starts that many ms from now (0 = the kill case); < 0: remove at once, unless the sprite is still animating (sub_491AB0 -> sub_485520)",
      },
    ],
  },
  {
    opcode: mob.MOB_OPCODE.presence,
    direction: "s2c",
    stage: "field",
    name: "mobPresence",
    status: "byte-exact",
    evidence: "FINDINGS 4.16/4.17 (CMobPool 0x31, sub_4927B0 -> sub_491630 flag != 0 / sub_491830 flag == 0)",
    codecs: ["encodeMobRemove", "encodeMobAppear", "readMobPresence", "describeMobPresence"],
    fields: [
      {
        name: "flag",
        type: "u8",
        note: "0 = remove (sub_491830: flash off if the sprite is busy, then unlink); != 0 = keep, or create from templateId + the 0x2F body below, then flash it (sub_485330(mob, 1))",
      },
      { name: "mobId", type: "u32" },
      { name: "templateId", type: "u32", note: "flag != 0 and the id is unknown only; a known id ends the packet here" },
      {
        name: "tail",
        type: "= the 0x2F body after templateId",
        note: "CMob::Init reads it: s16 x, s16 y, u8 facing, u16 x2, the animation block",
      },
    ],
  },
  {
    opcode: mob.MOB_OPCODE.unusedLookup,
    direction: "s2c",
    stage: "field",
    name: "mobLookupSkeleton",
    status: "skeleton",
    evidence: "FINDINGS 4.16: sub_492380 has no branch for 0x32/0x36 (only the u32 mobId lookup)",
    codecs: [],
    fields: [],
  },
  {
    opcode: 0x36,
    direction: "s2c",
    stage: "field",
    name: "mobLookupSkeleton2",
    status: "skeleton",
    evidence: "FINDINGS 4.16: sub_492380 has no branch for 0x32/0x36 (only the u32 mobId lookup)",
    codecs: [],
    fields: [],
  },
  {
    opcode: 0x34,
    direction: "s2c",
    stage: "field",
    name: "mobStat",
    status: "byte-exact",
    evidence: "FINDINGS 4.17 (CMobPool 0x34, sub_488D90: the u16 is the mob's MP - mob+132, compared against each attack's conMP in sub_487D10 - and it puts the mob into its flash state)",
    codecs: ["encodeMobStat", "readMobStat", "describeMobStat"],
    fields: [
      { name: "mobId", type: "u32" },
      { name: "mp", type: "u16", note: "the mob's MP; the only reader is the attack picker's conMP test, and the handler's other effect (state -> 4/5, flash on) is what makes a hit animate" },
    ],
  },
  {
    opcode: 0x2e,
    direction: "s2c",
    stage: "field",
    name: "mobPoolSkeleton",
    status: "skeleton",
    evidence: "FINDINGS 4.12: CMobPool 0x2E..0x37 dispatch (sub_492330)",
    codecs: [],
    fields: [],
  },
  {
    opcode: mob.MOB_OPCODE.anim,
    direction: "s2c",
    stage: "field",
    name: "mobAnim",
    status: "byte-exact",
    evidence: "FINDINGS 4.20 (CMobPool 0x35, sub_492380 case '5' -> sub_488E10 = sub_4C6CE0(mob+136, packet, now), the same decoder CMob::Init uses for the 0x2F block)",
    codecs: ["encodeMobAnim", "readMobAnim", "describeMobAnim"],
    fields: [
      { name: "mobId", type: "u32", note: "an id the client does not know returns before reading the block" },
      { name: "flags", type: "u32", note: "7 channels, bit 1 << i" },
      { name: "channel[i]", type: "s16 index + s16 delay", note: "per set bit; delay is in 100 ms ticks" },
    ],
  },
  {
    opcode: field.CLIENT_FIELD_OPCODE.mobAttack,
    direction: "c2s",
    stage: "field",
    name: "clientMobAttack",
    status: "partial",
    evidence: "FINDINGS 4.20 (sub_4885D0 -> sub_4A1EA0(..., 44, ...); reached from the mob AI update sub_4862C0 line 141468, from the action hit frame sub_487A30 line 142636 and from the reset path line 141581)",
    codecs: ["readClientMobAttack", "encodeClientMobAttack"],
    fields: [
      { name: "mobId", type: "u32" },
      { name: "flags", type: "u8", note: "bit 0 = a 71-in-101 roll of the client's own generator; high nibble = the caller (1 = the AI's attack, 0 = the hit frame / reset)" },
      { name: "actionByte", type: "u8", note: "(action << 1) | facing, the 0x33 encoding; 0xFF is the reset form" },
      { name: "position", type: "u32", note: "x | y << 16, only for the attack types with an origin (sub_487D10 writes 0 otherwise)" },
      { name: "tail", type: "bytes", note: "appended by sub_495880 -> sub_495620 (u16, u16, u8, then a list); NOT decoded, kept verbatim" },
    ],
  },
  {
    opcode: npc.NPC_OPCODE.enterField,
    direction: "s2c",
    stage: "field",
    name: "npcEnterField",
    status: "partial",
    evidence: "FINDINGS 4.19 (CNpcPool 0x39, sub_49F6C0 -> sub_498CF0; a known id ends the packet)",
    codecs: ["encodeNpcEnterField", "readNpcEnterField", "describeNpcEnterField"],
    fields: [
      { name: "npcId", type: "u32", note: "the pool key; a known id only sets bit 0 of npc+24 (a refresh) and reads nothing else" },
      { name: "templateId", type: "u32", note: "unknown ids only: Npc/%07d.img, cached by sub_49CB30" },
      { name: "x", type: "s16" },
      { name: "y", type: "s16" },
      { name: "facing", type: "u8", note: "npc+20; the map's life.f" },
      { name: "lookupKey", type: "u16", note: "sub_489800 lookup whose result goes to the vecctrl; a miss is handled, so 0" },
      { name: "pointX", type: "s16", note: "npc+16; nothing located names the pair, so 0" },
      { name: "pointY", type: "s16", note: "npc+17" },
    ],
  },
  {
    opcode: npc.NPC_OPCODE.leaveField,
    direction: "s2c",
    stage: "field",
    name: "npcLeaveField",
    status: "byte-exact",
    evidence: "FINDINGS 4.19 (CNpcPool 0x3A, sub_49F810: clear bit 0, unlink only when npc+24 becomes 0)",
    codecs: ["encodeNpcLeaveField", "readNpcId"],
    fields: [{ name: "npcId", type: "u32" }],
  },
  {
    opcode: npc.NPC_OPCODE.stateToggle,
    direction: "s2c",
    stage: "field",
    name: "npcStateToggle",
    status: "byte-exact",
    evidence: "FINDINGS 4.19 (CNpcPool 0x3B, sub_49F970 -> sub_49F260/sub_49F380: bit 1 + sub_499760(npc+16, flag))",
    codecs: ["encodeNpcState", "readNpcState"],
    fields: [
      { name: "flag", type: "u8", note: "read BEFORE the id, and the id is read for both values; an unknown id with flag != 0 creates the NPC (this server does not send that form)" },
      { name: "npcId", type: "u32" },
    ],
  },
  {
    opcode: 0x3c,
    direction: "s2c",
    stage: "field",
    name: "npcLookupU32",
    status: "partial",
    evidence: "FINDINGS 4.19 (sub_49F5B0: u32 id + a pool lookup; 0x3C/0x3E/0x3F/0x40 then stop, 0x38/0x41 have no case at all)",
    codecs: ["readNpcId"],
    fields: [{ name: "npcId", type: "u32", note: "0x3E..0x40 are the same packet; what the client does with the hit is not located" }],
  },
  {
    opcode: npc.NPC_OPCODE.update,
    direction: "s2c",
    stage: "field",
    name: "npcAction",
    status: "partial",
    evidence: "FINDINGS 4.19 (sub_49A280: two s8 indices into the template's arrays, then sub_4967C0 = the CMovePath reader)",
    codecs: [],
    fields: [
      { name: "first", type: "s8", note: "negative and non-negative take different branches (two per-template arrays at npc+19+32/+36)" },
      { name: "second", type: "s8" },
      { name: "path", type: "CMovePath", note: "read by sub_4967C0 when the template's arrays hold those indices - i.e. an NPC can be made to walk" },
    ],
  },
  {
    opcode: drop.DROP_OPCODE.appear,
    direction: "s2c",
    stage: "field",
    name: "dropAppear",
    status: "partial",
    evidence: "FINDINGS 4.18 (CRewardPool 0x43, sub_4A88A0; only 0x43/0x44 reach sub_4A8870)",
    codecs: ["encodeDropAppear", "readDropAppear", "describeDropAppear"],
    fields: [
      {
        name: "kind",
        type: "u8",
        note: "DROP_KIND; 0 and 1 also carry the monster below, 2 is a placed drop (a v1.11 client has no request for one)",
      },
      { name: "dropId", type: "u32", note: "the pool key; a repeat of a live id only refreshes the entry" },
      {
        name: "money",
        type: "u8",
        note: "a branch, not a flag: != 0 makes value mesos (Item/Special/0900.img, pile size by sub_4A9C10), 0 makes it an item id (Item/<cat>/<id>.img/info/iconRaw)",
      },
      { name: "value", type: "u32", note: "meso amount or item id, see money" },
      { name: "x", type: "s16" },
      { name: "y", type: "s16", note: "the ground line - the client draws the icon 16 px above it" },
      {
        name: "mobId",
        type: "u32",
        note: "kind <= 1 only; looked up in CMobPool and, when the monster is still there, the icon's current position is taken from mob+360/+364",
      },
      { name: "mobX", type: "s16", note: "kind <= 1 only; the fallback for that position" },
      { name: "mobY", type: "s16", note: "kind <= 1 only" },
      {
        name: "unknown",
        type: "s16",
        note: "kind <= 1 only; read unconditionally (.lst 004A8C4A) and never used as a coordinate, so this server writes 0",
      },
    ],
  },
  {
    opcode: drop.DROP_OPCODE.remove,
    direction: "s2c",
    stage: "field",
    name: "dropRemove",
    status: "byte-exact",
    evidence: "FINDINGS 4.18 (CRewardPool 0x44, sub_4A95B0)",
    codecs: ["encodeDropRemove", "readDropRemove", "describeDropRemove"],
    fields: [
      { name: "kind", type: "u8", note: "DROP_REMOVE_KIND: 0 gone, 1 vanished with an effect, 2 taken" },
      { name: "dropId", type: "u32", note: "an unknown id ends the handler with no reply and no error" },
      {
        name: "characterId",
        type: "u32",
        note: "kind 2 only; the taker's client plays PickUpItem (100 ms) and every client flies the icon to them",
      },
    ],
  },
  {
    opcode: inventory.INVENTORY_OPCODE,
    direction: "s2c",
    stage: "field",
    name: "inventoryChange",
    status: "byte-exact",
    evidence: "FINDINGS 4.18 (CWvsApp sub_55A900 case 0x0B -> sub_55BAB0, items via sub_45E6A0)",
    codecs: ["encodeInventoryChange", "readInventoryChange", "describeInventoryChange"],
    fields: [
      {
        name: "result",
        type: "u8",
        note: "!= 0 clears the client's field-request throttle (app+6/app+7); the value itself is not compared",
      },
      { name: "count", type: "u8", note: "entries that follow" },
      { name: "op", type: "u8", note: "INVENTORY_OP: 0 put, 1 key, 2 swap, 3 clear" },
      {
        name: "inventory",
        type: "u8",
        note: "1 equip, 2 consume, 3 etc, 4 cash; a worn equip is addressed by its negative slot instead",
      },
      { name: "slot", type: "s16", note: "op 0/1/3; op 2 carries a second one, op 1 a u16 key instead" },
      {
        name: "item",
        type: "ItemSlot",
        note: "op 0 only, with no category byte: the tab above is the constructor hint the client passes to sub_45E6A0",
      },
    ],
  },
  {
    opcode: drop.LOOT_OPCODE,
    direction: "s2c",
    stage: "field",
    name: "lootNotice",
    status: "byte-exact",
    evidence: "FINDINGS 4.18 (CWvsApp sub_55A900 case 0x11 -> sub_55C130; three message shapes)",
    codecs: ["encodeLootNotice", "readLootNotice", "describeLootNotice"],
    fields: [
      { name: "kind", type: "u8", note: "1 mesos, 0 item; any other byte is the 'no more items' line" },
      { name: "amount", type: "u32", note: "kind 1 only" },
      { name: "itemId", type: "u32", note: "kind 0 only" },
      { name: "count", type: "u32", note: "kind 0 only; a count of 1 prints without the number" },
    ],
  },
  {
    opcode: stat.STAT_OPCODE,
    direction: "s2c",
    stage: "field",
    name: "statUpdate",
    status: "byte-exact",
    evidence: "FINDINGS 4.21 (CWvsApp sub_55A900 case 0x0D -> sub_55BEB0; the diff reader is sub_45E0D0)",
    codecs: ["encodeStatUpdate", "readStatUpdate", "describeStatUpdate"],
    // The 19 optional fields are described from the codec's own table - the flag of entry `i` is
    // `1 << i`, and three widths differ from `CharacterData` (FINDINGS 4.21.1).
    fields: [
      {
        name: "ack",
        type: "u8",
        note: "!= 0 clears the client's pending-request gate (CWvsApp+24/+28); the value itself is never compared",
      },
      { name: "flags", type: "u32", note: "one bit per field below, read from 0x01 upwards (0x7ffff is all of them)" },
      ...stat.STAT_DIFF_FIELDS.map((field, index) => ({
        name: field.name,
        type: `u${field.bytes * 8}`,
        note: `flag 0x${(1 << index).toString(16)}${STAT_DIFF_WIDTH_WARNINGS[field.name] ?? ""}`,
      })),
      {
        name: "panelFlags",
        type: "u32",
        note: "0 = nothing more (the client returns immediately); the panel/buff block itself is not decoded yet",
      },
    ],
  },
  {
    opcode: field.FIELD_OPCODE.requestRelease,
    direction: "s2c",
    stage: "field",
    name: "requestRelease",
    status: "byte-exact",
    evidence: "FINDINGS 4.11.6 (sub_4728B0: an empty packet that only clears CWvsApp+24/+28)",
    codecs: ["encodeFieldRequestRelease"],
    // One byte and no body: the client's handler reads nothing at all.
    fields: [],
  },
  {
    opcode: shop.SHOP_OPEN_OPCODE,
    direction: "s2c",
    stage: "field",
    name: "shopOpen",
    status: "byte-exact",
    evidence: "FINDINGS 4.22 (sub_4B73A0 case 0x4A -> sub_4B3780; opened by an NPC click, 0x33)",
    codecs: ["encodeShopOpen", "readShopOpen", "describeShopOpen"],
    fields: [
      { name: "shopId", type: "u32", note: "dlg+144; the client never sends it back" },
      { name: "count", type: "u16", note: "rows that follow; 0 is a legal empty shop" },
      { name: "itemId", type: "u32", note: "per row" },
      { name: "price", type: "u32", note: "per row; the client prints it and charges it to itself" },
      { name: "cash", type: "u8[8]", note: "per row, itemId / 10000 == 207 only, copied verbatim" },
      {
        name: "maxCount",
        type: "u16",
        note: "per row; the buy dialog's default and its cap (sub_4B6B40 reads the row's +32)",
      },
    ],
  },
  {
    opcode: shop.SHOP_RESULT_OPCODE,
    direction: "s2c",
    stage: "field",
    name: "shopResult",
    status: "byte-exact",
    evidence: "FINDINGS 4.22 (sub_4B73A0 case 0x4B: one u8, then one of the client's own messages)",
    codecs: ["encodeShopResult", "readShopResult", "describeShopResult"],
    fields: [
      {
        name: "code",
        type: "u8",
        note: "0 silent, 1/4 물품이 부족합니다, 2 현금이 부족합니다, 3 slots, >4 error; only legal while a request is in flight",
      },
    ],
  },
  {
    opcode: shop.CLIENT_SHOP_OPCODE,
    direction: "c2s",
    stage: "field",
    name: "shopRequest",
    status: "byte-exact",
    evidence: "FINDINGS 4.22 (sub_4B6B40 / sub_4B6E90 / sub_4B7130 / sub_4B3C80 on the CShopDlg buttons)",
    codecs: ["encodeClientShopRequest", "readClientShopRequest", "describeClientShopRequest"],
    fields: [
      { name: "action", type: "u8", note: "0 buy, 1 sell, 2 recharge, 3 close" },
      { name: "slot", type: "u16", note: "buy: the row index the client picked; sell/recharge: the inventory slot" },
      { name: "itemId", type: "u32", note: "buy and sell only" },
      { name: "count", type: "u16", note: "buy and sell only" },
    ],
  },
  {
    opcode: shop.CLIENT_OBJECT_CLICK_OPCODE,
    direction: "c2s",
    stage: "field",
    name: "objectClick",
    status: "byte-exact",
    evidence: "FINDINGS 4.22 (sub_55AF20, called by sub_4A7770's object-under-the-mouse pick)",
    codecs: ["encodeClientObjectClick", "readClientObjectClick", "describeClientObjectClick"],
    fields: [
      { name: "objectId", type: "u32", note: "the field object's runtime id - for an NPC the id 0x39 gave it" },
    ],
  },
  {
    opcode: quest.QUEST_TALK_OPCODE,
    direction: "s2c",
    stage: "field",
    name: "questTalk",
    status: "byte-exact",
    evidence: "FINDINGS 4.23 (sub_4A5910, the CQuestMan branch of sub_472770; 0x46/0x48 have none)",
    codecs: ["encodeQuestTalk", "readQuestTalk", "describeQuestTalk"],
    fields: [
      { name: "unknownA", type: "u8", note: "the packet opens with it; read by the client and never used again" },
      { name: "npcId", type: "u32", note: "ignored by the client just like unknownA; this server puts the NPC's pool id here" },
      { name: "subOp", type: "u8", note: "0 say, 1 confirm, 2 askText, 3 askNumber, 4 kind 4; >4 is dropped" },
      { name: "message", type: "string", note: "every sub-op; CP949 bytes behind a u16 length" },
      { name: "unknownA", type: "u8", note: "sub-op 0 only, stored by sub_535C60; meaning not decoded" },
      { name: "unknownB", type: "u8", note: "sub-op 0 only, stored by sub_535C60; meaning not decoded" },
      { name: "defaultText", type: "string", note: "sub-op 2 only: the edit box's initial text" },
      { name: "minLength", type: "s16", note: "sub-op 2 only, with maxLength; the client's own caller passes (4, 12)" },
      { name: "maxLength", type: "s16", note: "sub-op 2 only" },
      { name: "defaultValue", type: "u32", note: "sub-op 3 only: the edit box's initial value, shown as %d" },
      { name: "min", type: "u32", note: "sub-op 3 only, with max; the client's own mesos dialog passes (1, 1, mesos)" },
      { name: "max", type: "u32", note: "sub-op 3 only" },
    ],
  },
  {
    opcode: quest.QUEST_REPLY_OPCODE,
    direction: "c2s",
    stage: "field",
    name: "questReply",
    status: "byte-exact",
    evidence: "FINDINGS 4.23 (the five sub_4A5A80..sub_4A65C0 senders, all with sub_4A1EA0(&buf, 21, 0))",
    codecs: ["encodeQuestReply", "readQuestReply", "describeQuestReply"],
    fields: [
      { name: "subOp", type: "u8", note: "the sub-op the dialog was opened with, echoed back" },
      { name: "answer", type: "u8", note: "1 primary button/Enter, 0 the other button, 0xff closed without an answer" },
      { name: "text", type: "string", note: "sub-op 2 with answer 1: what the player typed" },
      { name: "value", type: "u32", note: "sub-op 3/4 with answer 1: the entered number / the chosen entry" },
    ],
  },
];

/** Every codec module, so `resolveCodec` can prove a catalogue name still exists. */
const CODEC_MODULES: readonly Record<string, unknown>[] = [
  chardata,
  drop,
  field,
  inventory,
  login,
  mob,
  movepath,
  npc,
  packet,
  quest,
  replies,
  shop,
  stat,
];

/**
 * Looks a catalogue `codecs` entry up by name across the protocol modules. Returns `undefined` for
 * a name that no longer exists - which is exactly what the test asserts never happens.
 */
export function resolveCodec(name: string): unknown {
  for (const module of CODEC_MODULES) {
    const value = module[name];
    if (typeof value === "function") return value;
  }
  return undefined;
}

/** The catalogue entry for one opcode, or `undefined` when this repo has no such row. */
export function findPacket(opcode: number, direction: PacketDirection, stage: PacketStage): PacketSchema | undefined {
  return PACKETS.find((entry) => entry.opcode === opcode && entry.direction === direction && entry.stage === stage);
}

/** Rows for one direction/stage pair, sorted by opcode - the order a table wants them in. */
export function packetsOf(direction: PacketDirection, stage: PacketStage): PacketSchema[] {
  return PACKETS.filter((entry) => entry.direction === direction && entry.stage === stage).sort(
    (a, b) => a.opcode - b.opcode,
  );
}

const STATUS_MARK: Record<PacketStatus, string> = {
  "byte-exact": "exact",
  partial: "part ",
  skeleton: "skel ",
};

/** `opcode  dir  status  name (fields)` - one line per packet, for the CLI and the docs. */
export function describePacketSchema(entry: PacketSchema): string {
  const fields = entry.fields.map((field) => `${field.name}:${field.type}`).join(", ");
  return (
    `0x${entry.opcode.toString(16).padStart(2, "0")}  ${entry.direction}  ${STATUS_MARK[entry.status]}  ` +
    `${entry.name}${fields === "" ? "" : ` (${fields})`}`
  );
}

/** The whole catalogue as text, grouped the way the tables in the docs are grouped. */
export function schemaText(): string {
  const groups: { direction: PacketDirection; stage: PacketStage; label: string }[] = [
    { direction: "c2s", stage: "any", label: "any stage c2s" },
    { direction: "s2c", stage: "any", label: "any stage s2c" },
    { direction: "c2s", stage: "login", label: "login c2s" },
    { direction: "s2c", stage: "login", label: "login s2c" },
    { direction: "c2s", stage: "field", label: "field c2s" },
    { direction: "s2c", stage: "field", label: "field s2c" },
  ];
  const lines: string[] = ["kms111 protocol catalogue (only packets with evidence are listed)"];
  for (const { direction, stage, label } of groups) {
    const rows = packetsOf(direction, stage);
    if (rows.length === 0) continue;
    lines.push(`\n${label}  (${rows.length}):`);
    for (const row of rows) {
      lines.push(`  ${describePacketSchema(row)}`);
      lines.push(`        evidence: ${row.evidence}`);
      if (row.codecs.length > 0) lines.push(`        codec:    ${row.codecs.join(", ")}`);
    }
  }
  const exact = PACKETS.filter((entry) => entry.status === "byte-exact").length;
  lines.push(
    `\n${PACKETS.length} packets: ${exact} byte-exact, ` +
      `${PACKETS.filter((entry) => entry.status === "partial").length} partial, ` +
      `${PACKETS.filter((entry) => entry.status === "skeleton").length} skeleton`,
  );
  return `${lines.join("\n")}\n`;
}

/** The same catalogue as JSON, for tooling that would rather not parse prose. */
export function schemaJson(): string {
  return `${JSON.stringify({ generatedBy: "src/protocol/schema.ts", packets: PACKETS }, null, 2)}\n`;
}
