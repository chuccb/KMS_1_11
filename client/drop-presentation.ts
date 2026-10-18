/** Reward motion uses ground/bottom anchors throughout, not WZ inventory origins.
 * 420ms/28px hop and 260ms/30px pickup are existing browser presentation policies, NOT measured
 * native physics. Kind 2 is immediately placed, as native sub_4A88A0's state 3 requires.
 */
import type { DropAppear } from "../server/src/protocol/drop.ts";
import { isRecord } from "./resource-validation.ts";
export const DROP_HOP_MS = 420;
export const DROP_HOP_HEIGHT = 28;
export const DROP_PICKUP_MS = 260;
export const DROP_PICKUP_HEIGHT = 30;
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
  if (drop.kind <= 1) {
    if (
      !integer(value.mobId, 0, 0xffffffff) ||
      !integer(value.mobX, -32768, 32767) ||
      !integer(value.mobY, -32768, 32767) ||
      (value.unknown !== undefined && !integer(value.unknown, -32768, 32767))
    )
      return;
    drop.mobId = value.mobId;
    drop.mobX = value.mobX;
    drop.mobY = value.mobY;
    if (typeof value.unknown === "number") drop.unknown = value.unknown;
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
  const t = drop.kind > 1 ? 1 : progress(now - record.born, DROP_HOP_MS);
  if (t >= 1) return { x: drop.x, y: drop.y, t: 1, phase: "rest" };
  return {
    x: record.fromX + (drop.x - record.fromX) * t,
    y: record.fromY + (drop.y - record.fromY) * t - DROP_HOP_HEIGHT * Math.sin(Math.PI * t),
    t,
    phase: "hop",
  };
}
/** Capture the current airborne point, so an early pickup cannot teleport to the final ground. */
export function beginDropPickup(record: DropRecord, now: number, characterId: number): void {
  if (record.takenAt !== undefined) return;
  record.pickupOrigin = dropPosition(record, now) ?? record.drop;
  record.takenAt = now;
  record.takenBy = characterId;
}
