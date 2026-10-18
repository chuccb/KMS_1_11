export interface AttackTiming {
  delays: readonly number[];
  frameIndices?: readonly number[];
}
/** CUser 508700 / 50B590: scaled integer delays and forced-body countdown are different clocks.
 * 512F90 / 513C80 schedule effects/projectiles using the RAW sum minus its last delay.
 * Each body frame instead consumes whole 30ms updates and discards negative overshoot.
 * Browser clock phase starts at the accepted attack, not the original global update phase.
 */
export const USER_UPDATE_MS: 30 = 30;
export function scaledAttackDelays(delays: readonly number[], speed: number): number[] {
  const step = Math.max(0, Math.min(6, Math.trunc(speed)));
  return delays.map((delay) => Math.trunc((delay * (step + 5)) / 8));
}
export function attackFrameDuration(delay: number): number {
  return Math.max(1, Math.ceil(delay / USER_UPDATE_MS)) * USER_UPDATE_MS;
}
export function attackDuration(motion?: AttackTiming): number {
  return (motion?.delays ?? []).reduce((sum, delay) => sum + attackFrameDuration(delay), 0);
}
export function attackFrameStart(motion: AttackTiming, index: number): number {
  return (motion?.delays ?? [])
    .slice(0, index)
    .reduce((sum, delay) => sum + attackFrameDuration(delay), 0);
}
export function attackFrame(
  motion: (AttackTiming & { start: number }) | undefined,
  now: number,
): number {
  if (!motion) return -1;
  let elapsed = now - motion.start;
  if (elapsed < 0) return -1;
  const delays = motion.delays ?? [];
  for (let i = 0; i < delays.length; i++) {
    elapsed -= attackFrameDuration(delays[i]);
    if (elapsed < 0) return i;
  }
  return -1;
}
export function attackCanvasFrame(motion: AttackTiming | undefined, ordinal: number): number {
  return motion?.frameIndices?.[ordinal] ?? ordinal;
}
export function shotRelease(motion?: AttackTiming): number {
  const delays = motion?.delays ?? [];
  return delays.slice(0, -1).reduce((sum, delay) => sum + delay, 0);
}
/** 427F60/427FE0 do NOT randomly select 32. 512F90 selects it separately for prone, skill=null. */
export function basicAttackAction<T extends { action: number }>(
  profile: { melee: T[]; shoot: T[]; prone?: T } | undefined,
  action: number,
  shoot: boolean = false,
): T | undefined {
  if (!profile) return undefined;
  return !shoot && action === 32
    ? profile.prone
    : (shoot ? profile.shoot : profile.melee)?.find((entry) => entry.action === action);
}
/** 4882F0 DAMAGEINFO[0]=impact+120*ordinal; 4862C0's update compares it with world time. */
export function attackHitDelay(ordinal: number): number {
  return 120 * Math.max(0, Math.trunc(ordinal));
}
