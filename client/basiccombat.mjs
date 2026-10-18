/** Basic attacks, not skill animation/state. Action ids come from the native attack selectors. */
export function weaponIdOf(look) {
  return look?.items?.find((id) => id >= 1300000 && id < 1500000) ?? 0;
}
export function basicAmmo(inventory, weaponId) {
  const category = Math.trunc(weaponId / 10000);
  const items = inventory?.tabs?.find((tab) => tab.tab === 2)?.items ?? [];
  return [...items]
    .sort((a, b) => a.slot - b.slot)
    .find((item) => {
      if (!(item.quantity >= 1)) return false;
      return category === 145
        ? Math.trunc(item.itemId / 1000) === 2060
        : category === 146
          ? Math.trunc(item.itemId / 1000) === 2061
          : category === 147 && Math.trunc(item.itemId / 10000) === 207;
    });
}
export { attackDuration, attackFrame, shotRelease } from './attack-timing.mjs';
/** Native shot range starts at the near swing boundary, clipped to 65 by 512F90. */
export function shotNear(motion) {
  const bounds = motion?.bounds;
  return bounds ? -Math.min(Math.max(bounds.left, -65), bounds.right - 1) : 65;
}
export function projectileLeg(x, y, facingLeft, mob, near = 65, range = 200) {
  const x0 = x + (facingLeft ? -near : near),
    y0 = y - 25;
  // Target centre is a browser policy until the CShape2D mob pool is ported.
  const x1 = mob?.x ?? x + (facingLeft ? -range : range);
  const y1 = mob ? mob.y - 20 : y0;
  return {
    x0,
    y0,
    x1,
    y1,
    duration: Math.max(1, Math.trunc(Math.hypot(x1 - x0, y1 - y0) * 1.5)),
  };
}
