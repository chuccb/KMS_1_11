/**
 * The reward pool: the three packets that make a drop exist, disappear, and be reported.
 *
 * This is the `CRewardPool` half of the field (opcodes `0x42`..`0x45`) plus the one CWvsApp-level
 * notice that tells a player what they just picked up (`0x11`). Both were located in this repo's
 * reverse-engineering pass - FINDINGS 4.18 - and both are **server -> client only**: a v1.11 client
 * has no drop request and no pickup request at all, so who gets what is entirely the server's
 * decision (see `game/drops.ts`).
 *
 * EVIDENCE (MapleStory.exe.c)
 * ---------------------------
 * `sub_472770` (121118-121200), the field dispatcher's opcode ranges:
 *
 *   `0x42`..`0x45` -> `sub_4A8870(this_4, opcode, packet)`, the CRewardPool object
 *   (`this_4 = &dword_5C204C`, the global whose ctor is `sub_4A73A0`)
 *
 * `sub_4A8870` (177828-177845) has exactly two branches:
 *
 *   `if (opcode == 67)` -> `sub_4A88A0`   a drop appears      (`0x43`)
 *   `else if (opcode == 68)` -> `sub_4A95B0`  a drop goes away (`0x44`)
 *   the return value is `opcode - 68`, i.e. `0x42` and `0x45` fall through with no handler at all.
 *
 * 0x43 = `sub_4A88A0` (177841-178372). Field for field, with the client's own reader calls:
 *
 *   u8  kind      `sub_45DC40`
 *   u32 dropId    `sub_45DCC0` - the ZMap key (`*(entry+8)`, hashed as `__ROR4__(key,5) % this[3]`)
 *   u8  money     `sub_45DC40` - a *branch*, not a flag: `if (v92[3] != 0) sub_4A9C40(...) else
 *                 sub_479B10(...)`. When it is zero the next u32 goes to `sub_479B10(id, 0)`, which
 *                 resolves `Item/<category>/<id>.img/<id>/info/iconRaw` (`sub_47CE40` reads `info`,
 *                 then the `icon`/`iconRaw` pair) - i.e. `value` is an **item id**.
 *                 When it is non-zero the next u32 goes to `sub_4A9C40(this, out, amount, 0)`, which
 *                 builds the sprite name as `%08d` of `9000000 + sub_4A9C10(amount)` and looks it up
 *                 in `Item/Special/0900.img` (the four money piles `09000000`..`09000003`) - i.e.
 *                 `value` is **mesos**, and how big the pile looks is decided by the amount:
 *                 `sub_4A9C10(a) = a < 50 ? 0 : (a < 100 ? 1 : (a < 1000 ? 2 : 3))`.
 *   u32 value     item id or meso amount (see above)
 *   s16 x, s16 y  where the drop *lands* (`sub_45DC80` twice). Both are stored at `v92[9]`/`v92[10]`
 *                 ("target") and, unmodified, at `v92[7]`/`v92[8]` ("current"). A `-= 16` is applied
 *                 to the two *y*s right before the sprite is built, so the packet's y is the ground
 *                 line and the client draws the icon 16 px above it.
 *   --- only while `kind <= 1`:
 *   u32 mobId     the monster it came out of. `sub_492C00(CMobPool + 1, &mobId, &ref)` looks it up,
 *                 and when it is still in the pool the drop's *current* position is overwritten from
 *                 `mob+360`/`mob+364` - that is what makes the item fly out of the monster.
 *   s16 x, s16 y  the fallback for that current position when the lookup misses (a miss is handled).
 *   s16 unknown   read unconditionally (`sub_45DC80`, `.lst` 004A8C4A) and then only ever used in a
 *                 pointer sum (`v92[11] = ptr + that`, 178350): nothing in the draw path reads it as
 *                 a coordinate, so this server writes 0.
 *
 * The entry the client builds is 88 bytes (`sub_4ABB80`: 1476-byte chunks, 15 entries each) with
 * `+4 = kind`, `+5 = (kind == 1 || kind == 2)`, `+8 = dropId`, `+12 = money`, `+16 = value`.
 *
 * 0x44 = `sub_4A95B0` (178480-178748):
 *
 *   u8  kind      `sub_45DC40`
 *   u32 dropId    `sub_45DCC0` - ZMap lookup; a miss ends the handler (no throw, no packet back)
 *   --- only while `kind == 2`:
 *   u32 characterId  `*(entry + 60) = characterId`
 *
 *   Then the entry is removed (`sub_4A8620`), and the three kinds do different things with it:
 *   `0` tears the sprite down in place (`v47+20`, `v47+24`), `1` does nothing more, and `2` plays the
 *   pickup: `if (*(entry+60) == n3000[5]) sub_5271F0("PickUpItem", 100)` - the sound only on the
 *   picker's own client - and `sub_41BAC0(characterPool, characterId, entry.x, entry.y)` starts the
 *   animation that flies the icon to that character.
 *
 * 0x11 = `sub_55C130` (352678-352760), reached through the *top-level* router, not CField:
 * `if (opcode < 0x0A || opcode > 0x14) ... else sub_55A900(n3000, opcode, packet)` (66990), and
 * `sub_55A900` (351269) switches `11..19` -> `0x0B`..`0x13`, `case 17` -> `sub_55C130`:
 *
 *   u8  kind      1 = mesos, 0 = an item, anything else = "no more items"
 *   kind == 1:  u32 amount   -> chat "메소를 얻었습니다 (+%d)"   ("You got mesos (+%d)")
 *   kind == 0:  u32 itemId, u32 count
 *               with a count of 2 or more -> "아이템을 얻었습니다 (%s %d개)" ("You got <item> x<count>")
 *               a count of 1 -> "아이템을 얻었습니다 (%s)"
 *               `%s` is `sub_479D30(itemId)` - the item's `info/name` from `Item/*.img`. An item id
 *               that has no name (the client can resolve nothing) prints **nothing at all**: the
 *               message is built only `if (name != nullptr && *name != 0)`.
 *   otherwise:  no fields at all -> "아이템을 더 이상 가질 수 없습니다"
 *
 * The client's own counters are *not* touched by any of this: 0x11 is a chat line, and the meso
 * total shown in the status bar is updated by a packet that is not located yet (the `0x0D` stat
 * update - see FINDINGS 4.18's closing note and 6). So the server keeps its own wallet
 * (`game/rewards.ts`) and the player reads the gain from the notice until that packet is decoded.
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** The `CRewardPool` opcodes with a located handler (`sub_4A8870`); `0x42`/`0x45` have none. */
export const DROP_OPCODE = {
  /** `0x43`: a drop appears (the record is created, or refreshed for a known `dropId`). */
  appear: 0x43,
  /** `0x44`: a drop goes away - expired, removed, or taken by a character. */
  remove: 0x44,
} as const;

/**
 * The leading byte of `0x43`.
 *
 * The only thing the client's branches say about it: `kind <= 1` adds the `mobId` + fallback
 * position + unknown block, and a new record's `+5` byte is set to `kind == 1 || kind == 2`. Nothing
 * in the client names the three cases, and this server only sends what it can justify:
 * `fromMob` for a monster's loot.
 */
export const DROP_KIND = {
  /** A drop that came out of a monster (the extra block is read). */
  fromMob: 0,
  /** Same shape as `fromMob`, different `+5` byte. Role not located. */
  fromMobAlt: 1,
  /** No extra block at all: the drop is simply placed. Role of the `+5` byte / `+3` state open. */
  placed: 2,
} as const;

/** The leading byte of `0x44`, i.e. what the client does with the removed entry. */
export const DROP_REMOVE_KIND = {
  /** The sprite is torn down in place (what an expiring drop wants). */
  gone: 0,
  /** Silently removed; the client does nothing beyond dropping the record. */
  vanished: 1,
  /** A character took it: the packet carries their id, their client plays "PickUpItem", and every
   * client animates the icon flying to them. */
  taken: 2,
} as const;

/** The CWvsApp opcode of the loot notice (`sub_55A900` case 17 -> `sub_55C130`). */
export const LOOT_OPCODE = 0x11;

/** One `0x43` (drop appears) packet. */
export interface DropAppear {
  /** ZMap key inside the field; unique per field, chosen by the server. */
  dropId: number;
  /** `DROP_KIND`; `fromMob`/`fromMobAlt` carry the monster block below. */
  kind: number;
  /** `true` = `value` is mesos, `false` = an item id. The client's `v92[3]`. */
  money: boolean;
  /** Item id, or the meso amount when `money`. */
  value: number;
  /** Where the drop lands (the client draws the icon 16 px above this y). */
  x: number;
  y: number;
  /** The monster it came out of (`kind <= 1`): the drop's *current* position, when it is found. */
  mobId?: number;
  /** The fallback current x when that monster is no longer in the pool. */
  mobX?: number;
  /** The fallback current y when that monster is no longer in the pool. */
  mobY?: number;
  /** The block's trailing `s16`: read by the client, never used as a value. Send 0. */
  unknown?: number;
}

/** One `0x44` (drop removed) packet. */
export interface DropRemove {
  /** ZMap key; an unknown id is a no-op on the client. */
  dropId: number;
  /** `DROP_REMOVE_KIND`. */
  kind: number;
  /** Only present for `taken`, and mandatory then. */
  characterId?: number;
}

/** The three shapes of a `0x11` loot notice (`sub_55C130`). */
export type LootNotice =
  | { kind: "mesos"; amount: number }
  | { kind: "item"; itemId: number; count: number }
  | { kind: "rejected" };

function writeSigned16(writer: PacketWriter, value: number): void {
  writer.writeU16(value & 0xffff);
}

function readSigned16(reader: PacketReader): number {
  return (reader.readU16() << 16) >> 16;
}

/** Encode one `0x43`, opcode byte included. */
export function encodeDropAppear(drop: DropAppear): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(DROP_OPCODE.appear);
  writer.writeByte(drop.kind & 0xff);
  writer.writeU32(drop.dropId >>> 0);
  writer.writeByte(drop.money ? 1 : 0);
  writer.writeU32(drop.value >>> 0);
  writeSigned16(writer, drop.x);
  writeSigned16(writer, drop.y);
  if (drop.kind <= DROP_KIND.fromMobAlt) {
    // The client reads all four fields without looking at the packet length, so the block is always
    // written in full - a short block would throw on the client (ZException 38) and desynchronise
    // the field.
    writer.writeU32((drop.mobId ?? 0) >>> 0);
    writeSigned16(writer, drop.mobX ?? drop.x);
    writeSigned16(writer, drop.mobY ?? drop.y);
    writeSigned16(writer, drop.unknown ?? 0);
  }
  return writer.toBytes();
}

/** Read one `0x43` body (no opcode byte; the reader must sit at `kind`). */
export function readDropAppear(reader: PacketReader): DropAppear {
  const kind = reader.readByte();
  const dropId = reader.readU32();
  const money = reader.readByte() !== 0;
  const value = reader.readU32();
  const x = readSigned16(reader);
  const y = readSigned16(reader);
  const drop: DropAppear = { dropId, kind, money, value, x, y };
  if (kind <= DROP_KIND.fromMobAlt) {
    drop.mobId = reader.readU32();
    drop.mobX = readSigned16(reader);
    drop.mobY = readSigned16(reader);
    drop.unknown = readSigned16(reader);
  }
  return drop;
}

/** One line describing a `0x43`, for logs and `decode`. */
export function describeDropAppear(drop: DropAppear): string {
  const what = drop.money ? `${drop.value} mesos` : `item ${drop.value}`;
  const at = `at (${drop.x},${drop.y})`;
  const from = drop.mobId === undefined ? "" : ` from mob ${drop.mobId}`;
  return `dropId=${drop.dropId} kind=${drop.kind} ${what} ${at}${from}`;
}

/** Encode one `0x44`, opcode byte included. */
export function encodeDropRemove(drop: DropRemove): Uint8Array {
  const writer = new PacketWriter(12);
  writer.writeByte(DROP_OPCODE.remove);
  writer.writeByte(drop.kind & 0xff);
  writer.writeU32(drop.dropId >>> 0);
  if (drop.kind === DROP_REMOVE_KIND.taken) writer.writeU32((drop.characterId ?? 0) >>> 0);
  return writer.toBytes();
}

/** Read one `0x44` body (no opcode byte; the reader must sit at `kind`). */
export function readDropRemove(reader: PacketReader): DropRemove {
  const kind = reader.readByte();
  const dropId = reader.readU32();
  const drop: DropRemove = { dropId, kind };
  if (kind === DROP_REMOVE_KIND.taken) drop.characterId = reader.readU32();
  return drop;
}

/** One line describing a `0x44`, for logs and `decode`. */
export function describeDropRemove(drop: DropRemove): string {
  const named = drop.kind === 0 ? "gone" : drop.kind === 1 ? "vanished" : drop.kind === 2 ? "taken" : `kind ${drop.kind}`;
  const by = drop.characterId === undefined ? "" : ` by character 0x${drop.characterId.toString(16)}`;
  return `dropId=${drop.dropId} ${named}${by}`;
}

/** Encode one `0x11` loot notice, opcode byte included. */
export function encodeLootNotice(notice: LootNotice): Uint8Array {
  const writer = new PacketWriter(12);
  writer.writeByte(LOOT_OPCODE);
  if (notice.kind === "mesos") {
    writer.writeByte(1);
    writer.writeU32(notice.amount >>> 0);
  } else if (notice.kind === "item") {
    writer.writeByte(0);
    writer.writeU32(notice.itemId >>> 0);
    writer.writeU32(notice.count >>> 0);
  } else {
    // Every other byte value takes the client's third branch, which reads no fields at all.
    writer.writeByte(2);
  }
  return writer.toBytes();
}

/** Read one `0x11` body (no opcode byte; the reader must sit at `kind`). */
export function readLootNotice(reader: PacketReader): LootNotice {
  const kind = reader.readByte();
  if (kind === 1) return { kind: "mesos", amount: reader.readU32() };
  if (kind === 0) return { kind: "item", itemId: reader.readU32(), count: reader.readU32() };
  return { kind: "rejected" };
}

/** One line describing a `0x11`, for logs and `decode`. */
export function describeLootNotice(notice: LootNotice): string {
  if (notice.kind === "mesos") return `loot notice: +${notice.amount} mesos`;
  if (notice.kind === "item") return `loot notice: item ${notice.itemId} x${notice.count}`;
  return "loot notice: nothing can be taken (the client prints its own line)";
}
