/** The browser bridge and server-side vital/growth policies share the native effective worn set. */
import type { CharacterData } from "../protocol/chardata.ts";
import { EQUIP_STATS } from "../protocol/itemslot.ts";
import type { ItemCatalog } from "./iteminfo.ts";
import { learnedSkillLevel, type SkillCatalog } from "./skills.ts";
import { statBasis, type StatItem } from "../../../client/characterstats.mjs";
export { statTotals } from "../../../client/characterstats.mjs";
export function skillValues(
  character: CharacterData,
  catalog: SkillCatalog | undefined,
  id: number,
): Record<string, number> {
  const skill = catalog?.info(id),
    learned = learnedSkillLevel(character.items?.map32, id);
  return learned && skill
    ? (skill.levels.find((r) => r.level === Math.min(learned, skill.maxLevel))
        ?.values ?? {})
    : {};
}
export function characterStatBasis(
  character: CharacterData,
  catalog?: ItemCatalog,
  skills?: SkillCatalog,
) {
  const worn: StatItem[] = [];
  for (const [slot, item] of character.items?.worn ?? [])
    if (item.kind === "equip")
      worn.push({
        slot,
        itemId: item.itemId,
        stats: Object.fromEntries(EQUIP_STATS.map((k) => [k, item[k]])),
        requirements: catalog?.info(item.itemId)?.requirements,
      });
  const amazon = skillValues(character, skills, 3000000),
    nimble = skillValues(character, skills, 4000000);
  return statBasis(character.stats, worn, {
    amazonAccuracy: amazon.x ?? 0,
    nimbleAccuracy: nimble.x ?? 0,
    nimbleAvoid: nimble.y ?? 0,
  });
}
