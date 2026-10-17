/** Legacy approximation retained only for old regression fixtures. NOT used by the browser.
 * Live basic physical attacks now use nativecombat.ts (sub_4C7960), effective instance stats,
 * monster PD/EVA and the 0x16-seeded first ClientRandom stream. Do not reintroduce this path.
 */
import type { ItemCatalog } from "./iteminfo.ts";
import type { CharacterStats } from "../protocol/chardata.ts";

/** The stat pair a job swings with: `[main, secondary]`, the two multiplied as the formula says. */
export function damageStatsOf(job: number): ["str" | "dex" | "int" | "luk", "str" | "dex" | "int" | "luk"] {
  // Legacy approximation; pirate is not a v1.11 class. A beginner
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
