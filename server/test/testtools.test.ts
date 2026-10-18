/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import { captureTestCheckpoint, planTestTool } from "../src/game/testtools.ts";
import { encodeStatUpdate } from "../src/protocol/stat.ts";
import { encodeSkillUpdate } from "../src/protocol/skills.ts";
import { readSave, saveJson } from "../src/game/save.ts";
const fixture = () => {
  const c = characterDataOf(
    Object.assign(zeroStats(), {
      id: 10,
      name: "Tools",
      level: 10,
      job: 100,
      str: 12,
      dex: 5,
      int: 4,
      luk: 4,
      hp: 30,
      maxHp: 50,
      mp: 15,
      maxMp: 30,
      ap: 3,
      sp: 5,
    }),
    startingCharacterItems(),
  );
  c.items!.map32 = [
    { key: 1000000, value: 5 },
    { key: 1000001, value: 1 },
  ];
  return c;
};
const available = (job: number) => [0, 100, 200].includes(job);

test("configure plans a bounded diff without modifying source; first checkpoint is deep and scope-limited", () => {
  const c = fixture(),
    before = structuredClone(c);
  const plan = planTestTool(
    c,
    {
      kind: "configure",
      confirmed: true,
      job: 200,
      ap: 20,
      sp: 40,
      resetSkills: true,
    },
    undefined,
    available,
  );
  assert.deepEqual(c, before);
  assert.deepEqual(plan.diff, { job: 200, ap: 20, sp: 40 });
  assert.deepEqual(plan.skills, []);
  assert.deepEqual(plan.changes, [
    { skillId: 1000000, level: 0 },
    { skillId: 1000001, level: 0 },
  ]);
  assert.doesNotThrow(() => encodeStatUpdate({ diff: plan.diff }));
  assert.doesNotThrow(() => encodeSkillUpdate({ ack: false, changes: plan.changes }));
  c.items!.map32[0]!.value = 9;
  assert.equal(plan.checkpoint.skills[0]!.value, 5);
  assert.equal("exp" in plan.checkpoint.stats, false);
  assert.equal("mesos" in plan.checkpoint.stats, false);
  assert.equal("items" in plan.checkpoint, false);
});

test("confirmation, numeric bounds, missing books, unsupported jobs and operations refuse with zero mutation", () => {
  const c = fixture(),
    before = structuredClone(c);
  for (const request of [
    null,
    [],
    {},
    { kind: "heal" },
    { kind: "invent", confirmed: true },
    ...[-1, 1.5, 32768, NaN, "20"].map((ap) => ({
      kind: "configure",
      confirmed: true,
      job: 100,
      ap,
      sp: 40,
      resetSkills: false,
    })),
    {
      kind: "configure",
      confirmed: true,
      job: 999,
      ap: 0,
      sp: 0,
      resetSkills: true,
    },
    {
      kind: "configure",
      confirmed: true,
      job: 300,
      ap: 0,
      sp: 0,
      resetSkills: false,
    },
    {
      kind: "configure",
      confirmed: true,
      job: 100,
      ap: 0,
      sp: 0,
      resetSkills: "yes",
    },
  ]) {
    assert.throws(() => planTestTool(c, request, undefined, available));
    assert.deepEqual(c, before);
  }
});

test("restore never rewinds experience, items or money; level mismatch refuses; restored state survives normal save without save schema edits", () => {
  const c = fixture(),
    point = captureTestCheckpoint(c);
  c.stats.job = 200;
  c.stats.sp = 40;
  c.stats.exp = 12;
  c.stats.mesos = 99;
  c.items!.map32 = [];
  const plan = planTestTool(c, { kind: "restore", confirmed: true }, point, available);
  assert.deepEqual(plan.diff, { job: 100, sp: 5 });
  assert.deepEqual(plan.skills, point.skills);
  Object.assign(c.stats, plan.diff);
  c.items!.map32 = plan.skills!;
  c.flags |= 0x20;
  const loaded = readSave(
    saveJson(new Map([["tools", { password: "tools", characters: [c] }]])),
  ).get("tools")!.characters[0]!;
  assert.equal(loaded.stats.exp, 12);
  assert.equal(loaded.stats.mesos, 99);
  assert.equal(loaded.stats.job, 100);
  assert.deepEqual(loaded.items!.map32, point.skills);
  c.stats.level++;
  assert.throws(
    () => planTestTool(c, { kind: "restore", confirmed: true }, point, available),
    /升級/,
  );
});

test("heal and nonlethal drain are explicit test-only plans; repeated operations preserve the first restore point", () => {
  const c = fixture(),
    heal = planTestTool(c, { kind: "heal", confirmed: true }, undefined, available);
  assert.deepEqual(heal.diff, { hp: 50, mp: 30 });
  Object.assign(c.stats, heal.diff);
  const drain = planTestTool(c, { kind: "drain", confirmed: true }, heal.checkpoint, available);
  assert.equal(drain.checkpoint, heal.checkpoint);
  assert.deepEqual(drain.diff, { hp: 25, mp: 15 });
  c.stats.hp = 0;
  assert.throws(() =>
    planTestTool(c, { kind: "drain", confirmed: true }, heal.checkpoint, available),
  );
  assert.equal(c.stats.hp, 0);
});

// Unexecuted addition: convenient death entry is explicit and nonfatal, never an automatic reset.
test("near-death requires confirmation, preserves MP and does not mutate character until applied", () => {
  const character = fixture(),
    before = structuredClone(character);
  assert.throws(
    () => planTestTool(character, { kind: "near-death" }, undefined, available),
    /確認/,
  );
  const plan = planTestTool(
    character,
    { kind: "near-death", confirmed: true },
    undefined,
    available,
  );
  assert.deepEqual(plan.diff, { hp: 1 });
  assert.deepEqual(character, before);
  character.stats.hp = 0;
  assert.throws(
    () => planTestTool(character, { kind: "near-death", confirmed: true }, undefined, available),
    /復活/,
  );
});
