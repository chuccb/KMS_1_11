/** 508700/50B590, UI 425620/424740. Body presentation only, not CVecCtrl geometry.
 * One 30ms countdown step, DISCARD the overshoot, then reload the new frame's own WZ delay.
 * The native ordinary-action caller passes speed3: NOT scaled by weapon attackSpeed or walk speed.
 */
export function avatarStance(stance, profile) {
  return stance === 'walk1' ? profile?.walk ?? stance : stance === 'stand1' ? profile?.stand ?? stance : stance;
}
export function resetAvatarMotion(actor) { if (actor) delete actor.animation; }
export function animationPose(actor, stance, moving, now, {profile, key = '', y = actor?.y, facing = actor?.facing ?? 0} = {}) {
  const frames = profile?.actions?.[stance]?.frames;
  if (!actor || !frames?.length) {
    resetAvatarMotion(actor);
    return {stance, frame: 0}; // Cold metadata: no invented loop/delays or stale prior stance clock.
  }
  let state = actor.animation;
  if (!state || state.stance !== stance || state.key !== key || state.facing !== facing || state.frames !== frames) {
    state = actor.animation = {stance, key, facing, frames, index:0, remaining:frames[0].delay,
      last:now, accumulator:0, y};
  }
  const elapsed = Math.max(0, now - state.last);
  state.last = now;
  // Browser lifecycle policy: don't replay seconds of invisible input on tab resume.
  state.accumulator += Math.min(250, elapsed);
  const climbing = stance === 'rope' || stance === 'ladder';
  const changedY = Number.isFinite(y) && Number.isFinite(state.y) ? Math.trunc(y) !== Math.trunc(state.y) : moving;
  let ticks = 0;
  while (state.accumulator >= 30) {
    state.accumulator -= 30; ticks++;
    state.remaining -= 30;
    if (state.remaining > 0) continue;
    // Native compares previous/current integer Y, not stale network vy or held input.
    if (climbing && !changedY) { state.remaining = 0; continue; }
    state.index = (state.index + 1) % frames.length;
    state.remaining = frames[state.index].delay;
  }
  if (ticks) state.y = y;
  return {stance, frame:frames[state.index].index};
}

/** Archive metadata only. Bounded deduplication, retry/backoff, settled eviction and abort on clear.
 * A late promise can populate only its own entry; it never captures or mutates a visual actor.
 */
export function avatarMotionProfiles({fetcher = globalThis.fetch, now = () => performance.now(), limit = 64} = {}) {
  const entries = new Map();
  function get(id) {
    if (!Number.isInteger(id) || (id !== 0 && (id < 1300000 || id >= 1500000))) return undefined;
    let entry = entries.get(id);
    if (entry && (entry.data || entry.promise || now() < entry.retry)) return entry;
    if (!entry) {
      if (entries.size >= limit) {
        // Do not starve a crowded field by aborting every request each RAF. Pending entries keep
        // their seat; another id can try next frame once any seat settles. Actors retain data.
        const victim = [...entries].find(([,value]) => !value.promise);
        if (!victim) return undefined;
        victim[1].controller?.abort(); entries.delete(victim[0]);
      }
      entry = {}; entries.set(id, entry);
    }
    const owner = entry, controller = new AbortController();
    entry.controller = controller;
    entry.promise = Promise.resolve().then(() => fetcher(`/api/avatar-motion/${id}`, {signal:controller.signal}))
      .then(async response => {
        if (!response.ok) throw new Error(`avatar motion ${response.status}`);
        const data = await response.json();
        if (data?.weaponId !== id || !['walk1','walk2'].includes(data.walk) || !['stand1','stand2'].includes(data.stand) ||
            !data.actions?.[data.walk]?.frames?.length || !data.actions?.[data.stand]?.frames?.length)
          throw new Error('invalid avatar motion metadata');
        if (entries.get(id) === owner) owner.data = data;
        return data;
      }).catch(() => { owner.retry = now() + 5000; return undefined; })
      .finally(() => { owner.promise=undefined; owner.controller=undefined; });
    return entry;
  }
  return {get,clear() { for (const entry of entries.values()) entry.controller?.abort(); entries.clear(); }};
}
