export const QUICK_SLOTS: readonly { key:string; x:number; y:number }[];
export interface QuickItem { itemId:number; slot:number; quantity?:number }
export interface QuickInventory { tabs: { tab:number; items:QuickItem[] }[] }
export interface QuickSkillBinding {kind:'skill';skillId:number}
/** Numeric bindings remain legacy consumables; skill IDs can overlap and must be tagged. */
export type QuickBinding=number|QuickSkillBinding|null;
export function quickSlotAt(x:number, y:number): number;
export function quickItemAllowed(id:unknown): boolean;
export function quickSkillAllowed(value:unknown):value is QuickSkillBinding;
export function bindQuickItem(bindings:readonly QuickBinding[], index:number, itemId:Exclude<QuickBinding,null>): QuickBinding[] | undefined;
export function moveQuickItem(bindings:readonly QuickBinding[], from:number, to:number, expected?:QuickBinding): QuickBinding[] | undefined;
export function clearQuickItem(bindings:readonly QuickBinding[], index:number, expected?:QuickBinding): QuickBinding[] | undefined;
export function quickItemState(inventory:QuickInventory | undefined, itemId:number): {quantity:number; item:QuickItem | undefined};
export interface QuickStorage { getItem(key:string):string | null; setItem(key:string, value:string):void }
export function quickItemProfile(storage:QuickStorage | undefined, owner:string): {
  values(): QuickBinding[];
  bind(index:number, itemId:Exclude<QuickBinding,null>): boolean;
  move(from:number, to:number, expected?:QuickBinding): boolean;
  clear(index:number, expected?:QuickBinding): boolean;
};
