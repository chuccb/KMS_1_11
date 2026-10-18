export interface NativeShoe {
  mass: number;
  walkForce: number;
  walkSpeed: number;
  walkDrag: number;
  slip: number;
  jump: number;
}
export interface GroundAttributes {
  walk: number;
  drag: number;
}
export interface FieldAttributes {
  drag: number;
  gravity: number;
}
/** Scalar CVecCtrl ordinary-ground/air rules, independent of rendering and the movement wire.
 * Evidence: 537CA0 / 5382F0 / 5378D0; defaults 511030 / 562BB0 / 563010.
 * Shoe +48=.9 is a slope-slip threshold, NOT the multiplier of the flat 80000 drag.
 * 563010 constructs ONE shared default foothold attribute. No later-version WZ fields inferred.
 * Water/fly/skill controllers are deliberately not represented by these ordinary-air functions.
 */
export const NATIVE_SHOE: Readonly<NativeShoe> = Object.freeze({
  mass: 100,
  walkForce: 1,
  walkSpeed: 1,
  walkDrag: 1,
  slip: 0.9,
  jump: 1,
});
export const NATIVE_FOOTHOLD: Readonly<GroundAttributes> = Object.freeze({ walk: 1, drag: 1 });
export const NATIVE_FLUID: Readonly<FieldAttributes> = Object.freeze({ drag: 1, gravity: 1 });
export const NATIVE_STEP_MS: 30 = 30;

function accelerate(speed: number, force: number, cap: number, mass: number, seconds: number) {
  if (cap < 0) return speed;
  if (force > 0 && speed < cap) return Math.min(cap, speed + (force / mass) * seconds);
  if (force <= 0 && speed > -cap) return Math.max(-cap, speed + (force / mass) * seconds);
  return speed;
}
function brake(speed: number, cap: number, force: number, mass: number, seconds: number) {
  if (cap < 0) return speed;
  if (speed > cap) return Math.max(cap, speed - (force / mass) * seconds);
  if (speed < -cap) return Math.min(-cap, speed + (force / mass) * seconds);
  return speed;
}

/** Return signed TANGENT speed/distance, never world vx. sin is dy/hypot(dx,dy), not dy/dx.
 * The orientation-dependent force multiplier is literal 537D35–537D4F (including its asymmetry).
 * 537F68–537F77 supplies the cap>=0 comparison lost as an undefined v12 in the decompiler.
 */
export function groundStep(
  speed: number,
  sin: number,
  horizontal: number,
  seconds: number,
  shoe: NativeShoe = NATIVE_SHOE,
  attr: GroundAttributes = NATIVE_FOOTHOLD,
): { speed: number; distance: number } {
  const start = speed,
    steepness = Math.abs(sin),
    square = sin * sin;
  const uphill = sin >= 0 ? -1 : 1;
  const base = shoe.walkSpeed * attr.walk * 125;
  const drag = shoe.walkDrag * attr.drag;
  const friction = drag * 80000,
    braking = drag === 0 ? 16000 : friction;
  let force = horizontal * shoe.walkForce * attr.walk * 140000;
  if (horizontal * force <= 0) force = 0;
  force *= uphill <= 0 ? 1 + square : 1 - square;
  if (steepness === 0) {
    speed = brake(speed, base, braking, shoe.mass, seconds);
    speed = horizontal
      ? accelerate(speed, force, base, shoe.mass, seconds)
      : brake(speed, 0, friction, shoe.mass, seconds);
  } else {
    const upCap = Math.max(0, base),
      downCap = Math.max(0, (1 + square) * base);
    speed = brake(speed, uphill * speed <= 0 ? downCap : upCap, braking, shoe.mass, seconds);
    if (steepness > shoe.slip) {
      let slipForce = steepness * 60000 * -uphill,
        cap = steepness * 120;
      if (uphill * horizontal > 0) {
        slipForce *= 0.5;
        cap *= 0.5;
      } else if (horizontal) {
        slipForce += force;
        cap += downCap;
      }
      if (uphill * speed > 0) speed = brake(speed, 0, braking, shoe.mass, seconds);
      speed = accelerate(speed, slipForce, cap, shoe.mass, seconds);
    } else {
      if (drag === 0) force -= steepness * 60000 * uphill;
      speed =
        horizontal === 0 && drag !== 0
          ? brake(speed, 0, friction, shoe.mass, seconds)
          : accelerate(speed, force, uphill * force <= 0 ? downCap : upCap, shoe.mass, seconds);
    }
  }
  return { speed, distance: (start + speed) * seconds * 0.5 };
}

/** 5382F0 ordinary air. Holding a direction does not brake an already faster walking jump.
 * Excess fall speed decays with drag; it is NOT instantly clamped to terminal speed.
 */
export function airStep(
  vx: number,
  vy: number,
  horizontal: number,
  seconds: number,
  shoe: NativeShoe = NATIVE_SHOE,
  field: FieldAttributes = NATIVE_FLUID,
): { vx: number; vy: number; dx: number; dy: number } {
  const oldVx = vx,
    oldVy = vy,
    drag = field.drag * 10000;
  vx = horizontal
    ? accelerate(vx, horizontal * 2 * drag, drag * 0.0008928571428571428, shoe.mass, seconds)
    : brake(vx, 0, drag, shoe.mass, seconds);
  const terminal = field.gravity * 670;
  if (vy > 0 && terminal >= 0) vy = brake(vy, terminal, drag, shoe.mass, seconds);
  vy = accelerate(vy, shoe.mass * field.gravity * 2000, terminal, shoe.mass, seconds);
  return { vx, vy, dx: (oldVx + vx) * seconds * 0.5, dy: (oldVy + vy) * seconds * 0.5 };
}

/** 5378D0 ordinary ground launch, AFTER detaching with the platform's world velocity. */
export function jumpVelocity(
  vx: number,
  sin: number,
  horizontal: number,
  shoe: NativeShoe = NATIVE_SHOE,
  attr: GroundAttributes = NATIVE_FOOTHOLD,
  field: FieldAttributes = NATIVE_FLUID,
): { vx: number; vy: number } {
  if (horizontal) {
    const sign = sin * horizontal >= 0 ? 1 : -1;
    const cap = attr.walk * shoe.walkSpeed * 125 * (1 + sin * sin * sign);
    if (cap * 0.8 > horizontal * vx) vx += horizontal * cap * 0.8;
    if (horizontal * vx > cap) vx = horizontal * cap;
  } else vx *= 0.5;
  return { vx, vy: (-555 * shoe.jump) / field.gravity };
}
