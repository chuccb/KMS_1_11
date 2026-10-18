/** ADR-078 regression SOURCES ONLY. Not run/check/typecheck/syntax/browser/VM/probe validated. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  physicalBounds,
  normalizeFootholds,
  collisionRound,
  cross32,
  clipAir,
  clipGround,
  terrainContact,
  contactTangent,
} from "../../client/native-terrain.ts";

import {
  collisionWorld,
  createPlayer,
  advancePlayer,
  advanceMob,
  drainPlayerPath,
  beginPath,
  sampleMotion,
} from "../../client/motion.ts";
import { planMobAirPath } from "../../client/mobmotion.ts";
import { planMobReactionPath } from "../../client/mob-reaction.ts";
import { MobField, type MobTemplate } from "../src/game/mobs.ts";
import { mapDataFrom } from "../src/game/map.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { readMobMove } from "../src/protocol/mob.ts";
const floor = { id: 1, x1: -1000, y1: 0, x2: 1000, y2: 0, prev: 0, next: 0, layer: 2, group: 3 };
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("563010: physical rectangle includes ALL segment endpoints, not camera or sprite bounds", () => {
  assert.deepEqual(
    physicalBounds([floor, { ...floor, id: 2, x1: 200, x2: 200, y1: -200, y2: 500 }]),
    { left: -970, right: 970, top: -500, bottom: 510 },
  );
  assert.equal(physicalBounds([]), undefined);
  assert.equal(
    physicalBounds([{ ...floor, x1: 0, x2: 20 }]),
    undefined,
    "explicit malformed/narrow-map guard",
  );
  assert.equal(physicalBounds([{ ...floor, x1: NaN }]), undefined);
});

test("537260 clips four sides only at initialization; continuing airborne planner never restores bottom", () => {
  const world = collisionWorld({ footholds: [floor] });
  const initial = createPlayer(-2000, 500, world, 0, false);
  assert.equal(initial.x, -970);
  assert.equal(initial.y, 10);
  const continuing = createPlayer(0, 500, world, 0, false, false);
  advanceMob(continuing, {}, world, 30);
  assert.ok(continuing.y > 500);
  assert.equal(continuing.foothold, 0);
  const points = planMobAirPath({ x: 0, y: 500, foothold: 0, facing: 0, vy: 100 }, [floor], {
    direction: 0,
    speedPxPerSecond: 125,
    launch: false,
    horizonMs: 60,
  });
  assert.ok(points.every((p) => p.y >= 500 && p.foothold === 0));
});

test("539B10 clips independent X/top axes and minimum integer time; bottom stays open", () => {
  const bounds = { left: 0, right: 100, top: -300, bottom: 200 };
  const body = { x: 120, y: -500, vx: 50, vy: -10 };
  assert.equal(clipAir(body, { x: 50, y: -100 }, 30, bounds), 15);
  assert.deepEqual(body, { x: 100, y: -300, vx: 0, vy: 0 });
  const falling = { x: 50, y: 500, vx: 0, vy: 200 };
  assert.equal(clipAir(falling, { x: 50, y: 450 }, 30, bounds), 30);
  assert.equal(falling.y, 500);
  assert.equal(falling.vy, 200);
  const f = normalizeFootholds([{ ...floor, x1: 0, y1: 0, x2: 80, y2: 60 }])[0]!;
  assert.deepEqual(clipGround(f, 50, 75, 100, 30, { ...bounds, left: 30, right: 50 }), {
    position: 62.5,
    speed: 0,
    used: 15,
  });
});

test("5389B0 integer rounding, signed-32 cross and one-sided floor crossing", () => {
  assert.ok(collisionRound(-0.5) === 0);
  assert.equal(collisionRound(0.5), 1);
  assert.equal(collisionRound(-1.5), -1);
  assert.equal(cross32(65536, 0, 0, 65536), 0);
  const world = collisionWorld({ footholds: [floor] });
  const hit = terrainContact(world, { x: 0, y: -10 }, { x: 0, y: 10 }, 0)!;
  close(hit.fraction, 0.5);
  close(hit.x, 0);
  close(hit.y, 0);
  assert.equal(hit.left.id, 1);
  assert.equal(hit.right.id, 1);
  assert.equal(terrainContact(world, { x: 0, y: 10 }, { x: 0, y: -10 }), undefined);
  assert.equal(
    terrainContact(world, { x: -10, y: 0 }, { x: 10, y: 0 }),
    undefined,
    "collinear travel is not a crossing",
  );
});

test("walls/ceilings retain orientation and group filter; ordinary floors ignore group", () => {
  const wall = { ...floor, x1: 0, x2: 0, y1: 100, y2: -100, group: 9 };
  const world = collisionWorld({ footholds: [wall] });
  assert.equal(terrainContact(world, { x: -10, y: 0 }, { x: 10, y: 0 }, 0), undefined);
  assert.equal(terrainContact(world, { x: -10, y: 0 }, { x: 10, y: 0 }, 9)!.right.id, 1);
  assert.equal(terrainContact(world, { x: 10, y: 0 }, { x: -10, y: 0 }, 9), undefined);
  const ceiling = collisionWorld({ footholds: [{ ...floor, x1: 100, x2: -100, group: 0 }] });
  assert.ok(terrainContact(ceiling, { x: 0, y: 10 }, { x: 0, y: -10 }, 9));
  assert.equal(terrainContact(ceiling, { x: 0, y: -10 }, { x: 0, y: 10 }, 9), undefined);
});

test("inclusive endpoint query returns dual contacts only when the directed neighbor allows it", () => {
  const left = { ...floor, x1: -100, x2: 0, next: 2 },
    right = { ...floor, id: 2, x1: 0, x2: 100, prev: 1 };
  const world = collisionWorld({ footholds: [left, right] });
  const hit = terrainContact(world, { x: 0, y: -10 }, { x: 0, y: 10 })!;
  assert.deepEqual([hit.left.id, hit.right.id], [1, 2]);
  const open = collisionWorld({ footholds: [{ ...right, prev: 0 }] });
  assert.equal(terrainContact(open, { x: 0, y: -10 }, { x: 0, y: 10 }), undefined);
  const surfaces = normalizeFootholds([
    { ...floor, x1: -80, x2: 0, y1: -60, y2: 0 },
    { ...floor, id: 2, x1: 0, x2: 80, y1: 0, y2: -60 },
  ]);
  const corner = { ...hit, left: surfaces[0]!, right: surfaces[1]! };
  assert.equal(contactTangent(corner, 10, 0).foothold.id, 2);
  assert.equal(contactTangent(corner, -10, 0).foothold.id, 1);
  assert.equal(contactTangent(corner, 0, 10).speed, 0);
});

test("539450 reversal uses prev.next rather than inventing reciprocal links", () => {
  const world = collisionWorld({
    footholds: [
      { ...floor, x1: 0, x2: 100, prev: 2 },
      { ...floor, id: 2, x1: -100, x2: 0, next: 3 },
      { ...floor, id: 3, x1: 0, x2: 100, group: 7 },
    ],
  });
  const body = createPlayer(0, 0, world, 1);
  advancePlayer(body, { horizontal: 1 }, world, 30);
  assert.equal(body.foothold, 3);
  assert.equal(body.group, 7);
  close(body.x, 0);
  close(body.groundSpeed, 42);
  const records = drainPlayerPath(body).elements;
  assert.equal(records[1].duration, 0);
  assert.equal(records[1].foothold, 3);
});

test("5376C0 performs no third edge pass and preserves time for both native contacts", () => {
  const world = collisionWorld({
    footholds: [
      { ...floor, x1: 0, x2: 1, next: 2 },
      { ...floor, id: 2, x1: 1, x2: 2, prev: 1, next: 3 },
      { ...floor, id: 3, x1: 2, x2: 3, prev: 2 },
      { ...floor, id: 4, y1: 100, y2: 100 },
    ],
  });
  const body = createPlayer(0.5, 0, world, 1);
  body.vx = 125;
  advancePlayer(body, { horizontal: 1 }, world, 30);
  close(body.x, 2);
  assert.equal(body.foothold, 3);
  const records = drainPlayerPath(body).elements;
  assert.deepEqual(
    records.map((p: { duration: number }) => p.duration),
    [0, 4, 0, 8, 0, 18],
  );
});

test("integer landing time survives publication and remote playback, including constant-speed remainder", () => {
  const world = collisionWorld({ footholds: [floor] }),
    body = createPlayer(0, -1, world, 0, false);
  body.vx = 100;
  body.vy = 100;
  advancePlayer(body, { horizontal: 1 }, world, 30);
  close(body.x, 1.15);
  close(body.vx, 50);
  const path = drainPlayerPath(body),
    records = path.elements;
  assert.deepEqual(
    records.map((p: { duration: number }) => p.duration),
    [0, 7, 0, 23],
  );
  assert.deepEqual(
    records.map((p: { foothold: number }) => p.foothold),
    [0, 0, 1, 1],
  );
  const remote = { x: 0, y: -1, foothold: 0, action: 6 };
  beginPath(remote, path, 0);
  sampleMotion(remote, 6, world);
  assert.equal(remote.foothold, 0);
  sampleMotion(remote, 7, world);
  assert.equal(remote.foothold, 1);
  sampleMotion(remote, 30, world);
  assert.equal(remote.x, 1);
  assert.equal(remote.y, 0);
  const points = planMobAirPath(
    { x: 0, y: -1, foothold: 0, facing: 1, vx: 100, vy: 100 },
    [floor],
    { direction: 1, speedPxPerSecond: 125, launch: false, horizonMs: 30 },
  );
  assert.deepEqual(
    points.map((p) => p.duration),
    [7, 0, 23, 0],
  );
  assert.equal(points.at(-1)!.foothold, 1);
  assert.ok(points.every((p) => (p.action & 1) === 1));
});

test("53D3F0 keeps its special one-neighbor KB clamp; flyer KB clips field bounds without shape sweep", () => {
  const hit = { action: 7, facing: 1, velocity: 130, duration: 90 };
  const a = { ...floor, x1: 0, x2: 1, next: 2 },
    b = { ...floor, id: 2, x1: 1, x2: 2, prev: 1, next: 3 },
    c = { ...floor, id: 3, x1: 2, x2: 100, prev: 2 };
  const ground = planMobReactionPath({ x: 0.5, y: 0, foothold: 1 }, [a, b, c], hit, 1);
  assert.equal(ground[0]!.x, 2);
  assert.equal(ground[0]!.foothold, 2);
  assert.equal(ground[1]!.foothold, 3);
  const wall = { ...floor, id: 4, x1: 100, x2: 100, y1: 100, y2: -100 };
  const flyer = planMobReactionPath({ x: 99, y: 0, foothold: 0 }, [floor, wall], hit, 3);
  assert.ok(flyer[0]!.x > 100, "KB flyer branch does not call the ordinary shape sweep");
  const clipped = planMobReactionPath({ x: 99, y: 0, foothold: 0 }, [floor, wall], hit, 3, {
    left: 0,
    right: 100,
    top: -300,
    bottom: 110,
  });
  assert.ok(clipped.every((p) => p.x === 100 && p.vx === 0));
});

test("server roam targets honor loaded-map physical X bounds, not just life.rx0/rx1", () => {
  const map = mapDataFrom(
    {
      info: {},
      foothold: 1,
      ladderRope: 0,
      portal: [],
      life: [
        {
          type: "m",
          id: "120100",
          x: 0,
          y: 0,
          fh: 1,
          rx0: -1000,
          rx1: 1000,
          cy: 0,
        },
      ],
    },
    1,
  );
  map.physicalBounds = { left: -50, right: 50, top: -300, bottom: 10 };
  const template: MobTemplate = {
    templateId: 120100,
    name: "fixture",
    level: 1,
    maxHP: 100,
    maxMP: 0,
    exp: 1,
    speedPercent: 100,
    moveAbility: 1,
    dieMs: 180,
  };
  const field = new MobField({
    map,
    footholds: new Map([[1, floor]]),
    template: () => template,
    speedPxPerSecond: 125,
  });
  assert.deepEqual(field.mob(1)!.range, { x0: -50, x1: 50 });
  const path = readMobMove(new PacketReader(field.movePackets(0)[0]!, 1)).body.path;
  assert.equal(path.elements.at(-1)!.x, 50);
});
