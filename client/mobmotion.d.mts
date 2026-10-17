export interface MobAirPoint {
  x: number; y: number; vx: number; vy: number; foothold: number; action: number; duration: number;
}
export interface MobAirStart {
  x: number; y: number; foothold: number; facing: number; vx?: number; vy?: number;
}
export interface MobAirOptions {
  direction: -1 | 0 | 1; speedPxPerSecond: number; launch: boolean; horizonMs?: number;
}
export function planMobAirPath(start: MobAirStart, footholds: readonly {
  id: number; x1: number; x2: number; y1: number; y2: number;
  prev: number; next: number; layer?: number; group?: number;
}[], options: MobAirOptions): MobAirPoint[];
export function mobLocomotion(mob: {action?: number}, actions: Record<string, readonly unknown[]>): string;
