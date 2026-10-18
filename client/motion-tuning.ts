/** Opt-in browser experiments, not original EXE constants or server-wide clock settings.
 * Whole milliseconds preserve native movement record durations without rounding drift.
 */
import { NATIVE_STEP_MS } from "./native-locomotion.ts";
export const PHYSICS_STEPS = [5, 8, 10, 15, 20, NATIVE_STEP_MS, 45, 60] as const;
export type PhysicsStepMs = (typeof PHYSICS_STEPS)[number];
export const PRESENTATION_MODES = [
  { id: "interpolate", label: "平滑插值（延遲 ≤ 一步）" },
  { id: "direct", label: "即時位置（不插值／可見階梯）" },
] as const;
export type PresentationMode = (typeof PRESENTATION_MODES)[number]["id"];
export function physicsStep(value: unknown): PhysicsStepMs {
  return PHYSICS_STEPS.find((step) => step === value) ?? NATIVE_STEP_MS;
}
export function presentationMode(value: unknown): PresentationMode {
  return PRESENTATION_MODES.find((mode) => mode.id === value)?.id ?? "interpolate";
}
