/** Native face clock: 408400/509070/509560/50B590. Pure presentation, never combat RNG/save.
 * The clock is carried by the visual actor, so spreading a self snapshot preserves it. Assets
 * are immutable face-keyed data; a late fetch never applies an emotion to an actor or old field.
 */
export const FACE_NAMES = ['blink','hit','smile','troubled','cry','angry','bewildered','stunned','vomit'];
const randomInt = (random, range) => Math.min(range - 1, Math.max(0, Math.floor(random() * range)));
export const faceIdleDelay = (random = Math.random) => 2000 + randomInt(random, 3000);
export const faceBlinkCount = (random = Math.random) => 1 + randomInt(random, 3);
export const faceDuration = (frames = []) => frames.reduce((n, f) => n + Math.max(1, f.delay), 0);
export function faceFrameAt(frames, elapsed) {
  if (!frames?.length) return 0;
  let at = Math.max(0, elapsed) % faceDuration(frames);
  for (const frame of frames) {
    const ms = Math.max(1, frame.delay);
    if (at < ms) return frame.index;
    at -= ms;
  }
  return frames[0].index;
}
export function resetFace(actor) { if (actor) { delete actor.faceClock; delete actor.emotion; } }
export function setFace(actor, value, now, duration = -1, stance = '') {
  if (!actor || !Number.isInteger(value) || value < 0 || value > 8 ||
      (value === 8 && ['prone','proneStab'].includes(stance))) return false;
  actor.emotion = { value, at: now, duration };
  return true;
}
export function facePose(actor, lookKey, profile, now, random = Math.random) {
  if (!actor) return { emotion: undefined, frame: 0 };
  let state = actor.faceClock;
  if (!state || state.lookKey !== lookKey) {
    if (state) delete actor.emotion; // 508260 SetAvatar resets the expression even if the face id stays.
    state = actor.faceClock = { lookKey, next: now + faceIdleDelay(random), blinking: undefined, seen: undefined };
  }
  const event = actor.emotion;
  if (event && state.seen !== event) {
    state.seen = event;
    state.blinking = undefined;
    if (event.value === 0) {
      delete actor.emotion;
      state.next = now + faceIdleDelay(random);
    }
  }
  if (actor.emotion) {
    const action = profile?.actions?.[FACE_NAMES[event.value]];
    const hold = event.duration >= 0 ? event.duration : action?.duration ?? 5000;
    if (now <= event.at + hold) return { emotion: FACE_NAMES[event.value], frame: faceFrameAt(action?.frames, now - event.at) };
    delete actor.emotion;
    state.next = now + faceIdleDelay(random);
  }
  const blink = profile?.actions?.blink?.frames;
  // Do not guess frame counts, or schedule an asset that isn't present in this face.
  if (!blink?.length) return { emotion: undefined, frame: 0 };
  if (state.blinking && now >= state.blinking.until) {
    state.blinking = undefined;
    state.next = now + faceIdleDelay(random);
  }
  if (!state.blinking && now > state.next) {
    const count = faceBlinkCount(random);
    state.blinking = { at: now, until: now + count * faceDuration(blink) };
  }
  return { emotion: state.blinking ? 'blink' : undefined,
    frame: state.blinking ? faceFrameAt(blink, now - state.blinking.at) : blink[0].index };
}

/** Bounded immutable metadata cache; missing/failed assets back off instead of retrying every RAF. */
export function faceProfiles({fetcher = globalThis.fetch, now = () => performance.now(), limit = 64} = {}) {
  const entries = new Map();
  function get(id) {
    if (!Number.isSafeInteger(id) || id < 0 || id > 99999999) return undefined;
    let entry = entries.get(id);
    if (entry && (entry.data || entry.promise || now() < entry.retry)) return entry;
    if (!entry) {
      if (entries.size >= limit) {
        const key = entries.keys().next().value;
        entries.get(key)?.controller?.abort(); entries.delete(key);
      }
      entry = {}; entries.set(id, entry);
    }
    const owner = entry;
    entry.controller = new AbortController();
    entry.promise = Promise.resolve().then(() => fetcher(`/api/face/${id}`, {signal: owner.controller.signal}))
      .then(async response => {
        if (!response.ok) throw new Error(`face ${response.status}`);
        const data = await response.json();
        if (data?.faceId !== id || !data.actions?.blink?.frames?.length) throw new Error('invalid face metadata');
        if (entries.get(id) === owner) owner.data = data;
        return data;
      }).catch(() => { owner.retry = now() + 5000; return undefined; })
      .finally(() => { owner.promise = undefined; owner.controller = undefined; });
    return entry;
  }
  return {get, clear() { for (const e of entries.values()) e.controller?.abort(); entries.clear(); }};
}

/** 495F70 ORs attr BEFORE consuming each fragment; 539900 returns it through 5398B0;
 * 520950 bit2 calls SetFace(hit,1500). Consume on a 30ms presentation clock, including short/zero
 * fragments crossed in one step. No new damage packet, no HP change, no trigger on path arrival.
 * This does not replace the existing browser's geometric interpolation / 100ms publication.
 */
export function movementFace(actor, now) {
  const motion = actor?.motion ?? actor?.faceMotion;
  if (!motion) return;
  actor.faceMotion = motion;
  const target = Math.floor(Math.max(0, now - motion.start) / 30);
  const after = motion.faceTick ?? -1;
  if (target <= after) return;
  let end = 0, latest = -1;
  for (const fragment of motion.elements) {
    const start = end; end += Math.max(0, fragment.duration);
    if (!(fragment.attr & 2)) continue;
    const tick = Math.min(target, Math.ceil(end / 30));
    if (tick >= Math.max(after + 1, Math.ceil(start / 30))) latest = Math.max(latest, tick);
  }
  motion.faceTick = target;
  if (latest >= 0) setFace(actor, 1, motion.start + latest * 30, 1500);
  if (target >= Math.ceil(end / 30)) delete actor.faceMotion;
}
