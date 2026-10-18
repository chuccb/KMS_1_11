import type { TerrainPoint } from "./native-terrain.ts";
import { collisionRound } from "./native-terrain.ts";

/** Browser camera policies, NOT reverse-engineered native easing/dead-zone constants. */
export const CAMERA_MODES = [
  { id: "smooth", label: "平滑跟隨", detail: "平滑追蹤角色；保留瀏覽器原有的跟隨速度" },
  { id: "center", label: "直接置中", detail: "不加鏡頭緩動，直接跟隨角色的顯示座標" },
  { id: "zone", label: "區域跟隨", detail: "角色離開中央區域才捲動，減少短距離走跳的鏡頭晃動" },
  { id: "fixed", label: "固定鏡頭", detail: "保留目前鏡頭位置；可用旁邊的回中按鈕重新對準角色" },
] as const;
export type CameraMode = (typeof CAMERA_MODES)[number]["id"];
export function cameraMode(value: unknown): CameraMode {
  return CAMERA_MODES.find((mode) => mode.id === value)?.id ?? "smooth";
}
export interface CameraBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface CameraState extends TerrainPoint {
  ready: boolean;
  /** Keep fractional tracking separate from the shared raster-space world origin. */
  trackingX: number;
  trackingY: number;
}
export function createCamera(): CameraState {
  return { x: 0, y: 0, trackingX: 0, trackingY: 0, ready: false };
}

/** 470340 provides native VR centre limits and collapses a narrow map to its midpoint.
 * The narrow-map midpoint uses signed integer division BEFORE subtracting the half viewport.
 * Expressed here as top-left limits for the browser's viewport. Missing VR/art bounds stay
 * unbounded, rather than inventing terrain. All modes share these limits.
 */
export function clampCamera(
  point: TerrainPoint,
  width: number,
  height: number,
  bounds?: CameraBounds,
): TerrainPoint {
  if (!bounds) return { x: point.x, y: point.y };
  const axis = (value: number, min: number, max: number, size: number) =>
    max - min <= size
      ? Math.trunc((min + max) / 2) - size / 2
      : Math.max(min, Math.min(max - size, value));
  return {
    x: axis(point.x, bounds.left, bounds.right, width),
    y: axis(point.y, bounds.top, bounds.bottom, height),
  };
}

/** .18 per 60Hz frame is the existing browser preference, not a proven native .2s constant.
 * Dead-zone half extents (1/8 width, 1/6 height) are explicit browser policy as well.
 * Keep floats while tracking; rasterize ONCE so backgrounds, actors and pointer conversion
 * all use the identical origin. Rounding per sprite would cause relative one-pixel vibration.
 */
export function updateCamera(
  state: CameraState,
  player: TerrainPoint,
  mode: CameraMode,
  elapsedMs: number,
  width: number,
  height: number,
  bounds?: CameraBounds,
): CameraState {
  const target = clampCamera(
    { x: player.x - width / 2, y: player.y - height / 2 },
    width,
    height,
    bounds,
  );
  if (!state.ready || mode === "center") {
    state.trackingX = target.x;
    state.trackingY = target.y;
    state.ready = true;
  } else if (mode === "smooth") {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const gain = 1 - (1 - 0.18) ** (elapsed / (1000 / 60));
    state.trackingX += (target.x - state.trackingX) * gain;
    state.trackingY += (target.y - state.trackingY) * gain;
  } else if (mode === "zone") {
    const follow = (current: number, target: number, half: number) =>
      Math.max(target - half, Math.min(target + half, current));
    state.trackingX = follow(state.trackingX, player.x - width / 2, width / 8);
    state.trackingY = follow(state.trackingY, player.y - height / 2, height / 6);
  }
  // Re-clamp even in fixed mode (map art may have arrived after the first frame).
  const clamped = clampCamera({ x: state.trackingX, y: state.trackingY }, width, height, bounds);
  state.trackingX = clamped.x;
  state.trackingY = clamped.y;
  state.x = collisionRound(clamped.x);
  state.y = collisionRound(clamped.y);
  return state;
}
