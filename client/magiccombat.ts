import type { ContactPoint, NativeRect } from "./contact.ts";
import { ATTACK_ORIGIN_HEIGHT } from "./attack-presentation.ts";
import type { FootholdSegment } from "../server/src/wz/archive.ts";
/** 514D30 / 491F20: X +/-50..300, Y-25; 20px slices, half-height=distance/4.
 * Selection uses caller-supplied mob RECTs. Browser frames/server snapshot tolerance are policy;
 * this is not a substitute for native swept CShape2D or its ZList insertion order. */
export const MAGIC_NEAR: 50 = 50,
  MAGIC_RANGE: 300 = 300;
/** `ATTACK_ORIGIN_HEIGHT`: the same `y - 25` the basic shot starts from, not a magic-only figure. */
export const MAGIC_HEIGHT: 25 = ATTACK_ORIGIN_HEIGHT;
export function magicSearchRects(source: ContactPoint, facingLeft: boolean): NativeRect[] {
  const direction = facingLeft ? -1 : 1,
    rects = [];
  for (let distance = MAGIC_NEAR; distance < MAGIC_RANGE; distance += 20) {
    const x0 = source.x + direction * distance,
      x1 = source.x + direction * Math.min(distance + 20, MAGIC_RANGE);
    const half = Math.trunc(distance / 4),
      y = source.y - MAGIC_HEIGHT;
    rects.push({
      left: Math.min(x0, x1),
      right: Math.max(x0, x1),
      top: y - half,
      bottom: y + half,
    });
  }
  return rects;
}
/** 485B80 expands the thin ray to overlap the target, then uses the intersection centre. */
export function magicHitPoint(
  source: ContactPoint,
  facingLeft: boolean,
  rect: NativeRect,
): ContactPoint {
  const xs = [
    source.x + (facingLeft ? -MAGIC_NEAR : MAGIC_NEAR),
    source.x + (facingLeft ? -MAGIC_RANGE : MAGIC_RANGE),
  ];
  let left = Math.min(...xs),
    right = Math.max(...xs),
    top = source.y - MAGIC_HEIGHT,
    bottom = top + 1;
  if (left >= rect.right) left = rect.right - 1;
  else if (right <= rect.left) right = rect.left + 1;
  if (top >= rect.bottom) top = rect.bottom - 1;
  else if (bottom <= rect.top) bottom = rect.top + 1;
  return {
    x: Math.trunc((Math.max(left, rect.left) + Math.min(right, rect.right)) / 2),
    y: Math.trunc((Math.max(top, rect.top) + Math.min(bottom, rect.bottom)) / 2),
  };
}
/** 41B850: no ball => no travel, NOT an ammunition fallback. Point is the captured impact point. */
export function magicLeg(
  source: ContactPoint,
  facingLeft: boolean,
  point?: ContactPoint,
): { x0: number; y0: number; x1: number; y1: number; duration: number } {
  const x0 = source.x + (facingLeft ? -MAGIC_NEAR : MAGIC_NEAR),
    y0 = source.y - MAGIC_HEIGHT;
  const x1 = point?.x ?? source.x + (facingLeft ? -MAGIC_RANGE : MAGIC_RANGE),
    y1 = point?.y ?? y0;
  return { x0, y0, x1, y1, duration: Math.max(1, Math.trunc(Math.hypot(x1 - x0, y1 - y0) * 1.5)) };
}
/** 564600/539420 directed foothold ray: floor fronts, non-floor group filter, linked
 * corner tests and nearest intersection. Uses all segments, not just vertical walls.
 * Equal-distance corner choices share the same clipped point; no Gr2D/R-tree port implied. */
export function clipMagicRay(
  source: ContactPoint,
  point: ContactPoint,
  footholds: FootholdSegment[],
  group: number = 0,
): { point: ContactPoint; blocked: boolean } {
  const start = { x: source.x, y: source.y - MAGIC_HEIGHT },
    dx = point.x - start.x,
    dy = point.y - start.y;
  const byId = new Map(footholds.map((f) => [f.id, f]));
  const side = (f: FootholdSegment, p: ContactPoint) =>
    (f.x2 - f.x1) * (p.y - f.y1) - (f.y2 - f.y1) * (p.x - f.x1);
  let fraction = Infinity;
  for (const f of footholds) {
    if (f.x2 <= f.x1 && (f.group ?? 0) !== 0 && f.group !== group) continue;
    const before = side(f, start),
      after = side(f, point);
    if (before > 0 || after < 0 || (before === 0 && after === 0)) continue;
    const first = dx * (f.y1 - start.y) - dy * (f.x1 - start.x),
      last = dx * (f.y2 - start.y) - dy * (f.x2 - start.x);
    if (first * last > 0) continue;
    if (first === 0 || last === 0) {
      const adjacent = byId.get(first === 0 ? f.prev : f.next);
      if (!adjacent) continue;
      const turn =
        first === 0
          ? side(adjacent, { x: f.x2, y: f.y2 })
          : side(f, { x: adjacent.x2, y: adjacent.y2 });
      const a = side(f, point),
        b = side(adjacent, point);
      if (turn <= 0 ? a <= 0 && b <= 0 : a <= 0 || b <= 0) continue;
    }
    const denominator = Math.abs(dx * (f.y2 - f.y1) - dy * (f.x2 - f.x1));
    if (denominator === 0) continue;
    fraction = Math.min(fraction, Math.abs(before) / denominator);
  }
  return fraction <= 1
    ? {
        point: { x: Math.trunc(start.x + dx * fraction), y: Math.trunc(start.y + dy * fraction) },
        blocked: true,
      }
    : { point, blocked: false };
}
