import {elementAttributes} from "./elements.ts";
/** Native skill books/prerequisites: sub_43FFB0, sub_4BAD60, sub_55ABE0. No invented SP rewards. */
import { nativeSkillBooks } from "../../../client/jobs.mjs";
import type { CharacterData, InventoryRecord } from "../protocol/chardata.ts";
import { emptyCharacterItems } from "../protocol/chardata.ts";
import type { SkillChange } from "../protocol/skills.ts";
import type { ItemSource, ItemIcon } from "./iteminfo.ts";
import { artReaderOf } from "./wzart.ts";
import { asText, entriesOf, propertyOf } from "../wz/props.ts";
/** Native VariantChangeType(VT_I4), including decimal BSTRs actually present in Data.wz.
 * Focus level20 acc is STRING "20". Never recover arithmetic by parsing the hs tooltip.
 */
export function skillNumericValue(value:unknown):number|undefined {
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'&&/^[+-]?\d+$/.test(value.trim())){
    const n=Number(value);if(Number.isInteger(n)&&n>=-2147483648&&n<=2147483647)return n;
  }
  return undefined;
}
export interface SkillLevel {
  level: number;
  hs: string;
  values: Record<string, number>;
}
export interface SkillInfo {
  id: number;
  bookId: number;
  name: string;
  desc: string;
  /** 4BC590 root metadata; not inferred from the skill book or effect art. */
  skillType?:number;
  elements?:number[];
  maxLevel: number;
  requirements: SkillChange[];
  levels: SkillLevel[];
  path: string;
  /** Native normal icon geometry, including origin, for CUIToolTip 503840. */
  icon?: ItemIcon;
}
export interface SkillBook {
  id: number;
  name: string;
  skills: SkillInfo[];
}
export interface SkillCatalog {
  book(id: number): SkillBook | undefined;
  info(id: number): SkillInfo | undefined;
}
export function skillCatalogOf(
  source: Pick<ItemSource, "has" | "objects">,
): SkillCatalog {
  const books = new Map<number, SkillBook | undefined>();
  const art = artReaderOf(source);
  const book = (id: number): SkillBook | undefined => {
    if (!Number.isInteger(id) || id < 100 || id >= 500) return undefined;
    if (books.has(id)) return books.get(id);
    const path = `Skill/${id}.img`;
    if (!source.has(path)) {
      books.set(id, undefined);
      return undefined;
    }
    const root = source.objects(path)[0];
    const skills: SkillInfo[] = [];
    // Preserve WZ enumeration order, just as the native loader appends SKILLENTRY refs.
    for (const { name, value } of entriesOf(propertyOf(root, "skill"))) {
      const skillId = Number(name);
      if (!Number.isInteger(skillId) || Math.floor(skillId / 10000) !== id)
        continue;
      const levels: SkillLevel[] = [];
      for (const { name: levelName, value: row } of entriesOf(
        propertyOf(value, "level"),
      )) {
        const level = Number(levelName);
        if (!Number.isInteger(level) || level <= 0) continue;
        const values: Record<string, number> = {};
        for (const prop of entriesOf(row)) {
          const number=skillNumericValue(prop.value);
          if(number!==undefined)values[prop.name]=number;
        }
        levels.push({ level, hs: asText(propertyOf(row, "hs")), values });
      }
      levels.sort((a, b) => a.level - b.level);
      const maxLevel = levels.at(-1)?.level ?? 0;
      const requirements: SkillChange[] = entriesOf(
        propertyOf(value, "req"),
      ).map(({ name, value }) => ({
        skillId: Number(name),
        level: skillNumericValue(value)??NaN,
      }));
      // Refuse malformed prerequisites rather than making a broken node freely learnable.
      if (
        requirements.some(
          (r) =>
            !Number.isInteger(r.skillId) ||
            r.skillId <= 0 ||
            !Number.isInteger(r.level) ||
            r.level < 0,
        )
      )
        continue;
      const elements=elementAttributes(propertyOf(value,"elemAttr"));
      if(!elements)continue;
      const iconPath = `${path}/skill/${name}/icon`;
      const icon = art.at(iconPath);
      skills.push({
        id: skillId,
        bookId: id,
        name: asText(propertyOf(value, "name")),
        desc: asText(propertyOf(value, "desc")),
        skillType:skillNumericValue(propertyOf(value,"skillType"))??0,
        elements,
        maxLevel,
        requirements,
        levels,
        path: `${path}/skill/${name}`,
        ...(icon ? {icon: {path: iconPath, width: icon.width, height: icon.height, ox: icon.ox, oy: icon.oy}} : {}),
      });
    }
    const result = {
      id,
      name: asText(propertyOf(propertyOf(root, "info"), "bookName")),
      skills,
    };
    books.set(id, result);
    return result;
  };
  return {
    book,
    info: (id) => {
      if (!Number.isInteger(id) || id <= 0 || id > 0x7fffffff) return undefined;
      return book(Math.floor(id / 10000))?.skills.find(
        (skill) => skill.id === id,
      );
    },
  };
}
/** Last record wins, matching ZMap insertion. No save schema migration. */
export function learnedSkillLevel(
  records: readonly InventoryRecord[] | undefined,
  id: number,
): number {
  const level = records?.filter((r) => r.key === id).at(-1)?.value ?? 0;
  return Number.isInteger(level) && level > 0 ? level : 0;
}
export function learnedSkills(
  records: readonly InventoryRecord[] | undefined,
): SkillChange[] {
  const map = new Map<number, number>();
  for (const r of records ?? []) {
    if (r.value > 0) map.set(r.key, r.value);
    else map.delete(r.key);
  }
  return [...map].map(([skillId, level]) => ({ skillId, level }));
}
/** 0 blocked by prerequisites, -1 already maxed, 1 learnable: native sub_55ABE0. */
export function skillLearnState(
  info: SkillInfo,
  records: readonly InventoryRecord[] | undefined,
): -1 | 0 | 1 {
  if (
    info.requirements.some(
      (r) => learnedSkillLevel(records, r.skillId) < r.level,
    )
  )
    return 0;
  return learnedSkillLevel(records, info.id) >= info.maxLevel ? -1 : 1;
}
/** Server-authoritative single SP transaction. Native book ancestry + req/max; no client-supplied levels. */
export function spendSkillPoint(
  character: CharacterData,
  skillId: number,
  catalog: SkillCatalog | undefined,
): SkillChange | undefined {
  const stats = character.stats;
  if (
    !(stats.hp > 0) ||
    !Number.isInteger(stats.sp) ||
    stats.sp <= 0 ||
    stats.sp > 0x7fff
  )
    return undefined;
  const info = catalog?.info(skillId);
  if (
    !info ||
    !nativeSkillBooks(stats.job).includes(info.bookId) ||
    info.maxLevel <= 0 ||
    skillLearnState(info, character.items?.map32) !== 1
  )
    return undefined;
  const old = learnedSkillLevel(character.items?.map32, skillId),
    level = old + 1;
  if (!info.levels.some((r) => r.level === level)) return undefined;
  const items = character.items ?? emptyCharacterItems();
  items.map32 = [
    ...items.map32.filter((r) => r.key !== skillId),
    { key: skillId, value: level },
  ];
  character.items = items;
  character.flags |= 0x20;
  stats.sp--;
  return { skillId, level };
}
