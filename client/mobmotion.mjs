/** Ordinary jumping-mob trajectory; the server owns this path, the browser only samples it.
 * 48D080: ability comes from root fly/jump/move subtrees, NOT an info.jump stat.
 * 5378D0: -555 with default shoe.jump=1/mass=1; 53D3F0: <=30ms subdivision.
 * Shared swept floor/wall geometry avoids a separate fake sine wave or renderer-only hop.
 * No water/flying/aggro/skill or custom field/shoe physics is claimed here.
 */
import { collisionWorld, createPlayer, advanceMob, PHYSICS } from "./motion.mjs";

export function planMobAirPath(start, footholds, options) {
  const world = collisionWorld({ footholds, ladders: [] });
  const body = createPlayer(start.x, start.y, world, start.foothold, options.launch);
  body.vx = start.vx ?? 0;
  body.vy = start.vy ?? 0;
  if (options.launch && !body.grounded) return [];
  const points = [];
  const facing = start.facing & 1;
  const groundAction = ((options.direction ? 0 : 1) << 1) | facing;
  const jumpAction = (2 << 1) | facing; // mob jump=2, NOT the user's movement action 6.
  const horizon = Math.max(30, Math.min(3000, options.horizonMs ?? 900));
  for (let elapsed = 0; elapsed < horizon;) {
    const duration = Math.min(30, horizon - elapsed);
    advanceMob(body, { horizontal: options.direction, jump: options.launch && elapsed === 0,
      speedPercent: options.speedPxPerSecond * 100 / PHYSICS.walkSpeed }, world, duration);
    elapsed += duration;
    points.push({ x: Math.round(body.x), y: Math.round(body.y), vx: Math.round(body.vx),
      vy: Math.round(body.vy), foothold: 0, action: jumpAction, duration });
    if (body.grounded) {
      // Land at the END of this interval. A positive foothold on the preceding segment would
      // force sampleMotion to project the whole descending arc onto the floor prematurely.
      points.push({ x: Math.round(body.x), y: Math.round(body.y), vx: Math.round(body.vx), vy: 0,
        foothold: body.foothold, action: groundAction, duration: 0 });
      break;
    }
  }
  return points;
}

/** Selected from the wire action, never inferred solely from a nonzero position delta. */
export function mobLocomotion(mob, actions) {
  const action = (mob.action ?? 2) >> 1;
  if (action === 2 && actions.jump?.length) return "jump";
  if (actions.fly?.length) return "fly";
  if (action === 0 && actions.move?.length) return "move";
  return actions.stand?.length ? "stand" : "move";
}
