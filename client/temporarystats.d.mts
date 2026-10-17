import type { TemporaryStatUpdate } from "../server/src/protocol/temporarystat.ts";
export interface TemporaryApplication extends TemporaryStatUpdate {
  expiresAt: number;
}
export interface TemporaryStats {
  clear(): void;
  apply(update: TemporaryStatUpdate, now: number): void;
  values(now: number): Partial<Record<string, number>>;
  icons(now: number): TemporaryApplication[];
}
export function temporaryStats(): TemporaryStats;
export function movementStats(
  worn?: { slot: number; stats?: Record<string, number> }[],
  temporary?: Partial<Record<string, number>>,
): { speedPercent: number; jumpPercent: number };
export const TEMPORARY_FIELDS: readonly string[];
export function drawTemporaryStats(
  ctx: unknown,
  image: unknown,
  applications: TemporaryApplication[],
): void;
