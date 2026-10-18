import type { TooltipFacts, TooltipIcon, TooltipSkill } from "./tooltip.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function numberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(finite);
}
function tooltipIcon(value: unknown): value is TooltipIcon {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    [value.width, value.height, value.ox, value.oy].every(finite)
  );
}
export function isTooltipFacts(value: unknown): value is TooltipFacts {
  if (!isRecord(value)) return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.desc !== undefined && typeof value.desc !== "string") return false;
  if (value.icon !== undefined && !tooltipIcon(value.icon)) return false;
  if (value.requirements !== undefined) {
    const r = value.requirements;
    if (!isRecord(r) || ![r.level, r.str, r.dex, r.int, r.luk, r.job].every(finite)) return false;
  }
  if (value.equipment !== undefined) {
    const e = value.equipment;
    if (
      !isRecord(e) ||
      !numberRecord(e.stats) ||
      !finite(e.ruc) ||
      (e.cuc !== undefined && !finite(e.cuc))
    )
      return false;
  }
  return true;
}
export function isTooltipSkill(value: unknown): value is TooltipSkill & { id: number } {
  return (
    isRecord(value) &&
    finite(value.id) &&
    typeof value.name === "string" &&
    (value.desc === undefined || typeof value.desc === "string") &&
    (value.icon === undefined || tooltipIcon(value.icon)) &&
    finite(value.maxLevel) &&
    Array.isArray(value.levels) &&
    value.levels.every(
      (level: unknown) => isRecord(level) && finite(level.level) && typeof level.hs === "string",
    )
  );
}
