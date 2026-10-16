/**
 * `0x0D` - the **character stat diff** (server -> client). This is the only packet located so far
 * that changes the player's own HP, MP, EXP and level on screen: the status bar and the exp bar are
 * drawn from the client's own character record, and this is what writes that record after login.
 *
 * EVIDENCE (MapleStory.exe.c / .lst, FINDINGS 4.21)
 * --------------------------------------------------------------------
 * Handler: `sub_55A900` case 13 -> `sub_55BEB0` (.c:352538-352629). `sub_55A900` is the `CWvsApp`
 * layer for opcodes `0x0A`-`0x14` (`sub_43B170`), i.e. *not* the field dispatcher - so the same
 * byte value means something else in the other direction (client -> server `0x0D` is
 * `CField::SendInteract`, see `CLIENT_FIELD_OPCODE.interact`), exactly like `0x0B`/`0x0F`.
 *
 * The body, in the order `sub_55BEB0` reads it:
 *
 * ```
 * u8  ack          // != 0 -> CWvsApp+24 = 0, CWvsApp+28 = timeGetTime()   (see below)
 * <stat diff>      // sub_45E0D0: u32 flags, then one field per set bit
 * u32 panelFlags   // sub_4C5DC0: 0 = nothing more (it returns right away), see "the panel block"
 * ```
 *
 * `sub_45E0D0` tests the flag bits from `0x01` upwards, so the wire order of the diff is the flag
 * order, and a field is only present when its bit is set - "send what changed, nothing else".
 * Nineteen bits (up to `0x40000`) are read; `mapId` and `unknown101` are **not** in this packet
 * (they only ever travel inside `CharacterData`).
 *
 * ⚠️ **The diff widths are not the `CharacterData` widths.** All of the following were read off the
 * disassembly of `sub_45E0D0` (the Hex-Rays text hides two of them):
 *
 * | flag | field | diff wire | `CharacterData` wire | why |
 * |---|---|---|---|---|
 * | `0x04` | `unknown26` | **u32** | u8 | `sub_45DCC0` (4 bytes) then `mov [edi+1Ah], al` - 4 read, 1 kept |
 * | `0x40`-`0x200` | `str`/`dex`/`int`/`luk` | **u8** | u16 | `sub_45DC40` then `movzx bp, byte` |
 * | `0x20000` | `fame` | **u32** | u16 | `sub_45DDC0` (4) then `mov [edi+55h], ax` - 4 read, 2 kept |
 *
 * Those are the client's own quirks, not ours, and they matter: a `str` sent as a byte lands in the
 * low half of the obfuscated pair, so the client's stat becomes `value & 0xff`. `encodeStatUpdate`
 * therefore **refuses** a `str`/`dex`/`int`/`luk` above 255 instead of silently truncating it.
 *
 * WHAT THE CLIENT DOES WITH IT (`sub_55BEB0` after the decode)
 * --------------------------------------------------------------------
 * 1. `sub_463050` hands it the character record itself (`CWvsApp+36`), and `sub_45E0D0` writes the
 *    decoded fields into it - so this packet updates the very record the HUD reads.
 * 2. If the level did **not** change and `exp` grew, it prints "경험치가 상승했습니다 (+%d)"
 *    (`.c:352580`, the `%d` is `new - old`).
 * 3. If the level **did** grow, it plays `Effect/BasicEff.img/LevelUp` and prints
 *    "레벨이 올랐습니다 (+%d)" - i.e. the *server* decides the level-up, the client only celebrates.
 *    (The client also carries a self-level-up routine, `sub_4C71C0`, which subtracts
 *    `dword_5C2138[level]`, adds a level and - when the character is alive - refills HP/MP to their
 *    maxima. Nothing in this build calls it, and the level-up branch above is what the server
 *    drives; `game/exp.ts` is where that routine's table lives.)
 * 4. `sub_55AA80` refreshes the map/UI singletons, which is what redraws the bars.
 *
 * THE `ack` BYTE
 * --------------------------------------------------------------------
 * A non-zero `ack` clears the client's "a field request is pending" gate (`CWvsApp+24 = 0`) and
 * re-stamps the clock next to it. That is the same slot `CField::SendInteract` arms before it sends
 * (`n3000[6] = 1; n3000[7] = timeGetTime()`), and the same idiom as `0x0B`'s `result` and `0x11`.
 * Only zero vs non-zero is ever compared. A stat update answers nothing, so the server sends 0.
 *
 * THE PANEL BLOCK (`u32 panelFlags`, `sub_4C5DC0`)
 * --------------------------------------------------------------------
 * `sub_55BEB0` calls `sub_4C5DC0(CWvsApp+112, packet, ..., charRecord)` unconditionally, so the u32
 * is always on the wire - there is no "short packet" path, a missing one would throw 38 in the
 * client. **Read off the disassembly: `flags2 == 0` returns immediately** - nothing else is read,
 * and the caller then skips the buff block too (`if (result != 0) sub_4CBBD0(...)`, and with
 * `flags2 == 0` the return value is a constant 0). With `flags2 != 0` the packet continues with a
 * `u32` (written into the record copy's `id` field) and then one `u16` per bit of `0x01`-`0x800`
 * (twelve of them), each stored as two obfuscated pairs - the value, plus a stamp of
 * `a3 + panelFlags` that the caller supplies; the `0x800` bit also touches the client's global
 * damage RNG (`dword_5D2C20`, the same one `0x2C` bit 0 uses). `sub_4CBBD0` (a
 * `CTemporaryStatView`, i.e. a buff) then reads a `u8` and a `u32` per buff. None of those fields
 * is located yet, so this codec only ever writes `panelFlags = 0` and keeps it as a named field
 * rather than inventing a layout (FINDINGS 4.21.2).
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import type { CharacterStats } from "./chardata.ts";

/** The `CWvsApp` opcode of the stat diff (`sub_55A900` case 13). */
export const STAT_OPCODE = 0x0d;

/**
 * The fields that can travel in a diff: everything of `CharacterStats` except the five the reader
 * never touches (`id`, `name`, `gender`, `mapId`, `unknown101` - the last two only travel in
 * `CharacterData`). Deriving the union from `CharacterStats` keeps the two modules from drifting.
 */
export type StatDiffName = Exclude<keyof CharacterStats, "id" | "name" | "gender" | "mapId" | "unknown101">;

/** A diff: only the fields that changed. */
export type StatDiff = Partial<Record<StatDiffName, number>>;

interface StatDiffFieldSpec {
  readonly name: StatDiffName;
  /** Bytes this field occupies **in this packet** (the table in the header explains the quirks). */
  readonly bytes: 1 | 2 | 4;
  /** `0x8000` (`sp`) is read by the client's signed `s16` reader (`sub_45DD80`). */
  readonly signed?: boolean;
}

/**
 * The diff fields in the order `sub_45E0D0` reads them; field `i` is carried by flag bit `1 << i`,
 * because the reader walks the bits upwards and reads the matching field right there.
 */
export const STAT_DIFF_FIELDS: readonly StatDiffFieldSpec[] = [
  { name: "appearanceA", bytes: 4 },
  { name: "appearanceB", bytes: 4 },
  // 4 bytes on the wire, 1 byte kept in memory - the reader is `sub_45DCC0`.
  { name: "unknown26", bytes: 4 },
  { name: "hair", bytes: 4 },
  { name: "level", bytes: 1 },
  { name: "job", bytes: 2 },
  // The four base stats are ONE byte here, unlike in `CharacterData` (see the header table).
  { name: "str", bytes: 1 },
  { name: "dex", bytes: 1 },
  { name: "int", bytes: 1 },
  { name: "luk", bytes: 1 },
  { name: "hp", bytes: 2 },
  { name: "maxHp", bytes: 2 },
  { name: "mp", bytes: 2 },
  { name: "maxMp", bytes: 2 },
  { name: "ap", bytes: 2 },
  { name: "sp", bytes: 2, signed: true },
  { name: "exp", bytes: 4 },
  // 4 bytes on the wire, 2 kept in memory - the reader is `sub_45DDC0`, not `sub_45DD80`.
  { name: "fame", bytes: 4 },
  { name: "unknown93", bytes: 4 },
];

/** The flag bit of field `name` (`1 << index`). Throws for a name the client does not read. */
export function statDiffFlag(name: StatDiffName): number {
  const index = STAT_DIFF_FIELDS.findIndex((field) => field.name === name);
  if (index < 0) throw new RangeError(`"${name}" is not a field of the 0x0d stat diff`);
  return 1 << index;
}

/** The `u32` flags word of a diff - one bit per field that is present. */
export function statDiffFlags(diff: StatDiff): number {
  let flags = 0;
  for (const field of STAT_DIFF_FIELDS) {
    if (diff[field.name] !== undefined) flags = (flags | statDiffFlag(field.name)) >>> 0;
  }
  return flags;
}

/**
 * The whole `0x0D` body.
 *
 * `ack` is the leading byte (see the header): non-zero clears the client's pending-request gate.
 * Nothing this server sends is an answer to a client request, so it stays `false`; it is a field and
 * not a constant because that is what the client reads.
 */
export interface StatUpdate {
  ack?: boolean;
  diff: StatDiff;
}

/**
 * Pack one `0x0D`: `u8 ack`, the diff, then `panelFlags = 0`.
 *
 * Out-of-range values throw instead of being masked - most of these fields are `u8`/`u16` on the
 * wire while the record keeps them wider, and a silent truncation would be a stat that jumps for no
 * visible reason. `str`/`dex`/`int`/`luk` are the sharp edge: the client really does read one byte
 * there (`sub_45DC40`), so a larger value cannot be expressed at all.
 */
export function encodeStatUpdate(update: StatUpdate): Uint8Array {
  const { diff } = update;
  const writer = new PacketWriter(8 + STAT_DIFF_FIELDS.length * 4);
  writer.writeByte(STAT_OPCODE);
  writer.writeByte(update.ack === true ? 1 : 0);
  writer.writeU32(statDiffFlags(diff));
  for (const field of STAT_DIFF_FIELDS) {
    const value = diff[field.name];
    if (value === undefined) continue;
    assertFits(field, value);
    if (field.bytes === 1) writer.writeByte(value);
    else if (field.bytes === 2) writer.writeU16(value);
    else writer.writeU32(value);
  }
  // The panel/buff block's flags word. 0 is the "nothing here" the client returns on immediately.
  writer.writeU32(0);
  return writer.toBytes();
}

function assertFits(field: StatDiffFieldSpec, value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`stat diff field "${field.name}" is not an integer (${value})`);
  }
  if (field.signed === true) {
    const limit = field.bytes === 2 ? 0x7fff : 0x7f;
    if (value < -limit - 1 || value > limit) {
      throw new RangeError(`stat diff field "${field.name}" (s${field.bytes * 8}) cannot hold ${value}`);
    }
    return;
  }
  const limit = 2 ** (field.bytes * 8) - 1;
  if (value < 0 || value > limit) {
    throw new RangeError(
      `stat diff field "${field.name}" (u${field.bytes * 8}) cannot hold ${value}` +
        (field.bytes === 1 ? " - the 0x0d reader takes one byte for this field (FINDINGS 4.21.1)" : ""),
    );
  }
}

/** Read one `0x0D` body (the reader must sit at `ack`, i.e. just past the opcode byte). */
export function readStatUpdate(reader: PacketReader): StatUpdate {
  const ack = reader.readByte() !== 0;
  const flags = reader.readU32();
  const diff: StatDiff = {};
  for (const [index, field] of STAT_DIFF_FIELDS.entries()) {
    if ((flags & (1 << index)) === 0) continue;
    if (field.bytes === 1) diff[field.name] = reader.readByte();
    else if (field.bytes === 2) diff[field.name] = readSigned(reader, field);
    else diff[field.name] = reader.readU32();
  }
  const panelFlags = reader.readU32();
  if (panelFlags !== 0) {
    throw new RangeError(
      `0x0d panel flags 0x${panelFlags.toString(16)}: the panel/buff block is not decoded (FINDINGS 4.21.2)`,
    );
  }
  return { ack, diff };
}

/** One line for the `decode` tool: `ack=0 level=2 exp=5 (+4 fields)`. */
export function describeStatUpdate(update: StatUpdate): string {
  const parts = STAT_DIFF_FIELDS.filter((field) => update.diff[field.name] !== undefined).map(
    (field) => `${field.name}=${update.diff[field.name]}`,
  );
  return `ack=${update.ack === true ? 1 : 0} ${parts.length === 0 ? "(no fields)" : parts.join(" ")}`;
}

/** `sp` is the one signed field (`sub_45DD80`); everything else is unsigned in the client's reader. */
function readSigned(reader: PacketReader, field: StatDiffFieldSpec): number {
  const raw = reader.readU16();
  return field.signed === true ? ((raw << 16) >> 16) : raw;
}

/**
 * The diff between two records: every field of `STAT_DIFF_FIELDS` whose value differs.
 *
 * This is what makes the packet useful - the server holds the character record it sent in `0x16`
 * and, whenever it changes something (exp, HP, a level), asks this for the smallest packet that
 * describes the change.
 */
export function diffStats(before: CharacterStats, after: CharacterStats): StatDiff {
  const diff: StatDiff = {};
  for (const field of STAT_DIFF_FIELDS) {
    const next = after[field.name];
    if (next !== before[field.name]) diff[field.name] = next;
  }
  return diff;
}
