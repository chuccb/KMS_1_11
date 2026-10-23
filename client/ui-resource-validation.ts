import type { CreationCatalog } from "../server/src/game/creation.ts";
import type { MapDestination } from "../server/src/game/map.ts";
import type { TestToolResult } from "../server/src/game/testtools.ts";
import { isRecord, isFiniteNumber } from "./resource-validation.ts";
import { MAX_MAP_COMMAND_ID, RETURN_MAP_NONE } from "./map-constants.ts";

export function isCreationCatalog(value: unknown): value is CreationCatalog {
  if (
    !isRecord(value) ||
    !Array.isArray(value.forbidden) ||
    !value.forbidden.every((word) => typeof word === "string")
  )
    return false;
  return [value.male, value.female].every(
    (groups) =>
      Array.isArray(groups) &&
      groups.length === 6 &&
      groups.every(
        (group: unknown) =>
          Array.isArray(group) &&
          group.length > 0 &&
          group.every(
            (option: unknown) =>
              isRecord(option) && isFiniteNumber(option.id) && typeof option.name === "string",
          ),
      ),
  );
}
function isMapDestination(value: unknown): value is MapDestination {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id >= 0 &&
    value.id <= MAX_MAP_COMMAND_ID &&
    value.id !== RETURN_MAP_NONE &&
    typeof value.name === "string" &&
    typeof value.streetName === "string"
  );
}

export function isMapDestinations(value: unknown): value is MapDestination[] {
  return Array.isArray(value) && value.every(isMapDestination);
}
export function isTestToolResult(value: unknown): value is TestToolResult {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.message === "string" &&
    [value.checkpoint, value.canMap, value.restoreAvailable].every(
      (flag) => typeof flag === "boolean",
    ) &&
    (value.equipmentRepairCount === undefined || isFiniteNumber(value.equipmentRepairCount)) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(
      (job: unknown) => isRecord(job) && isFiniteNumber(job.id) && typeof job.name === "string",
    ) &&
    (value.rangedChoices === undefined ||
      (Array.isArray(value.rangedChoices) &&
        value.rangedChoices.every(
          (choice: unknown) =>
            isRecord(choice) &&
            typeof choice.kind === "string" &&
            typeof choice.name === "string" &&
            isFiniteNumber(choice.weaponId) &&
            isFiniteNumber(choice.ammoId) &&
            isRecord(choice.requirements) &&
            [
              choice.requirements.level,
              choice.requirements.job,
              choice.requirements.str,
              choice.requirements.dex,
              choice.requirements.int,
              choice.requirements.luk,
            ].every(isFiniteNumber),
        )))
  );
}
