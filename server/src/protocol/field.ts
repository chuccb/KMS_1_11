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
 *   0x1A        sub_472910(this - 8, packet)          CField       (chat/whisper/find family)
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
import { readMovePath, writeMovePath, type MovePath } from "./movepath.ts";
import { readCharacterData, writeCharacterData, type CharacterData } from "./chardata.ts";

/** Field opcodes with a located handler. `read`/`write` say which directions make sense. */
export const FIELD_OPCODE = {
  /**
   * `CStage` base (0x15-0x17, only 0x16 does anything): the server moves the client into a
   * field. `sub_4C2780` reads `u8`, `u8`, and - when the second byte is non-zero - three u32s
   * followed by a whole `CharacterData` (the same `sub_45FCC0` reader FINDINGS 4.9 documents),
   * then creates the field object and the local user (`sub_51CBF0` on `CUserPool`).
   */
  setField: 0x16,
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
   * `CUserPool` 0x29 (`sub_522300`): reads a u8 and plays an effect - 0 is
   * "Effect/BasicEff.img/LevelUp" with the "LevelUp" sound, i.e. the level-up packet.
   */
  userLevelUpEffect: 0x29,
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
  /** First byte of the packet. Its effect is not located; real traffic has to pin it down. */
  mode: number;
  /** `0` = the "already known character" form, non-zero = carry a full `CharacterData`. */
  full: boolean;
  unknownA: number;
  unknownB: number;
  unknownC: number;
  character: CharacterData;
}

export function readSetField(reader: PacketReader): SetField {
  const mode = reader.readByte();
  const hasData = reader.readByte();
  if (hasData === 0) {
    throw new Error("the 0x16 form without CharacterData is not decoded yet (see FINDINGS 4.11)");
  }
  const unknownA = reader.readU32();
  const unknownB = reader.readU32();
  const unknownC = reader.readU32();
  const character = readCharacterData(reader);
  return { mode, full: true, unknownA, unknownB, unknownC, character };
}

export function encodeSetField(field: SetField): Uint8Array {
  if (!field.full) throw new Error("the 0x16 form without CharacterData is not decoded yet (see FINDINGS 4.11)");
  const writer = new PacketWriter(256);
  writer.writeByte(FIELD_OPCODE.setField);
  writer.writeByte(field.mode & 0xff);
  writer.writeByte(1);
  writer.writeU32(field.unknownA >>> 0);
  writer.writeU32(field.unknownB >>> 0);
  writer.writeU32(field.unknownC >>> 0);
  writeCharacterData(writer, field.character);
  return writer.toBytes();
}

/**
 * One-line meaning for a decrypted server -> field packet, for the `decode` tool. Only the
 * opcodes with located handlers are described; everything else says so instead of guessing.
 */
export function describeFieldPacket(plain: Uint8Array): string | undefined {
  if (plain.length === 0) return undefined;
  const opcode = plain[0]!;
  if (opcode < 0x15 || opcode > 0x52) return undefined;
  const name = describeFieldOpcode(opcode);
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
  return `${name} (fields not decoded yet)`;
}

/** The subsystem an opcode belongs to, i.e. the second dispatch level of `sub_472770`. */
export function describeFieldOpcode(opcode: number): string {
  if (opcode >= 0x15 && opcode <= 0x17) return `0x${opcode.toString(16)} CStage(set-field)`;
  if (opcode === 0x19) return "0x19 CField(cached-character reset)";
  if (opcode === 0x1a) return "0x1a CField(chat/whisper/find)";
  if (opcode >= 0x1b && opcode <= 0x2d) return `0x${opcode.toString(16)} CUserPool`;
  if (opcode >= 0x2e && opcode <= 0x37) return `0x${opcode.toString(16)} CMobPool`;
  if (opcode >= 0x38 && opcode <= 0x41) return `0x${opcode.toString(16)} CNpcPool`;
  if (opcode >= 0x42 && opcode <= 0x45) return `0x${opcode.toString(16)} CRewardPool`;
  if (opcode >= 0x46 && opcode <= 0x48) return `0x${opcode.toString(16)} CQuestMan`;
  if (opcode >= 0x49 && opcode <= 0x4c) return `0x${opcode.toString(16)} field dialogs`;
  if (opcode >= 0x4d && opcode <= 0x4f) return `0x${opcode.toString(16)} CUIMessenger`;
  if (opcode >= 0x50 && opcode <= 0x52) return `0x${opcode.toString(16)} CMiniRoomBaseDlg`;
  return `0x${opcode.toString(16)}`;
}

/**
 * The two client -> server packets of the field stage that are decoded so far.
 *
 * Both carry the *same* move-path layout as 0x22 (the client's `CMovePath::Encode`/`Decode` are
 * one codec), but the envelope differs, and so does the direction of the number: 0x22 is what the
 * server sends, 0x0E is what the client sends for its own character.
 */
export const CLIENT_FIELD_OPCODE = {
  /**
   * `CVecCtrlUser::SendMove` (`sub_542C40`): `[0x0E][u8 *(CStage+156)][CMovePath]`. The path comes
   * from `vecctrl + 216` (the embedded `CMovePath`), the byte from the current stage object - role
   * of that byte not located, so it keeps its offset in the packet.
   */
  userMove: 0x0e,
  /**
   * `CField::SendInteract` (`sub_472590`): `[0x0D][s32 kind][string name]`. The two click handlers
   * `sub_5124C0` / `sub_512510` send `kind = -1` and the name of the object under the cursor when
   * it is a portal (`[obj+0x14] != 999999999`), then play the "Portal" sound - so this is the
   * "player used a portal / clicked a field object" request the server answers with 0x16.
   * The function refuses to send more than once per 500 ms (`n3000[6]`/`n3000[7]`, re-armed by the
   * server's 0x19 reply).
   */
  interact: 0x0d,
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

/** `0x0D` as it arrives from the client. */
export interface ClientInteract {
  /** `-1` for "the portal/object under the cursor"; other values are not located. */
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
