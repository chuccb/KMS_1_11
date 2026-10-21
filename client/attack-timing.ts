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
/**
 * The attack-speed byte, and the range both ends clamp it to.
 *
 * `sub_4BE8B0` on the way out (`.c:198498-198503`) and `sub_508700` on the way in
 * (`.c:269574-269582`) are the same three lines: `n <= 0 -> 0`, `n >= 6 -> 6`, then
 * `delay * (n + 5) / 8`. So 7 is not faster than 6 and -1 is not slower than 0, and a browser that
 * scales with a raw byte lands on exactly the numbers the native does.
 */
export const ATTACK_SPEED = { min: 0, max: 6 } as const;

export function clampAttackSpeed(speed: number): number {
  const step = Math.trunc(speed);
  if (step >= ATTACK_SPEED.max) return ATTACK_SPEED.max;
  return step <= ATTACK_SPEED.min ? ATTACK_SPEED.min : step;
}

export function scaledAttackDelays(delays: readonly number[], speed: number): number[] {
  const step = clampAttackSpeed(speed);
  return delays.map((delay) => Math.trunc((delay * (step + 5)) / 8));
}

/**
 * When the damage numbers for a multi-target swing appear.
 *
 * `sub_520F20` walks the packet's targets in `for ( n3000 = 0; ; n3000 += 70 )` (`.c:293748`) and
 * hands `sub_4882F0` a time of `base + sub_515CA0(n3000, 280)`; `sub_515CA0(a, b)` is literally
 * `a >= b ? b : a` (`.c:281167`) - a cap, not a scale. So every extra target the swing names is
 * 70 ms later and the whole fan-out stops at 280 ms: a Slash Blast that catches six mobs finishes
 * printing in under a third of a second instead of stretching out with the count.
 *
 * This is the delay *between targets*. The delay between successive hits on *one* target is
 * `attackHitDelay` (120 ms, `sub_4882F0`'s own `DAMAGEINFO[0]`), and the two are independent.
 */
export const ATTACK_TARGET_STAGGER_MS = 70;
export const ATTACK_TARGET_STAGGER_CAP_MS = 280;

export function attackTargetDelay(targetIndex: number): number {
  const targets = Math.max(0, Math.trunc(targetIndex));
  return Math.min(targets * ATTACK_TARGET_STAGGER_MS, ATTACK_TARGET_STAGGER_CAP_MS);
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
