export interface PhysicalBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface TerrainSegment {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  prev: number;
  next: number;
  layer?: number;
  group?: number;
}
export interface NormalizedSegment extends TerrainSegment {
  cos: number;
  sin: number;
  length: number;
}
export interface TerrainWorld {
  footholds: readonly NormalizedSegment[];
  byId: ReadonlyMap<number, NormalizedSegment>;
}
export interface TerrainPoint {
  x: number;
  y: number;
}
export interface TerrainVelocity extends TerrainPoint {
  vx: number;
  vy: number;
}
export interface TerrainContact {
  left: NormalizedSegment;
  right: NormalizedSegment;
  numerator: number;
  denominator: number;
  fraction: number;
  x: number;
  y: number;
}
/** CWvsPhysicalSpace2D / CVecCtrl geometry, not camera or image bounds.
 * 563010, 5389B0, 539420, 539B10, 539C40. Broad phase remains a stable WZ-order scan;
 * this is not a port of the native R-tree's allocation/traversal or all CShape2D callers.
 */
export function physicalBounds(
  footholds: Iterable<Pick<TerrainSegment, "x1" | "y1" | "x2" | "y2">>,
): PhysicalBounds | undefined {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const f of footholds) {
    if (![f.x1, f.y1, f.x2, f.y2].every(Number.isFinite)) continue;
    left = Math.min(left, f.x1 + 30, f.x2 + 30);
    right = Math.max(right, f.x1 - 30, f.x2 - 30);
    top = Math.min(top, f.y1 - 300, f.y2 - 300);
    bottom = Math.max(bottom, f.y1 + 10, f.y2 + 10);
  }
  // Empty/malformed or <60px fixture maps cannot supply a usable native rectangle.
  // Explicit reconstruction guard: no viewport-sized or synthetic-floor fallback.
  return left <= right && top <= bottom ? { left, top, right, bottom } : undefined;
}
/** 5643D0: preserve directed WZ links/page/group; do not repair reciprocal links. */
export function normalizeFootholds(footholds: readonly TerrainSegment[]): NormalizedSegment[] {
  return footholds.map((f) => {
    const length = Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
    return {
      ...f,
      length,
      cos: length ? (f.x2 - f.x1) / length : 0,
      sin: length ? (f.y2 - f.y1) / length : 0,
    };
  });
}
export const collisionRound = (n: number) => Math.trunc(n < 0 ? n - 0.499999999 : n + 0.5);
export const cross32 = (ax: number, ay: number, bx: number, by: number) =>
  (Math.imul(ax, by) - Math.imul(ay, bx)) | 0;
const abs32 = (n: number) => ((n ^ (n >> 31)) - (n >> 31)) | 0;
const side = (f: TerrainSegment, x: number, y: number) =>
  cross32(f.x2 - f.x1, f.y2 - f.y1, x - f.x1, y - f.y1);
const usedTime = (fraction: number, milliseconds: number) =>
  Math.max(0, Math.min(milliseconds, Math.trunc(fraction * milliseconds)));

/** 539B10: clip X and TOP, zero ONLY the clipped velocity components. No bottom floor.
 * Coordinates are clipped independently, not to one interpolated rectangle-entry point.
 */
export function clipAir(
  body: TerrainVelocity,
  old: TerrainPoint,
  milliseconds: number,
  bounds?: PhysicalBounds,
): number {
  if (!bounds) return milliseconds;
  let used = milliseconds;
  const dx = body.x - old.x,
    dy = body.y - old.y;
  if (body.x < bounds.left || body.x > bounds.right) {
    body.x = body.x < bounds.left ? bounds.left : bounds.right;
    body.vx = 0;
    if (dx !== 0) used = usedTime((body.x - old.x) / dx, milliseconds);
  }
  if (body.y < bounds.top) {
    body.y = bounds.top;
    body.vy = 0;
    if (dy !== 0) used = Math.min(used, usedTime((body.y - old.y) / dy, milliseconds));
  }
  return used;
}
/** 539C40: ground clipping is along the CURRENT tangent, and clears tangent speed. */
export function clipGround(
  f: NormalizedSegment,
  oldPosition: number,
  position: number,
  speed: number,
  milliseconds: number,
  bounds?: PhysicalBounds,
): { position: number; speed: number; used: number } {
  if (!bounds) return { position, speed, used: milliseconds };
  const x = f.x1 + f.cos * position;
  if (x >= bounds.left && x <= bounds.right) return { position, speed, used: milliseconds };
  const clipped = ((x < bounds.left ? bounds.left : bounds.right) - f.x1) / f.cos;
  const delta = position - oldPosition;
  return {
    position: clipped,
    speed: 0,
    used: delta === 0 ? milliseconds : usedTime((clipped - oldPosition) / delta, milliseconds),
  };
}
export function segmentPosition(f: NormalizedSegment, x: number, y: number): number {
  return Math.abs(f.cos) <= 0.5 ? (y - f.y1) / f.sin : (x - f.x1) / f.cos;
}
function cornerAllows(left: NormalizedSegment, right: NormalizedSegment, x: number, y: number) {
  const turn = side(left, right.x2, right.y2);
  const a = side(left, x, y),
    b = side(right, x, y);
  return turn <= 0 ? a > 0 || b > 0 : a > 0 && b > 0;
}

/** 5389B0: one-sided integer crossing, endpoint neighbors, rational first hit and corner ties.
 * Math.imul intentionally preserves the listing's signed-32 intermediates, including the
 * 538C66 side product and 538EEB second comparison product. BigInt preserves the actual
 * signed-64 multiply/divide stages, not an epsilon-based floating-point intersection ranking.
 */
export function terrainContact(
  world: TerrainWorld,
  old: TerrainPoint,
  target: TerrainPoint,
  group: number = 0,
): TerrainContact | undefined {
  const x0 = collisionRound(old.x),
    y0 = collisionRound(old.y);
  const x1 = collisionRound(target.x),
    y1 = collisionRound(target.y);
  const dx = (x1 - x0) | 0,
    dy = (y1 - y0) | 0;
  if (dx === 0 && dy === 0) return undefined;
  let best: TerrainContact | undefined;
  for (const f of world.footholds) {
    if (!(f.length > 0) || (f.cos <= 0 && (f.group ?? 0) !== 0 && (f.group ?? 0) !== group))
      continue;
    // Inclusive broad-phase AABB, including zero-width walls and endpoint-only contacts.
    if (
      Math.max(f.x1, f.x2) < Math.min(x0, x1) ||
      Math.min(f.x1, f.x2) > Math.max(x0, x1) ||
      Math.max(f.y1, f.y2) < Math.min(y0, y1) ||
      Math.min(f.y1, f.y2) > Math.max(y0, y1)
    )
      continue;
    const before = side(f, x0, y0),
      after = side(f, x1, y1);
    if (before > 0 || after < 0 || (before === 0 && after === 0)) continue;
    const a = cross32(dx, dy, f.x1 - x0, f.y1 - y0);
    const b = cross32(dx, dy, f.x2 - x0, f.y2 - y0);
    if (Math.imul(a, b) > 0) continue;
    let left: NormalizedSegment | undefined = f,
      right: NormalizedSegment | undefined = f;
    if (a === 0) {
      left = world.byId.get(f.prev);
      if (!left || !cornerAllows(left, f, x1, y1)) continue;
    } else if (b === 0) {
      right = world.byId.get(f.next);
      if (!right || !cornerAllows(f, right, x1, y1)) continue;
    }
    const fx = (f.x2 - f.x1) | 0,
      fy = (f.y2 - f.y1) | 0;
    const denominatorSigned = cross32(dx, dy, fx, fy);
    const denominator = abs32(denominatorSigned),
      numerator = abs32(before);
    if (denominator === 0) continue;
    const difference = BigInt.asIntN(
      64,
      BigInt(best?.numerator ?? 2) * BigInt(denominator) -
        BigInt(Math.imul(best?.denominator ?? 1, numerator)),
    );
    if (difference < 0n) continue;
    if (difference === 0n) {
      if (!best) continue; // malformed overflow-only candidate equal to the initial t=2 sentinel
      if (side(best.right, right.x1, right.y1) < 0) best.right = right;
      if (side(best.left, left.x2, left.y2) < 0) best.left = left;
      continue;
    }
    const c1 = (Math.imul(f.y1, f.x2) - Math.imul(f.x1, f.y2)) | 0;
    const c2 = cross32(x0, y0, x1, y1);
    const divisor = (Math.imul(dy, fx) - Math.imul(dx, fy)) | 0;
    if (divisor === 0) continue;
    const x = Number(
      BigInt.asIntN(64, BigInt(dx) * BigInt(c1) + BigInt(fx) * BigInt(c2)) / BigInt(divisor),
    );
    const y = dx !== 0 ? ((x - x0) * dy) / dx + y0 : ((x - f.x1) * fy) / fx + f.y1;
    best = { left, right, numerator, denominator, fraction: numerator / denominator, x, y };
  }
  return best;
}
/** 539054–5390EB: opposite-sign/near-zero dual-contact velocities stop at a corner;
 * two positive projections choose the right surface, two negative choose the left.
 */
export function contactTangent(
  hit: TerrainContact,
  vx: number,
  vy: number,
): { foothold: NormalizedSegment; speed: number } {
  const right = hit.right,
    left = hit.left;
  const a = right.cos * vx + right.sin * vy,
    b = left.cos * vx + left.sin * vy;
  if (right === left) return { foothold: right, speed: a };
  if (a > 0.001 && b > 0.001) return { foothold: right, speed: a };
  if (a < -0.001 && b < -0.001) return { foothold: left, speed: b };
  return { foothold: right.cos > 0 ? right : left, speed: 0 };
}
