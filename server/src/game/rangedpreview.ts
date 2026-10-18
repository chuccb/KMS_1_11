/** Explicit opt-in development preparation, NOT native loot/quests. Never applied on startup. */
import type {CharacterData} from '../protocol/chardata.ts';
import type {InventoryChange} from '../protocol/inventory.ts';
import type {ItemCatalog} from './iteminfo.ts';
import {grantItem,MAX_ITEM_STACK} from './rewards.ts';
import {awardExp,expToNextLevel} from './exp.ts';
import {characterGrowthContext,type GrowthSkillProvider} from './growth.ts';
import {characterStatBasis} from './characterstats.ts';
import {canEquipItem} from './equipadmission.ts';
import {equipmentFromTemplate} from './equipment.ts';
export const RANGED_PREVIEW_WEAPONS=[1452002,1462001,1472000] as const;
export const RANGED_PREVIEW_AMMO=[2060000,2061000,2070000] as const;
export const RANGED_PREVIEW_AMMO_COUNT=200; // Development quantity policy, not a native reward.
const KITS={bow:{weaponId:1452002,ammoId:2060000},crossbow:{weaponId:1462001,ammoId:2061000},claw:{weaponId:1472000,ammoId:2070000}} as const;
export type RangedPreviewKind=keyof typeof KITS;
export function rangedPreviewKind(value:unknown):RangedPreviewKind {
  if(value!=='bow'&&value!=='crossbow'&&value!=='claw')throw new Error('請明確選擇弓／弩／拳套；沒有任意道具ID入口。');
  return value;
}
export function rangedPreviewChoices(catalog:ItemCatalog|undefined) {
  return Object.entries(KITS).flatMap(([kind,kit])=>{
    const info=catalog?.info(kit.weaponId);
    return info?.equipment&&info.requirements?[{kind,...kit,name:info.name??String(kit.weaponId),requirements:info.requirements}]:[];
  });
}
/** Capacity and requirement failures never mutate live stats/items. No auto-job, skill or equip. */
export function planRangedPreparation(character:CharacterData,catalog:ItemCatalog|undefined,
  kind: RangedPreviewKind,raiseLevel:boolean,grant:boolean,growthSkill?:GrowthSkillProvider) {
  const kit=KITS[rangedPreviewKind(kind)];
  if(!Number.isInteger(character.stats.level)||character.stats.level<1||character.stats.level>200)throw new Error("角色等級不在原1..200範圍，未修改。");
  if(!kit||!catalog)throw new Error('原WZ遠距道具目錄不可用，未修改角色。');
  const info=catalog.info(kit.weaponId),ammoInfo=catalog.info(kit.ammoId),req=info?.requirements;
  if(!info?.equipment||!req||!Number.isInteger(req.level)||req.level<1||req.level>200||!ammoInfo||!Number.isInteger(ammoInfo.slotMax)||(ammoInfo.slotMax??0)<1)
    throw new Error('原WZ遠距模板／需求不可用，未修改角色。');
  if(character.stats.hp<=0)throw new Error('請先復活，再準備遠距體驗。');
  const branch=Math.trunc(character.stats.job/100),jobMask=branch?1<<(branch-1):0;
  if(req.job&&(req.job&jobMask)===0)throw new Error(kind==='claw'?'拳套需要盜賊；先明確套用盜賊體驗配置。':'弓／弩需要弓手；先明確套用弓手體驗配置。');
  if(character.stats.level<req.level&&!raiseLevel)throw new Error(`需要 Lv${req.level}，目前 Lv${character.stats.level}。請明確勾選「補足所選武器最低等級」，或自行練等；沒有發放不能穿的裝備。`);
  const future=structuredClone(character),changes:InventoryChange[]=[];
  if(!future.items)throw new Error('目前角色沒有已公告的背包，未發放。');
  const beforeLevel=future.stats.level;
  if(beforeLevel<req.level) {
    // Minimal EXP to reach this archive requirement. Preserve residual EXP, never lower a level.
    // Recompute worn INT EACH crossed level: more gear can become effective as level rises.
    const residual=future.stats.exp;
    while(future.stats.level<req.level) {
      const next=future.stats.level+1,amount=Math.max(1,expToNextLevel(future.stats.level)-future.stats.exp);
      awardExp(future.stats,amount,next,characterGrowthContext(future,growthSkill,catalog));
    }
    future.stats.exp=residual;
    const caps=characterStatBasis(future,catalog).basic;
    future.stats.hp=caps.maxHp;future.stats.mp=caps.maxMp;
  }
  // Same rule as manual equip; use the real template only as a candidate, not a live bag write.
  const inv=future.items.inventories[0]!;
  const existing=[...inv.items].find(([,item])=>item.itemId===kit.weaponId&&item.kind==='equip');
  const candidate=equipmentFromTemplate(kit.weaponId,catalog);
  if(!candidate)throw new Error('原WZ裝備模板不可用。');
  const reason=canEquipItem(future,candidate,catalog);
  if(reason)throw new Error(reason);
  if(grant) {
    // Repeated presses reuse an owned bag/worn weapon rather than filling the bag with duplicates.
    if(!existing&&future.items.worn.get(11)?.itemId!==kit.weaponId) {
      const weapon=grantItem(future.items,kit.weaponId,1,undefined,catalog);
      if(!weapon)throw new Error('裝備欄空間不足；等級、能力與背包完全未變更。');
      changes.push(weapon.change);
    }
    const quantity=Math.min(RANGED_PREVIEW_AMMO_COUNT,MAX_ITEM_STACK,ammoInfo.slotMax!);
    const ammo=grantItem(future.items,kit.ammoId,quantity,undefined,catalog);
    if(!ammo)throw new Error('消耗欄空間不足；等級、能力與背包完全未變更。');
    changes.push(ammo.change);
  }
  return {stats:future.stats,items:future.items,changes,raised:future.stats.level-beforeLevel,weaponId:kit.weaponId,minimumLevel:req.level};
}
