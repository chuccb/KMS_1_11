export interface AttackAlertClock {
  remaining: number;
  last: number;
  accumulator: number;
}
export interface PostureBody {
  dead?: boolean;
  grounded?: boolean;
  moveX?: number;
  moveY?: number;
  ladder?: { ladder?: boolean };
  attackAlert?: AttackAlertClock;
}
export type PlayerPosture =
  "dead" | "walk1" | "prone" | "alert" | "stand1" | "ladder" | "rope" | "jump";
/** 508690 writes CUser+176=3000; 50B590 subtracts30; 50D700 reads the adjusted this+43.
 * Alert is not a three-second delay AFTER the animation: it starts when the attack is accepted.
 * Time phase is browser-local; no claim of the native process's global 30ms phase.
 */
import { USER_UPDATE_MS } from "./attack-timing.ts";
export const ATTACK_ALERT_MS = 3000;
export function beginAttackAlert(body: PostureBody | undefined, now: number) {
  if (body) body.attackAlert = { remaining: ATTACK_ALERT_MS, last: now, accumulator: 0 };
}
export function advanceAttackAlert(body: PostureBody | undefined, now: number) {
  const clock = body?.attackAlert;
  if (!clock) return;
  clock.accumulator += Math.max(0, now - clock.last);
  clock.last = now;
  const ticks = Math.floor(clock.accumulator / USER_UPDATE_MS);
  clock.accumulator -= ticks * USER_UPDATE_MS;
  clock.remaining = Math.max(0, clock.remaining - ticks * USER_UPDATE_MS);
  if (!clock.remaining) delete body!.attackAlert;
}
export function clearAttackAlert(body?: PostureBody) {
  if (body) delete body!.attackAlert;
}
/** 50D700: grounded horizontal INPUT wins over down; otherwise down > alert > stand.
 * Velocity is deliberately not used: release can stand while coasting, a wall can still walk.
 * Death override is 512EE0. Fly/water geometry is not added by this selector.
 */
export function playerPosture(body: PostureBody): PlayerPosture {
  if (body.dead) return "dead";
  if (body.grounded) {
    if (body.moveX) return "walk1";
    if ((body.moveY ?? 0) > 0) return "prone";
    return (body.attackAlert?.remaining ?? 0) > 0 ? "alert" : "stand1";
  }
  if (body.ladder) return body.ladder.ladder ? "ladder" : "rope";
  return "jump";
}
/** 5426F0 masks input for ANY forced action, including in mid-air; 32 alone keeps Down=1. */
export function forcedAttackInput(action: number) {
  return { horizontal: 0, vertical: action === 32 ? 1 : 0, jump: false, allowClimb: false };
}

/** 508FC0 body action ids, NOT movement>>1. Recovery needs stand2/3 and ladder36/rope37. */
export function nativeBodyAction(body?: PostureBody, profile?: { walk?: string; stand?: string }) {
  if (!body) return -1;
  const stance = playerPosture(body);
  if (stance === "walk1") return profile?.walk === "walk2" ? 1 : 0;
  if (stance === "stand1") return profile?.stand === "stand2" ? 3 : 2;
  return { alert: 4, prone: 33, jump: 35, ladder: 36, rope: 37, dead: 38 }[stance] ?? -1;
}
