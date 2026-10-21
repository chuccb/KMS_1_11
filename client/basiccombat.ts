import type { BasicAttackAction } from "../server/src/game/basicattack.ts";
import { ATTACK_ORIGIN_HEIGHT, shotNearDistance } from "./attack-presentation.ts";
import { isRechargeableItem } from "./inventory-window.ts";
export interface AmmunitionItem {
  slot: number;
  itemId: number;
  quantity?: number;
}
/** Basic attacks, not skill animation/state. Action ids come from the native attack selectors. */
export function weaponIdOf(look: { items?: readonly number[] } | undefined) {
  return look?.items?.find((id) => id >= 1300000 && id < 1500000) ?? 0;
}
/**
 * The three ammunition families `sub_511630` knows, and the divisor it takes each one with.
 *
 * `sub_4657F0` reduces a weapon to `weaponId / 10000 % 100`, but only for a `13xxxxx`/`14xxxxx`
 * one - everything else answers 0, which is not a family. `sub_511630` then keeps three of those,
 * and compares the USE tab against `itemId / 1000 - 2060` (45, a bow), `- 2061` (46, a crossbow)
 * and `itemId / 10000 - 207` (47, a claw). A sword, a wand and bare hands all fall through to the
 * `default:`, which is why no other weapon ever asks for ammunition.
 */
export type AmmunitionMatch = { kind: "arrows" } | { kind: "bolts" } | { kind: "stars" };

export const AMMUNITION_FAMILY = { arrows: 2060, bolts: 2061 } as const;

/** Which family the weapon takes, or `undefined` for one that takes none. */
export function ammunitionMatch(weaponId: number): AmmunitionMatch | undefined {
  const group = Math.trunc(weaponId / 100000);
  if (group !== 13 && group !== 14) return undefined;
  switch (Math.trunc(weaponId / 10000) % 100) {
    case 45:
      return { kind: "arrows" };
    case 46:
      return { kind: "bolts" };
    case 47:
      return { kind: "stars" };
    default:
      return undefined;
  }
}

/** Whether `sub_511630` would accept this item for this weapon, before the quantity is looked at. */
export function isAmmunitionFor(weaponId: number, itemId: number): boolean {
  switch (ammunitionMatch(weaponId)?.kind) {
    case "arrows":
      return Math.trunc(itemId / 1000) === AMMUNITION_FAMILY.arrows;
    case "bolts":
      return Math.trunc(itemId / 1000) === AMMUNITION_FAMILY.bolts;
    case "stars":
      // The claw's 207 block is the rechargeable family the inventory and the shop both test.
      return isRechargeableItem(itemId);
    default:
      return false;
  }
}

/**
 * `sub_511630`: the first slot of the USE tab that holds at least `required` of what the weapon
 * takes. Slots are tried in ascending order, which is the native's own loop (`v9` from 1 up).
 */
export function basicAmmo<T extends AmmunitionItem>(
  inventory: { tabs: readonly { tab: number; items: readonly T[] }[] } | undefined,
  weaponId: number,
  required = 1,
): T | undefined {
  if (!Number.isInteger(required) || required < 1 || required > 15) return;
  const items = inventory?.tabs?.find((tab) => tab.tab === 2)?.items ?? [];
  return [...items]
    .sort((a, b) => a.slot - b.slot)
    .find((item) => (item.quantity ?? 0) >= required && isAmmunitionFor(weaponId, item.itemId));
}
export { attackDuration, attackFrame, shotRelease } from "./attack-timing.ts";
/** 512F90: a shot starts at the near swing boundary, clipped to 65. */
export function shotNear(motion: Pick<BasicAttackAction, "bounds"> | undefined) {
  return shotNearDistance(motion?.bounds);
}
export function projectileLeg(
  x: number,
  y: number,
  facingLeft: boolean,
  mob: { x: number; y: number; point?: { x: number; y: number } } | undefined,
  near = 65,
  range = 200,
) {
  const x0 = x + (facingLeft ? -near : near),
    y0 = y - ATTACK_ORIGIN_HEIGHT;
  // Runtime callers supply 485B80's captured intersection point. Root-20 remains only for legacy API callers.
  const x1 = mob?.point?.x ?? mob?.x ?? x + (facingLeft ? -range : range);
  const y1 = mob?.point?.y ?? (mob ? mob.y - 20 : y0);
  return {
    x0,
    y0,
    x1,
    y1,
    duration: Math.max(1, Math.trunc(Math.hypot(x1 - x0, y1 - y0) * 1.5)),
  };
}
