/**
 * `sub_4C7960`'s weapon switch, pinned against the decompilation (`MapleStory.exe.c` 207249+).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `rollNativePhysical` is a transcription of one native function, and two of its branches were
 * provable-but-unpinned: inverting either swing multiplier left the whole suite green. The
 * decompilation settles both, and this file is what stops them drifting back.
 *
 * THE STAT SLOTS (the same obfuscated xor-pairs the native code reads)
 * -------------------------------------------------------------------
 * `sub_4C7960` reads the character's stats out of a `_DWORD*` as `a3[i] ^ a3[i+1]`. The indices
 * are fixed by the weapon branches themselves: the sword branch rolls on `a3[6]^a3[7]` and adds
 * `a3[8]^a3[9]` flat, the bow branch does the reverse, and the claw branch rolls on `a3[12]^a3[13]`
 * and adds `a3[6]^a3[7]` + `a3[8]^a3[9]`. Three slots, three branches, one consistent reading:
 *
 *   a3[6] ^ a3[7]  = STR     a3[8] ^ a3[9] = DEX     a3[12] ^ a3[13] = LUK
 *
 * Every branch below is a consequence of that mapping, so each test is a check on it too.
 *
 * DETERMINISM
 * -----------
 * `next()` returns 9999999 for all seven pre-drawn values. `nativeUniform` is
 * `min(a,b) + |b-a| * (word % 10000000) / 9999999`, and 9999999 % 10000000 === 9999999, so every
 * roll returns its UPPER endpoint exactly - the mastery roll lands on STR (or DEX, or LUK), never
 * somewhere inside the range.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { statBasis, statTotals } from "../../client/characterstats.ts";
import { rollNativePhysical } from "../src/game/nativecombat.ts";

/** Level 1, so the level penalty is `(100 - 0) * 0.01` - a no-op, see the table below. */
interface Stats {
  job: number;
  level: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  maxHp: number;
  maxMp: number;
  gender: number;
}

const STATS: Stats = {
  job: 0,
  level: 1,
  str: 20,
  dex: 10,
  int: 4,
  luk: 4,
  maxHp: 50,
  maxMp: 5,
  gender: 0,
};

/** A mob with no defence and no evasion, so the damage is the raw formula and nothing else. */
const MOB = { level: 1, pd: 0, eva: 0 };

/** No skills, so mastery is 0 and the roll's lower endpoint is `stat * 0.09`. */
const NO_SKILLS = undefined;

/**
 * One weapon in slot 11 with a flat 100 attack.
 *
 * `effectiveWorn` DROPS any item whose `requirements` is missing (`valid = r && ...`), so a
 * template without one contributes nothing and PAD silently stays 0 - the trap this helper exists
 * to avoid. The zeros below are "wearable by anyone", which is what a starter weapon carries.
 */
function basisFor(weaponId: number, pad = 100, over: Partial<typeof STATS> = {}) {
  return statBasis({ ...STATS, ...over } as never, [
    {
      slot: 11,
      itemId: weaponId,
      stats: { pad },
      requirements: { level: 0, job: 0, str: 0, dex: 0, int: 0, luk: 0 },
    } as never,
  ]);
}

/** `trunc(clamp(...))` of the formula with the roll pinned to its upper endpoint. */
function damageWith(weaponId: number, action: number, over: Partial<Stats> = {}): number {
  const basis = basisFor(weaponId, 100, over),
    totals = statTotals(basis, {});
  totals.pad = basis.secondary.pad!;
  return rollNativePhysical(
    { items: { map32: [] } } as never,
    basis,
    totals,
    MOB,
    action,
    0,
    0,
    NO_SKILLS,
    () => 9999999,
  );
}

/**
 * With the roll pinned, every branch is `(roll * k + flat) * pad * 0.01` - so the damage is the
 * arithmetic itself and a wrong coefficient cannot hide behind a random draw.
 *
 * | weapon | roll | flat  | coefficient (action 5..15 / otherwise) |
 * |--------|------|-------|----------------------------------------|
 * | 30 33 40 | STR  | DEX   | 4 / 4 - a one-handed sword has no swing |
 * | 31 32 37 38 41 42 44 | STR | DEX | **4 / 2** |
 * | 43 | STR | DEX | **2 / 4** (the inverse) |
 * | 45 46 | DEX | STR | 4 / 4 |
 * | 47 | LUK | STR+DEX | 4 / 4 |
 */
test("the switch rolls on the stat the decompilation names, with PAD 100 and the level penalty at 1", () => {
  // pad 100 makes `* pad * 0.01` a no-op too, so the number IS `roll * k + flat`.
  // 30: STR 20 * 4 + DEX 10 = 90, and the coefficient does not depend on the action.
  assert.equal(damageWith(1302000, 9), 90);
  assert.equal(damageWith(1302000, 1), 90);
  // 45/46: DEX 10 * 4 + STR 20 = 60 - the bow branch is the mirror of the sword's.
  assert.equal(damageWith(1452000, 22), 60);
  // 47: LUK 4 * 4 + STR 20 + DEX 10 = 46. Raising LUK to 30 gives 30 * 4 + 30 = 150, which is
  // only reachable if the roll really is on LUK and not on STR.
  assert.equal(damageWith(1472000, 22), 46);
  assert.equal(damageWith(1472000, 22, { luk: 30 }), 150);
});

test("a dagger is the one weapon whose stat depends on the job branch", () => {
  // `case 33` is the only branch that looks at the job: a thief (branch 4) swings it on LUK,
  // everyone else on STR. The two share the case, so this pins the ternary and not just the case.
  assert.equal(damageWith(1332000, 9), 90, "a beginner's dagger is STR-based: 20 * 4 + 10");
  assert.equal(damageWith(1332000, 9, { job: 100 }), 90, "a warrior's dagger too");
  assert.equal(damageWith(1332000, 9, { job: 400 }), 46, "a thief's dagger is LUK-based");
  assert.equal(damageWith(1332000, 9, { job: 400, luk: 30 }), 150, "and it follows LUK");
});

test("two-handers swing for twice the coefficient, a claw does the opposite", () => {
  // 31 is a two-handed sword, 43 is a claw, and the two really are inverted in `sub_4C7960`
  // (LABEL_91's `v55 + v55` against the `v67 * 4.0` of the other branch). One coefficient
  // swapped and both numbers below swap with it, so this pins the pair, not one of the two.
  for (const weaponId of [1312000, 1322000, 1372000, 1382000, 1412000, 1422000, 1442000]) {
    assert.equal(damageWith(weaponId, 9), 90, `weapon ${weaponId}: a swing is * 4`);
    assert.equal(damageWith(weaponId, 1), 50, `weapon ${weaponId}: standing still is * 2`);
  }
  assert.equal(damageWith(1432000, 9), 50, "weapon 43: a swing is * 2");
  assert.equal(damageWith(1432000, 1), 90, "weapon 43: standing still is * 4");
});

test("the gun/star path is action-shaped, not weapon-shaped, and carries the 1/150 rate", () => {
  // `[45,46,47] && !(action 22..27)`, plus `action === 32` for ANY weapon. The second half is not
  // a special case in the source: `if (n5_1 != 32) switch (...)` skips the switch and falls
  // through into the same block, which is why 32 lands here for a sword too.
  //
  // The rate is `0.006666666666666667` = 1/150: STR 20 * 100 * 1/150 = 13.333 -> 13.
  for (const weaponId of [1452000, 1462000, 1472000]) {
    assert.equal(damageWith(weaponId, 9), 13, `weapon ${weaponId} outside 22..27`);
    assert.equal(damageWith(weaponId, 32), 13, `weapon ${weaponId} at action 32`);
  }
  // ...and a one-handed sword outside that family also takes it at action 32.
  assert.equal(damageWith(1302000, 32), 13, "action 32 falls through for every weapon");
  // Inside 22..27 the same weapons go back through the switch: DEX 10 * 4 + STR 20 = 60.
  assert.equal(damageWith(1452000, 22), 60, "action 22 is an ordinary shot");
});
