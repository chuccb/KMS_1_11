/** Basic physical attacks: sub_4C7960, skill=null, one damage/target.
 * Native weapon/action coefficients, hit check, level penalty, PD and seven pre-drawn RNG values.
 * Physical active percentage/hit loops share this path; NOT magic or CShape2D.
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
/** Read-only browser/operator breakdown, NOT a native opcode or a new damage rule. */
export interface PhysicalAttackTrace {
  weaponId: number;
  action: number;
  basePad: number;
  temporaryPad: number;
  ammoPad: number;
  pad: number;
  hitRoll: number;
  mobEva: number;
  levelDifference: number;
  mastery: number;
  raw: number;
  afterLevel: number;
  afterAttribute: number;
  defense: number;
  criticalMultiplier: number;
  beforeClamp: number;
  damage: number;
  reason: "miss" | "zero-pad" | "no-effective-weapon" | "minimum" | "hit";
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
  report?: (trace: PhysicalAttackTrace) => void,
  active?: {damagePercent:number;skillId?:number;random?:{values:number[];cursor:number}},
): number {
  const stream=active?.random ?? {values:Array.from({length:7},()=>next()),cursor:0};
  const uniform = (a: number, b: number) =>
    nativeUniform(stream.values[stream.cursor++ % 7]!, a, b);
  const b = basis.basic,
    branch = Math.trunc(b.job / 100),
    weapon = Math.trunc(basis.weaponId / 10000) % 100;
  const diff = Math.max(0, mob.level - b.level);
  const accuracy = (totals.acc! * 100) / (255 + diff * 10);
  const hit =
    branch === 3
      ? uniform(accuracy * 0.4, accuracy * 0.8)
      : uniform(accuracy * 0.5, accuracy * 1.5);
  const pad = clamp(totals.pad! + ammoPad), mobEva = clamp(mob.eva ?? 0);
  const trace: PhysicalAttackTrace = {
    weaponId: basis.weaponId, action, basePad: basis.secondary.pad!,
    temporaryPad: totals.pad! - basis.secondary.pad!, ammoPad, pad,
    hitRoll: hit, mobEva, levelDifference: diff, mastery: 0,
    raw: 0, afterLevel: 0, afterAttribute: 0, defense: 0,
    criticalMultiplier: 1, beforeClamp: 0, damage: 0, reason: "miss",
  };
  if (hit < mobEva) { report?.(trace); return 0; }
  const masteryLevel = mastery(character, skills, weapon, ammoId !== 0);
  trace.mastery = masteryLevel;
  const factor = (masteryLevel * 5 + 10) * 0.009000000000000001;
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
        // 4C7960 case47: Lucky Seven bypasses mastery/STR/DEX, still uses PAD+star PAD.
        raw = active?.skillId===4001344
          ? uniform(b.luk*1.3,b.luk*0.5)*5*pad*0.01
          : (uniform(b.luk, b.luk * factor) * 4 + b.str + b.dex) * pad * 0.01;
        break;
    }
  }
  trace.raw = raw;
  raw *= (100 - diff) * 0.01;
  trace.afterLevel = raw;
  if (mob.physicalAttribute === 1) raw *= 0.5;
  else if (mob.physicalAttribute === 2)
    raw = Math.min(9999, Math.max(raw, raw * 1.5));
  trace.afterAttribute = raw;
  const pd = clamp(mob.pd ?? 0);
  const defense = uniform(pd * 0.5, pd * 0.6);
  trace.defense = defense;
  let damage = raw - defense;
  // 4C7960 LABEL_177: skill percentage AFTER PD subtraction, BEFORE critical and final clamp.
  if(active && active.damagePercent>0)damage*=active.damagePercent*0.01;
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
  if (level > 0 && uniform(0, 100) > 3 * level) {
    trace.criticalMultiplier = 5 * level * 0.01;
    damage *= trace.criticalMultiplier;
  }
  trace.beforeClamp = damage;
  const result = Math.trunc(clamp(damage, 1, 9999));
  trace.damage = result;
  trace.reason = !basis.weaponId ? "no-effective-weapon" : pad === 0 ? "zero-pad"
    : damage < 2 ? "minimum" : "hit";
  report?.(trace);
  return result; // Observers cannot change the computed attack through the trace object.
}

/** Touch damage, 4C8ED0. Independent second RNG stream; MISS consumes only the EVA draw.
 * Mob temporary stats are not implemented. PA/acc here are the original loader fields,
 * deliberately not aliases for later PADamage/PDDamage properties in some archive images.
 */
export function rollNativeTouch(
  basic: StatBasis["basic"],
  totals: Record<string, number>,
  mob: { level: number; pa?: number; acc?: number },
  random: () => number,
): number {
  let eva = clamp(totals.eva ?? 0);
  if (basic.level < mob.level)
    eva = Math.max(0, eva - Math.trunc((mob.level - basic.level) / 2));
  if (nativeUniform(random(), eva * 0.1, eva) >= clamp(mob.acc ?? 0)) return 0;
  const pa = clamp(mob.pa ?? 0),
    pdd = clamp(totals.pdd ?? 0);
  let damage = nativeUniform(random(), pa * 0.7, pa * 0.8) * pa * 0.01;
  switch (Math.trunc(basic.job / 100)) {
    case 1:
      damage -=
        ((basic.str * 0.15 + basic.dex * 0.1) * pdd) / (basic.level * 2.5);
      break;
    case 2:
      damage -= ((basic.dex + basic.str) * 0.5 * pdd) / (basic.level * 2.2);
      break;
    case 3:
    case 4:
      damage -=
        ((basic.str * 0.2 + basic.dex * 0.1) * pdd) / (basic.level * 2.5);
      break;
  }
  return Math.trunc(clamp(damage, 1, 9999));
}
