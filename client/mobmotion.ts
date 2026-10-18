import type { PhysicalBounds } from "./native-terrain.ts";
export interface MobAirPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  foothold: number;
  action: number;
  duration: number;
}
export interface MobAirStart {
  x: number;
  y: number;
  foothold: number;
  facing: number;
  vx?: number;
  vy?: number;
}
export interface MobAirOptions {
  direction: -1 | 0 | 1;
  speedPxPerSecond: number;
  launch: boolean;
  horizonMs?: number;
  physicalBounds?: PhysicalBounds;
}
/** Ordinary jumping-mob trajectory; the server owns this path, the browser only samples it.
 * 48D080: ability comes from root fly/jump/move subtrees, NOT an info.jump stat.
 * 5378D0: -555 with default shoe.jump=1/mass=100; 53D3F0: <=30ms subdivision.
 * Shared directed floor/wall/ceiling geometry avoids a separate fake sine wave or renderer-only hop.
 * No water/flying/aggro/skill or custom field/shoe physics is claimed here.
 */
import {
  collisionWorld,
  createPlayer,
  advanceMob,
  stepMovementRecords,
  PHYSICS,
} from "./motion.ts";

export function planMobAirPath(
  start: MobAirStart,
  footholds: readonly {
    id: number;
    x1: number;
    x2: number;
    y1: number;
    y2: number;
    prev: number;
    next: number;
    layer?: number;
    group?: number;
  }[],
  options: MobAirOptions,
): MobAirPoint[] {
  const world = collisionWorld({ footholds, ladders: [], physicalBounds: options.physicalBounds });
  const body = createPlayer(start.x, start.y, world, start.foothold, options.launch, false);
  body.vx = start.vx ?? 0;
  body.vy = start.vy ?? 0;
  if (options.launch && !body.grounded) return [];
  const points: MobAirPoint[] = [];
  const facing = start.facing & 1;
  const groundAction = ((options.direction ? 0 : 1) << 1) | facing;
  const jumpAction = (2 << 1) | facing; // mob jump=2, NOT the user's movement action 6.
  const horizon = Math.max(
    30,
    Math.min(3000, Math.trunc(Number.isFinite(options.horizonMs) ? options.horizonMs! : 900)),
  );
  for (let elapsed = 0; elapsed < horizon;) {
    const duration = Math.min(30, horizon - elapsed);
    advanceMob(
      body,
      {
        horizontal: options.direction,
        jump: options.launch && elapsed === 0,
        speedPercent: (options.speedPxPerSecond * 100) / PHYSICS.walkSpeed,
      },
      world,
      duration,
    );
    elapsed += duration;
    // Use the same integer TOI/contact nodes as player publication, not a synthetic landing
    // postponed to the end of this 30ms interval. Ordinary mob action ids remain independent.
    const records = stepMovementRecords(body, duration).map((point) => ({
      x: point.x,
      y: point.y,
      vx: point.vx,
      vy: point.vy,
      foothold: point.foothold,
      action: point.foothold ? groundAction : jumpAction,
      duration: point.duration,
    }));
    // The native path count byte supports 255; reserve its terminal node before appending.
    if (points.length + records.length + 1 > 255) break;
    points.push(...records);
    if (body.grounded) {
      if (points.at(-1)!.duration) points.push({ ...points.at(-1)!, duration: 0 });
      break;
    }
  }
  return points;
}

/** Selected from the wire action, never inferred solely from a nonzero position delta. */
export function mobLocomotion(
  mob: { action?: number },
  actions: Record<string, readonly unknown[]>,
): string {
  const action = (mob.action ?? 2) >> 1;
  if (action === 2 && actions.jump?.length) return "jump";
  if (actions.fly?.length) return "fly";
  if (action === 0 && actions.move?.length) return "move";
  return actions.stand?.length ? "stand" : "move";
}
