/**
 * `CharacterData` - the client's character record, as it appears on the wire.
 *
 * EVIDENCE (MapleStory.exe.c / .lst, see docs/protocol/FINDINGS.md 4.9)
 * --------------------------------------------------------------------
 * Reader: `sub_45FCC0` (called with the packet; it is the function `CCharSelect` and
 * `CWorldSelect` both use for a character slot)
 *   u8 flags
 *   if (flags & 1) sub_45D840    - the 102-byte stat block below
 *   if (flags & 2) <30 equips + 4 inventories; NOT decoded yet, see FINDINGS 6>
 *
 * `sub_45D840` reads the stat block field by field, in exactly this order. Fields from `level`
 * to `unknown93` are *obfuscated in client memory* (the client stores `rand()` and `value ^
 * rand()` side by side, `sub_4618B0`), but **the wire value is the plain value**: the client's own
 * encoder (`sub_45D740`/`sub_45D640` call sites around MapleStory.exe.c:101309) XORs the two
 * halves back before writing them out. No random number is needed on either side.
 *
 * The client's `CharacterData::Decode` (`sub_45FCC0`) can also skip the block entirely
 * (`flags & 1 == 0`), in which case the client zeroes it.
 *
 * Names: `id`, the 13-byte name, `level`, `job` and the eleven `u16` stats are certain - the
 * widths and the order leave no other candidate. Five fields have no located reader yet; they
 * keep their offset in the name (`unknown81`, `unknown87`, `unknown93`, `unknown97`,
 * `unknown101`) instead of a guess. `unknown26` is a genuine `u8` between `face` and `hair`.
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** Fixed width of the character name field on the wire (12 visible bytes + NUL). */
export const CHARACTER_NAME_BYTES = 13;
export const CHARACTER_NAME_MAX = 12;

/**
 * Bytes a stat block occupies on the wire: `sub_45D840` reads exactly this much.
 *
 * Do not confuse it with the 102-byte copy the character-select UI keeps per slot (`sub_42E2C0`
 * copies `CharacterData[0..101]`): the extra 27 bytes are client-only state that never appears in a
 * packet, and writing them would desynchronise the record that follows.
 */
export const CHARACTER_STATS_BYTES = 75;

/** `u8 flags` bits of `sub_45FCC0`. */
export const CHAR_FLAG_STATS = 0x01;
export const CHAR_FLAG_ITEMS = 0x02;

export interface CharacterStats {
  /** u32 @+0; the client keys the character slot by this (`sub_432890` matches it). */
  id: number;
  /** 13 raw bytes @+4, NUL padded, not length-prefixed. */
  name: string;
  /** u8 @+17. */
  gender: number;
  /** u32 @+22 is copied into the avatar's body-part slot 0, u32 @+18 is fed to `sub_424590`
   *  (a two-value setter) - which of the two is "skin" and which is "face" is not proven, so
   *  they keep neutral names. Both are cosmetic ids from `Character.wz`. */
  appearanceA: number;
  appearanceB: number;
  /** u8 @+26; role unlocated. Must still be present - the client throws on underflow. */
  unknown26: number;
  /** u32 @+27. */
  hair: number;
  /** u8 @+31. Everything from here to `unknown93` is obfuscated in client memory only. */
  level: number;
  job: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  ap: number;
  sp: number;
  exp: number;
  fame: number;
  unknown81: number;
  unknown87: number;
  unknown93: number;
  /** u32 @+97; stored plainly (no obfuscation), like the byte below. */
  unknown97: number;
  /** u8 @+101; stored plainly. */
  unknown101: number;
}

/** A character as it travels in the character-select / world-select packets. */
export interface CharacterData {
  stats: CharacterStats;
  /**
   * Which optional blocks follow the stat block. The client's own reader only consumes what the
   * flags announce, so a server may legally send stats only (`CHAR_FLAG_STATS`) - that is what
   * this implementation does until the equip/inventory block is decoded (FINDINGS 6).
   */
  flags: number;
}

/** Pads/validates the 13-byte name field. Names are ASCII in this client (`sub_45DD00` copies raw). */
export function nameFieldBytes(name: string): Uint8Array {
  const out = new Uint8Array(CHARACTER_NAME_BYTES);
  if (name.length > CHARACTER_NAME_MAX) {
    throw new RangeError(`character name "${name}" is ${name.length} bytes; the client allows ${CHARACTER_NAME_MAX}`);
  }
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code > 0x7f) throw new RangeError(`character name "${name}" is not ASCII; the field is a char[13]`);
    out[i] = code;
  }
  return out;
}

/** Reads the 13-byte name field, stopping at the first NUL. */
export function nameFieldToString(field: Uint8Array): string {
  let end = 0;
  while (end < field.length && field[end] !== 0) end++;
  return Buffer.from(field.subarray(0, end)).toString("ascii");
}

/** Appends one stat block (no flags byte - see `writeCharacterData`). */
export function writeCharacterStats(writer: PacketWriter, s: CharacterStats): void {
  writer.writeU32(s.id);
  writer.writeBytes(nameFieldBytes(s.name));
  writer.writeByte(s.gender);
  writer.writeU32(s.appearanceA);
  writer.writeU32(s.appearanceB);
  writer.writeByte(s.unknown26);
  writer.writeU32(s.hair);
  writer.writeByte(s.level);
  writer.writeU16(s.job);
  writer.writeU16(s.str);
  writer.writeU16(s.dex);
  writer.writeU16(s.int);
  writer.writeU16(s.luk);
  writer.writeU16(s.hp);
  writer.writeU16(s.maxHp);
  writer.writeU16(s.mp);
  writer.writeU16(s.maxMp);
  writer.writeU16(s.ap);
  writer.writeU16(s.sp);
  writer.writeU32(s.exp);
  writer.writeU16(s.fame);
  writer.writeU32(s.unknown81);
  writer.writeU16(s.unknown87);
  writer.writeU32(s.unknown93);
  writer.writeU32(s.unknown97);
  writer.writeByte(s.unknown101);
}

/** Reads one stat block. Used by tests and by any tool that consumes our own output. */
export function readCharacterStats(reader: PacketReader): CharacterStats {
  const id = reader.readU32();
  const nameField = reader.readBytes(CHARACTER_NAME_BYTES);
  const gender = reader.readByte();
  const appearanceA = reader.readU32();
  const appearanceB = reader.readU32();
  const unknown26 = reader.readByte();
  const hair = reader.readU32();
  const level = reader.readByte();
  const job = reader.readU16();
  const str = reader.readU16();
  const dex = reader.readU16();
  const int = reader.readU16();
  const luk = reader.readU16();
  const hp = reader.readU16();
  const maxHp = reader.readU16();
  const mp = reader.readU16();
  const maxMp = reader.readU16();
  const ap = reader.readU16();
  const sp = reader.readU16();
  const exp = reader.readU32();
  const fame = reader.readU16();
  const unknown81 = reader.readU32();
  const unknown87 = reader.readU16();
  const unknown93 = reader.readU32();
  const unknown97 = reader.readU32();
  const unknown101 = reader.readByte();
  return {
    id,
    name: nameFieldToString(nameField),
    gender,
    appearanceA,
    appearanceB,
    unknown26,
    hair,
    level,
    job,
    str,
    dex,
    int,
    luk,
    hp,
    maxHp,
    mp,
    maxMp,
    ap,
    sp,
    exp,
    fame,
    unknown81,
    unknown87,
    unknown93,
    unknown97,
    unknown101,
  };
}

/** Appends `u8 flags` followed by whichever blocks the flags announce. */
export function writeCharacterData(writer: PacketWriter, data: CharacterData): void {
  if ((data.flags & ~(CHAR_FLAG_STATS | CHAR_FLAG_ITEMS)) !== 0) {
    throw new RangeError(`CharacterData flags 0x${data.flags.toString(16)}: the client only reads 0x01 and 0x02`);
  }
  if (data.flags & CHAR_FLAG_ITEMS) {
    throw new Error(
      "the CharacterData item block (30 equip slots + 4 inventories) is not decoded yet - see docs/protocol/FINDINGS.md 6",
    );
  }
  writer.writeByte(data.flags);
  if (data.flags & CHAR_FLAG_STATS) writeCharacterStats(writer, data.stats);
}

/** Reads one `CharacterData`. Throws on the item block, which is deliberately unimplemented. */
export function readCharacterData(reader: PacketReader): CharacterData {
  const flags = reader.readByte();
  if (flags & ~(CHAR_FLAG_STATS | CHAR_FLAG_ITEMS)) {
    throw new RangeError(`CharacterData flags 0x${flags.toString(16)} is not a known flag mask`);
  }
  if (flags & CHAR_FLAG_ITEMS) throw new Error("CharacterData item block is not decoded yet (FINDINGS 6)");
  const stats = flags & CHAR_FLAG_STATS ? readCharacterStats(reader) : zeroStats();
  return { flags, stats };
}

/** A stat block of all zeroes with an empty name; the client does the same for unused slots. */
export function zeroStats(): CharacterStats {
  return {
    id: 0,
    name: "",
    gender: 0,
    appearanceA: 0,
    appearanceB: 0,
    unknown26: 0,
    hair: 0,
    level: 0,
    job: 0,
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    hp: 0,
    maxHp: 0,
    mp: 0,
    maxMp: 0,
    ap: 0,
    sp: 0,
    exp: 0,
    fame: 0,
    unknown81: 0,
    unknown87: 0,
    unknown93: 0,
    unknown97: 0,
    unknown101: 0,
  };
}

/** Convenience for the common case: a stat-only character record. */
export function characterDataOf(stats: Partial<CharacterStats> & { id: number; name: string }): CharacterData {
  return { flags: CHAR_FLAG_STATS, stats: { ...zeroStats(), ...stats } };
}
