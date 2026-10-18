import {nativeAfterimageFrames,weaponMasterySkills} from "../../../client/attack-presentation.mjs";
import {activeSkillSpeed} from "../../../client/active-skills.mjs";
/** Archive attack profiles. Native selectors: 427F60 / 427FE0 / 428040; ammo scan: 511630.
 * Skill admission remains separate; the 511630 ammo planner is shared with validated multi-shot.
 */
import type { ClientAttack } from "../protocol/field.ts";
import type { CharacterData, CharacterItems } from "../protocol/chardata.ts";
import {
  INVENTORY_OP,
  INVENTORY_TAB,
  type InventoryChange,
} from "../protocol/inventory.ts";
import { basicAttackAction, scaledAttackDelays } from "../../../client/attack-timing.mjs";
import type { SkillCatalog } from "./skills.ts";
import { skillValues } from "./characterstats.ts";
import { nativeBodyFrameDelay } from "./avatarmotion.ts";
import type { ArtReader } from "./wzart.ts";
import { frameNames, nodeRecord, vectorOf } from "./wzart.ts";
import { spriteFrames, type SpriteFrame } from "./sprites.ts";
export { basicAttackAction };

/** Reconstruction transport/resource policy, NOT constants recovered from the original server. */
export const BASIC_ATTACK_TRANSPORT_GRACE_MS = 30;
export const BASIC_SHOT_POSITION_SLOP_X = 65;
export const BASIC_SHOT_POSITION_SLOP_Y = 100;
const PROFILE_CACHE_LIMIT = 64;

/** Attack action ids, NOT the movement action byte. 43FC80 aliases 24..26 to swingO1..3. */
export const BASIC_ATTACK_STANCES: Readonly<Record<number, string>> = {
  5: "swingO1",
  6: "swingO2",
  7: "swingO3",
  9: "swingT1",
  10: "swingT2",
  11: "swingT3",
  13: "swingP1",
  14: "swingP2",
  16: "stabO1",
  17: "stabO2",
  19: "stabT1",
  20: "stabT2",
  22: "shoot1",
  23: "shoot2",
  24: "swingO1",
  25: "swingO2",
  26: "swingO3",
  28: "swingO1", // 43FC80: magic aliases, NOT magic1/magic2 or heal.
  29: "swingO3",
  32: "proneStab",
};
// PE VA 005B2144: seven groups, two rows/group, six u32/row; normal rows only.
const MELEE_ACTIONS: Readonly<Record<number, readonly number[]>> = {
  1: [5, 6, 7, 16, 17],
  2: [10, 13, 14, 19, 20],
  3: [9, 11],
  4: [9, 19],
  5: [9, 10, 11, 16, 17],
  6: [6],
  7: [16, 17],
};
// PE VA 005B2294: seven groups, two rows/group, four u32/row.
const SHOOT_ACTIONS: Readonly<Record<number, readonly number[]>> = {
  3: [22],
  4: [23],
  7: [24, 25, 26],
};
// PE 005B2374: 14 rows, 3 dwords/row. Only normal rows of groups1/6 are nonzero.
const MAGIC_ACTIONS: Readonly<Record<number, readonly number[]>>={1:[28,29],6:[28,29]};
export interface BasicAttackAction {
  action: number;
  stance: string;
  /** Already scaled per-frame with integer division by 8 (508700). */
  delays: number[];
  /** Unscaled delays, so a relayed buffed speed does not round an already rounded value. */
  baseDelays: number[];
  /** Numeric WZ frame keys, not a guessed 0..N loop. */
  frameIndices?: number[];
  /** Native left-facing Afterimage/0 hit rectangle, when the archive supplies it. */
  bounds?: { left: number; top: number; right: number; bottom: number };
  /** Legacy response slot, kept empty. Use the release-clock afterimage sequence below. */
  effects: Record<string, SpriteFrame[]>;
  /** Independent release-clock layer, NOT keyed to body frame; legacy effects is metadata only. */
  afterimage?:SpriteFrame[];
  afterimages?:Record<string,SpriteFrame[]>;
  afterimageBounds?:Record<string,NonNullable<BasicAttackAction['bounds']>>;
}
export interface BasicAttackProfile {
  weaponId: number;
  afterimageTier?:number;
  masteryLevels?:Record<string,number[]>;
  hitEffects?:Record<string,SpriteFrame[]>;
  group: number;
  speed: number;
  /** Unclamped WZ value: 4BE8B0 subtracts booster/Double Stab BEFORE the 0..6 clamp. */
  baseSpeed?:number;
  /** WZ info/sfx, loaded with the profile so a cold item tooltip cannot mute the first swing. */
  sfx?: string;
  melee: BasicAttackAction[];
  shoot: BasicAttackAction[];
  /** 428040 normal rows; optional only for historical fixture profiles. */
  magic?:BasicAttackAction[];
  /** 512F90 action32: never a member of the standing random melee table. */
  prone?: BasicAttackAction;
}
/** Native local input/512F90 contract, enforced here as an archive-backed SERVER policy.
 * action32 is an attack id, movement10/11 is prone; neither is a skill opcode.
 */
export function basicAttackPostureAllows(action: number, shoot: boolean, movement: number): boolean {
  const state = movement & ~1;
  if (state === 14 || state === 16 || state === 18) return false;
  return state === 10 ? !shoot && action === 32 : action !== 32;
}
/** Supported LIVE attack contract. Original server validation is unavailable; reject unsupported
 * skills in their dedicated paths, and do not let unknown actions skip timing/ammo checks here.
 */
export function validatedBasicAttack(
  profile: BasicAttackProfile | undefined, attack: ClientAttack, shoot: boolean, movement: number, booster=0,
): BasicAttackAction | undefined {
  if (!profile || attack.skillId !== 0 || attack.hits !== 1 || attack.targets.length > 1 ||
      attack.targetCount !== attack.targets.length || attack.speed !== activeSkillSpeed(profile.baseSpeed??profile.speed,0,booster) ||
      attack.targets.some(target => target.damages.length !== 1 || target.damages.some(
        damage => !Number.isInteger(damage) || damage < 0 || damage > 9999)) || // 4C7960 output domain.
      !basicAttackPostureAllows(attack.action, shoot, movement)) return undefined;
  const action=basicAttackAction(profile,attack.action,shoot);
  return action?(attack.speed===profile.speed?action:{...action,delays:scaledAttackDelays(action.baseDelays,attack.speed)}):undefined;
}
/** 513C80: far endpoint is character X +/- (200 + learned WZ range), NOT near+200.
 * 4BC590/listing4BD3C1 stores range at level+76 == 120*level-44. No current-job filter.
 */
export function basicShotRange(character: CharacterData, skills?: SkillCatalog): number {
  const family = Math.trunc((character.items?.worn.get(11)?.itemId ?? 0) / 10000);
  const skill = family === 145 || family === 146 ? 3000002 : family === 147 ? 4000001 : 0;
  return 200 + (skill ? Math.trunc(skillValues(character, skills, skill).range ?? 0) : 0);
}
export type BasicAttackProvider = (
  weaponId: number,
) => BasicAttackProfile | undefined;

export function basicAttackProvider(reader: ArtReader): BasicAttackProvider {
  const cache = new Map<number, BasicAttackProfile | undefined>();
  return (weaponId) => {
    if (cache.has(weaponId)) return cache.get(weaponId);
    if (
      !Number.isInteger(weaponId) ||
      weaponId < 1300000 ||
      weaponId >= 1500000
    )
      return undefined;
    const weapon = `Character/Weapon/${String(weaponId).padStart(8, "0")}.img`;
    const info = nodeRecord(reader.node(`${weapon}/info`));
    const group = typeof info.attack === "number" ? info.attack : 0;
    // The native weapon loader defaults missing attackSpeed to 3, then 4BE8B0 clamps 0..6.
    const speed = Math.max(
      0,
      Math.min(
        6,
        typeof info.attackSpeed === "number" ? Math.trunc(info.attackSpeed) : 3,
      ),
    );
    const actionsOf = (ids: readonly number[], magic=false): BasicAttackAction[] =>
      ids.flatMap((action) => {
        const stance = BASIC_ATTACK_STANCES[action];
        if (!stance || !reader.node(`${weapon}/${stance}`)) return [];
        const body = `Character/00002000.img/${stance}`;
        const frames = frameNames(reader.node(body));
        const delays = frames.map(
          (frame) => nativeBodyFrameDelay(nodeRecord(reader.node(`${body}/${frame}`)).delay),
        );
        if (frames.length === 0) return [];
        const effect =
          !magic && typeof info.afterImage === "string"
            ? `Character/Afterimage/${info.afterImage}.img/0/${stance}`
            : undefined;
        const boundsNode: Record<string, unknown> =
          effect === undefined ? {} : nodeRecord(reader.node(effect));
        const lt = vectorOf(boundsNode.lt),
          rb = vectorOf(boundsNode.rb);
        const effects: Record<string, SpriteFrame[]> = {};
        const afterimages:Record<string,SpriteFrame[]>={},afterimageBounds:Record<string,NonNullable<BasicAttackAction['bounds']>>={};
        if(effect!==undefined){
          const image=`Character/Afterimage/${info.afterImage}.img`;
          for(const tier of frameNames(reader.node(image))){
            const path=`${image}/${tier}/${stance}`,node=reader.node(path),props=nodeRecord(node);
            const a=vectorOf(props.lt),b=vectorOf(props.rb);
            if(a&&b)afterimageBounds[tier]={left:a[0],top:a[1],right:b[0],bottom:b[1]};
            // 40A5E0 enumerates until the FIRST property child; its numeric canvases form ONE sequence.
            const child=node?.kind==='props'?node.props.find(entry=>reader.node(`${path}/${entry.name}`)?.kind==='props'):undefined;
            afterimages[tier]=child?nativeAfterimageFrames(spriteFrames(reader,path,child.name,[],30)):[];
          }
        }
        return [
          {
            action,
            ...(!magic?{afterimages,afterimageBounds,afterimage:afterimages[0]??[]}:{}),
            stance,
            frameIndices: frames.map(Number),
            baseDelays: delays,
            delays: scaledAttackDelays(delays, speed),
            ...(lt && rb
              ? {
                  bounds: {
                    left: lt[0],
                    top: lt[1],
                    right: rb[0],
                    bottom: rb[1],
                  },
                }
              : {}),
            effects,
          },
        ];
      });
    const profile =
      MELEE_ACTIONS[group] === undefined
        ? undefined
        : {
            weaponId,
            group,
            masteryLevels:Object.fromEntries([...new Set([...weaponMasterySkills(weaponId),...weaponMasterySkills(weaponId,true)])].map(id=>{
              const levels=`Skill/${Math.trunc(id/10000)}.img/skill/${id}/level`;
              // Level keys start at1, unlike canvas sequences. Keep explicit zero (unlearned).
              const rows=nodeRecord(reader.node(levels)),max=Math.max(0,...Object.keys(rows).filter(k=>/^\d+$/.test(k)).map(Number));
              return [id,Array.from({length:max+1},(_,level)=>Number(nodeRecord(reader.node(`${levels}/${level}`)).mastery??0))];
            })),
            hitEffects:Object.fromEntries(['sword1','sword2','swordF','mace1','mace2','maceF'].map(key=>[key,spriteFrames(reader,'Character/Afterimage/hit.img',key,[],120)])),
            speed,
            baseSpeed:typeof info.attackSpeed==='number'?Math.trunc(info.attackSpeed):3,
            ...(typeof info.sfx === "string" ? { sfx: info.sfx } : {}),
            melee: actionsOf(MELEE_ACTIONS[group]!),
            shoot: actionsOf(SHOOT_ACTIONS[group] ?? []),
            magic: actionsOf(MAGIC_ACTIONS[group] ?? [],true),
            prone: actionsOf([32])[0],
          };
    // Resource bound, not an original gameplay limit; all parsing is synchronous here.
    if (cache.size >= PROFILE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(weaponId, profile);
    return profile;
  };
}

export function isCompatibleAmmo(weaponId: number, itemId: number): boolean {
  switch (Math.trunc(weaponId / 10000)) {
    case 145:
      return Math.trunc(itemId / 1000) === 2060;
    case 146:
      return Math.trunc(itemId / 1000) === 2061;
    case 147:
      return Math.trunc(itemId / 10000) === 207;
    default:
      return false;
  }
}
/** USE slots in numeric order, not Map insertion order; skip zero-charge stars. */
export function firstBasicAmmo(
  items: CharacterItems | undefined, required=1,
): { slot: number; itemId: number } | undefined {
  if(!Number.isInteger(required)||required<1||required>15)return undefined;
  const weaponId = items?.worn.get(11)?.itemId ?? 0;
  const inventory = items?.inventories[INVENTORY_TAB.consume - 1];
  if (!inventory) return undefined;
  for (let slot = 1; slot <= inventory.capacity; slot++) {
    const item = inventory.items.get(slot);
    if (
      item?.kind === "nonequip" &&
      item.quantity >= required &&
      isCompatibleAmmo(weaponId, item.itemId)
    )
      return { slot, itemId: item.itemId };
  }
  return undefined;
}
/** Prepare without mutation so resource, inventory and wire encoding can commit atomically.
 * Keep pre-debit itemId for the relay even when the last arrow clears. */
export function planBasicAmmo(items:CharacterItems,slot:number,count=1) {
  const selected=firstBasicAmmo(items,count);
  if(!selected||selected.slot!==slot)return;
  const inventory=items.inventories[INVENTORY_TAB.consume-1]!,item=inventory.items.get(slot);
  if(item?.kind!=='nonequip')return;
  const quantity=item.quantity-count,clear=quantity===0&&Math.trunc(item.itemId/10000)!==207;
  const change:InventoryChange=clear
    ?{op:INVENTORY_OP.clear,inventory:INVENTORY_TAB.consume,slot}
    :{op:INVENTORY_OP.put,inventory:INVENTORY_TAB.consume,slot,item:{...item,quantity}};
  return {itemId:selected.itemId,change,apply(){
    if(clear)inventory.items.delete(slot);else inventory.items.set(slot,{...item,quantity});
  }};
}
export function spendBasicAmmo(items:CharacterItems,slot:number,count=1):{itemId:number;change:InventoryChange}|undefined {
  const plan=planBasicAmmo(items,slot,count);if(!plan)return;
  plan.apply();return {itemId:plan.itemId,change:plan.change};
}

/** 41BC80 loads the item's own bullet canvases; 207 icons are not projectiles. */
export function basicProjectileFrames(
  reader: ArtReader,
  itemId: number,
): SpriteFrame[] {
  if (![206, 207].includes(Math.trunc(itemId / 10000))) return [];
  const padded = String(itemId).padStart(8, "0");
  return spriteFrames(
    reader,
    `Item/Consume/${padded.slice(0, 4)}.img/${padded}`,
    "bullet",
    [],
  );
}
