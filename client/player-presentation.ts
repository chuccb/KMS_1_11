import type { PlayerBody } from "./motion-types.ts";
import type { TerrainPoint } from "./native-terrain.ts";
import { collisionRound } from "./native-terrain.ts";
import { NATIVE_STEP_MS } from "./native-locomotion.ts";

/** CVecCtrl 537520 copies current to previous; 53C2B0 reads the two positions at Gr2D time.
 * The browser retains its existing floor-based accumulator (not the native app's global phase).
 * This is bounded one-controller-tick presentation latency, NOT extrapolation or another force
 * integration. Never feed this point into physics, collision, attack admission or movement packets.
 */
export function samplePlayerPosition(
  body: Pick<PlayerBody, "x" | "y" | "accumulator" | "renderPrevious">,
): TerrainPoint {
  const previous = body.renderPrevious ?? body;
  const alpha = Math.max(
    0,
    Math.min(1, Number.isFinite(body.accumulator) ? body.accumulator / NATIVE_STEP_MS : 0),
  );
  const phase = 1 - alpha;
  return {
    x: collisionRound(body.x + (previous.x - body.x) * phase),
    y: collisionRound(body.y + (previous.y - body.y) * phase),
  };
}

/** Capture current as previous before a tick (537520), or synchronize history at a
 * discontinuity (spawn/correction/suspension) instead of blending unrelated positions.
 * This does not change the controller remainder, velocity, input queue or movement journal.
 */
export function resetPlayerPresentation(body: Pick<PlayerBody, "x" | "y" | "renderPrevious">) {
  body.renderPrevious = { x: body.x, y: body.y };
}
