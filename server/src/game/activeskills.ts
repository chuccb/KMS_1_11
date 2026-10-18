/** Archive-backed active rules. The original server is unavailable: admission/atomicity are policy. */
import {activeSkill,activeSkillCost,activeMeleeActions,activeSkillSpeed,activeSkillHits,activeSkillAmmo,activeRangedActions,activeMagicActions,activeMagicSpeed} from '../../../client/active-skills.mjs';
import {scaledAttackDelays} from '../../../client/attack-timing.mjs';
import type {CharacterData} from '../protocol/chardata.ts';
import type {ClientAttack} from '../protocol/field.ts';
import type {TemporaryStatUpdate,TemporaryStatName} from '../protocol/temporarystat.ts';
import type {SkillCatalog} from './skills.ts';
import {learnedSkillLevel} from './skills.ts';
import {firstBasicAmmo,basicAttackPostureAllows,type BasicAttackProfile,type BasicAttackAction} from './basicattack.ts';
import {spriteFrames,type SpriteFrame} from './sprites.ts';
import {nodeRecord,type ArtReader} from './wzart.ts';
export function learnedActive(character:CharacterData,catalog:SkillCatalog|undefined,id:number) {
  const rule=activeSkill(id),info=catalog?.info(id);
  if(!rule||!info)return undefined;
  const level=Math.min(info.maxLevel,learnedSkillLevel(character.items?.map32,id));
  const values=info.levels.find(row=>row.level===level)?.values;
  if(level<=0||!values||values.itemCon||values.itemConNo)return undefined;
  const cost=activeSkillCost(character.stats,values);
  return cost?{rule,info,level,values,cost}:undefined;
}
export function activeTemporary(id:number,values:Record<string,number>):TemporaryStatUpdate|undefined {
  const durationMs=(values.time??0)*1000; // Unlike Consume/spec/time, Skill/level/time is SECONDS.
  if(!Number.isInteger(durationMs)||durationMs<=0||durationMs>0x7fffffff)return undefined;
  const stats:TemporaryStatUpdate['values']={};
  for(const key of ['pad','pdd','mad','mdd','acc','eva','hands','speed','jump'] as TemporaryStatName[])
    if(values[key]!==undefined) stats[key]=values[key];
  return Object.keys(stats).length?{durationMs,values:stats,sourceId:id,sourceIsSkill:true}:undefined;
}
export function validatedActiveMelee(character:CharacterData,catalog:SkillCatalog|undefined,profile:BasicAttackProfile|undefined,
  attack:ClientAttack,movement:number,booster=0):{motion:BasicAttackAction;learned:NonNullable<ReturnType<typeof learnedActive>>}|undefined {
  const learned=learnedActive(character,catalog,attack.skillId);
  if(!learned||learned.rule.kind!=='melee'||!profile||!basicAttackPostureAllows(attack.action,false,movement)||
    attack.action===32||attack.speed!==activeSkillSpeed(profile.baseSpeed??profile.speed,attack.skillId,booster)||
    attack.hits!==activeSkillHits(learned.values)||attack.targetCount!==attack.targets.length||
    attack.targets.length>(learned.values.range?6:1)||new Set(attack.targets.map(t=>t.mobId)).size!==attack.targets.length||
    attack.targets.some(t=>t.damages.length!==attack.hits||t.damages.some(d=>!Number.isInteger(d)||d<0||d>9999)))return undefined;
  const action=activeMeleeActions(profile,attack.skillId).find(a=>a.action===attack.action);
  return action?{learned,motion:{...action,delays:scaledAttackDelays(action.baseDelays,attack.speed)}}:undefined;
}
/** 519380/513C80. The basic attack contract remains strict; no magic/unknown ID bypass. */
export function validatedActiveRanged(character:CharacterData,catalog:SkillCatalog|undefined,
  profile:BasicAttackProfile|undefined,attack:ClientAttack,movement:number,booster=0) {
  const learned=learnedActive(character,catalog,attack.skillId);
  if(!learned||learned.rule.kind!=='ranged'||!profile||attack.speed!==activeSkillSpeed(profile.baseSpeed??profile.speed,attack.skillId,booster)||
    !basicAttackPostureAllows(attack.action,true,movement)||attack.targetCount!==attack.targets.length||
    attack.targets.length>1||attack.hits!==activeSkillHits(learned.values,true)||
    attack.targets.some(target=>target.damages.length!==attack.hits||target.damages.some(d=>!Number.isInteger(d)||d<0||d>9999)))return;
  const action=activeRangedActions(profile,attack.skillId).find(a=>a.action===attack.action);
  const ammo=firstBasicAmmo(character.items,activeSkillAmmo(learned.values));
  if(!action||!ammo||attack.projectileSlot!==ammo.slot)return;
  return {learned,ammo,motion:{...action,delays:scaledAttackDelays(action.baseDelays,attack.speed)}};
}
/** 5195D0 -> 514D30. Prone fallback is ordinary melee, never a skill32 packet. */
export function validatedActiveMagic(character:CharacterData,catalog:SkillCatalog|undefined,
  profile:BasicAttackProfile|undefined,attack:ClientAttack,movement:number,foothold:number) {
  const learned=learnedActive(character,catalog,attack.skillId);
  if(!learned||learned.rule.kind!=='magic'||!profile||!Number.isInteger(foothold)||foothold<=0||attack.speed!==activeMagicSpeed(profile)||
    !basicAttackPostureAllows(attack.action,false,movement)||attack.action===32||
    attack.projectileSlot!==undefined||attack.targetCount!==attack.targets.length||attack.targets.length>1||
    attack.hits!==activeSkillHits(learned.values)||
    attack.targets.some(t=>t.damages.length!==attack.hits||t.damages.some(d=>!Number.isInteger(d)||d<0||d>9999)))return;
  const action=activeMagicActions(profile,attack.skillId,learned.info.skillType).find(a=>a.action===attack.action);
  return action?{learned,motion:{...action,delays:scaledAttackDelays(action.baseDelays,attack.speed)}}:undefined;
}
export interface ActiveArt {
  skillId:number;balls:SpriteFrame[];effects:SpriteFrame[];hits:SpriteFrame[];hitVariants:SpriteFrame[][];
  armorFlash:boolean;useSound?:string;
}
export function activeArt(reader:ArtReader,id:number,level:number):ActiveArt {
  const root=`Skill/${Math.trunc(id/10000)}.img/skill/${id}`;
  const levelProps=nodeRecord(reader.node(`${root}/level/${level}`));
  // 4BC590 stores a BUILT path, not the property contents as a path string.
  // The original literal is .../level/effect (no %d for the selected level).
  // 50D570 chooses it when the selected level's effect VARIANT is nonempty.
  const effectRoot=levelProps.effect!==undefined?`${root}/level`:root;
  const effects=spriteFrames(reader,effectRoot,'effect',[],120);
  const hitRoot=Object.keys(nodeRecord(reader.node(`${root}/level/${level}/hit`))).length
    ?`${root}/level/hit`:`${root}/hit`;
  // 4BA.../4BC590 creates one path per hit variant, 50D9F0 rand()%variantCount.
  // hit/0 and hit/1 are ANIMATIONS, not their first and second frames.
  const hitVariants=Object.keys(nodeRecord(reader.node(hitRoot)))
    .filter(key=>/^\d+$/.test(key)).sort((a,b)=>Number(a)-Number(b))
    .map(key=>spriteFrames(reader,hitRoot,key,[],120)).filter(frames=>frames.length);
  const ballRoot=levelProps.ball!==undefined?`${root}/level`:root;
  const balls=spriteFrames(reader,ballRoot,'ball',[],120); // 514BA0; only RANGED may fall back to ammo. Magic with no ball is instantaneous.
  const sound=`Skill/${String(id).padStart(7,'0')}/Use`;
  return {skillId:id,balls,effects,hits:hitVariants[0]??[],hitVariants,
    armorFlash:id===1001003||id===2001003,
    ...(reader.node(`Sound/Skill.img/${String(id).padStart(7,'0')}/Use`)?{useSound:sound}:{})};
}
