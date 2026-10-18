import { playerPosture } from './posture.mjs';
/**
 * Browser locomotion, in world pixels and seconds (not pixels per timer callback).
 * Baseline constants from CVecCtrl: sub_5378D0 (-555 jump), sub_537CA0
 * (140000 force, 125 walk speed, 80000 drag / CAttrShoe mass=100), and
 * sub_5382F0 (2000 gravity, 670 terminal fall speed). Default shoe friction is .9.
 * This implements ordinary ground/air/ladder movement, not water, flight or skill-specific physics. Contact impulse staging follows 5114A0/537B00.
 */
import { mergeImpulse } from "./contact.mjs";

/** Stage external force; do not overwrite walk velocity or apply a second impulse on receipt. */
export function queueKnockback(body, x, y) {
  const pending = body.knockback ?? { x: 0, y: 0 };
  body.knockback = { x: mergeImpulse(pending.x, x), y: mergeImpulse(pending.y, y) };
}

export const PHYSICS = Object.freeze({ stepMs: 8, walkSpeed: 125, acceleration: 1400,
  friction: 720, airAcceleration: 200, airDrag: 100, airControlSpeed: 10000 * 0.0008928571428571428,
  gravity: 2000, terminalSpeed: 670, jumpSpeed: 555, climbSpeed: 100 });
const EPS = 1e-6;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const approach = (n, target, delta) => n < target ? Math.min(n + delta, target) : Math.max(n - delta, target);
export const isFloor = (f) => f.x2 > f.x1;
export function groundY(f, x) {
  if (!f || !isFloor(f) || x < f.x1 - EPS || x > f.x2 + EPS) return undefined;
  return f.y1 + (f.y2 - f.y1) * (x - f.x1) / (f.x2 - f.x1);
}

/** Index once when a map loads, not once per render. Keep WZ page/group depth metadata. */
export function collisionWorld(map) {
  const footholds = map.footholds ?? [];
  return { footholds, byId: new Map(footholds.map((f) => [f.id, f])), ladders: map.ladders ?? [] };
}
export function floorBelow(world, x, y, maxDistance = Infinity, ignored = new Set()) {
  let result;
  for (const f of world.footholds) {
    if (ignored.has(f.id)) continue;
    const at = groundY(f, x);
    if (at === undefined || at < y - EPS || at - y > maxDistance) continue;
    if (!result || at < result.y) result = { foothold: f, y: at };
  }
  return result;
}
function land(body, f, y) {
  body.y = y;
  body.vy = 0;
  body.foothold = f.id;
  body.layer = f.layer ?? 7;
  body.group = f.group ?? 0;
  body.grounded = true;
  body.ladder = undefined;
}
export function createPlayer(x, y, world, foothold = 0, settle = true) {
  const body = { x, y, vx: 0, vy: 0, foothold: 0, grounded: false, facing: 0,
    layer: 7, group: 0, ladder: undefined, jumpHeld: false, accumulator: 0, ignored: new Set(), ignoreMs: 0 };
  // Portals are often a few pixels above the floor, not arbitrary points to snap through platforms.
  const f = world.byId.get(foothold);
  const at = groundY(f, x);
  const floor = at !== undefined && Math.abs(at - y) <= 24 ? { foothold: f, y: at } : floorBelow(world, x, y, 24);
  if (settle && floor) land(body, floor.foothold, floor.y);
  return body;
}
function connectedFloors(world, id) {
  const seen = new Set();
  const pending = [id];
  while (pending.length) {
    const f = world.byId.get(pending.pop());
    if (!f || !isFloor(f) || seen.has(f.id)) continue;
    seen.add(f.id);
    pending.push(f.prev, f.next);
  }
  return seen;
}

/** Follow linked slopes, blocking upward walls but falling off open/downward edges. */
function walkGround(body, distance, world) {
  let f = world.byId.get(body.foothold);
  let left = distance;
  for (let hop = 0; f && hop < 64; hop++) {
    const direction = Math.sign(left);
    const slope = (f.y2 - f.y1) / (f.x2 - f.x1);
    const scale = Math.hypot(1, slope);
    const targetX = body.x + left / scale;
    const edgeX = direction > 0 ? f.x2 : f.x1;
    if ((direction >= 0 && targetX <= edgeX) || (direction <= 0 && targetX >= edgeX)) {
      body.x = targetX;
      land(body, f, groundY(f, targetX));
      return;
    }
    left -= (edgeX - body.x) * scale;
    body.x = edgeX;
    body.y = groundY(f, edgeX);
    const next = world.byId.get(direction > 0 ? f.next : f.prev);
    const nextY = direction > 0 ? next?.y1 : next?.y2;
    const nextX = direction > 0 ? next?.x1 : next?.x2;
    if (next && next.x1 === next.x2 && body.y > Math.min(next.y1, next.y2) + EPS) {
      body.vx = 0;
      return;
    }
    if (!next || !isFloor(next) || Math.abs(nextX - edgeX) > EPS || Math.abs(nextY - body.y) > EPS) {
      body.grounded = false;
      body.foothold = 0;
      // Keep velocity tangent to the slope when leaving an edge.
      body.vy = body.vx * slope / scale;
      body.vx /= scale;
      body.x += left / scale;
      return;
    }
    f = next;
    body.foothold = f.id;
  }
}

/** Swept foot/segment crossing: land on the FIRST surface, never tunnel to a lower platform. */
function sweepFloor(body, oldX, oldY, world) {
  let hit;
  for (const f of world.footholds) {
    if (!isFloor(f) || body.ignored.has(f.id)) continue;
    const slope = (f.y2 - f.y1) / (f.x2 - f.x1);
    const before = oldY - f.y1 - slope * (oldX - f.x1);
    const after = body.y - f.y1 - slope * (body.x - f.x1);
    if (before > EPS || after < -EPS || after <= before + EPS) continue;
    const t = clamp(-before / (after - before), 0, 1);
    const x = oldX + (body.x - oldX) * t;
    if (x < f.x1 - EPS || x > f.x2 + EPS || (hit && hit.t <= t)) continue;
    hit = { f, t, x };
  }
  if (hit) {
    const remainingX = body.x - hit.x;
    body.x = hit.x;
    land(body, hit.f, groundY(hit.f, hit.x));
    const slope = (hit.f.y2 - hit.f.y1) / (hit.f.x2 - hit.f.x1);
    walkGround(body, remainingX * Math.hypot(1, slope), world);
  }
}
function sweepWalls(body, oldX, oldY, world) {
  if (Math.abs(body.x - oldX) < EPS) return;
  let earliest = 1;
  let wall;
  for (const f of world.footholds) {
    if (f.x1 !== f.x2) continue;
    const t = (f.x1 - oldX) / (body.x - oldX);
    if (t < -EPS || t > earliest) continue;
    const y = oldY + (body.y - oldY) * t;
    // An edge falling down from this wall's top is NOT an upward wall to collide with.
    if (y <= Math.min(f.y1, f.y2) + EPS || y > Math.max(f.y1, f.y2) + EPS) continue;
    earliest = t;
    wall = f;
  }
  if (wall) { body.x = wall.x1 - Math.sign(body.x - oldX) * 0.001; body.vx = 0; }
}
function step(body, input, world, dt, mob = false) {
  const knocked = body.knockback !== undefined;
  if (knocked) {
    // 537B00 first releases ground/ladder, then combines each pending component with velocity.
    const impulse = body.knockback;
    body.knockback = undefined;
    body.grounded = false;
    body.foothold = 0;
    body.ladder = undefined;
    body.vx = mergeImpulse(body.vx, impulse.x);
    body.vy = mergeImpulse(body.vy, impulse.y);
    body.moveAttr = (body.moveAttr ?? 0) | 2; // 537B00 -> 495D60 attr2, retained until publication.
  }
  // CUserLocal 512400 updates CAttrShoe walkSpeed (+32) and jump (+56), not gravity.
  // Mob CAttrShoe uses template speed 0..130, NOT CUserLocal's 80% minimum.
  const speedScale = clamp(input.speedPercent ?? 100, mob ? 0 : 80, 130) / 100;
  const jumpScale = clamp(input.jumpPercent ?? 100, 80, 123) / 100;
  const walkSpeed = PHYSICS.walkSpeed * speedScale;
  const jumpSpeed = PHYSICS.jumpSpeed * jumpScale;
  const horizontal = clamp(input.horizontal ?? 0, -1, 1);
  const vertical = clamp(input.vertical ?? 0, -1, 1);
  // Keep the controller input distinct from residual velocity (50D700).
  body.moveX = horizontal;
  body.moveY = vertical;
  const jumping = Boolean(input.jump) && !body.jumpHeld;
  body.jumpHeld = Boolean(input.jump);
  if (horizontal) body.facing = horizontal < 0 ? 1 : 0;
  body.ignoreMs -= dt * 1000;
  if (body.ignoreMs <= 0) body.ignored.clear();
  // 5426F0 / listing542AF5: forced32's Down is posture only, not a ladder-grab request.
  if (!knocked && input.allowClimb !== false && !body.ladder && vertical && !input.jump) {
    const ladder = world.ladders.find((l) => Math.abs(body.x - l.x) <= 8
      && body.y >= l.y1 - (body.grounded && vertical > 0 ? 5 : 0) && body.y <= l.y2 + (body.grounded && vertical < 0 ? 5 : 0)
      && !(body.grounded && vertical > 0 && body.y >= l.y2 - 1));
    if (ladder) {
      body.ladder = ladder;
      body.x = ladder.x;
      body.y = clamp(body.y, ladder.y1, ladder.y2);
      body.layer = ladder.page ?? body.layer; body.group = 0;
      body.grounded = false;
      body.foothold = 0;
      body.vx = body.vy = 0;
    }
  }
  if (body.ladder) {
    const ladder = body.ladder;
    if (jumping && horizontal) {
      body.ladder = undefined;
      body.vx = horizontal * 162.5 * speedScale;
      body.vy = -jumpSpeed * 0.5; // sub_5378D0: jumping away from a ladder
    } else {
      body.vx = 0;
      body.vy = vertical * PHYSICS.climbSpeed;
      body.y += body.vy * dt;
      if (body.y < ladder.y1 && ladder.upperFoothold === false) {
        body.y = ladder.y1; body.vy = 0;
      } else if (body.y < ladder.y1) {
        // CVecCtrlUser::sub_542DF0 lifts the feet FIVE pixels above y1 before detaching.
        body.y = ladder.y1 - 5;
        body.ladder = undefined;
        body.vy = 0;
        // Resume swept gravity next step; the real platform may be y1-2, above y1-1.
      } else if (body.y > ladder.y2) {
        body.y = ladder.y2 + 1;
        body.ladder = undefined;
        body.vy = 0;
      }
      return;
    }
  } else if (jumping && body.grounded) {
    const ignored = connectedFloors(world, body.foothold);
    if (vertical > 0 && floorBelow(world, body.x, body.y + 1, 1000, ignored)) {
      body.ignored = ignored;
      body.ignoreMs = 300;
      body.y += 1;
      body.vy = 0;
    } else {
      body.vy = -jumpSpeed;
      // sub_5378D0: a standing jump halves drift; a walking jump starts at least at 80% walk speed.
      if (horizontal) {
        if (horizontal * body.vx < walkSpeed * .8) body.vx += horizontal * walkSpeed * .8;
        body.vx = horizontal * Math.min(walkSpeed, horizontal * body.vx);
      } else body.vx *= .5;
    }
    body.grounded = false;
    body.foothold = 0;
  }
  const oldX = body.x, oldY = body.y;
  const oldVx = body.vx, oldVy = body.vy;
  if (body.grounded) {
    body.vx = approach(body.vx, horizontal * walkSpeed, (horizontal ? PHYSICS.acceleration : PHYSICS.friction) * dt);
    walkGround(body, (oldVx + body.vx) * .5 * dt, world);
  } else {
    // In air input accelerates only towards the control limit; a walking jump retains its speed.
    if (horizontal && horizontal * body.vx < PHYSICS.airControlSpeed) {
      body.vx = approach(body.vx, horizontal * PHYSICS.airControlSpeed, PHYSICS.airAcceleration * dt);
    } else if (!horizontal) body.vx = approach(body.vx, 0, PHYSICS.airDrag * dt);
    body.vy = Math.min(PHYSICS.terminalSpeed, body.vy + PHYSICS.gravity * dt);
    body.x += (oldVx + body.vx) * .5 * dt;
    body.y += (oldVy + body.vy) * .5 * dt;
    sweepWalls(body, oldX, oldY, world);
    sweepFloor(body, oldX, oldY, world);
  }
}
/** Fixed 8ms physics regardless of 30/60/144Hz rendering. Discard long background-tab catch-up. */
export function advancePlayer(body, input, world, elapsedMs) {
  body.accumulator += clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, 250);
  while (body.accumulator + EPS >= PHYSICS.stepMs) {
    step(body, input, world, PHYSICS.stepMs / 1000);
    body.accumulator -= PHYSICS.stepMs;
  }
  return body;
}
/** Mob trajectory planning uses the native <=30ms subdivision (53D3F0), not RAF/player catch-up.
 * Reuses ordinary ground/air sweeps only; not the entire CVecCtrlMob controller or field physics.
 */
export function advanceMob(body, input, world, elapsedMs) {
  for (let left = Math.max(0, elapsedMs); left > 0;) {
    const ms = Math.min(30, left);
    step(body, input, world, ms / 1000, true);
    left -= ms;
  }
  return body;
}
export function locomotion(body) {
  return playerPosture(body);
}
export function actionOf(body) {
  // 508FC0 decodes the MOVEMENT state, then selects an avatar action. Those are two tables:
  // y>>1: walk=1, stand=2, jump=3, alert=4, prone=5, ladder=7, rope=8, dead=9.
  // 35/36/37 (body jump/ladder/rope action ids) must NOT be doubled onto the movement wire.
  return ({ walk1: 2, stand1: 4, alert: 8, prone: 10, dead: 18, jump: 6, ladder: 14, rope: 16 }[locomotion(body)]) | body.facing;
}

/** CVecCtrl retains page/group from each contacted foothold even if a later fragment is airborne. */
function rememberFootholdDepth(entity, world, foothold) {
  const floor = world.byId.get(foothold);
  if (floor) { entity.layer = floor.layer ?? 7; entity.group = floor.group ?? 0; }
}

/** Preserve path duration end-to-end. New paths start from what was drawn, avoiding tiny jitter. */
export function beginPath(entity, path, now, fallbackDuration = 100) {
  const elements = path?.elements?.length ? path.elements : [];
  if (!elements.length) return;
  entity.motion = { start: now, x: entity.x, y: entity.y, elements: elements.map((e) => ({ ...e, duration: Number.isFinite(e.duration) ? Math.max(0, e.duration) : fallbackDuration })) };
}
export function sampleMotion(entity, now, world) {
  const motion = entity.motion;
  if (!motion) return false;
  let remaining = Math.max(0, now - motion.start);
  let x = motion.x, y = motion.y;
  for (const e of motion.elements) {
    if (remaining >= e.duration) {
      remaining -= e.duration; x = e.x; y = e.y;
      entity.action = e.action ?? entity.action; entity.facing = entity.action & 1;
      entity.foothold = e.foothold; entity.vx = e.vx ?? 0; entity.vy = e.vy ?? 0;
      rememberFootholdDepth(entity, world, e.foothold);
      continue;
    }
    const fraction = remaining / e.duration;
    entity.x = x + (e.x - x) * fraction;
    entity.y = y + (e.y - y) * fraction;
    entity.foothold = e.foothold;
    entity.action = e.action ?? entity.action;
    entity.facing = entity.action & 1; // The wire facing bit wins, not the position delta (knockback reverses it).
    entity.vx = e.vx ?? 0; entity.vy = e.vy ?? 0;
    // A walking monster follows its foothold polyline, not a chord through slopes or through sky.
    if (e.foothold) {
      const chain = connectedFloors(world, e.foothold);
      let closest;
      for (const id of chain) {
        const f = world.byId.get(id);
        const at = groundY(f, entity.x);
        if (at === undefined) continue;
        if (!closest || Math.abs(at - entity.y) < Math.abs(closest.y - entity.y)) closest = { f, y: at };
      }
      if (closest) { entity.y = closest.y; entity.foothold = closest.f.id; }
    }
    rememberFootholdDepth(entity, world, entity.foothold);
    return true;
  }
  const last = motion.elements.at(-1);
  entity.x = last.x;
  entity.y = last.y;
  entity.foothold = last.foothold;
  rememberFootholdDepth(entity, world, last.foothold);
  entity.action = last.action ?? entity.action;
  entity.facing = entity.action & 1;
  entity.vx = last.vx ?? 0; entity.vy = last.vy ?? 0;
  entity.motion = undefined;
  return false;
}

/** Same z-space as mapSprites, normalized by removing the common -1073721834 base.
 * 4861F0: page/group +10008; 499BA0 NPC +10009; 4A88A0 drop +10011.
 * 509A80 adds 2 for CVecCtrl+24 (local/active controller), NOT for ladder/rope.
 * 511820 initializes local controller with 1; 520680 initializes remote with 0.
 */
export function actorDepth(entity, world, kind = "self") {
  const userClimbing = (kind === "self" || kind === "user")
    && ((entity.action & ~1) === 14 || (entity.action & ~1) === 16);
  const climbing = entity.ladder ?? (userClimbing
    ? world.ladders.find((l) => Math.abs(l.x - entity.x) < 1 && entity.y >= l.y1 && entity.y <= l.y2) : undefined);
  if (climbing) { entity.layer = climbing.page ?? entity.layer; entity.group = 0; }
  // Jumping/falling keeps the previous page/group until contact. Looking four pixels below a
  // player/mob used to promote it onto a platform BEFORE landing and reorder it through scenery.
  // NPC/drop packets lack browser foothold state; resolve their fixed placement only.
  const placed = kind === "npc" || kind === "drop";
  const floor = world.byId.get(entity.foothold) ?? (placed
    ? floorBelow(world, entity.x, entity.y - 2, 4)?.foothold : undefined);
  if (floor && !climbing) { entity.layer = floor.layer ?? 7; entity.group = floor.group ?? 0; }
  return 30000 * (entity.layer ?? (kind === "drop" ? 0 : 7)) - 2 * (entity.group ?? 0) + (kind === "npc" ? 10009 : kind === "drop" ? 10011 : kind === "self" ? 10010 : 10008);
}

/** Ordinary avatar timing lives outside geometric locomotion. */
export { animationPose } from "./avatar-motion.mjs";
export function remoteStance(entity) {
  return ({ 0: 'walk1', 2: 'walk1', 4: 'stand1', 6: 'jump', 8: 'alert', 10: 'prone', 12: 'fly', 14: 'ladder', 16: 'rope', 18: 'dead' })[typeof entity.action === 'number' ? entity.action & ~1 : -1]
    ?? (entity.motion ? 'walk1' : 'stand1');
}

/** Action bit 1 means LEFT (sub_4884F0); WZ avatar/mob art already faces left.
 * Logical facing is NOT the Gr2D horizontal-mirror flag. Never invert combat/input to fix art. */
export function facingFlip(facing = 0) { return (facing & 1) === 0; }
