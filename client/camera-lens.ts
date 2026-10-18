/** Discrete pixel lenses + bounded monotonic fades. Browser art direction, not native physics.
 * Never animate fractional geometry: switch lens at full cover. Fade opacity may interpolate;
 * sprite geometry cannot. Absolute timestamps make outcomes independent of RAF count.
 */
import { sceneViewport } from "./scene-surface.ts";
export const LENS_MODES = [
  { id: "wide", label: "遠景 · 最小清晰像素" },
  { id: "normal", label: "標準 · 1×視野" },
  { id: "near", label: "拉近 · 2×" },
  { id: "detail", label: "特寫 · 3×" },
] as const;
export type LensMode = (typeof LENS_MODES)[number]["id"];
export const TRANSITIONS = [
  { id: "cut", label: "直接切換" },
  { id: "fade", label: "淡出 → 淡入" },
  { id: "shutter", label: "上下開幕" },
] as const;
export type LensTransition = (typeof TRANSITIONS)[number]["id"];
export const lensMode = (value: unknown): LensMode =>
  LENS_MODES.find((mode) => mode.id === value)?.id ?? "normal";
export const lensTransition = (value: unknown): LensTransition =>
  TRANSITIONS.find((mode) => mode.id === value)?.id ?? "cut";
export function lensViewport(mode: LensMode, uiScale: number) {
  return sceneViewport(
    uiScale,
    mode === "wide" ? 1 : uiScale * (mode === "near" ? 2 : mode === "detail" ? 3 : 1),
  );
}
const OUT_MS = 180,
  IN_MS = 240;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
interface Transition {
  start: number;
  peak: number;
  end: number;
  initial: number;
  style: "fade" | "shutter";
}
export function cameraLens(initial: LensMode = "normal") {
  let current = initial,
    target = initial,
    transition: Transition | undefined,
    last = 0;
  function time(now: number) {
    if (Number.isFinite(now)) last = Math.max(last, now);
    return last;
  }
  function sample(now: number) {
    const at = time(now);
    let cover = 0;
    if (transition) {
      if (at >= transition.peak) current = target;
      if (at >= transition.end) transition = undefined;
      else if (at < transition.peak)
        cover =
          transition.initial +
          (1 - transition.initial) *
            ease((at - transition.start) / (transition.peak - transition.start));
      else cover = 1 - ease((at - transition.peak) / (transition.end - transition.peak));
    }
    return { mode: current, cover, style: transition?.style ?? ("fade" as const) };
  }
  return {
    sample,
    request(mode: LensMode, now: number, style: LensTransition, force = false) {
      const before = sample(now);
      target = mode;
      if (style === "cut") {
        current = mode;
        transition = undefined;
        return;
      }
      if (!force && mode === current && !transition) return;
      const start = time(now),
        peak = start + OUT_MS * (1 - before.cover);
      transition = { start, peak, end: peak + IN_MS, initial: before.cover, style };
    },
    /** Field art arrived (including same-map re-entry). New field cannot inherit a stale fade. */
    reveal(now: number, style: LensTransition) {
      current = target;
      const start = time(now);
      transition =
        style === "cut" ? undefined : { start, peak: start, end: start + IN_MS, initial: 1, style };
    },
    clear() {
      current = target;
      transition = undefined;
    },
  };
}
