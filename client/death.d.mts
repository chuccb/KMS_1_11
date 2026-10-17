import type { TimedCanvas } from "./animation.mjs";
export interface DeathCanvas extends TimedCanvas { path: string; ox?: number; oy?: number }
export interface DeathArt { fall: DeathCanvas[]; land: DeathCanvas[] }
export interface DeathState { x: number; y: number; since: number; settled: boolean }
export const DEATH_ORBIT_MS: number;
export const DEATH_FADE_MS: number;
export function deathState(x: number,y: number,now: number,settled?: boolean): DeathState;
export function deathPose(state: DeathState,now: number): {x:number;y:number;alpha:number};
export function tombPose(art:DeathArt|undefined,state:DeathState,now:number): {frame:DeathCanvas|undefined;x:number;y:number}|undefined;
export function deathEffects(deps:{
  image(path:string):unknown;
  log(text:string):unknown;
  sound(point:{x:number;y:number}):unknown;
  fetch?(url:string):Promise<{ok:boolean;status?:number;json():Promise<DeathArt>}>;
}): {
  preload(): Promise<void>;
  reset():void;
  remove(id:number):void;
  get(id:number):DeathState|undefined;
  observe(id:number,dead:boolean,point:{x:number;y:number}|undefined,now:number,settled?:boolean):void;
  tomb(id:number,now:number):{frame:DeathCanvas|undefined;x:number;y:number}|undefined;
};
