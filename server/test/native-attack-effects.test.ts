/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { basicAttackProvider } from "../src/game/basicattack.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { nativeWeaponMastery } from "../src/game/nativecombat.ts";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import {
  attackProfileAtTier,
  attackMasteryTier,
  weaponMasterySkills,
  nativeAfterimageFrames,
  attackWorldRect,
  attackHitPoint,
  impactPosition,
  weaponHitKeys,
  ATTACK_EFFECT_Z,
  ATTACK_ORIGIN_HEIGHT,
  SHOT_NEAR_CLIP,
  shotNearDistance,
} from "../../client/attack-presentation.ts";
import { animationFrame } from "../../client/animation.ts";
import { shotRelease, attackDuration } from "../../client/attack-timing.ts";

import { projectileLeg, shotNear } from "../../client/basiccombat.ts";
import { MAGIC_HEIGHT, MAGIC_NEAR } from "../../client/magiccombat.ts";
import { encodeUserAttack, readUserAttack, FIELD_OPCODE } from "../src/protocol/field.ts";
import { PacketReader } from "../src/protocol/packet.ts";

import { createAudio } from "../../client/audio.ts";
const data = resolve(import.meta.dirname, "../../Data.wz"),
  needs = { skip: !existsSync(data) };
const archive = () => WzArchive.open(data);
const source = (file: string) => readFileSync(resolve(import.meta.dirname, "../../", file), "utf8");
test("40EA70 overrides WZ timing/alpha, starts opaque, 30ms intermediates and last200ms fade; not a body-frame attachment", () => {
  const input = Array.from({ length: 3 }, (_, i) => ({
    path: `frame${i}`,
    ox: 0,
    oy: 0,
    delay: 999,
    a0: 0,
    a1: 255,
  }));
  const frames = nativeAfterimageFrames(input);
  assert.deepEqual(
    frames.map((f) => [f.delay, f.a0, f.a1]),
    [
      [30, -1, -1],
      [30, -1, -1],
      [200, -1, 0],
    ],
  );
  assert.equal(animationFrame(frames, 0, false)!.alpha, 1);
  assert.equal(animationFrame(frames, 60, false)!.alpha, 1);
  assert.equal(animationFrame(frames, 160, false)!.alpha, 0.5);
  assert.equal(animationFrame(frames, 260, false)!.alpha, 0);
  assert.equal(input[0]!.delay, 999, "metadata is never mutated");
  const motion = { delays: [262, 350] };
  assert.equal(shotRelease(motion), 262);
  assert.equal(attackDuration(motion), 630);
});
test(
  "actual swordOL first property child2 holds ONE sequence, all mastery tiers preserve bounds and native timings",
  needs,
  () => {
    const p = basicAttackProvider(artReaderOf(archive())!)(1302000)!;
    assert.equal(p.masteryLevels?.[1100000]?.[20], 10);
    for (const tier of [0, 1, 5, 10]) {
      const selected = attackProfileAtTier(p, tier)!,
        motion = selected.melee.find((a) => a.action === 5)!;
      assert.ok(motion.bounds);
      assert.ok(motion.afterimage?.length);
      assert.ok(
        motion.afterimage!.every((f) => f.path.includes(`/swordOL.img/${tier}/swingO1/2/`)),
      );
      assert.equal(motion.afterimage!.at(-1)!.delay, 200);
      assert.equal(motion.afterimage!.at(-1)!.a1, 0);
      assert.ok(motion.afterimage!.slice(0, -1).every((f) => f.delay === 30 && f.a1 === -1));
      assert.deepEqual(
        motion.effects,
        {},
        "old body-frame effect slot cannot animate accidentally",
      );
    }
    assert.equal(
      attackProfileAtTier(p, 255)!.melee[0]!.bounds,
      undefined,
      "absent tier is not silently tier0",
    );
    assert.deepEqual(attackProfileAtTier(p, 255)!.melee[0]!.afterimage, []);
  },
);
test(
  "4BE270 native formula and browser art select the same learned WZ passive, mode0 vs1 and ordered sword fallback",
  needs,
  () => {
    const a = archive(),
      catalog = skillCatalogOf(a),
      provider = basicAttackProvider(artReaderOf(a)!);
    const c = characterDataOf(
      { ...zeroStats(), id: 7, name: "Effects", job: 110, level: 30 },
      startingCharacterItems(),
    );
    c.items!.map32 = [
      { key: 1100000, value: 20 },
      { key: 3100000, value: 20 },
    ];
    const levelOf = (id: number) => c.items!.map32!.find((r) => r.key === id)?.value ?? 0;
    assert.deepEqual(weaponMasterySkills(1302000), [1100000, 1200000]);
    assert.deepEqual(
      weaponMasterySkills(30),
      [1100000, 1200000],
      "physical formula passes native type, presentation passes item ID",
    );
    assert.equal(nativeWeaponMastery(c, catalog, 1302000), 10);
    assert.equal(attackMasteryTier(provider(1302000)!, levelOf), 10);
    // The mode gates stay observable through the selection table itself: 4BE270's switch admits
    // case 45 only with n2==1 and names 3100000; case 30/40 only with n2==0.
    assert.deepEqual(weaponMasterySkills(1452002, true), [3100000]);
    assert.deepEqual(weaponMasterySkills(1452002), []);
    assert.deepEqual(weaponMasterySkills(1302000, true), []);
    assert.equal(nativeWeaponMastery(c, catalog, 1452002, false), 0);
    // This Data.wz ships only Skill books 100/110/120/130/200/300/400 - there is no 310.img for
    // 3100000 to read level rows from. sub_4BDD20 resolves the WZ data table FIRST (sub_4BAC80,
    // cached in dword_5C2108) and returns 0 when it is missing, BEFORE walking the character's
    // learned records - so the fabricated learned row cannot conjure a tier, in the original
    // client or here. The presentation side (masteryLevels rows from the same missing path)
    // agrees at 0; both sides select the same learned WZ passive, and both stay honest.
    assert.equal(nativeWeaponMastery(c, catalog, 1452002, true), 0);
    assert.equal(attackMasteryTier(provider(1452002)!, levelOf, true), 0);
    assert.equal(attackMasteryTier(provider(1452002)!, levelOf, false), 0);
    // 37 passes 4BE270's first switch but has no case in the second: no mastery skills at all.
    assert.deepEqual(weaponMasterySkills(1372005, true), []);
  },
);
test("485B80 intersection centre, off-axis extension, negative truncation and mirrored attack RECT", () => {
  const left = attackWorldRect(
    { x: 100, y: 200 },
    { left: -70, right: -10, top: -60, bottom: 0 },
    true,
  )!;
  assert.deepEqual(left, { left: 30, right: 90, top: 140, bottom: 200 });
  assert.deepEqual(
    attackWorldRect({ x: 100, y: 200 }, { left: -70, right: -10, top: -60, bottom: 0 }, false),
    { left: 110, right: 170, top: 140, bottom: 200 },
  );
  assert.deepEqual(attackHitPoint(left, { left: 40, right: 60, top: 150, bottom: 170 }), {
    x: 50,
    y: 160,
  });
  assert.deepEqual(
    attackHitPoint(
      { left: 50, right: 300, top: -25, bottom: -24 },
      { left: 70, right: 90, top: -60, bottom: -40 },
    ),
    { x: 80, y: -40 },
  );
  assert.equal(attackHitPoint(left, undefined), undefined);
});
test("487A30 clamps the stored relative offset at impact, then created coordinates do not follow a moving/dead mob", () => {
  const mob = { x: 100, y: 100 },
    rect = { left: 80, right: 120, top: 40, bottom: 100 };
  const point = impactPosition({ x: 90, y: -90 }, mob, rect)!;
  assert.deepEqual(point, { x: 120, y: 40 });
  mob.x = 999;
  mob.y = 999;
  assert.deepEqual(point, { x: 120, y: 40 });
  assert.equal(
    impactPosition({ x: 0, y: 0 }, mob, { left: 1, right: 1, top: 1, bottom: 2 }),
    undefined,
  );
  assert.equal(ATTACK_EFFECT_Z, 250310);
});
test(
  "50D7F0 original default sparks, F actions, no unknown weapon fallback and true WZ frames",
  needs,
  () => {
    assert.deepEqual(weaponHitKeys(1302000, 5), ["sword1", "sword2"]);
    assert.deepEqual(weaponHitKeys(1372005, 6), ["mace1", "mace2"]);
    assert.deepEqual(weaponHitKeys(1472000, 30), ["maceF"]);
    assert.deepEqual(weaponHitKeys(1302000, 8), ["swordF"]);
    assert.deepEqual(weaponHitKeys(0, 5), []);
    const p = basicAttackProvider(artReaderOf(archive())!)(1302000)!;
    for (const key of ["sword1", "sword2", "swordF", "mace1", "mace2", "maceF"]) {
      assert.ok(p.hitEffects![key]!.length);
      assert.ok(
        p.hitEffects![key]!.every((f) => f.path.startsWith(`Character/Afterimage/hit.img/${key}/`)),
      );
    }
  },
);
test("projectiles use the captured native hit point, not the old hard-coded root-20", () => {
  const leg = projectileLeg(0, 100, false, { x: 100, y: 100, point: { x: 120, y: 70 } }, 65, 200);
  assert.equal(leg.x1, 120);
  assert.equal(leg.y1, 70);
  assert.equal(leg.y0, 75);
  assert.equal(leg.duration, Math.trunc(Math.hypot(55, -5) * 1.5));
});
test("0x23/24 relay preserves real mastery tier without changing the native packet layout", () => {
  const value = {
    characterId: 7,
    hits: 1,
    skillLevel: 0,
    skillId: 0,
    action: 5,
    speed: 2,
    facingLeft: true,
    afterimage: 10,
    projectileItemId: 0,
    targets: [],
  };
  const packet = encodeUserAttack(value, FIELD_OPCODE.userAttack);
  assert.equal(readUserAttack(new PacketReader(packet, 1)).afterimage, 10);
  assert.match(source("server/src/client/session.ts"), /afterimage:\s*attack\.afterimage/);
});
test("audio validity is rechecked AFTER decoding and preloading does not play a sound", async () => {
  let started = 0,
    resolveDecode: ((value: unknown) => void) | undefined,
    valid = true,
    notifyDecode!: () => void;
  const decoding = new Promise<void>((resolve) => {
    notifyDecode = resolve;
  });
  const context = {
    destination: {},
    resume: async () => {},
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
    decodeAudioData: () =>
      new Promise((resolve) => {
        resolveDecode = resolve;
        notifyDecode();
      }),
    createBufferSource: () => ({
      connect() {},
      disconnect() {},
      stop() {},
      start() {
        started++;
      },
    }),
  };
  const audio = createAudio({
    createContext: () => context as unknown as AudioContext,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
  });
  await audio.unlock();
  const loading = audio.effect("Weapon/swordL/Attack", 1, { valid: () => valid });
  // Wait for the fake decoder boundary; no real timer, microtask-count guess or browser.
  await decoding;
  assert.ok(resolveDecode);
  valid = false;
  resolveDecode!({ length: 1, numberOfChannels: 1 });
  await loading;
  assert.equal(started, 0);
  await audio.preload("Weapon/swordL/Attack");
  assert.equal(started, 0);
  await audio.effect("Weapon/swordL/Attack", 1, { deadline: -1 });
  assert.equal(started, 0);
});
test("both actors use the independent child5 clock; hit art/world damage enter the same ordered root plane", () => {
  const main = source("client/main.js"),
    server = source("server/src/net/loginserver.ts");
  assert.doesNotMatch(main, /drawMiddle|attack\.effects\?\.|swing\.effects\?\./);
  assert.match(main, /queueWeaponAfterimage\(entity,selfSwing,now\)/);
  assert.match(main, /queueWeaponAfterimage\(user,motion,now\)/);
  assert.match(main, /kind:'hit-effect',effect,z:ATTACK_EFFECT_Z/);
  assert.match(main, /flip:!presentation\.facingLeft/);
  assert.match(main, /activePredictions\.consume\(message\.attackToken,message\.mobId\)/);
  assert.match(
    server,
    /queueActiveHits\(\s*session,\s*opcode,\s*attack,\s*now\s*\+\s*shotRelease\(basicMotion\),?\s*\)/,
  );
});

test("513C80/514D30: every attack line leaves the actor at y-25, magic and shot alike", () => {
  // sub_513C80 `.c:279602`: `p_right_1 = this_1[101] - 25`. sub_514D30 uses the same figure, so it
  // is one shared number and not a magic-only height - MAGIC_HEIGHT is now just its alias.
  assert.equal(ATTACK_ORIGIN_HEIGHT, 25);
  assert.equal(projectileLeg(0, 100, false, undefined, 65, 200).y0, 75);
  assert.equal(
    projectileLeg(0, 100, true, undefined, 65, 200).y0,
    75,
    "facing changes x, not the origin height",
  );
  assert.equal(projectileLeg(500, -40, false, undefined, 65, 200).y0, -65);
  // The magic constants that really are magic-specific stay separate: X +/-50..300.
  assert.notEqual(MAGIC_HEIGHT, MAGIC_NEAR);
  assert.equal(MAGIC_HEIGHT, ATTACK_ORIGIN_HEIGHT, "same 25, one home");
});

test("512F90 clips a shot's near bound to 65 and to one pixel inside the far bound", () => {
  // `*a4 = 65;` then `if (left < -65) left = -65; if (left >= right - 1) left = right - 1; *a4 = -left;`
  assert.equal(SHOT_NEAR_CLIP, 65);
  // No bounds at all: the native's own default of 65, which the page used to write as a literal.
  assert.equal(shotNearDistance(undefined), 65);
  assert.equal(shotNear(undefined), 65);
  assert.equal(shotNear({}), 65);
  // Inside the clip: the bounds' own left edge, mirrored into a distance.
  assert.equal(shotNearDistance({ left: -30, right: 200, top: 0, bottom: 0 }), 30);
  // Beyond it: pinned at 65, never nearer than that however long the weapon's rectangle is.
  assert.equal(shotNearDistance({ left: -400, right: 200, top: 0, bottom: 0 }), 65);
  assert.equal(
    shotNearDistance({ left: -65, right: 200, top: 0, bottom: 0 }),
    65,
    "exactly the clip",
  );
  assert.equal(shotNearDistance({ left: -64, right: 200, top: 0, bottom: 0 }), 64);
  // The two clamps run in that order - "-65 first", then "inside the far edge" - so a rectangle
  // whose far edge is behind the clip lands on right - 1, which can be *further* than 65. No real
  // weapon rectangle is shaped like that; these pin the order, not a case anyone will hit.
  assert.equal(shotNearDistance({ left: -80, right: -70, top: 0, bottom: 0 }), 71);
  assert.equal(shotNearDistance({ left: 0, right: -70, top: 0, bottom: 0 }), 71);
  assert.equal(
    shotNearDistance({ left: -80, right: 0, top: 0, bottom: 0 }),
    65,
    "the -65 clamp already won",
  );
});
