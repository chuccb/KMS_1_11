import type { BasicAttackProfile, BasicAttackAction } from "../server/src/game/basicattack.ts";
import type { SpriteFrame } from "../server/src/game/sprites.ts";
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface Point {
  x: number;
  y: number;
}
/** Original 4BE270 / 40A5E0 / 40EA70 / 485B80 / 487A30 / 50D7F0 presentation facts.
 * Inputs are archive metadata/captured RECTs; not a port of the swept CShape2D pool. */
export const ATTACK_EFFECT_Z: 250310 = 250310; // 41F8A0, relative to tile base -1073721834.
/**
 * `sub_513C80` (`.c:279602`) and `sub_514D30`: every attack line - a basic shot and a magic ball
 * alike - leaves the actor at `y - 25`. It is one number the two senders share, not a magic-only
 * height, which is why it sits here rather than beside `MAGIC_NEAR` / `MAGIC_RANGE`.
 */
export const ATTACK_ORIGIN_HEIGHT: 25 = 25;
/**
 * `sub_512F90` (`.c:278743` and `.c:278795-278801`) clips the near end of a shot:
 *
 * ```
 * *a4 = 65;                                     // the answer when there are no bounds at all
 * if ( left < -65 ) left = -65;                 // never nearer than 65px behind the actor
 * if ( left >= right - 1 ) left = right - 1;    // and never past the far edge
 * *a4 = -left;
 * ```
 */
export const SHOT_NEAR_CLIP: 65 = 65;
/** `sub_512F90`: how far in front of the actor a shot starts, in the actor's own units. */
export function shotNearDistance(bounds: Rect | undefined): number {
  const left = Math.min(
    Math.max(bounds?.left ?? -SHOT_NEAR_CLIP, -SHOT_NEAR_CLIP),
    (bounds?.right ?? 0) - 1,
  );
  return -left;
}
export function weaponMasterySkills(weapon: number, shoot: boolean = false): number[] {
  const type = weapon >= 1000000 ? Math.trunc(weapon / 10000) % 100 : weapon;
  const ids: Partial<Record<number, number[]>> = shoot
    ? { 45: [3100000], 46: [3200000], 47: [4100000] }
    : {
        30: [1100000, 1200000],
        40: [1100000, 1200000],
        31: [1100001],
        41: [1100001],
        32: [1200001],
        42: [1200001],
        33: [4200000],
        43: [1300000],
        44: [1300001],
      };
  return ids[type] ?? [];
}
export function attackMasteryTier(
  profile: BasicAttackProfile,
  levelOf: (id: number) => number,
  shoot: boolean = false,
): number {
  for (const id of weaponMasterySkills(profile.weaponId, shoot)) {
    const rows = profile.masteryLevels?.[id] ?? [],
      level = Math.min(Math.max(0, Math.trunc(levelOf(id))), rows.length - 1);
    const value = Math.max(0, Math.min(15, rows[level] ?? 0));
    if (value) return value;
  }
  return 0;
}
/** Missing native tier/action art stays absent, never silently replaced with tier0. */
export function attackProfileAtTier(
  profile: BasicAttackProfile | undefined,
  tier: number = 0,
): BasicAttackProfile | undefined {
  if (!profile) return;
  const select = (action: BasicAttackAction): BasicAttackAction =>
    action && {
      ...action,
      ...(action.afterimages ? { afterimage: action.afterimages[tier] ?? [] } : {}),
      ...(action.afterimageBounds ? { bounds: action.afterimageBounds[tier] } : {}),
    };
  return {
    ...profile,
    afterimageTier: tier,
    melee: profile.melee.map(select),
    shoot: profile.shoot.map(select),
    ...(profile.prone ? { prone: select(profile.prone) } : {}),
  };
}
/** 40EA70 discards WZ delay/alpha, resets alpha255, 30ms per frame, last200ms -> alpha0. */
export function nativeAfterimageFrames(frames: SpriteFrame[]): SpriteFrame[] {
  return frames.map((frame, i) => ({
    ...frame,
    delay: i === frames.length - 1 ? 200 : 30,
    a0: -1,
    a1: i === frames.length - 1 ? 0 : -1,
  }));
}
export function attackWorldRect(
  source: Point,
  bounds: Rect | undefined,
  facingLeft: boolean,
): Rect | undefined {
  if (!bounds) return;
  return {
    left: source.x + (facingLeft ? bounds.left : -bounds.right),
    right: source.x + (facingLeft ? bounds.right : -bounds.left),
    top: source.y + bounds.top,
    bottom: source.y + bounds.bottom,
  };
}
/** 485B80 extends a non-overlapping attack RECT just enough, then truncates the intersection centre. */
export function attackHitPoint(
  attack: Rect | undefined,
  rect: Rect | undefined,
): Point | undefined {
  if (!attack || !rect || rect.left >= rect.right || rect.top >= rect.bottom) return;
  let { left, right, top, bottom } = attack;
  if (left >= rect.right) left = rect.right - 1;
  else if (right <= rect.left) right = rect.left + 1;
  if (top >= rect.bottom) top = rect.bottom - 1;
  else if (bottom <= rect.top) bottom = rect.top + 1;
  return {
    x: Math.trunc((Math.max(left, rect.left) + Math.min(right, rect.right)) / 2),
    y: Math.trunc((Math.max(top, rect.top) + Math.min(bottom, rect.bottom)) / 2),
  };
}
/** 4882F0 stores relative offset. 487A30 clamps it at IMPACT, then creates an unparented world layer. */
export function impactPosition(
  offset: Point | undefined,
  mob: Point,
  rect: Rect | undefined,
): Point | undefined {
  if (!offset || !rect || rect.left >= rect.right || rect.top >= rect.bottom) return;
  return {
    x: Math.min(rect.right, Math.max(rect.left, mob.x + offset.x)),
    y: Math.min(rect.bottom, Math.max(rect.top, mob.y + offset.y)),
  };
}
/** 50D7F0: skill hit paths take precedence; only physical families have a default spark. */
export function weaponHitKeys(weaponId: number, action: number): string[] {
  const type = Math.trunc(weaponId / 10000) % 100;
  const family = [30, 31, 33, 40, 41, 43, 44].includes(type)
    ? "sword"
    : [32, 37, 38, 42, 45, 46, 47].includes(type)
      ? "mace"
      : undefined;
  if (!family) return [];
  return [8, 12, 15, 18, 21, 27, 30].includes(action)
    ? [`${family}F`]
    : [`${family}1`, `${family}2`];
}
