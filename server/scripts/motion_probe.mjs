import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS, collisionWorld, createPlayer, advancePlayer, groundY, locomotion,
  actionOf, beginPath, sampleMotion, actorDepth, animationPose, remoteStance, facingFlip } from '../../client/motion.mjs';

const segment = (id, x1, y1, x2, y2, prev = 0, next = 0, layer = 1, group = 0) => ({ id, x1, y1, x2, y2, prev, next, layer, group });
const world = (...footholds) => collisionWorld({ footholds });
const flat = world(segment(1, -1000, 100, 2000, 100));
const run = (body, input, terrain = flat, ms = 1000, hz = 60) => {
  const count = Math.round(ms * hz / 1000);
  for (let i = 0; i < count; i++) advancePlayer(body, input, terrain, ms / count);
  return body;
};

test('ordinary ground movement is 125px/s after acceleration, not 14px per timer', () => {
  const body = run(createPlayer(0, 100, flat), { horizontal: 1 });
  assert.ok(body.x > 118 && body.x < 122, body.x);
  assert.equal(body.y, 100);
  assert.equal(body.vx, PHYSICS.walkSpeed);
  assert.equal(body.foothold, 1);
  run(body, {});
  assert.equal(body.vx, 0);
  assert.equal(locomotion(body), 'stand1');
});
test('30/60/144Hz rendering produces identical fixed-step positions', () => {
  const results = [30, 60, 144].map((hz) => {
    const b = createPlayer(0, 100, flat);
    run(b, { horizontal: 1 }, flat, 2000, hz);
    return [b.x, b.y, b.vx, b.vy];
  });
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});
test('up/down keys do not fly the character through the map', () => {
  for (const vertical of [-1, 1]) {
    const b = run(createPlayer(0, 100, flat), { vertical });
    assert.equal(b.y, 100);
    assert.equal(b.grounded, true);
  }
});
test('jump rises, falls and lands; a held jump does not repeatedly bounce', () => {
  const b = createPlayer(0, 100, flat);
  run(b, { jump: true }, flat, 160);
  assert.ok(b.y < 40);
  assert.equal(locomotion(b), 'jump');
  assert.equal(actionOf(b), 70);
  run(b, { jump: true }, flat, 1840);
  assert.equal(b.y, 100);
  assert.equal(b.grounded, true);
  assert.equal(b.vy, 0);
});
test('walking follows linked slopes, then falls off their open end', () => {
  const terrain = world(segment(1, 0, 100, 100, 150, 0, 2), segment(2, 100, 150, 200, 100, 1, 0));
  const b = createPlayer(80, 140, terrain);
  run(b, { horizontal: 1 }, terrain, 500);
  assert.equal(b.foothold, 2);
  assert.ok(Math.abs(b.y - groundY(terrain.byId.get(2), b.x)) < 1e-6);
  run(b, { horizontal: 1 }, terrain, 1500);
  assert.equal(b.grounded, false);
  assert.equal(b.foothold, 0);
  assert.ok(b.y > 100);
});
test('falling lands on the first crossed platform, not a lower floor', () => {
  const terrain = world(segment(1, 0, 100, 300, 100), segment(2, 0, 200, 300, 200));
  const b = createPlayer(50, -200, terrain);
  run(b, {}, terrain, 1000);
  assert.equal(b.y, 100);
  assert.equal(b.foothold, 1);
});
test('upward jumps pass through one-way platforms then land on top', () => {
  const terrain = world(segment(1, 0, 100, 300, 100), segment(2, 0, 160, 300, 160));
  const b = createPlayer(50, 160, terrain);
  run(b, { jump: true }, terrain, 160);
  assert.ok(b.y < 100);
  run(b, {}, terrain, 1000);
  assert.equal(b.y, 100);
});
test('down+jump temporarily ignores the current connected platform', () => {
  const terrain = world(segment(1, 0, 100, 100, 100, 0, 2), segment(2, 100, 100, 200, 100, 1), segment(3, 0, 200, 300, 200));
  const b = createPlayer(90, 100, terrain);
  run(b, { vertical: 1, jump: true }, terrain, 1000);
  assert.equal(b.y, 200);
  assert.equal(b.foothold, 3);
});
test('vertical foothold walls stop walking; reversing moves away again', () => {
  const terrain = world(segment(1, 0, 100, 100, 100, 0, 2), segment(2, 100, 100, 100, 0, 1));
  const b = createPlayer(90, 100, terrain);
  run(b, { horizontal: 1 }, terrain, 1000);
  assert.equal(b.x, 100);
  assert.equal(b.grounded, true);
  run(b, { horizontal: -1 }, terrain, 400);
  assert.ok(b.x < 80);
});
test('ladder movement requires proximity, snaps x, and stops without input', () => {
  const terrain = collisionWorld({ footholds: flat.footholds, ladders: [{ id: 1, x: 50, y1: 0, y2: 100, ladder: true }] });
  const b = createPlayer(52, 100, terrain);
  run(b, { vertical: -1 }, terrain, 400);
  assert.equal(b.x, 50);
  assert.equal(locomotion(b), 'ladder');
  assert.ok(b.y > 55 && b.y < 65);
  const y = b.y;
  run(b, {}, terrain, 400);
  assert.equal(b.y, y);
  run(b, { horizontal: -1, jump: true }, terrain, 80);
  assert.equal(locomotion(b), 'jump');
  assert.ok(b.x < 50);
});
test('background-tab delay is capped instead of simulating seconds of invisible input', () => {
  const b = createPlayer(0, 100, flat);
  advancePlayer(b, { horizontal: 1 }, flat, 10_000);
  assert.ok(b.x < 32);
});
test('a three-second mob path walks for three seconds, without teleporting', () => {
  const mob = { x: 0, y: 100 };
  beginPath(mob, { elements: [{ x: 180, y: 100, duration: 3000, foothold: 1 }] }, 1000);
  assert.equal(mob.x, 0);
  assert.equal(sampleMotion(mob, 2500, flat), true);
  assert.equal(mob.x, 90);
  assert.equal(sampleMotion(mob, 3999, flat), true);
  assert.equal(sampleMotion(mob, 4000, flat), false);
  assert.equal(mob.x, 180);
});
test('multiple movement elements keep their individual durations', () => {
  const mob = { x: 0, y: 100 };
  beginPath(mob, { elements: [{ x: 100, y: 100, duration: 1000 }, { x: 200, y: 100, duration: 2000 }] }, 0);
  sampleMotion(mob, 2000, flat);
  assert.equal(mob.x, 150);
});
test('a mob traverses the foothold polyline, not the chord between its endpoints', () => {
  const terrain = world(segment(1, 0, 100, 100, 50, 0, 2), segment(2, 100, 50, 200, 100, 1));
  const mob = { x: 0, y: 100 };
  beginPath(mob, { elements: [{ x: 200, y: 100, duration: 2000, foothold: 2 }] }, 0);
  sampleMotion(mob, 1000, terrain);
  assert.equal(mob.x, 100);
  assert.equal(mob.y, 50);
});
test('actor depth uses the current foothold page/group instead of a hard-coded layer 3', () => {
  const terrain = world(segment(5, 0, 100, 200, 100, 0, 0, 2, 10));
  assert.equal(actorDepth({ x: 50, y: 100, foothold: 5 }, terrain), 60000 - 20 + 10008);
  assert.equal(actorDepth({ x: 50, y: 100 }, terrain, 'npc'), 60000 - 20 + 10009);
});

test('climbing keeps the current animation frame while stopped (250ms WZ delays)', () => {
  const b = {};
  assert.equal(animationPose(b, 'rope', true, 0).frame, 0);
  animationPose(b, 'rope', true, 200);
  assert.equal(animationPose(b, 'rope', true, 300).frame, 1);
  assert.equal(animationPose(b, 'rope', false, 400).frame, 1);
  assert.equal(animationPose(b, 'rope', false, 900).frame, 1);
  assert.equal(animationPose(b, 'rope', true, 1150).frame, 0);
});
test('remote players preserve rope/jump actions, including a stopped rope pose', () => {
  assert.equal(remoteStance({}), 'stand1');
  const b = { x: 0, y: 40 };
  beginPath(b, { elements: [{ x: 0, y: 40, duration: 100, action: 75, vx: 0, vy: 0 }] }, 0);
  sampleMotion(b, 200, flat);
  assert.equal(remoteStance(b), 'rope');
  assert.equal(b.motion, undefined);
});
test('climbing off the bottom or an unattached top does not instantly regrab the same rope', () => {
  const terrain = collisionWorld({ ladders: [{ id: 1, x: 50, y1: 0, y2: 100, page: 2 }], footholds: [] });
  const b = createPlayer(50, 95, terrain);
  run(b, { vertical: 1 }, terrain, 500);
  assert.equal(b.ladder, undefined);
  assert.ok(b.y > 150, b.y);
  const c = createPlayer(50, 10, terrain);
  run(c, { vertical: -1 }, terrain, 180);
  assert.equal(c.ladder, undefined);
});
test('ground-level rope ends are a few pixels above the feet; attaching clamps into the rope', () => {
  const terrain = collisionWorld({ footholds: flat.footholds, ladders: [{ id: 1, x: 50, y1: 0, y2: 98, page: 2 }] });
  const b = createPlayer(50, 100, terrain);
  run(b, { vertical: -1 }, terrain, 160);
  assert.ok(b.ladder);
  assert.ok(b.y < 90);
  assert.equal(b.layer, 2);
});
test('jumping away while holding up+jump does not cancel itself by reattaching', () => {
  const terrain = collisionWorld({ footholds: flat.footholds, ladders: [{ id: 1, x: 50, y1: 0, y2: 100 }] });
  const b = createPlayer(50, 100, terrain);
  run(b, { vertical: -1 }, terrain, 100);
  run(b, { vertical: -1, horizontal: 1, jump: true }, terrain, 150);
  assert.equal(b.ladder, undefined);
  assert.ok(b.x > 65);
});
test('standing air control uses the original 10000*0.000892857 cap, not ten times that value', () => {
  const b = createPlayer(0, -1000, collisionWorld({}));
  run(b, { horizontal: 1 }, collisionWorld({}), 500);
  assert.ok(b.vx < 9 && b.vx > 8);
});


test('WZ native art faces left: right movement mirrors art, left movement does not', () => {
  const w = world(segment(1, -1000, 100, 1000, 100));
  const b = createPlayer(0, 100, w);
  run(b, { horizontal: 1 }, w, 200);
  assert.equal(b.facing, 0);
  assert.equal(facingFlip(b.facing), true);
  assert.equal(actionOf(b) & 1, 0);
  run(b, { horizontal: -1 }, w, 400);
  assert.equal(b.facing, 1);
  assert.equal(facingFlip(b.facing), false);
  assert.equal(actionOf(b) & 1, 1);
});


test('native uf=true rope exit lifts exactly five pixels, then sweeps onto a platform two pixels above y1', () => {
  const ladder = {id:3,x:718,y1:97,y2:273,upperFoothold:true,page:2};
  const terrain = collisionWorld({footholds:[segment(277,650,95,760,95)],ladders:[ladder]});
  const b = createPlayer(718,98,terrain,0,false);
  b.ladder = ladder;
  advancePlayer(b,{vertical:-1},terrain,16);
  assert.equal(b.ladder,undefined);
  assert.equal(b.y,92);
  assert.equal(b.grounded,false,'no broad floor snap at exit');
  run(b,{vertical:-1},terrain,3000);
  assert.deepEqual([b.y,b.foothold,b.grounded,b.ladder],[95,277,true,undefined]);
  run(b,{},terrain,2000);
  assert.deepEqual([b.y,b.foothold,b.grounded],[95,277,true]);
});
test('native uf=false remains clamped on the rope rather than inventing a platform exit', () => {
  const ladder={id:1,x:50,y1:0,y2:100,upperFoothold:false};
  const terrain=collisionWorld({ladders:[ladder]});
  const b=createPlayer(50,1,terrain,0,false); b.ladder=ladder;
  run(b,{vertical:-1},terrain,2000);
  assert.equal(b.y,0);assert.equal(b.ladder,ladder);assert.equal(b.vy,0);assert.equal(b.grounded,false);
});
test('all eight real Amherst ropes reach and remain on their actual WZ top platforms at 30/60/144Hz', async () => {
  const {existsSync}=await import('node:fs');
  const path=new URL('../../Data.wz',import.meta.url);
  if(!existsSync(path)) return;
  const {WzArchive}=await import('../src/wz/archive.ts');
  const {mapDataProvider}=await import('../src/game/map.ts');
  const archive=WzArchive.open(path.pathname),map=mapDataProvider(archive)(1000000);
  const terrain=collisionWorld({footholds:[...map.footholdSegments.values()],ladders:map.climbables});
  assert.equal(terrain.ladders.length,8);
  for(const ladder of terrain.ladders) for(const hz of [30,60,144]) {
    const b=createPlayer(ladder.x,ladder.y1+8,terrain,0,false);b.ladder=ladder;
    run(b,{vertical:-1},terrain,2000,hz);
    assert.equal(b.grounded,true,`rope ${ladder.id}, ${hz}Hz`);
    assert.equal(b.y,ladder.y1-2);assert.equal(b.ladder,undefined);assert.ok(b.foothold>0);
    run(b,{},terrain,2000,hz);assert.equal(b.y,ladder.y1-2);assert.equal(b.grounded,true);
  }
});
