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
import * as field from "./field.ts";
import * as login from "./login.ts";
import * as movepath from "./movepath.ts";
import * as packet from "./packet.ts";
import * as replies from "./replies.ts";

export type PacketDirection = "c2s" | "s2c";
export type PacketStage = "login" | "field";

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
    stage: "login",
    name: "echoReply",
    status: "byte-exact",
    evidence: "FINDINGS 4.2 (the client echoes the u32 the server sent; sub_43B280)",
    codecs: ["decodeClientPacket", "encodeClientPacket"],
    fields: [{ name: "value", type: "u32", note: "verbatim echo, role not located" }],
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
      { name: "result", type: "u8", note: "LOGIN_RESULT: 0/1/>=10 continue, 2..9 are refusals" },
      { name: "worlds", type: "u8 count + {u8 id, string name}[]", note: "only when result continues" },
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
      { name: "slots", type: "u8 count + {u8, u8}[]", note: "per channel occupancy, layout from sub_54E210" },
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
      { name: "result", type: "u8" },
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
      { name: "characterId", type: "u32" },
      { name: "flag", type: "u8" },
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
    evidence: "FINDINGS 4.11.6 / 4.13 (CField::SendInteract, sub_472590)",
    codecs: ["readClientInteract", "encodeClientInteract"],
    fields: [
      { name: "kind", type: "s32", note: "-1 for the portal/object under the cursor" },
      { name: "name", type: STRING, note: "the clicked object's name" },
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
    opcode: 0x12,
    direction: "c2s",
    stage: "field",
    name: "chat",
    status: "partial",
    evidence: "FINDINGS 4.13 (sub_470C70: one string)",
    codecs: [],
    fields: [{ name: "text", type: STRING }],
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
    opcode: 0x23,
    direction: "c2s",
    stage: "field",
    name: "whisper",
    status: "partial",
    evidence: "FINDINGS 4.13 (/귓속말, /헉추적; sub_4717D0, also sent by sub_472910)",
    codecs: [],
    fields: [
      { name: "target", type: STRING },
      { name: "text", type: STRING },
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
    opcode: 0x2f,
    direction: "s2c",
    stage: "field",
    name: "mobEnterField",
    status: "partial",
    evidence: "FINDINGS 4.12 / 4.12.1 (sub_4924A0 + CMob::Init sub_484ED0)",
    codecs: [],
    fields: [
      { name: "mobId", type: "u32", note: "stored at mob+120" },
      { name: "templateId", type: "u32", note: "only read when the pool has no such mob yet" },
      { name: "x", type: "s16", note: "mob+368 and mob+360" },
      { name: "y", type: "s16", note: "mob+372 and mob+364" },
      { name: "facing", type: "u8", note: "mob+272, bit 0 selects the hit rect" },
      { name: "unknownA", type: "u16", note: "only used for a hash-map lookup, never stored" },
      { name: "unknownB", type: "u16", note: "same lookup; its +32 field feeds sub_53D310" },
      {
        name: "animation",
        type: "u32 flags + 2 u16 per set bit (7 channels)",
        note: "sub_4C6CE0: (index, delay index), delay * 100 ms added to timeGetTime()",
      },
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
];

/** Every codec module, so `resolveCodec` can prove a catalogue name still exists. */
const CODEC_MODULES: readonly Record<string, unknown>[] = [chardata, field, login, movepath, packet, replies];

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
  const groups: [PacketDirection, PacketStage][] = [
    ["c2s", "login"],
    ["s2c", "login"],
    ["c2s", "field"],
    ["s2c", "field"],
  ];
  const lines: string[] = ["kms111 protocol catalogue (only packets with evidence are listed)"];
  for (const [direction, stage] of groups) {
    const rows = packetsOf(direction, stage);
    if (rows.length === 0) continue;
    lines.push(`\n${stage} ${direction}  (${rows.length}):`);
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
