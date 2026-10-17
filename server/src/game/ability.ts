import type { CharacterStats } from "../protocol/chardata.ts";
import { ABILITY_MASK, ABILITY_FIELDS } from "../protocol/ability.ts";
import type { StatDiff } from "../protocol/stat.ts";
import { growVitals, type GrowthContext } from "./growth.ts";
/** One point per request; exact masks only. Refuse before consuming AP or truncating a diff. */
export function spendAbility(
  stats: CharacterStats,
  mask: number,
  context: GrowthContext = {},
): StatDiff {
  const field = ABILITY_FIELDS.find((field) => ABILITY_MASK[field] === mask);
  if (
    !field ||
    !(stats.hp > 0) ||
    !Number.isInteger(stats.ap) ||
    stats.ap <= 0 ||
    stats.ap > 0x7fff
  )
    return {};
  const value = stats[field];
  let diff: StatDiff;
  if (field === "maxHp" || field === "maxMp") {
    const candidate = { ...stats };
    diff = growVitals(candidate, mask, "ap", context);
    if (diff[field] === undefined || !(candidate[field] > value)) return {};
  } else {
    // 0x0D reads u8, unlike CharacterData's u16. Never wrap 256 to zero.
    if (!Number.isInteger(value) || value < 4 || value >= 255) return {};
    diff = { [field]: value + 1 };
  }
  diff.ap = stats.ap - 1;
  Object.assign(stats, diff);
  return diff;
}
