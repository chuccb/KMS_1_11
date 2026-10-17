/**
 * The inventory window's own drags: equip, unequip, move, and what the server does about them.
 *
 * EVIDENCE (FINDINGS 4.36)
 * --------------------------------------------------------------------
 * The client listens for the drop of a dragged item and then asks: `sub_4636B0` (a double-click on an
 * equip) validates the item's own requirements against the character's stats, job and level - the
 * `현재 능력치가 낮아서 선택된 아이템을 장착할 수 없습니다.` dialog - and calls `sub_55ACB0`; `sub_4630A0`
 * is a drag inside the equip tab, `sub_463A50` a drag in any tab, `sub_463BE0` the throw-away prompt.
 * **No sender writes the client's inventory.** The window therefore follows the server's `0x0B` and
 * nothing else, exactly like the use-item path (FINDINGS 4.34): an equip the server refuses simply
 * stays in the bag, and an equip it accepts appears on the avatar because `0x0B` can address a
 * **negative slot** of the equip tab, which *is* the worn item (FINDINGS 4.10).
 *
 * WHAT IS EVIDENCE, WHAT IS A CHOICE
 * --------------------------------------------------------------------
 * Evidence: the four fields, the negative-slot convention for worn items, `toSlot = 0` = the ground,
 * `count = -1` for a move, and the slot's own body part - `sub_4636B0` is *called* with the part its
 * caller derived from the item id, so a part the item does not belong to is a request the client
 * would never make.
 *
 * Choices (the wire cannot say, and the 2003 server is gone):
 *
 * 1. **The server validates the part, the client validates the requirements.** `sub_4636B0` checks
 *    level/job/STR/... from the archive before sending, but it only checks for *itself*: a packet
 *    that names a weapon for the shoe slot, or a potion for a worn slot, is data-structural nonsense
 *    and is refused here. Nothing re-reads `reqLevel`/`reqJob` - that would be a second copy of the
 *    archive's rules with no wire to confirm it against.
 * 2. **Both slots holding an item means a swap**, in both directions (equip over an occupied part
 *    puts the old item in the slot the new one came from, which is what "wearing" means in this
 *    game). A swap is only accepted while the displaced item can sit where it is being put.
 * 3. **`count` has to be `-1` for anything but a throw-away.** All three move senders pass the
 *    literal -1; a positive count only appears with `toSlot = 0`, which is the ground.
 * 4. **A throw-away leaves the inventory here and the ground is the caller's** (`kind: "drop"`): the
 *    item (or `count` of it, or the whole stack) leaves the slot, and *where it lands* is
 *    `game/drops.ts` - the same split a monster's loot has. `count` is the client's own number: it is
 *    the stack size for a stack (asked for when there is more than one, `sub_463BE0`) and always 1 for
 *    a worn item or anything in the equip tab, and it is checked against the stack here.
 *    A **cash item is refused** (`cashItem`): the client refuses to send one itself - `sub_47A420`
 *    reads the archive's `info/cash` and `sub_463BE0` also refuses an item whose own cash serial is
 *    set - and a drop on the ground can only carry an item id and a count, so the serial would be
 *    lost.
 * 5. **Cash equips are not handled**: `sub_4636B0`'s table sends `111xxxx` to part 12/13, and the
 *    client's second worn group (`wornCash`) is a different array. Neither is touched here.
 *
 * The caller owns everything else: the `0x0B` for `changes`, the `0x28` for `lookChanged` (FINDINGS
 * 4.11.8), and the log line for a refusal. This module knows no packets beyond the two shapes it
 * returns.
 */
import {
  INVENTORY_OP,
  INVENTORY_TAB,
  type InventoryChange,
} from "../protocol/inventory.ts";
import {
  WORN_SLOT_LIMIT,
  wornSlotOfItem,
  type CharacterItems,
} from "../protocol/chardata.ts";
import type { ItemSlot } from "../protocol/itemslot.ts";
import type { ClientChangeSlot } from "../protocol/field.ts";
import { inventoryTabOfItemId } from "./rewards.ts";

/** Why a `0x17` did nothing. Named for the log line, not for the client (there is no result byte). */
export type ChangeSlotFailure =
  | "unknownTab"
  | "slotOutOfRange"
  | "emptySlot"
  | "itemNotInTab"
  | "wrongPart"
  | "displacedItemDoesNotFit"
  | "badCount"
  | "cashItem";

/** What one accepted `0x17` did. */
export interface ChangeSlotDone {
  kind: "done";
  /** The `0x0B` entries that make the client's window agree: one `put` per slot that gained, one
   * `clear` for a slot that emptied. */
  changes: InventoryChange[];
  /** The worn set changed, so everybody else needs a `0x28` (`encodeUserLook`). */
  lookChanged: boolean;
}

/** What one accepted throw-away (`toSlot = 0`) did: the item leaves, the ground is the caller's. */
export interface ChangeSlotDrop {
  kind: "drop";
  /**
   * The item that is now on the ground, exactly as it was - the ground keeps the object, so a
   * scrolled weapon is picked back up with its scrolls (`game/rewards.ts` `freshSlot`).
   */
  slot: ItemSlot;
  /** How many left the slot (1 for an equip). */
  count: number;
  /** The `0x0B` entries: a `clear` when the stack ran out, otherwise the remainder `put` again. */
  changes: InventoryChange[];
  /** The item left a *worn* slot, so everybody else needs a `0x28`. */
  lookChanged: boolean;
}

export type ChangeSlotOutcome =
  | ChangeSlotDone
  | ChangeSlotDrop
  | { kind: "failed"; reason: ChangeSlotFailure };

/**
 * Applies one `0x17` to a character's items, in place.
 *
 * `items` is the record the connection was built from, so an accepted move survives a relog by
 * itself (ADR-017). On a refusal nothing is written at all - the two halves are separate passes
 * (decide, then write) so a half-applied swap cannot happen.
 */
export function applyChangeSlot(items: CharacterItems, request: ClientChangeSlot): ChangeSlotOutcome {
  const { tab, fromSlot, toSlot, count } = request;
  if (tab < 1 || tab > 4) return fail("unknownTab");
  if (fromSlot === 0 || toSlot < -WORN_SLOT_LIMIT) return fail("slotOutOfRange");
  // A negative slot is a worn item, and only the equip tab has one (the client's `0x0B` encoder says
  // the same thing: a negative slot on another tab is not a slot that client can address).
  if ((fromSlot < 0 || toSlot < 0) && tab !== INVENTORY_TAB.equip) return fail("slotOutOfRange");
  // Everything past here needs the slot, and a throw-away needs the item before it can be priced.
  const tabItems = items.inventories[tab - 1]!;
  const read = (slot: number): ItemSlot | undefined =>
    slot < 0 ? items.worn.get(-slot) : tabItems.items.get(slot);
  const fits = (item: ItemSlot, slot: number): boolean =>
    slot < 0 ? wornSlotOfItem(item.itemId) === -slot : inventoryTabOfItemId(item.itemId) === tab;
  const write = (slot: number, item: ItemSlot): void => {
    if (slot < 0) items.worn.set(-slot, item);
    else tabItems.items.set(slot, item);
  };
  const clear = (slot: number): void => {
    if (slot < 0) items.worn.delete(-slot);
    else tabItems.items.delete(slot);
  };

  const source = read(fromSlot);
  if (source === undefined) return fail("emptySlot");
  // A slot number the client made up: the tab's capacity is what its own window has.
  if (fromSlot > tabItems.capacity) return fail("slotOutOfRange");
  if (!fits(source, fromSlot)) return fail(fromSlot < 0 ? "wrongPart" : "itemNotInTab");

  // `toSlot = 0` is the ground (`sub_463BE0` sends `tab, from, 0, numberOfItems`): the item leaves and
  // the field is told (`FieldInstance.dropItem`). The count is the client's own choice, so it is
  // checked against the stack: at least one, no more than there are, and 1 for an equip.
  if (toSlot === 0) {
    if (source.cash !== null) return fail("cashItem");
    const stack = "quantity" in source ? source.quantity : 1;
    if (!Number.isInteger(count) || count <= 0 || count > stack) return fail("badCount");
    const changes: InventoryChange[] = [];
    if (count === stack) {
      clear(fromSlot);
      changes.push({ op: INVENTORY_OP.clear, inventory: tab, slot: fromSlot });
    } else if ("quantity" in source) {
      // Only a stack can be split, so this branch is the same test as `count < stack`.
      const left: ItemSlot = { ...source, quantity: stack - count };
      write(fromSlot, left);
      changes.push({ op: INVENTORY_OP.put, inventory: tab, slot: fromSlot, item: left });
    }
    return {
      kind: "drop",
      slot: { ...source, ...("quantity" in source ? { quantity: count } : {}) },
      count,
      changes,
      lookChanged: tab === INVENTORY_TAB.equip && fromSlot < 0,
    };
  }

  // The three move senders always pass -1; only the throw-away path passes a count.
  if (count !== -1) return fail("badCount");
  // Dropped back where it was picked up: a no-op, but an answered one (an empty `0x0B`).
  if (fromSlot === toSlot) return { kind: "done", changes: [], lookChanged: false };

  if (toSlot > tabItems.capacity) return fail("slotOutOfRange");
  // The destination has to hold it too. For a worn slot that one test *is* "it is an equip and it
  // belongs to that body part" - `wornSlotOfItem` answers `null` for anything else, so no separate
  // "is this even an equip" branch exists.
  if (!fits(source, toSlot)) return fail(toSlot < 0 ? "wrongPart" : "itemNotInTab");
  const displaced = read(toSlot);
  if (displaced !== undefined && !fits(displaced, fromSlot)) return fail("displacedItemDoesNotFit");

  const changes: InventoryChange[] = [];
  write(toSlot, source);
  changes.push({ op: INVENTORY_OP.put, inventory: tab, slot: toSlot, item: source });
  if (displaced === undefined) {
    clear(fromSlot);
    changes.push({ op: INVENTORY_OP.clear, inventory: tab, slot: fromSlot });
  } else {
    write(fromSlot, displaced);
    changes.push({ op: INVENTORY_OP.put, inventory: tab, slot: fromSlot, item: displaced });
  }
  return { kind: "done", changes, lookChanged: tab === INVENTORY_TAB.equip && (fromSlot < 0 || toSlot < 0) };
}

function fail(reason: ChangeSlotFailure): ChangeSlotOutcome {
  return { kind: "failed", reason };
}
