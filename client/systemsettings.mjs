/** CConfig + CUISysOpt: 43D630/43DEB0, 52D800/52DE80/52DF20.
 * Original sliders store 0..19. Zero is 5%, NOT mute; the two mute flags are independent.
 */
export const SOUND_DEFAULTS = Object.freeze({ bgm: 15, effects: 15, bgmMuted: false, effectsMuted: false });
export function soundSettings(value) {
  const step = (v) => Number.isInteger(v) ? Math.max(0, Math.min(19, v)) : 15;
  return { bgm: step(value?.bgm), effects: step(value?.effects),
    bgmMuted: value?.bgmMuted === true, effectsMuted: value?.effectsMuted === true };
}
export function nativeVolume(step, muted = false) {
  return muted ? 0 : Math.trunc(100 * (soundSettings({bgm: step}).bgm + 1) / 20) / 100;
}
/** 457280/457240: integer thumb centers, nearest center, ties choose lower index. */
export function sliderCenter(step, width = 122, count = 20) {
  return count > 1 ? Math.trunc(step * (width - 27) / (count - 1)) + 13 : 0;
}
export function sliderStep(x, width = 122, count = 20) {
  let best = 0, distance = Infinity;
  for (let i = 0; i < count; i++) {
    const d = Math.abs(sliderCenter(i, width, count) - x);
    if (d < distance) { best = i; distance = d; }
  }
  return best;
}
/** Local machine settings, unlike character-scoped item bindings. Corrupt/blocked storage is safe. */
export function soundProfile(storage) {
  const key = 'kms111.soundSettings';
  let value;
  try { value = JSON.parse(storage?.getItem(key) ?? 'null'); } catch {}
  let saved = soundSettings(value);
  return {
    values: () => ({...saved}),
    save(value) {
      saved = soundSettings(value);
      try { storage?.setItem(key, JSON.stringify(saved)); } catch {}
      return {...saved};
    },
  };
}
