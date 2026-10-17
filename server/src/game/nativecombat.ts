/** Basic physical attacks: sub_4C7960, skill=null, one damage/target.
 * Native weapon/action coefficients, hit check, level penalty, PD and seven pre-drawn RNG values.
 * NOT magic, active skills, mob temporary stats or CShape2D target selection.
 */
import type { CharacterData } from "../protocol/chardata.ts";
import type { StatBasis } from "../../../client/characterstats.mjs";
import type { SkillCatalog } from "./skills.ts";
import { learnedSkillLevel } from "./skills.ts";
import { skillValues } from "./characterstats.ts";
export interface PhysicalMobStats {
  level: number;
  pd?: number;
  eva?: number;
  physicalAttribute?: number;
}
const clamp = (n: number, lo = 0, hi = 999) => Math.max(lo, Math.min(hi, n));
/** 4C9270 sorts the endpoints; equality still consumes the pre-drawn random slot. */
export function nativeUniform(word: number, a: number, b: number): number {
  return (
    Math.min(a, b) + (Math.abs(b - a) * ((word >>> 0) % 10000000)) / 9999999
  );
}
function mastery(
  character: CharacterData,
  skills: SkillCatalog | undefined,
  weapon: number,
  shot: boolean,
): number {
  const ids: Record<number, number[]> = shot
    ? { 45: [3100000], 46: [3200000], 47: [4100000] }
    : {
        30: [1100000, 1200000],
        40: [1100000, 1200000],
        31: [1100001],
        41: [1100001],
        32: [1200001],
        42: [1200001],
        33: [4200000],
        43: [1300000],
        44: [1300001],
      };
  for (const id of ids[weapon] ?? []) {
    const n = clamp(skillValues(character, skills, id).mastery ?? 0, 0, 15);
    if (n) return n;
  }
  return 0;
}
export function rollNativePhysical(
  character: CharacterData,
  basis: StatBasis,
  totals: Record<string, number>,
  mob: PhysicalMobStats,
  action: number,
  ammoPad: number,
  ammoId: number,
  skills: SkillCatalog | undefined,
  next: () => number,
): number {
  const random = Array.from({ length: 7 }, () => next());
  let cursor = 0;
  const uniform = (a: number, b: number) =>
    nativeUniform(random[cursor++ % 7]!, a, b);
  const b = basis.basic,
    branch = Math.trunc(b.job / 100),
    weapon = Math.trunc(basis.weaponId / 10000) % 100;
  const diff = Math.max(0, mob.level - b.level);
  const accuracy = (totals.acc! * 100) / (255 + diff * 10);
  const hit =
    branch === 3
      ? uniform(accuracy * 0.4, accuracy * 0.8)
      : uniform(accuracy * 0.5, accuracy * 1.5);
  if (hit < clamp(mob.eva ?? 0)) return 0;
  const pad = clamp(totals.pad! + ammoPad),
    factor =
      (mastery(character, skills, weapon, ammoId !== 0) * 5 + 10) *
      0.009000000000000001;
  const swing = action >= 5 && action <= 15;
  let raw = 0;
  if (
    ([45, 46, 47].includes(weapon) && !(action >= 22 && action <= 27)) ||
    action === 32
  ) {
    raw = uniform(b.str, b.str * 0.5) * pad * 0.006666666666666667;
  } else {
    switch (weapon) {
      case 30:
      case 33:
      case 40:
        raw =
          weapon === 33 && branch === 4
            ? (uniform(b.luk, b.luk * factor) * 4 + b.str + b.dex) * pad * 0.01
            : (uniform(b.str, b.str * factor) * 4 + b.dex) * pad * 0.01;
        break;
      case 31:
      case 32:
      case 37:
      case 38:
      case 41:
      case 42:
      case 44:
        raw =
          (uniform(b.str, b.str * factor) * (swing ? 4 : 2) + b.dex) *
          pad *
          0.01;
        break;
      case 43:
        raw =
          (uniform(b.str, b.str * factor) * (swing ? 2 : 4) + b.dex) *
          pad *
          0.01;
        break;
      case 45:
      case 46:
        raw = (uniform(b.dex, b.dex * factor) * 4 + b.str) * pad * 0.01;
        break;
      case 47:
        raw = (uniform(b.luk, b.luk * factor) * 4 + b.str + b.dex) * pad * 0.01;
        break;
    }
  }
  raw *= (100 - diff) * 0.01;
  if (mob.physicalAttribute === 1) raw *= 0.5;
  else if (mob.physicalAttribute === 2)
    raw = Math.min(9999, Math.max(raw, raw * 1.5));
  const pd = clamp(mob.pd ?? 0);
  let damage = raw - uniform(pd * 0.5, pd * 0.6);
  const critId =
    ammoId !== 0
      ? [45, 46].includes(weapon)
        ? 3000001
        : weapon === 47
          ? 4100002
          : 0
      : 0;
  const entry = critId ? skills?.info(critId) : undefined;
  const level = entry
    ? Math.min(
        entry.maxLevel,
        learnedSkillLevel(character.items?.map32, critId),
      )
    : 0;
  // This early client's surprising > threshold and level*5% multiplier are intentional:
  // PE 4C88B5..4C88CE agrees with the decompilation; do not substitute a later-version crit rule.
  if (level > 0 && uniform(0, 100) > 3 * level) damage *= 5 * level * 0.01;
  return Math.trunc(clamp(damage, 1, 9999));
}
