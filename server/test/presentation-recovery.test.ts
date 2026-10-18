import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryTick, recoveryBonuses, type RecoveryInput } from "../../client/recovery.ts";
import type { SkillInfo } from "../src/game/skills.ts";

const standing: RecoveryInput = {
  hp: 40,
  maxHp: 100,
  mp: 2,
  maxMp: 50,
  action: 2,
  stationary: true,
};

test("recovery uses 30ms ticks and independent ten-second clocks, with authoritative missing-vital caps", () => {
  const clock = { hp: 0, mp: 0 };
  for (let i = 0; i < 333; i++) assert.deepEqual(recoveryTick(clock, standing), []);
  assert.deepEqual(clock, { hp: 9990, mp: 9990 });
  assert.deepEqual(recoveryTick(clock, standing), [
    { hpDelta: 10, flag: 0 },
    { mpDelta: 3, flag: 0 },
  ]);
  assert.deepEqual(clock, { hp: 0, mp: 0 });
  assert.deepEqual(recoveryTick({ hp: 9990, mp: 9990 }, { ...standing, hp: 99, mp: 49 }), [
    { hpDelta: 1, flag: 0 },
    { mpDelta: 1, flag: 0 },
  ]);
});

test("moving/non-resting HP cannot accrue; MP stays independent, and authoritative death resets both", () => {
  const clock = { hp: 9990, mp: 9990 };
  assert.deepEqual(recoveryTick(clock, { ...standing, stationary: false }), [
    { mpDelta: 3, flag: 0 },
  ]);
  assert.deepEqual(clock, { hp: 0, mp: 0 });
  assert.deepEqual(recoveryTick({ hp: 9990, mp: 9990 }, { ...standing, action: 35 }), [
    { mpDelta: 3, flag: 0 },
  ]);
  const dead = { hp: 9990, mp: 9990 };
  assert.deepEqual(recoveryTick(dead, { ...standing, hp: 0 }), []);
  assert.deepEqual(dead, { hp: 0, mp: 0 });
});

test("ladder/rope HP requires the learned passive interval and emits flag1, never an invented heal", () => {
  for (const action of [36, 37]) {
    const clock = { hp: 0, mp: 0 };
    for (let i = 0; i < 99; i++)
      assert.deepEqual(recoveryTick(clock, { ...standing, action, climbMs: 3000 }), []);
    assert.deepEqual(recoveryTick(clock, { ...standing, action, climbMs: 3000 }), [
      { hpDelta: 10, flag: 1 },
    ]);
    assert.deepEqual(recoveryTick({ hp: 9990, mp: 0 }, { ...standing, action }), []);
  }
});

test("passive bonuses use numeric WZ values and clamped learned levels, not hs text or a guessed job effect", () => {
  const skill = (values: Record<string, number>): Pick<SkillInfo, "maxLevel" | "levels"> => ({
    maxLevel: 1,
    levels: [{ level: 1, hs: "99999 is intentionally not parsed", values }],
  });
  const learned = new Map([
    [1000000, 9],
    [2000000, 1],
    [1000002, 1],
    [4100001, 1],
    [4200001, 1],
  ]);
  const skills = new Map([
    [1000000, skill({ hp: 20 })],
    [2000000, skill({ mp: 5 })],
    [1000002, skill({ time: 3 })],
    [4100001, skill({ time: 4 })],
    [4200001, skill({ time: 6 })],
  ]);
  assert.deepEqual(recoveryBonuses(110, learned, skills), {
    hpBonus: 20,
    mpBonus: 5,
    climbMs: 3000,
  });
  assert.equal(recoveryBonuses(411, learned, skills).climbMs, 4000);
  assert.equal(recoveryBonuses(421, learned, skills).climbMs, 6000);
  assert.equal(recoveryBonuses(200, learned, skills).climbMs, 0);
  assert.deepEqual(recoveryBonuses(100, new Map(), skills), { hpBonus: 0, mpBonus: 0, climbMs: 0 });
  assert.deepEqual(
    recoveryTick({ hp: 9990, mp: 9990 }, { ...standing, rate: 0.5, hpBonus: 20, mpBonus: 5 }),
    [
      { hpDelta: 15, flag: 0 },
      { mpDelta: 4, flag: 0 },
    ],
  );
});
