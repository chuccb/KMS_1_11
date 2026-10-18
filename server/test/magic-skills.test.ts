/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { basicAttackProvider, validatedBasicAttack } from "../src/game/basicattack.ts";
import {
  validatedActiveMagic,
  validatedActiveMelee,
  validatedActiveRanged,
  activeArt,
} from "../src/game/activeskills.ts";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import {
  activeSkill,
  activeMagicActions,
  activeMagicSpeed,
  activeSkillSpeed,
} from "../../client/active-skills.ts";
import {
  magicSearchRects,
  magicHitPoint,
  magicLeg,
  clipMagicRay,
} from "../../client/magiccombat.ts";
import { attackHitDelay } from "../../client/attack-timing.ts";
import { elementAttributes } from "../src/game/elements.ts";
import { rollNativeMagic, type MagicAttackTrace } from "../src/game/nativecombat.ts";
import { statBasis, statTotals } from "../../client/characterstats.ts";
import { consumeSpecOf, consumeTemporary, TIMED_CONSUME_FIELDS } from "../src/game/items.ts";
import { temporaryStats } from "../../client/temporarystats.ts";
import { encodeStatUpdate, readStatUpdate } from "../src/protocol/stat.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  encodeClientAttack,
  readClientAttack,
  encodeUserAttack,
  readUserAttack,
  CLIENT_FIELD_OPCODE,
  FIELD_OPCODE,
  ATTACK_RELAY_OPCODE,
  type ClientAttack,
} from "../src/protocol/field.ts";
const archive = () => WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
const character = () => {
  const c = characterDataOf(
    {
      ...zeroStats(),
      id: 123,
      name: "Magic",
      job: 200,
      level: 20,
      str: 4,
      dex: 4,
      int: 40,
      luk: 15,
      hp: 200,
      maxHp: 200,
      mp: 200,
      maxMp: 200,
    },
    startingCharacterItems(),
  );
  c.items!.map32 = [
    { key: 2001004, value: 1 },
    { key: 2001005, value: 1 },
  ];
  return c;
};
const attack = (id = 2001005): ClientAttack => ({
  skillId: id,
  hits: id === 2001005 ? 2 : 1,
  targetCount: 1,
  action: 28,
  speed: 3,
  facingLeft: false,
  targets: [
    {
      mobId: 1,
      x: 100,
      y: -25,
      hitAnimation: 0,
      sequence: 1,
      damages: id === 2001005 ? [10, 20] : [10],
    },
  ],
});
test("4BE150 eight slots, case-insensitive, duplicates overwrite; unknown text fails rather than disappearing", () => {
  assert.deepEqual(elementAttributes(undefined), Array(8).fill(0));
  assert.deepEqual(elementAttributes("P1iF2l3wH0dU"), [1, 999, 2, 3, 999, 999, 999, 999]);
  assert.deepEqual(elementAttributes("P1p2"), [2, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(elementAttributes("R1"), undefined);
  assert.equal(elementAttributes("P1 I2"), undefined);
});
test("PE5B2374 / 43FC80 aliases are real swingO1/O3, groups1/6 only, no weapon afterimage", () => {
  const a = archive(),
    provider = basicAttackProvider(artReaderOf(a)!);
  for (const id of [1302000, 1372005, 1382000]) {
    const p = provider(id)!;
    assert.deepEqual(
      activeMagicActions(p, 2001004).map((a) => [a.action, a.stance]),
      [
        [28, "swingO1"],
        [29, "swingO3"],
      ],
    );
    assert.ok(
      p.magic!.every(
        (a) => !a.bounds && Object.keys(a.effects).length === 0 && a.baseDelays.length > 0,
      ),
    );
    assert.deepEqual(activeMagicActions(p, 2001004, 3), []);
    assert.equal(activeMagicSpeed(p), p.baseSpeed);
  }
  assert.deepEqual(activeMagicActions(provider(1452002), 2001004), []);
  const wand = provider(1372005)!;
  assert.notEqual(activeMagicSpeed(wand), activeSkillSpeed(wand.baseSpeed!, 2001004, 2));
  assert.equal(activeSkill(2001004)?.kind, "magic");
  assert.equal(activeSkill(2001002), undefined);
});
test("both WZ skills keep prerequisite, actual mad/mastery/cost and distinct ball/effect/hit variants", () => {
  const a = archive(),
    reader = artReaderOf(a)!,
    catalog = skillCatalogOf(a),
    bolt = catalog.info(2001004)!,
    claw = catalog.info(2001005)!;
  assert.equal(bolt.skillType, 0);
  assert.deepEqual(bolt.elements, Array(8).fill(0));
  assert.deepEqual(claw.requirements, [{ skillId: 2001004, level: 1 }]);
  assert.equal(bolt.levels[0]!.values.mad, 12);
  assert.equal(bolt.levels[0]!.values.mpCon, 7);
  assert.equal(claw.levels[0]!.values.mad, 6);
  assert.equal(claw.levels[0]!.values.attackCount, 2);
  const b = activeArt(reader, bolt.id, 1),
    c = activeArt(reader, claw.id, 1);
  assert.equal(b.balls.length, 4);
  assert.equal(b.effects.length, 0);
  assert.equal(b.hitVariants.length, 2);
  assert.equal(c.balls.length, 0);
  assert.equal(c.effects.length, 4);
  assert.equal(c.hitVariants.length, 1);
  assert.ok(b.balls.every((f) => f.delay === 120 && f.path.includes("/2001004/ball/")));
});
test("magic admission is learned/cost/action/speed/posture/ground/hit-domain complete; physical guards stay closed", () => {
  const a = archive(),
    catalog = skillCatalogOf(a),
    provider = basicAttackProvider(artReaderOf(a)!),
    profile = provider(1372005)!,
    c = character(),
    packet = attack();
  const before = structuredClone(c);
  assert.ok(validatedActiveMagic(c, catalog, profile, packet, 4, 1));
  for (const state of [10, 11, 14, 16, 18])
    assert.equal(validatedActiveMagic(c, catalog, profile, packet, state, 1), undefined);
  assert.equal(validatedActiveMagic(c, catalog, profile, packet, 4, 0), undefined);
  for (const patch of [
    { action: 5 },
    { action: 32 },
    { speed: 2 },
    { hits: 1 },
    { projectileSlot: 1 },
    { skillId: 2001002 },
    { targetCount: 2 },
  ])
    assert.equal(
      validatedActiveMagic(c, catalog, profile, { ...packet, ...patch }, 4, 1),
      undefined,
    );
  assert.equal(validatedActiveMagic(c, catalog, provider(1452002), packet, 4, 1), undefined);
  assert.equal(
    validatedActiveMagic(
      c,
      catalog,
      profile,
      { ...packet, targets: [{ ...packet.targets[0]!, damages: [10000, 2] }] },
      4,
      1,
    ),
    undefined,
  );
  assert.equal(validatedBasicAttack(profile, packet, false, 4), undefined);
  assert.equal(validatedActiveMelee(c, catalog, profile, packet, 4), undefined);
  assert.equal(validatedActiveRanged(c, catalog, profile, packet, 4), undefined);
  assert.deepEqual(c, before); // Admission plans do not spend or mutate the save.
  c.stats.mp = 9;
  assert.equal(validatedActiveMagic(c, catalog, profile, packet, 4, 1), undefined);
  c.stats.mp = 10;
  assert.equal(validatedActiveMagic(c, catalog, profile, packet, 4, 1)!.learned.cost.mp, 0);
  c.items!.map32 = [];
  assert.equal(validatedActiveMagic(c, catalog, profile, packet, 4, 1), undefined);
});
test("491F20 cone and 485B80 impact point are not a thin ray or mob-root endpoint", () => {
  const source = { x: 0, y: 0 },
    right = magicSearchRects(source, false),
    left = magicSearchRects(source, true);
  assert.deepEqual(right[0], { left: 50, right: 70, top: -37, bottom: -13 });
  assert.deepEqual(right.at(-1), { left: 290, right: 300, top: -97, bottom: 47 });
  assert.deepEqual(left[0], { left: -70, right: -50, top: -37, bottom: -13 });
  assert.deepEqual(magicHitPoint(source, false, { left: 100, right: 120, top: -60, bottom: -40 }), {
    x: 110,
    y: -40,
  });
  const leg = magicLeg(source, false, { x: 150, y: -25 });
  assert.equal(leg.duration, 150);
  assert.equal(leg.x0, 50);
  assert.equal(magicLeg(source, true).x1, -300);
});
test("564600 directed segments: nearest, group, reverse face and unlinked endpoint", () => {
  const source = { x: 0, y: 0 },
    point = { x: 300, y: -25 };
  const wall = { id: 1, x1: 100, y1: 100, x2: 100, y2: -100, prev: 0, next: 0, group: 1 };
  assert.deepEqual(clipMagicRay(source, point, [wall], 1), {
    point: { x: 100, y: -25 },
    blocked: true,
  });
  assert.equal(clipMagicRay(source, point, [wall], 2).blocked, false);
  assert.equal(clipMagicRay(source, point, [{ ...wall, y1: -100, y2: 100 }], 1).blocked, false);
  assert.equal(clipMagicRay(source, point, [{ ...wall, y2: -25 }], 1).blocked, false);
  assert.equal(
    clipMagicRay(source, point, [{ ...wall, id: 2, x1: 200, x2: 200 }, wall], 1).point.x,
    100,
  );
});
test("4C89D0 independently uses INT/LUK, MAD/mastery/skill mad, MD and a seven-word cyclic stream", () => {
  const c = character(),
    basis = statBasis({ ...c.stats, int: 100, luk: 100 }, []),
    totals = { ...statTotals(basis), mad: 100, pad: 999, acc: 999 };
  let draws = 0,
    trace: MagicAttackTrace | undefined;
  const damage = rollNativeMagic(
    basis,
    totals,
    { level: 20, eva: 0, md: 20, pd: 999 } as { level: number; eva: number; md: number },
    { mad: 50, mastery: 0 },
    [],
    () => {
      draws++;
      return 0;
    },
    undefined,
    (t) => {
      trace = t;
    },
  );
  assert.equal(draws, 7);
  assert.equal(trace!.raw, 63.5);
  assert.equal(trace!.defense, 10);
  assert.equal(damage, 53);
  const random = { values: [0, 1000000, 2000000, 3000000, 4000000, 5000000, 6000000], cursor: 0 };
  for (let i = 0; i < 3; i++)
    rollNativeMagic(
      basis,
      totals,
      { level: 20, eva: 0 },
      { mad: 50 },
      [],
      () => {
        throw new Error("no per-hit reseed");
      },
      random,
    );
  assert.equal(random.cursor, 9);
  const miss = { values: Array(7).fill(0), cursor: 0 };
  assert.equal(
    rollNativeMagic(
      basis,
      { ...totals, acc: 999 },
      { level: 20, eva: 999 },
      { mad: 50 },
      [],
      () => 0,
      miss,
    ),
    0,
  );
  assert.equal(miss.cursor, 1); // Listing4C8B6D; not the discarded preliminary two-slot hypothesis.
  const raw: (n: number) => number = (n) =>
    rollNativeMagic(basis, { ...totals, mad: n }, { level: 20, eva: 0 }, { mad: 50 }, [], () => 0);
  assert.ok(raw(200) > raw(100));
  assert.equal(raw(1000), raw(999));
});
test("magic element starts with mob P, takes maximum only for skill-marked I..D; U/999 are not guessed immunity", () => {
  const c = character(),
    basis = statBasis({ ...c.stats, int: 100, luk: 100 }, []),
    totals = { ...statTotals(basis), mad: 100 };
  const roll = (mob: number[], skill: number[] = []) =>
    rollNativeMagic(basis, totals, { level: 20, elements: mob }, { mad: 50 }, skill, () => 0);
  assert.equal(roll([1]), 31);
  assert.equal(roll([2]), 95);
  assert.equal(roll([0, 2], [0, 999]), 95);
  assert.equal(roll([0, 2]), 63);
  assert.equal(roll([0, 0, 0, 0, 0, 0, 0, 2], [0, 0, 0, 0, 0, 0, 0, 999]), 63);
  assert.equal(roll([999]), 63);
});
test("0x11 has no ammo slot or shot-only u16; 0x25 relay reads as magic without a projectile item", () => {
  const packet = attack(),
    bytes = encodeClientAttack(packet, CLIENT_FIELD_OPCODE.magicAttack);
  assert.equal(bytes[0], 0x11);
  assert.deepEqual(readClientAttack(new PacketReader(bytes, 1), 0x11), packet);
  assert.equal(bytes.length, 8 + 11 + 4 * 2);
  assert.equal(ATTACK_RELAY_OPCODE[0x11], 0x25);
  const relay = {
    characterId: 123,
    hits: 2,
    skillLevel: 1,
    skillId: 2001005,
    facingLeft: false,
    action: 28,
    speed: 3,
    afterimage: 0,
    projectileItemId: 0,
    targets: [{ mobId: 1, hitAnimation: 0, damages: [10, 20] }],
  };
  const wire = encodeUserAttack(relay, FIELD_OPCODE.userMagicAttack);
  assert.equal(wire[0], 0x25);
  assert.deepEqual(readUserAttack(new PacketReader(wire, 1)), relay);
  assert.deepEqual([0, 1, 2].map(attackHitDelay), [0, 120, 240]);
});
test("MAD/EVA/PDD items reach the exact same wire list, typed icons, replacement and strict expiry", () => {
  const a = archive();
  for (const id of [2002000, 2002002, 2002003]) {
    const spec = consumeSpecOf(a, id)!,
      temp = consumeTemporary(spec, id)!;
    assert.ok(temp);
    assert.deepEqual(spec.unapplied, []);
    assert.equal(temp.sourceIsSkill, false);
    const read = readStatUpdate(
      new PacketReader(encodeStatUpdate({ diff: {}, temporary: temp }), 1),
    );
    assert.deepEqual(read.temporary?.values, temp.values);
  }
  assert.ok(TIMED_CONSUME_FIELDS.includes("eva"));
  assert.ok(TIMED_CONSUME_FIELDS.includes("pdd"));
  const timer = temporaryStats(),
    small = consumeTemporary(consumeSpecOf(a, 2002002)!, 2002002)!,
    big = consumeTemporary(consumeSpecOf(a, 2002003)!, 2002003)!;
  timer.apply(small, 0);
  timer.apply(big, 10);
  assert.equal(timer.values(10).mad, 10);
  assert.equal(timer.values(300010).mad, 10);
  assert.equal(timer.values(300011).mad, undefined);
  assert.equal(
    consumeTemporary({ ...consumeSpecOf(a, 2002002)!, unapplied: ["mdd"] }, 2002002),
    undefined,
  );
});
