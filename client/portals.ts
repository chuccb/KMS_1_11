import { RETURN_MAP_NONE } from "./map-constants.ts";

export interface PortalTarget {
  type: number;
  name: string;
  x: number;
  y: number;
  toMapId: number;
}
export interface PortalBody {
  x: number;
  y: number;
  grounded?: boolean;
  ladder?: unknown;
}
/** sub_4A4740: non-auto portals, grounded Up, RECT [-20,20) x [-50,50).
 * sub_4A47D0 / sub_5124C0: type 3 automatic, RECT [-50,50) squared, every update.
 * Native searches last-loaded first. Screen-pointer clicking is a separate browser affordance. */
export function movementPortal<T extends PortalTarget>(
  portals: readonly T[],
  body: PortalBody | undefined,
  up = false,
): T | undefined {
  if (!body) return;
  for (const automatic of [true, false]) {
    if (!automatic && (!up || !body.grounded || body.ladder)) continue;
    for (let i = portals.length - 1; i >= 0; i--) {
      const p = portals[i];
      if (
        (p.type === 3) !== automatic ||
        p.type === 0 ||
        !p.name ||
        !(p.toMapId >= 0) ||
        p.toMapId === RETURN_MAP_NONE
      )
        continue;
      const radius = automatic ? 50 : 20,
        dx = body.x - p.x,
        dy = body.y - p.y;
      if (dx >= -radius && dx < radius && dy >= -50 && dy < 50) return p;
    }
  }
}
/** CharacterData+101 indexes the non-type-3 array, not the WZ numeric node name. */
export function arrivalPortal<T extends PortalTarget>(
  map: { portals: readonly T[] },
  index = 0,
): T | undefined {
  const portals = map.portals.filter((p) => p.type !== 3);
  return portals[index] ?? portals.find((p) => p.name === "sp") ?? portals[0];
}

/**
 * The swirls the field paints: `pt == 2` warps only (`pt == 0` is a spawn point and `pt == 1` a
 * hidden passage, neither of which has a picture - `Map/MapHelper.img/portal/game/pv` is the one
 * animation). They use the fixed portal root z, not an unconditional before/after-actor pass.
 *
 * A warp whose centre is more than `margin` (120) pixels outside the surface is skipped: the native
 * clip is the surface rectangle grown by the sprite's own footprint, not the whole field.
 */
export function portalSwirls(
  portals: readonly { x: number; y: number; type: number }[],
  cameraX: number,
  cameraY: number,
  bounds: { width: number; height: number },
  margin = 120,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const portal of portals) {
    if (portal.type !== 2) continue;
    const x = portal.x - cameraX,
      y = portal.y - cameraY;
    if (x < -margin || x > bounds.width + margin || y < -margin || y > bounds.height + margin)
      continue;
    out.push({ x, y });
  }
  return out;
}
