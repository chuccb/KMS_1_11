import type { TimedCanvas } from "./animation.ts";
export interface DeathCanvas extends TimedCanvas {
  path: string;
  ox?: number;
  oy?: number;
}
export interface DeathArt {
  fall: DeathCanvas[];
  land: DeathCanvas[];
}
export interface DeathState {
  x: number;
  y: number;
  since: number;
  settled: boolean;
}
/** CUser::509AF0, Shape2D vtable+168 -> 10011E30/10012070, +152 -> 10011030.
 * The avatar orbits (-10,0) around the captured foot point +(0,-5), 2000ms/revolution;
 * both avatar layers fade 255->0 over 2500ms. Tomb falls 150px over the queued fall duration.
 * Native Tombstone sound is IMMEDIATE on a live transition (526CC0 returns volume, not delay).
 */
import { animationDuration, animationFrame } from "./animation.ts";

export const DEATH_ORBIT_MS: number = 2000,
  DEATH_FADE_MS: number = 2500;
const roundNative = (value: number) => Math.trunc(value + (value < 0 ? -0.499999999 : 0.5));

export function deathState(
  x: number,
  y: number,
  now: number,
  settled: boolean = false,
): DeathState {
  return { x: Math.trunc(x), y: Math.trunc(y), since: now, settled };
}

export function deathPose(state: DeathState, now: number): { x: number; y: number; alpha: number } {
  const elapsed = Math.max(0, now - state.since);
  const angle = ((elapsed % DEATH_ORBIT_MS) / DEATH_ORBIT_MS) * Math.PI * 2;
  return {
    x: state.x + roundNative(-10 * Math.cos(angle)),
    y: state.y - 5 + roundNative(-10 * Math.sin(angle)),
    alpha: state.settled ? 1 : Math.max(0, 1 - elapsed / DEATH_FADE_MS),
  };
}

export function tombPose(
  art: DeathArt | undefined,
  state: DeathState,
  now: number,
): { frame: DeathCanvas | undefined; x: number; y: number } | undefined {
  if (!art?.land?.length) return undefined;
  if (state.settled) return { frame: art.land.at(-1), x: state.x, y: state.y };
  if (!art.fall?.length) return undefined;
  const elapsed = Math.max(0, now - state.since),
    fallMs = animationDuration(art.fall);
  const frame =
    elapsed < fallMs
      ? animationFrame(art.fall, elapsed, false)
      : animationFrame(art.land, elapsed - fallMs, false);
  return { frame, x: state.x, y: state.y - 150 * Math.max(0, 1 - elapsed / fallMs) };
}

/** Session-owned visuals. No HP mutation; sound once per live transition, before art loads. */
export function deathEffects({
  image,
  log,
  sound,
  fetch: fetcher = globalThis.fetch,
}: {
  image(path: string): unknown;
  log(text: string): unknown;
  sound(point: { x: number; y: number }): unknown;
  fetch?(url: string): Promise<{ ok: boolean; status?: number; json(): Promise<DeathArt> }>;
}): {
  preload(): Promise<void>;
  reset(): void;
  remove(id: number): void;
  get(id: number): DeathState | undefined;
  observe(
    id: number,
    dead: boolean,
    point: { x: number; y: number } | undefined,
    now: number,
    settled?: boolean,
  ): void;
  tomb(
    id: number,
    now: number,
  ): { frame: DeathCanvas | undefined; x: number; y: number } | undefined;
} {
  let art: DeathArt | undefined, loading: Promise<void> | undefined;
  const states = new Map<number, DeathState>();

  function preload() {
    return (loading ??= fetcher("/api/death")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Death art: HTTP ${response.status}`);
        const loaded = await response.json();
        if (!loaded.fall?.length || !loaded.land?.length) {
          throw new Error("Death art has no fall/land sequence");
        }
        art = loaded;
        for (const frame of [...art.fall, ...art.land]) image(frame.path);
      })
      .catch((error) => {
        loading = undefined;
        log(String(error));
      }));
  }

  return {
    preload,
    reset() {
      states.clear();
    },
    remove(id) {
      states.delete(id);
    },
    get(id) {
      return states.get(id);
    },
    observe(id, dead, position, now, settled = false) {
      if (!dead) {
        states.delete(id);
        return;
      }
      if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        states.has(id)
      )
        return;
      states.set(id, deathState(position.x, position.y, now, settled));
      if (!settled) sound(position);
      void preload();
    },
    tomb(id, now) {
      const state = states.get(id);
      return state && tombPose(art, state, now);
    },
  };
}
