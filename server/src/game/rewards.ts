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
 * WHAT THE SERVER CANNOT DO YET: the client's own counters. The meso total in the status bar and the
 * experience a player sees are drawn from client state that no located packet writes - the stat block
 * travels once, inside `CharacterData` (`0x16`), and its only update packet (`0x0D`, `sub_55BEB0` ->
 * `sub_45E0D0`) is a bit-flagged stat delta whose flag map is not decoded yet (FINDINGS 4.18/6). So
 * the mesos live in `MesoWallet` (server-side, per character) and the player reads the gain from the
 * `0x11` notice until that packet is done. The wallet is what a shop, a trade and a save routine need
 * anyway; it is not a workaround, it is where the money has to be.
 *
 * Stack limits are a server rule like the drop odds: the wire carries `u16 quantity`
 * (`GW_ItemSlotNonEquip`), so 65535 would fit, but the original server's limit is not in the binary.
 * `MAX_ITEM_STACK` is a named constant with one place to change it.
 */
import {
  INVENTORY_OP,
  INVENTORY_TAB,
  type InventoryChange,
} from "../protocol/inventory.ts";
import { equipSlot, isEquipItemId, nonEquipSlot, type ItemSlot } from "../protocol/itemslot.ts";
import type { CharacterItems, Inventory } from "../protocol/chardata.ts";
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
  // An equip is never a pile: two of them are two slots, even when they are the same item id.
  if (isEquipItemId(itemId)) return undefined;
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
export function grantItem(items: CharacterItems, itemId: number, count = 1): GrantedItem | undefined {
  const tab = inventoryTabOfItemId(itemId);
  const inventory = items.inventories[tab - 1]!;
  const stack = stackableSlot(inventory, itemId, count);
  if (stack !== undefined) {
    const item = inventory.items.get(stack)!;
    if (item.kind !== "nonequip") return undefined; // unreachable: stackableSlot only returns those
    const next = { ...item, quantity: item.quantity + count };
    inventory.items.set(stack, next);
    return { inventory: tab, slot: stack, change: { op: INVENTORY_OP.put, inventory: tab, slot: stack, item: next } };
  }
  const slot = freeSlot(inventory);
  if (slot === undefined) return undefined;
  // Which object the client builds for the slot follows the *tab* (`sub_45E6A0`), so the item has to
  // match it: an equip id gets a `GW_ItemSlotEquip`, everything else a non-equip with a quantity.
  const item: ItemSlot = isEquipItemId(itemId) ? equipSlot(itemId) : nonEquipSlot(itemId, count);
  inventory.items.set(slot, item);
  return { inventory: tab, slot, change: { op: INVENTORY_OP.put, inventory: tab, slot, item } };
}

/**
 * The money the server keeps for its characters.
 *
 * In memory, like the accounts: a restart forgets it. Nothing sends it to the client yet (see the
 * header), and that is the only reason the client cannot show it - the number itself has to live
 * somewhere authoritative, and this is that place.
 */
export class MesoWallet {
  private readonly balances = new Map<number, number>();

  /** The balance of one character (0 for a character who never earned anything). */
  of(characterId: number): number {
    return this.balances.get(characterId) ?? 0;
  }

  /** Adds `amount` and returns the new balance. Negative amounts are ignored, not subtracted. */
  earn(characterId: number, amount: number): number {
    const next = this.of(characterId) + Math.max(0, Math.round(amount));
    this.balances.set(characterId, next);
    return next;
  }

  /** Takes money out; `false` when it is not there, and then nothing moves. */
  spend(characterId: number, amount: number): boolean {
    const balance = this.of(characterId);
    if (amount < 0 || balance < amount) return false;
    this.balances.set(characterId, balance - amount);
    return true;
  }
}

/** What taking one drop did, in the terms the packets need. */
export type PickupResult =
  | { kind: "mesos"; notice: LootNotice; amount: number; total: number }
  | { kind: "item"; notice: LootNotice; itemId: number; count: number; inventory: number; slot: number; change: InventoryChange }
  | { kind: "no-room"; notice: LootNotice; itemId: number };

/** The parts of a drop this module cares about (`FieldDrop` satisfies it). */
export interface Pickup {
  money: boolean;
  amount: number;
  itemId: number;
  count: number;
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
export function pickUpDrop(drop: Pickup, characterId: number, items: CharacterItems, wallet: MesoWallet): PickupResult {
  if (drop.money) {
    const total = wallet.earn(characterId, drop.amount);
    return { kind: "mesos", notice: { kind: "mesos", amount: drop.amount }, amount: drop.amount, total };
  }
  const granted = grantItem(items, drop.itemId, drop.count);
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
