/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  effectiveWorn,
  statBasis,
  statTotals,
  detailRows,
  type StatItem,
} from "../../client/characterstats.ts";
import { characterDataOf, zeroStats } from "../src/protocol/chardata.ts";
import { equipSlot } from "../src/protocol/itemslot.ts";
import { characterStatBasis } from "../src/game/characterstats.ts";
import { nativeUniform, rollNativePhysical } from "../src/game/nativecombat.ts";
import { applyVitalReport } from "../src/game/vitals.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { consumeSpecOf } from "../src/game/items.ts";
const stats = (job = 0) => ({
  ...zeroStats(),
  gender: 0,
  level: 10,
  job,
  str: 4,
  dex: 9,
  int: 15,
  luk: 9,
  maxHp: 50,
  maxMp: 30,
  hp: 40,
  mp: 20,
});
const item = (slot: number, str = 0, reqStr = 0): StatItem => ({
  slot,
  itemId: slot === 1 ? 1002000 : 1082000,
  stats: { str },
  requirements: { level: 0, job: 0, str: reqStr, dex: 0, int: 0, luk: 0 },
});
test("4C5020 excludes self qualification and restarts after each failure", () => {
  assert.deepEqual(effectiveWorn(stats(), [item(1, 20, 10)]), []);
  assert.deepEqual(effectiveWorn(stats(), [item(1, 5, 10), item(8, 20, 10)]), []);
  assert.deepEqual(
    effectiveWorn(stats(), [item(8, 8, 10), item(1, 8, 10)]).map((i) => i.slot),
    [1, 8],
    "mutual support is retained if each qualifies without itself",
  );
  assert.deepEqual(
    effectiveWorn(stats(), [item(1, 8, 10), item(8, 8, 10)], [8]),
    [],
    "exclude replacement before evaluating dependencies",
  );
  const bow = { ...item(11), itemId: 1452000 };
  assert.deepEqual(effectiveWorn(stats(200), [bow]), [], "native mage weapon whitelist");
});
test("4C5420/5740 use signed instance stats, job-dependent ACC and independent truncations", () => {
  const worn = {
    ...item(1),
    stats: { str: 0xffff, pad: 17, speed: 60, jump: 40, maxHp: 20, craft: 999 },
  };
  const basis = statBasis(stats(), [worn]);
  assert.equal(basis.basic.str, 3);
  assert.equal(basis.basic.maxHp, 70);
  assert.equal(basis.secondary.acc, 13);
  assert.equal(basis.secondary.eva, 6);
  assert.equal(basis.secondary.hands, 33, "equipment craft is not added by this native function");
  assert.equal(basis.secondary.mad, 15);
  assert.equal(basis.secondary.mdd, 15);
  assert.equal(statBasis(stats(300), []).secondary.acc, 7);
  assert.equal(statTotals(basis, { speed: -30, jump: -30 }).speed, 100);
  assert.equal(statTotals(basis, { speed: -30, jump: -30 }).jump, 93);
  assert.deepEqual(
    detailRows(statBasis(stats(), [{ ...item(1), stats: { pad: 17 } }]), {
      pad: 5,
    }).slice(0, 1),
    ["26 (21+5)"],
    "Detail is STR+PAD, not a damage range",
  );
});
test("effective max vitals affect caps without overwriting the base record", () => {
  const s = stats();
  applyVitalReport(s, { hpDelta: 100, mpDelta: 100 }, { maxHp: 70, maxMp: 45 });
  assert.equal(s.hp, 70);
  assert.equal(s.mp, 45);
  assert.equal(s.maxHp, 50);
  assert.equal(s.maxMp, 30);
  applyVitalReport(s, { hpDelta: 0, mpDelta: 0 }, { maxHp: 50, maxMp: 30 });
  assert.equal(s.hp, 50);
  assert.equal(s.mp, 30);
});
test("4C7960 consumes seven RNG words even on MISS; PD and weapon rather than job select damage", () => {
  const character = characterDataOf({
    ...stats(200),
    str: 40,
    dex: 20,
    int: 200,
  });
  const basis = statBasis(character.stats, [{ ...item(11), itemId: 1302000, stats: { pad: 100 } }]);
  let draws = 0;
  const next = () => {
    draws++;
    return 9999999;
  };
  assert.equal(
    rollNativePhysical(
      character,
      basis,
      statTotals(basis),
      { level: 10, pd: 10, eva: 0 },
      5,
      0,
      0,
      undefined,
      next,
    ),
    174,
  );
  assert.equal(draws, 7);
  assert.equal(
    rollNativePhysical(
      character,
      basis,
      { ...statTotals(basis), acc: 0 },
      { level: 10, eva: 1 },
      5,
      0,
      0,
      undefined,
      next,
    ),
    0,
  );
  assert.equal(draws, 14);
  assert.equal(nativeUniform(0, 10, 2), 2);
  assert.equal(nativeUniform(9999999, 10, 2), 10);
});
test("shipped WZ: instance PAD overrides template; Nimble/ Amazon and actual potion milliseconds", () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const catalog = itemCatalogOf(archive),
    skills = skillCatalogOf(archive);
  const c = characterDataOf({ ...stats(400), level: 30 });
  c.items!.worn.set(11, equipSlot(1302000, { pad: 10 }));
  c.items!.map32 = [
    { key: 3000000, value: 1 },
    { key: 4000000, value: 1 },
  ];
  const basis = characterStatBasis(c, catalog, skills);
  assert.equal(basis.secondary.pad, 10);
  assert.equal(basis.secondary.acc, 9);
  assert.equal(basis.secondary.eva, 7);
  for (const [id, key, value, time] of [
    [2002004, "pad", 5, 180000],
    [2002005, "acc", 5, 300000],
    [2002000, "eva", 5, 180000],
  ] as const) {
    const spec = consumeSpecOf(archive, id)!;
    assert.equal(spec[key], value);
    assert.equal(spec.time, time);
    assert.deepEqual(spec.unapplied, []);
  }
  assert.deepEqual(
    consumeSpecOf(archive, 2002000)!.unapplied,
    [],
    "stream 2 contact now consumes EVA",
  );
});
