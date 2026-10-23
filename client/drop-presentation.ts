/** Reward motion uses ground/bottom anchors throughout, not WZ inventory origins.
 * 420ms/28px hop and 260ms/30px pickup are existing browser presentation policies, NOT measured
 * native physics. Kind 2 is immediately placed, as native sub_4A88A0's state 3 requires.
 */
import type { DropAppear } from "../server/src/protocol/drop.ts";
import { isRecord } from "./resource-validation.ts";

/** Wire values mirror `server/src/protocol/drop.ts`; keep them local to avoid a browser import of server code. */
const DROP_KIND = { transientFromMob: 0, fromMob: 1, placed: 2 } as const;
export const DROP_HOP_MS = 420;
export const DROP_HOP_HEIGHT = 28;
export const DROP_PICKUP_MS = 260;
export const DROP_PICKUP_HEIGHT = 30;
/** Native kind-0 fallback guard, relative to the packet's signed animation-start offset. */
export const DROP_TRANSIENT_CLEANUP_GUARD_MS = 3000;
export interface DropPoint {
  x: number;
  y: number;
}
export interface DropPose extends DropPoint {
  t: number;
  phase: "hop" | "rest" | "pickup";
}
export interface DropRecord {
  drop: DropAppear;
  born: number;
  fromX: number;
  fromY: number;
  takenAt?: number;
  takenBy?: number;
  pickupOrigin?: DropPoint;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
/** JSON is unknown at this boundary. Retain the native integer ranges and required monster block. */
export function parseDrop(value: unknown): DropAppear | undefined {
  if (
    !isRecord(value) ||
    !integer(value.kind, 0, 2) ||
    !integer(value.dropId, 0, 0xffffffff) ||
    typeof value.money !== "boolean" ||
    !integer(value.value, 0, 0xffffffff) ||
    !integer(value.x, -32768, 32767) ||
    !integer(value.y, -32768, 32767)
  )
    return;
  const drop: DropAppear = {
    kind: value.kind,
    dropId: value.dropId,
    money: value.money,
    value: value.value,
    x: value.x,
    y: value.y,
  };
  if (drop.kind <= DROP_KIND.fromMob) {
    if (
      !integer(value.mobId, 0, 0xffffffff) ||
      !integer(value.mobX, -32768, 32767) ||
      !integer(value.mobY, -32768, 32767) ||
      (value.animationStartOffset !== undefined &&
        !integer(value.animationStartOffset, -32768, 32767))
    )
      return;
    drop.mobId = value.mobId;
    drop.mobX = value.mobX;
    drop.mobY = value.mobY;
    if (typeof value.animationStartOffset === "number") {
      drop.animationStartOffset = value.animationStartOffset;
    }
  }
  return drop;
}
export type DropRemoval =
  | { dropId: number; reason: "gone" | "vanished" }
  | { dropId: number; reason: "taken"; characterId: number };
/** Match the bridge's 0x44 projection; malformed removal must not delete or animate an entry. */
export function parseDropRemoval(value: unknown): DropRemoval | undefined {
  if (!isRecord(value) || !integer(value.dropId, 0, 0xffffffff)) return;
  if (value.reason === "gone" || value.reason === "vanished")
    return { dropId: value.dropId, reason: value.reason };
  if (value.reason === "taken" && integer(value.characterId, 0, 0xffffffff))
    return { dropId: value.dropId, reason: "taken", characterId: value.characterId };
  return;
}
export function createDropRecord(
  value: unknown,
  born: number,
  source?: (mobId: number) => DropPoint | undefined,
): DropRecord | undefined {
  const drop = parseDrop(value);
  if (!drop) return;
  const mob = drop.mobId === undefined ? undefined : source?.(drop.mobId);
  return { drop, born, fromX: mob?.x ?? drop.mobX ?? drop.x, fromY: mob?.y ?? drop.mobY ?? drop.y };
}
const progress = (elapsed: number, duration: number) =>
  Math.max(0, Math.min(1, elapsed / duration));
export function dropPosition(
  record: DropRecord,
  now: number,
  taker?: DropPoint,
): DropPose | undefined {
  const drop = record.drop;
  if (record.takenAt !== undefined) {
    const t = progress(now - record.takenAt, DROP_PICKUP_MS);
    if (t >= 1) return;
    const from = record.pickupOrigin ?? drop;
    return {
      x: from.x + ((taker?.x ?? from.x) - from.x) * t,
      y: from.y + ((taker ? taker.y - DROP_PICKUP_HEIGHT : from.y) - from.y) * t,
      t,
      phase: "pickup",
    };
  }
  const animationElapsed = now - record.born - (drop.animationStartOffset ?? 0);
  if (
    drop.kind === DROP_KIND.transientFromMob &&
    animationElapsed > DROP_TRANSIENT_CLEANUP_GUARD_MS
  )
    return;
  const hasMonsterBlock = drop.kind <= DROP_KIND.fromMob;
  const t = hasMonsterBlock ? progress(animationElapsed, DROP_HOP_MS) : 1;
  if (t >= 1) {
    if (drop.kind === DROP_KIND.transientFromMob) return;
    return { x: drop.x, y: drop.y, t: 1, phase: "rest" };
  }
  return {
    x: record.fromX + (drop.x - record.fromX) * t,
    y: record.fromY + (drop.y - record.fromY) * t - DROP_HOP_HEIGHT * Math.sin(Math.PI * t),
    t,
    phase: "hop",
  };
}
/** Capture the current airborne point, so an early pickup cannot teleport to the final ground. */
/** True only on the first pool removal; callers must not replay self pickup sound for duplicates. */
export function beginDropPickup(record: DropRecord, now: number, characterId: number): boolean {
  if (record.takenAt !== undefined) return false;
  record.pickupOrigin = dropPosition(record, now) ?? record.drop;
  record.takenAt = now;
  record.takenBy = characterId;
  return true;
}
