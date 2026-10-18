/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { skillCatalogOf, skillNumericValue } from "../src/game/skills.ts";
import {
  activeTemporary,
  learnedActive,
  validatedActiveMelee,
  activeArt,
} from "../src/game/activeskills.ts";
import { basicAttackProvider } from "../src/game/basicattack.ts";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { readClientSkillUse, encodeClientSkillUse } from "../src/protocol/skilluse.ts";
import { readUserEffect, encodeUserEffect } from "../src/protocol/field.ts";
import type { ClientAttack } from "../src/protocol/field.ts";
import {
  activeSkill,
  activeSkillCost,
  activeSkillSpeed,
  activeMeleeActions,
  activeMeleeBounds,
} from "../../client/active-skills.ts";
import {
  bindQuickItem,
  moveQuickItem,
  clearQuickItem,
  quickItemProfile,
} from "../../client/quickslots.ts";
import { temporaryStats } from "../../client/temporarystats.ts";
import { statBasis, statTotals } from "../../client/characterstats.ts";
import { rollNativePhysical, type PhysicalAttackTrace } from "../src/game/nativecombat.ts";
import { findPacket, resolveCodec } from "../src/protocol/schema.ts";
const archive = () => WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
const character = (id: number, level = 1) => {
  const c = characterDataOf(
    {
      ...zeroStats(),
      id: 123,
      name: "Active",
      job: 100,
      level: 20,
      str: 100,
      dex: 50,
      int: 20,
      luk: 20,
      hp: 500,
      maxHp: 500,
      mp: 500,
      maxMp: 500,
    },
    startingCharacterItems(),
  );
  c.items!.map32 = [{ key: id, value: level }];
  return c;
};
test("55D320 exact seven-byte self buff, not 0x1D SP or 0x1F merchant", () => {
  const packet = encodeClientSkillUse({ skillId: 1001003, level: 1, targets: [] });
  assert.equal(Buffer.from(packet).toString("hex"), "1e2b460f000100");
  assert.deepEqual(readClientSkillUse(new PacketReader(packet, 1)), {
    skillId: 1001003,
    level: 1,
    targets: [],
  });
  const party = encodeClientSkillUse({
    skillId: 0x01020304,
    level: 2,
    targets: [0x55667788, 0x99aabbcc],
  });
  assert.equal(Buffer.from(party).toString("hex"), "1e04030201020288776655ccbbaa99");
  for (let end = 1; end < party.length; end++)
    assert.throws(() => readClientSkillUse(new PacketReader(party.slice(0, end), 1)));
  assert.throws(() => readClientSkillUse(new PacketReader(Uint8Array.from([...packet, 0]), 1)));
  assert.throws(() => encodeClientSkillUse({ skillId: 1001003, level: 0, targets: [] }));
  const schema = findPacket(0x1e, "c2s", "field")!;
  assert.equal(schema.name, "activeSkillUse");
  for (const name of schema.codecs) assert.equal(typeof resolveCodec(name), "function");
});
test("522300 type1 includes BOTH id and level; type0 still remains six bytes", () => {
  const effect = { characterId: 123, effect: 1, skillId: 1001003, skillLevel: 20 };
  const bytes = encodeUserEffect(effect);
  assert.equal(Buffer.from(bytes).toString("hex"), "297b000000012b460f0014");
  assert.deepEqual(readUserEffect(new PacketReader(bytes, 1)), effect);
  assert.throws(() => readUserEffect(new PacketReader(bytes.slice(0, -1), 1)));
  assert.throws(() => encodeUserEffect({ ...effect, skillLevel: 0 }));
  assert.equal(encodeUserEffect({ characterId: 123, effect: 0 }).length, 6);
});
test("HP strictly greater than cost, MP equality allowed, no mutation on refusal", () => {
  const stats = { hp: 8, mp: 7 };
  assert.equal(activeSkillCost(stats, { hpCon: 8, mpCon: 7 }), undefined);
  assert.deepEqual(stats, { hp: 8, mp: 7 });
  assert.deepEqual(activeSkillCost({ hp: 9, mp: 7 }, { hpCon: 8, mpCon: 7 }), { hp: 1, mp: 0 });
  assert.equal(activeSkillCost({ hp: 0, mp: 500 }, {}), undefined);
  assert.equal(activeSkillCost({ hp: 50, mp: 6 }, { mpCon: 7 }), undefined);
  assert.equal(activeSkill(2001005)?.kind, "magic"); // Independent magic admission, not a free physical path.
  assert.equal(activeSkill(2001002), undefined); // No pretend Magic Guard without damage transfer.
  assert.equal(activeSkill(1301006), undefined); // Present in archive, absent from native dispatch.
});
test("BSTR numeric level data is real arithmetic, not parsed from hs", () => {
  assert.equal(skillNumericValue("20"), 20);
  assert.equal(skillNumericValue(" -10 "), -10);
  assert.equal(skillNumericValue("MP 18"), undefined);
  assert.equal(skillNumericValue(""), undefined);
  const catalog = skillCatalogOf(archive());
  const focus = catalog.info(3001003)!.levels.find((row) => row.level === 20)!.values;
  assert.equal(focus.acc, 20);
  assert.equal(focus.eva, 20);
  assert.equal(focus.mpCon, 16); // hs says 18, actual mpCon says 16.
  const slash = catalog.info(1001005)!.levels.find((row) => row.level === 20)!.values;
  assert.equal(slash.mpCon, 15); // hs says 14, actual mpCon says 15.
  assert.equal(activeTemporary(3001003, focus)!.durationMs, 300000);
  assert.deepEqual(activeTemporary(1101006, { time: 8, pad: 1, pdd: -1 })!.values, {
    pad: 1,
    pdd: -1,
  });
  assert.equal(activeTemporary(1101006, { pad: 1 }), undefined);
});
test("native dagger-only selectors and speed-minus-one; resources/learned level verified independently", () => {
  const a = archive(),
    catalog = skillCatalogOf(a),
    provider = basicAttackProvider(artReaderOf(a)!);
  const dagger = provider(1332000)!,
    sword = provider(1302000)!;
  assert.ok(dagger);
  assert.ok(activeMeleeActions(dagger, 4001334).every((row) => [16, 17].includes(row.action)));
  assert.deepEqual(activeMeleeActions(sword, 4001334), []);
  assert.equal(activeSkillSpeed(3, 4001334), 2);
  assert.equal(activeSkillSpeed(0, 4001334), 0);
  assert.equal(activeSkillSpeed(3, 1001004), 3);
  const c = character(4001334),
    motion = activeMeleeActions(dagger, 4001334)[0]!;
  const attack: ClientAttack = {
    skillId: 4001334,
    hits: 2,
    targetCount: 1,
    action: motion.action,
    facingLeft: false,
    speed: activeSkillSpeed(dagger.speed, 4001334),
    targets: [{ mobId: 1, x: 0, y: 0, hitAnimation: 0, sequence: 1, damages: [10, 20] }],
  };
  assert.ok(validatedActiveMelee(c, catalog, dagger, attack, 4));
  for (const bad of [14, 16, 18, 10])
    assert.equal(validatedActiveMelee(c, catalog, dagger, attack, bad), undefined);
  assert.equal(validatedActiveMelee(c, catalog, dagger, { ...attack, hits: 1 }, 4), undefined);
  assert.equal(validatedActiveMelee(c, catalog, dagger, { ...attack, speed: 6 }, 4), undefined);
  assert.equal(validatedActiveMelee(c, catalog, sword, attack, 4), undefined);
  c.items!.map32 = [];
  assert.equal(learnedActive(c, catalog, 4001334), undefined);
});
test("Slash Blast extension needs a near hit; duplicate/over-limit/over-domain records refuse", () => {
  const a = archive(),
    catalog = skillCatalogOf(a),
    profile = basicAttackProvider(artReaderOf(a)!)(1302000)!;
  const c = character(1001005),
    motion = profile.melee[0]!,
    bounds = { left: -60, right: 0, top: -50, bottom: 0 };
  assert.equal(activeMeleeBounds(bounds, 130, false, false), bounds);
  assert.deepEqual(activeMeleeBounds(bounds, 130, true, true), { ...bounds, left: -130 });
  const attack: ClientAttack = {
    skillId: 1001005,
    hits: 1,
    targetCount: 6,
    action: motion.action,
    speed: profile.speed,
    facingLeft: false,
    targets: Array.from({ length: 6 }, (_, i) => ({
      mobId: i + 1,
      x: 0,
      y: 0,
      sequence: 1,
      hitAnimation: 0,
      damages: [1],
    })),
  };
  assert.ok(validatedActiveMelee(c, catalog, profile, attack, 4));
  assert.equal(
    validatedActiveMelee(
      c,
      catalog,
      profile,
      { ...attack, targets: [...attack.targets, attack.targets[0]!], targetCount: 7 },
      4,
    ),
    undefined,
  );
  assert.equal(
    validatedActiveMelee(
      c,
      catalog,
      profile,
      { ...attack, targets: attack.targets.map(() => attack.targets[0]!) },
      4,
    ),
    undefined,
  );
  assert.equal(
    validatedActiveMelee(
      c,
      catalog,
      profile,
      { ...attack, targets: [{ ...attack.targets[0]!, damages: [65535] }], targetCount: 1 },
      4,
    ),
    undefined,
  );
});
test("4C7960 physical skill factor is after PD, before clamp; hit loop shares seven-word cursor", () => {
  const c = character(1001004),
    basis = statBasis(c.stats, [{ slot: 11, itemId: 1302000, stats: { pad: 50 } }]);
  const totals = statTotals(basis)!;
  let trace: PhysicalAttackTrace | undefined,
    draws = 0;
  const random = { values: Array(7).fill(5000000), cursor: 0 };
  const damage = rollNativePhysical(
    c,
    basis,
    totals,
    { level: 20, eva: 0, pd: 20 },
    5,
    0,
    0,
    undefined,
    () => {
      draws++;
      return 0;
    },
    (value) => {
      trace = value;
    },
    { damagePercent: 130, random },
  );
  assert.equal(draws, 0);
  assert.ok(random.cursor > 0);
  assert.ok(Math.abs(trace!.beforeClamp - (trace!.afterAttribute - trace!.defense) * 1.3) < 1e-8);
  assert.equal(damage, Math.trunc(Math.max(1, Math.min(9999, trace!.beforeClamp))));
  const prior = random.cursor;
  rollNativePhysical(
    c,
    basis,
    totals,
    { level: 20, eva: 0, pd: 20 },
    5,
    0,
    0,
    undefined,
    () => {
      draws++;
      return 0;
    },
    undefined,
    { damagePercent: 130, random },
  );
  assert.equal(draws, 0);
  assert.ok(random.cursor > prior);
});
test("buffs replace only overlapping fields and expire strictly after deadline; no old buff revival", () => {
  const timer = temporaryStats();
  timer.apply(
    { sourceId: 1101006, sourceIsSkill: true, durationMs: 1000, values: { pad: 10, pdd: -10 } },
    0,
  );
  timer.apply({ sourceId: 1001003, sourceIsSkill: true, durationMs: 100, values: { pdd: 2 } }, 10);
  assert.deepEqual(timer.values(110), { pad: 10, pdd: 2 });
  assert.deepEqual(timer.values(111), { pad: 10 });
  assert.deepEqual(timer.values(1001), {});
});
test("skill/item ID overlap is typed; legacy numeric profiles and seven-slot rebind/clear survive", () => {
  const skill = { kind: "skill", skillId: 2001003 } as const;
  const old = [2001003, null, null, null, null, null, null]; // A numeric consumable is not a skill binding.
  const bound = bindQuickItem(old, 1, skill)!;
  assert.equal(bound[0], 2001003);
  assert.deepEqual(bound[1], skill);
  const moved = moveQuickItem(bound, 1, 2, { ...skill })!;
  assert.equal(moved[1], null);
  assert.deepEqual(moved[2], skill);
  assert.equal(clearQuickItem(moved, 2, { ...skill })![2], null);
  const store = { getItem: () => JSON.stringify(moved), setItem: () => {} };
  const profile = quickItemProfile(store, "owner");
  assert.equal(profile.values()[0], 2001003);
  assert.deepEqual(profile.values()[2], skill);
});
test("native armor effect is procedural, skill canvases keep original paths and native default 120ms", () => {
  const reader = artReaderOf(archive())!;
  assert.equal(activeArt(reader, 1001003, 1).armorFlash, true);
  const power = activeArt(reader, 1001004, 1);
  assert.ok(power.effects.length > 0);
  assert.ok(power.hits.length > 0);
  assert.equal(power.hitVariants.length, 1);
  assert.equal(activeArt(reader, 1001005, 1).hitVariants.length, 2);
  assert.equal(activeArt(reader, 4001334, 1).hitVariants.length, 2);
  assert.ok(power.hits.every((frame) => frame.path.includes("/hit/0/")));
  assert.ok(
    power.effects.every((frame) => frame.path.startsWith("Skill/100.img/skill/1001004/effect/")),
  );
  assert.equal(power.useSound, "Skill/1001004/Use");
  assert.equal(activeArt(reader, 1101006, 1).useSound, undefined);
});
