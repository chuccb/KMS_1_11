export interface SoundSettings { bgm:number; effects:number; bgmMuted:boolean; effectsMuted:boolean }
export const SOUND_DEFAULTS: Readonly<SoundSettings>;
export function soundSettings(value:unknown):SoundSettings;
export function nativeVolume(step:number, muted?:boolean):number;
export function sliderCenter(step:number, width?:number, count?:number):number;
export function sliderStep(x:number, width?:number, count?:number):number;
export function soundProfile(storage: {getItem(key:string):string|null;setItem(key:string,value:string):void}|undefined):{
  values():SoundSettings;
  save(value:unknown):SoundSettings;
};
