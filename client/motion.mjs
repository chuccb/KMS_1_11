import { playerPosture } from './posture.mjs';
import { mergeImpulse } from './contact.mjs';
import { NATIVE_SHOE, NATIVE_FOOTHOLD, NATIVE_FLUID, NATIVE_STEP_MS,
  groundStep, airStep, jumpVelocity } from './native-locomotion.mjs';

/** Ordinary CVecCtrl ground/air/ladder. See docs/NATIVE_LOCOMOTION.md for evidence and limits.
 * All public vx/vy are WORLD velocity. Signed tangent speed is kept separately while grounded.
 */
export function queueKnockback(body, x, y) {
  const pending = body.knockback ?? { x: 0, y: 0 };
  body.knockback = { x: mergeImpulse(pending.x, x), y: mergeImpulse(pending.y, y) };
}
export const PHYSICS = Object.freeze({ stepMs: NATIVE_STEP_MS, walkSpeed: 125, acceleration: 1400,
  friction: 800, airAcceleration: 200, airDrag: 100, airControlSpeed: 10000 * .0008928571428571428,
  gravity: 2000, terminalSpeed: 670, jumpSpeed: 555, climbSpeed: 100 });
const EPS = 1e-6;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const isFloor = (f) => f.x2 > f.x1;
export function groundY(f, x) {
  if (!f || !isFloor(f) || x < f.x1 - EPS || x > f.x2 + EPS) return undefined;
  return f.y1 + (f.y2 - f.y1) * (x - f.x1) / (f.x2 - f.x1);
}
/** 5643D0: normalize once, retaining WZ ids, orientation, links, page and group.
 * 563010 creates default shared attributes, not per-foothold later-version WZ friction fields.
 */
export function collisionWorld(map) {
  const footholds = (map.footholds ?? []).map(f => {
    const length = Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
    return { ...f, length, cos: length ? (f.x2 - f.x1) / length : 0,
      sin: length ? (f.y2 - f.y1) / length : 0 };
  });
  return { footholds, byId: new Map(footholds.map(f => [f.id, f])),
    ladders: [...(map.ladders ?? [])].sort((a, b) => a.id - b.id),
    groundAttr: NATIVE_FOOTHOLD, fieldAttr: NATIVE_FLUID };
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
function alignGround(body, f, y, speed) {
  body.y = y;
  body.groundSpeed = speed;
  body.vx = f.cos * speed;
  body.vy = f.sin * speed;
  body.foothold = f.id;
  body.layer = f.layer ?? 7;
  body.group = f.group ?? 0;
  body.grounded = true;
  body.ladder = undefined;
}
/** 539A30 exports tangent velocity, lifts feet by one integer pixel, then detaches. */
function releaseGround(body, world) {
  const f = world.byId.get(body.foothold);
  if (body.grounded && f) body.y = Math.floor(body.y - 1);
  body.grounded = false;
  body.foothold = 0;
  body.groundSpeed = 0;
}
export function createPlayer(x, y, world, foothold = 0, settle = true) {
  const body = { x, y, vx: 0, vy: 0, groundSpeed: 0, foothold: 0, grounded: false, facing: 0,
    layer: 7, group: 0, ladder: undefined, jumpHeld: false, jumpQueued: false, groundJumps: 0, accumulator: 0 };
  // Portal settling is a browser spawn policy, not a replacement for swept movement collision.
  const f = world.byId.get(foothold), at = groundY(f, x);
  const floor = at !== undefined && Math.abs(at - y) <= 24 ? { foothold: f, y: at } : floorBelow(world, x, y, 24);
  if (settle && floor) alignGround(body, floor.foothold, floor.y, 0);
  body.motionOrigin = movementSnapshot(body); body.motionFrames = [];
  return body;
}
function connectedFloors(world, id) {
  const seen = new Set(), pending = [id];
  while (pending.length) {
    const f = world.byId.get(pending.pop());
    if (!f || !isFloor(f) || seen.has(f.id)) continue;
    seen.add(f.id); pending.push(f.prev, f.next);
  }
  return seen;
}

/** 539450: transfer tangent speed across linked floors; interpolate it at an edge.
 * 5376C0 integrates force ONCE; unused milliseconds continue at collision velocity, without
 * a second gravity/acceleration application. The loop cap is malformed-map protection.
 */
function walkGround(body, distance, world, seconds, startSpeed = body.groundSpeed) {
  let f = world.byId.get(body.foothold), left = distance, time = seconds, initial = startSpeed;
  for (let hop = 0; f && hop < 64; hop++) {
    const speed = body.groundSpeed;
    const direction = Math.sign(left);
    if (!direction) { alignGround(body, f, groundY(f, body.x), speed); return; }
    const targetX = body.x + left * f.cos, edgeX = direction > 0 ? f.x2 : f.x1;
    if ((direction > 0 && targetX <= edgeX) || (direction < 0 && targetX >= edgeX)) {
      body.x = targetX; alignGround(body, f, groundY(f, targetX), speed); return;
    }
    const edgeDistance = (edgeX - body.x) / f.cos;
    const fraction = clamp(edgeDistance / left, 0, 1);
    const collisionSpeed = initial + (speed - initial) * fraction;
    // Native a2 is integer milliseconds; the geometry intersection here is still floating point.
    time = Math.max(0, time - Math.trunc(time * 1000 * fraction) / 1000);
    body.x = edgeX;
    alignGround(body, f, groundY(f, edgeX), collisionSpeed);
    const next = world.byId.get(direction > 0 ? f.next : f.prev);
    if (next && !isFloor(next)) {
      // 539450 distinguishes upward walls from downward lips by oriented tangent, not any wall.
      const blocks = direction < 0 ? next.sin >= 0 : next.sin <= 0;
      if (blocks) { alignGround(body, f, body.y, 0); return; }
    }
    const nextX = direction > 0 ? next?.x1 : next?.x2;
    const nextY = direction > 0 ? next?.y1 : next?.y2;
    if (!next || !isFloor(next) || Math.abs(nextX - edgeX) > EPS || Math.abs(nextY - body.y) > EPS) {
      // Open edges do not use 539A30's explicit jump/force lift.
      body.grounded = false; body.foothold = 0; body.groundSpeed = 0;
      const oldX = body.x, oldY = body.y, oldVx = body.vx, oldVy = body.vy;
      body.x += body.vx * time; body.y += body.vy * time;
      sweepWalls(body, oldX, oldY, world);
      sweepFloor(body, oldX, oldY, oldVx, oldVy, world, time);
      return;
    }
    f = next;
    alignGround(body, f, body.y, collisionSpeed);
    initial = collisionSpeed;
    left = collisionSpeed * time;
  }
  // A corrupt/cyclic zero-length chain must not leave a grounded body outside its segment.
  if (f) { body.x = clamp(body.x, f.x1, f.x2); alignGround(body, f, groundY(f, body.x), 0); }
}

/** First oriented foot/segment crossing. 5389B0 interpolates collision velocity, projects it
 * onto the tangent, halves it when input agrees, otherwise clears it; then consumes remainder.
 * Exact integer dual-contact/corner tie resolution remains a separate native-geometry gap.
 */
function sweepFloor(body, oldX, oldY, oldVx, oldVy, world, seconds) {
  let hit;
  for (const f of world.footholds) {
    if (!isFloor(f)) continue;
    const slope = (f.y2 - f.y1) / (f.x2 - f.x1);
    const before = oldY - f.y1 - slope * (oldX - f.x1);
    const after = body.y - f.y1 - slope * (body.x - f.x1);
    if (before > EPS || after < -EPS || after <= before + EPS) continue;
    const t = clamp(-before / (after - before), 0, 1);
    const x = oldX + (body.x - oldX) * t;
    if (x < f.x1 - EPS || x > f.x2 + EPS || (hit && hit.t <= t)) continue;
    hit = { f, t, x };
  }
  if (!hit) return;
  const vx = oldVx + (body.vx - oldVx) * hit.t;
  const vy = oldVy + (body.vy - oldVy) * hit.t;
  let speed = hit.f.cos * vx + hit.f.sin * vy;
  speed = (body.moveX ?? 0) * speed >= 0 ? speed * .5 : 0;
  body.x = hit.x;
  alignGround(body, hit.f, groundY(hit.f, hit.x), speed);
  const remaining = Math.max(0, seconds - Math.trunc(seconds * 1000 * hit.t) / 1000);
  walkGround(body, speed * remaining, world, remaining);
}
function sweepWalls(body, oldX, oldY, world) {
  if (Math.abs(body.x - oldX) < EPS) return;
  let earliest = 1, wall;
  for (const f of world.footholds) {
    if (f.x1 !== f.x2) continue;
    const t = (f.x1 - oldX) / (body.x - oldX);
    if (t < -EPS || t > earliest) continue;
    const y = oldY + (body.y - oldY) * t;
    if (y <= Math.min(f.y1, f.y2) + EPS || y > Math.max(f.y1, f.y2) + EPS) continue;
    earliest = t; wall = f;
  }
  if (wall) { body.x = wall.x1; body.vx = 0; }
}
/** 564DF0 uses an expanded swept AABB (+/-10 X), then the first ladder by numeric id. */
function ladderIn(world, x1, y1, x2, y2) {
  return world.ladders.find(l => l.x >= Math.min(x1, x2) - 10 && l.x <= Math.max(x1, x2) + 10
    && Math.min(y1, y2) <= l.y2 && l.y1 <= Math.max(y1, y2));
}
function grabLadder(body, input, world, oldX, oldY) {
  if (body.ladder || input.allowClimb === false) return;
  let ladder, y = body.y;
  if (body.moveY < 0) {
    if (body.grounded) {
      ladder = ladderIn(world, body.x, body.y - 20, body.x, body.y);
      if (ladder) y = Math.min(body.y, ladder.y2);
    } else if (body.vy > 0) ladder = ladderIn(world, oldX, oldY, body.x, body.y);
  } else if (body.moveY > 0 && body.grounded) {
    ladder = ladderIn(world, body.x, body.y, body.x, body.y + 10);
    if (ladder && ladder.y1 >= body.y && ladder.y1 <= body.y + 10) y = ladder.y1;
    else ladder = undefined;
  }
  if (!ladder) return;
  body.ladder = ladder; body.x = ladder.x; body.y = y;
  body.layer = ladder.page ?? body.layer; body.group = 0;
  body.grounded = false; body.foothold = 0; body.groundSpeed = 0;
  body.vx = body.vy = 0;
}
/** Keydown can precede BOTH RAF samples and the 30ms controller update. */
export function requestPlayerJump(body) {
  if (body && !body.dead) body.jumpQueued = true;
}
function latchJump(body, input) {
  if (input.disabled || body.dead) body.jumpQueued = false;
  else if (input.jump && !body.jumpHeld) body.jumpQueued = true;
  body.jumpHeld = Boolean(input.jump);
}
function step(body, input, world, dt, mob = false) {
  const horizontal = clamp(input.horizontal ?? 0, -1, 1), vertical = clamp(input.vertical ?? 0, -1, 1);
  body.moveX = horizontal; body.moveY = vertical;
  // 5426F0 death branch returns before ordinary gravity or ladder movement.
  if (body.dead) {
    body.moveX = body.moveY = body.vx = body.vy = body.groundSpeed = 0;
    body.knockback = undefined; body.jumpQueued = false; return;
  }
  if (horizontal) body.facing = horizontal < 0 ? 1 : 0;
  const shoe = { ...NATIVE_SHOE,
    walkSpeed: clamp(input.speedPercent ?? 100, mob ? 0 : 80, 130) / 100,
    jump: clamp(input.jumpPercent ?? 100, 80, 123) / 100 };
  const jumping = body.jumpQueued;
  body.jumpQueued = false;
  const wasLadder = Boolean(body.ladder);
  // 5376C0 processes jump BEFORE staged external force. A coincident hit must not erase a launch.
  if (jumping && body.ladder && horizontal) {
    body.ladder = undefined;
    body.vx = horizontal * shoe.walkSpeed * 162.5;
    body.vy = -555 * shoe.jump / world.fieldAttr.gravity * .5;
  } else if (jumping && body.grounded) {
    const f = world.byId.get(body.foothold);
    releaseGround(body, world);
    const velocity = jumpVelocity(body.vx, f?.sin ?? 0, horizontal, shoe, world.groundAttr, world.fieldAttr);
    body.vx = velocity.vx; body.vy = velocity.vy;
    body.groundJumps++; // Native ground branch alone plays Game/Jump, not a ladder departure.
  }
  const knocked = body.knockback !== undefined;
  if (knocked) {
    const impulse = body.knockback; body.knockback = undefined;
    releaseGround(body, world); body.ladder = undefined;
    body.vx = mergeImpulse(body.vx, impulse.x); body.vy = mergeImpulse(body.vy, impulse.y);
    body.moveAttr = (body.moveAttr ?? 0) | 2;
  }
  if (body.ladder) {
    const ladder = body.ladder;
    // 542DF0 is exactly 3 pixels per 30ms controller update, independent of speed stat.
    body.vx = 0; body.vy = vertical * PHYSICS.climbSpeed;
    body.y += body.vy * dt;
    if (body.y < ladder.y1 && ladder.upperFoothold === false) { body.y = ladder.y1; body.vy = 0; }
    else if (body.y < ladder.y1) { body.y = ladder.y1 - 5; body.ladder = undefined; body.vy = 0; }
    else if (body.y > ladder.y2) { body.y = ladder.y2 + 1; body.ladder = undefined; body.vy = 0; }
    return;
  }
  const oldX = body.x, oldY = body.y, oldVx = body.vx, oldVy = body.vy;
  if (body.grounded) {
    const f = world.byId.get(body.foothold);
    if (!f || !isFloor(f)) { releaseGround(body, world); return; }
    // Projection also accommodates a caller initializing world velocity (ordinary jumping mobs).
    const start = f.cos * body.vx + f.sin * body.vy;
    const result = groundStep(start, f.sin, horizontal, dt, shoe, world.groundAttr);
    body.groundSpeed = result.speed;
    walkGround(body, result.distance, world, dt, start);
  } else {
    const result = airStep(oldVx, oldVy, horizontal, dt, shoe, world.fieldAttr);
    body.vx = result.vx; body.vy = result.vy;
    body.x += result.dx; body.y += result.dy;
    sweepWalls(body, oldX, oldY, world);
    sweepFloor(body, oldX, oldY, oldVx, oldVy, world, dt);
  }
  // 5426F0 checks grabs AFTER physics. A rising jump cannot catch a rope; a falling sweep can.
  if (!knocked && !wasLadder) grabLadder(body, input, world, oldX, oldY);
}
/** Native-sized 30ms local controller updates, NOT a claim of the EXE's shared global phase.
 * RAF latches a short jump press until the next update; UI/death clears pending requests.
 * 250ms background-tab cap is explicit browser catch-up policy, not an original constant.
 */
export function advancePlayer(body, input, world, elapsedMs) {
  latchJump(body, input);
  body.accumulator += clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, 250);
  while (body.accumulator + EPS >= PHYSICS.stepMs) {
    const before = movementSnapshot(body);
    const onLadder = Boolean(body.ladder);
    step(body, input, world, PHYSICS.stepMs / 1000);
    recordMovementTick(body, before, onLadder, PHYSICS.stepMs);
    body.accumulator -= PHYSICS.stepMs;
  }
  return body;
}
/** Native <=30ms mob planning subdivision; not the whole CVecCtrlMob owner/AI controller. */
export function advanceMob(body, input, world, elapsedMs) {
  latchJump(body, input);
  for (let left = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0); left > 0;) {
    const ms = Math.min(30, left); step(body, input, world, ms / 1000, true); left -= ms;
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

/** Native scalar exports use _ftol (truncate), not Math.round at negative coordinates. */
export function movementSnapshot(body) {
  return {attr: body.moveAttr ?? 0, x: Math.trunc(body.x), y: Math.trunc(body.y),
    vx: Math.trunc(body.vx), vy: Math.trunc(body.vy), action: actionOf(body),
    foothold: body.ladder ? -body.ladder.id : body.foothold};
}
function sameMovement(a, b) {
  return a.x === b.x && a.y === b.y && a.vx === b.vx && a.vy === b.vy
    && a.action === b.action && a.foothold === b.foothold;
}
function recordMovementTick(body, before, wasLadder, duration) {
  const after = movementSnapshot(body), frames = body.motionFrames;
  const landing = before.foothold === 0 && body.grounded;
  const ladderChange = wasLadder !== Boolean(body.ladder);
  // The travel interval must not acquire its landing/ladder posture early. A zero-duration
  // terminal node changes state at contact, as with the ordinary jumping-mob planner.
  const interval = {...after, duration};
  if (landing || ladderChange) { interval.foothold = before.foothold; interval.action = before.action; }
  frames.push(interval);
  if (landing || ladderChange) frames.push({...after, attr: 0, duration: 0});
  body.moveAttr = 0; // attr2 now belongs to this ordered fragment, not an arbitrary later snapshot.
  let total = frames.reduce((sum, f) => sum + f.duration, 0);
  // Bounded browser backlog policy, separate from the native count byte (255).
  while (frames.length > 62 || total > 960) {
    const dropped = frames.shift(); total -= dropped.duration;
    body.motionOrigin = {...dropped, attr: 0};
  }
}
/** Drain the REAL ordered controller history, retaining 100ms network batching as browser policy.
 * The initial zero node anchors the path; it is not 100ms of fabricated interpolation.
 * A zero terminal node also flushes a posture/alert change accepted between controller updates.
 */
export function drainPlayerPath(body) {
  const current = movementSnapshot(body), origin = body.motionOrigin ?? current;
  const frames = body.motionFrames.splice(0);
  if (!frames.length || !sameMovement(frames.at(-1), current) || current.attr)
    frames.push({...current, duration: 0});
  body.motionOrigin = {...current, attr: 0}; body.moveAttr = 0;
  return {originX: origin.x, originY: origin.y,
    elements: [{...origin, attr: 0, duration: 0}, ...frames]};
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
  entity.motion = { start: now, x: entity.x, y: entity.y, foothold: entity.foothold, elements: elements.map((e) => ({ ...e, duration: Number.isFinite(e.duration) ? Math.max(0, e.duration) : fallbackDuration })) };
}
export function sampleMotion(entity, now, world) {
  const motion = entity.motion;
  if (!motion) return false;
  let remaining = Math.max(0, now - motion.start);
  let x = motion.x, y = motion.y, foothold = motion.foothold;
  for (const e of motion.elements) {
    if (remaining >= e.duration) {
      remaining -= e.duration; x = e.x; y = e.y; foothold = e.foothold;
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
    if (e.foothold && isFloor(world.byId.get(e.foothold) ?? {})) {
      const chain = connectedFloors(world, e.foothold);
      // Never project an air-to-floor interval or an unrelated platform chord onto the floor.
      if (foothold !== undefined && !chain.has(foothold)) return true;
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
