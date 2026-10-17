/**
 * `0x0B`: the item-list update - the only packet that puts an item in a character's inventory once
 * the character exists.
 *
 * EVIDENCE (MapleStory.exe.c, FINDINGS 4.6 / 4.10)
 * -----------------------------------------------
 * `0x0B` is not a login packet and not a CField packet either: it is one of the nine CWvsApp-level
 * handlers `sub_55A900` (351269) switches on for **any** stage - case 11 -> `sub_55BAB0`. That is how
 * a picked-up item reaches the client's UI after the character has been sent in `CharacterData`:
 * the inventories travel once, at login, and after that only this packet changes them.
 *
 * `sub_55BAB0` (352319-352537) reads, in order:
 *
 *   u8  result      non-zero re-arms the field timer: `*(this + 0x18) = 0; *(this + 0x1C) =
 *                   timeGetTime()` - the same pair `0x19` sets. It is a *flag*, not a per-entry
 *                   result.
 *   u8  count       entries; 0 ends the packet.
 *   count x {
 *     u8  op        0 = put an item, 1 = re-key, 2 = swap two slots, 3 = clear a slot
 *     u8  inventory 1..4 (1 = equip, 2 = consume, 3 = etc, 4 = cash); anything else drops the entry
 *     u16 slot      the client's slot number; on the equip tab -1..-14 address the *worn* slots
 *                   (`charData + 122` / `+ 242`, the two inline groups, 15 slots each)
 *     op == 0: <one GW_ItemSlot>
 *     op == 1: u16 key
 *     op == 2: u16 slot2
 *     op == 3: (nothing)
 *   }
 *
 * The item of `op == 0` is read by `sub_45E6A0(&item, packet, inventory)`: because the third argument
 * is the *inventory number* and never 0, no category byte is on the wire here (unlike the
 * `CharacterData` block, which does not write it either - only the local `u8 kind` of `sub_45E6A0`
 * decides `GW_ItemSlotEquip` vs `GW_ItemSlotNonEquip`). `itemId / 1000000 == 1` means equip; anything
 * else is a non-equip, which is why a *worn* slot can only ever hold an equip.
 *
 * Two client-side traps are encoded here so they cannot be walked into:
 *
 *   - `op == 1` on the equip tab: `sub_55BAB0` throws `CTerminateException` for that combination,
 *     i.e. the client disconnects. The encoder refuses instead.
 *   - The packet ends with `sub_55EB00`, whose non-zero return disconnects the client
 *     (`AVCDisconnectException`): it walks the worn slots, so a worn slot is only written with an
 *     item that fits it.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import { writeItemSlot, readItemSlot, type ItemSlot } from "./itemslot.ts";

/** The CWvsApp opcode of `sub_55BAB0` (`sub_55A900` case 11). */
export const INVENTORY_OPCODE = 0x0b;

/** The per-entry `op` byte. */
export const INVENTORY_OP = {
  /** Put one item into a slot (the item follows). */
  put: 0,
  /** Re-key one slot's obfuscation (a `u16` follows). Never legal on the equip tab. */
  key: 1,
  /** Swap two slots (a second `u16` slot follows). */
  swap: 2,
  /** Clear a slot (nothing follows). */
  clear: 3,
} as const;

/** The four tabs `sub_55E8F0` accepts, in the order `CharacterData` sends them. */
export const INVENTORY_TAB = {
  equip: 1,
  consume: 2,
  etc: 3,
  cash: 4,
} as const;

/** The most negative slot the client's worn groups can address (`-1`..`-14`, plus a guard). */
export const WORN_SLOT_MIN = -14;

/** One entry of a `0x0B` packet. */
export type InventoryChange =
  | { op: typeof INVENTORY_OP.put; inventory: number; slot: number; item: ItemSlot }
  | { op: typeof INVENTORY_OP.key; inventory: number; slot: number; key: number }
  | { op: typeof INVENTORY_OP.swap; inventory: number; slot: number; slot2: number }
  | { op: typeof INVENTORY_OP.clear; inventory: number; slot: number };

function checkInventory(inventory: number): void {
  if (!Number.isInteger(inventory) || inventory < 1 || inventory > 4) {
    throw new RangeError(`inventory ${inventory} is outside the client's 1..4 (sub_55E8F0 drops it)`);
  }
}

function checkSlot(inventory: number, slot: number): void {
  if (!Number.isInteger(slot)) throw new RangeError(`slot ${slot} is not an integer`);
  if (slot < WORN_SLOT_MIN) throw new RangeError(`slot ${slot} does not fit the u16 slot field`);
  if (slot > 0xffff) throw new RangeError(`slot ${slot} does not fit the u16 slot field`);
  if (slot < 0 && inventory !== INVENTORY_TAB.equip) {
    throw new RangeError(
      `negative slot ${slot} is a worn equip slot, so inventory has to be 1 - not ${inventory}`,
    );
  }
}

function writeChange(writer: PacketWriter, change: InventoryChange): void {
  checkInventory(change.inventory);
  checkSlot(change.inventory, change.slot);
  writer.writeByte(change.op);
  writer.writeByte(change.inventory);
  writer.writeU16(change.slot & 0xffff);
  if (change.op === INVENTORY_OP.put) {
    // The tab *is* the client's kind hint (`sub_45E6A0`'s third argument), so no category byte is
    // written and the item has to agree with the tab - `writeItemSlot` throws when it does not.
    writeItemSlot(writer, change.item, change.inventory);
    return;
  }
  if (change.op === INVENTORY_OP.key) {
    if (change.inventory === INVENTORY_TAB.equip) {
      throw new RangeError("op 1 on the equip tab throws CTerminateException on the client (sub_55BAB0)");
    }
    writer.writeU16(change.key & 0xffff);
    return;
  }
  if (change.op === INVENTORY_OP.swap) {
    checkSlot(change.inventory, change.slot2);
    writer.writeU16(change.slot2 & 0xffff);
  }
}

/**
 * Encode one `0x0B`, opcode byte included.
 *
 * `result` is the client's timer flag: 1 (the default) is what a change the player caused - a
 * pickup, a shop, a quest reward - should send.
 */
export function encodeInventoryChange(changes: readonly InventoryChange[], result = 1): Uint8Array {
  if (changes.length > 0xff) throw new RangeError(`${changes.length} changes do not fit the u8 count`);
  const writer = new PacketWriter(16 + changes.length * 32);
  writer.writeByte(INVENTORY_OPCODE);
  writer.writeByte(result === 0 ? 0 : 1);
  writer.writeByte(changes.length);
  for (const change of changes) writeChange(writer, change);
  return writer.toBytes();
}

/** Read one `0x0B` body (no opcode byte; the reader must sit at `result`). */
export function readInventoryChange(reader: PacketReader): { result: number; changes: InventoryChange[] } {
  const result = reader.readByte();
  const count = reader.readByte();
  const changes: InventoryChange[] = [];
  for (let index = 0; index < count; index++) {
    const op = reader.readByte();
    const inventory = reader.readByte();
    const slot = (reader.readU16() << 16) >> 16;
    if (op === INVENTORY_OP.put) {
      changes.push({ op, inventory, slot, item: readItemSlot(reader, inventory) });
    } else if (op === INVENTORY_OP.key) {
      changes.push({ op, inventory, slot, key: reader.readU16() });
    } else if (op === INVENTORY_OP.swap) {
      changes.push({ op, inventory, slot, slot2: (reader.readU16() << 16) >> 16 });
    } else {
      changes.push({ op: INVENTORY_OP.clear, inventory, slot });
    }
  }
  return { result, changes };
}

/** One line describing a `0x0B` body, for logs and `decode`. */
export function describeInventoryChange(result: number, changes: readonly InventoryChange[]): string {
  const parts = changes.map((change) => {
    const where = `tab ${change.inventory} slot ${change.slot}`;
    if (change.op === INVENTORY_OP.put) return `${where} put item ${change.item.itemId}`;
    if (change.op === INVENTORY_OP.key) return `${where} key 0x${change.key.toString(16)}`;
    if (change.op === INVENTORY_OP.swap) return `${where} swap with slot ${change.slot2}`;
    return `${where} clear`;
  });
  return `inventory timer=${result} changes=${changes.length} ${parts.join("; ")}`.trimEnd();
}
