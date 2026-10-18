import type { BasicAttackAction } from "../server/src/game/basicattack.ts";
export interface AmmunitionItem {
  slot: number;
  itemId: number;
  quantity?: number;
}
/** Basic attacks, not skill animation/state. Action ids come from the native attack selectors. */
export function weaponIdOf(look: { items?: readonly number[] } | undefined) {
  return look?.items?.find((id) => id >= 1300000 && id < 1500000) ?? 0;
}
export function basicAmmo<T extends AmmunitionItem>(
  inventory: { tabs: readonly { tab: number; items: readonly T[] }[] } | undefined,
  weaponId: number,
  required = 1,
): T | undefined {
  if (!Number.isInteger(required) || required < 1 || required > 15) return;
  const category = Math.trunc(weaponId / 10000);
  const items = inventory?.tabs?.find((tab) => tab.tab === 2)?.items ?? [];
  return [...items]
    .sort((a, b) => a.slot - b.slot)
    .find((item) => {
      if (!((item.quantity ?? 0) >= required)) return false;
      return category === 145
        ? Math.trunc(item.itemId / 1000) === 2060
        : category === 146
          ? Math.trunc(item.itemId / 1000) === 2061
          : category === 147 && Math.trunc(item.itemId / 10000) === 207;
    });
}
export { attackDuration, attackFrame, shotRelease } from "./attack-timing.ts";
/** Native shot range starts at the near swing boundary, clipped to 65 by 512F90. */
export function shotNear(motion: Pick<BasicAttackAction, "bounds"> | undefined) {
  const bounds = motion?.bounds;
  return bounds ? -Math.min(Math.max(bounds.left, -65), bounds.right - 1) : 65;
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
    y0 = y - 25;
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
