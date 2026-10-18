/**
 * What a player *gets* when they take a drop: an item in an inventory, or mesos in the wallet.
 *
 * This is pure bookkeeping over the character record the login server handed to the field
 * (`CharacterItems`, `protocol/chardata.ts`) plus the two facts the client needs to be told:
 *
 *   `0x0B`  (`protocol/inventory.ts`)  the item is now in slot N of tab T. This is the only packet
 *                                      that ever changes an inventory after login, and it is what
 *                                      makes the item appear in the client's UI.
 *   `0x11`  (`protocol/drop.ts`)       the chat line - "아이템을 얻었습니다 (%s)" / "메소를 얻었습니다
 *                                      (+%d)". Without it a pickup is silent except for the animation.
 *
 * THE MESOS ARE THE CHARACTER'S OWN FIELD. `CharacterData`'s 22nd field is the money (`+89/+93`): it
 * is what the client's shop compares a price against ("현금이 부족합니다") and what its meso-drop
 * dialog shows with a 50000 cap (FINDINGS 4.22). `0x0D`'s flag `0x40000` is that same field, so a
 * change the server makes here travels to the client's screen - the wallet is a *view* over
 * `stats.mesos`, never a second account, and `MesoChange` is what the caller sends.
 *
 * Stack limits are a server rule like the drop odds: the wire carries `u16 quantity`
 * (`GW_ItemSlotNonEquip`), so 65535 would fit, but the original server's limit is not in the binary.
 * `MAX_ITEM_STACK` is a named constant with one place to change it.
 */
import type { ItemCatalog } from "./iteminfo.ts";
import { equipmentFromTemplate } from "./equipment.ts";
import { INVENTORY_OP, INVENTORY_TAB, type InventoryChange } from "../protocol/inventory.ts";
import { equipSlot, isEquipItemId, nonEquipSlot, type ItemSlot } from "../protocol/itemslot.ts";
import type { CharacterItems, CharacterStats, Inventory } from "../protocol/chardata.ts";
import type { LootNotice } from "../protocol/drop.ts";

/** Most of one item a slot may hold. A server choice - see the header. */
export const MAX_ITEM_STACK = 200;

/**
 * Which of the client's four tabs an item belongs to.
 *
 * The client's own split (`sub_45E6A0`) is "equip" vs "non-equip" by `itemId / 1000000 == 1`, and
 * `sub_55E8F0` accepts exactly 1..4. The category comes from the item id's millions digit:
 * 1 = equip, 2 = consume, 3 = install, 4 = etc, 5 = cash. This build has no install tab (four tabs,
 * and no `Item/Install/*.img` at all), so an install item would share the "etc" tab - which is what
 * `CharacterData`'s third inventory is.
 */
export function inventoryTabOfItemId(itemId: number): number {
  const category = Math.floor(itemId / 1000000);
  if (category === 1) return INVENTORY_TAB.equip;
  if (category === 2) return INVENTORY_TAB.consume;
  if (category === 5) return INVENTORY_TAB.cash;
  return INVENTORY_TAB.etc;
}

/** The tab of `items` an item id belongs to. */
export function inventoryOfItem(items: CharacterItems, itemId: number): Inventory {
  return items.inventories[inventoryTabOfItemId(itemId) - 1]!;
}

/** The lowest free slot in a tab, or `undefined` when every slot up to the capacity is taken. */
export function freeSlot(inventory: Inventory): number | undefined {
  for (let slot = 1; slot <= inventory.capacity; slot++) {
    if (!inventory.items.has(slot)) return slot;
  }
  return undefined;
}

/** The slot that already holds this item with room for `count` more, if there is one. */
function stackableSlot(inventory: Inventory, itemId: number, count: number): number | undefined {
  // Equips and rechargeable sets are separate objects even when the item id matches.
  if (isEquipItemId(itemId) || Math.floor(itemId / 10000) === 207) return undefined;
  for (const [slot, item] of inventory.items) {
    if (item.kind !== "nonequip") continue;
    if (item.itemId !== itemId) continue;
    if (item.cash !== null) continue; // a cash item is a unique thing, never a pile
    if (item.quantity + count <= MAX_ITEM_STACK) return slot;
  }
  return undefined;
}

/** What one granted item did. */
export interface GrantedItem {
  /** The tab (1..4) and slot it landed in. */
  inventory: number;
  slot: number;
  /** The `0x0B` entry that reproduces the change on the client. */
  change: InventoryChange;
}

/**
 * Put `count` of `itemId` into the character's inventories: onto an existing pile when one has room,
 * otherwise into the lowest free slot.
 *
 * `undefined` means the tab has no room, and then nothing is granted - the caller leaves the drop on
 * the ground, which is what a full bag should do.
 */
/**
 * The item object a fresh slot gets: the template when the caller has one (a throw-away coming back
 * off the ground), otherwise the default object for that id.
 *
 * An item on the ground is the item, not a copy of its id: a weapon that was dropped with scrolls on
 * it is picked back up with them. The template's own id has to match - a caller that hands over
 * something else is a bug, and the default is the safe answer.
 */
function freshSlot(
  itemId: number,
  count: number,
  template?: ItemSlot,
  catalog?: ItemCatalog,
): ItemSlot | undefined {
  if (template !== undefined && template.itemId === itemId) {
    return "quantity" in template ? { ...template, quantity: count } : { ...template };
  }
  return isEquipItemId(itemId)
    ? catalog
      ? equipmentFromTemplate(itemId, catalog)
      : equipSlot(itemId)
    : nonEquipSlot(itemId, count);
}

export function grantItem(
  items: CharacterItems,
  itemId: number,
  count = 1,
  template?: ItemSlot,
  catalog?: ItemCatalog,
): GrantedItem | undefined {
  if (!Number.isInteger(count) || count <= 0 || (isEquipItemId(itemId) && count !== 1))
    return undefined;
  const tab = inventoryTabOfItemId(itemId);
  const inventory = items.inventories[tab - 1]!;
  const stack = stackableSlot(inventory, itemId, count);
  if (stack !== undefined) {
    const item = inventory.items.get(stack)!;
    if (item.kind !== "nonequip") return undefined; // unreachable: stackableSlot only returns those
    const next = { ...item, quantity: item.quantity + count };
    inventory.items.set(stack, next);
    return {
      inventory: tab,
      slot: stack,
      change: { op: INVENTORY_OP.put, inventory: tab, slot: stack, item: next },
    };
  }
  const slot = freeSlot(inventory);
  if (slot === undefined) return undefined;
  // Which object the client builds for the slot follows the *tab* (`sub_45E6A0`), so the item has to
  // match it: an equip id gets a `GW_ItemSlotEquip`, everything else a non-equip with a quantity.
  const item = freshSlot(itemId, count, template, catalog);
  if (!item) return undefined; // Known archive but missing/unsupported equip: do not create a zero-stat item.
  inventory.items.set(slot, item);
  return { inventory: tab, slot, change: { op: INVENTORY_OP.put, inventory: tab, slot, item } };
}

/**
 * One character's money, as the character record holds it.
 *
 * The record *is* the balance (`stats.mesos`, wire field 22 - see the header): a wallet is a view
 * over one record, so there is exactly one number to keep consistent, and every change is a change
 * the client can be told about with `0x0D` (flag `0x40000`).
 */
export class MesoWallet {
  private readonly stats: CharacterStats;

  constructor(stats: CharacterStats) {
    this.stats = stats;
  }

  /** The balance. */
  get balance(): number {
    return this.stats.mesos;
  }

  /**
   * Adds `amount` and returns the new balance. A negative amount is ignored rather than subtracted,
   * and the wire field is a `u32`, so a sum beyond it stays at the ceiling instead of wrapping.
   */
  earn(amount: number): number {
    const next = this.balance + Math.max(0, Math.round(amount));
    this.stats.mesos = Math.min(next, 0xffffffff);
    return this.stats.mesos;
  }

  /** Takes money out; `false` when it is not there, and then nothing moves. */
  spend(amount: number): boolean {
    if (!Number.isFinite(amount) || amount < 0 || this.balance < amount) return false;
    this.stats.mesos = this.balance - amount;
    return true;
  }
}

/** What taking one drop did, in the terms the packets need. */
export type PickupResult =
  | { kind: "mesos"; notice: LootNotice; amount: number; total: number }
  | {
      kind: "item";
      notice: LootNotice;
      itemId: number;
      count: number;
      inventory: number;
      slot: number;
      change: InventoryChange;
    }
  | { kind: "no-room"; notice: LootNotice; itemId: number };

/** The parts of a drop this module cares about (`DropEntry` satisfies it). */
export interface Pickup {
  money: boolean;
  amount: number;
  itemId: number;
  count: number;
  /**
   * The item itself when the ground knows it - a throw-away does, a monster's roll does not - so the
   * picked-up object is the dropped one (see `freshSlot`).
   */
  slot?: ItemSlot;
}

/**
 * Hands one drop to one character: mesos into the wallet, an item into the inventories - each with
 * the `0x11` notice the client prints.
 *
 * `no-room` carries the client's third notice shape (`0x11` kind 2, "no more items"), which is the
 * only thing the client can say about a refused pickup; the caller decides whether to send it (this
 * server does not, so a player standing on a drop with a full bag is not spammed every tick - see
 * `loginserver.ts` - and the message is left for the day pickups have a request to answer).
 */
export function pickUpDrop(
  drop: Pickup,
  items: CharacterItems,
  wallet: MesoWallet,
  catalog?: ItemCatalog,
): PickupResult {
  if (drop.money) {
    if (wallet.balance + drop.amount > 0xffffffff)
      return { kind: "no-room", notice: { kind: "rejected" }, itemId: 0 };
    const total = wallet.earn(drop.amount);
    return {
      kind: "mesos",
      notice: { kind: "mesos", amount: drop.amount },
      amount: drop.amount,
      total,
    };
  }
  const granted = grantItem(items, drop.itemId, drop.count, drop.slot, catalog);
  if (granted === undefined) {
    return { kind: "no-room", notice: { kind: "rejected" }, itemId: drop.itemId };
  }
  return {
    kind: "item",
    notice: { kind: "item", itemId: drop.itemId, count: drop.count },
    itemId: drop.itemId,
    count: drop.count,
    inventory: granted.inventory,
    slot: granted.slot,
    change: granted.change,
  };
}

/** What taking one item out of an inventory did, in the terms `0x0B` needs. */
export interface TakenItem {
  inventory: number;
  slot: number;
  /** How many were taken (the request asked for `count`). */
  count: number;
  /** How many are left in that slot (0 when the stack is gone). */
  remaining: number;
  /**
   * The change to send: a `clear` when the stack ran out, otherwise the same slot `put` again with
   * the remainder - the only two shapes a shop needs, and both are decoded (`INVENTORY_OP`).
   */
  change: InventoryChange;
}

/**
 * Takes `count` of `itemId` out of `slot` - the counterpart of `grantItem`, used by a shop sale.
 *
 * The caller's slot and id are both checked: a request that names a slot holding something else (or
 * fewer than it asks for) is refused instead of quietly emptying the wrong stack. Equipment does not
 * stack, so `count` has to be 1 there.
 */
export function takeItem(
  items: CharacterItems,
  itemId: number,
  slot: number,
  count: number,
): TakenItem | undefined {
  if (!Number.isInteger(count) || count < 0 || (count === 0 && Math.floor(itemId / 10000) !== 207))
    return undefined;
  const inventory = inventoryTabOfItemId(itemId);
  const tab = items.inventories[inventory - 1]!;
  const item = tab.items.get(slot);
  if (item === undefined || item.itemId !== itemId) return undefined;
  if (isEquipItemId(itemId)) {
    if (count !== 1) return undefined;
    tab.items.delete(slot);
    return {
      inventory,
      slot,
      count: 1,
      remaining: 0,
      change: { op: INVENTORY_OP.clear, inventory, slot },
    };
  }
  const quantity = "quantity" in item ? item.quantity : 0;
  if (Math.floor(itemId / 10000) === 207 && count !== quantity) return undefined;
  if (quantity < count) return undefined;
  const remaining = quantity - count;
  if (remaining === 0) {
    tab.items.delete(slot);
    return {
      inventory,
      slot,
      count,
      remaining,
      change: { op: INVENTORY_OP.clear, inventory, slot },
    };
  }
  const left = { ...item, quantity: remaining };
  tab.items.set(slot, left);
  return {
    inventory,
    slot,
    count,
    remaining,
    change: { op: INVENTORY_OP.put, inventory, slot, item: left },
  };
}
