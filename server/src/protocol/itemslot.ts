/**
 * `GW_ItemSlot` - one item, as it travels on the wire.
 *
 * This is the missing half of `CharacterData` (`chardata.ts`, flags `0x02`) and of the inventory
 * opcode `0x0B` (docs/protocol/FINDINGS.md 4.6). Both directions are implemented from the client's
 * own code:
 *
 *   create + decode   `sub_45E6A0` (reads the type byte when the caller passes 0, then
 *                     `GW_ItemSlotEquip::Decode` = `sub_45ED50` / `GW_ItemSlotNonEquip::Decode` =
 *                     `sub_45F1B0`; both call the shared base decoder `sub_45E9F0`)
 *   encode            `sub_45E560` (writes the category byte when arg != 0, then vtable slot 2 =
 *                     `sub_45EB50` / `sub_45F130`, which call the base encoder `sub_45E860`)
 *
 * ## Base (both kinds) - `sub_45E9F0` (read) / `sub_45E860` (write)
 *
 * ```
 * u32 itemId
 * u8  hasCashBlock            // the encoder derives it: `*(u64 *)(obj + 0x10) != 0`
 * if (hasCashBlock) {
 *     u64 cashSn              // @+0x10 in the client object
 *     u16 unknown18           // @+0x18
 *     u64 unknown1A           // @+0x1A
 * }
 * ```
 *
 * The flag is *derived* on the write side, never stored, so a reader must not keep it: decode the
 * three fields, encode them back and the flag comes out the same (`hasCashBlock` === sn != 0).
 *
 * ## `GW_ItemSlotEquip` - `sub_45ED50` (read) / `sub_45EB50` (write)
 *
 * ```
 * <base>
 * u8  ruc                     // 남은 업그레이드 횟수 - the tooltip prints it (`sub_5014C0`: "업그레이드
 *                             // 가능 횟수 : %d") and `sub_47A740` fills it from `info` of the WZ entry
 * u8  cuc                     // 업그레이드에 사용된 횟수 - printed as "(+%d)" after the item name
 * u16 str, dex, int, luk      // 15 u16 in this exact order - `sub_5014C0` prints one tooltip line per
 * u16 maxHp, maxMp            // field in the same order: STR, DEX, INT, LUK, HP, MP, 공격력(PAD),
 * u16 pad, mad                // 마력(MAD), 물리방어력(PDD), 마법방어력(MDD), 명중률(ACC),
 * u16 pdd, mdd                // 회피율(EVA), 손재주(CRAFT), 이동속도(SPEED), 점프력(JUMP), and
 * u16 acc, eva                // `sub_47A740` copies WZ `info` +46..+74 into them in that order
 * u16 craft, speed, jump
 * ```
 *
 * ## `GW_ItemSlotNonEquip` - `sub_45F1B0` (read) / `sub_45F130` (write)
 *
 * ```
 * <base>
 * u16 quantity
 * ```
 *
 * ## Type byte
 *
 * The byte only goes on the wire where the caller passes 0 as the kind (`sub_45E560` /
 * `sub_45E6A0`). No packet this server sends does that: `CharacterData`'s writer (`sub_45FCC0`)
 * passes the *inventory tab* for each of the four tabs and `1` for the two worn groups, and `0x0B`
 * op 0 (`sub_55BAB0`) passes the tab it just read. So the kind is always out of band - tab 1 = equip,
 * 2/3/4 = non-equip - and the reader's `typeHint` is that number. The byte's value, for the one
 * caller that does let the stream decide it (`sub_4D3950`, a subsystem this server does not send
 * yet), is the item category `itemId / 1000000` (1 = equip, 2 = consume, 3 = install, 4 = etc,
 * 5 = cash): `sub_45E560` writes exactly that and `sub_45E6A0` compares it against 1 to pick the
 * class. `ITEM_TYPE_FROM_STREAM` (0) keeps that mode reachable for a tool that decodes such a trace.
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** `itemId / 1000000` for equips; the byte `sub_45E560` puts on the wire and `sub_45E6A0` tests. */
export const ITEM_CATEGORY_EQUIP = 1;

/** Sentinel for "the caller does not know the kind": read (or write) the category byte. */
export const ITEM_TYPE_FROM_STREAM = 0;

/** Categories the client names, `itemId / 1000000`. */
export const ITEM_CATEGORY = {
  equip: 1,
  consume: 2,
  install: 3,
  etc: 4,
  cash: 5,
} as const;

/**
 * The optional 23-byte block the client keeps at +0x10..+0x21 and only reads in one place:
 * `sub_463BE0` refuses to drop an item whose first 8 bytes are non-zero, right next to the
 * `sub_47A420` "is a WZ `cash` item" test - so this is the cash/period-item trio. The two tails
 * have no located reader; they keep structural names.
 */
export interface ItemSlotCashBlock {
  /** u64 @+0x10. Non-zero means "this item cannot be dropped" (`sub_463BE0`). */
  sn: bigint;
  /** u16 @+0x18, semantics unlocated. */
  unknown18: number;
  /** u64 @+0x1A, semantics unlocated. */
  unknown1A: bigint;
}

export interface ItemSlotBaseFields {
  itemId: number;
  /** Null when the flag byte is 0 - the common case, and what the client itself builds from WZ. */
  cash: ItemSlotCashBlock | null;
}

export interface ItemSlotEquip extends ItemSlotBaseFields {
  kind: "equip";
  /** `u8`: upgrade slots still available (WZ `info` +44 for a fresh item). */
  ruc: number;
  /** `u8`: upgrades already applied; a fresh item is 0 (`sub_47A740` writes 0). */
  cuc: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  maxHp: number;
  maxMp: number;
  /** 공격력 (physical attack). */
  pad: number;
  /** 마력 (magic attack). */
  mad: number;
  /** 물리방어력 (physical defence). */
  pdd: number;
  /** 마법방어력 (magic defence). */
  mdd: number;
  /** 명중률 (accuracy). */
  acc: number;
  /** 회피율 (avoidability). */
  eva: number;
  /** 손재주. */
  craft: number;
  /** 이동속도. */
  speed: number;
  /** 점프력. */
  jump: number;
}

export interface ItemSlotNonEquip extends ItemSlotBaseFields {
  kind: "nonequip";
  /** `u16`: how many of the item are in the slot. */
  quantity: number;
}

export type ItemSlot = ItemSlotEquip | ItemSlotNonEquip;

/** The 15 equip stats, in wire order - also the order `sub_5014C0` prints them in. */
export const EQUIP_STATS = [
  "str",
  "dex",
  "int",
  "luk",
  "maxHp",
  "maxMp",
  "pad",
  "mad",
  "pdd",
  "mdd",
  "acc",
  "eva",
  "craft",
  "speed",
  "jump",
] as const;

export type EquipStat = (typeof EQUIP_STATS)[number];

/** A fresh equip slot: everything zero, the way `sub_45E6A0` builds one. */
export function equipSlot(itemId: number, fields: Partial<Omit<ItemSlotEquip, "kind" | "itemId">> = {}): ItemSlotEquip {
  return {
    kind: "equip",
    itemId,
    cash: null,
    ruc: 0,
    cuc: 0,
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    maxHp: 0,
    maxMp: 0,
    pad: 0,
    mad: 0,
    pdd: 0,
    mdd: 0,
    acc: 0,
    eva: 0,
    craft: 0,
    speed: 0,
    jump: 0,
    ...fields,
  };
}

/** A fresh non-equip slot (quantity 1 is what `sub_47A740` gives a WZ-made item). */
export function nonEquipSlot(
  itemId: number,
  quantity = 1,
  fields: Partial<Omit<ItemSlotNonEquip, "kind" | "itemId" | "quantity">> = {},
): ItemSlotNonEquip {
  return { kind: "nonequip", itemId, cash: null, quantity, ...fields };
}

/** True for the items `sub_45E6A0` gives `GW_ItemSlotEquip`: category 1. */
export function isEquipItemId(itemId: number): boolean {
  return Math.floor(itemId / 1000000) === ITEM_CATEGORY_EQUIP;
}

/** The kind a type hint or category byte selects: 1 = equip, anything else = non-equip. */
function kindOfType(type: number): ItemSlot["kind"] {
  return type === ITEM_CATEGORY_EQUIP ? "equip" : "nonequip";
}

/** Bytes one item occupies on the wire, for the type hint (0 = with the category byte). */
export function itemSlotBytes(item: ItemSlot, typeHint = ITEM_TYPE_FROM_STREAM): number {
  const base = 4 + (item.cash === null ? 1 : 1 + 8 + 2 + 8);
  const body = item.kind === "equip" ? 2 + 2 * EQUIP_STATS.length : 2;
  return base + body + (typeHint === ITEM_TYPE_FROM_STREAM ? 1 : 0);
}

function writeBase(writer: PacketWriter, item: ItemSlot): void {
  if (!Number.isInteger(item.itemId) || item.itemId < 0 || item.itemId > 0xffffffff) {
    throw new RangeError(`itemId ${item.itemId} does not fit a u32`);
  }
  writer.writeU32(item.itemId);
  if (item.cash === null) {
    writer.writeByte(0);
    return;
  }
  // The flag is not a stored field: the client's encoder writes `*(u64*)(obj + 0x10) != 0`.
  if (item.cash.sn === 0n) {
    throw new RangeError("a cash block with sn 0 would encode as an absent block (sub_45E860)");
  }
  writer.writeByte(1);
  writer.writeU64(item.cash.sn);
  writer.writeU16(item.cash.unknown18);
  writer.writeU64(item.cash.unknown1A);
}

/**
 * Appends one item. `typeHint` follows the client's own convention (`sub_45E560`): 0 writes the
 * category byte `itemId / 1000000` first, any other value writes the body only - the hint is what
 * `CharacterData` uses, because there the inventories announce the kind out of band.
 */
export function writeItemSlot(writer: PacketWriter, item: ItemSlot, typeHint = ITEM_TYPE_FROM_STREAM): void {
  if (typeHint === ITEM_TYPE_FROM_STREAM) {
    // sub_45E560 writes `itemId / 1000000` - derived, never caller-supplied.
    writer.writeByte(Math.floor(item.itemId / 1000000));
  } else if (kindOfType(typeHint) !== item.kind) {
    throw new RangeError(`type hint ${typeHint} cannot carry a ${item.kind} item`);
  }
  writeBase(writer, item);
  if (item.kind === "equip") {
    writer.writeByte(item.ruc);
    writer.writeByte(item.cuc);
    for (const stat of EQUIP_STATS) writer.writeU16(item[stat]);
    return;
  }
  writer.writeU16(item.quantity);
}

function readBase(reader: PacketReader): ItemSlotBaseFields {
  const itemId = reader.readU32();
  const hasCashBlock = reader.readByte();
  if (hasCashBlock === 0) return { itemId, cash: null };
  return { itemId, cash: { sn: reader.readU64(), unknown18: reader.readU16(), unknown1A: reader.readU64() } };
}

/**
 * Reads one item. With `typeHint === 0` the category byte is read first and decides the kind
 * (`sub_45E6A0`); otherwise the caller knows the kind (1 = equip) and no byte is consumed.
 */
export function readItemSlot(reader: PacketReader, typeHint = ITEM_TYPE_FROM_STREAM): ItemSlot {
  const kind = typeHint === ITEM_TYPE_FROM_STREAM ? kindOfType(reader.readByte()) : kindOfType(typeHint);
  const base = readBase(reader);
  if (kind === "equip") {
    const item: ItemSlotEquip = {
      kind,
      ...base,
      ruc: reader.readByte(),
      cuc: reader.readByte(),
      str: 0,
      dex: 0,
      int: 0,
      luk: 0,
      maxHp: 0,
      maxMp: 0,
      pad: 0,
      mad: 0,
      pdd: 0,
      mdd: 0,
      acc: 0,
      eva: 0,
      craft: 0,
      speed: 0,
      jump: 0,
    };
    for (const stat of EQUIP_STATS) item[stat] = reader.readU16();
    return item;
  }
  return { kind: "nonequip", ...base, quantity: reader.readU16() };
}
