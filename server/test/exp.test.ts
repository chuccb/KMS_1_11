/**
 * The exp table (`sub_4C7110`) and the server's account of it.
 *
 * The golden numbers are the published 2003 KMS EXP table, not values copied out of our own formula:
 * they are what makes `f(1..20)`, the closed form up to 50 and the `1.0548` chain above it a
 * *validated* reproduction of the client's table (FINDINGS 4.21.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXP_GROWTH_FACTOR,
  EXP_TABLE_MAX_LEVEL,
  EXP_TABLE_OVERFLOW,
  awardExp,
  expToNextLevel,
} from "../src/game/exp.ts";
import { zeroStats } from "../src/protocol/chardata.ts";

test("the table is the published 2003 EXP table", () => {
  const beginner = [15, 34, 57, 92, 135, 372, 560, 840, 1242, 1716];
  beginner.forEach((value, index) =>
    assert.equal(expToNextLevel(index + 1), value, `level ${index + 1}`),
  );
  const firstJob = [2360, 3216, 4200, 5460, 7050, 8840, 11040, 13716, 16680, 20216];
  firstJob.forEach((value, index) =>
    assert.equal(expToNextLevel(index + 11), value, `level ${index + 11}`),
  );
  const secondJob = [24402, 28980, 34320, 40512, 47216, 54900, 63666, 73080, 83720, 95700];
  secondJob.forEach((value, index) =>
    assert.equal(expToNextLevel(index + 21), value, `level ${index + 21}`),
  );
  // Where the closed formula stops and the chain takes over.
  assert.equal(expToNextLevel(50), 709_716);
  assert.equal(expToNextLevel(51), 748_608);
  assert.equal(expToNextLevel(52), 789_631);
  assert.equal(expToNextLevel(100), 10_223_168);
  assert.equal(expToNextLevel(150), 147_262_175);
});

test("the high levels follow the 1.0548 chain exactly", () => {
  assert.equal(EXP_GROWTH_FACTOR, 1.0548);
  const tail = [
    1_244_216_724, 1_312_399_800, 1_384_319_309, 1_460_180_007, 1_540_197_871, 1_624_600_714,
    1_713_628_833, 1_807_535_693,
    // The fan-site table has 1_906_558_648 here, but the level after it only follows from *this*
    // value: trunc(1906588648 * 1.0548) = 2011069705, which is that table's own level 199.
    1_906_588_648, 2_011_069_705, 2_121_276_324,
  ];
  tail.forEach((value, index) =>
    assert.equal(expToNextLevel(index + 190), value, `level ${index + 190}`),
  );
});

test("the table covers 1..200 and grows", () => {
  let previous = 0;
  for (let level = 1; level <= EXP_TABLE_MAX_LEVEL; level++) {
    const value = expToNextLevel(level);
    assert.ok(
      value > previous,
      `level ${level} (${value}) must be above level ${level - 1} (${previous})`,
    );
    previous = value;
  }
  // `sub_4C7190`: above 200 the client returns 0x7FFFFFFF, below 1 it clamps to level 1.
  assert.equal(expToNextLevel(EXP_TABLE_MAX_LEVEL + 1), EXP_TABLE_OVERFLOW);
  assert.equal(expToNextLevel(4000), EXP_TABLE_OVERFLOW);
  assert.equal(expToNextLevel(0), 15);
  assert.equal(expToNextLevel(-5), 15);
});

test("a gain that does not fill the bar only moves exp", () => {
  const stats = zeroStats();
  stats.level = 3;
  stats.exp = 10;
  stats.hp = 40;
  stats.maxHp = 50;
  const gain = awardExp(stats, 20);
  assert.deepEqual(gain, { gained: 20, levels: 0, changed: true, fullHeal: false });
  assert.equal(stats.exp, 30);
  assert.equal(stats.level, 3);
  assert.equal(stats.hp, 40, "no level-up, no refill");
});

test("a gain that fills the bar levels up, subtracts the threshold and refills HP/MP", () => {
  const stats = zeroStats();
  stats.level = 1;
  stats.exp = 10;
  stats.hp = 20;
  stats.maxHp = 50;
  stats.mp = 5;
  stats.maxMp = 30;
  const gain = awardExp(stats, 20, undefined, { rand15: () => 0 });
  assert.deepEqual(gain, { gained: 20, levels: 1, changed: true, fullHeal: true });
  assert.equal(stats.exp, 15, "10 + 20 - f(1) = 15");
  assert.equal(stats.level, 2);
  assert.equal(stats.hp, 70);
  assert.equal(stats.maxHp, 70);
  assert.equal(stats.mp, 40);
  assert.equal(stats.maxMp, 40);
  assert.equal(stats.ap, 0);
  assert.equal(stats.sp, 0);
});

test("one award can cross several levels", () => {
  const stats = zeroStats();
  stats.level = 1;
  stats.exp = 0;
  // f(1) + f(2) = 15 + 34 = 49, so 100 leaves 51 exp at level 3 (f(3) = 57 is not reached).
  const gain = awardExp(stats, 100);
  assert.equal(gain.levels, 2);
  assert.equal(stats.level, 3);
  assert.equal(stats.exp, 51);
});

test("a dead character is not refilled", () => {
  const stats = zeroStats();
  stats.level = 1;
  stats.hp = 0;
  stats.maxHp = 50;
  const gain = awardExp(stats, 15);
  assert.equal(gain.levels, 1);
  assert.equal(stats.hp, 0, "the client's own routine only refills while hp > 0 (sub_4C71C0)");
  assert.equal(gain.fullHeal, false);
});

test("nothing changes for a gain of zero or less", () => {
  const stats = zeroStats();
  stats.level = 4;
  stats.exp = 7;
  for (const amount of [0, -100, 0.5]) {
    const gain = awardExp(stats, amount);
    assert.equal(gain.changed, false);
    assert.equal(gain.gained, 0);
  }
  assert.equal(stats.exp, 7);
  assert.equal(stats.level, 4);
});

test("at level 200 the exp piles up instead of leveling", () => {
  const stats = zeroStats();
  stats.level = EXP_TABLE_MAX_LEVEL;
  stats.exp = 0;
  const gain = awardExp(stats, 5_000_000_000);
  assert.equal(gain.levels, 0);
  assert.equal(stats.level, EXP_TABLE_MAX_LEVEL);
  assert.equal(stats.exp, 0xffffffff, "clamped to what the wire's u32 can carry");
  assert.equal(gain.changed, true);
});

test("a lower maxLevel stops the roll-over", () => {
  const stats = zeroStats();
  stats.level = 1;
  const gain = awardExp(stats, 10_000, 3);
  assert.equal(stats.level, 3);
  assert.equal(gain.levels, 2);
});
