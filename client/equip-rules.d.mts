import type {StatInput,StatItem,StatRequirements} from './characterstats.mjs';
export interface EquipCandidate {itemId:number;cash?:unknown}
export interface EquipInventory {
  worn: {slot:number;itemId:number}[];
  tabs:{tab:number;capacity:number;items:{slot:number}[]}[];
}
export function bodyPart(id:number):number;
export function equipConflict(id:number,worn?:{slot:number;itemId:number}[]):number;
export function firstBagSlot(inventory:EquipInventory|undefined,tab:number):number;
export function canWear(item:EquipCandidate,facts:{cash?:boolean;requirements?:StatRequirements}|undefined,
  self:(StatInput&{hp:number})|undefined,inventory:EquipInventory|undefined,part?:number,wornFacts?:StatItem[]):string|undefined;
