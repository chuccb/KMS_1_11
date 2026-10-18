/** Regression sources only; not executed for this delivery at the user's request. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { characterDataOf, emptyCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import { equipSlot } from "../src/protocol/itemslot.ts";
import { ABILITY_MASK, encodeAbilityRequest, readAbilityRequest } from "../src/protocol/ability.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeStatUpdate, readStatUpdate } from "../src/protocol/stat.ts";
import { spendAbility } from "../src/game/ability.ts";
import { awardExp, expToNextLevel } from "../src/game/exp.ts";
import { readSave, saveJson } from "../src/game/save.ts";
import {
  characterGrowthContext,
  growVitals,
  growthSkillProvider,
  VITAL_GROWTH_ROWS,
} from "../src/game/growth.ts";

const fixture = (job = 0) =>
  Object.assign(zeroStats(), {
    id: 501,
    name: "Growth",
    level: 1,
    job,
    int: 20,
    hp: 20,
    maxHp: 50,
    mp: 5,
    maxMp: 50,
    ap: 3,
  });
const both = ABILITY_MASK.maxHp | ABILITY_MASK.maxMp;

test("all 60 growth DWORDs match the original executable's VA 005BB344", () => {
  const exe = readFileSync(resolve(import.meta.dirname, "../../MapleStory.exe"));
  const pe = exe.readUInt32LE(0x3c),
    optional = pe + 24;
  const base = exe.readUInt32LE(optional + 28),
    rva = 0x5bb344 - base;
  const sections = optional + exe.readUInt16LE(pe + 20);
  let offset: number | undefined;
  for (let i = 0; i < exe.readUInt16LE(pe + 6); i++) {
    const section = sections + i * 40,
      address = exe.readUInt32LE(section + 12);
    if (rva >= address && rva + 240 <= address + exe.readUInt32LE(section + 16))
      offset = exe.readUInt32LE(section + 20) + rva - address;
  }
  assert.notEqual(offset, undefined);
  const actual = Array.from({ length: 60 }, (_, i) => exe.readInt32LE(offset! + 4 * i));
  assert.deepEqual(actual, VITAL_GROWTH_ROWS.flat());
});

test("five job groups select different natural/AP rows and truncate INT after multiplying", () => {
  const expected = [
    { job: 0, level: [20, 12], ap: [15, 7] },
    { job: 100, level: [40, 6], ap: [35, 3] },
    { job: 200, level: [10, 24], ap: [5, 19] },
    { job: 300, level: [20, 12], ap: [15, 7] },
    { job: 400, level: [20, 12], ap: [15, 7] },
  ];
  for (const row of expected)
    for (const mode of ["level", "ap"] as const) {
      const stats = fixture(row.job);
      const diff = growVitals(stats, both, mode, { rand15: () => 0 });
      assert.deepEqual(diff, {
        maxHp: 50 + row[mode][0]!,
        maxMp: 50 + row[mode][1]!,
      });
      assert.deepEqual(
        [stats.hp, stats.mp, stats.ap],
        [20, 5, 3],
        "maxima only, not a free heal/AP spend",
      );
    }
  const stats = fixture(211);
  stats.int = 19;
  assert.equal(growVitals(stats, ABILITY_MASK.maxMp, "ap", { rand15: () => 0 }).maxMp, 69);
});

test("modulo RNG reaches inclusive endpoints without replacing it with a fractional range", () => {
  const stats = fixture();
  const draws = [5, 2];
  assert.deepEqual(growVitals(stats, both, "level", { rand15: () => draws.shift()! }), {
    maxHp: 75,
    maxMp: 64,
  });
  const unchanged = fixture(),
    before = { ...unchanged };
  assert.throws(() => growVitals(unchanged, both, "level", { rand15: () => 32768 }), /RNG/);
  assert.deepEqual(unchanged, before);
});

test("real WZ passive numbers override misleading hs prose and apply to learned levels only", () => {
  const skill = growthSkillProvider(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
  assert.deepEqual(skill(1000001, 10), { x: 30, y: 20 });
  assert.deepEqual(skill(2000001, 10), { x: 20, y: 10 });
  assert.deepEqual(skill(1000001, 99), { x: 30, y: 20 }, "native clamps a positive learned level");
  assert.equal(skill(1000001, 0), undefined);
  const skills = [
    { key: 1000001, value: 10 },
    { key: 2000001, value: 10 },
  ];
  assert.deepEqual(growVitals(fixture(100), both, "level", { skills, skill, rand15: () => 0 }), {
    maxHp: 120,
    maxMp: 76,
  });
  assert.deepEqual(growVitals(fixture(100), both, "ap", { skills, skill, rand15: () => 0 }), {
    maxHp: 105,
    maxMp: 63,
  });
  assert.deepEqual(growVitals(fixture(100), both, "level", { skill, rand15: () => 0 }), {
    maxHp: 90,
    maxMp: 56,
  });
});

test("MP uses normal worn INT, not cash appearance, loose equipment or WZ template stats", () => {
  const items = emptyCharacterItems();
  items.worn.set(3, equipSlot(1002000, { int: 20 }));
  items.wornCash.set(3, equipSlot(1002000, { int: 200 }));
  items.inventories[0].items.set(1, equipSlot(1002000, { int: 200 }));
  items.map32.push({ key: 2000001, value: 2 });
  const character = characterDataOf(fixture(200), items);
  const context = characterGrowthContext(character);
  assert.equal(context.intelligence, 40);
  assert.deepEqual(context.skills, items.map32);
  assert.equal(
    growVitals(character.stats, ABILITY_MASK.maxMp, "level", {
      ...context,
      rand15: () => 0,
    }).maxMp,
    76,
  );
});

test("maxima saturate at 30000/10000 and AP refuses capped fields without consuming points", () => {
  const stats = fixture();
  Object.assign(stats, { maxHp: 29999, maxMp: 9999 });
  assert.deepEqual(growVitals(stats, both, "level", { rand15: () => 0 }), {
    maxHp: 30000,
    maxMp: 10000,
  });
  const before = { ...stats };
  assert.deepEqual(spendAbility(stats, ABILITY_MASK.maxHp), {});
  assert.deepEqual(spendAbility(stats, ABILITY_MASK.maxMp), {});
  assert.deepEqual(stats, before);
  const nearCap = fixture();
  nearCap.maxHp = 29999;
  assert.deepEqual(spendAbility(nearCap, ABILITY_MASK.maxHp, { rand15: () => 0 }), {
    maxHp: 30000,
    ap: 2,
  });
  assert.equal(nearCap.hp, 20);
});

test("native lower clamps and unsupported job/mask/death refusal", () => {
  const stats = fixture();
  stats.maxHp = 0;
  assert.equal(growVitals(stats, ABILITY_MASK.maxHp, "ap", { rand15: () => 0 }).maxHp, 50);
  for (const field of ["maxHp", "maxMp"] as const) {
    for (const patch of [{ hp: 0 }, { ap: 0 }, { job: 500 }, { job: -1 }, { job: 1.5 }]) {
      const bad: ReturnType<typeof fixture> = Object.assign(fixture(), patch);
      const before = { ...bad };
      assert.deepEqual(spendAbility(bad, ABILITY_MASK[field]), {});
      assert.deepEqual(bad, before);
    }
  }
  for (const mask of [both, both | ABILITY_MASK.str, 0, 0xffffffff]) {
    const bad = fixture(),
      before = { ...bad };
    assert.deepEqual(spendAbility(bad, mask), {});
    assert.deepEqual(bad, before);
  }
});

test("two HP/MP allocations use real c2s/s2c codecs and survive an unchanged save format", () => {
  const stats = fixture(),
    character = characterDataOf(stats, emptyCharacterItems());
  for (const field of ["maxHp", "maxMp"] as const) {
    const mask = readAbilityRequest(new PacketReader(encodeAbilityRequest(field), 1));
    const diff = spendAbility(stats, mask, { rand15: () => 0 });
    const decoded = readStatUpdate(new PacketReader(encodeStatUpdate({ ack: true, diff }), 1));
    assert.equal(decoded.ack, true);
    assert.deepEqual(decoded.diff, diff);
  }
  assert.deepEqual([stats.maxHp, stats.maxMp, stats.hp, stats.mp, stats.ap], [65, 57, 20, 5, 1]);
  const accounts = new Map([["growth", { password: "growth", characters: [character] }]]);
  const saved = readSave(saveJson(accounts)).get("growth")!.characters[0]!.stats;
  assert.deepEqual(saved, stats);
});

test("each crossed level grows maxima, refills only the living, and does not invent AP/SP rewards", () => {
  const stats = fixture();
  stats.int = 0;
  const gained = awardExp(stats, 100, undefined, { rand15: () => 0 });
  assert.equal(gained.levels, 2);
  assert.deepEqual(
    [stats.level, stats.exp, stats.maxHp, stats.maxMp, stats.hp, stats.mp, stats.ap, stats.sp],
    [3, 51, 90, 70, 90, 70, 3, 0],
  );
  const dead = fixture(200);
  dead.hp = 0;
  awardExp(dead, 15, undefined, { rand15: () => 0 });
  assert.deepEqual([dead.maxHp, dead.maxMp, dead.hp, dead.mp, dead.ap], [60, 74, 0, 5, 3]);
  const capped = fixture();
  capped.level = 199;
  awardExp(capped, expToNextLevel(199), undefined, { rand15: () => 0 });
  assert.equal(capped.level, 200);
  const before = { ...capped };
  awardExp(capped, 100, undefined, {
    rand15: () => {
      throw new Error("no growth at cap");
    },
  });
  assert.deepEqual(capped, { ...before, exp: before.exp + 100 });
});
