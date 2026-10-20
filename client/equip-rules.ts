import type { StatInput, StatItem, StatRequirements } from "./characterstats.ts";
export interface EquipCandidate {
  itemId: number;
  cash?: unknown;
}
export interface EquipInventory {
  worn: StatItem[];
  tabs: { tab: number; capacity: number; items: { slot: number }[] }[];
}
/** Pure native equipment admission, shared by browser and server safety policy. No DOM. */
import { effectiveWorn, signedEquipStat } from "./characterstats.ts";
/**
 * The body part an item id names on its own - the double-click sender's switch (`sub_463490`, the
 * `sub_4636B0` caller): `switch (itemId / 10000)` with cases 'd'..'n' = 100..110 -> 1,2,3,4,5,5,
 * 6,7,8,10,9, the `default` branch taking `itemId / 100000` 13/14 (weapons) -> 11, and everything
 * else (a pendant 112xxxx, a face, a consumable) refused outright.
 *
 * The one code the switch treats differently is 111 (rings, case 'o'): it accepts the *clicked
 * cell* being 12 **or** 13 - the id alone does not name a single part, so `bodyPart` stays 0 for
 * it and `partFitsItem` carries the two-cell rule. (Data.wz ships no `Character/011*.img`, so the
 * ring cells have no content in this version; the sender exists anyway.)
 */
export function bodyPart(id: number): number {
  const p = Math.floor(id / 10000);
  return (
    {
      100: 1,
      101: 2,
      102: 3,
      103: 4,
      104: 5,
      105: 5,
      106: 6,
      107: 7,
      108: 8,
      109: 10,
      110: 9,
    }[p] ?? ([13, 14].includes(Math.floor(id / 100000)) ? 11 : 0)
  );
}
/**
 * Whether `part` (a worn slot 1..14, i.e. a negative `0x17` slot negated) can hold `id` - the
 * double-click switch's own test, which for every code but 111 is `part === bodyPart(id)` and for
 * 111 (rings) is `part === 12 || part === 13` (case 'o': cell 12 goes to `LABEL_36` with the
 * clicked cell, cell 13 to a hardcoded `sub_4636B0(this, item, 13)`, any other cell returns 0).
 */
export function partFitsItem(part: number, id: number): boolean {
  if (!Number.isInteger(part) || part < 1 || part > 14) return false;
  if (Math.floor(id / 10000) === 111) return part === 12 || part === 13;
  return part === bodyPart(id);
}
export function equipConflict(id: number, worn: { slot: number; itemId: number }[] = []): number {
  const has = (n: number) => worn.find((i) => i.slot === n);
  return Math.floor(id / 100000) === 14 && has(10)
    ? 10
    : Math.floor(id / 10000) === 109 && Math.floor((has(11)?.itemId ?? 0) / 100000) === 14
      ? 11
      : Math.floor(id / 10000) === 105 && has(6)
        ? 6
        : Math.floor(id / 10000) === 106 && Math.floor((has(5)?.itemId ?? 0) / 10000) === 105
          ? 5
          : 0;
}
export function firstBagSlot(inventory: EquipInventory | undefined, tab: number): number {
  const t = inventory?.tabs.find((t) => t.tab === tab);
  if (!t) return 0;
  for (let i = 1; i <= t.capacity; i++) if (!t.items.some((x) => x.slot === i)) return i;
  return 0;
}
/** sub_4636B0/sub_4658E0: exclude replaced/conflicting equips BEFORE checking the new item.
 * Base stats and per-instance wire stats, never the WZ template's incSTR as a substitute.
 * 4636B0 runs 4C5020 ONCE first, then deletes replaced/conflicting slots before BasicStat.
 * Do not re-filter after exclusion: dependent gear can retain its admission-time bonus. */
export function canWear(
  item: EquipCandidate,
  facts: { cash?: boolean; requirements?: StatRequirements } | null | undefined,
  self: (StatInput & { hp: number }) | undefined,
  inventory: EquipInventory | undefined,
  part: number = bodyPart(item.itemId),
  wornFacts: StatItem[] = inventory?.worn ?? [],
): string | undefined {
  if (!self || self.hp <= 0) return "角色死亡時不能穿戴裝備。";
  // The native wear path has NO cash gate: `sub_47A420` (the WZ `info/cash` reader) has exactly
  // three call sites - the throw-away refusal (`sub_463BE0`), the CUIItem trade/move refusal and a
  // list builder that excludes cash items (`sub_4B4AD0`) - none of them on the double-click/drag
  // wear chain, and `sub_4C5020` reads the worn group with no cash test either. A cash-flagged
  // equip (1002000) wears into the ordinary worn slot of its part; `wornCash` is server-owned
  // storage no client sender can address (`sub_465710` maps negative slots -1..-14 into the
  // ordinary worn group only). The part gate is the switch's own: `partFitsItem`.
  if (!partFitsItem(part, item.itemId)) return "此裝備部位尚不支援。";
  const req = facts?.requirements;
  if (!req) return "正在讀取原始裝備需求，請稍後再試。";
  const gender = Math.floor(item.itemId / 1000) % 10;
  if (gender !== 2 && self.gender !== 2 && gender !== self.gender)
    return "角色性別不符合裝備需求。";
  const jobGroup = Math.trunc(self.job / 100),
    weapon = Math.floor(item.itemId / 10000) % 100;
  if (
    jobGroup === 2 &&
    Math.floor(item.itemId / 100000) >= 13 &&
    Math.floor(item.itemId / 100000) <= 14 &&
    weapon >= 40 &&
    weapon <= 47
  )
    return "法師不能使用這個武器種類。";
  if (req.job !== 0 && (req.job & (jobGroup === 0 ? 0 : 1 << (jobGroup - 1))) === 0)
    return "職業不符合裝備需求。";
  const conflict = equipConflict(item.itemId, inventory?.worn),
    replaced = inventory?.worn.find((x) => x.slot === part);
  if (conflict && replaced && !firstBagSlot(inventory, 1)) return "裝備欄沒有空位放置衝突的裝備。";
  const total = { str: self.str, dex: self.dex, int: self.int, luk: self.luk };
  if (wornFacts.some((i) => i.slot !== part && i.slot !== conflict && !i.requirements))
    return "正在讀取已穿裝備的原始需求，請稍後再試。";
  for (const worn of effectiveWorn(self, wornFacts).filter(
    (i) => i.slot !== part && i.slot !== conflict,
  ))
    for (const k of ["str", "dex", "int", "luk"] as const)
      total[k] += signedEquipStat(worn.stats?.[k]);
  if (self.level < req.level)
    return (
      `需要 Lv${req.level}，目前 Lv${self.level}。` +
      (part === 11 && [145, 146, 147].includes(Math.trunc(item.itemId / 10000))
        ? "遠距體驗工具另有最低級原裝備及明確補級入口。"
        : "")
    );
  const missing = (["str", "dex", "int", "luk"] as const).filter((k) => total[k] < req[k]);
  if (missing.length)
    return `裝備需求不足：${missing.map((k) => `${k.toUpperCase()} ${total[k]}/${req[k]}`).join("、")}（不含被替換／衝突裝備）。`;
  return undefined;
}
