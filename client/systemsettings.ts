export interface SoundSettings {
  bgm: number;
  effects: number;
  bgmMuted: boolean;
  effectsMuted: boolean;
}
/** CConfig + CUISysOpt: 43D630/43DEB0, 52D800/52DE80/52DF20.
 * Original sliders store 0..19. Zero is 5%, NOT mute; the two mute flags are independent.
 */
export const SOUND_DEFAULTS: Readonly<SoundSettings> = Object.freeze({
  bgm: 15,
  effects: 15,
  bgmMuted: false,
  effectsMuted: false,
});
export function soundSettings(value: unknown): SoundSettings {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const step = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) ? Math.max(0, Math.min(19, v)) : 15;
  return {
    bgm: step(input.bgm),
    effects: step(input.effects),
    bgmMuted: input.bgmMuted === true,
    effectsMuted: input.effectsMuted === true,
  };
}
export function nativeVolume(step: number, muted: boolean = false): number {
  return muted ? 0 : Math.trunc((100 * (soundSettings({ bgm: step }).bgm + 1)) / 20) / 100;
}
/** 457280/457240: integer thumb centers, nearest center, ties choose lower index. */
export function sliderCenter(step: number, width: number = 122, count: number = 20): number {
  return count > 1 ? Math.trunc((step * (width - 27)) / (count - 1)) + 13 : 0;
}
export function sliderStep(x: number, width: number = 122, count: number = 20): number {
  let best = 0,
    distance = Infinity;
  for (let i = 0; i < count; i++) {
    const d = Math.abs(sliderCenter(i, width, count) - x);
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}
/** Local machine settings, unlike character-scoped item bindings. Corrupt/blocked storage is safe. */
export function soundProfile(
  storage:
    { getItem(key: string): string | null; setItem(key: string, value: string): void } | undefined,
): {
  values(): SoundSettings;
  save(value: unknown): SoundSettings;
} {
  const key = "kms111.soundSettings";
  let value: unknown;
  try {
    value = JSON.parse(storage?.getItem(key) ?? "null");
  } catch {}
  let saved = soundSettings(value);
  return {
    values: () => ({ ...saved }),
    save(value) {
      saved = soundSettings(value);
      try {
        storage?.setItem(key, JSON.stringify(saved));
      } catch {}
      return { ...saved };
    },
  };
}
