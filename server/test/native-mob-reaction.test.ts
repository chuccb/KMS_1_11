/** ADR-075 Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mobReaction,
  mobHitAction,
  mobHitName,
  planMobReactionPath,
  nativeMobActions,
  mobHitPose,
} from "../../client/mob-reaction.ts";
import { MobField, mobTemplateProvider, type MobTemplate } from "../src/game/mobs.ts";
import { WzArchive } from "../src/wz/archive.ts";
import type { MapData } from "../src/game/map.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { readMobMove } from "../src/protocol/mob.ts";
import { ClientSession, type ClientEvent } from "../src/client/session.ts";
import { encodeMobMove } from "../src/protocol/mob.ts";
const floor = { id: 1, layer: 1, group: 0, x1: 0, y1: 100, x2: 300, y2: 100, prev: 0, next: 0 };
const template: MobTemplate = {
  templateId: 120100,
  name: "fixture",
  level: 1,
  maxHP: 100,
  maxMP: 0,
  exp: 1,
  speedPercent: 100,
  moveAbility: 1,
  dieMs: 540,
  pushed: 5,
  hitActions: [7],
  hitDurations: { 7: 600 },
};
const reaction = { action: 7, facing: 1, velocity: 130, duration: 600 };
const data = resolve(import.meta.dirname, "../../Data.wz"),
  needs = { skip: !existsSync(data) };
const source = (path: string) => readFileSync(resolve(import.meta.dirname, "../../", path), "utf8");
test("487A30: each positive hit meets pushed, no re-entry during hit window; not total multi-hit damage", () => {
  assert.equal(mobReaction(template, 0, 7, false, 1000), undefined);
  assert.equal(mobReaction(template, 4, 7, false, 1000), undefined);
  assert.equal(mobReaction(template, 5, -1, false, 1000), undefined);
  assert.equal(mobReaction(template, 5, 0, false, 1000), undefined, "move index0 cannot mean hit1");
  assert.equal(mobReaction(template, 5, 7, false, 1000, 1600), undefined);
  assert.deepEqual(mobReaction(template, 5, 7, false, 1600, 1600), reaction);
  assert.equal(mobReaction(template, 5, 7, true, 1600)!.velocity, -130);
  assert.equal(
    mobReaction(template, 5, 7, true, 1600)!.facing,
    0,
    "faces attacker, not direction of push",
  );
});
test("hit indices7/8/9 are hit1/hit2/hitF, never hit3; no art returns -1", () => {
  assert.deepEqual([7, 8, 9, 0].map(mobHitName), ["hit1", "hit2", "hitF", undefined]);
  assert.equal(mobHitAction(undefined), -1);
  assert.equal(
    mobHitAction({ hitActions: [7, 8, 9] }, () => 0.99),
    9,
  );
});
test("53D3F0:130px/s, drag400, <=30ms subdivisions, stop then hold until raw hit window ends", () => {
  const points = planMobReactionPath({ x: 100, y: 100, foothold: 1 }, [floor], reaction, 1);
  assert.equal(points.length, 20);
  assert.equal(
    points.reduce((n, p) => n + p.duration, 0),
    600,
  );
  assert.equal(points[0]!.vx, 118);
  assert.equal(points.at(-1)!.vx, 0);
  assert.equal(points.at(-1)!.x, 121);
  assert.equal(points.at(-1)!.y, 100);
  assert.ok(
    points.every((p) => p.foothold === 1 && p.action === 3),
    "movement action=stand-left, forced hit is a separate header",
  );
});
test("KB clamps an open edge/wall, follows directed floor links; does not use spawn rx as collision", () => {
  const edge = planMobReactionPath({ x: 295, y: 100, foothold: 1 }, [floor], reaction, 1);
  assert.equal(edge.at(-1)!.x, 300);
  assert.equal(edge.at(-1)!.foothold, 1);
  assert.equal(edge.at(-1)!.vx, 0);
  const a = { ...floor, x2: 110, next: 2 },
    b = { ...floor, id: 2, x1: 110, y1: 100, x2: 210, y2: 200, prev: 1 };
  const points = planMobReactionPath({ x: 100, y: 100, foothold: 1 }, [a, b], reaction, 1);
  assert.equal(points.at(-1)!.foothold, 2);
  assert.ok(points.at(-1)!.y > 100);
  const wall = { ...b, x1: 110, x2: 110, y1: 100, y2: 200 };
  assert.equal(
    planMobReactionPath({ x: 100, y: 100, foothold: 1 }, [a, wall], reaction, 1).at(-1)!.x,
    110,
  );
});
test("airborne ground mob is held, not given a player knockback jump; immobile has animation only", () => {
  const start = { x: 100, y: 50, foothold: 0 };
  assert.ok(
    planMobReactionPath(start, [floor], reaction, 2).every(
      (p) => p.x === 100 && p.y === 50 && p.foothold === 0,
    ),
  );
  assert.ok(
    planMobReactionPath({ ...start, foothold: 1, y: 100 }, [floor], reaction, 0).every(
      (p) => p.x === 100 && p.vx === 0,
    ),
  );
  assert.ok(
    planMobReactionPath(start, [floor], reaction, 3).at(-1)!.x > 100,
    "flyer is a separate damped vector branch",
  );
});
test("486180 raw hit window is not quantized frame total; 4862C0 discards each frame overshoot", () => {
  const raw = {
      hitF: [
        { delay: 100, path: "a" },
        { delay: 100, path: "b" },
      ],
    },
    actions = nativeMobActions(raw),
    hit = { action: 9, since: 1000, facing: 1 };
  assert.deepEqual(
    actions.hitF!.map((f) => [f.rawDelay, f.delay]),
    [
      [100, 120],
      [100, 120],
    ],
  );
  assert.equal(raw.hitF[0]!.delay, 100);
  assert.equal(mobReaction({ hitDurations: { 9: 200 } }, 5, 9, false, 1000)!.duration, 200);
  assert.equal(mobHitPose(actions, hit, 1199)!.facing, 1);
  assert.ok(mobHitPose(actions, hit, 1200), "raw200ms guard and visual240ms are distinct clocks");
  assert.equal(mobHitPose(actions, hit, 1240), undefined);
});
function field() {
  const spawn = {
    templateId: 120100,
    x: 100,
    y: 100,
    foothold: 1,
    facing: 0,
    rx0: 0,
    rx1: 300,
    cy: 100,
  };
  const map: MapData = {
    id: 1,
    imagePath: "Map/Map/000000001.img",
    name: "",
    streetName: "",
    bgm: "",
    returnMapId: 1,
    mobs: [spawn],
    npcs: [],
    portals: [],
    footholds: 1,
    ladderRopes: 0,
  };
  return new MobField({
    map,
    footholds: new Map([[1, floor]]),
    template: () => template,
    behavior: "roam",
    random: () => 0.9,
  });
}
test("field keeps sub-threshold numbers separate, even when their sum reaches pushed", () => {
  const f = field();
  const first = f.applyDamage(1, 2, 1000, { hitAnimation: 7, facingLeft: false })!;
  const second = f.applyDamage(1, 3, 1000, { hitAnimation: 7, facingLeft: false })!;
  assert.deepEqual(
    [...first.packets, ...second.packets].map((p) => p[0]),
    [0x34, 0x34],
  );
  assert.equal(f.mobs[0]!.hp, 95);
  assert.equal(f.mobs[0]!.reactionUntil, undefined);
});
test("one authoritative reaction replaces old patrol for attacker/observer, no second restart on the next hit", () => {
  const f = field(),
    mob = f.mobs[0]!;
  f.movePackets(1000);
  const hit = f.applyDamage(1, 5, 1100, { hitAnimation: 7, facingLeft: false })!;
  assert.deepEqual(
    hit.packets.map((p) => p[0]),
    [0x34, 0x33],
  );
  const path = readMobMove(new PacketReader(hit.packets[1]!, 1));
  assert.equal(path.body.actionByte, 15);
  assert.equal(mob.reactionUntil, 1700);
  assert.equal(mob.legEndsAt, 1700);
  const motion = mob.motion;
  assert.equal(f.movePackets(1200).length, 0, "AI cannot overwrite reaction with a walking packet");
  const second = f.applyDamage(1, 6, 1300, { hitAnimation: 7, facingLeft: false })!;
  assert.deepEqual(
    second.packets.map((p) => p[0]),
    [0x34],
  );
  assert.equal(mob.motion, motion);
  assert.equal(mob.reactionUntil, 1700);
  const resumes = f.resumePackets();
  assert.equal(resumes.length, 1);
  assert.ok(
    readMobMove(new PacketReader(resumes[0]!, 1)).body.path.elements.reduce(
      (n, p) => n + p.duration,
      0,
    ) <= 400,
  );
  f.applyDamage(1, 1000, 1400, { hitAnimation: 7, facingLeft: false });
  assert.equal(mob.alive, false);
  assert.equal(mob.motion, undefined);
  assert.equal(mob.reactionUntil, undefined);
  f.lifecyclePackets(7000);
  assert.equal(mob.alive, true);
  assert.equal(mob.reactionUntil, undefined);
});
test("session exposes signed forced header and KEEP does not invent a new facing", () => {
  const session = new ClientSession({ loginPort: 0 }),
    events: ClientEvent[] = [];
  session.onEvent((e) => events.push(e));
  const fake = session as unknown as { handleFieldPacket(packet: Uint8Array): void };
  const path = {
    originX: 0,
    originY: 0,
    elements: [{ attr: 0, x: 10, y: 0, vx: 0, vy: 0, foothold: 1, action: 3, duration: 30 }],
  };
  fake.handleFieldPacket(encodeMobMove(1, { stateByte: 0, actionByte: 15, value: 0, path }));
  fake.handleFieldPacket(encodeMobMove(1, { stateByte: 0, actionByte: 128, value: 0, path }));
  const a = events[0],
    b = events[1];
  assert.equal(a?.kind, "mob-move");
  assert.equal(b?.kind, "mob-move");
  if (a?.kind === "mob-move" && b?.kind === "mob-move") {
    assert.equal(a.actionByte, 15);
    assert.equal(a.facing, 1);
    assert.equal(b.actionByte, -128);
    assert.equal(b.facing, undefined);
  }
  session.close();
});
test("Data.wz: real pushed/hit actions/delays, no fabricated action0", needs, () => {
  const provider = mobTemplateProvider(WzArchive.open(data));
  for (const id of [100100, 100101, 120100, 210100, 1210102]) {
    const t = provider(id)!;
    assert.equal(t.pushed, 1);
    assert.deepEqual(t.hitActions, [7]);
    assert.ok(t.hitDurations![7]! > 0);
  }
});
test("wiring: no per-number forced hit1, render/contact/impact share hit facing; server context reaches applyDamage", () => {
  const main = source("client/main.js"),
    bridge = source("server/src/net/webclient.ts");
  assert.doesNotMatch(main, /if\(damage>0\) mobHits\.set/);
  assert.match(main, /mobRenderFacing\(mob\)/);
  assert.match(main, /void entityCatalog\.load\(kind, templateId\)/);
  assert.match(main, /entityAssets\(/);
  assert.match(source("client/entity-assets.ts"), /nativeMobActions\(data.actions/);
  assert.match(bridge, /hitAnimation:\s*mobHitAction\(template\)/);
  const server = source("server/src/net/loginserver.ts");
  assert.match(server, /hitAnimation:\s*target\.hitAnimation,\s*facingLeft:\s*attack\.facingLeft/);
  assert.match(server, /for\s*\(const value of target\.damages\)/);
  assert.match(server, /applyDamage\(\s*target\.mobId,\s*value,\s*now/);
});
