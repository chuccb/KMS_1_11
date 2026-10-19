/**
 * Upgrade scrolls (the `0204` family) - what one does to one equip.
 *
 * EVIDENCE
 * -----------------------------------------------------------------------------
 * The client's own drag handler (`.c:~107952`, the branch that ends in `sub_55B0E0`) fixes three
 * things about a scroll before it will even send `0x1A`:
 *
 * - the dragged item is a scroll: `itemId / 10000 == 204`;
 * - the drop target is an equip: `itemId / 1000000 == 1`;
 * - the two are the same *category*: `(scrollId % 10000) / 100 == (equipId / 10000) % 100`.
 *
 * That category number is the equip's body/weapon class, and the WZ names line up with it exactly
 * (cat 0 = 투구/`100xxxx`, 4 = 상의/`104xxxx`, 30 = 한손검/`130xxxx`, 45 = 활/`145xxxx`, …). The
 * effect itself is `Item/Consume/0204.img/<id>/info`: a `success` percentage (the whole family is
 * 10 / 60 / 100) and the `inc*` stat deltas it adds on a success. There is no `spec` on a scroll
 * (FINDINGS 4.34.3) - it is not "used on yourself", it is used on another item.
 *
 * WHAT IS SERVER POLICY (there is no original server binary)
 * -----------------------------------------------------------------------------
 * - The success *roll*. The client only sends the two slots; the server decides. We roll the
 *   field's own `ClientRandom` (`protocol/random.ts`) so a seeded session is reproducible.
 * - Slot accounting. The wire equip carries `ruc` (남은 업그레이드 횟수, remaining) and `cuc`
 *   (업그레이드에 사용된 횟수, used). One use consumes exactly one slot whether it succeeds or
 *   fails: `ruc -= 1`, `cuc += 1`, so `ruc + cuc` stays the item's original total. The stat
 *   deltas are added **only on a success**. This era's scrolls carry no `recover`/`destroy`
 *   field, so a failure never destroys the equip.
 */
import { recordOf, propertyOf } from "../wz/props.ts";
import { itemImagePath } from "../wz/paths.ts";
import type { WzArchive } from "../wz/archive.ts";
import type { EquipStat, ItemSlotEquip } from "../protocol/itemslot.ts";

/**
 * The WZ `info/inc*` field for each equip stat, in the order the archive spells them. A scroll
 * carries only the handful it touches; anything absent is left alone.
 */
export const SCROLL_INC_TO_STAT: Readonly<Record<string, EquipStat>> = {
  incSTR: "str",
  incDEX: "dex",
  incINT: "int",
  incLUK: "luk",
  incMHP: "maxHp",
  incMMP: "maxMp",
  incPAD: "pad",
  incMAD: "mad",
  incPDD: "pdd",
  incMDD: "mdd",
  incACC: "acc",
  incEVA: "eva",
  incCraft: "craft",
  incSpeed: "speed",
  incJump: "jump",
};

/** One scroll's `info`, as far as this server reads it. */
export interface ScrollSpec {
  /** `info/success`: the percent chance (0..100) the deltas are applied. */
  success: number;
  /** The per-stat deltas a success adds; only fields that are present and non-zero. */
  inc: Partial<Record<EquipStat, number>>;
}

/**
 * What one scroll does, read out of `Item/Consume/0204.img/<itemId>/info`.
 *
 * `undefined` means "this is not a scroll this server can apply": not a `204` id, no archive
 * (`--data off`), no such node, or no usable `success`. The caller is a packet handler, so this is
 * an answer, never an exception.
 */
export function scrollSpecOf(
  archive: WzArchive | undefined,
  itemId: number,
): ScrollSpec | undefined {
  if (archive === undefined) return undefined;
  if (!Number.isInteger(itemId) || Math.floor(itemId / 10000) !== 204) return undefined;
  let path: string;
  try {
    path = itemImagePath(itemId);
  } catch {
    return undefined;
  }
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  const node = propertyOf(root, String(itemId).padStart(8, "0"));
  if (node === undefined) return undefined;
  const info = recordOf(node, "info");
  const success = info["success"];
  if (typeof success !== "number" || !Number.isInteger(success) || success < 0 || success > 100) {
    return undefined;
  }
  const inc: Partial<Record<EquipStat, number>> = {};
  for (const [wzName, stat] of Object.entries(SCROLL_INC_TO_STAT)) {
    const value = info[wzName];
    if (typeof value === "number" && Number.isInteger(value) && value !== 0) inc[stat] = value;
  }
  return { success, inc };
}

/** The spec reader over one archive, as `GameEntryServerOptions.scrollSpec` wants it. */
export function scrollSpecProvider(
  archive: WzArchive | undefined,
): (itemId: number) => ScrollSpec | undefined {
  return (itemId) => scrollSpecOf(archive, itemId);
}

/**
 * The client's own compatibility gate (`.c:~107952`): the source is a `204` scroll, the target is
 * a `1xxxxxx` equip, and the scroll's category `(scrollId % 10000) / 100` equals the equip's
 * category `(equipId / 10000) % 100`. The server re-checks it because a packet can name anything.
 */
export function scrollMatchesEquip(scrollId: number, equipId: number): boolean {
  if (!Number.isInteger(scrollId) || !Number.isInteger(equipId)) return false;
  if (Math.floor(scrollId / 10000) !== 204) return false;
  if (Math.floor(equipId / 1000000) !== 1) return false;
  return Math.floor((scrollId % 10000) / 100) === Math.floor(equipId / 10000) % 100;
}

/**
 * Apply one scroll to one equip and return the new record.
 *
 * The upgrade slot is always consumed (`ruc -= 1`, `cuc += 1`); the `inc` deltas are added only
 * when `success` is true. The caller has already checked `ruc >= 1`, so `ruc - 1` cannot go
 * negative, and neither counter is clamped here - a `255`-slot equip is not a thing the archive
 * makes. The input record is not mutated.
 */
export function applyScroll(
  equip: ItemSlotEquip,
  spec: ScrollSpec,
  success: boolean,
): ItemSlotEquip {
  const out: ItemSlotEquip = { ...equip, ruc: equip.ruc - 1, cuc: equip.cuc + 1 };
  if (success) {
    for (const [stat, amount] of Object.entries(spec.inc)) {
      const key = stat as EquipStat;
      out[key] = (out[key] ?? 0) + (amount as number);
    }
  }
  return out;
}
