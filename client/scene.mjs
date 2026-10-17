/** Stable native z/y ordering. Static map nodes precede dynamic actors on exact ties. */
export const compareScene = (a, b) => a.z - b.z || a.y - b.y;
export function prepareMapScene(sprites) {
  return sprites
    .map((sprite) => ({ kind: "map", y: sprite.y, z: sprite.z, sprite }))
    .sort(compareScene);
}
/** Merge the once-sorted static map with the small moving population; don't sort/clone every tile per RAF. */
export function* mergeScene(statics, dynamic) {
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
  x,
  y,
  w,
  h,
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
