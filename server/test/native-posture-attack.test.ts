/** Regression SOURCE ONLY: not run, typechecked, syntax-checked, browser/VM/probe validated. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attackDuration,
  attackFrame,
  attackFrameStart,
  attackCanvasFrame,
  shotRelease,
  scaledAttackDelays,
  basicAttackAction,
} from "../../client/attack-timing.ts";

import {
  beginAttackAlert,
  advanceAttackAlert,
  clearAttackAlert,
  playerPosture,
  nativeBodyAction,
  forcedAttackInput,
} from "../../client/posture.ts";

// @ts-expect-error Browser pure module has no declaration.
import { recoveryTick } from "../../client/recovery.mjs";

import { collisionWorld, createPlayer, advancePlayer } from "../../client/motion.ts";
import {
  basicAttackPostureAllows,
  validatedBasicAttack,
  type BasicAttackProfile,
} from "../src/game/basicattack.ts";

test("508700/50B590: forced body rounds EACH countdown, but release keeps the raw sum", () => {
  const delays = scaledAttackDelays([300, 400], 2);
  assert.deepEqual(delays, [262, 350]);
  const motion = { delays, start: 100, frameIndices: [0, 1] };
  assert.equal(attackDuration(motion), 630);
  assert.equal(shotRelease(motion), 262, "not 270, 280 or duration-lastDelay");
  assert.equal(attackFrame(motion, 99), -1);
  assert.equal(attackFrame(motion, 369), 0);
  assert.equal(attackFrame(motion, 370), 1);
  assert.equal(attackFrame(motion, 729), 1);
  assert.equal(attackFrame(motion, 730), -1);
  assert.equal(attackFrameStart(motion, 1), 270);
  assert.equal(attackCanvasFrame({ delays: [31, 61], frameIndices: [2, 7] }, 1), 7);
  assert.equal(
    attackDuration({ delays: [0, -1, 31] }),
    120,
    "nonpositive countdown still waits one native update",
  );
  assert.equal(attackDuration(), 0, "missing metadata is not a fabricated 480ms animation");
  assert.equal(shotRelease(), 0);
  assert.deepEqual(scaledAttackDelays([150], 99), [206]);
});

test("50D700 chooses INPUT, not residual velocity; down wins only with no horizontal input", () => {
  const body: any = { grounded: true, vx: 100, moveX: 0, moveY: 0, facing: 0 };
  assert.equal(playerPosture(body), "stand1");
  body.vx = 0;
  body.moveX = -1;
  assert.equal(playerPosture(body), "walk1", "walking against a wall does not turn into stand");
  body.moveY = 1;
  assert.equal(playerPosture(body), "walk1");
  body.moveX = 0;
  assert.equal(playerPosture(body), "prone");
  body.grounded = false;
  assert.equal(playerPosture(body), "jump");
  body.ladder = { ladder: true };
  assert.equal(playerPosture(body), "ladder");
  body.ladder.ladder = false;
  assert.equal(playerPosture(body), "rope");
  body.dead = true;
  assert.equal(playerPosture(body), "dead");
});

test("3000 is alert time FROM attack start; moving/prone mask it without resetting it", () => {
  const body: any = { grounded: true, moveX: 0, moveY: 0 };
  beginAttackAlert(body, 100);
  advanceAttackAlert(body, 129);
  assert.equal(body.attackAlert.remaining, 3000);
  advanceAttackAlert(body, 130);
  assert.equal(body.attackAlert.remaining, 2970);
  assert.equal(playerPosture(body), "alert");
  body.moveY = 1;
  assert.equal(playerPosture(body), "prone");
  body.moveX = 1;
  assert.equal(playerPosture(body), "walk1");
  body.moveX = body.moveY = 0;
  advanceAttackAlert(body, 3099);
  assert.equal(playerPosture(body), "alert");
  advanceAttackAlert(body, 3100);
  assert.equal(playerPosture(body), "stand1");
  beginAttackAlert(body, 3200);
  clearAttackAlert(body);
  assert.equal(body.attackAlert, undefined);
  assert.deepEqual(forcedAttackInput(32), {
    horizontal: 0,
    vertical: 1,
    jump: false,
    allowClimb: false,
  });
  assert.deepEqual(forcedAttackInput(22), {
    horizontal: 0,
    vertical: 0,
    jump: false,
    allowClimb: false,
  });
});

test("32 is separate from both normal tables, cannot shoot, and requires prone movement", () => {
  const prone = { action: 32 },
    normal = { action: 5 },
    shoot = { action: 22 };
  const profile = { melee: [normal], shoot: [shoot], prone };
  assert.equal(basicAttackAction(profile, 32), prone);
  assert.equal(basicAttackAction(profile, 32, true), undefined);
  assert.equal(basicAttackAction(profile, 5), normal);
  assert.equal(basicAttackAction(undefined, 32), undefined);
  for (const movement of [10, 11]) {
    assert.equal(basicAttackPostureAllows(32, false, movement), true);
    assert.equal(basicAttackPostureAllows(22, true, movement), false);
    assert.equal(basicAttackPostureAllows(5, false, movement), false);
  }
  for (const movement of [4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18, 19])
    assert.equal(basicAttackPostureAllows(32, false, movement), false);
});

test("recovery consumes BODY ids, not movement>>1; passive climb reaches flag1", () => {
  const body: any = { grounded: true, moveX: 0, moveY: 0 };
  assert.equal(nativeBodyAction(body, { stand: "stand2" }), 3);
  const values = { hp: 1, maxHp: 50, mp: 50, maxMp: 50, stationary: true, climbMs: 30 };
  for (const [stance, action] of [
    ["alert", 4],
    ["prone", 33],
    ["jump", 35],
  ] as const) {
    if (stance === "alert") beginAttackAlert(body, 0);
    else {
      clearAttackAlert(body);
      body.moveY = stance === "prone" ? 1 : 0;
      body.grounded = stance !== "jump";
    }
    assert.equal(nativeBodyAction(body), action);
    assert.deepEqual(recoveryTick({ hp: 9990, mp: 0 }, { ...values, action }), []);
  }
  body.ladder = { ladder: false };
  assert.equal(nativeBodyAction(body), 37);
  assert.deepEqual(recoveryTick({ hp: 0, mp: 0 }, { ...values, action: nativeBodyAction(body) }), [
    { hpDelta: 10, flag: 1 },
  ]);
});

test("integration source keeps ordered movement, prone prewarm, raw release and modal/field guards", () => {
  const main = readFileSync(new URL("../../client/main.js", import.meta.url), "utf8");
  assert.match(main, /if \(!publishPlayerMotion\(\)\) return;\s*selfSwing =/);
  assert.match(main, /\(locomotion\(playerBody\) === "prone"\) !== prone/);
  assert.match(main, /forcedAttackInput\(selfSwing.action\)/);
  assert.doesNotMatch(main, /SWING_REACH|mobInReach/);
  assert.match(main, /attackCanvasFrame\(motion, frame\)/);
  assert.match(main, /nativeBodyAction\(playerBody, selfView\?\.bodyProfile\)/);
});

test("LIVE validation closes unknown-action cooldown bypass without treating skills/multihit as ordinary attacks", () => {
  const entry = (action: number) => ({
    action,
    stance: action === 32 ? "proneStab" : "swingO1",
    delays: [300],
    baseDelays: [300],
    effects: {},
  });
  const profile: BasicAttackProfile = {
    weaponId: 1302000,
    group: 1,
    speed: 2,
    melee: [entry(5)],
    shoot: [],
    prone: entry(32),
  };
  const attack = {
    hits: 1,
    targetCount: 0,
    skillId: 0,
    facingLeft: false,
    action: 32,
    speed: 2,
    targets: [],
  };
  assert.equal(validatedBasicAttack(profile, attack, false, 10), profile.prone);
  assert.equal(validatedBasicAttack(profile, { ...attack, action: 5 }, false, 4), profile.melee[0]);
  for (const bad of [
    { ...attack, action: 99 },
    { ...attack, skillId: 1001005 },
    { ...attack, hits: 2 },
    { ...attack, speed: 6 },
    { ...attack, targetCount: 1 },
  ])
    assert.equal(validatedBasicAttack(profile, bad, false, 10), undefined);
  assert.equal(validatedBasicAttack(undefined, attack, false, 10), undefined);
  assert.equal(
    validatedBasicAttack(
      profile,
      {
        ...attack,
        targetCount: 1,
        targets: [{ mobId: 1, hitAnimation: 0, x: 0, y: 0, sequence: 0, damages: [65535] }],
      },
      false,
      10,
    ),
    undefined,
  );
});

test("542AF5: forced prone Down cannot accidentally grab a rope at a platform's ladder top", () => {
  const world = collisionWorld({
    footholds: [{ id: 1, x1: -50, y1: 0, x2: 50, y2: 0, prev: 0, next: 0 }],
    ladders: [{ id: 7, x: 0, y1: 0, y2: 100, ladder: false }],
  });
  const body = createPlayer(0, 0, world, 1);
  advancePlayer(body, forcedAttackInput(32), world, 30);
  assert.equal(body.ladder, undefined);
  assert.equal(playerPosture(body), "prone");
  advancePlayer(body, { vertical: 1 }, world, 30);
  assert.equal(body.ladder, world.ladders[0]);
});
