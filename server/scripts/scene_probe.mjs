import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareMapScene,
  mergeScene,
  visibleSprite,
  compareScene,
} from "../../client/scene.mjs";
test("static merge preserves the previous full stable z/y sort, including ties, without mutating maps", () => {
  let seed = 12345;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let run = 0; run < 100; run++) {
    const sprites = Array.from({ length: 200 }, (_, id) => ({
      id,
      z: Math.floor(random() * 20) - 10,
      y: Math.floor(random() * 10) - 5,
    }));
    const before = JSON.stringify(sprites),
      statics = prepareMapScene(sprites);
    const dynamic = Array.from({ length: 12 }, (_, id) => ({
      kind: "actor",
      id,
      z: Math.floor(random() * 20) - 10,
      y: Math.floor(random() * 10) - 5,
    }));
    const reference = [
      ...sprites.map((sprite) => ({
        kind: "map",
        z: sprite.z,
        y: sprite.y,
        sprite,
      })),
      ...dynamic,
    ].sort(compareScene);
    const saved = [...statics];
    assert.deepEqual([...mergeScene(statics, [...dynamic])], reference);
    assert.deepEqual(statics, saved);
    assert.equal(JSON.stringify(sprites), before);
  }
});
test("culling uses actual origin, mirroring, dimensions and rounded draw coordinates", () => {
  assert.equal(
    visibleSprite(1000, 100, 400, 200, 300, 0),
    true,
    "offscreen anchor, visible pixels",
  );
  assert.equal(
    visibleSprite(-100, 100, 400, 200, 300, 0, true),
    true,
    "flipped anchor is not the left edge",
  );
  for (const flip of [false, true]) {
    for (const x of [-1200, -100, -0.5, 0, 400, 800, 900, 1500])
      for (const y of [-1000, -0.5, 0, 599.5, 900])
        for (const ox of [-100, 0, 200, 1200]) {
          const w = 250,
            h = 170,
            oy = 80,
            left = flip ? Math.round(x) + ox - w : Math.round(x) - ox,
            top = Math.round(y) - oy;
          assert.equal(
            visibleSprite(x, y, w, h, ox, oy, flip),
            !(left > 800 || left + w < 0 || top > 600 || top + h < 0),
          );
        }
  }
  assert.equal(
    visibleSprite(-100, 0, 100, 100),
    true,
    "touching viewport boundary is retained",
  );
  assert.equal(visibleSprite(-101, 0, 100, 100), false);
  assert.equal(visibleSprite(0, 601, 100, 100), false);
});
test("an empty scene and dynamic-only scene retain stable actor order", () => {
  assert.deepEqual([...mergeScene([], [])], []);
  const a = { kind: "player", y: 1, z: 2 },
    b = { kind: "mob", y: 1, z: 2 };
  assert.deepEqual([...mergeScene([], [a, b])], [a, b]);
});
