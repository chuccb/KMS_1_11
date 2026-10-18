/** Bounded manual keyboard scenarios and correlated evidence, not a second game implementation. */
import { isRecord } from "../../client/resource-validation.ts";
import type { ProbePacket, ProbeInventory } from "./browser-observation.ts";
export const PLAY_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Alt",
  "Control",
] as const;
export type PlayKey = (typeof PLAY_KEYS)[number];
export const PLAY_EVENTS = [
  "field",
  "hit",
  "mob-die",
  "drop-enter",
  "drop-leave",
  "loot",
  "inventory",
  "self",
] as const;
export type PlayEvent = (typeof PLAY_EVENTS)[number];
export type PlayStep =
  | { kind: "hold"; keys: PlayKey[]; durationMs: number }
  | { kind: "await"; event: PlayEvent; timeoutMs: number };
export interface PlayPlan {
  combatMapId: number;
  targetTemplateId: number;
  reward: { money: boolean; value: number };
  steps: PlayStep[];
}
function uint(value: unknown, max = 0xffffffff): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}
function boundedTime(value: unknown): value is number {
  return uint(value, 30000) && value > 0;
}
export function readPlayPlan(value: unknown): PlayPlan {
  if (
    !isRecord(value) ||
    !uint(value.combatMapId) ||
    !uint(value.targetTemplateId) ||
    !isRecord(value.reward) ||
    typeof value.reward.money !== "boolean" ||
    !uint(value.reward.value) ||
    value.reward.value === 0 ||
    !Array.isArray(value.steps) ||
    !value.steps.length ||
    value.steps.length > 128
  )
    throw new Error("Invalid play plan metadata/reward/steps");
  let budget = 0;
  const steps = value.steps.map((step: unknown): PlayStep => {
    if (!isRecord(step)) throw new Error("Invalid play step");
    if (
      step.kind === "hold" &&
      Array.isArray(step.keys) &&
      step.keys.length > 0 &&
      step.keys.length <= 3 &&
      boundedTime(step.durationMs) &&
      step.durationMs <= 10000
    ) {
      const keys = step.keys.map((key: unknown) => {
        const found = PLAY_KEYS.find((k) => k === key);
        if (!found) throw new Error("Unsupported play key");
        return found;
      });
      if (
        new Set(keys).size !== keys.length ||
        (keys.includes("ArrowLeft") && keys.includes("ArrowRight")) ||
        (keys.includes("ArrowUp") && keys.includes("ArrowDown"))
      )
        throw new Error("Duplicate/contradictory play keys");
      budget += step.durationMs;
      return { kind: step.kind, keys, durationMs: step.durationMs };
    }
    if (step.kind === "await" && boundedTime(step.timeoutMs)) {
      const event = PLAY_EVENTS.find((event) => event === step.event);
      if (!event) throw new Error("Unsupported awaited play event");
      budget += step.timeoutMs;
      return { kind: step.kind, event, timeoutMs: step.timeoutMs };
    }
    throw new Error("Invalid play step shape/timing");
  });
  // Diagnostic work limits only; these do not change any gameplay or native tick constants.
  if (budget > 120000) throw new Error("Play plan exceeds the 120000ms diagnostic budget");
  return {
    combatMapId: value.combatMapId,
    targetTemplateId: value.targetTemplateId,
    reward: { money: value.reward.money, value: value.reward.value },
    steps,
  };
}
function itemCount(inventory: ProbeInventory, id: number) {
  return inventory.tabs.reduce(
    (count, tab) =>
      count +
      tab.items.reduce((sum, item) => sum + (item.itemId === id ? (item.quantity ?? 1) : 0), 0),
    0,
  );
}
/** Must remain within one field epoch; notices have no drop id, so correlate by order/value/self. */
export function playCycle(
  packets: readonly ProbePacket[],
  plan: PlayPlan,
  characterId: number,
  after: number,
) {
  let previous = 0;
  for (const packet of packets) {
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence <= previous)
      throw new Error("Probe packets must have strictly increasing local sequence");
    previous = packet.sequence;
  }
  let mapId: number | undefined,
    epochStart = 0;
  const mobs = new Map<number, number>();
  for (const packet of packets) {
    if (packet.t === "field") {
      mapId = packet.characterId === characterId ? packet.mapId : undefined;
      epochStart = packet.sequence;
      mobs.clear();
    }
    if (packet.t === "mob-enter") mobs.set(packet.mob.mobId, packet.mob.templateId);
    if (
      packet.t !== "drop-enter" ||
      packet.sequence <= after ||
      mapId !== plan.combatMapId ||
      packet.drop.mobId === undefined ||
      mobs.get(packet.drop.mobId) !== plan.targetTemplateId ||
      packet.drop.money !== plan.reward.money ||
      packet.drop.value !== plan.reward.value
    )
      continue;
    const drop = packet.drop,
      mobId = drop.mobId;
    const epoch = packets.filter((p) => p.sequence >= epochStart && p.sequence < packet.sequence);
    const hit = epoch.find(
      (p) => p.t === "hit" && p.mobId === mobId && p.damage > 0 && p.sequence > after,
    );
    if (!hit) continue;
    const death = epoch.find(
      (p) => p.t === "mob-die" && p.mobId === mobId && p.sequence > hit.sequence,
    );
    if (!death) continue;
    const tail: ProbePacket[] = [];
    for (const later of packets) {
      if (later.sequence <= packet.sequence) continue;
      if (later.t === "field") break;
      tail.push(later);
    }
    const taken = tail.find(
      (p) =>
        p.t === "drop-leave" &&
        p.dropId === drop.dropId &&
        p.reason === "taken" &&
        p.characterId === characterId,
    );
    if (!taken) continue;
    const notice = tail.find(
      (p) =>
        p.sequence > taken.sequence &&
        p.t === "loot" &&
        (drop.money
          ? p.notice.kind === "mesos" && p.notice.amount === drop.value
          : p.notice.kind === "item" && p.notice.itemId === drop.value && p.notice.count > 0),
    );
    if (notice?.t !== "loot") continue;
    let update: ProbePacket | undefined;
    if (notice.notice.kind === "item") {
      const baseline = packets.findLast(
        (p) => p.sequence < taken.sequence && p.sequence >= epochStart && p.t === "inventory",
      );
      const before =
        baseline?.t === "inventory" ? itemCount(baseline.inventory, drop.value) : undefined;
      const count = notice.notice.count;
      update = tail.find(
        (p) =>
          p.sequence > taken.sequence &&
          p.t === "inventory" &&
          before !== undefined &&
          itemCount(p.inventory, drop.value) >= before + count,
      );
    } else if (notice.notice.kind === "mesos") {
      const baseline = packets.findLast(
        (p) =>
          p.sequence < taken.sequence &&
          p.sequence >= epochStart &&
          (p.t === "self" || p.t === "field") &&
          p.self.mesos !== undefined,
      );
      const before =
        baseline?.t === "self" || baseline?.t === "field" ? baseline.self.mesos : undefined;
      const amount = notice.notice.amount;
      update = tail.find(
        (p) =>
          p.sequence > taken.sequence &&
          p.t === "self" &&
          before !== undefined &&
          (p.self.mesos ?? -1) >= before + amount,
      );
    }
    if (update)
      return {
        mapId,
        mobId,
        dropId: drop.dropId,
        reward: plan.reward,
        hit: hit.sequence,
        death: death.sequence,
        drop: packet.sequence,
        taken: taken.sequence,
        notice: notice.sequence,
        update: update.sequence,
      };
  }
  return undefined;
}
