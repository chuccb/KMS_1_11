/** Pure native equipment admission, shared by browser and server safety policy. No DOM. */
import {effectiveWorn,signedEquipStat} from './characterstats.mjs';
export function bodyPart(id) {
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
export function equipConflict(id, worn = []) {
  const has = (n) => worn.find((i) => i.slot === n);
  return Math.floor(id / 100000) === 14 && has(10)
    ? 10
    : Math.floor(id / 10000) === 109 &&
        Math.floor((has(11)?.itemId ?? 0) / 100000) === 14
      ? 11
      : Math.floor(id / 10000) === 105 && has(6)
        ? 6
        : Math.floor(id / 10000) === 106 &&
            Math.floor((has(5)?.itemId ?? 0) / 10000) === 105
          ? 5
          : 0;
}
export function firstBagSlot(inventory, tab) {
  const t = inventory?.tabs.find((t) => t.tab === tab);
  if (!t) return 0;
  for (let i = 1; i <= t.capacity; i++)
    if (!t.items.some((x) => x.slot === i)) return i;
  return 0;
}
/** sub_4636B0/sub_4658E0: exclude replaced/conflicting equips BEFORE checking the new item.
 * Base stats and per-instance wire stats, never the WZ template's incSTR as a substitute.
 * 4636B0 runs 4C5020 ONCE first, then deletes replaced/conflicting slots before BasicStat.
 * Do not re-filter after exclusion: dependent gear can retain its admission-time bonus. */
export function canWear(
  item,
  facts,
  self,
  inventory,
  part = bodyPart(item.itemId),
  wornFacts = inventory?.worn ?? [],
) {
  if (!self || self.hp <= 0) return "角色死亡時不能穿戴裝備。";
  if (!part || part !== bodyPart(item.itemId) || facts?.cash || item.cash)
    return "此裝備部位或現金裝備尚不支援。";
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
  if (
    req.job !== 0 &&
    (req.job & (jobGroup === 0 ? 0 : 1 << (jobGroup - 1))) === 0
  )
    return "職業不符合裝備需求。";
  const conflict = equipConflict(item.itemId, inventory?.worn),
    replaced = inventory?.worn.find((x) => x.slot === part);
  if (conflict && replaced && !firstBagSlot(inventory, 1))
    return "裝備欄沒有空位放置衝突的裝備。";
  const total = { str: self.str, dex: self.dex, int: self.int, luk: self.luk };
  if (
    wornFacts.some(
      (i) => i.slot !== part && i.slot !== conflict && !i.requirements,
    )
  )
    return "正在讀取已穿裝備的原始需求，請稍後再試。";
  for (const worn of effectiveWorn(self, wornFacts).filter(i=>i.slot!==part&&i.slot!==conflict))
    for (const k of Object.keys(total))
      total[k] += signedEquipStat(worn.stats?.[k]);
  if(self.level<req.level)return `需要 Lv${req.level}，目前 Lv${self.level}。`+(part===11&&[145,146,147].includes(Math.trunc(item.itemId/10000))?"遠距體驗工具另有最低級原裝備及明確補級入口。":"");
  const missing=Object.keys(total).filter(k=>total[k]<req[k]);
  if(missing.length)return `裝備需求不足：${missing.map(k=>`${k.toUpperCase()} ${total[k]}/${req[k]}`).join('、')}（不含被替換／衝突裝備）。`;
  return undefined;
}
