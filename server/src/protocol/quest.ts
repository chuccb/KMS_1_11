/**
 * Talking to an NPC: the `0x47` dialog packet and the client's `0x15` answer.
 *
 * EVIDENCE (MapleStory.exe.c / .lst, FINDINGS 4.23)
 * ------------------------------------------------
 * `CField`'s dispatcher (`sub_472770`, 121121-121200) routes 70..72 to
 * `sub_4A58F0(dword_5C2048, opcode, packet)` - the `CQuestMan` global - and that function only
 * branches on 71:
 *
 *   `0x46` (70)  no handler. `0x47` (71) `sub_4A5910`. `0x48` (72) no handler.
 *
 * `sub_4A5910` (175012-175082), the whole packet:
 *
 *   guard            `CQuestMan+4 != 0` throws `CDisconnectException`: **one dialog at a time**,
 *                    the same shape as the shop dialog's in-flight flag.
 *   u8  unknown      read first, never used again (see below)
 *   u32 npcId        read, never used again
 *   u8  subOp        0..4; anything else is dropped without a word
 *   <body>           per subOp; the handler builds a `CUtilDlgEx` (0x3E4 bytes) and **runs it
 *                    modally** (`sub_461DD0` = `sub_5526D0(n3000, dlg+84)` loop, return `dlg+80`),
 *                    so the packet is fully consumed before the client answers.
 *
 * The two ignored fields are a fact about the build, not an oversight here: the dispatcher reads
 * exactly one byte, one u32 and one byte, and in every one of the five handlers the .lst shows the
 * second stack argument ([esp+8], i.e. the u32) is never referenced at all, while the first is
 * reused as the scratch slot the next byte-read lands in. So the client cannot care what they
 * hold. This server sends 0 in the first and the NPC's pool id (`0x39`'s `npcId`) in the second,
 * which is *our* meaning: it makes a capture self-describing.
 *
 * The five sub-ops (`sub_4A5A80` / `sub_4A5D00` / `sub_4A5F40` / `sub_4A6320` / `sub_4A65C0`,
 * 175089-175760) each call `sub_535AC0(dlg, type, 1, text)` first - `type` is the dialog's own kind
 * 0..4, and the `1` is the "this dialog came from the server" flag (every local caller passes 0) -
 * then one setter:
 *
 *   subOp 0 (`sub_4A5A80`)  `sub_535C60(dlg, a, b)`       payload: `str message`, `u8`, `u8`
 *   subOp 1 (`sub_4A5D00`)  `sub_535C80(dlg)`             payload: `str message`
 *   subOp 2 (`sub_4A5F40`)  `sub_535CE0(dlg, str, a, b)`  payload: `str message`, `str`, `s16`, `s16`
 *   subOp 3 (`sub_4A6320`)  `sub_535C90(dlg, a, b, c)`    payload: `str message`, `u32`, `u32`, `u32`
 *   subOp 4 (`sub_4A65C0`)  `sub_535E30(dlg)`             payload: `str message`
 *
 * `str` is `sub_432680` (58280): `u16 length` + raw bytes, i.e. CP949 (`protocol/cp949.ts`). The
 * bodies are byte for byte from the reader calls in each handler; `0x2F`'s rule applies - a field
 * the client ignores is still on the wire, so the shapes are exact even where the meaning is not.
 *
 * WHAT THE CLIENT DOES WITH THEM. `sub_5332C0` (311356-311392) is the dialog's key/button handler
 * and it switches on the *dialog kind* the setter chose, which is how each type's answer byte is
 * pinned down:
 *
 *   kind 0 (subOp 0)  the modal result is `0x2000`, or `0x2001` for the primary button (id 1, which
 *                     is also what Enter maps to in `sub_52BE10`), or 2 for ESC. `sub_4A5A80` turns
 *                     that into the answer byte: `1` for `0x2001`, `0` for `0x2000`, `0xFF` else.
 *   kind 1 (subOp 1)  `6` (IDYES) / `7` (IDNO) / 2 -> `1` / `0` / `0xFF`. The client's own local
 *                     user of this shape is the yes/no box, so this is the confirmation dialog.
 *   kind 3 (subOp 2)  answer `1` plus **the string the player typed** (`sub_4A61C0` reads the
 *                     dialog's text field); any other result is `0` and nothing follows. The
 *                     client's own user is 「길드명을 입력하십시오」 with the pair (4, 12) - so the
 *                     two `s16`s are a length range.
 *   kind 2 (subOp 3)  answer `1` plus **a `u32` the player entered** (the dialog's `+152`); the
 *                     client's own users are 「얼마를 버리시겠습니까?」/「얼마를 드리시겠습니까?」, which
 *                     pass (default, min, max) - e.g. `(1, 1, mesos)` and `(10, 10, min(mesos,
 *                     50000))`. So the three `u32`s are read in that order.
 *   kind 4 (subOp 4)  answer `1` plus a `u32` from the dialog's selection field, which
 *                     `sub_535AC0` initialises to `-1`; nothing local builds this type, so what it
 *                     shows is #L<number>#..#l selection runs (5338A0 / 533350 / 5333D0).
 *                     532E60 failed decompilation, but .lst shows it draws only the text frame;
 *                     the shared header Close remains. This game layer does not run menu scripts.
 *
 * The answer itself (`sub_4A1EA0(&buf, 21, 0)` + `sub_43AD50`, i.e. opcode **0x15**) is
 * `u8 subOp`, `u8 answer`, then the string / the u32 for the two shapes that carry one. `0xFF` is
 * this build's "the dialog ended without an answer" (only the two kinds that have a second button
 * can produce it).
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import { decodeCp949, encodeCp949 } from "./cp949.ts";

/** Server -> client: the NPC dialog (`CQuestMan::OnPacket`, `sub_4A5910`). */
export const QUEST_TALK_OPCODE = 0x47;

/**
 * Client -> server: the player's answer. The client builds it in five places, all with
 * `sub_4A1EA0(&buf, 21, 0)` - the same opcode number the *server* uses for other things, like every
 * two-directional opcode in this protocol (FINDINGS 4.6).
 */
export const QUEST_REPLY_OPCODE = 0x15;

/** The five sub-op numbers, named by what the client does with each (`sub_5332C0`). */
export const QUEST_TALK = {
  /** Dialog kind 0: a text box with a primary button (id 1 / Enter) and a second one. */
  say: 0,
  /** Dialog kind 1: the yes/no box (results 6/7). */
  confirm: 1,
  /** Dialog kind 3: text input - the answer carries the string the player typed. */
  askText: 2,
  /** Dialog kind 2: number input - the answer carries the number the player typed. */
  askNumber: 3,
  /** Dialog kind 4: #L<number># selection runs; the game layer has no original quest scripts. */
  menu: 4,
} as const;

/**
 * The answer byte, as the client's five senders produce it: `1` is the primary button (the one
 * Enter maps to), `0` is "the other way out of the dialog" (the second button, or the yes/no
 * "no"), and `0xFF` is ESC/closed-without-answering.
 */
export const QUEST_ANSWER = {
  /** The primary button: for a dialog with one, "acknowledged" - what a paged talk advances on. */
  primary: 1,
  /** The secondary button, or "no". */
  secondary: 0,
  /** The dialog went away without an answer. */
  none: 0xff,
} as const;

/** A text box with up to two buttons (`sub_535C60`). */
export interface QuestTalkSay {
  kind: "say";
  message: string;
  /**
   * sub_535C60 -> +128 -> 532500: nonzero shows BtPrev (reply 0).
   * Legacy field name retained for codec/capture compatibility; this byte is NOT ignored.
   */
  unknownA?: number;
  /** +132: nonzero chooses BtNext; zero chooses BtOK. Either replies 1. */
  unknownB?: number;
}

/** A yes/no box (`sub_535C80`). */
export interface QuestTalkConfirm {
  kind: "confirm";
  message: string;
}

/** A text input (`sub_535CE0`): the answer carries what the player typed. */
export interface QuestTalkAskText {
  kind: "askText";
  message: string;
  /** The edit box's initial text (`sub_535CE0`'s `str`, read as the *second* string). */
  defaultText: string;
  /**
   * The pair of `s16`s. The client's own user of this dialog passes `(4, 12)` - a guild name's
   * length range - and `sub_535CE0` stores them in the two fields a `sub_535C90` number dialog
   * would use for its lower/upper limit, so these are the length limits.
   */
  minLength: number;
  maxLength: number;
}

/** A number input (`sub_535C90`): the answer carries the number the player typed. */
export interface QuestTalkAskNumber {
  kind: "askNumber";
  message: string;
  /** The edit box's initial value (`sub_535C90`'s first `u32`, shown as `"%d"`). */
  defaultValue: number;
  /** The two limits, in the order the client's own callers pass them: `(min, max)`. */
  min: number;
  max: number;
}

/** Dialog kind 4 (`sub_535E30`): selection markup, currently never built by game quest scripts. */
export interface QuestTalkMenu {
  kind: "menu";
  message: string;
}

/** The five bodies, one per sub-op. */
export type QuestTalkBody =
  QuestTalkSay | QuestTalkConfirm | QuestTalkAskText | QuestTalkAskNumber | QuestTalkMenu;

/** One `0x47`. */
export interface QuestTalk {
  /**
   * The `u8` the packet opens with. The client reads it and never uses it (see the header), so this
   * server sends 0.
   */
  unknownA: number;
  /**
   * The `u32` after it - ignored by the client just like `unknownA`. This server puts the talking
   * NPC's pool id here (the id `0x39` handed out), which is a meaning *we* chose for a field the
   * client cannot disagree about.
   */
  npcId: number;
  body: QuestTalkBody;
}

/** The sub-op number of a body. */
export function questTalkSubOp(body: QuestTalkBody): number {
  return QUEST_TALK[body.kind];
}

function writeSigned16(writer: PacketWriter, value: number): void {
  writer.writeU16(value & 0xffff);
}

function readSigned16(reader: PacketReader): number {
  return (reader.readU16() << 16) >> 16;
}

/** Encode one `0x47`, opcode byte included. */
export function encodeQuestTalk(packet: QuestTalk): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(QUEST_TALK_OPCODE);
  writer.writeByte(packet.unknownA & 0xff);
  writer.writeU32(packet.npcId >>> 0);
  writer.writeByte(questTalkSubOp(packet.body));
  const body = packet.body;
  switch (body.kind) {
    case "say":
      writer.writeStringBytes(encodeCp949(body.message));
      writer.writeByte((body.unknownA ?? 0) & 0xff);
      writer.writeByte((body.unknownB ?? 0) & 0xff);
      break;
    case "confirm":
      writer.writeStringBytes(encodeCp949(body.message));
      break;
    case "askText":
      writer.writeStringBytes(encodeCp949(body.message));
      writer.writeStringBytes(encodeCp949(body.defaultText));
      writeSigned16(writer, body.minLength);
      writeSigned16(writer, body.maxLength);
      break;
    case "askNumber":
      writer.writeStringBytes(encodeCp949(body.message));
      writer.writeU32(body.defaultValue >>> 0);
      writer.writeU32(body.min >>> 0);
      writer.writeU32(body.max >>> 0);
      break;
    case "menu":
      writer.writeStringBytes(encodeCp949(body.message));
      break;
  }
  return writer.toBytes();
}

/** Read one `0x47` body (no opcode byte). The sub-op tells the reader which shape follows. */
export function readQuestTalk(reader: PacketReader): QuestTalk {
  const unknownA = reader.readByte();
  const npcId = reader.readU32();
  const subOp = reader.readByte();
  switch (subOp) {
    case QUEST_TALK.say:
      return {
        unknownA,
        npcId,
        body: {
          kind: "say",
          message: decodeCp949(reader.readStringBytes()),
          unknownA: reader.readByte(),
          unknownB: reader.readByte(),
        },
      };
    case QUEST_TALK.confirm:
      return {
        unknownA,
        npcId,
        body: { kind: "confirm", message: decodeCp949(reader.readStringBytes()) },
      };
    case QUEST_TALK.askText:
      return {
        unknownA,
        npcId,
        body: {
          kind: "askText",
          message: decodeCp949(reader.readStringBytes()),
          defaultText: decodeCp949(reader.readStringBytes()),
          minLength: readSigned16(reader),
          maxLength: readSigned16(reader),
        },
      };
    case QUEST_TALK.askNumber:
      return {
        unknownA,
        npcId,
        body: {
          kind: "askNumber",
          message: decodeCp949(reader.readStringBytes()),
          defaultValue: reader.readU32(),
          min: reader.readU32(),
          max: reader.readU32(),
        },
      };
    case QUEST_TALK.menu:
      return {
        unknownA,
        npcId,
        body: { kind: "menu", message: decodeCp949(reader.readStringBytes()) },
      };
    default:
      throw new RangeError(`0x47 sub-op ${subOp} has no handler in this client (0..4 only)`);
  }
}

/** The first line of a `message`, for logs: these texts are multi-line Korean prose. */
function preview(message: string): string {
  const line = message.split(/\r?\n/, 1)[0] ?? message;
  return line.length > 40 ? `${line.slice(0, 40)}...` : line;
}

/**
 * One line describing a `0x47`, for logs and `decode`.
 *
 * No opcode prefix: `describeFieldPacket` already puts the opcode's own name in front (`0x47
 * CQuestMan(npc dialog)`), the same split `describeShopOpen` uses.
 */
export function describeQuestTalk(packet: QuestTalk): string {
  const body = packet.body;
  const head = `talk to npc ${packet.npcId}: `;
  switch (body.kind) {
    case "say":
      return `${head}say "${preview(body.message)}" (${body.unknownA ?? 0},${body.unknownB ?? 0})`;
    case "confirm":
      return `${head}confirm "${preview(body.message)}"`;
    case "askText":
      return `${head}askText "${preview(body.message)}" default="${body.defaultText}" length=${body.minLength}..${body.maxLength}`;
    case "askNumber":
      return `${head}askNumber "${preview(body.message)}" default=${body.defaultValue} range=${body.min}..${body.max}`;
    case "menu":
      return `${head}menu(kind 4) "${preview(body.message)}"`;
  }
}

/** The player's answer, one shape per sub-op. */
export type QuestReply =
  | { kind: "say"; answer: number }
  | { kind: "confirm"; answer: number }
  | { kind: "askText"; answer: number; text?: string }
  | { kind: "askNumber"; answer: number; value?: number }
  | { kind: "menu"; answer: number; value?: number };

/**
 * Encode one `0x15`, opcode byte included - the client's side of the reply.
 *
 * This is what a fake client (and the smoke scripts) uses; the server only reads it. The trailing
 * string/number only exists when the answer is `1` **and** the sub-op is one of the three that
 * carry it, exactly as `sub_4A5F40`/`sub_4A6320`/`sub_4A65C0` build it.
 */
export function encodeQuestReply(reply: QuestReply): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(QUEST_REPLY_OPCODE);
  writer.writeByte(QUEST_TALK[reply.kind]);
  writer.writeByte(reply.answer & 0xff);
  if (reply.answer !== QUEST_ANSWER.primary) return writer.toBytes();
  switch (reply.kind) {
    case "askText":
      writer.writeStringBytes(encodeCp949(reply.text ?? ""));
      break;
    case "askNumber":
    case "menu":
      writer.writeU32((reply.value ?? 0) >>> 0);
      break;
    default:
      break;
  }
  return writer.toBytes();
}

/** Read one `0x15` body (no opcode byte). */
export function readQuestReply(reader: PacketReader): QuestReply {
  const subOp = reader.readByte();
  const answer = reader.readByte();
  const carries = answer === QUEST_ANSWER.primary;
  switch (subOp) {
    case QUEST_TALK.say:
      return { kind: "say", answer };
    case QUEST_TALK.confirm:
      return { kind: "confirm", answer };
    case QUEST_TALK.askText:
      return carries
        ? { kind: "askText", answer, text: decodeCp949(reader.readStringBytes()) }
        : { kind: "askText", answer };
    case QUEST_TALK.askNumber:
      return carries
        ? { kind: "askNumber", answer, value: reader.readU32() }
        : { kind: "askNumber", answer };
    case QUEST_TALK.menu:
      return carries ? { kind: "menu", answer, value: reader.readU32() } : { kind: "menu", answer };
    default:
      throw new RangeError(`0x15 sub-op ${subOp} is not one of the five the client can send`);
  }
}

/**
 * One line describing a `0x15`, for logs and `decode`.
 *
 * A client -> server describer, so it names its opcode itself the way `describeClientShopRequest`
 * does ("16 shop close"): bare hex, and no "0x".
 */
export function describeQuestReply(reply: QuestReply): string {
  const answer =
    reply.answer === QUEST_ANSWER.primary
      ? "primary"
      : reply.answer === QUEST_ANSWER.secondary
        ? "secondary"
        : reply.answer === QUEST_ANSWER.none
          ? "no answer"
          : `answer ${reply.answer}`;
  switch (reply.kind) {
    case "say":
      return `15 talk answer: ${answer}`;
    case "confirm":
      return `15 talk answer: ${answer}`;
    case "askText":
      return `15 talk answer: ${answer}${reply.text === undefined ? "" : ` "${preview(reply.text)}"`}`;
    case "askNumber":
      return `15 talk answer: ${answer}${reply.value === undefined ? "" : ` ${reply.value}`}`;
    case "menu":
      return `15 talk answer: ${answer}${reply.value === undefined ? "" : ` ${reply.value}`}`;
  }
}
