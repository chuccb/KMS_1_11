/** Regression sources, not executed for this delivery (user requested no testing). */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { NATIVE_JOB_NAMES, nativeSkillBooks } from "../../client/jobs.mjs";
import { WzArchive } from "../src/wz/archive.ts";
import {
  characterDataOf,
  startingCharacterItems,
  zeroStats,
} from "../src/protocol/chardata.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  encodeSkillRequest,
  readSkillRequest,
  encodeSkillUpdate,
  readSkillUpdate,
} from "../src/protocol/skills.ts";
import {
  skillCatalogOf,
  skillLearnState,
  learnedSkillLevel,
  spendSkillPoint,
} from "../src/game/skills.ts";
import {
  characterGrowthContext,
  growthSkillProvider,
} from "../src/game/growth.ts";
import { spendAbility } from "../src/game/ability.ts";
import { ABILITY_MASK } from "../src/protocol/ability.ts";
import { readSave, saveJson } from "../src/game/save.ts";
import { findPacket, resolveCodec } from "../src/protocol/schema.ts";
const archive = () =>
  WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
const character = (job = 100, sp = 30) =>
  characterDataOf(
    Object.assign(zeroStats(), {
      id: 123,
      name: "Skills",
      job,
      level: 10,
      str: 4,
      dex: 4,
      int: 4,
      luk: 4,
      hp: 50,
      maxHp: 50,
      mp: 50,
      maxMp: 50,
      ap: 2,
      sp,
    }),
    startingCharacterItems(),
  );

test("55D140 exact request and 55B6A0 variable skill diff with signed deletion", () => {
  assert.deepEqual(
    [...encodeSkillRequest(1000001)],
    [0x1d, 0x41, 0x42, 0x0f, 0],
  );
  assert.equal(
    readSkillRequest(new PacketReader(encodeSkillRequest(1000001), 1)),
    1000001,
  );
  assert.deepEqual(
    [...encodeSkillUpdate({ ack: true, changes: [] })],
    [0x0e, 1, 0, 0],
  );
  const update = {
    ack: false,
    changes: [
      { skillId: 1000001, level: 10 },
      { skillId: 2000001, level: -1 },
      { skillId: 1000000, level: 0 },
    ],
  };
  assert.deepEqual(
    readSkillUpdate(new PacketReader(encodeSkillUpdate(update), 1)),
    update,
  );
  for (const bytes of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(5)])
    assert.throws(() => readSkillRequest(new PacketReader(bytes)));
  const full = encodeSkillUpdate({
    ack: true,
    changes: [{ skillId: 1000001, level: 1 }],
  });
  for (let n = 1; n < full.length; n++)
    assert.throws(() =>
      readSkillUpdate(new PacketReader(full.subarray(0, n), 1)),
    );
  assert.throws(
    () => readSkillUpdate(new PacketReader(new Uint8Array([0, 0, 0, 0]))),
    /trailing/,
  );
  assert.equal(findPacket(0x1d, "c2s", "field")?.name, "skillUp");
  assert.equal(findPacket(0x0e, "s2c", "field")?.name, "skillUpdate");
  assert.equal(typeof resolveCodec("readSkillUpdate"), "function");
});

test("native job table and 43FFB0 ancestry do not import later-version names or beginner skills", () => {
  assert.equal(NATIVE_JOB_NAMES.get(100), "검사");
  assert.equal(NATIVE_JOB_NAMES.get(110), "전사");
  assert.equal(NATIVE_JOB_NAMES.get(200), "매지션");
  assert.equal(NATIVE_JOB_NAMES.get(230), "성직자");
  assert.deepEqual(nativeSkillBooks(0), []);
  assert.deepEqual(nativeSkillBooks(100), [100]);
  assert.deepEqual(nativeSkillBooks(211), [200, 210, 211]);
  assert.deepEqual(nativeSkillBooks(422), [400, 420, 421, 422]);
  for (const job of [-1, 1, 101, 330, 430, 500, 1000, NaN, 100.5])
    assert.deepEqual(nativeSkillBooks(job), []);
});

test("actual WZ book order, req and level count feed one-SP learning and immediate growth passive context", () => {
  const wz = archive(),
    catalog = skillCatalogOf(wz),
    player = character();
  assert.equal(catalog.book(100)?.name, "전사의 기본");
  const passive = catalog.info(1000001)!;
  assert.equal(passive.maxLevel, 10);
  assert.deepEqual(passive.requirements, [{ skillId: 1000000, level: 5 }]);
  assert.equal(
    passive.levels.at(-1)?.values.x,
    30,
    "not the erroneous 40 in hs",
  );
  const before = structuredClone(player);
  assert.equal(spendSkillPoint(player, 1000001, catalog), undefined);
  assert.deepEqual(player, before);
  assert.equal(skillLearnState(passive, player.items?.map32), 0);
  for (let level = 1; level <= 5; level++)
    assert.deepEqual(spendSkillPoint(player, 1000000, catalog), {
      skillId: 1000000,
      level,
    });
  assert.equal(skillLearnState(passive, player.items?.map32), 1);
  assert.deepEqual(spendSkillPoint(player, 1000001, catalog), {
    skillId: 1000001,
    level: 1,
  });
  assert.equal(player.stats.sp, 24);
  assert.equal(player.flags & 0x20, 0x20);
  assert.deepEqual(
    spendAbility(player.stats, ABILITY_MASK.maxHp, {
      ...characterGrowthContext(player, growthSkillProvider(wz)),
      rand15: () => 0,
    }),
    { maxHp: 88, ap: 1 },
  );
  const accounts = new Map([
    ["skills", { password: "skills", characters: [player] }],
  ]);
  const loaded = readSave(saveJson(accounts)).get("skills")!.characters[0]!;
  assert.equal(learnedSkillLevel(loaded.items?.map32, 1000001), 1);
  assert.equal(loaded.stats.sp, 24);
});

test("max/foreign book/unknown skill/death/no-SP refusal leaves character and items untouched", () => {
  const catalog = skillCatalogOf(archive());
  for (const [job, sp, skill] of [
    [0, 20, 1000000],
    [200, 20, 1000000],
    [100, 0, 1000000],
    [100, 10, 9999999],
    [100, 10, 1100000],
  ]) {
    const player = character(job, sp),
      before = structuredClone(player);
    assert.equal(spendSkillPoint(player, skill!, catalog), undefined);
    assert.deepEqual(player, before);
  }
  const dead = character();
  dead.stats.hp = 0;
  const before = structuredClone(dead);
  assert.equal(spendSkillPoint(dead, 1000000, catalog), undefined);
  assert.deepEqual(dead, before);
  const capped = character();
  capped.items!.map32.push({ key: 1000000, value: 16 });
  const old = structuredClone(capped);
  assert.equal(spendSkillPoint(capped, 1000000, catalog), undefined);
  assert.deepEqual(capped, old);
});
