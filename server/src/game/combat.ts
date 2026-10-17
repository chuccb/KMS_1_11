/**
 * One swing's damage numbers - the client's half of an attack, which the server takes on trust.
 *
 * WHY THIS IS HERE AND NOT IN THE FIELD
 * -------------------------------------
 * The field does not roll damage and has no model to check it against: `0x1B`'s target records
 * carry the numbers the *client* drew (FINDINGS 4.13.1, ADR-021), and the 2003 client's own formula
 * lives in code this repo never located. The browser is the client, so the roll has to happen on
 * this side of the web socket - but the field must not start believing a number it cannot justify,
 * so `GameEntryServer` still takes it from the packet exactly like it takes a real client's.
 *
 * WHAT IS EVIDENCE, WHAT IS A CHOICE
 * ----------------------------------
 * Evidence, from `Data.wz`:
 *
 *   the character's STR/DEX/INT/LUK     `CharacterData`'s record (the same bytes `0x16` sends)
 *   the weapon's `info/incPAD`          the real attack value of every weapon image
 *                                       (`Character/Weapon/01302000.img/info/incPAD` = 17 for 검)
 *
 * A choice, because the binary never gave us the arithmetic:
 *
 *   `max = (mainStat * 4 + secondaryStat) * watk / 100`
 *   `min = max / 10`
 *   the roll is uniform in `[min, max]`
 *
 * Those two lines are the *shape* of the pre-Big-Bang formula that every reference agrees on
 * (the four-times-main-stat term, and the wide beginner range), with the mastery and defence terms
 * dropped because this server has no mastery and the mobs' defence is not modelled. It is named and
 * replaceable for the same reason `PATROL_SPEED_PX_PER_SEC` and the drop rates are: the number is
 * not in the archive, so what the code can honestly promise is that the formula is in one place.
 *
 * The roll takes a random source, so a test can pin a value and a field could pass the client's own
 * generator (`ClientRandom`, the one `0x16`'s seeds feed - see `game/mobs.ts`).
 */
import type { ItemCatalog } from "./iteminfo.ts";
import type { CharacterStats } from "../protocol/chardata.ts";

/** The stat pair a job swings with: `[main, secondary]`, the two multiplied as the formula says. */
export function damageStatsOf(job: number): ["str" | "dex" | "int" | "luk", "str" | "dex" | "int" | "luk"] {
  // v1.11's five branches: 100 warrior, 200 magician, 300 bowman, 400 thief, 500 pirate. A beginner
  // (0) swings like a warrior - that is what the class-less starting weapon is.
  const branch = Math.floor(job / 100) * 100;
  if (branch === 200) return ["int", "luk"];
  if (branch === 300) return ["dex", "str"];
  if (branch === 400) return ["luk", "dex"];
  return ["str", "dex"];
}

/** The attack of everything worn: the weapon's `incPAD` plus a glove's, which is the only other. */
export function watkOf(wornItemIds: readonly number[], catalog: ItemCatalog | undefined): number {
  let total = 0;
  for (const itemId of wornItemIds) {
    const info = catalog?.info(itemId);
    if (info?.incPAD !== undefined && info.incPAD > 0) total += info.incPAD;
  }
  return total;
}

/** The range one swing rolls in. `min` and `max` are both at least 1 (a hit always hurts). */
export interface DamageRange {
  min: number;
  max: number;
}

/** The formula's two lines, exposed so a test can pin them without a character record. */
export function damageRangeOf(main: number, secondary: number, watk: number): DamageRange {
  const base = ((Math.max(0, main) * 4 + Math.max(0, secondary)) * Math.max(0, watk)) / 100;
  const max = Math.max(1, Math.floor(base));
  const min = Math.max(1, Math.floor(base / 10));
  return { min: Math.min(min, max), max };
}

/** One character's range, read off its record and its worn ids. */
export function damageRangeFor(
  stats: Pick<CharacterStats, "job" | "str" | "dex" | "int" | "luk">,
  wornItemIds: readonly number[],
  catalog: ItemCatalog | undefined,
  projectileItemId?: number,
): DamageRange {
  const [main, secondary] = damageStatsOf(stats.job);
  // Applying the ammo's WZ incPAD to this existing approximation is a reconstruction policy,
  // NOT proof of the original ranged formula (mastery, defence and weapon coefficients are open).
  const ammoPad = projectileItemId === undefined
    ? 0
    : Math.max(0, catalog?.info(projectileItemId)?.incPAD ?? 0);
  return damageRangeOf(
    stats[main], stats[secondary], watkOf(wornItemIds, catalog) + ammoPad,
  );
}

/** One swing's number: uniform in the range, `max` when the range is a point. */
export function rollDamage(range: DamageRange, random: () => number = Math.random): number {
  const span = range.max - range.min;
  if (span <= 0) return range.max;
  return range.min + Math.max(0, Math.min(span, Math.floor(random() * (span + 1))));
}
