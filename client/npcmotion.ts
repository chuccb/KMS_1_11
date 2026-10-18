import type { NpcBehavior } from "../server/src/game/sprites.ts";
export interface NpcFrame {
  path: string;
  delay: number;
  height?: number;
  ox?: number;
  oy?: number;
  a0?: number;
  a1?: number;
}
interface NpcIdle {
  npcId: number;
  action: number;
  speech: number;
}
interface TimedNpcIdle extends NpcIdle {
  at: number;
}
interface IdleChoice {
  action: number;
  speech: number;
}
interface NpcRecord {
  npcId: number;
  templateId: number;
  controlled: boolean;
  tickAt: number;
  idle: number;
  inflight: boolean;
  baseSince: number;
  baseName: string;
  baseFacing: number;
  speechUntil: number;
  pending: TimedNpcIdle[];
  forced?: { name: string; since: number; duration: number; flip: boolean };
  lastReply?: IdleChoice;
  lastRequest?: IdleChoice;
  chatOriginY?: number;
}
interface NpcPresentationOptions {
  seed?: number;
  send(value: NpcIdle): boolean | void;
  balloons: {
    clear(): void;
    remove(id: number): void;
    put(
      id: number,
      text: string,
      at: number,
      options: { color: string; preserveWhitespace: boolean },
    ): void;
  };
}
import { animationFrame } from "./animation.ts";
import {
  npcRandom,
  npcIdleDelay,
  chooseNpcIdle,
  receiveNpcIdle,
  npcFrameDelay,
  npcActionDuration,
  npcMovementPose,
} from "./npcbehavior.ts";

/** CNpc presentation/controller, separate from users, combat RNG, dialogue and persistence.
 * Authority lives on the server: only a designated controller proposes; EVERY client (sender too)
 * renders the 0x3D acknowledgement. The original receiver's +2 discrepancy is preserved literally.
 * This does not implement CVecCtrlNpc walking/pathfinding. Movable NPC requests remain disabled in
 * this browser until its 5398B0 / 49A3C0 path is established; native clients retain their own vecctrl.
 */
export function npcPresentation({ send, balloons, seed }: NpcPresentationOptions) {
  const records = new Map<number, NpcRecord>(),
    art = new Map<number, { actions: Record<string, NpcFrame[]>; behavior: NpcBehavior }>(),
    rand = npcRandom(seed);
  function settle(r: NpcRecord, now: number) {
    if (r.forced && now >= r.forced.since + r.forced.duration) {
      r.baseSince = r.forced.since + r.forced.duration;
      r.forced = undefined;
    }
  }
  function accept(r: NpcRecord, value: TimedNpcIdle, now: number) {
    const data = art.get(r.templateId);
    if (!data) {
      r.pending.push(value);
      if (r.pending.length > 16) r.pending.shift();
      return;
    }
    settle(r, value.at);
    r.inflight = false;
    r.lastReply = { action: value.action, speech: value.speech };
    const result = receiveNpcIdle(data.behavior, value.action, value.speech);
    if (result.name !== undefined) {
      const frames = data.actions[result.name];
      if (frames?.length)
        r.forced = {
          name: result.name,
          since: value.at,
          duration: npcActionDuration(frames),
          flip: r.baseFacing === 0,
        };
    }
    if (result.text !== undefined && value.at + 5000 > now) {
      r.speechUntil = value.at + 5000;
      const name = r.forced?.name ?? r.baseName;
      // 433F50/4373A0: canvas0 of the CURRENT shifted layer, not always animation frame0.
      r.chatOriginY = animationFrame(
        data.actions[name],
        value.at - (r.forced?.since ?? r.baseSince),
      )?.height;
      balloons.put(r.npcId, result.text, value.at, { color: "#800000", preserveWhitespace: true });
    }
    settle(r, now);
  }
  const api = {
    clear() {
      records.clear();
      art.clear();
      balloons.clear();
    },
    add(
      npc: {
        npcId: number;
        templateId: number;
        action?: number;
        facing?: number;
        controlled?: boolean;
      },
      now: number,
    ): void {
      api.remove(npc.npcId);
      const r: NpcRecord = {
        npcId: npc.npcId,
        templateId: npc.templateId,
        controlled: false,
        tickAt: now,
        idle: 0,
        inflight: false,
        baseSince: now,
        baseName: npcMovementPose(npc.action ?? npc.facing ?? 0).name,
        baseFacing: (npc.action ?? npc.facing ?? 0) & 1,
        speechUntil: 0,
        pending: [],
      };
      records.set(npc.npcId, r);
      api.controller(npc.npcId, npc.controlled === true, now);
    },
    remove(id: number) {
      records.delete(id);
      balloons.remove(id);
    },
    controller(id: number, on: boolean, now: number) {
      const r = records.get(id);
      if (!r || r.controlled === on) return;
      r.controlled = on;
      r.inflight = false;
      r.tickAt = now;
      if (on) r.idle = npcIdleDelay(rand); // 499760; not 'start walking'.
    },
    load(
      templateId: number,
      actions: Record<string, NpcFrame[]>,
      behavior: NpcBehavior | undefined,
      now: number,
    ) {
      if (!behavior) return;
      const quantized = Object.fromEntries(
        Object.entries(actions).map(([name, frames]) => [
          name,
          frames.map((frame) => ({ ...frame, delay: npcFrameDelay(frame) })),
        ]),
      );
      art.set(templateId, { actions: quantized, behavior });
      for (const r of records.values())
        if (r.templateId === templateId) {
          const pending = r.pending.splice(0);
          for (const value of pending) accept(r, value, now);
        }
    },
    receive(value: NpcIdle, now: number) {
      const r = records.get(value.npcId);
      if (r) accept(r, { ...value, at: now }, now);
    },
    tick(now: number) {
      for (const r of records.values()) {
        settle(r, now);
        const elapsed = Math.max(0, Math.floor((now - r.tickAt) / 30) * 30);
        r.tickAt += elapsed;
        if (!r.controlled) continue;
        r.idle -= elapsed;
        const data = art.get(r.templateId);
        if (
          !data ||
          data.behavior.movable ||
          r.idle > 0 ||
          r.inflight ||
          r.forced ||
          now < r.speechUntil
        )
          continue;
        // Native resets the timer before drawing the next slot, using the same presentation rand.
        r.idle = npcIdleDelay(rand);
        const value = chooseNpcIdle(data.behavior, rand);
        if (value && send({ npcId: r.npcId, ...value }) !== false) {
          r.inflight = true;
          r.lastRequest = { ...value };
        }
      }
    },
    locomotion(id: number, action: number, now: number) {
      const r = records.get(id);
      if (!r) return;
      const { name, facing } = npcMovementPose(action); // 4998D0 resets base art on direction-only changes too.
      if (r.baseName !== name || r.baseFacing !== facing) {
        r.baseName = name;
        r.baseSince = now;
      }
      r.baseFacing = facing;
    },
    frame(id: number, now: number) {
      const r = records.get(id);
      if (!r) return undefined;
      settle(r, now);
      const data = art.get(r.templateId);
      if (!data) return undefined;
      return animationFrame(
        data.actions[r.forced?.name ?? r.baseName],
        now - (r.forced?.since ?? r.baseSince),
      );
    },
    snapshot(id: number, now: number) {
      const r = records.get(id);
      if (!r) return undefined;
      settle(r, now);
      return {
        controlled: r.controlled,
        waiting: r.inflight,
        action: r.forced?.name ?? r.baseName,
        facing: r.baseFacing,
        flip: r.forced?.flip ?? r.baseFacing === 0,
        idleMs: Math.max(0, r.idle),
        speaking: r.speechUntil > now,
        metadata: art.has(r.templateId),
        ...(r.lastReply ? { reply: { ...r.lastReply } } : {}),
        ...(r.lastRequest ? { request: { ...r.lastRequest } } : {}),
      };
    },
    flip(id: number, now: number) {
      const r = records.get(id);
      if (r && Number.isFinite(now)) settle(r, now);
      return r ? (r.forced?.flip ?? r.baseFacing === 0) : undefined;
    },
    speaking(id: number, now: number) {
      return (records.get(id)?.speechUntil ?? 0) > now;
    },
    originY(id: number) {
      return records.get(id)?.chatOriginY;
    },
  };
  return api;
}
