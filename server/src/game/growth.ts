import { characterStatBasis } from "./characterstats.ts";
import type { ItemCatalog } from "./iteminfo.ts";
/** HP/MP growth from sub_4C7450 and PE .data:005BB344; see docs/STAT_GROWTH.md.
 * This is not the damage formula. Natural growth uses row 2*floor(job/100), AP uses the next row.
 * RNG is server-owned: reproduce rand()%width, not the original process's hidden random seed.
 */
import type { CharacterData, CharacterStats, InventoryRecord } from "../protocol/chardata.ts";
import { ABILITY_MASK } from "../protocol/ability.ts";
import type { StatDiff } from "../protocol/stat.ts";
import type { ItemSource } from "./iteminfo.ts";
import { asNumber, entriesOf, propertyOf } from "../wz/props.ts";

export const MAX_BASE_HP = 30000;
export const MAX_BASE_MP = 10000;
/** Six signed DWORDs per row; column 2 is present but unused by sub_4C7450. */
export const VITAL_GROWTH_ROWS: readonly (readonly number[])[] = [
  [20, 25, 0, 10, 12, 20],
  [15, 20, 0, 6, 8, 15],
  [40, 45, 0, 4, 6, 20],
  [35, 40, 0, 2, 4, 15],
  [10, 15, 0, 22, 24, 20],
  [5, 10, 0, 18, 20, 15],
  [20, 25, 0, 10, 12, 20],
  [15, 20, 0, 6, 8, 15],
  [20, 25, 0, 10, 12, 20],
  [15, 20, 0, 6, 8, 15],
];
export type GrowthMode = "level" | "ap";
export type GrowthSkillProvider = (
  skillId: number,
  level: number,
) => { x: number; y: number } | undefined;
export interface GrowthContext {
  /** CharacterData flag 0x20, native CharacterData+382 ZMap: skill id -> learned level. */
  skills?: readonly InventoryRecord[];
  skill?: GrowthSkillProvider;
  /** BasicStat INT (base + normal worn equips), NOT cash look or loose inventory items. */
  intelligence?: number;
  /** A rand()-shaped integer in 0..32767; injectable without making the client authoritative. */
  rand15?: () => number;
}

/** Read actual x/y numbers, never parse the Korean hs text (warrior level 10 disagrees with it). */
export function growthSkillProvider(
  source: Pick<ItemSource, "has" | "objects">,
): GrowthSkillProvider {
  const cache = new Map<number, Map<number, { x: number; y: number }>>();
  return (skillId, level) => {
    if (![1000001, 2000001].includes(skillId) || !Number.isInteger(level) || level <= 0)
      return undefined;
    let levels = cache.get(skillId);
    if (levels === undefined) {
      levels = new Map();
      const path = `Skill/${Math.floor(skillId / 10000)}.img`;
      if (source.has(path)) {
        const root = source.objects(path)[0];
        const entry = propertyOf(propertyOf(root, "skill"), String(skillId));
        const block = propertyOf(entry, "level");
        for (const { name, value: row } of entriesOf(block)) {
          const n = Number(name);
          if (!Number.isInteger(n) || n <= 0) continue;
          levels.set(n, {
            x: asNumber(propertyOf(row, "x")),
            y: asNumber(propertyOf(row, "y")),
          });
        }
      }
      cache.set(skillId, levels);
    }
    // sub_4C7450 clamps positive learned levels to the loaded skill-level array length.
    return levels.size > 0 ? levels.get(Math.min(level, Math.max(...levels.keys()))) : undefined;
  };
}

/** sub_4C5420 adds the normal worn set to BasicStat INT; the cash array is appearance only.
 * With archive metadata, 4C5020 filters invalid dependencies before INT is summed.
 * The metadata-free legacy fixture path below is not the live Data.wz path.
 */
export function characterGrowthContext(
  character: CharacterData,
  skill?: GrowthSkillProvider,
  catalog?: ItemCatalog,
): GrowthContext {
  if (catalog)
    return {
      intelligence: characterStatBasis(character, catalog).basic.int,
      skills: character.items?.map32,
      skill,
    };
  let intelligence = character.stats.int;
  for (const [slot, item] of character.items?.worn ?? []) {
    if (slot < 1 || slot > 14 || item.kind !== "equip") continue;
    const value = item.int;
    if (Number.isInteger(value) && value >= 0 && value <= 0xffff)
      intelligence += value >= 0x8000 ? value - 0x10000 : value;
  }
  return { intelligence, skills: character.items?.map32, skill };
}

/** Apply only maxima, never current HP/MP or AP. The callers own refill and point accounting. */
export function growVitals(
  stats: CharacterStats,
  mask: number,
  mode: GrowthMode,
  context: GrowthContext = {},
): StatDiff {
  if (!Number.isInteger(stats.job) || stats.job < 0 || stats.job >= 500) return {};
  const row = VITAL_GROWTH_ROWS[2 * Math.floor(stats.job / 100) + (mode === "ap" ? 1 : 0)]!;
  const rand = context.rand15 ?? (() => Math.floor(Math.random() * 0x8000));
  const roll = (min: number, max: number): number => {
    const value = rand();
    if (!Number.isInteger(value) || value < 0 || value > 0x7fff)
      throw new RangeError("growth RNG must return 0..32767");
    return min + (value % (max - min + 1));
  };
  const bonus = (id: number): number => {
    // The native ZMap is last-write-wins, including when a saved map contains duplicate keys.
    const learned = context.skills?.filter((entry) => entry.key === id).at(-1)?.value ?? 0;
    if (!Number.isInteger(learned) || learned <= 0) return 0;
    const passive = context.skill?.(id, learned);
    const value = passive?.[mode === "level" ? "x" : "y"] ?? 0;
    return Number.isInteger(value) && value >= 0 ? value : 0;
  };
  const diff: StatDiff = {};
  if (
    (mask & ABILITY_MASK.maxHp) !== 0 &&
    Number.isInteger(stats.maxHp) &&
    stats.maxHp >= 0 &&
    stats.maxHp < MAX_BASE_HP
  )
    diff.maxHp = Math.max(
      50,
      Math.min(MAX_BASE_HP, stats.maxHp + roll(row[0]!, row[1]!) + bonus(1000001)),
    );
  const intelligence = context.intelligence ?? stats.int;
  if (
    (mask & ABILITY_MASK.maxMp) !== 0 &&
    Number.isInteger(stats.maxMp) &&
    stats.maxMp >= 0 &&
    stats.maxMp < MAX_BASE_MP &&
    Number.isSafeInteger(intelligence)
  )
    diff.maxMp = Math.max(
      5,
      Math.min(
        MAX_BASE_MP,
        stats.maxMp +
          roll(row[3]!, row[4]!) +
          Math.trunc((intelligence * row[5]!) / 200) +
          bonus(2000001),
      ),
    );
  // Compute before mutating: a failed provider/RNG cannot leave a half-written HP/MP pair.
  Object.assign(stats, diff);
  return diff;
}
