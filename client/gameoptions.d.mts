export interface GameSettings {minimap:boolean;whisper:boolean;messenger:boolean;exchange:boolean;party:boolean;game:boolean;}
export const GAME_DEFAULTS:Readonly<GameSettings>;
export function gameSettings(value:unknown):GameSettings;
export function gameProfile(storage?:{getItem(key:string):string|null;setItem(key:string,value:string):void}):{
  values():GameSettings;save(value:unknown):GameSettings;
};
