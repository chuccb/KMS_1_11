import type {BasicAttackProfile,BasicAttackAction} from '../server/src/game/basicattack.ts';
export interface ActiveSkill {kind:'buff'|'melee';party?:boolean}
export const ACTIVE_SKILLS:Readonly<Record<number,ActiveSkill>>;
export function activeSkill(id:number):ActiveSkill|undefined;
export function activeSkillSpeed(speed:number,id:number):number;
export function activeMeleeActions(profile:BasicAttackProfile|undefined,id:number):BasicAttackAction[];
export function activeSkillHits(values:Record<string,number>):number;
export function activeSkillCost(stats:{hp:number;mp:number},values:Record<string,number>):{hp:number;mp:number}|undefined;
export function activeMeleeBounds(bounds:BasicAttackAction['bounds'],range:number,facingLeft:boolean,hasNearTarget:boolean):BasicAttackAction['bounds'];
