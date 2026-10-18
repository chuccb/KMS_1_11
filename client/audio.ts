export interface AudioDependencies {
  createContext?: () => AudioContext | undefined;
  fetch?: (
    url: string,
  ) => Promise<{ ok: boolean; status?: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  onError?: (error: unknown) => void;
}
import { nativeVolume, SOUND_DEFAULTS, soundSettings } from "./systemsettings.ts";
/** Original WZ audio over same-origin HTTP. No synthetic tones or external recordings.
 * A user gesture resumes Web Audio; the desired BGM survives autoplay blocking. Map changes are
 * generation-guarded so a slow previous decode cannot start the wrong field's music.
 */
export function soundPath(value: string | undefined) {
  if (!value) return undefined;
  if (value.startsWith("Sound/")) return value;
  const slash = value.indexOf("/");
  return slash > 0 ? `Sound/${value.slice(0, slash)}.img/${value.slice(slash + 1)}` : undefined;
}
export function createAudio(deps: AudioDependencies = {}) {
  const makeContext =
    deps.createContext ??
    (() => {
      const C =
        globalThis.AudioContext ??
        (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      return C ? new C() : undefined;
    });
  const fetcher = deps.fetch ?? ((url: string) => globalThis.fetch(url));
  const onError = deps.onError ?? (() => {});
  let context: AudioContext | undefined,
    musicGain: GainNode | undefined,
    effectGain: GainNode | undefined,
    musicSource: AudioBufferSourceNode | undefined,
    desired: string | undefined,
    generation = 0,
    unlocked = false;
  let muted = false,
    settings = { ...SOUND_DEFAULTS };
  let musicVolume = nativeVolume(settings.bgm),
    effectVolume = nativeVolume(settings.effects);
  let effectGeneration = 0;
  const buffers = new Map<string, AudioBuffer>(),
    pending = new Map<string, Promise<AudioBuffer>>(),
    active = new Set<AudioBufferSourceNode>();
  const failed = new Set<string>();
  function gains() {
    if (!context || !musicGain || !effectGain) return;
    musicGain.gain.value = muted ? 0 : musicVolume;
    effectGain.gain.value = muted ? 0 : effectVolume;
  }
  function stopMusic() {
    if (musicSource) {
      musicSource.stop();
      musicSource.disconnect();
      musicSource = undefined;
    }
  }
  async function buffer(path: string): Promise<AudioBuffer> {
    if (buffers.has(path)) return buffers.get(path)!;
    if (pending.has(path)) return pending.get(path)!;
    const decoder = context;
    if (!decoder) throw new Error("Audio context is not ready");
    const load = (async () => {
      const response = await fetcher(`/api/audio/${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(`sound ${path}: HTTP ${response.status}`);
      const decoded = await decoder.decodeAudioData(await response.arrayBuffer());
      buffers.set(path, decoded);
      // Bound decoded PCM, not just the small MP3 source sizes. Active sources retain their buffer.
      let bytes = [...buffers.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0);
      for (const [key, b] of buffers) {
        if (bytes <= 48 * 1024 * 1024) break;
        if (key !== desired && key !== path) {
          buffers.delete(key);
          bytes -= b.length * b.numberOfChannels * 4;
        }
      }
      return decoded;
    })();
    pending.set(path, load);
    try {
      return await load;
    } finally {
      pending.delete(path);
    }
  }
  function error(path: string, e: unknown) {
    if (!failed.has(path)) {
      failed.add(path);
      onError(e);
    }
  }
  async function startMusic(token: number) {
    if (!unlocked || !context || !musicGain || !desired) return;
    const path = desired;
    try {
      const decoded = await buffer(path);
      if (token !== generation || path !== desired) return;
      stopMusic();
      musicSource = context.createBufferSource();
      musicSource.buffer = decoded;
      musicSource.loop = true;
      musicSource.connect(musicGain);
      musicSource.start();
    } catch (e) {
      error(path, e);
    }
  }
  return {
    async unlock() {
      if (!context) {
        context = makeContext();
        if (!context) return;
        musicGain = context.createGain();
        musicGain.connect(context.destination);
        effectGain = context.createGain();
        effectGain.connect(context.destination);
        gains();
      }
      try {
        await context.resume();
        if (!unlocked) {
          unlocked = true;
          void startMusic(++generation);
        }
      } catch (e) {
        onError(e);
      }
    },
    setBgm(value: string | undefined) {
      const path = soundPath(value);
      if (path === desired) return;
      desired = path;
      stopMusic();
      const token = ++generation;
      if (path) void startMusic(token);
    },
    async preload(value: string | undefined) {
      const path = soundPath(value);
      if (!path || !unlocked || !context) return;
      try {
        await buffer(path);
      } catch (e) {
        error(path, e);
      }
    },
    async effect(
      value: string | undefined,
      volume = 1,
      options: { deadline?: number; valid?: () => boolean } = {},
    ) {
      if (!unlocked || !context || !effectGain || muted) return;
      const path = soundPath(value);
      if (!path) return;
      const valid = () =>
        (options.deadline === undefined || performance.now() < options.deadline) &&
        (!options.valid || options.valid());
      if (!valid()) return;
      const token = effectGeneration;
      try {
        const decoded = await buffer(path);
        if (muted || !unlocked || token !== effectGeneration || !valid()) return;
        // Limit overlapping one-shots, never restart/cut the BGM to play an effect.
        if (active.size >= 16) {
          const old = active.values().next().value!;
          old.stop();
          old.disconnect();
          active.delete(old);
        }
        const source = context.createBufferSource();
        source.buffer = decoded;
        const gain = volume === 1 ? undefined : context.createGain();
        if (gain) {
          gain.gain.value = Math.max(0, Math.min(1, volume));
          gain.connect(effectGain);
          source.connect(gain);
        } else source.connect(effectGain);
        active.add(source);
        source.onended = () => {
          active.delete(source);
          source.disconnect();
          gain?.disconnect?.();
        };
        source.start();
      } catch (e) {
        error(path, e);
      }
    },
    setVolumes(bgm: number, effects: number) {
      musicVolume = Math.max(0, Math.min(1, bgm));
      effectVolume = Math.max(0, Math.min(1, effects));
      gains();
    },
    applySettings(value: unknown) {
      settings = soundSettings(value);
      musicVolume = nativeVolume(settings.bgm, settings.bgmMuted);
      effectVolume = nativeVolume(settings.effects, settings.effectsMuted);
      gains();
    },
    get settings() {
      return { ...settings };
    },
    setMuted(value: boolean) {
      muted = Boolean(value);
      gains();
    },
    get muted() {
      return muted;
    },
    get bgm() {
      return desired;
    },
    stop() {
      desired = undefined;
      generation++;
      effectGeneration++;
      stopMusic();
      for (const source of active) {
        source.stop();
        source.disconnect();
      }
      active.clear();
    },
  };
}

/** sub_526CC0: 100% inside 250px, linear to 40% at 1000px, minimum 40% (not silence). */
export function spatialVolume(
  x: number,
  y: number,
  listener: { x: number; y: number } | undefined,
) {
  if (!listener) return 0.4;
  const distance = Math.sqrt((listener.x - x) ** 2 + (listener.y - y) ** 2 + 0.001);
  return distance < 250 ? 1 : distance > 1000 ? 0.4 : Math.trunc(120 - distance * 0.08) / 100;
}
