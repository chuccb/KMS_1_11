/** Regression SOURCES only. Do not run for the current delivery. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  temporaryStats,
  movementStats,
  drawTemporaryStats,
  TEMPORARY_FIELDS,
} from "../../client/temporarystats.mjs";
import {
  collisionWorld,
  createPlayer,
  advancePlayer,
} from "../../client/motion.mjs";
const update = (values, durationMs = 100, sourceId = 2002001) => ({
  values,
  durationMs,
  sourceId,
  sourceIsSkill: false,
});
test("overwrite rather than stack, refresh duration, expire strictly after deadline", () => {
  const state = temporaryStats();
  state.apply(update({ speed: 8 }), 0);
  state.apply(update({ speed: 3 }), 50);
  assert.equal(
    state.values(100).speed,
    3,
    "weaker also replaces the old value",
  );
  assert.equal(
    state.icons(100).length,
    1,
    "same field does not duplicate icons",
  );
  assert.equal(state.values(150).speed, 3);
  assert.equal(state.values(151).speed, undefined);
  assert.equal(state.icons(151).length, 0);
});
test("partial overlap preserves other old fields and independently expires them", () => {
  const state = temporaryStats();
  state.apply(update({ speed: 8, pad: 5 }), 0);
  state.apply(update({ speed: 10 }, 200, 2002004), 50);
  assert.deepEqual(state.values(99), { pad: 5, speed: 10 });
  const icons = state.icons(99);
  assert.deepEqual(
    icons.map((i) => i.values),
    [{ pad: 5 }, { speed: 10 }],
  );
  icons[0].values.pad = 999;
  assert.equal(state.values(99).pad, 5, "views cannot mutate the stored buff");
  assert.deepEqual(state.values(101), { speed: 10 });
  assert.deepEqual(state.values(251), {});
  state.apply(update({ speed: 8 }), 300);
  state.clear();
  assert.deepEqual(state.icons(301), []);
});
test("native base clamp precedes temporary clamp; use rolled worn stats, not cash/template stats", () => {
  assert.deepEqual(movementStats(), { speedPercent: 100, jumpPercent: 100 });
  assert.deepEqual(
    movementStats([{ slot: 7, stats: { speed: 50, jump: 50 } }], {
      speed: -10,
      jump: -10,
    }),
    { speedPercent: 120, jumpPercent: 113 },
  );
  assert.deepEqual(
    movementStats([{ slot: 7, stats: { speed: -10, jump: -10 } }], {
      speed: -30,
      jump: 50,
    }),
    { speedPercent: 80, jumpPercent: 123 },
  );
  assert.deepEqual(
    movementStats([{ slot: 15, stats: { speed: 20, jump: 20 } }], { speed: 8 }),
    { speedPercent: 108, jumpPercent: 100 },
  );
});
test("walk speed multiplier really reaches physics; jump uses a separate multiplier", () => {
  const world = collisionWorld({
    footholds: [{ id: 1, x1: -1000, y1: 100, x2: 2000, y2: 100 }],
  });
  const body = createPlayer(0, 100, world);
  for (let i = 0; i < 20; i++)
    advancePlayer(body, { horizontal: 1, speedPercent: 108 }, world, 8);
  assert.equal(body.vx, 135);
  const boosted = createPlayer(0, 100, world),
    plain = createPlayer(0, 100, world);
  advancePlayer(boosted, { jump: true, jumpPercent: 120 }, world, 8);
  advancePlayer(plain, { jump: true }, world, 8);
  assert.ok(boosted.vy < plain.vy);
});
test("buff row uses iconRaw, alpha 210, native right-to-left 32px slots, y45", () => {
  const draws = [],
    paths = [];
  const ctx = {
    save() {},
    restore() {},
    drawImage(...args) {
      draws.push([this.globalAlpha, ...args]);
    },
  };
  drawTemporaryStats(
    ctx,
    (path) => {
      paths.push(path);
      return { ready: true, img: "pixels" };
    },
    [update({ speed: 8 }), update({ pad: 5 }, 100, 2002004)],
  );
  assert.deepEqual(paths, [
    "Item/Consume/0200.img/02002001/info/iconRaw",
    "Item/Consume/0200.img/02002004/info/iconRaw",
  ]);
  assert.deepEqual(draws, [
    [210 / 255, "pixels", 765, 45],
    [210 / 255, "pixels", 733, 45],
  ]);
  assert.equal(TEMPORARY_FIELDS.length, 12);
});
