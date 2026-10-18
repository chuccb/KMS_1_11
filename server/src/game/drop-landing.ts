/** Authoritative reward placement on the map's real, directed footholds.
 * Server policy: retain a grounded source's connected floor, otherwise cast downward; if spread
 * leaves all ground, project onto a real floor edge. No image/VR bounds or invented ground plane.
 * Original server placement code is unavailable; this is not a port of the native R-tree.
 */
import type { FootholdSegment, FootholdSegments } from "../wz/archive.ts";

export interface DropOrigin {
  x: number;
  y: number;
  foothold?: number;
}
export interface DropLanding {
  x: number;
  y: number;
  /** Internal only: native 0x43 has no foothold field. */
  foothold: number;
}
function floorY(floor: FootholdSegment, x: number): number {
  return floor.y1 + ((x - floor.x1) * (floor.y2 - floor.y1)) / (floor.x2 - floor.x1);
}
function covers(floor: FootholdSegment, x: number): boolean {
  return x >= floor.x1 && x <= floor.x2;
}
/** Wire coordinates are integers; derive y AFTER quantizing x, not before. */
function landing(floor: FootholdSegment, x: number): DropLanding {
  return { x, y: Math.round(floorY(floor, x)), foothold: floor.id };
}
export class DropLandingIndex {
  private readonly floors: FootholdSegment[];
  private readonly byId: ReadonlyMap<number, FootholdSegment>;

  constructor(segments: FootholdSegments | undefined) {
    // CWvsPhysicalSpace2D surfaces are directed: x1<x2 is ground; reverse is ceiling; equal is wall.
    this.floors = [...(segments?.values() ?? [])]
      .filter(
        (floor) =>
          floor.x1 < floor.x2 && [floor.x1, floor.y1, floor.x2, floor.y2].every(Number.isFinite),
      )
      .sort((a, b) => a.id - b.id);
    this.byId = new Map(this.floors.map((floor) => [floor.id, floor]));
  }

  private connected(seed: FootholdSegment): FootholdSegment[] {
    const result = [seed],
      seen = new Set([seed.id]);
    for (const direction of ["prev", "next"] as const) {
      let current = seed;
      for (;;) {
        const adjacent = this.byId.get(current[direction]);
        if (!adjacent || seen.has(adjacent.id)) break;
        const joins =
          direction === "next"
            ? current.x2 === adjacent.x1 && current.y2 === adjacent.y1
            : adjacent.x2 === current.x1 && adjacent.y2 === current.y1;
        if (!joins) break; // Do not cross walls, ceilings, broken links or spatial gaps.
        result.push(adjacent);
        seen.add(adjacent.id);
        current = adjacent;
      }
    }
    return result;
  }

  resolve(source: DropOrigin, desiredX = source.x): DropLanding {
    if (![source.x, source.y, desiredX].every(Number.isFinite))
      throw new Error("Invalid drop origin");
    const x = Math.trunc(desiredX),
      hint = this.byId.get(source.foothold ?? 0);
    let preferred: FootholdSegment[] = [];
    // Half-pixel allowance is solely the native integer packet's slope quantization, not a snap radius.
    if (hint && covers(hint, source.x) && source.y >= floorY(hint, source.x) - 0.5) {
      preferred = this.connected(hint);
      const floor = preferred.find((candidate) => covers(candidate, x));
      if (floor) return landing(floor, x);
    }
    let below: FootholdSegment | undefined,
      belowY = Infinity;
    for (const floor of this.floors) {
      if (!covers(floor, x)) continue;
      const y = floorY(floor, x);
      if (y >= source.y - 0.5 && y < belowY) {
        below = floor;
        belowY = y;
      }
    }
    if (below) return landing(below, x);
    // Spread over a void must not leave a reward at the death's airborne y. Constrain x to a
    // genuine floor (prefer the source's own continuous platform), including exact edge endpoints.
    let edge: DropLanding | undefined,
      distanceX = Infinity,
      distanceY = Infinity;
    for (const floor of preferred.length ? preferred : this.floors) {
      const projectedX = Math.max(Math.ceil(floor.x1), Math.min(Math.floor(floor.x2), x));
      if (!covers(floor, projectedX)) continue;
      const point = landing(floor, projectedX),
        dx = Math.abs(point.x - x),
        dy = Math.abs(point.y - source.y);
      if (dx < distanceX || (dx === distanceX && dy < distanceY)) {
        edge = point;
        distanceX = dx;
        distanceY = dy;
      }
    }
    // --data off / genuinely floorless maps cannot supply a foothold. Keep the legacy unresolved
    // point explicitly (fh0), not a fabricated platform. Every ordinary WZ map is audited separately.
    return edge ?? { x, y: Math.trunc(source.y), foothold: 0 };
  }
}
