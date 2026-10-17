export const HUD_FONT: string;
export const STATUS_GAUGES: Readonly<Record<'hp' | 'mp' | 'exp', { x:number; y:number; w:number; h:number }>>;
export function gaugeFill(width:number, value:number, max:number): number;
export function expPercent(value:number, max:number): number;
export function mapTitleLayout(streetWidth:number, mapWidth:number, hasMark:boolean): {
  x:number; y:number; width:number; height:number; streetX:number; mapX:number; markX:number;
};
export function drawMapTitle(ctx:unknown, image:unknown, title:unknown): void;
export function drawItemCount(ctx:unknown, image:unknown, value:number, x:number, y:number): void;
export function statusVitalText(x:number, y:number,
  self:{hp:number; mp:number; exp:number; expToNext?:number}, totals:{maxHp:number; maxMp:number}): string | undefined;
