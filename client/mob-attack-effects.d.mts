import type {SpriteFrame,MobAttackArt} from '../server/src/game/sprites.ts';
import type {ContactPoint} from './contact.mjs';
export interface MobEffectActor extends ContactPoint {id:number;facing:number;previous?:ContactPoint}
export interface MobEffectLayer extends ContactPoint {kind:'effect'|'hit';frames:SpriteFrame[];start:number;flip:boolean;actorId?:number;owner?:string}
export interface MobBallLayer extends ContactPoint {id:number;owner:string;frames:SpriteFrame[];start:number}
export function mobAttackEffects(options:{metadata:(id:number)=>{attacks?:MobAttackArt[]}|undefined;emit:(effect:MobEffectLayer)=>void}):{
 clear():void;remove(owner:string):void;
 put(owner:string,templateId:number,action:number,facing:number,value:number,origin:ContactPoint,start:number):void;
 step(now:number,owners:ReadonlyMap<string,ContactPoint>,actors:readonly MobEffectActor[]):MobBallLayer[];
 readonly size:number;
};
