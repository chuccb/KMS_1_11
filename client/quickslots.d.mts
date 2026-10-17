export const QUICK_SLOTS: readonly { key:string; x:number; y:number }[];
export interface QuickItem { itemId:number; slot:number; quantity?:number }
export interface QuickInventory { tabs: { tab:number; items:QuickItem[] }[] }
export function quickSlotAt(x:number, y:number): number;
export function quickItemAllowed(id:unknown): boolean;
export function bindQuickItem(bindings:readonly (number | null)[], index:number, itemId:number): (number | null)[] | undefined;
export function quickItemState(inventory:QuickInventory | undefined, itemId:number): {quantity:number; item:QuickItem | undefined};
export interface QuickStorage { getItem(key:string):string | null; setItem(key:string, value:string):void }
export function quickItemProfile(storage:QuickStorage | undefined, owner:string): {
  values(): (number | null)[];
  bind(index:number, itemId:number): boolean;
};
