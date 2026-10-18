import type { NpcArt, NpcBehavior } from "../server/src/game/sprites.ts";
import { isRecord, isFiniteNumber } from "./resource-validation.ts";
import { isSpriteFrames } from "./combat-resource-validation.ts";

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
export function isNpcBehavior(value: unknown): value is NpcBehavior {
  return (
    isRecord(value) &&
    typeof value.movable === "boolean" &&
    strings(value.speak) &&
    Array.isArray(value.extraActions) &&
    value.extraActions.every(
      (action: unknown) =>
        isRecord(action) && typeof action.name === "string" && strings(action.speak),
    )
  );
}
/** Own name/click rectangle and linked action/idle data stay separate; no canvas-sized fallback. */
export function isNpcMetadata(value: unknown): value is NpcArt {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.templateId) ||
    typeof value.name !== "string" ||
    !isRecord(value.actions) ||
    !Object.values(value.actions).every(isSpriteFrames) ||
    !isNpcBehavior(value.behavior) ||
    !isRecord(value.clickBounds)
  )
    return false;
  const r = value.clickBounds;
  return [r.left, r.top, r.right, r.bottom].every(isFiniteNumber);
}
