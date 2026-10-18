export interface StatRequirements {
  level: number;
  job: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
}
export interface StatItem {
  slot: number;
  itemId: number;
  stats?: Partial<Record<string, number>>;
  requirements?: StatRequirements;
}
export interface StatInput {
  job: number;
  level: number;
  gender: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  maxHp: number;
  maxMp: number;
}
export interface StatBasis {
  basic: {
    job: number;
    level: number;
    str: number;
    dex: number;
    int: number;
    luk: number;
    maxHp: number;
    maxMp: number;
  };
  secondary: Record<string, number>;
  weaponId: number;
  effectiveSlots: number[];
}
/** Native effective worn set (4C5020), BasicStat (4C5420), SecondaryStat (4C5740).
 * Equipment numbers are the signed WORDs of the instance, never WZ inc* defaults.
 * Metadata is supplied by the archive reader; cash appearance is not an input.
 */
export const signedEquipStat = (n = 0) => (n << 16) >> 16;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const primary = ["str", "dex", "int", "luk"] as const;
export function effectiveWorn(
  stats: StatInput,
  worn: StatItem[] = [],
  excluded: number[] = [],
): StatItem[] {
  const items = worn
    .filter((i) => i.slot >= 1 && i.slot <= 14 && !excluded.includes(i.slot))
    .sort((a, b) => a.slot - b.slot);
  const sums = Object.fromEntries(
    primary.map((k) => [k, items.reduce((n, i) => n + signedEquipStat(i.stats?.[k]), 0)]),
  );
  // Remove the first failure, restart from slot 1: simultaneous removal is NOT equivalent.
  for (let index = 0; index < items.length;) {
    const i = items[index],
      r = i.requirements;
    const branch = Math.trunc(stats.job / 100),
      jobMask = branch ? 1 << (branch - 1) : 0;
    const gender = Math.trunc(i.itemId / 1000) % 10;
    const weapon = [13, 14].includes(Math.trunc(i.itemId / 100000))
      ? Math.trunc(i.itemId / 10000) % 100
      : 0;
    const valid =
      r &&
      (branch !== 2 || [0, 30, 33, 31, 32, 38, 37].includes(weapon)) &&
      (gender === 2 || stats.gender === 2 || gender === stats.gender) &&
      stats.level >= r.level &&
      (!r.job || (r.job & jobMask) !== 0) &&
      primary.every((k) => stats[k] + sums[k] - signedEquipStat(i.stats?.[k]) >= r[k]);
    if (valid) {
      index++;
      continue;
    }
    primary.forEach((k) => (sums[k] -= signedEquipStat(i.stats?.[k])));
    items.splice(index, 1);
    index = 0;
  }
  return items;
}
export function statBasis(
  stats: StatInput,
  worn: StatItem[] = [],
  passives: {
    amazonAccuracy?: number;
    nimbleAccuracy?: number;
    nimbleAvoid?: number;
  } = {},
): StatBasis {
  const equipped = effectiveWorn(stats, worn);
  const basic: StatBasis["basic"] = {
    str: 0,
    dex: 0,
    int: 0,
    luk: 0,
    maxHp: 0,
    maxMp: 0,
    job: stats.job,
    level: stats.level,
  };
  for (const k of [...primary, "maxHp", "maxMp"] as const) {
    basic[k] = stats[k] + equipped.reduce((n, i) => n + signedEquipStat(i.stats?.[k]), 0);
  }
  basic.job = stats.job;
  basic.level = stats.level;
  const branch = Math.trunc(stats.job / 100);
  const secondary = {
    pad: 0,
    pdd: 0,
    mad: basic.int,
    mdd: basic.int,
    acc: [3, 4].includes(branch)
      ? Math.trunc(basic.dex / 2) + Math.trunc(basic.luk / 3)
      : basic.dex + Math.trunc(basic.luk / 2),
    eva: Math.trunc(basic.dex / 4) + Math.trunc(basic.luk / 2),
    hands: basic.dex + basic.int + basic.luk,
    speed: 100,
    jump: 100,
  };
  for (const item of equipped)
    for (const k of ["pad", "pdd", "mad", "mdd", "acc", "eva", "speed", "jump"] as const)
      secondary[k] += signedEquipStat(item.stats?.[k]);
  secondary.acc += (passives.amazonAccuracy ?? 0) + (passives.nimbleAccuracy ?? 0);
  secondary.eva += passives.nimbleAvoid ?? 0;
  for (const k of ["pad", "pdd", "mad", "mdd", "acc", "eva"] as const)
    secondary[k] = clamp(secondary[k], 0, 999);
  secondary.speed = clamp(secondary.speed, 100, 130);
  secondary.jump = clamp(secondary.jump, 100, 123);
  return {
    basic,
    secondary,
    weaponId: equipped.find((i) => i.slot === 11)?.itemId ?? 0,
    effectiveSlots: equipped.map((i) => i.slot),
  };
}
/** Consumers clamp AFTER adding temporary values; hands has no base 999 clamp in 4C5740. */
export function statTotals(
  basis: StatBasis,
  temporary?: Partial<Record<string, number>>,
): Record<string, number>;
export function statTotals(
  basis: undefined,
  temporary?: Partial<Record<string, number>>,
): undefined;
export function statTotals(
  basis: StatBasis | undefined,
  temporary: Partial<Record<string, number>> = {},
): Record<string, number> | undefined {
  if (!basis) return;

  return Object.fromEntries(
    Object.entries(basis.secondary).map(([k, v]) => [
      k,
      k === "speed"
        ? clamp(v + (temporary[k] ?? 0), 80, 130)
        : k === "jump"
          ? clamp(v + (temporary[k] ?? 0), 80, 123)
          : k === "hands"
            ? v + (temporary[k] ?? 0)
            : clamp(v + (temporary[k] ?? 0), 0, 999),
    ]),
  );
}
/** Detail's attack row is NOT the damage range (4F13B0). */
export function detailRows(
  basis: StatBasis,
  temporary: Partial<Record<string, number>> = {},
  ammoPad: number = 0,
): string[] {
  if (!basis) return [];
  const b = basis.basic,
    s = basis.secondary,
    total = statTotals(basis, temporary),
    branch = Math.trunc(b.job / 100);
  const attack =
    s.pad + (branch === 3 ? b.dex : branch === 4 ? b.luk + Math.trunc((b.dex + b.str) / 4) : b.str);
  const withBonus = (base: number, bonus: number) =>
    bonus ? `${base + bonus} (${base}+${bonus})` : String(base);
  return [
    withBonus(attack, ammoPad + (temporary.pad ?? 0)),
    ...["pdd", "mad", "mdd", "acc", "eva", "hands"].map((k) => withBonus(s[k], temporary[k] ?? 0)),
    `${total.speed}%`,
    `${total.jump}%`,
  ];
}
