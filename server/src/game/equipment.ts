/** 478270 info/tuc + inc* -> 47A740 fresh equip, not the empty 45E6A0 decode allocation.
 * Deterministic native WZ template values; original server random variations are unknown.
 * Existing items MUST keep their instance values. No load-time/save-time backfill.
 */
import { equipSlot, EQUIP_STATS, type ItemSlot, type ItemSlotEquip } from "../protocol/itemslot.ts";
import { INVENTORY_OP, type InventoryChange } from "../protocol/inventory.ts";
import type { CharacterItems } from "../protocol/chardata.ts";
import type { ItemCatalog } from "./iteminfo.ts";
import type { CreationCatalog } from "./creation.ts";

export function equipmentFromTemplate(itemId: number, catalog: ItemCatalog): ItemSlotEquip | undefined {
  const info = catalog.info(itemId);
  if (!info?.equipment || info.cash !== false) return undefined;
  return equipSlot(itemId, { ...info.equipment.stats, ruc: info.equipment.ruc, cuc: 0 });
}

/** Whitelist from actual MakeCharInfo; no arbitrary IDs or later-version starter guesses. */
export function starterEquipmentIds(catalog: CreationCatalog | undefined): ReadonlySet<number> {
  return new Set([catalog?.male ?? [], catalog?.female ?? []]
    .flatMap(groups => groups.slice(2).flatMap(group => group.map(option => option.id))));
}

export function isBlankStarter(item: ItemSlot, starters: ReadonlySet<number>): item is ItemSlotEquip {
  return item.kind === "equip" && starters.has(item.itemId) && item.cash === null &&
    item.ruc === 0 && item.cuc === 0 && EQUIP_STATS.every(stat => item[stat] === 0);
}

/** Explicit opt-in repair planner. Clones first; never mutates even if a template is unavailable. */
export function planBlankStarterRepair(
  source: CharacterItems,
  catalog: ItemCatalog | undefined,
  starters: ReadonlySet<number>,
): { items: CharacterItems; changes: InventoryChange[] } {
  const items = structuredClone(source), changes: InventoryChange[] = [];
  const repair = (group: Map<number, ItemSlot>, worn: boolean) => {
    for (const [slot, item] of group) {
      if (!isBlankStarter(item, starters)) continue;
      const fresh = catalog && equipmentFromTemplate(item.itemId, catalog);
      if (!fresh || fresh.ruc === 0 && EQUIP_STATS.every(stat => fresh[stat] === 0)) continue;
      group.set(slot, fresh);
      changes.push({ op: INVENTORY_OP.put, inventory: 1, slot: worn ? -slot : slot, item: fresh });
    }
  };
  repair(items.worn, true);
  repair(items.inventories[0]!.items, false);
  return { items, changes };
}
