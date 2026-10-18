import type {SpriteFrame,MobAttackArt} from '../server/src/game/sprites.ts';
import type {ContactPoint,NativeRect} from './contact.mjs';
export const MOB_BODY_ACTIONS:string[];
export const mobDieNames:string[];
export function mobDieAction(actions:Record<string,SpriteFrame[]>|undefined,random?:()=>number):string|undefined;
export function mobAttackName(action:number):'attack1'|'attack2'|'attackF'|undefined;
export function mobForcedName(action:number):'hit1'|'hit2'|'hitF'|'attack1'|'attack2'|'attackF'|undefined;
export function mobForcedActive(actions:Record<string,{delay:number}[]>|undefined,forced:{action:number;since:number;duration?:number}|undefined,now:number):boolean;
export function replaceMobForced(current:number,next:number):boolean;
export function mobForcedPose<T extends {delay:number}>(actions:Record<string,T[]>|undefined,forced:{action:number;since:number;facing:number}|undefined,now:number):{frames:T[];elapsed:number;facing:number}|undefined;
export function mobAttackRect(attack:MobAttackArt,source:ContactPoint,facing:number):NativeRect|undefined;
export function mobAttackRay(origin:ContactPoint,end:number,target:NativeRect):boolean;
export function packMobAim(point:ContactPoint):number;
export function unpackMobAim(value:number):ContactPoint;
export function chooseMobAttack(attacks:MobAttackArt[]|undefined,source:ContactPoint&{facing:number},target:ContactPoint&{characterId:number},mp:number,random?:()=>number):{attack:MobAttackArt;facing:number;value:number}|undefined;
export interface MobBall {origin:ContactPoint;end:ContactPoint;start:number;endAt:number;curved:boolean;frames:SpriteFrame[]}
export function planMobBall(attack:MobAttackArt,source:ContactPoint,facing:number,value:number,start:number):MobBall|undefined;
export function mobBallPoint(ball:MobBall,now:number):ContactPoint|undefined;
export function mobAttackHitsRect(point:ContactPoint,rect:NativeRect):boolean;
