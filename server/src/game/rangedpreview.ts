/** Explicit, fixed development grant; NOT native loot/shop rules and never applied on startup. */
import type {CharacterItems} from '../protocol/chardata.ts';
import type {InventoryChange} from '../protocol/inventory.ts';
import type {ItemCatalog} from './iteminfo.ts';
import {grantItem,MAX_ITEM_STACK} from './rewards.ts';
// Read from this Data.wz: War Bow Lv10/PAD25, crossbow Lv12/PAD29, Garnier Lv10/PAD10.
// IDs are an allowlist for this opt-in tool, not gameplay selectors or guessed equipment values.
export const RANGED_PREVIEW_WEAPONS=[1452002,1462001,1472000] as const;
export const RANGED_PREVIEW_AMMO=[2060000,2061000,2070000] as const;
export const RANGED_PREVIEW_AMMO_COUNT=200; // Opt-in tool policy, not a native grant.
/** Clone, validate archive templates/capacity, then let the authenticated caller pre-encode/commit. */
export function planRangedPreviewKit(current:CharacterItems,catalog:ItemCatalog|undefined) {
  if(!catalog)throw new Error('原WZ道具目錄尚未載入，未發放遠距裝備。');
  const items=structuredClone(current),changes:InventoryChange[]=[];
  for(const id of [...RANGED_PREVIEW_WEAPONS,...RANGED_PREVIEW_AMMO]) {
    const info=catalog.info(id),equip=RANGED_PREVIEW_WEAPONS.some(weapon=>weapon===id);
    if(!info || (equip?!info.equipment:!Number.isInteger(info.slotMax)||(info.slotMax??0)<1))
      throw new Error(`原WZ遠距道具 ${id} 的模板不可用，背包完全未變更。`);
    // 200 is this tool's quantity policy, capped by actual WZ slotMax; not a native ammo count.
    const quantity=equip?1:Math.min(RANGED_PREVIEW_AMMO_COUNT,MAX_ITEM_STACK,info.slotMax!);
    const grant=grantItem(items,id,quantity,undefined,catalog);
    if(!grant)throw new Error('裝備／消耗欄空間不足以放入整組遠距道具；背包完全未變更。');
    changes.push(grant.change);
  }
  return {items,changes};
}
