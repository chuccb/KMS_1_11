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
import {
  MOB_OPCODE,
  describeMobEnterField,
  describeMobLeaveDelayed,
  describeMobMove,
  describeMobPresence,
  describeMobStat,
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
    if (opcode === CLIENT_FIELD_OPCODE.interact) {
      const interact = readClientInteract(new PacketReader(plain, 1));
      return `0x0d interact: kind=${interact.kind} name="${interact.name}"`;
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
  if (opcode < 0x15 || opcode > 0x52) return undefined;
  const name = describeFieldOpcode(opcode);
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
  if (opcode === MOB_OPCODE.stat) {
    try {
      return `${name}: ${describeMobStat(readMobStat(new PacketReader(plain, 1)))}`;
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
  if (opcode === DROP_OPCODE.appear) return "0x43 CRewardPool(drop appear)";
  if (opcode === DROP_OPCODE.remove) return "0x44 CRewardPool(drop gone)";
  if (opcode === 0x42 || opcode === 0x45) return `0x${opcode.toString(16)} CRewardPool(no handler)`;
  if (opcode >= 0x46 && opcode <= 0x48) return `0x${opcode.toString(16)} CQuestMan`;
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
