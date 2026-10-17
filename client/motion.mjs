/**
 * Browser locomotion, in world pixels and seconds (not pixels per timer callback).
 * Baseline constants from CVecCtrl: sub_5378D0 (-555 jump), sub_537CA0
 * (140000 force, 125 walk speed, 80000 drag / CAttrShoe mass=100), and
 * sub_5382F0 (2000 gravity, 670 terminal fall speed). Default shoe friction is .9.
 * This implements ordinary ground/air/ladder movement, not water, flight, knockback or skills.
 */
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
function step(body, input, world, dt) {
  const horizontal = clamp(input.horizontal ?? 0, -1, 1);
  const vertical = clamp(input.vertical ?? 0, -1, 1);
  const jumping = Boolean(input.jump) && !body.jumpHeld;
  body.jumpHeld = Boolean(input.jump);
  if (horizontal) body.facing = horizontal < 0 ? 1 : 0;
  body.ignoreMs -= dt * 1000;
  if (body.ignoreMs <= 0) body.ignored.clear();
  if (!body.ladder && vertical && !input.jump) {
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
      body.vx = horizontal * 162.5;
      body.vy = -PHYSICS.jumpSpeed * 0.5; // sub_5378D0: jumping away from a ladder
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
      body.vy = -PHYSICS.jumpSpeed;
      // sub_5378D0: a standing jump halves drift; a walking jump starts at least at 80% walk speed.
      if (horizontal) {
        if (horizontal * body.vx < PHYSICS.walkSpeed * .8) body.vx += horizontal * PHYSICS.walkSpeed * .8;
        body.vx = horizontal * Math.min(PHYSICS.walkSpeed, horizontal * body.vx);
      } else body.vx *= .5;
    }
    body.grounded = false;
    body.foothold = 0;
  }
  const oldX = body.x, oldY = body.y;
  const oldVx = body.vx, oldVy = body.vy;
  if (body.grounded) {
    body.vx = approach(body.vx, horizontal * PHYSICS.walkSpeed, (horizontal ? PHYSICS.acceleration : PHYSICS.friction) * dt);
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
export function locomotion(body) {
  if (body.ladder) return body.ladder.ladder ? "ladder" : "rope";
  if (!body.grounded) return "jump";
  return Math.abs(body.vx) > 1 ? "walk1" : "stand1";
}
export function actionOf(body) {
  // sub_43FC80's action-name table, doubled because bit 0 is facing.
  return ({ walk1: 0, stand1: 4, jump: 70, ladder: 72, rope: 74 }[locomotion(body)]) | body.facing;
}

/** Preserve path duration end-to-end. New paths start from what was drawn, avoiding tiny jitter. */
export function beginPath(entity, path, now, fallbackDuration = 100) {
  const elements = path?.elements?.length ? path.elements : [];
  if (!elements.length) return;
  entity.motion = { start: now, x: entity.x, y: entity.y, elements: elements.map((e) => ({ ...e, duration: Math.max(1, e.duration || fallbackDuration) })) };
}
export function sampleMotion(entity, now, world) {
  const motion = entity.motion;
  if (!motion) return false;
  let remaining = Math.max(0, now - motion.start);
  let x = motion.x, y = motion.y;
  for (const e of motion.elements) {
    if (remaining >= e.duration) { remaining -= e.duration; x = e.x; y = e.y; continue; }
    const fraction = remaining / e.duration;
    entity.x = x + (e.x - x) * fraction;
    entity.y = y + (e.y - y) * fraction;
    entity.foothold = e.foothold;
    entity.action = e.action ?? entity.action;
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
    return true;
  }
  const last = motion.elements.at(-1);
  entity.x = last.x;
  entity.y = last.y;
  entity.foothold = last.foothold;
  entity.action = last.action ?? entity.action;
  entity.vx = last.vx ?? 0; entity.vy = last.vy ?? 0;
  entity.motion = undefined;
  return false;
}

/** Same z-space as mapSprites, normalized by removing the common -1073721834 base.
 * sub_4861F0/sub_509A80: 30000*page - 2*group + 10008; sub_499BA0: NPC +10009; sub_4A88A0: drop +10011.
 */
export function actorDepth(entity, world, kind = "self") {
  const climbing = entity.ladder ?? ((entity.action & ~1) === 72 || (entity.action & ~1) === 74
    ? world.ladders.find((l) => Math.abs(l.x - entity.x) < 1 && entity.y >= l.y1 && entity.y <= l.y2) : undefined);
  if (climbing) { entity.layer = climbing.page ?? entity.layer; entity.group = 0; }
  const floor = world.byId.get(entity.foothold) ?? floorBelow(world, entity.x, entity.y - 2, 4)?.foothold;
  if (floor && !climbing) { entity.layer = floor.layer ?? 7; entity.group = floor.group ?? 0; }
  return 30000 * (entity.layer ?? (kind === "drop" ? 0 : 7)) - 2 * (entity.group ?? 0) + (kind === "npc" ? 10009 : kind === "drop" ? 10011 : 10008);
}

/** Body-frame delays from Character/00002000.img; climbing freezes its current frame, not frame 0. */
export function animationPose(entity, stance, moving, now) {
  const climbing = stance === 'rope' || stance === 'ladder';
  if (!entity.animation || entity.animation.stance !== stance) entity.animation = { stance, elapsed: 0, last: now };
  const state = entity.animation;
  if (!climbing || moving) state.elapsed += Math.max(0, Math.min(250, now - state.last));
  state.last = now;
  const delay = climbing ? 250 : stance === 'walk1' ? 180 : 500;
  const count = climbing ? 2 : stance === 'walk1' ? 4 : stance === 'jump' ? 1 : 3;
  return { stance, frame: Math.floor(state.elapsed / delay) % count };
}
export function remoteStance(entity) {
  return ({ 0: 'walk1', 4: 'stand1', 70: 'jump', 72: 'ladder', 74: 'rope' })[typeof entity.action === 'number' ? entity.action & ~1 : -1]
    ?? (entity.motion ? 'walk1' : 'stand1');
}

/** Action bit 1 means LEFT (sub_4884F0); WZ avatar/mob art already faces left.
 * Logical facing is NOT the Gr2D horizontal-mirror flag. Never invert combat/input to fix art. */
export function facingFlip(facing = 0) { return (facing & 1) === 0; }
