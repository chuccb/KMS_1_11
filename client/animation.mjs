/** Native canvas sequence: duration, a0/a1 and retained layer alpha (46A9F0 / Gr2D 10015290).
 * An omitted/-1 endpoint keeps the current alpha; it is not an automatic fade to opaque.
 * Pure presentation: never consumes a gameplay RNG or changes a character.
 */
const duration = frame => Number.isFinite(frame.delay) && frame.delay > 0 ? frame.delay : 1;
const endpoint = value => Number.isFinite(value) && value >= 0 ? Math.min(255, value) : undefined;

export function animationDuration(frames = []) {
  return frames.reduce((sum, frame) => sum + duration(frame), 0);
}

export function animationFrame(frames, elapsed, loop = true, initialAlpha = 255) {
  if (!frames?.length) return undefined;
  const total = animationDuration(frames);
  let at = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  let alpha = endpoint(initialAlpha) ?? 255;
  // The second loop starts with the previous loop's terminal alpha. One scan suffices:
  // either an explicit endpoint determines the final value, or the sequence preserves it.
  if (loop && at >= total) {
    for (const frame of frames) {
      alpha = endpoint(frame.a1) ?? endpoint(frame.a0) ?? alpha;
    }
  }
  at = loop ? at % total : Math.min(at, total);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i], ms = duration(frame);
    const start = endpoint(frame.a0) ?? alpha, end = endpoint(frame.a1) ?? start;
    if (at < ms || i === frames.length - 1) {
      return { ...frame, alpha: (start + (end - start) * Math.min(1, at / ms)) / 255 };
    }
    at -= ms;
    alpha = end;
  }
}
