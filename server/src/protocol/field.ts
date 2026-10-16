/**
 * The in-game (`CField`) packets: entering a map, seeing other players, their movement.
 *
 * EVIDENCE (MapleStory.exe.c, see docs/protocol/FINDINGS.md 4.11)
 * ---------------------------------------------------------------
 * `CField`'s `INetMsgHandler` slot 0 is `sub_472770`, and it routes by opcode range:
 *
 *   opcode      target                                class        handler
 *   0x15-0x17   sub_4C2760(this, opcode, packet)      CStage base  sub_4C2780 on 0x16 only
 *   0x19        sub_4728B0(packet)                    CField
 *   0x1A        sub_472910(this - 8, packet)          CField       (user message: chat/whisper)
 *   0x1B-0x2D   sub_51CF70(dword_5C1CEC, ...)         CUserPool    ctor `sub_51CA30`
 *   0x2E-0x37   sub_492330(dword_5C2054, ...)         CMobPool     ctor `sub_4913E0`
 *   0x38-0x41   sub_49F560(dword_5C2050, ...)         CNpcPool     ctor `sub_49F020`
 *   0x42-0x45   sub_4A8870(0x5C204C, ...)             CRewardPool  ctor `sub_4A73A0`
 *   0x46-0x48   sub_4A58F0(dword_5C2048, ...)         CQuestMan    ctor `sub_4A5830`
 *   0x49-0x4C   sub_4B73A0(opcode, packet)            dialogs      (0x4A opens `CShopDlg`)
 *   0x4D-0x4F   sub_4E18D0(opcode, packet)            CUIMessenger
 *   0x50-0x52   sub_4815E0(opcode, packet)            CMiniRoomBaseDlg
 *
 * `CUserPool` (`sub_51CF70`) then splits again: 0x1C -> `sub_51CFE0`, 0x1D -> `sub_51D280`,
 * 0x1E-0x20 -> `sub_51D530`, 0x21-0x2A -> `sub_51D590`, 0x2B-0x2C -> `sub_51D6A0`; 0x1B and 0x2D
 * fall through with no handler at all.
 *
 * This module implements the three packets that decide whether a second player is visible and
 * movable: `0x1C` (somebody entered the field), `0x1D` (somebody left it) and `0x22` (somebody
 * moved). Everything else is still only tabulated, so the constants below are the opcodes that
 * have an implementation behind them - not guesses.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import { decodeCp949 } from "./cp949.ts";
import { readMovePath, writeMovePath, type MovePath } from "./movepath.ts";
// The reward pool (`0x43`/`0x44`) and the two app-level packets that belong to a pickup (`0x0B`,
// `0x11`): they are dispatched outside `CField`, but they are what a field session actually carries.
import {
  DROP_OPCODE,
  LOOT_OPCODE,
  describeDropAppear,
  describeDropRemove,
  describeLootNotice,
  readDropAppear,
  readDropRemove,
  readLootNotice,
} from "./drop.ts";
import { INVENTORY_OPCODE, describeInventoryChange, readInventoryChange } from "./inventory.ts";
import { STAT_OPCODE, describeStatUpdate, readStatUpdate, statDiffFlag } from "./stat.ts";
// The NPC dialog (`0x47` server -> client, `0x15` back): `sub_4A58F0`, the third object of the
// field's dispatch chain, next to the shop one.
import {
  QUEST_REPLY_OPCODE,
  QUEST_TALK_OPCODE,
  describeQuestReply,
  describeQuestTalk,
  readQuestReply,
  readQuestTalk,
} from "./quest.ts";
// The NPC shop (`0x4A`/`0x4B` server -> client, `0x16`/`0x33` client -> server): dispatched by
// `sub_4B73A0` / `sub_55AF20`, i.e. next to the field pool that carries them.
import {
  CLIENT_OBJECT_CLICK_OPCODE,
  CLIENT_SHOP_OPCODE,
  SHOP_OPEN_OPCODE,
  SHOP_RESULT_OPCODE,
  describeClientObjectClick,
  describeClientShopRequest,
  describeShopOpen,
  describeShopResult,
  readClientObjectClick,
  readClientShopRequest,
  readShopOpen,
  readShopResult,
} from "./shop.ts";
// The NPC pool (`0x39`..`0x41`): the same packet shape as `CMobPool`, one range further up.
import {
  NPC_OPCODE,
  describeNpcEnterField,
  readNpcEnterField,
  readNpcId,
  readNpcState,
} from "./npc.ts";
import {
  MOB_OPCODE,
  mobActionName,
  describeMobAnim,
  describeMobEnterField,
  describeMobLeaveDelayed,
  describeMobMove,
  describeMobPresence,
  describeMobStat,
  readMobAnim,
  readMobEnterField,
  readMobLeaveDelayed,
  readMobMove,
  readMobPresence,
  readMobStat,
} from "./mob.ts";
import { readCharacterData, writeCharacterData, type CharacterData } from "./chardata.ts";

/** Field opcodes with a located handler. `read`/`write` say which directions make sense. */
export const FIELD_OPCODE = {
  /**
   * `CStage` base (0x15-0x17, only 0x16 does anything): the server moves the client into a
   * field. `sub_4C2780` reads `u8 mode`, `u8 full`, and - when `full` is non-zero - three `u32`s
   * followed by a whole `CharacterData` (the same `sub_45FCC0` reader FINDINGS 4.9 documents).
   * The three `u32`s are the field's **random seed**: `sub_4C7930` hands all three to
   * `sub_48A900` ("scramble and store"), whose inverse `sub_4619F0` is the client's `Random()`,
   * and `sub_4C7960(CWvsApp+632, ...)` is what rolls the damage numbers with it. The field and
   * spawn parameter is `mode` plus the `CharacterData`'s `mapId`, both handed to the new field
   * object (`sub_4C3460(field, &{mapId, mode})`): `sub_468E00` stores the id at `CField+152`, the
   * mode at `CField+156`, and loads `Map/Map/%09d.img` from the id (`sub_4694F0`) - so the server
   * picks the map by sending the right `mapId` in the `CharacterData`, after which `sub_51CBF0`
   * makes the field and the local user on `CUserPool`.
   */
  setField: 0x16,
  /**
   * `sub_4728B0`: an **empty** packet whose only effect is clearing the client's "a field request
   * is pending" gate (`CWvsApp+24 = 0`, `+28 = timeGetTime()`). `sub_472590` (the `0x0D` interact
   * request) and `sub_55AF20` (the `0x33` object click) both arm that gate, and the client refuses to
   * send another one until it is cleared - so every click owes this answer, whether or not the
   * server has anything else to say (FINDINGS 4.11.6). A `0x0D` whose ack byte is set clears the
   * same gate.
   */
  requestRelease: 0x19,
  /**
   * `CField` 0x1A (`sub_472910`, dispatched as case 26 of `sub_472770`): a message **about one of the
   * field's users**, shown to whoever receives it. The payload starts with a `u8` sub-op (`v8 =
   * (char)ArgList - 9` switches on it), and the four the jump table has cases for are:
   *
   *   0x09  find answer      `string name` + `u32 mapId`     -> "'name' is at 'street:map'"
   *   0x0A  whisper answer   `string name` + `u8 flag`       -> "name<< <the text you sent>"
   *   0x12  field chat       `string name` + `string text`   -> "name>> text"
   *   0x22  whisper refusal  `string name`                   -> "'name' refuses whispers"
   *
   * Three of those four are *answers* (`0x09` counts; `0xFFFFFFFF` is the "not found" the same handler
   * renders as "'name'님을 찾지 못했습니다"), and `0x0A` carries the flag only: the text it
   * shows is the sender's **own last-sent whisper**, kept client-side at `CField+28` by the send
   * function (`sub_4717D0`), so a server never repeats it on the wire. `0x12` is the only one that
   * carries a body worth relaying - and it is *both* the chat line and the delivered whisper, which
   * is why the receiver's client cannot tell the two apart (FINDINGS 4.31).
   *
   * (`0x1A`'s sub-ops are *not* the CWvsApp-level opcodes of §4.10: that table's `0x12` is the
   * popularity system. They are simply the numbers this packet happens to use.)
   */
  userMessage: 0x1a,
  /**
   * `CUserPool` 0x1C (`sub_51CFE0`): another user entered the field - or, when the id turns out
   * to be `CWvsApp+0x14` (our own character id, the value the 0x03 login reply stored), nothing
   * happens at all. The packet is `u32 characterId` and then `CUserRemote::Init` (`sub_520680`),
   * see `UserEnterField` below.
   */
  userEnterField: 0x1c,
  /**
   * `CUserPool` 0x1D (`sub_51D280`): the id is looked up and the pool entry is unlinked from the
   * pool's list (`sub_51EE80` patches the neighbour pointers twice). That is a removal, so this
   * is the leave-field packet: `u32 characterId` and nothing else.
   */
  userLeaveField: 0x1d,
  /** `CUserPool` 0x1F (`sub_51D530` branch): one u32 id, then `CUser::OnPacket`-style payload. */
  userAction: 0x1f,
  /**
   * `CUserPool` 0x22 (`sub_51D590` branch): `u32 characterId` + a `CMovePath` (see movepath.ts).
   * The handler resolves the id to `user[13] + 216`, i.e. the vecctrl's embedded move path, and
   * hands the packet to `CVecCtrlUser::OnMove` (`sub_4967C0`).
   */
  userMove: 0x22,
  /** `CUserPool` 0x23-0x25: the skill/effect family (`sub_520F20`/`sub_521400`/`sub_521AD0`). */
  userSkillEffectFirst: 0x23,
  userSkillEffectLast: 0x25,
  /**
   * `CUserPool` 0x29 (`sub_51D590` case ')' -> `sub_522300`): an effect **on one user**. The range
   * dispatcher reads the `u32 characterId` first and resolves it in the pool (`sub_51CD30`); if the
   * id is not in the pool the packet is dropped, which is what makes this safe to broadcast. The body
   * then starts with a `u8`:
   *
   *   0  `Effect/BasicEff.img/LevelUp` + the "LevelUp" sound, built with `sub_50D6D0(user)` so it
   *      plays **over that user**: the level-up effect for everybody who is not the one who levelled
   *      (their own client plays it from the `0x0D` diff, `sub_55BEB0`'s tail - FINDINGS 4.21)
   *   1  reads one more `u32`; what it plays is not located
   *
   * Only 0 has evidence, so only 0 has a codec (`UserEffect` below).
   */
  userEffect: 0x29,
  /**
   * `CQuestMan` 0x47 (`sub_4A58F0` -> `sub_4A5910`): the NPC dialog. `0x46` and `0x48` are routed
   * to the same object and have no branch, so `0x47` is the only opcode of the three that reads
   * anything - `protocol/quest.ts` has the whole body (FINDINGS 4.23).
   */
  questTalk: QUEST_TALK_OPCODE,
} as const;

/**
 * `CUserRemote::Init` (0x1C payload after the character id). Field order and widths are the read
 * order of `sub_520680`:
 *
 *   u32 charId            (read by the caller `sub_51CFE0`, so not part of this struct)
 *   string name           -> CUser+60
 *   u8  unknown64         -> CUser+64
 *   u32 avatarKey         -> CUser+68 (`sub_508260` = `CUser::SetAvatar`)
 *   u32 unknownA          read, then dropped by the client
 *   u32 unknownB          read, then dropped by the client
 *   u32 itemId...         avatar item ids, terminated by a 0 u32 (`sub_45F340`)
 *   s16 x
 *   s16 y
 *   u8  action            -> CUser+180, and arg6 of the vecctrl init call
 *   u16 foothold          -> `sub_485400(field, id)`, the foothold lookup
 *
 * The avatar list is *not* a `GW_ItemSlot` array: `sub_45F340` reads plain item ids until 0 and
 * files each one under a slot index derived from the id itself (`itemId / 1000 / 10`: 100 -> 1,
 * 101 -> 2, ... 3xxxx -> 0), which is what makes an avatar from item ids alone. The client keeps
 * the last pair (`avatarKey`, avatar) and only rebuilds the look when the pair changes.
 */
export interface UserEnterField {
  characterId: number;
  name: string;
  /** Stored at `CUser+64`. Role not located - kept as a number instead of a guessed name. */
  unknown64: number;
  /**
   * Stored at `CUser+68` by `CUser::SetAvatar` next to the avatar array; the client re-runs the
   * avatar work only when this value *or* the array differs, so it acts as an avatar-change key.
   * What the number itself is (job? level? a look version?) is not proven.
   */
  avatarKey: number;
  /**
   * Two more u32s that `sub_520680` reads and never stores. They are part of the packet all the
   * same - a server that omits them shifts every field after them - so they stay in the struct.
   */
  unknownA: number;
  unknownB: number;
  /** Avatar item ids, one per appearance slot, in any order (`sub_45F340` files them by id). */
  avatarItems: number[];
  x: number;
  y: number;
  /** The action/stance byte; the vecctrl is initialised with it (`CUser+180`). */
  action: number;
  foothold: number;
}

function toS16(value: number): number {
  return (value << 16) >> 16;
}

/** Reads the body of a 0x1C packet. */
export function readUserEnterField(reader: PacketReader): UserEnterField {
  const characterId = reader.readU32();
  const name = reader.readAsciiString();
  const unknown64 = reader.readByte();
  const avatarKey = reader.readU32();
  const unknownA = reader.readU32();
  const unknownB = reader.readU32();
  const avatarItems: number[] = [];
  for (;;) {
    const itemId = reader.readU32();
    if (itemId === 0) break;
    avatarItems.push(itemId);
  }
  const x = toS16(reader.readU16());
  const y = toS16(reader.readU16());
  const action = reader.readByte();
  const foothold = reader.readU16();
  return { characterId, name, unknown64, avatarKey, unknownA, unknownB, avatarItems, x, y, action, foothold };
}

/** Writes a 0x1C body. The avatar list always gets its terminating 0 u32. */
export function writeUserEnterField(writer: PacketWriter, user: UserEnterField): void {
  writer.writeU32(user.characterId >>> 0);
  writer.writeAsciiString(user.name);
  writer.writeByte(user.unknown64 & 0xff);
  writer.writeU32(user.avatarKey >>> 0);
  writer.writeU32(user.unknownA >>> 0);
  writer.writeU32(user.unknownB >>> 0);
  for (const itemId of user.avatarItems) writer.writeU32(itemId >>> 0);
  writer.writeU32(0);
  writer.writeU16(user.x & 0xffff);
  writer.writeU16(user.y & 0xffff);
  writer.writeByte(user.action & 0xff);
  writer.writeU16(user.foothold & 0xffff);
}

/** `0x1C` as a whole packet, opcode included. */
export function encodeUserEnterField(user: UserEnterField): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(FIELD_OPCODE.userEnterField);
  writeUserEnterField(writer, user);
  return writer.toBytes();
}

/** `0x1D`: the character id that left the field, nothing else. */
export function encodeUserLeaveField(characterId: number): Uint8Array {
  const writer = new PacketWriter(8);
  writer.writeByte(FIELD_OPCODE.userLeaveField);
  writer.writeU32(characterId >>> 0);
  return writer.toBytes();
}

/** `0x22`: one user's movement. */
export interface UserMove {
  characterId: number;
  path: MovePath;
}

export function readUserMove(reader: PacketReader): UserMove {
  const characterId = reader.readU32();
  return { characterId, path: readMovePath(reader) };
}

export function encodeUserMove(move: UserMove): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(FIELD_OPCODE.userMove);
  writer.writeU32(move.characterId >>> 0);
  writeMovePath(writer, move.path);
  return writer.toBytes();
}

/**
 * The `0x16` set-field header. The full form (second byte non-zero) continues with three u32s the
 * client feeds to `sub_4C7930` and then a `CharacterData`; none of the three has a located
 * meaning, so the writer demands them from the caller instead of inventing values.
 */
export interface SetField {
  /**
   * First byte of the packet (`sub_4C2780`). It travels with the map id to the new field object
   * (`sub_4C3460(field, &{mapId, mode})` -> `sub_468E00`, which keeps it at `CField+156`), so it is
   * the spawn mode/portal; which values mean what is not located, and real traffic has to pin it
   * down. `mapId` itself comes from `CharacterData.mapId`.
   */
  mode: number;
  /** `0` = the "already known character" form, non-zero = carry a full `CharacterData`. */
  full: boolean;
  /**
   * The three `u32`s are the **field's random seed**, not opaque words: `sub_4C2780` passes all
   * three to `sub_4C7930`, which seeds the two random generators at `CWvsApp+632` and `+652` with
   * them (`sub_48A900` = "scramble and store the three parts"). The inverse `sub_4619F0` is this
   * client's `Random()` - a custom generator whose output is the xor of the three stored parts, and
   * the very function the client calls to roll damage (`sub_4C7960(CWvsApp+632, ...)`), pick an
   * attack action (`sub_427F60`) and drive drops.
   *
   * For a server that means: sending the same seed twice makes the client repeat its rolls, so the
   * damage a client reports in `0x0F` is *reproducible from the seed* instead of being a black box.
   */
  randomSeedA: number;
  randomSeedB: number;
  randomSeedC: number;
  character: CharacterData;
}

export function readSetField(reader: PacketReader): SetField {
  const mode = reader.readByte();
  const hasData = reader.readByte();
  if (hasData === 0) {
    throw new Error("the 0x16 form without CharacterData is not decoded yet (see FINDINGS 4.11)");
  }
  const randomSeedA = reader.readU32();
  const randomSeedB = reader.readU32();
  const randomSeedC = reader.readU32();
  const character = readCharacterData(reader);
  return { mode, full: true, randomSeedA, randomSeedB, randomSeedC, character };
}

export function encodeSetField(field: SetField): Uint8Array {
  if (!field.full) throw new Error("the 0x16 form without CharacterData is not decoded yet (see FINDINGS 4.11)");
  const writer = new PacketWriter(256);
  writer.writeByte(FIELD_OPCODE.setField);
  writer.writeByte(field.mode & 0xff);
  writer.writeByte(1);
  writer.writeU32(field.randomSeedA >>> 0);
  writer.writeU32(field.randomSeedB >>> 0);
  writer.writeU32(field.randomSeedC >>> 0);
  writeCharacterData(writer, field.character);
  return writer.toBytes();
}

/**
 * The empty `0x19` that releases the client's pending-field-request gate (`sub_4728B0`).
 *
 * One byte, no body: the client's handler reads nothing at all. It is what a field session answers
 * an object click with before (or instead of) anything else.
 */
export function encodeFieldRequestRelease(): Uint8Array {
  return new Uint8Array([FIELD_OPCODE.requestRelease]);
}

/**
 * One-line meaning for a decrypted client -> field packet (the interesting half of a capture:
 * what the original client actually sent), for the `decode` tool. Unknown opcodes stay `undefined`
 * so `decode` can say "unmapped" instead of inventing a reading.
 */
export function describeClientFieldPacket(plain: Uint8Array): string | undefined {
  if (plain.length === 0) return undefined;
  const opcode = plain[0]!;
  try {
    if (opcode === CLIENT_FIELD_OPCODE.userMove) {
      const move = readClientUserMove(new PacketReader(plain, 1));
      return `0x0e move: stageByte=${move.stageByte} elements=${move.path.elements.length}`;
    }
    if (opcode === CLIENT_FIELD_OPCODE.statReport) {
      return `0x1c stat report: ${describeClientStatReport(readClientStatReport(new PacketReader(plain, 1)))}`;
    }
    if (USE_ITEM_OPCODES.includes(opcode)) {
      const use = readClientUseItem(new PacketReader(plain, 1), opcode);
      return `${hexOpcode(opcode)} use item: ${describeClientUseItem(use)}`;
    }
    if (opcode === CLIENT_FIELD_OPCODE.userRequest) {
      return describeClientUserRequest(readClientUserRequest(new PacketReader(plain, 1)));
    }
    if (opcode === CLIENT_FIELD_OPCODE.interact) {
      const interact = readClientInteract(new PacketReader(plain, 1));
      return `0x0d interact: kind=${interact.kind} name="${interact.name}"`;
    }
    if (opcode === CLIENT_FIELD_OPCODE.chat) {
      return describeClientChat(readClientChat(new PacketReader(plain, 1)));
    }
    if (opcode === CLIENT_SHOP_OPCODE) {
      return describeClientShopRequest(readClientShopRequest(new PacketReader(plain, 1)));
    }
    if (opcode === CLIENT_OBJECT_CLICK_OPCODE) {
      return describeClientObjectClick(readClientObjectClick(new PacketReader(plain, 1)));
    }
    if (opcode === CLIENT_FIELD_OPCODE.questReply) {
      return describeQuestReply(readQuestReply(new PacketReader(plain, 1)));
    }
    if (opcode === CLIENT_FIELD_OPCODE.mobAttack) {
      const attack = readClientMobAttack(new PacketReader(plain, 1));
      const action =
        attack.action === undefined
          ? "reset"
          : `${mobActionName(attack.actionByte) ?? attack.action}${attack.facing === 1 ? ",left" : ",right"}`;
      const at = attack.hasPosition ? ` at (${attack.positionX},${attack.positionY})` : "";
      return `0x2c mob attack: mobId=${attack.mobId} ${action} flags=0x${attack.flags.toString(16)}${at} tail=${attack.tail.length}B`;
    }
    if (
      opcode === CLIENT_FIELD_OPCODE.attack ||
      opcode === CLIENT_FIELD_OPCODE.magicAttack ||
      opcode === CLIENT_FIELD_OPCODE.skillAttack
    ) {
      const attack = readClientAttack(new PacketReader(plain, 1), opcode);
      const targets = attack.targets
        .map((target) => `${target.mobId}@(${target.x},${target.y})[${target.damages.join("+")}] anim=${target.hitAnimation}`)
        .join(" ");
      return (
        `${hexOpcode(opcode)} attack: ${attack.facingLeft ? "left" : "right"} action=${attack.action} ` +
        `hits=${attack.hits} cap=${attack.targetCap} clicked=${attack.clickedMobId} targets=${attack.targetCount} ${targets}`
      );
    }
  } catch (error) {
    return `${hexOpcode(opcode)} (truncated: ${(error as Error).message})`;
  }
  return undefined;
}

/** `0x0f`, not `0xf`: the decode tool's lines line up this way. */
function hexOpcode(opcode: number): string {
  return `0x${opcode.toString(16).padStart(2, "0")}`;
}

/**
 * One-line meaning for a decrypted server -> field packet, for the `decode` tool. Only the
 * opcodes with located handlers are described; everything else says so instead of guessing.
 */
export function describeFieldPacket(plain: Uint8Array): string | undefined {
  if (plain.length === 0) return undefined;
  const opcode = plain[0]!;
  // `0x0B` and `0x11` belong to `CWvsApp` (`sub_55A900`), i.e. they are below the field dispatcher's
  // range but a field session is where they arrive, so they are described here.
  if (opcode === INVENTORY_OPCODE) {
    try {
      const { result, changes } = readInventoryChange(new PacketReader(plain, 1));
      return `0x0b inventory: ${describeInventoryChange(result, changes)}`;
    } catch (error) {
      return `0x0b inventory: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === LOOT_OPCODE) {
    try {
      return `0x11 notice: ${describeLootNotice(readLootNotice(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `0x11 notice: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === STAT_OPCODE) {
    try {
      return `0x0d stat: ${describeStatUpdate(readStatUpdate(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `0x0d stat: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode < 0x15 || opcode > 0x52) return undefined;
  const name = describeFieldOpcode(opcode);
  if (opcode === FIELD_OPCODE.userEffect) {
    try {
      return `${name}: ${describeUserEffect(readUserEffect(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (unreadable: ${(error as Error).message})`;
    }
  }
  if (opcode === FIELD_OPCODE.userMessage) {
    try {
      // Which of the four `sub_472910` bodies is in there is the sub-op, and it is also the first
      // byte any of the readers would read - so the peek and the reader always agree.
      const subOp = plain[1] ?? -1;
      if (subOp === USER_MESSAGE_FIND_ANSWER) {
        return `${name}: ${describeUserFindAnswer(readUserFindAnswer(new PacketReader(plain, 1)))}`;
      }
      if (subOp === USER_MESSAGE_WHISPER_ANSWER) {
        return `${name}: ${describeUserWhisperAnswer(
          readUserWhisperAnswer(new PacketReader(plain, 1)),
        )}`;
      }
      return `${name}: ${describeUserChat(readUserChat(new PacketReader(plain, 1)))}`;
    } catch (error) {
      // Not `truncated`: the usual reason is a sub-op with no codec (0x22, the refusal), and saying
      // which is better than pretending the packet ran out.
      return `${name}: (unreadable: ${(error as Error).message})`;
    }
  }
  if (opcode === SHOP_OPEN_OPCODE) {
    try {
      return `${name}: ${describeShopOpen(readShopOpen(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === SHOP_RESULT_OPCODE) {
    try {
      return `${name}: ${describeShopResult(readShopResult(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === DROP_OPCODE.appear) {
    try {
      return `${name}: ${describeDropAppear(readDropAppear(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === DROP_OPCODE.remove) {
    try {
      return `${name}: ${describeDropRemove(readDropRemove(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === FIELD_OPCODE.userMove && plain.length >= 5) {
    try {
      const move = readUserMove(new PacketReader(plain, 1));
      const first = move.path.elements[0];
      const where = first === undefined ? "no elements" : `first=(${first.x},${first.y}) action=${first.action} fh=${first.foothold}`;
      return `${name}: characterId=${move.characterId} elements=${move.path.elements.length} ${where}`;
    } catch (error) {
      return `${name}: characterId=${new PacketReader(plain, 1).readU32()} (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === FIELD_OPCODE.userEnterField && plain.length >= 5) {
    try {
      const user = readUserEnterField(new PacketReader(plain, 1));
      return `${name}: characterId=${user.characterId} name="${user.name}" avatar=${user.avatarItems.length} items at (${user.x},${user.y}) action=${user.action} fh=${user.foothold}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === FIELD_OPCODE.userLeaveField && plain.length >= 5) {
    return `${name}: characterId=${new PacketReader(plain, 1).readU32()}`;
  }
  if (opcode === MOB_OPCODE.move) {
    try {
      const { mobId, body } = readMobMove(new PacketReader(plain, 1));
      return `${name}: ${describeMobMove(mobId, body)}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === MOB_OPCODE.leaveDelayed) {
    try {
      return `${name}: ${describeMobLeaveDelayed(readMobLeaveDelayed(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === MOB_OPCODE.presence) {
    try {
      const { flag, mobId } = readMobPresence(new PacketReader(plain, 1));
      return `${name}: ${describeMobPresence(flag, mobId)}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === MOB_OPCODE.anim) {
    try {
      return `${name}: ${describeMobAnim(readMobAnim(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === MOB_OPCODE.stat) {
    try {
      return `${name}: ${describeMobStat(readMobStat(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === QUEST_TALK_OPCODE) {
    try {
      return `${name}: ${describeQuestTalk(readQuestTalk(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === NPC_OPCODE.enterField) {
    // No length guard: a 5-byte packet is either the refresh form or a cut-short body, and the
    // reader's own exception is what tells the two apart, so the catch reports it.
    try {
      return `${name}: ${describeNpcEnterField(readNpcEnterField(new PacketReader(plain, 1), false))}`;
    } catch {
      try {
        const { npcId } = readNpcEnterField(new PacketReader(plain, 1), true);
        return `${name}: npcId=${npcId} (known id: refresh only, or a truncated body)`;
      } catch (error) {
        return `${name}: (truncated: ${(error as Error).message})`;
      }
    }
  }
  if (opcode === NPC_OPCODE.leaveField) {
    try {
      return `${name}: npcId=${readNpcId(new PacketReader(plain, 1))} leave`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === NPC_OPCODE.stateToggle) {
    try {
      const { npcId, on } = readNpcState(new PacketReader(plain, 1));
      return `${name}: npcId=${npcId} walk=${on ? "on" : "off"}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  if (opcode === MOB_OPCODE.enterField) {
    // No length guard: the reader throws `PacketUnderflowError` and the catch reports it, which is
    // more useful than "fields not decoded yet" for a packet that is simply cut short.
    try {
      return `${name}: ${describeMobEnterField(readMobEnterField(new PacketReader(plain, 1)))}`;
    } catch (error) {
      return `${name}: (truncated: ${(error as Error).message})`;
    }
  }
  // `0x19` has nothing to decode: an empty body *is* the whole packet, so the name alone is the
  // truth and the usual suffix would be wrong about it.
  if (opcode === FIELD_OPCODE.requestRelease) return name;
  return `${name} (fields not decoded yet)`;
}

/** The subsystem an opcode belongs to, i.e. the second dispatch level of `sub_472770`. */
export function describeFieldOpcode(opcode: number): string {
  if (opcode >= 0x15 && opcode <= 0x17) return `0x${opcode.toString(16)} CStage(set-field)`;
  if (opcode === 0x19) return "0x19 CField(cached-character reset)";
  if (opcode === FIELD_OPCODE.userMessage) return "0x1a CField(user message)";
  if (opcode === FIELD_OPCODE.userEffect) return "0x29 CUserPool(user effect)";
  if (opcode >= 0x1b && opcode <= 0x2d) return `0x${opcode.toString(16)} CUserPool`;
  if (opcode === MOB_OPCODE.anim) return "0x35 CMobPool(mob animation)";
  if (opcode >= 0x2e && opcode <= 0x37) return `0x${opcode.toString(16)} CMobPool`;
  if (opcode === NPC_OPCODE.enterField) return "0x39 CNpcPool(npc appear)";
  if (opcode === NPC_OPCODE.leaveField) return "0x3a CNpcPool(npc leave)";
  if (opcode === NPC_OPCODE.stateToggle) return "0x3b CNpcPool(npc walk)";
  if (opcode === 0x38 || opcode === 0x41) return `0x${opcode.toString(16)} CNpcPool(no handler)`;
  if (opcode >= 0x3c && opcode <= 0x40) {
    // 0x3C..0x40 all read a u32 id and stop, except 0x3D, which reads more (`sub_49A280`).
    return `0x${opcode.toString(16)} CNpcPool(${opcode === NPC_OPCODE.update ? "action + move path" : "id only"})`;
  }
  if (opcode === DROP_OPCODE.appear) return "0x43 CRewardPool(drop appear)";
  if (opcode === DROP_OPCODE.remove) return "0x44 CRewardPool(drop gone)";
  if (opcode === 0x42 || opcode === 0x45) return `0x${opcode.toString(16)} CRewardPool(no handler)`;
  if (opcode === 0x47) return "0x47 CQuestMan(npc dialog)";
  if (opcode === 0x46 || opcode === 0x48) return `0x${opcode.toString(16)} CQuestMan(no handler)`;
  if (opcode === SHOP_OPEN_OPCODE) return "0x4a CShopDlg(open)";
  if (opcode === SHOP_RESULT_OPCODE) return "0x4b CShopDlg(result)";
  if (opcode === 0x49 || opcode === 0x4c) return `0x${opcode.toString(16)} field dialogs(no handler)`;
  if (opcode >= 0x49 && opcode <= 0x4c) return `0x${opcode.toString(16)} field dialogs`;
  if (opcode >= 0x4d && opcode <= 0x4f) return `0x${opcode.toString(16)} CUIMessenger`;
  if (opcode >= 0x50 && opcode <= 0x52) return `0x${opcode.toString(16)} CMiniRoomBaseDlg`;
  return `0x${opcode.toString(16)}`;
}

/**
 * The three client -> server packets of the field stage that are decoded so far.
 *
 * `0x0E`/`0x0D` both carry pieces the client already uses locally (its move path, the object it
 * clicked); `0x0F` goes further and carries the *result* of the client's own hit resolution -
 * `sub_512F90` applies the damage to each mob before it builds the packet (FINDINGS 4.13.1).
 */
export const CLIENT_FIELD_OPCODE = {
  /**
   * The chat input (`sub_470C70`): `[0x12][string text]`. Its only caller (`sub_4F8CB0`, the Enter
   * key of the chat box) reaches it when the line is not a `/` command and there is no whisper
   * target, i.e. this is what the player says out loud.
   *
   * The client does **not** show the line locally: `sub_470C70` builds the packet and returns, and
   * the only renderer of a chat line is on the receiving side (`sub_472910` case 0x12). The server is
   * therefore what makes a player see their own words - by sending them back (FINDINGS 4.26).
   */
  chat: 0x12,
  /**
   * `CVecCtrlUser::SendMove` (`sub_542C40`): `[0x0E][u8 *(CStage+156)][CMovePath]`. The path comes
   * from `vecctrl + 216` (the embedded `CMovePath`), the byte from the current stage object - role
   * of that byte not located, so it keeps its offset in the packet.
   */
  userMove: 0x0e,
  /**
   * The player's own HP/MP change, as the client reports it (`sub_55B870`):
   *
   *   `[0x1C][u32 flags][s16 hp delta][s16 mp delta][u8 flag]`
   *
   * This is the half of "a monster hit me" that travels: the 2003 client runs the monster AI itself
   * and rolls the damage locally, but it does **not** write its own record with it - the record's HP
   * is written by the server's `0x0D` (`sub_45E0D0`, see `protocol/stat.ts`), so the report and the
   * server's answer are what actually move the HP bar (FINDINGS 4.33).
   *
   * Two senders exist, and they are the two ways a player's vitals change in this build:
   *
   *   `sub_5114A0`  damage: `sub_55B870(-damage, 0, 0)`, reached from the local user's per-frame
   *                 overlap check against the mobs (`sub_511C60` -> `sub_4C8ED0`) and from the
   *                 knockback path (`sub_542F10`, `CVecCtrlUser` slot 49). The same call plays the
   *                 knockback, the hurt action and the damage number.
   *   `sub_558950`  regeneration: the field's own tick (one second per 10000 ms, HP from item group
   *                 `1000000` + 10, MP from `2000000` + 3), positive deltas on both fields.
   *
   * The `flags` word uses the **same bit meanings as the `0x0D` diff** (`0x400` = hp, `0x1000` =
   * mp - `statDiffFlag`), which is why the two fields are read in that order; `sub_55B870` always
   * writes both (`0x1400`). What differs from `0x0D` is the values: these are **signed deltas of the
   * record**, not absolute numbers.
   */
  statReport: 0x1c,
  /**
   * `sub_55B2C0`: `[0x18][u16 slot][u32 itemId]` - **the player used a 200/201/202 item** (a potion
   * or a piece of food) out of the USE tab.
   *
   * The second byte of a family of four CWvsApp-level senders that all mean "the inventory window
   * did something". All four share the same preconditions, which are worth knowing because they are
   * the whole of the client's own validation (`sub_55B2C0`, `sub_55B4B0`, `sub_55ACB0`,
   * `sub_55B0E0`, each ~145 lines, identical prologue):
   *
   * ```
   * *(this + 6) == 0            // one request at a time: this byte is set below and only a
   *                             //   non-zero `0x0B` result / `0x0D` ack clears it (FINDINGS 4.34)
   * (int16)(hp ^ mask) > 0      // alive: the record's HP pair is 0 only for a corpse
   * timeGetTime() - *(this + 7) >= 200 (0x18) / 500 (the other three)
   * ```
   *
   * then it appends its fields, calls `sub_4A1EA0(&buf, opcode, 0)` / `sub_43AD50`, sets the gate
   * and stamps the clock. Nothing else happens locally - for `0x18` the caller plays
   * `Sound/Item.img/<id>/Use` (`sub_526F30(itemId, 4)`) and returns, and the client's own record
   * is **not** written, so the heal has to come back as a `0x0D`
   * (`game/items.ts`, `handleUseItem`).
   *
   * Who sends it (`sub_462DC0`, the `CUIItem` double-click handler, and `sub_512570`, the quickslot
   * key handler):
   *
   * ```
   * itemId / 10000 == 200 | 201 | 202   ->  sub_55B2C0(slot, itemId)      // this opcode
   * itemId / 10000 == 203               ->  sub_55B4B0(slot, itemId)      // useMapItem
   * itemId / 10000 == 204 (a scroll)    ->  sub_55B0E0(slot, equipSlot)   // scroll over an equip
   * tab 1 (equip) / 2..4 (move, drop)   ->  sub_55ACB0(kind, slot, …)     // inventory ops
   * ```
   *
   * `slot` is a slot of the **USE tab** (the tab byte is not on the wire; the item id is what says
   * which family it is) and it is `s16` - the client's own argument type, and the equip tab's worn
   * slots are negative in the neighbouring opcodes.
   */
  useItem: 0x18,
  /**
   * `sub_55B4B0`: `[0x19][s16 slot][u32 itemId]` - the same shape as `useItem` for the **203**
   * family, which is the 귀환 주문서 line: 마을 귀환 주문서 (`02030000`) and five town scrolls.
   * Where one of them leads is the item's own `spec/moveTo`
   * (`Item/Consume/0203.img/<id>/spec`), which is why this is a *map change* and not a heal:
   * `-1` is 마을 귀환 주문서 - "the nearest town".
   */
  useMapItem: 0x19,
  /**
   * `CField::SendInteract` (`sub_472590`): `[0x0D][s32 kind][string name]`. The two click handlers
   * `sub_5124C0` / `sub_512510` send `kind = -1` and the name of the object under the cursor when
   * it is a portal (`[obj+0x14] != 999999999`), then play the "Portal" sound - so this is the
   * "player used a portal / clicked a field object" request the server answers with 0x16.
   * The function refuses to send more than once per 500 ms (`n3000[6]`/`n3000[7]`, re-armed by the
   * server's 0x19 reply).
   */
  interact: 0x0d,
  /**
   * `sub_55AF20`: `[0x33][u32 objectId]` - the player clicked a field object. `sub_4A7770` picks the
   * object under the cursor (only one whose type field `+48` is 3, with a 3 s re-click guard) and
   * hands its id to this sender, so for an NPC the id is the one `0x39` gave it. The same gate as
   * `0x0D` is armed, and the server answers with `0x19` (and a shop, when the NPC keeps one).
   */
  objectClick: CLIENT_OBJECT_CLICK_OPCODE,
  /**
   * The shop buttons: `[0x16][u8 action][...]`. See `protocol/shop.ts` for the four shapes - the
   * opening byte is the action, and the rest depends on it. Same opcode number as `setField` in the
   * other direction, like `0x0D`/`0x0B`.
   */
  shop: CLIENT_SHOP_OPCODE,
  /**
   * The NPC dialog's answer (`protocol/quest.ts`): `[0x15][u8 sub-op][u8 answer]` plus, for the
   * sub-ops that carry one, the text or the number. Sent by the five CQuestMan dialogs
   * (`sub_4A5A80`..`sub_4A65C0`) with `sub_4A1EA0(&buf, 21, 0)`, i.e. the same opcode number the
   * server uses for a *different* packet in the other direction (FINDINGS 4.6 / 4.23).
   */
  questReply: QUEST_REPLY_OPCODE,
  /**
   * The melee swing (`sub_512F90`):
   *
   *   `[0x0F][u8 hits | targets << 4][u32 clicked id][u8 facing << 7 | action][u8 targetCap]`
   *   then per target `[u32 mob id][s8 hit animation][u16 x][u16 y][u16 sequence][u16 damage * hits]`
   *
   * The target list is a real spatial query - `sub_491E90(CMobPool, swing rect, out, n)` - so the
   * client is telling the server "these mobs were inside my swing, and this is what I rolled".
   * Byte for byte from the writer's own `ZArray` appends in FINDINGS 4.13.1.
   */
  attack: 0x0f,
  /**
   * The magic attack (`sub_513C80`). Same header and the *same 11-byte target record* as `0x0F`,
   * with two differences: the high nibble of byte 1 is a "second object exists" flag rather than a
   * target count (`16 * (v129 != nullptr)`, so it can only be 0 or 1), and there is one extra `u16`
   * between the header and the record.
   */
  magicAttack: 0x10,
  /**
   * The skill attack (`sub_514D30`). Header = `u8 hits | flag << 4, u32 clicked id, u8 facing |
   * action, u8 cap`; the whole target record is written under `if (v36 != nullptr)`, i.e. only when
   * the flag is set. The record itself is the same 11 bytes + damages.
   */
  skillAttack: 0x11,
  /**
   * The mob's own attack, reported by the client (`sub_4885D0` -> `sub_4A1EA0(..., 44, ...)`,
   * FINDINGS 4.20): `[0x2C][u32 mob id][u8 flags][u8 action | facing][u32 position][tail]`.
   *
   * In 2003 the monster AI runs **on the client**: `sub_4862C0` (the mob's per-frame virtual) asks
   * `sub_487D10` to pick one of the mob's WZ attacks that (a) the player's rect/line is inside and
   * (b) `conMP <= mob MP`, and `sub_4885D0` then plays it and sends this packet. The same function
   * is reached from the action's hit frame (`sub_487A30`) and from the reset path, with `0xFF` as
   * the action byte - so this is "the mob's action state, as the client sees it", not a clean
   * "attack" record.
   */
  mobAttack: 0x2c,
  /**
   * The client's request **about one user** (`sub_4717D0`), the packet `/귓속말` and `/헉추적` build:
   * `[0x23][u8 kind][string name][string text]` - see `ClientUserRequest` below for the kind byte and
   * which of the two strings a kind carries.
   *
   * It shares its body's first byte with nothing else: `0x22` (the GM broadcast) and `0x25`/`0x26`
   * (trade and party) are *different opcodes* built by the sibling senders `sub_470E10` / `sub_471A40`
   * / `sub_471E90` - `0x23` is only ever this request, and the same byte inside it happens to be a
   * kind (`0x22` = the client's balloon request, FINDINGS 4.31).
   */
  userRequest: 0x23,
} as const;

/** `0x0E` as it arrives from the client. */
export interface ClientUserMove {
  /** The byte the client took from its stage object (`CStage + 0x9C`). */
  stageByte: number;
  path: MovePath;
}

export function readClientUserMove(reader: PacketReader): ClientUserMove {
  const stageByte = reader.readByte();
  return { stageByte, path: readMovePath(reader) };
}

export function encodeClientUserMove(move: ClientUserMove): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(CLIENT_FIELD_OPCODE.userMove);
  writer.writeByte(move.stageByte & 0xff);
  writeMovePath(writer, move.path);
  return writer.toBytes();
}

/**
 * A `0x1C` as the client sends it: the change of its own record, not the new value.
 *
 * `hpDelta`/`mpDelta` are `undefined` when the client did not set that flag bit - the writer always
 * sets both, so a report from the real client has both, but the format allows either.
 */
export interface ClientStatReport {
  /** HP change; negative is damage (`sub_5114A0` sends `-damage`). */
  hpDelta?: number;
  /** MP change; negative is MP spent, positive is the field's regeneration. */
  mpDelta?: number;
  /**
   * The trailing byte, which the client writes unconditionally. Its role is not located: the damage
   * path sends 0 and the regeneration path sends 1 when the field type is 36/37 and the recovery is
   * item-driven (`sub_558950`, `sub_4BE790`). The server keeps it so the field is not lost.
   */
  flag: number;
}

/**
 * The two fields of a `0x1C`, in the flag order the client writes them. The flags are the **`0x0D`
 * diff's own bits**, taken from `statDiffFlag` rather than written out again, because that is what
 * they are: `0x400` hp, `0x1000` mp.
 */
const STAT_REPORT_FIELDS = [
  { name: "hpDelta", flag: statDiffFlag("hp") },
  { name: "mpDelta", flag: statDiffFlag("mp") },
] as const;

const STAT_REPORT_KNOWN_FLAGS = STAT_REPORT_FIELDS.reduce((all, field) => all | field.flag, 0);

/** Read one `0x1C` body (the reader must sit at `flags`, i.e. just past the opcode byte). */
export function readClientStatReport(reader: PacketReader): ClientStatReport {
  const flags = reader.readU32();
  if ((flags & ~STAT_REPORT_KNOWN_FLAGS) !== 0) {
    throw new RangeError(
      `0x1c stat report flags 0x${flags.toString(16)}: only the hp (0x400) and mp (0x1000) fields are located`,
    );
  }
  const report: ClientStatReport = { flag: 0 };
  for (const field of STAT_REPORT_FIELDS) {
    if ((flags & field.flag) === 0) continue;
    // A delta is `s16`: -30 arrives as 0xFFE2.
    const raw = reader.readU16();
    report[field.name] = (raw << 16) >> 16;
  }
  report.flag = reader.readByte();
  return report;
}

/** Write one `0x1C`. Refuses a delta that does not fit `s16` instead of wrapping it. */
export function encodeClientStatReport(report: ClientStatReport): Uint8Array {
  const writer = new PacketWriter(13);
  writer.writeByte(CLIENT_FIELD_OPCODE.statReport);
  let flags = 0;
  for (const field of STAT_REPORT_FIELDS) {
    if (report[field.name] !== undefined) flags = (flags | field.flag) >>> 0;
  }
  writer.writeU32(flags);
  for (const field of STAT_REPORT_FIELDS) {
    const value = report[field.name];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
      throw new RangeError(`0x1c stat report field "${field.name}" (s16) cannot hold ${value}`);
    }
    writer.writeU16(value & 0xffff);
  }
  writer.writeByte(report.flag & 0xff);
  return writer.toBytes();
}

/** One line for the `decode` tool: `hpDelta=-30 mpDelta=0 flag=0`. */
export function describeClientStatReport(report: ClientStatReport): string {
  const parts = STAT_REPORT_FIELDS.filter((field) => report[field.name] !== undefined).map(
    (field) => `${field.name}=${report[field.name]}`,
  );
  return `${parts.length === 0 ? "(no fields)" : parts.join(" ")} flag=${report.flag}`;
}

/**
 * One "the USE tab did something" request - `useItem` (`0x18`) and `useMapItem` (`0x19`) carry the
 * same two fields, and they are the whole of it: no count, no tab, no destination.
 *
 * `slot` is a slot of the USE tab, read as `s16` because that is the client's own argument type
 * (`sub_55B2C0(int *this, __int16 a2, int Args)`), and the two agree on every value the USE tab can
 * hold. What the slot holds is the server's business: only it knows the inventory
 * (`game/items.ts`), so a request that names a different item than the slot holds is refused.
 */
export interface ClientUseItem {
  /** The USE tab slot the client clicked. */
  slot: number;
  /** The item id the client says is there. */
  itemId: number;
}

/** The two senders that share this layout; `0x17` and `0x1A` are different shapes (FINDINGS 4.34). */
export const USE_ITEM_OPCODES: readonly number[] = [
  CLIENT_FIELD_OPCODE.useItem,
  CLIENT_FIELD_OPCODE.useMapItem,
];

function checkUseItemOpcode(opcode: number): void {
  if (!USE_ITEM_OPCODES.includes(opcode)) {
    throw new RangeError(`0x${opcode.toString(16)} is not one of the use-item opcodes (0x18, 0x19)`);
  }
}

/** Read one `0x18`/`0x19` body (the reader must sit at `slot`, i.e. just past the opcode byte). */
export function readClientUseItem(
  reader: PacketReader,
  opcode: number = CLIENT_FIELD_OPCODE.useItem,
): ClientUseItem {
  checkUseItemOpcode(opcode);
  // `mov %cx` in `sub_55B2C0`: the slot is 16 bits of the client's own `__int16` parameter.
  return { slot: (reader.readU16() << 16) >> 16, itemId: reader.readU32() };
}

/** Write one `0x18`/`0x19`. The opcode has to be one of the two, so the byte cannot go wrong. */
export function encodeClientUseItem(
  request: ClientUseItem,
  opcode: number = CLIENT_FIELD_OPCODE.useItem,
): Uint8Array {
  checkUseItemOpcode(opcode);
  if (!Number.isInteger(request.slot) || request.slot < -0x8000 || request.slot > 0x7fff) {
    throw new RangeError(`use-item slot ${request.slot} does not fit the client's s16 field`);
  }
  if (!Number.isInteger(request.itemId) || request.itemId < 0 || request.itemId > 0xffffffff) {
    throw new RangeError(`use-item itemId ${request.itemId} does not fit the u32 field`);
  }
  const writer = new PacketWriter(7);
  writer.writeByte(opcode);
  writer.writeU16(request.slot & 0xffff);
  writer.writeU32(request.itemId >>> 0);
  return writer.toBytes();
}

/** One line for the `decode` tool: `slot=3 itemId=2000000`. */
export function describeClientUseItem(request: ClientUseItem): string {
  return `slot=${request.slot} itemId=${request.itemId}`;
}

/**
 * One target of a `0x0F` attack, i.e. one mob the client decided it hit.
 *
 * The client keeps a 76-byte record per target (`sub_512F90`, `memset 0x4C`):
 * `+0` mob object, `+4` hit animation, `+8..+67` up to fifteen `int` damages, `+68`/`+72` x/y.
 * The wire form is the low byte of `+4`, the low 16 bits of `+360`/`+364` from the mob object,
 * one sequence word and the low 16 bits of each damage.
 */
export interface ClientAttackTarget {
  /** The mob's object id (`*(mob + 120)`) - the same field the server -> client packets carry. */
  mobId: number;
  /**
   * Which hit animation the client played: `-1` when the mob's max damage stat
   * (`*(*(mob + 124) + 112)`) is `<= 0`, else `rand() % that + 7`. Sent as a signed byte.
   */
  hitAnimation: number;
  /** Low 16 bits of the mob's x (`mob + 360`, an `int` in memory). */
  x: number;
  /** Low 16 bits of the mob's y (`mob + 364`, an `int` in memory). */
  y: number;
  /**
   * `v123`: `*(this + 49) - *(this + 50)[last]`, i.e. a difference between two attack counters of
   * the local user. It is the *same* for every target in one packet, and the client also feeds it
   * to its own hit routine, so it is per-swing rather than per-mob; what the server should do with
   * it is not located, so it keeps its place (FINDINGS 4.13.1 `sequence`).
   */
  sequence: number;
  /** Exactly `hits` numbers - what the client applied locally and drew on screen. */
  damages: number[];
}

/** `0x0F` as it arrives from the client: one swing, with the client's damage already computed. */
export interface ClientAttack {
  /** Low nibble of byte 1: hits per target (the client clamps them to 1..15). */
  hits: number;
  /**
   * High nibble of byte 1. For `0x0F` that is the number of target records (`sub_491E90` returns
   * at most 6); for `0x10`/`0x11` the client writes it from a pointer test
   * (`16 * (v129 != nullptr)`) instead of a count, so it can only be 0 or 1.
   */
  targetCount: number;
  /** `*right`: the object the cursor was over (`sub_4BDD20` found it in the field object list). */
  clickedMobId: number;
  /** Bit 7 of byte 3: facing left (`*(this + 45) & 1`, the flag that also mirrors the swing rect). */
  facingLeft: boolean;
  /** Low 7 bits of byte 3: the action `sub_427F60` picked out of the table at `dword_5B2144`. */
  action: number;
  /**
   * Byte 4: how many more mobs this swing may still hit - `sub_4BE8B0(range, targetId, state)`,
   * clamped to 0..6. The client derives the actual target list from it, so a server can use it as
   * the bound it must not exceed.
   */
  targetCap: number;
  /** `0x10` only: the `u16` between the header and the target record (`sub_513C80`); not named. */
  unknownU16?: number | undefined;
  targets: ClientAttackTarget[];
}

const ATTACK_HEADER_BYTES = 8; // opcode + packed + clicked id + packed action + target cap
const ATTACK_TARGET_FIXED_BYTES = 11; // u32 + s8 + 3 * u16

/**
 * How the three attack senders differ. Everything else - the header order, the 11-byte target
 * record, the damages - is one shared layout (`sub_512F90` / `sub_513C80` / `sub_514D30`), so all
 * three go through the same reader instead of three near-identical ones.
 */
interface AttackShape {
  /** `true` for `0x10`, which writes a `u16` between the header and the target record. */
  extraU16AfterHeader: boolean;
}

export const ATTACK_SHAPE: Record<number, AttackShape> = {
  [CLIENT_FIELD_OPCODE.attack]: { extraU16AfterHeader: false },
  [CLIENT_FIELD_OPCODE.magicAttack]: { extraU16AfterHeader: true },
  [CLIENT_FIELD_OPCODE.skillAttack]: { extraU16AfterHeader: false },
};

function attackShapeOf(opcode: number): AttackShape {
  return ATTACK_SHAPE[opcode] ?? ATTACK_SHAPE[CLIENT_FIELD_OPCODE.attack]!;
}

export function readClientAttack(reader: PacketReader, opcode: number = CLIENT_FIELD_OPCODE.attack): ClientAttack {
  const packed = reader.readByte();
  const hits = packed & 0x0f;
  const targetCount = (packed >> 4) & 0x0f;
  const clickedMobId = reader.readU32();
  const packedAction = reader.readByte();
  const targetCap = reader.readByte();
  let unknownU16: number | undefined;
  if (attackShapeOf(opcode).extraU16AfterHeader) unknownU16 = reader.readU16();
  const targets: ClientAttackTarget[] = [];
  for (let i = 0; i < targetCount; i++) {
    const mobId = reader.readU32();
    const rawAnimation = reader.readByte();
    const hitAnimation = (rawAnimation << 24) >> 24; // the client writes a `_BYTE` here
    const x = reader.readU16();
    const y = reader.readU16();
    const sequence = reader.readU16();
    const damages: number[] = [];
    for (let hit = 0; hit < hits; hit++) damages.push(reader.readU16());
    targets.push({ mobId, hitAnimation, x, y, sequence, damages });
  }
  const attack: ClientAttack = {
    hits,
    targetCount,
    clickedMobId,
    facingLeft: (packedAction & 0x80) !== 0,
    action: packedAction & 0x7f,
    targetCap,
    targets,
  };
  // only `0x10` has the slot, so the other two never grow an undefined key
  if (unknownU16 !== undefined) attack.unknownU16 = unknownU16;
  return attack;
}

export function encodeClientAttack(attack: ClientAttack, opcode: number = CLIENT_FIELD_OPCODE.attack): Uint8Array {
  const hits = attack.hits & 0x0f;
  const targetCount = attack.targets.length;
  if (targetCount > 0x0f) throw new RangeError(`the attack header packs at most 15 targets, got ${targetCount}`);
  const shape = attackShapeOf(opcode);
  const writer = new PacketWriter(
    ATTACK_HEADER_BYTES + (shape.extraU16AfterHeader ? 2 : 0) + targetCount * (ATTACK_TARGET_FIXED_BYTES + 2 * hits),
  );
  writer.writeByte(opcode);
  writer.writeByte(hits | (targetCount << 4));
  writer.writeU32(attack.clickedMobId >>> 0);
  writer.writeByte((attack.facingLeft ? 0x80 : 0) | (attack.action & 0x7f));
  writer.writeByte(attack.targetCap & 0xff);
  if (shape.extraU16AfterHeader) writer.writeU16(attack.unknownU16 ?? 0);
  for (const target of attack.targets) {
    if (target.damages.length !== hits) {
      throw new RangeError(`a target carries exactly ${hits} damage value(s), got ${target.damages.length}`);
    }
    writer.writeU32(target.mobId >>> 0);
    writer.writeByte(target.hitAnimation & 0xff);
    writer.writeU16(target.x);
    writer.writeU16(target.y);
    writer.writeU16(target.sequence);
    for (const damage of target.damages) writer.writeU16(damage);
  }
  return writer.toBytes();
}

/**
 * `0x2C` as it arrives from the client: a mob's action state change, which for an attack means
 * "this mob just swung at me".
 *
 * What is proven (FINDINGS 4.20): the first three fields and that `sub_495880`/`sub_495620` append a
 * tail afterwards. What is **not** proven: the meaning of the flag bits and of that tail, so the
 * tail is kept verbatim and the flags keep their bits.
 */
export interface ClientMobAttack {
  /** The mob's object id (`*(mob + 120)`) - the key every server -> client mob packet uses. */
  mobId: number;
  /**
   * The raw flag byte. Bit 0 is a 71-in-101 roll of the client's own global generator
   * (`sub_4619F0(&dword_5D2C20) % 0x65 <= 0x46`), which the server cannot reproduce; the high
   * nibble is the caller's own `a5` (1 from the AI's attack, 0 from the hit-frame/reset paths).
   */
  flags: number;
  /**
   * The action byte, encoded like `0x33`'s: `(action << 1) | facing`. `0xFF` is the reset form
   * (`sub_4885D0(mob, -1, 0, 0, 0)`), which is why this stays a byte instead of being unpacked.
   */
  actionByte: number;
  /** The action index, or `undefined` for the `0xFF` reset form. */
  action?: number;
  /** Bit 0 of the action byte: 0 = right, 1 = left. */
  facing: number;
  /**
   * `u32`: for the attack types that have a throw/magic origin (`v9[3] != 0`) the client packs the
   * spot into `x | y << 16`; otherwise it writes 0 (`sub_487D10`). Both halves are read as `s16`
   * because that is how `sub_487D10` builds them.
   */
  positionX: number;
  positionY: number;
  /** `positionX | positionY << 16 != 0`: the client only writes a spot for some attack types. */
  hasPosition: boolean;
  /** Everything after the position, appended by `sub_495880` -> `sub_495620`. Not decoded. */
  tail: Uint8Array;
}

/** Read the fields of a `0x2C` body (no opcode byte; the reader must sit at the mob id). */
export function readClientMobAttack(reader: PacketReader): ClientMobAttack {
  const mobId = reader.readU32();
  const flags = reader.readByte();
  const actionByte = reader.readByte();
  const raw = reader.readU32();
  const attack: ClientMobAttack = {
    mobId,
    flags,
    actionByte,
    action: actionByte === 0xff ? undefined : (actionByte >> 1) & 0x7f,
    facing: actionByte & 1,
    positionX: (raw & 0xffff) << 16 >> 16,
    positionY: (raw >>> 16) << 16 >> 16,
    hasPosition: raw !== 0,
    tail: reader.readBytes(reader.remaining),
  };
  // `action` is absent for the 0xFF form - an undefined key would show up in JSON and in deepEqual.
  if (attack.action === undefined) delete attack.action;
  return attack;
}

/**
 * The `0x2C` fields that are *written*: `action` and `facing` live inside `actionByte` and
 * `hasPosition` is just "the raw u32 is not 0", so none of the three is an input.
 */
export type ClientMobAttackBody = Omit<ClientMobAttack, "action" | "facing" | "hasPosition">;

/**
 * Encode one `0x2C` body. `tail` is passed through untouched, because it is not decoded yet - the
 * oracle run (ADR-004) can capture what the real client appends and hand it back in unchanged.
 */
export function encodeClientMobAttack(attack: ClientMobAttackBody): Uint8Array {
  const writer = new PacketWriter(9 + attack.tail.length);
  writer.writeByte(CLIENT_FIELD_OPCODE.mobAttack);
  writer.writeU32(attack.mobId >>> 0);
  writer.writeByte(attack.flags & 0xff);
  writer.writeByte(attack.actionByte & 0xff);
  writer.writeU32(((attack.positionY & 0xffff) << 16 >>> 0) | (attack.positionX & 0xffff));
  writer.writeBytes(attack.tail);
  return writer.toBytes();
}

/**
 * The `kind` a click sends when the object under the cursor is what was clicked
 * (`sub_5124C0`/`sub_512510`): "it", whatever `name` says it is.
 *
 * Three values are located, and they share this packet: this one, `INTERACT_KIND_REVIVE` (0), and the
 * GM `/헉맵 <mapId>` command, which puts the **map id** in `kind` (`sub_472590(atoi(arg), nullptr)`,
 * FINDINGS 4.13) - which is why a handler has to match on the value instead of assuming a click.
 */
export const INTERACT_KIND_CURSOR = -1;

/**
 * The `kind` the revive dialog sends: `sub_4E9E70` - what the `CUIRevive` window's OK button and
 * VK_RETURN both run (`sub_4E9E20` case 1, `sub_4E9E30`) - calls `sub_472590(0, nullptr)`, i.e. this
 * same packet with `0 = kind` and an empty name. That dialog is the one that appears 2.2 s after the
 * player dies, and it is the only thing in the client that asks the server for a revive (FINDINGS
 * 4.32); the destination is the server's own answer (`game/map.ts`'s `reviveMapId`).
 */
export const INTERACT_KIND_REVIVE = 0;

/**
 * `0x0D` as it arrives from the client - `CField::SendInteract` (`sub_472590`), the one packet the
 * two click paths and the revive share:
 *
 *   `kind` -1              the object under the cursor; `name` is its name (a portal's `pn`)
 *   `kind` 0               the revive dialog's OK (the GM `/헉맵` command puts the map id here)
 *   `name`                 an empty string for anything but a cursor click
 */
export interface ClientInteract {
  /** `INTERACT_KIND_CURSOR` (-1), `INTERACT_KIND_REVIVE` (0), or a GM map id - see above. */
  kind: number;
  name: string;
}

export function readClientInteract(reader: PacketReader): ClientInteract {
  const kind = reader.readU32() | 0;
  return { kind, name: reader.readAsciiString() };
}

export function encodeClientInteract(interact: ClientInteract): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(CLIENT_FIELD_OPCODE.interact);
  writer.writeU32(interact.kind >>> 0);
  writer.writeAsciiString(interact.name);
  return writer.toBytes();
}

/**
 * The sub-op of `0x1A` that carries **field chat**: the jump table case of `sub_472910` that formats
 * two strings as `"%s>> %s"` and hands the line to the chat window (`sub_4FB670`) - or, when the
 * chat window is closed, builds the client's own balloon packet out of the name and the text.
 */
export const USER_MESSAGE_CHAT = 0x12;

/**
 * A chat line as it goes out: the speaker's name and what they said.
 *
 * The **name is the only thing identifying the speaker** - there is no character id in the packet,
 * because the receiving client only needs it to say "this is who" (it looks a user up by name when it
 * has to draw something over a head). It is written as an ASCII/byte string, the way every other name
 * in this protocol is (`CharacterData`'s name field, `0x0D`'s object name).
 *
 * The text stays **bytes** (CP949, `u16 length` + raw): the server relays it and never has to read
 * it, and a byte-level pass-through is the only version that cannot lose a character to a
 * decode/encode round trip. `describeUserChat` decodes it for the log, where a human eye is the
 * consumer.
 */
export interface UserChat {
  name: string;
  text: Uint8Array;
}

/**
 * `0x1A` as it arrives: `u8 sub-op` + the sub-op's body. Only chat is understood - a different
 * sub-op throws, because naming its body would be a guess (FINDINGS 4.11.6's rule for `0x0D`'s
 * `kind`).
 */
export function readUserChat(reader: PacketReader): UserChat {
  const subOp = reader.readByte();
  if (subOp !== USER_MESSAGE_CHAT) {
    throw new RangeError(
      `0x1a sub-op 0x${subOp.toString(16)} is not chat (0x${USER_MESSAGE_CHAT.toString(16)})`,
    );
  }
  return { name: reader.readAsciiString(), text: reader.readStringBytes() };
}

export function encodeUserChat(chat: UserChat): Uint8Array {
  const writer = new PacketWriter(chat.text.length + chat.name.length + 8);
  writer.writeByte(FIELD_OPCODE.userMessage);
  writer.writeByte(USER_MESSAGE_CHAT);
  writer.writeAsciiString(chat.name);
  writer.writeStringBytes(chat.text);
  return writer.toBytes();
}

/** `chat "Hero": hello` - the text decoded, because the point of the line is to be read. */
export function describeUserChat(chat: UserChat): string {
  return `chat "${chat.name}": ${decodeCp949(chat.text)}`;
}

/** `0x12` as it arrives from the client: the message, in the bytes the client typed. */
export interface ClientChat {
  /** The message exactly as it came off the wire (CP949, no length prefix). */
  text: Uint8Array;
}

export function readClientChat(reader: PacketReader): ClientChat {
  return { text: reader.readStringBytes() };
}

export function encodeClientChat(chat: ClientChat): Uint8Array {
  const writer = new PacketWriter(chat.text.length + 4);
  writer.writeByte(CLIENT_FIELD_OPCODE.chat);
  writer.writeStringBytes(chat.text);
  return writer.toBytes();
}

export function describeClientChat(chat: ClientChat): string {
  return `0x12 chat: ${decodeCp949(chat.text)}`;
}

/**
 * The sub-op of `0x1A` that carries the answer to a **find** (`/헉추적 <name>`): the jump table case
 * of `sub_472910` that reads `string name` + `u32 mapId`, loads `Map/Map/%09d.img` from the id with
 * `sub_4694F0` and prints "'name'님의 현재 위치는 'street:map'입니다".
 *
 * `0xFFFFFFFF` is "not found" - the same handler prints "'name'님을 찾지 못했습니다" for it, and the
 * second field is an id the *client* turns into a place name out of its own data. That is why there
 * is no map name on the wire (FINDINGS 4.31).
 */
export const USER_MESSAGE_FIND_ANSWER = 0x09;

/** A find answer as it goes out: who was asked about, and where they are (`mapId` = -1 when nobody). */
export interface UserFindAnswer {
  /** The name to print: the typed one when nobody was found, the character's own name when somebody was. */
  name: string;
  /** `0xFFFFFFFF` = not found; anything else is a `Map/Map/%09d.img` id. */
  mapId: number;
}

export function readUserFindAnswer(reader: PacketReader): UserFindAnswer {
  const subOp = reader.readByte();
  if (subOp !== USER_MESSAGE_FIND_ANSWER) {
    throw new RangeError(
      `0x1a sub-op 0x${subOp.toString(16)} is not a find answer (0x${USER_MESSAGE_FIND_ANSWER.toString(16)})`,
    );
  }
  return { name: reader.readAsciiString(), mapId: reader.readU32() | 0 };
}

export function encodeUserFindAnswer(answer: UserFindAnswer): Uint8Array {
  const writer = new PacketWriter(answer.name.length + 8);
  writer.writeByte(FIELD_OPCODE.userMessage);
  writer.writeByte(USER_MESSAGE_FIND_ANSWER);
  writer.writeAsciiString(answer.name);
  writer.writeU32(answer.mapId >>> 0);
  return writer.toBytes();
}

export function describeUserFindAnswer(answer: UserFindAnswer): string {
  return answer.mapId === -1
    ? `find answer "${answer.name}": not found`
    : `find answer "${answer.name}": map ${answer.mapId}`;
}

/**
 * The sub-op of `0x1A` that answers a **whisper**: the `sub_472910` case that reads `string name` +
 * `u8 flag` and shows either "'name'님께 귓속말을 전달했습니다." (delivered) or
 * "'name'님을 찾지 못했습니다" (flag 0).
 *
 * The text is **not** in this packet: the client kept the one it sent (`CField+28`, written by
 * `sub_4717D0`) and renders "name<< text" from it, which is what makes this an echo of the sender's
 * own line rather than a message (FINDINGS 4.31).
 */
export const USER_MESSAGE_WHISPER_ANSWER = 0x0a;

/** A whisper's answer: the target's name, and whether it was delivered. */
export interface UserWhisperAnswer {
  name: string;
  /** `false` = "not found"; the client has no second failure message for this packet. */
  delivered: boolean;
}

export function readUserWhisperAnswer(reader: PacketReader): UserWhisperAnswer {
  const subOp = reader.readByte();
  if (subOp !== USER_MESSAGE_WHISPER_ANSWER) {
    throw new RangeError(
      `0x1a sub-op 0x${subOp.toString(16)} is not a whisper answer (0x${USER_MESSAGE_WHISPER_ANSWER.toString(16)})`,
    );
  }
  return { name: reader.readAsciiString(), delivered: reader.readByte() !== 0 };
}

export function encodeUserWhisperAnswer(answer: UserWhisperAnswer): Uint8Array {
  const writer = new PacketWriter(answer.name.length + 8);
  writer.writeByte(FIELD_OPCODE.userMessage);
  writer.writeByte(USER_MESSAGE_WHISPER_ANSWER);
  writer.writeAsciiString(answer.name);
  // Only zero-ness is read (`if ((_BYTE)this_1 != 0)`), so one value means "delivered" and no other
  // value can mean anything - the 2003 server's own choice of non-zero is not in the client.
  writer.writeByte(answer.delivered ? 1 : 0);
  return writer.toBytes();
}

export function describeUserWhisperAnswer(answer: UserWhisperAnswer): string {
  return `whisper answer "${answer.name}": ${answer.delivered ? "delivered" : "not found"}`;
}

/**
 * `0x23`: the client's **request about one user** (`sub_4717D0`), the packet both `/귓속말` and
 * `/헉추적` send.
 *
 *   u8  kind   0x05 find / 0x06 whisper / 0x22 balloon (`0x04 | hasText + 1`, `0x20 | 2`)
 *   str name   the target, ASCII/CP949 bytes
 *   str text   only for the kinds that carry one
 *
 * `sub_4717D0` writes the kind as `(v6 + 1) | 4` where `v6` is "the text is non-empty"
 * (`.text:00471859`: `sete %bl` / `inc %ebx` / `or $0x4,%bl`), so the byte is `0x04 | 1` for a
 * request without text and `0x04 | 2` with it. The two strings follow name-then-text: the function
 * writes its 3rd argument first (`.text:004718ad`), and at the `/귓속말` call site that argument is
 * the name (`sub_526370`'s first output, the one `sub_524A00` validates as a character name) while
 * the 2nd is the text (FINDINGS 4.31).
 */
export interface ClientUserRequest {
  /** `USER_REQUEST_KIND.*`. */
  kind: number;
  name: string;
  /** The message, as typed (CP949 bytes). Absent for a request that carries none. */
  text?: Uint8Array;
}

export const USER_REQUEST_KIND = {
  /** `0x04 | 1`: "where is this user" - `/헉추적 <name>`. */
  find: 0x05,
  /** `0x04 | 2`: "say this to this user" - `/귓속말 <name> <text>`. */
  whisper: 0x06,
  /**
   * `0x20 | 2`: the client's **balloon request** - what it sends when it cannot print a line it
   * received. `sub_472910`'s `0x12` case hands the line to the chat window only while
   * `dword_5C1F74 + 24` is non-zero (`.text:004729DC`), and otherwise builds a packet of its own:
   * opcode `0x23` (`.text:00472A06`), this kind byte (`.text:00472A2C`), then the speaker's name and
   * the text (`sub_430230` at `.text:00472A53` and `.text:00472A79`), and sends it to the game
   * server (`.text:00472A89`).
   *
   * Nothing here answers it: which server packet draws a balloon (if any) is not located, so the
   * request is decodable and the server logs it instead of guessing (FINDINGS 4.31, §6).
   */
  balloon: 0x22,
} as const;

/** `0x23` as it arrives from the client. */
export function readClientUserRequest(reader: PacketReader): ClientUserRequest {
  const kind = reader.readByte();
  const name = reader.readAsciiString();
  if (kind === USER_REQUEST_KIND.find) return { kind, name };
  if (kind === USER_REQUEST_KIND.whisper || kind === USER_REQUEST_KIND.balloon) {
    return { kind, name, text: reader.readStringBytes() };
  }
  throw new RangeError(`0x23 kind 0x${kind.toString(16)} is not a user request (0x05 / 0x06 / 0x22)`);
}

export function encodeClientUserRequest(request: ClientUserRequest): Uint8Array {
  const text = request.text;
  const writer = new PacketWriter((text?.length ?? 0) + request.name.length + 4);
  writer.writeByte(CLIENT_FIELD_OPCODE.userRequest);
  writer.writeByte(request.kind);
  writer.writeAsciiString(request.name);
  if (text !== undefined) writer.writeStringBytes(text);
  return writer.toBytes();
}

export function describeClientUserRequest(request: ClientUserRequest): string {
  const text = request.text;
  if (text === undefined) return `0x23 find "${request.name}"`;
  const said = decodeCp949(text);
  return request.kind === USER_REQUEST_KIND.balloon
    ? `0x23 balloon "${request.name}": ${said}`
    : `0x23 whisper "${request.name}": ${said}`;
}

/**
 * The one `0x29` effect that is located: the level-up animation and sound, played over the user the
 * packet names (`sub_522300`'s first branch).
 */
export const USER_EFFECT_LEVEL_UP = 0;

/**
 * `0x29` as it goes out: which user the effect happens to, and which effect.
 *
 * The id comes first because the range dispatcher reads it (and drops the packet when the pool does
 * not know it), and the effect is one byte. `effect` is a number rather than a union because only
 * `USER_EFFECT_LEVEL_UP` has evidence - the `1` branch reads a `u32` whose meaning is not located.
 */
export interface UserEffect {
  characterId: number;
  /** `USER_EFFECT_LEVEL_UP`; other values are not located and `readUserEffect` refuses them. */
  effect: number;
}

export function readUserEffect(reader: PacketReader): UserEffect {
  const characterId = reader.readU32();
  const effect = reader.readByte();
  if (effect !== USER_EFFECT_LEVEL_UP) {
    throw new RangeError(
      `0x29 effect ${effect} is not the located one (${USER_EFFECT_LEVEL_UP} = level-up)`,
    );
  }
  return { characterId, effect };
}

export function encodeUserEffect(effect: UserEffect): Uint8Array {
  const writer = new PacketWriter(8);
  writer.writeByte(FIELD_OPCODE.userEffect);
  writer.writeU32(effect.characterId >>> 0);
  writer.writeByte(effect.effect);
  return writer.toBytes();
}

export function describeUserEffect(effect: UserEffect): string {
  return effect.effect === USER_EFFECT_LEVEL_UP
    ? `level-up effect for characterId=${effect.characterId}`
    : `effect ${effect.effect} for characterId=${effect.characterId}`;
}
