import { test } from "node:test";
import assert from "node:assert/strict";
import { damageRangeFor, damageRangeOf, damageStatsOf, rollDamage, watkOf } from "../src/game/combat.ts";
import type { ItemCatalog } from "../src/game/iteminfo.ts";

/** Two weapons and a glove, which is all `watkOf` is allowed to read. */
const CATALOG: ItemCatalog = {
  info: (itemId) =>
    itemId === 1302000
      ? { id: itemId, name: "검", incPAD: 17 }
      : itemId === 1082000
        ? { id: itemId, name: "가죽 장갑", incPAD: 2 }
        : itemId === 1040001
          ? { id: itemId, name: "초보자 상의" }
          : undefined,
  icon: () => undefined,
};

test("the job picks its stat pair: beginner and warrior use STR, the other four their own", () => {
  assert.deepEqual(damageStatsOf(0), ["str", "dex"]);
  assert.deepEqual(damageStatsOf(100), ["str", "dex"]);
  assert.deepEqual(damageStatsOf(112), ["str", "dex"], "a fighter is still a warrior");
  assert.deepEqual(damageStatsOf(200), ["int", "luk"]);
  assert.deepEqual(damageStatsOf(300), ["dex", "str"]);
  assert.deepEqual(damageStatsOf(400), ["luk", "dex"]);
  // 500 (pirate) is not in this build, so it falls into the same branch as a beginner - STR.
  assert.deepEqual(damageStatsOf(500), ["str", "dex"]);
});

test("watk is the worn weapons' own info/incPAD, and an unknown item contributes nothing", () => {
  assert.equal(watkOf([1302000], CATALOG), 17);
  assert.equal(watkOf([1302000, 1082000], CATALOG), 19, "a glove's attack counts too");
  assert.equal(watkOf([1302000, 1040001], CATALOG), 17, "armour has no incPAD");
  assert.equal(watkOf([9999999], CATALOG), 0);
  assert.equal(watkOf([1302000], undefined), 0, "no archive, no weapon data");
});

test("the damage range is (main*4 + secondary) * watk / 100, with a tenth of it as the floor", () => {
  // The beginner's own numbers with the starting sword: (12*4 + 5) * 17 / 100 = 9.01
  assert.deepEqual(damageRangeOf(12, 5, 17), { min: 1, max: 9 });
  // A clean hundred: (10*4 + 10) * 100 / 100 = 50
  assert.deepEqual(damageRangeOf(10, 10, 100), { min: 5, max: 50 });
  // A hit always hurts: no weapon is still 1..1, never 0.
  assert.deepEqual(damageRangeOf(12, 5, 0), { min: 1, max: 1 });
  // The floor never exceeds the ceiling on a tiny roll.
  assert.deepEqual(damageRangeOf(0, 0, 1), { min: 1, max: 1 });
  assert.deepEqual(damageRangeOf(-5, -5, -5), { min: 1, max: 1 }, "a corrupt record cannot make a negative hit");
});

test("a character's range is its job's pair, its own stats and everything it wears", () => {
  const range = damageRangeFor(
    { job: 100, str: 12, dex: 5, int: 4, luk: 4 },
    [1302000, 1082000],
    CATALOG,
  );
  // (12*4 + 5) * 19 / 100 = 10.07 -> 1..10
  assert.deepEqual(range, { min: 1, max: 10 });
  const magician = damageRangeFor({ job: 200, str: 4, dex: 4, int: 30, luk: 8 }, [1302000], CATALOG);
  // (30*4 + 8) * 17 / 100 = 21.76 -> 2..21
  assert.deepEqual(magician, { min: 2, max: 21 });
});

test("the roll stays inside the range, and both ends are reachable", () => {
  const range = { min: 3, max: 8 };
  assert.equal(rollDamage(range, () => 0), 3);
  assert.equal(rollDamage(range, () => 0.999999), 8);
  assert.equal(rollDamage({ min: 5, max: 5 }, () => 0.5), 5);
  // Every value in between is one the roll can return, and nothing outside it is.
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) seen.add(rollDamage(range, Math.random));
  assert.deepEqual([...seen].sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
});
