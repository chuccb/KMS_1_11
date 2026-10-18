/** Untrusted browser JSON -> existing native CMovePath. These limits are bridge policy,
 * NOT a claim about the original server's movement admission/anti-cheat.
 * Native codec still supports its full 255 records and u16 duration for non-browser callers.
 */
import type { MoveElement, MovePath } from "../protocol/movepath.ts";

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid browser movement object");
  return value as Record<string, unknown>;
}
function integer(value: unknown, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high)
    throw new Error("invalid browser movement integer");
  return value;
}
export function readBrowserMovePath(value: unknown): MovePath {
  const path = object(value);
  const originX = integer(path.originX, -32768, 32767), originY = integer(path.originY, -32768, 32767);
  if (!Array.isArray(path.elements) || path.elements.length < 1 || path.elements.length > 64)
    throw new Error("invalid browser movement count");
  let total = 0;
  const elements: MoveElement[] = path.elements.map(value => {
    const row = object(value);
    const duration = integer(row.duration, 0, 1000);
    total += duration;
    if (total > 1000) throw new Error("browser movement backlog exceeds 1000ms");
    const attr = integer(row.attr, 0, 2);
    if (attr !== 0 && attr !== 2) throw new Error("invalid browser movement attribute");
    return {attr, duration, x: integer(row.x, -32768, 32767), y: integer(row.y, -32768, 32767),
      vx: integer(row.vx, -32768, 32767), vy: integer(row.vy, -32768, 32767),
      action: integer(row.action, 0, 255), foothold: integer(row.foothold, -32768, 65535)};
  });
  return {originX, originY, elements};
}
