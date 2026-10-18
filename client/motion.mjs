import { normalizeFootholds, physicalBounds, clipAir, clipGround, segmentPosition, terrainContact, contactTangent } from "./native-terrain.mjs";
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
  const footholds = normalizeFootholds(map.footholds ?? []);
  return { footholds, byId: new Map(footholds.map(f => [f.id, f])),
    ladders: [...(map.ladders ?? [])].sort((a, b) => a.id - b.id),
    groundAttr: NATIVE_FOOTHOLD, fieldAttr: NATIVE_FLUID,
    bounds: map.physicalBounds ?? physicalBounds(footholds) };
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
  body.groundPosition = segmentPosition(f, body.x, body.y);
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
  body.groundPosition = 0;
}
export function createPlayer(x, y, world, foothold = 0, settle = true, initialize = true) {
  // 537260 clamps all FOUR sides only at initialization. Continuing mob paths must not
  // repeatedly teleport a falling body back to bottom (ordinary movement has no bottom clamp).
  if (initialize && world.bounds) {
    x = clamp(x, world.bounds.left, world.bounds.right);
    y = clamp(y, world.bounds.top, world.bounds.bottom);
  }
  const body = { x, y, vx: 0, vy: 0, groundSpeed: 0, groundPosition: 0, foothold: 0, grounded: false, facing: 0,
    layer: 7, group: 0, ladder: undefined, jumpHeld: false, jumpQueued: false, groundJumps: 0, accumulator: 0, terrainTrace: [] };
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

/** Set the true foothold distance and export world coordinates/velocity (537260/539450). */
function placeGround(body, f, position, speed) {
  body.x = f.x1 + f.cos * position;
  alignGround(body, f, f.y1 + f.sin * position, speed);
  body.groundPosition = position;
}
function noteContact(body, incoming, at) {
  const before = {...movementSnapshot(incoming), attr: 0}, after = movementSnapshot(body);
  body.terrainTrace.push({at, before, after});
  // An external-force marker is attached to its actual zero-time transition exactly once.
  body.moveAttr = 0;
}
/** One native ground collision pass (539C40 -> 539450). The caller, not this function,
 * performs the single remaining-time continuation prescribed by 5376C0.
 */
function resolveGround(body, world, oldPosition, oldSpeed, position, speed, milliseconds, offset = 0) {
  const f = world.byId.get(body.foothold);
  if (!f || !isFloor(f)) return {hit: false, remaining: 0};
  const intendedSpeed = speed, intendedPosition = position;
  const clipped = clipGround(f, oldPosition, position, speed, milliseconds, world.bounds);
  position = clipped.position; speed = clipped.speed;
  let used = clipped.used;
  // Endpoint reversal can change to prev.next / next.prev, which need not be this segment.
  // WZ links are authoritative; do not invent reciprocal links or follow an arbitrary neighbor.
  let replacement, atEnd = false;
  if (oldPosition <= 0 && position > 0) replacement = world.byId.get(world.byId.get(f.prev)?.next);
  else if (oldPosition >= f.length && position < f.length) {
    replacement = world.byId.get(world.byId.get(f.next)?.prev); atEnd = true;
  }
  if (replacement && replacement !== f) {
    const before = {...body};
    if (isFloor(replacement)) {
      placeGround(body, replacement, atEnd ? replacement.length : 0, speed);
      noteContact(body, before, offset);
      // 539450 writes the 0ms transfer, then returns 0: no second-pass movement here.
      return {hit: false, remaining: milliseconds};
    }
    position = atEnd ? f.length : 0; speed = 0;
  }
  if (position >= 0 && position <= f.length) {
    placeGround(body, f, position, speed);
    if (position !== intendedPosition) {
      const fraction = milliseconds ? used / milliseconds : 0;
      const incomingSpeed = oldSpeed + (intendedSpeed - oldSpeed) * fraction;
      noteContact(body, {...body, vx: f.cos * incomingSpeed, vy: f.sin * incomingSpeed}, offset + used);
    }
    return {hit: false, remaining: milliseconds - used};
  }
  const left = position < 0;
  const fraction = left ? oldPosition / (oldPosition - position) : (f.length - oldPosition) / (position - oldPosition);
  used = Math.trunc(used * fraction);
  const collisionSpeed = oldSpeed + (speed - oldSpeed) * fraction;
  placeGround(body, f, left ? 0 : f.length, collisionSpeed);
  const incoming = {...body}, next = world.byId.get(left ? f.prev : f.next);
  if (!next || !isFloor(next)) {
    const blocks = next && (left ? next.sin >= 0 : next.sin <= 0);
    if (blocks) placeGround(body, f, left ? 0 : f.length, 0);
    else { body.grounded = false; body.foothold = 0; body.groundSpeed = 0; body.groundPosition = 0; }
  } else {
    const transferred = left ? (collisionSpeed <= 0 ? collisionSpeed : 0) : (collisionSpeed >= 0 ? collisionSpeed : 0);
    placeGround(body, next, left ? next.length : 0, transferred);
  }
  noteContact(body, incoming, offset + used);
  return {hit: true, remaining: Math.max(0, milliseconds - used)};
}
/** Unified wall/floor/ceiling pass (5389B0), not independent sweeps in a fixed priority order. */
function resolveAir(body, old, world, milliseconds, accelerated, offset = 0) {
  const intended = {x: body.x, y: body.y, vx: body.vx, vy: body.vy};
  const bounded = clipAir(body, old, milliseconds, world.bounds);
  const hit = terrainContact(world, old, body, body.group ?? 0);
  if (!hit) {
    if (intended.x !== body.x || intended.y !== body.y) {
      const fraction = milliseconds ? bounded / milliseconds : 0;
      noteContact(body, {...body, vx: old.vx + (intended.vx - old.vx) * fraction,
        vy: old.vy + (intended.vy - old.vy) * fraction}, offset + bounded);
    }
    return {hit: false, remaining: milliseconds - bounded};
  }
  const used = Math.trunc(bounded * hit.fraction), remaining = Math.max(0, milliseconds - used);
  const vx = old.vx + (body.vx - old.vx) * hit.fraction;
  const vy = old.vy + (body.vy - old.vy) * hit.fraction;
  const selected = contactTangent(hit, vx, vy), f = selected.foothold;
  const position = clamp(segmentPosition(f, hit.x, hit.y), 0, f.length);
  const x = f.x1 + f.cos * position, y = f.y1 + f.sin * position;
  const incoming = {...body, x, y, vx, vy};
  if (isFloor(f)) {
    const speed = body.moveX * selected.speed >= 0 ? selected.speed * .5 : 0;
    placeGround(body, f, position, speed);
    noteContact(body, incoming, offset + used);
  } else {
    // Native does NOT ground on a wall/ceiling or halve tangent velocity there.
    // The accelerated pass projects its END velocity and predicts along the contact tangent
    // for the remaining milliseconds; the second pass uses a4=0 and only snaps to contact.
    const endSpeed = accelerated ? f.cos * body.vx + f.sin * body.vy : selected.speed;
    body.x = x; body.y = y;
    body.vx = f.cos * selected.speed; body.vy = f.sin * selected.speed;
    noteContact(body, incoming, offset + used);
    body.vx = f.cos * endSpeed; body.vy = f.sin * endSpeed;
    if (accelerated) {
      const distance = (selected.speed + endSpeed) * remaining * .0005;
      body.x += f.cos * distance; body.y += f.sin * distance;
    }
  }
  return {hit: true, remaining};
}
/** 5376C0 has TWO collision passes, not an unbounded edge loop or repeated force integration. */
function moveOnTerrain(body, world, milliseconds, shoe) {
  const old = {x: body.x, y: body.y, vx: body.vx, vy: body.vy};
  let result;
  if (body.grounded) {
    const f = world.byId.get(body.foothold);
    if (!f || !isFloor(f)) { releaseGround(body, world); return; }
    const position = segmentPosition(f, body.x, body.y);
    const speed = f.cos * body.vx + f.sin * body.vy;
    const next = groundStep(speed, f.sin, body.moveX, milliseconds / 1000, shoe, world.groundAttr);
    result = resolveGround(body, world, position, speed, position + next.distance, next.speed, milliseconds);
    if (!result.hit || result.remaining <= 0) return;
    const offset = milliseconds - result.remaining;
    if (body.grounded) {
      const nextF = world.byId.get(body.foothold), start = segmentPosition(nextF, body.x, body.y);
      resolveGround(body, world, start, body.groundSpeed, start + body.groundSpeed * result.remaining / 1000,
        body.groundSpeed, result.remaining, offset);
    } else {
      const start = {x: body.x, y: body.y, vx: body.vx, vy: body.vy};
      body.x += body.vx * result.remaining / 1000; body.y += body.vy * result.remaining / 1000;
      resolveAir(body, start, world, result.remaining, false, offset);
    }
  } else {
    const next = airStep(old.vx, old.vy, body.moveX, milliseconds / 1000, shoe, world.fieldAttr);
    body.vx = next.vx; body.vy = next.vy; body.x += next.dx; body.y += next.dy;
    result = resolveAir(body, old, world, milliseconds, true);
    if (!result.hit || result.remaining <= 0) return;
    const offset = milliseconds - result.remaining;
    if (body.grounded) {
      const f = world.byId.get(body.foothold), start = segmentPosition(f, body.x, body.y);
      resolveGround(body, world, start, body.groundSpeed, start + body.groundSpeed * result.remaining / 1000,
        body.groundSpeed, result.remaining, offset);
    } else {
      // Deliberately reuse ORIGINAL pre-force dst, as 5376C0 does for the projected wall pass.
      resolveAir(body, old, world, result.remaining, false, offset);
    }
  }
}
/** 564DF0 uses an expanded swept AABB (+/-10 X), then the first ladder by numeric id. */
function ladderIn(world, x1, y1, x2, y2) {
  return world.ladders.find(l => l.x >= Math.min(x1, x2) - 10 && l.x <= Math.max(x1, x2) + 10
    && Math.min(y1, y2) <= l.y2 && l.y1 <= Math.max(y1, y2));
}
function grabLadder(body, input, world, oldX, oldY, milliseconds) {
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
  const incoming = {...body};
  body.ladder = ladder; body.x = ladder.x; body.y = y;
  body.layer = ladder.page ?? body.layer; body.group = 0;
  body.grounded = false; body.foothold = 0; body.groundSpeed = 0; body.groundPosition = 0;
  body.vx = body.vy = 0;
  noteContact(body, incoming, milliseconds);
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
  body.terrainTrace = [];
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
    const incoming = {...body};
    body.ladder = undefined;
    body.vx = horizontal * shoe.walkSpeed * 162.5;
    body.vy = -555 * shoe.jump / world.fieldAttr.gravity * .5;
    noteContact(body, incoming, 0);
  } else if (jumping && body.grounded) {
    const incoming = {...body};
    const f = world.byId.get(body.foothold);
    releaseGround(body, world);
    const velocity = jumpVelocity(body.vx, f?.sin ?? 0, horizontal, shoe, world.groundAttr, world.fieldAttr);
    body.vx = velocity.vx; body.vy = velocity.vy;
    body.groundJumps++; // Native ground branch alone plays Game/Jump, not a ladder departure.
    noteContact(body, incoming, 0);
  }
  const knocked = body.knockback !== undefined;
  if (knocked) {
    const incoming = {...body};
    const impulse = body.knockback; body.knockback = undefined;
    releaseGround(body, world); body.ladder = undefined;
    body.vx = mergeImpulse(body.vx, impulse.x); body.vy = mergeImpulse(body.vy, impulse.y);
    body.moveAttr = (body.moveAttr ?? 0) | 2;
    noteContact(body, incoming, 0);
  }
  if (body.ladder) {
    const ladder = body.ladder;
    // 542DF0 is exactly 3 pixels per 30ms controller update, independent of speed stat.
    body.vx = 0; body.vy = vertical * PHYSICS.climbSpeed;
    body.y += body.vy * dt;
    const incoming = {...body};
    if (body.y < ladder.y1 && ladder.upperFoothold === false) { body.y = ladder.y1; body.vy = 0; }
    else if (body.y < ladder.y1) { body.y = ladder.y1 - 5; body.ladder = undefined; body.vy = 0; }
    else if (body.y > ladder.y2) { body.y = ladder.y2 + 1; body.ladder = undefined; body.vy = 0; }
    if (incoming.y !== body.y || incoming.ladder !== body.ladder) noteContact(body, incoming, dt * 1000);
    return;
  }
  const oldX = body.x, oldY = body.y;
  moveOnTerrain(body, world, Math.round(dt * 1000), shoe);
  // 5426F0 checks grabs AFTER physics. A rising jump cannot catch a rope; a falling sweep can.
  if (!knocked && !wasLadder) grabLadder(body, input, world, oldX, oldY, dt * 1000);
}
/** Native-sized 30ms local controller updates, NOT a claim of the EXE's shared global phase.
 * RAF latches a short jump press until the next update; UI/death clears pending requests.
 * 250ms background-tab cap is explicit browser catch-up policy, not an original constant.
 */
export function advancePlayer(body, input, world, elapsedMs) {
  latchJump(body, input);
  body.accumulator += clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, 250);
  while (body.accumulator + EPS >= PHYSICS.stepMs) {
    step(body, input, world, PHYSICS.stepMs / 1000);
    recordMovementTick(body, PHYSICS.stepMs);
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
/** Explicit contact records preserve the ACTUAL integer collision time inside a controller tick.
 * Both player publication and server-owned ordinary mob trajectories use this representation.
 */
export function stepMovementRecords(body, duration) {
  const frames = [];
  let cursor = 0;
  for (const contact of body.terrainTrace ?? []) {
    const at = clamp(Math.trunc(contact.at), cursor, duration);
    if (at > cursor) frames.push({...contact.before, duration: at - cursor});
    frames.push({...contact.after, duration: 0});
    cursor = at;
  }
  const after = movementSnapshot(body);
  if (duration > cursor || !frames.length || !sameMovement(frames.at(-1), after) || after.attr)
    frames.push({...after, duration: duration - cursor});
  return frames;
}
function recordMovementTick(body, duration) {
  const frames = body.motionFrames;
  frames.push(...stepMovementRecords(body, duration));
  body.moveAttr = 0;
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
