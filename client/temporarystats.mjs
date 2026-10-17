/** Native client-owned timed effects: PE 4C5DC0 / 4C65A0 / 4CBBD0 / 4CC2D0.
 * This does NOT implement skill casting or the unknown combat-effect mechanics.
 * A new application replaces only its fields, even when weaker; it is not additive.
 */
export const TEMPORARY_FIELDS = Object.freeze([
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "hands",
  "speed",
  "jump",
  "unknown200",
  "unknown400",
  "unknown800",
]);
export function temporaryStats() {
  let applications = [];
  const prune = (now) => {
    // Native expiry is strictly AFTER the deadline (4C65A0: clock - expiry > 0).
    applications = applications.filter((entry) => now <= entry.expiresAt);
  };
  return {
    clear() {
      applications = [];
    },
    apply(update, now) {
      if (
        !update ||
        !Number.isFinite(now) ||
        !Number.isInteger(update.durationMs) ||
        update.durationMs <= 0 ||
        update.durationMs > 0x7fffffff ||
        !update.values ||
        typeof update.values !== "object" ||
        !Number.isInteger(update.sourceId) ||
        update.sourceId < 0 ||
        update.sourceId > 0xffffffff
      )
        throw new RangeError("Invalid temporary-stat application");
      const values = { ...update.values };
      for (const [key, value] of Object.entries(values)) {
        if (
          !TEMPORARY_FIELDS.includes(key) ||
          !Number.isInteger(value) ||
          value < -32768 ||
          value > 32767
        )
          throw new RangeError(`Invalid temporary stat ${key}`);
      }
      prune(now);
      for (const entry of applications) {
        for (const key of Object.keys(values)) delete entry.values[key];
      }
      applications = applications.filter(
        (entry) => Object.keys(entry.values).length,
      );
      applications.push({
        sourceId: update.sourceId,
        sourceIsSkill: !!update.sourceIsSkill,
        expiresAt: now + update.durationMs,
        values,
      });
    },
    values(now) {
      prune(now);
      return Object.assign({}, ...applications.map((entry) => entry.values));
    },
    icons(now) {
      prune(now);
      // Oldest application is drawn on the RIGHT, newest on the LEFT (4CC560).
      return applications.map((entry) => ({
        ...entry,
        values: { ...entry.values },
      }));
    },
  };
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
/** 4C5740: equipment/base clamp first; 512400: add temporary value and clamp again.
 * Read the actual equip instances, NOT WZ template stats, and never cash appearance slots.
 */
export function movementStats(worn = [], temporary = {}) {
  let speed = 100,
    jump = 100;
  for (const item of worn) {
    if (item.slot < 1 || item.slot > 14) continue;
    speed += item.stats?.speed ?? 0;
    jump += item.stats?.jump ?? 0;
  }
  return {
    speedPercent: clamp(
      clamp(speed, 100, 130) + (temporary.speed ?? 0),
      80,
      130,
    ),
    jumpPercent: clamp(clamp(jump, 100, 123) + (temporary.jump ?? 0), 80, 123),
  };
}
/** Item icons in this native view are iconRaw (479B10 argument 0), copied without origin offsets.
 * Slot width 32, right edge x797, y45, alpha210, from 4CC560's layer (-255 about screen centre).
 */
export function drawTemporaryStats(ctx, image, applications) {
  ctx.save();
  ctx.globalAlpha = 210 / 255;
  applications.forEach((entry, i) => {
    const id = String(entry.sourceId).padStart(8, "0");
    const path = entry.sourceIsSkill
      ? `Skill/${Math.trunc(entry.sourceId / 10000)}.img/skill/${entry.sourceId}/icon`
      : `Item/Consume/${id.slice(0, 4)}.img/${id}/info/iconRaw`;
    const art = image(path);
    if (art?.ready) ctx.drawImage(art.img, 797 - (i + 1) * 32, 45);
  });
  ctx.restore();
}
