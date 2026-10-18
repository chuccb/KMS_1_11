import type {BasicAttackProfile} from '../server/src/game/basicattack.ts';
import type {SpriteFrame} from '../server/src/game/sprites.ts';
export interface Rect {left:number;right:number;top:number;bottom:number}
export interface Point {x:number;y:number}
export const ATTACK_EFFECT_Z:250310;
export function weaponMasterySkills(weapon:number,shoot?:boolean):number[];
export function attackMasteryTier(profile:BasicAttackProfile,levelOf:(id:number)=>number,shoot?:boolean):number;
export function attackProfileAtTier(profile:BasicAttackProfile|undefined,tier?:number):BasicAttackProfile|undefined;
export function nativeAfterimageFrames(frames:SpriteFrame[]):SpriteFrame[];
export function attackWorldRect(source:Point,bounds:Rect|undefined,facingLeft:boolean):Rect|undefined;
export function attackHitPoint(attack:Rect|undefined,rect:Rect|undefined):Point|undefined;
export function impactPosition(offset:Point|undefined,mob:Point,rect:Rect|undefined):Point|undefined;
export function weaponHitKeys(weaponId:number,action:number):string[];
