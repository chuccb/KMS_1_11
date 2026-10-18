/** Original CLIENT admission duplicated at the server trust boundary as reconstruction policy.
 * Native 4636B0 / 4C5020 / 4C5420. The vanished server's checks cannot be inferred from a packet.
 */
import { canWear, type EquipInventory } from "../../../client/equip-rules.ts";
import type { StatItem } from "../../../client/characterstats.ts";
import type { CharacterData } from "../protocol/chardata.ts";
import type { ClientChangeSlot } from "../protocol/field.ts";
import { EQUIP_STATS, type ItemSlot } from "../protocol/itemslot.ts";
import type { ItemCatalog } from "./iteminfo.ts";
/** Both bag->worn and worn->occupied-bag reverse swaps can put a new item on the body. */
export function equipAdmission(
  character: CharacterData,
  request: ClientChangeSlot,
  catalog: ItemCatalog | undefined,
): string | undefined {
  const { tab, fromSlot, toSlot } = request,
    items = character.items;
  if (tab !== 1 || !items || fromSlot === toSlot || toSlot === 0) return;
  const read = (slot: number): ItemSlot | undefined =>
    slot < 0 ? items.worn.get(-slot) : items.inventories[0]?.items.get(slot);
  const candidate = toSlot < 0 ? read(fromSlot) : fromSlot < 0 ? read(toSlot) : undefined;
  if (!candidate) return; // Structural checks/refusal belong to applyChangeSlot.
  return canEquipItem(character, candidate, catalog, -(toSlot < 0 ? toSlot : fromSlot));
}
export function canEquipItem(
  character: CharacterData,
  candidate: ItemSlot,
  catalog: ItemCatalog | undefined,
  part = 11,
): string | undefined {
  const items = character.items;
  if (!items) return "背包尚未載入。";
  if (candidate.kind !== "equip") return "非裝備不能穿戴。";
  if (!catalog) return "尚未載入原WZ裝備需求，未穿戴。";
  const inventory: EquipInventory = {
    worn: [...items.worn].map(([slot, item]) => ({ slot, itemId: item.itemId })),
    tabs: items.inventories.map((inv, index) => ({
      tab: index + 1,
      capacity: inv.capacity,
      items: [...inv.items.keys()].map((slot) => ({ slot })),
    })),
  };
  const worn: StatItem[] = [...items.worn].flatMap(([slot, item]) =>
    item.kind === "equip"
      ? [
          {
            slot,
            itemId: item.itemId,
            stats: Object.fromEntries(EQUIP_STATS.map((key) => [key, item[key]])),
            requirements: catalog.info(item.itemId)?.requirements,
          },
        ]
      : [],
  );
  return canWear(candidate, catalog.info(candidate.itemId), character.stats, inventory, part, worn);
}
