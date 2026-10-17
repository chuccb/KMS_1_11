import type { CharacterStats } from "../protocol/chardata.ts";
import { ABILITY_MASK, type BaseAbility } from "../protocol/ability.ts";
import type { StatDiff } from "../protocol/stat.ts";
/** One AP for one base stat; reject first, never optimistically consume points or truncate the diff. */
export function spendAbility(stats: CharacterStats, mask: number): StatDiff {
  const field = (["str", "dex", "int", "luk"] as BaseAbility[]).find(
    (field) => ABILITY_MASK[field] === mask,
  );
  if (
    !field ||
    !(stats.hp > 0) ||
    !Number.isInteger(stats.ap) ||
    stats.ap <= 0 ||
    stats.ap > 0x7fff
  )
    return {};
  const value = stats[field];
  // The located 0x0D stat-diff reader takes u8, unlike CharacterData's u16. Don't wrap 256 to zero.
  if (!Number.isInteger(value) || value < 4 || value >= 255) return {};
  const diff = { [field]: value + 1, ap: stats.ap - 1 };
  stats[field] = value + 1;
  stats.ap--;
  return diff;
}
