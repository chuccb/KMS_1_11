/**
 * The server's HP/MP ledger (ADR-021, FINDINGS 4.33): the client reports a delta (c2s `0x1C`), the
 * server applies it and answers with the `0x0D` diff that moves the bar. What is *not* the client's
 * is pinned down here - the clamp, and the one rule that is the server's own: a dead character does
 * not regenerate, because the revive path is what refills HP.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { applyVitalReport } from "../src/game/vitals.ts";
import { zeroStats, type CharacterStats } from "../src/protocol/chardata.ts";

function record(overrides: Partial<CharacterStats> = {}): CharacterStats {
  const stats = zeroStats();
  stats.level = 1;
  stats.hp = 50;
  stats.maxHp = 50;
  stats.mp = 30;
  stats.maxMp = 30;
  return Object.assign(stats, overrides);
}

test("a damage report lowers HP and diff carries only the field that moved", () => {
  // What `sub_5114A0` sends when a monster's attack lands: `sub_55B870(-damage, 0, 0)`.
  const stats = record();
  const diff = applyVitalReport(stats, { hpDelta: -30 });
  assert.deepEqual(diff, { hp: 20 });
  assert.equal(stats.hp, 20);
  assert.equal(stats.mp, 30, "no mp field means the mp is not touched");
});

test("the map's own regeneration reports both fields", () => {
  // `sub_558950`: base HP +10 / MP +3; learned 1000000.hp / 2000000.mp are skill bonuses, not items.
  const stats = record({ hp: 20, mp: 5 });
  assert.deepEqual(applyVitalReport(stats, { hpDelta: 10, mpDelta: 3 }), { hp: 30, mp: 8 });
});

test("the clamp keeps a vital inside [0, max] - a hit at low HP lands on 0, not below it", () => {
  const hurt = record({ hp: 20 });
  assert.deepEqual(applyVitalReport(hurt, { hpDelta: -30 }), { hp: 0 });
  assert.equal(hurt.hp, 0);

  const drained = record({ mp: 5 });
  assert.deepEqual(applyVitalReport(drained, { mpDelta: -50 }), { mp: 0 });

  const overfull = record({ hp: 40 });
  assert.deepEqual(applyVitalReport(overfull, { hpDelta: 40 }), { hp: 50 });
  assert.equal(overfull.hp, 50, "a heal is capped at maxHp");
});

test("a dead character does not regenerate: the revive path is what refills HP", () => {
  // The regen tick does not check for death in the client (`sub_558950` only skips at full HP), so
  // without this rule a corpse would walk itself back up 10 HP at a time.
  const dead = record({ hp: 0, mp: 5 });
  assert.deepEqual(applyVitalReport(dead, { hpDelta: 10 }), {});
  assert.equal(dead.hp, 0);
  // A further hit while dead changes nothing either - there is no state below zero.
  assert.deepEqual(applyVitalReport(dead, { hpDelta: -30 }), {});
  // MP is not part of the death state, so its regeneration still lands.
  assert.deepEqual(applyVitalReport(dead, { mpDelta: 3 }), { mp: 8 });
});

test("a report that changes nothing is not worth a 0x0D", () => {
  const full = record();
  assert.deepEqual(applyVitalReport(full, { hpDelta: 5 }), {});
  assert.deepEqual(applyVitalReport(full, { mpDelta: 0 }), {});
  assert.deepEqual(applyVitalReport(full, {}), {});
  // A delta that is not a number is not a report either; it lands on "nothing changed".
  assert.deepEqual(applyVitalReport(full, { hpDelta: Number.NaN }), {});
});
