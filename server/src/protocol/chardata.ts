/**
 * `CharacterData` - the client's character record, as it appears on the wire.
 *
 * EVIDENCE (MapleStory.exe.c / .lst, see docs/protocol/FINDINGS.md 4.9)
 * --------------------------------------------------------------------
 * Reader: `sub_45FCC0` = `CharacterData::Decode` (called by the char-select `0x02` reply
 * `sub_4329A0`, by `CStage` `0x16` `sub_4C2780` and by `sub_54E250`).
 * Writer: `sub_45F610` = `CharacterData::Encode` (vtable-only; it calls `sub_45D2E0` for the stat
 * block and `sub_45E560` per item). The two mirror each other field for field, which is what makes
 * the block sizes below certain:
 *
 * ```
 * u8 flags
 * if (flags & 0x01) <stat block>
 * if (flags & 0x02) { worn equips, cash equips, equip tab, that tab's 8-byte records }
 * if (flags & 0x04) { inventory 2 }
 * if (flags & 0x08) { inventory 3 }
 * if (flags & 0x10) { inventory 4 }
 * if (flags & 0x20) { u16 count, count x {u32, u32} }
 * if (flags & 0x40) { u16 count, count x {string, string} }
 * ```
 *
 * Each inventory is `u8 capacity` (= the client's ZArray size - 1), then
 * `{ u8 slot, GW_ItemSlot }*` terminated by a `u8 0`, then `u8 n` + `n * 8 bytes`. The two worn
 * groups are 15-slot arrays indexed 1..14, so they start straight at the `{u8 slot, item}` loop -
 * there is no capacity byte for them. No inventory carries the item category byte: the client
 * passes the "I know the kind" hint (`1` for the two worn groups and the equip tab, `2/3/4` for the
 * other three) everywhere in this block (`sub_45F610` calls `sub_45E560(item, packet, 0)`), and
 * `0x0B` op 0 is the only place that does not.
 *
 * The stat block: `sub_45D840` (read) and `sub_45D2E0` (write) agree on 24 fields, 69 bytes total:
 *
 * ```
 * u32 id
 * 13 bytes name            // fixed width, NUL padded, NOT length-prefixed (sub_45DD00 memcpy)
 * u8  gender
 * u32 appearanceA          // @+18 in the client object
 * u32 appearanceB          // @+22
 * u8  unknown26            // @+26 - a genuine u8 between the second appearance word and hair
 * u32 hair                 // @+27
 * u8  level                // @+31/+32; level..mesos are XOR-obfuscated in CLIENT MEMORY only
 * u16 job, str, dex, int, luk, hp, maxHp, mp, maxMp, ap, sp     // 11 u16
 * u32 exp                  // @+77/+81 - the 0x0D handler calls this pair "exp" (level-up message)
 * u16 fame                 // @+85/+87
 * u32 mesos                // @+89/+93 (its identity is evidence: FINDINGS 4.22)
 * u32 mapId                // @+97, not obfuscated - the map to load (see below)
 * u8  unknown101           // @+101, not obfuscated
 * ```
 *
 * The memory struct is 102 bytes (`sub_55BEB0` copies 100 bytes + a word; `sub_45F5C0` memcpy's 102
 * of them verbatim for party members) while the *wire* block is 69: the difference is the pad half
 * of every obfuscated pair, plus the alignment tails. Writing 102 (or the 75 the first pass
 * guessed) desynchronises everything that follows.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import { ITEM_CATEGORY_EQUIP, readItemSlot, writeItemSlot, type ItemSlot } from "./itemslot.ts";

/** Fixed width of the character name field on the wire (12 visible bytes + NUL). */
export const CHARACTER_NAME_BYTES = 13;
export const CHARACTER_NAME_MAX = 12;

/** Bytes a stat block occupies on the wire; `sub_45D840` and `sub_45D2E0` both come to 69. */
export const CHARACTER_STATS_BYTES = 69;

/** Slots the two worn item groups can hold: the client loops `1..14`, index 0 is unused. */
export const WORN_SLOT_LIMIT = 14;

/** `u8 flags` bits of `sub_45FCC0` / `sub_45F610`. */
export const CHAR_FLAG_STATS = 0x01;
/** Worn equips + worn cash equips + the equip tab (+ that tab's 8-byte records). */
export const CHAR_FLAG_ITEMS = 0x02;
export const CHAR_FLAG_INVENTORY_2 = 0x04;
export const CHAR_FLAG_INVENTORY_3 = 0x08;
export const CHAR_FLAG_INVENTORY_4 = 0x10;
/** `u16 count` + `count * {u32, u32}` (the client keeps them in a `ZMap<long,long>`, `0x0E`). */
export const CHAR_FLAG_MAP32 = 0x20;
/** `u16 count` + `count * {string, string}` (`ZMap<ZXString,ZXString>`). */
export const CHAR_FLAG_MAPSTR = 0x40;

export interface CharacterStats {
  /** u32 @+0; the client keys the character slot by this (`sub_432890` matches it). */
  id: number;
  /** 13 raw bytes @+4, NUL padded, not length-prefixed. */
  name: string;
  /** u8 @+17. */
  gender: number;
  /** u32 @+18. Cosmetic ids from `Character.wz`, fed to `sub_424590`. */
  appearanceA: number;
  /** u32 @+22; `sub_42E2C0` copies it into avatar body-part slot 0. */
  appearanceB: number;
  /** u8 @+26; role unlocated. Must still be present - the client throws on underflow. */
  unknown26: number;
  /** u32 @+27. */
  hair: number;
  /** u8 @+31. Level-up detection in the `0x0D` handler reads the pair at +31/+32. */
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
  /** u32 @+77/+81. */
  exp: number;
  /** u16 @+85/+87. */
  fame: number;
  /** u32 @+89/+93. */
  /**
   * u32 @+89/+93 - the character's **mesos**.
   *
   * Read as `+89 ^ +93` by the client's shop (the total is compared against a row's price before a
   * purchase, `sub_4B6B40`) and by the meso-drop dialog (`sub_4B6E90`'s "얼마를 버리시겠습니까?", capped
   * at 50000), and carried by `0x0D`'s flag `0x40000` (FINDINGS 4.22).
   */
  mesos: number;
  /**
   * u32 @+97; stored plainly (no obfuscation), like the byte below.
   *
   * This is the character's **map**: `sub_4C2780` (the 0x16 handler) copies it out of the
   * `CharacterData` it just decoded and hands `{mapId, mode}` to the new field object
   * (`sub_4C3460` -> vtable slot 1 -> `sub_468E00`), which stores it at `CField+152` and loads
   * `Map/Map/%09d.img` with it (`sub_4694F0`). The server therefore decides which map a client
   * enters purely by putting the right id in this field - `0x16` carries the whole block.
   */
  mapId: number;
  /** u8 @+101; stored plainly. */
  unknown101: number;
}

/** One 8-byte record the client keeps per inventory (`this + 4 * inv + 102`). */
export interface InventoryRecord {
  key: number;
  value: number;
}

/** One of the four non-worn inventories, or the equip tab (`CharacterData.inventories[0]`). */
export interface Inventory {
  /**
   * `u8`: the number of usable slots, wire-visible because it *is* the client's array size - 1.
   * The client resizes to `capacity + 1` before filling (`sub_4605A0`), so 0 is legal and means
   * "no slots yet"; the field can be raised later by the `0x0C` packet (`sub_55BDC0`).
   */
  capacity: number;
  /** Slot number (1-based, must be <= capacity) to item. */
  items: Map<number, ItemSlot>;
  /** 8-byte records that follow the items; no client reader located, must still round-trip. */
  records: InventoryRecord[];
}

export interface CharacterItems {
  /** Slots 1..14 of the worn equipment (the client array at +134, `sub_45F610`). */
  worn: Map<number, ItemSlot>;
  /** Slots 1..14 of the worn cash equipment (client array at +254). */
  wornCash: Map<number, ItemSlot>;
  /** [equip tab (category 1 items), consume, install, etc] - client arrays at +366/+370/+374/+378. */
  inventories: [Inventory, Inventory, Inventory, Inventory];
  /** The `flags & 0x20` map: `u16 count` + `{u32, u32}` each. */
  map32: InventoryRecord[];
  /** The `flags & 0x40` map: `u16 count` + `{string, string}` each. */
  mapString: Array<{ key: string; value: string }>;
}

/** A character as it travels in the character-select / world-select / stage packets. */
export interface CharacterData {
  stats: CharacterStats;
  /** Omitted means "empty": a flags bit that announces an absent block writes that block empty. */
  items?: CharacterItems;
  /**
   * Which optional blocks to write. The client only consumes what the flags announce; the low two
   * bits are the ones a login server needs (`stats` even for a bare character list, `items` for a
   * character that should look dressed).
   */
  flags: number;
}

/** Empty item block: legal, and what a server sends before it has an item model. */
export function emptyCharacterItems(): CharacterItems {
  const empty = (): Inventory => ({ capacity: 0, items: new Map(), records: [] });
  return { worn: new Map(), wornCash: new Map(), inventories: [empty(), empty(), empty(), empty()], map32: [], mapString: [] };
}

/**
 * Slots a freshly created character's four tabs start with.
 *
 * A *server* number, like the drop odds: the `u8 capacity` in `CharacterData` is the client's array
 * size minus one (`sub_4605A0` resizes to capacity + 1), so a tab that is never announced has *no*
 * slots at all and nothing can ever be put in it. 24 is what every MapleStory generation handed a
 * new character; a shop or a quest would raise it with the `0x0C` packet (`sub_55BDC0`), which this
 * server does not send yet.
 */
export const START_INVENTORY_SLOTS = 24;

/** The item block of a new character: four announced tabs of `START_INVENTORY_SLOTS`, all empty. */
export function startingCharacterItems(slots = START_INVENTORY_SLOTS): CharacterItems {
  const empty = (): Inventory => ({ capacity: slots, items: new Map(), records: [] });
  return { worn: new Map(), wornCash: new Map(), inventories: [empty(), empty(), empty(), empty()], map32: [], mapString: [] };
}

/** Pads/validates the 13-byte name field. Names are byte strings in this client (`sub_45DD00`). */
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
  writer.writeU32(s.mesos);
  writer.writeU32(s.mapId);
  writer.writeByte(s.unknown101);
}

/**
 * Appends one inventory: `u8 capacity`, `{u8 slot, item}` per filled slot, `u8 0`, then the
 * 8-byte records. `typeHint` is the client's kind hint (`1` for the equip tab, `2..4` otherwise).
 */
function writeInventory(writer: PacketWriter, inventory: Inventory, typeHint: number): void {
  const slots = [...inventory.items.keys()].sort((a, b) => a - b);
  const highest = slots.length === 0 ? 0 : slots[slots.length - 1]!;
  // The capacity byte *is* the client's array size - 1: the client resizes to capacity + 1 and then
  // writes items by slot index, so an item above the capacity has to be a caller error, not a
  // silent resize. `capacity` 0 means "not stated", and is derived from the items.
  const capacity = inventory.capacity > 0 ? inventory.capacity : highest;
  writer.writeByte(capacity);
  for (const slot of slots) {
    if (slot < 1 || slot > 0xff) throw new RangeError(`slot ${slot} does not fit the wire's u8 slot number`);
    if (slot > capacity) {
      throw new RangeError(`slot ${slot} is above the declared inventory capacity ${capacity}`);
    }
    writer.writeByte(slot);
    writeItemSlot(writer, inventory.items.get(slot)!, typeHint);
  }
  writer.writeByte(0);
  if (inventory.records.length > 0xff) throw new RangeError(`${inventory.records.length} records cannot fit a u8 count`);
  writer.writeByte(inventory.records.length);
  for (const record of inventory.records) writer.writeU32(record.key).writeU32(record.value);
}

/** Appends one worn group: `{u8 slot, item}` for slots 1..14, then a `u8 0` terminator. */
function writeWorn(writer: PacketWriter, worn: Map<number, ItemSlot>): void {
  const slots = [...worn.keys()].sort((a, b) => a - b);
  for (const slot of slots) {
    if (slot < 1 || slot > WORN_SLOT_LIMIT) {
      throw new RangeError(`worn slot ${slot} is outside the client's 1..${WORN_SLOT_LIMIT} loop (sub_45F610)`);
    }
    writer.writeByte(slot);
    // The worn groups are always equips, so the client passes "1" as the kind hint (sub_45E6A0).
    writeItemSlot(writer, worn.get(slot)!, ITEM_CATEGORY_EQUIP);
  }
  writer.writeByte(0);
}

/** Appends `u8 flags` followed by whichever blocks the flags announce. */
export function writeCharacterData(writer: PacketWriter, data: CharacterData): void {
  const allowed =
    CHAR_FLAG_STATS | CHAR_FLAG_ITEMS | CHAR_FLAG_INVENTORY_2 | CHAR_FLAG_INVENTORY_3 | CHAR_FLAG_INVENTORY_4;
  if ((data.flags & ~(allowed | CHAR_FLAG_MAP32 | CHAR_FLAG_MAPSTR)) !== 0) {
    throw new RangeError(`CharacterData flags 0x${data.flags.toString(16)}: the client reads at most 0x7f`);
  }
  const flags = data.flags;
  const items = data.items ?? emptyCharacterItems();
  writer.writeByte(flags);
  if (flags & CHAR_FLAG_STATS) writeCharacterStats(writer, data.stats);
  if (flags & CHAR_FLAG_ITEMS) {
    writeWorn(writer, items.worn);
    writeWorn(writer, items.wornCash);
    writeInventory(writer, items.inventories[0], 1);
  }
  const tabFlags = [CHAR_FLAG_INVENTORY_2, CHAR_FLAG_INVENTORY_3, CHAR_FLAG_INVENTORY_4];
  for (let i = 0; i < tabFlags.length; i++) {
    if (flags & tabFlags[i]!) writeInventory(writer, items.inventories[i + 1]!, i + 2);
  }
  if (flags & CHAR_FLAG_MAP32) {
    writer.writeU16(items.map32.length);
    for (const record of items.map32) writer.writeU32(record.key).writeU32(record.value);
  }
  if (flags & CHAR_FLAG_MAPSTR) {
    writer.writeU16(items.mapString.length);
    for (const entry of items.mapString) writer.writeAsciiString(entry.key).writeAsciiString(entry.value);
  }
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
  const mesos = reader.readU32();
  const mapId = reader.readU32();
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
    mesos,
    mapId,
    unknown101,
  };
}

function readInventory(reader: PacketReader, typeHint: number): Inventory {
  const capacity = reader.readByte();
  const items = new Map<number, ItemSlot>();
  for (;;) {
    const slot = reader.readByte();
    if (slot === 0) break;
    items.set(slot, readItemSlot(reader, typeHint));
  }
  const recordCount = reader.readByte();
  const records: InventoryRecord[] = [];
  for (let i = 0; i < recordCount; i++) records.push({ key: reader.readU32(), value: reader.readU32() });
  return { capacity, items, records };
}

function readWorn(reader: PacketReader): Map<number, ItemSlot> {
  const worn = new Map<number, ItemSlot>();
  for (;;) {
    const slot = reader.readByte();
    if (slot === 0) break;
    worn.set(slot, readItemSlot(reader, 1));
  }
  return worn;
}

/** Reads one `CharacterData`. A flags byte without `0x01` reads as a zeroed stat block. */
export function readCharacterData(reader: PacketReader): CharacterData {
  const flags = reader.readByte();
  if (flags & ~0x7f) throw new RangeError(`CharacterData flags 0x${flags.toString(16)} is not a known flag mask`);
  const stats = flags & CHAR_FLAG_STATS ? readCharacterStats(reader) : zeroStats();
  const items = emptyCharacterItems();
  if (flags & CHAR_FLAG_ITEMS) {
    items.worn = readWorn(reader);
    items.wornCash = readWorn(reader);
    items.inventories[0] = readInventory(reader, 1);
  }
  const tabFlags = [CHAR_FLAG_INVENTORY_2, CHAR_FLAG_INVENTORY_3, CHAR_FLAG_INVENTORY_4];
  for (let i = 0; i < tabFlags.length; i++) {
    if (flags & tabFlags[i]!) items.inventories[i + 1] = readInventory(reader, i + 2);
  }
  if (flags & CHAR_FLAG_MAP32) {
    const count = reader.readU16();
    for (let i = 0; i < count; i++) items.map32.push({ key: reader.readU32(), value: reader.readU32() });
  }
  if (flags & CHAR_FLAG_MAPSTR) {
    const count = reader.readU16();
    for (let i = 0; i < count; i++) items.mapString.push({ key: reader.readAsciiString(), value: reader.readAsciiString() });
  }
  return { stats, items, flags };
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
    mesos: 0,
    mapId: 0,
    unknown101: 0,
  };
}

/**
 * Wraps a stat block in a `CharacterData` that advertises exactly the blocks it contains.
 * With no `items` the record is a flags byte plus the 69-byte stat block, which is what a bare
 * character list needs; give it items (at least the worn equips) and the client can draw the
 * character dressed instead of naked.
 */
export function characterDataOf(
  stats: Partial<CharacterStats> & { id: number; name: string },
  items?: CharacterItems,
): CharacterData {
  const block = items ?? emptyCharacterItems();
  // A tab is worth announcing when it holds something *or* when it has slots: the capacity byte is
  // what makes the client allocate the array at all (`sub_4605A0` resizes to capacity + 1), so a
  // character with 24 empty slots still needs its flag, or nothing could ever be put in it.
  const tells = (inventory: Inventory): boolean => inventory.items.size > 0 || inventory.records.length > 0 || inventory.capacity > 0;
  const hasItems =
    block.worn.size + block.wornCash.size > 0 ||
    block.inventories.some(tells) ||
    block.map32.length > 0 ||
    block.mapString.length > 0;
  let flags = CHAR_FLAG_STATS;
  if (hasItems) {
    // `CHAR_FLAG_ITEMS` announces the two worn groups *and* the equip tab, so anything in any of
    // them has to raise it - otherwise the client would never be told about the item at all.
    const equip = block.inventories[0];
    if (block.worn.size + block.wornCash.size > 0 || (equip !== undefined && tells(equip))) flags |= CHAR_FLAG_ITEMS;
    for (let i = 1; i < block.inventories.length; i++) {
      const inventory = block.inventories[i]!;
      if (tells(inventory)) {
        flags |= [CHAR_FLAG_INVENTORY_2, CHAR_FLAG_INVENTORY_3, CHAR_FLAG_INVENTORY_4][i - 1]!;
      }
    }
    if (block.map32.length > 0) flags |= CHAR_FLAG_MAP32;
    if (block.mapString.length > 0) flags |= CHAR_FLAG_MAPSTR;
  }
  return { stats: { ...zeroStats(), ...stats }, items: block, flags };
}
