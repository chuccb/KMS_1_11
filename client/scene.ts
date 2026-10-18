export interface SceneOrder {
  z: number;
  order?: number;
}
/** Gr2D 10013D40/100137B0: root z, then insertion/reorder sequence. NEVER feet y.
 * Child overlays stay inside their parent's subtree (avatar planes/afterimage/name).
 */
export const compareScene = <T extends SceneOrder, U extends SceneOrder>(a: T, b: U) =>
  a.z - b.z || (a.order ?? 0) - (b.order ?? 0);

/** A persistent stamp, refreshed on z changes; rebuilding the RAF list must not change ties.
 * Weak keys release despawned actors/shots. A field load supplies a new ordering instance.
 */
export function sceneOrdering(first = 0) {
  const records = new WeakMap<object, { z: number; order: number }>();
  let sequence = first;
  return (entity: object, z: number) => {
    let record = records.get(entity);
    if (!record || record.z !== z) {
      record = { z, order: ++sequence };
      records.set(entity, record);
    }
    return record.order;
  };
}
export function prepareMapScene<T extends { y: number; z: number }>(sprites: readonly T[]) {
  return sprites
    .map((sprite, order) => ({ kind: "map" as const, y: sprite.y, z: sprite.z, order, sprite }))
    .sort(compareScene);
}
/** Merge the once-sorted static map with the small moving population; don't sort/clone every tile per RAF. */
export function* mergeScene<T extends SceneOrder, U extends SceneOrder>(
  statics: readonly T[],
  dynamic: U[],
): Generator<T | U> {
  dynamic.sort(compareScene);
  let i = 0,
    j = 0;
  while (i < statics.length && j < dynamic.length) {
    if (compareScene(statics[i], dynamic[j]) <= 0) yield statics[i++];
    else yield dynamic[j++];
  }
  while (i < statics.length) yield statics[i++];
  while (j < dynamic.length) yield dynamic[j++];
}
/** Exact canvas-origin/mirror bounds. Keep touching edges, and don't cull huge sprites by anchor alone. */
export function visibleSprite(
  x: number,
  y: number,
  w: number,
  h: number,
  ox = 0,
  oy = 0,
  flip = false,
  width = 800,
  height = 600,
) {
  const left = flip ? Math.round(x) + ox - w : Math.round(x) - ox,
    top = Math.round(y) - oy;
  return left <= width && left + w >= 0 && top <= height && top + h >= 0;
}
