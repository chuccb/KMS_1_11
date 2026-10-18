import type { NormalizedSegment } from "./native-terrain.ts";
interface ReactionBody {
  x: number;
  y: number;
  foothold: number;
  speed: number;
  vx: number;
  vy: number;
}
import type { PhysicalBounds, TerrainSegment } from "./native-terrain.ts";
export interface ReactionTemplate {
  pushed?: number;
  hitActions?: number[];
  hitDurations?: Record<number, number>;
}
export interface MobReaction {
  duration: number;
  action: number;
  facing: number;
  velocity: number;
}
export interface ReactionPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  foothold: number;
  action: number;
  duration: number;
}
import { normalizeFootholds, physicalBounds, clipAir, segmentPosition } from "./native-terrain.ts";
/** 487A30 -> 4885D0 -> 53D3F0. Native reaction, separate from roaming/player knockback.
 * No gravity launch: ground velocity is tangent130, drag=40000/default mass100;
 * ground edges clamp, airborne ground mobs hold; flyers damp and clip field bounds (no shape sweep).
 * Field/controller authority and packet scheduling remain reconstruction policy. */
export const MOB_PUSH_SPEED: 130 = 130;
export const MOB_PUSH_DRAG: 400 = 400;
export const mobHitName = (action: number): "hit1" | "hit2" | "hitF" | undefined =>
  (({ 7: "hit1", 8: "hit2", 9: "hitF" }) as const)[action as 7 | 8 | 9];
export function mobHitAction(
  template: ReactionTemplate | undefined,
  rand: () => number = Math.random,
): number {
  const actions = template?.hitActions ?? [];
  return actions.length
    ? actions[Math.min(actions.length - 1, Math.floor(rand() * actions.length))]
    : -1;
}
export function mobReaction(
  template: ReactionTemplate | undefined,
  damage: number,
  hitAction: number,
  facingLeft: boolean,
  now: number,
  until: number = 0,
): MobReaction | undefined {
  const duration = template?.hitDurations?.[hitAction] ?? 0;
  if (
    !(damage > 0) ||
    damage < (template?.pushed ?? 1) ||
    now < until ||
    hitAction < 7 ||
    hitAction > 9 ||
    duration <= 0
  )
    return;
  return {
    duration,
    action: hitAction,
    facing: facingLeft ? 0 : 1,
    velocity: facingLeft ? -MOB_PUSH_SPEED : MOB_PUSH_SPEED,
  };
}
/** 53D3F0 is NOT ordinary 5376C0: at most one linked-floor transfer per update,
 * clamp to that neighbor's endpoint, never detach or manufacture reciprocal/contiguous links.
 * It also deliberately bypasses ordinary ground-field clipping and gravity.
 */
function groundStep(
  body: ReactionBody,
  distance: number,
  byId: ReadonlyMap<number, NormalizedSegment>,
) {
  let f = byId.get(body.foothold)!;
  let position = segmentPosition(f, body.x, body.y) + distance;
  if (position < 0 || position > f.length) {
    const right = position > f.length,
      other = byId.get(right ? f.next : f.prev);
    if (!other || other.cos <= 0) {
      position = right ? f.length : 0;
      body.speed = 0;
    } else {
      position = right
        ? Math.min(position - f.length, other.length)
        : Math.max(position + other.length, 0);
      f = other;
      body.foothold = f.id;
    }
  }
  body.x = f.x1 + f.cos * position;
  body.y = f.y1 + f.sin * position;
  body.vx = f.cos * body.speed;
  body.vy = f.sin * body.speed;
}
export function planMobReactionPath(
  start: { x: number; y: number; foothold: number },
  footholds: readonly TerrainSegment[],
  reaction: MobReaction,
  ability: number = 1,
  bounds: PhysicalBounds | undefined = physicalBounds(footholds),
): ReactionPoint[] {
  const byId = new Map(normalizeFootholds(footholds).map((f) => [f.id, f]));
  const body = {
    x: start.x,
    y: start.y,
    foothold: start.foothold,
    speed: reaction.duration >= 90 ? reaction.velocity : 0,
    vx: 0,
    vy: 0,
  };
  const points = [],
    facing = reaction.facing & 1;
  for (let elapsed = 0; elapsed < reaction.duration;) {
    const duration = Math.min(30, reaction.duration - elapsed),
      dt = duration / 1000;
    const before = body.speed;
    if (ability !== 0) {
      body.speed = Math.sign(before) * Math.max(0, Math.abs(before) - MOB_PUSH_DRAG * dt);
      const distance = (before + body.speed) * 0.5 * dt;
      const ground = byId.get(body.foothold);
      if (ground && ground.x2 > ground.x1) {
        groundStep(body, distance, byId);
      } else if (ability === 3) {
        // 53D3F0 calls 539B10 with time=0; its clipped position/velocity matter, not the returned time.
        // It does not call 5389B0: an arbitrary wall sweep here was not native flyer-KB behavior.
        const old = { x: body.x, y: body.y };
        body.x += distance;
        body.vx = body.speed;
        body.vy = 0;
        clipAir(body, old, 0, bounds);
        body.speed = body.vx;
      } else {
        body.vx = body.speed;
        body.vy = 0;
      }
    }
    elapsed += duration;
    points.push({
      x: Math.trunc(body.x),
      y: Math.trunc(body.y),
      vx: Math.trunc(body.vx),
      vy: Math.trunc(body.vy),
      foothold: body.foothold,
      action: ((body.foothold ? 1 : ability === 3 ? 3 : 2) << 1) | facing,
      duration,
    });
  }
  return points;
}
/** Mob and NPC animation advance one frame per 30ms update and discard overshoot (4862C0). */
export function nativeMobActions<T extends { delay: number; rawDelay?: number }>(
  actions: Record<string, T[]>,
): Record<string, (T & { rawDelay: number })[]> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, frames]) => [
      name,
      frames.map((f) => ({
        ...f,
        rawDelay: f.rawDelay ?? f.delay,
        delay: Math.max(30, Math.ceil(f.delay / 30) * 30),
      })),
    ]),
  );
}
export function mobHitPose<T extends { delay: number; rawDelay?: number }>(
  actions: Record<string, T[]> | undefined,
  hit: { action: number; since: number; facing: number } | undefined,
  now: number,
): { frames: T[]; elapsed: number; facing: number } | undefined {
  if (!hit) return;
  const name = mobHitName(hit.action);
  const frames = name ? actions?.[name] : undefined,
    elapsed = now - hit.since;
  if (!frames?.length || elapsed < 0 || elapsed >= frames.reduce((n, f) => n + f.delay, 0)) return;
  return { frames, elapsed, facing: hit.facing };
}
