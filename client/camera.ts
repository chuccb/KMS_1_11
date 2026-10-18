import type { TerrainPoint } from "./native-terrain.ts";
import { collisionRound } from "./native-terrain.ts";

/** Browser camera policies, NOT reverse-engineered native easing/dead-zone constants. */
export const CAMERA_MODES = [
  { id: "smooth", label: "平滑跟隨", detail: "平滑追蹤角色；保留瀏覽器原有的跟隨速度" },
  { id: "center", label: "直接置中", detail: "不加鏡頭緩動，直接跟隨角色的顯示座標" },
  { id: "zone", label: "區域跟隨", detail: "角色離開中央區域才捲動，減少短距離走跳的鏡頭晃動" },
  { id: "lead", label: "疾速領航", detail: "依移動速度向前／上下探路；平滑收回偏移，適合跑跳" },
  { id: "spring", label: "彈簧追蹤", detail: "帶受控回彈的彈簧鏡頭；刻意有超越與回彈，非原版" },
  { id: "cinema", label: "電影滑軌", detail: "慢速阻尼滑軌，角色略低於中央並向前留白；非原版構圖" },
  { id: "platform", label: "平台跑酷", detail: "水平快速跟隨，起跳時保留垂直視野，落地再緩動回中" },
  {
    id: "soft-zone",
    label: "柔性區域",
    detail: "保留中央安全區，超出後柔和追上，不像區域模式立即推邊",
  },
  {
    id: "shoulder",
    label: "方向側肩",
    detail: "沿角色面向保留前方視野，停下也保持構圖；轉身時平滑換肩",
  },
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
  velocityX: number;
  velocityY: number;
  leadX: number;
  leadY: number;
  mode: CameraMode;
}
export interface CameraMotion {
  vx?: number;
  vy?: number;
  grounded?: boolean;
  facing?: number;
}
export function createCamera(): CameraState {
  return {
    x: 0,
    y: 0,
    trackingX: 0,
    trackingY: 0,
    velocityX: 0,
    velocityY: 0,
    leadX: 0,
    leadY: 0,
    mode: "smooth",
    ready: false,
  };
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

/** Analytic damped spring for a constant target over one frame; no Euler instability at low FPS.
 * omega / damping / offsets below are explicitly browser art-direction, NOT native constants.
 */
function springAxis(
  position: number,
  velocity: number,
  target: number,
  seconds: number,
  omega: number,
  damping: number,
) {
  const offset = position - target,
    decay = Math.exp(-damping * omega * seconds);
  if (damping === 1) {
    const j = velocity + omega * offset;
    return {
      position: target + (offset + j * seconds) * decay,
      velocity: (velocity - omega * j * seconds) * decay,
    };
  }
  const frequency = omega * Math.sqrt(1 - damping * damping),
    angle = frequency * seconds;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return {
    position:
      target + decay * (offset * cos + ((velocity + damping * omega * offset) / frequency) * sin),
    velocity:
      decay *
      (velocity * cos - ((damping * omega * velocity + omega * omega * offset) / frequency) * sin),
  };
}
const zoneAxis = (current: number, target: number, half: number) =>
  Math.max(target - half, Math.min(target + half, current));
const finiteVelocity = (value: number | undefined) => (Number.isFinite(value) ? (value ?? 0) : 0);
const bounded = (value: number, max: number) => Math.max(-max, Math.min(max, value));

/** All ten policies share ONE raster origin and the same VR limits. No zoom/rotation or second
 * pointer transform HERE: scene-surface owns the separate pixel lens. Existing smooth (.18 at 60Hz) / center / zone / fixed retain their behavior.
 * Experiments consume velocity only for framing; they never change player/physics/network state.
 */
export function updateCamera(
  state: CameraState,
  player: TerrainPoint,
  mode: CameraMode,
  elapsedMs: number,
  width: number,
  height: number,
  bounds?: CameraBounds,
  motion: CameraMotion = {},
): CameraState {
  const target = clampCamera(
    { x: player.x - width / 2, y: player.y - height / 2 },
    width,
    height,
    bounds,
  );
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  // Map changes/recenter clear every dynamic component. Mode changes preserve the origin but
  // cannot inherit an old spring impulse or an old direction's lead.
  if (!state.ready || state.mode !== mode) {
    state.velocityX = state.velocityY = state.leadX = state.leadY = 0;
    state.mode = mode;
  }
  if (!state.ready || mode === "center") {
    state.trackingX = target.x;
    state.trackingY = target.y;
    state.ready = true;
  } else if (mode === "smooth") {
    const gain = 1 - (1 - 0.18) ** (elapsed / (1000 / 60));
    state.trackingX += (target.x - state.trackingX) * gain;
    state.trackingY += (target.y - state.trackingY) * gain;
  } else if (mode === "zone") {
    state.trackingX = zoneAxis(state.trackingX, player.x - width / 2, width / 8);
    state.trackingY = zoneAxis(state.trackingY, player.y - height / 2, height / 6);
  } else if (mode !== "fixed" && elapsed > 0) {
    // Match the app's 250ms background catch-up cap; no huge resume impulse.
    const ms = Math.min(250, elapsed),
      seconds = ms / 1000;
    const vx = finiteVelocity(motion.vx),
      vy = finiteVelocity(motion.vy);
    let x = target.x,
      y = target.y,
      tauX = 110,
      tauY = 150;
    if (mode === "lead") {
      const gain = 1 - Math.exp(-ms / 120);
      state.leadX += (bounded(vx * 0.55, width * 0.3) - state.leadX) * gain;
      state.leadY += (bounded(vy * 0.2, height * 0.2) - state.leadY) * gain;
      x += state.leadX;
      y += state.leadY;
    } else if (mode === "shoulder") {
      x += (motion.facing === 1 ? -1 : 1) * width * 0.18;
      tauX = tauY = 130;
    } else if (mode === "cinema") {
      x += bounded(vx * 0.2, width * 0.14);
      y -= height * 0.1;
    } else if (mode === "platform") {
      tauX = 65;
      tauY = 180;
      y = motion.grounded === false ? zoneAxis(state.trackingY, target.y, height * 0.22) : target.y;
    } else if (mode === "soft-zone") {
      x = zoneAxis(state.trackingX, target.x, width / 8);
      y = zoneAxis(state.trackingY, target.y, height / 6);
      tauX = tauY = 160;
    }
    const framed = clampCamera({ x, y }, width, height, bounds);
    if (mode === "spring" || mode === "cinema") {
      const omega = mode === "spring" ? 9 : 4.5,
        damping = mode === "spring" ? 0.6 : 1;
      const horizontal = springAxis(
        state.trackingX,
        state.velocityX,
        framed.x,
        seconds,
        omega,
        damping,
      );
      const vertical = springAxis(
        state.trackingY,
        state.velocityY,
        framed.y,
        seconds,
        omega,
        damping,
      );
      state.trackingX = horizontal.position;
      state.velocityX = horizontal.velocity;
      state.trackingY = vertical.position;
      state.velocityY = vertical.velocity;
    } else {
      state.trackingX += (framed.x - state.trackingX) * (1 - Math.exp(-ms / tauX));
      state.trackingY += (framed.y - state.trackingY) * (1 - Math.exp(-ms / tauY));
    }
  }
  const clamped = clampCamera({ x: state.trackingX, y: state.trackingY }, width, height, bounds);
  // Boundary anti-windup: spring energy cannot accumulate beyond a wall then launch on return.
  if (clamped.x !== state.trackingX) state.velocityX = 0;
  if (clamped.y !== state.trackingY) state.velocityY = 0;
  state.trackingX = clamped.x;
  state.trackingY = clamped.y;
  state.x = collisionRound(clamped.x);
  state.y = collisionRound(clamped.y);
  return state;
}

/** Lens/FOV changes preserve the current world centre, including fixed-camera framing.
 * No player state changes. The regular update then clamps the new viewport to the same WZ VR.
 */
export function reframeCamera(
  state: CameraState,
  before: { width: number; height: number },
  after: { width: number; height: number },
): void {
  if (!state.ready) return;
  state.trackingX += (before.width - after.width) / 2;
  state.trackingY += (before.height - after.height) / 2;
}
