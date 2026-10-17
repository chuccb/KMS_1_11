export interface TimedCanvas { delay: number; a0?: number; a1?: number }
export function animationDuration(frames?: readonly TimedCanvas[]): number;
export function animationFrame<T extends TimedCanvas>(frames: readonly T[] | undefined, elapsed: number, loop?: boolean, initialAlpha?: number): (T & {alpha: number}) | undefined;
