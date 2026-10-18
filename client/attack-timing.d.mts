export const USER_UPDATE_MS: 30;
export interface AttackTiming { delays: readonly number[]; frameIndices?: readonly number[] }
export function scaledAttackDelays(delays: readonly number[], speed: number): number[];
export function attackFrameDuration(delay: number): number;
export function attackDuration(motion?: AttackTiming): number;
export function attackFrameStart(motion: AttackTiming, index: number): number;
export function attackFrame(motion: (AttackTiming & {start: number}) | undefined, now: number): number;
export function attackCanvasFrame(motion: AttackTiming | undefined, ordinal: number): number;
export function shotRelease(motion?: AttackTiming): number;
export function basicAttackAction<T extends {action: number}>(profile: {melee: T[]; shoot: T[]; prone?: T} | undefined, action: number, shoot?: boolean): T | undefined;
export function attackHitDelay(ordinal:number):number;
