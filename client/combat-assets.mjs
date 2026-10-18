/** Browser resource policy, NOT native gameplay constants: 64 entries per family, 5s retry.
 * Pending requests are never evicted to make room. clear aborts them and late results cannot
 * revive cleared entries. Actor ownership / field epochs remain the caller's responsibility.
 */
export const COMBAT_ASSET_LIMIT = 64;
export const COMBAT_ASSET_RETRY_MS = 5000;
export function combatAssets({fetcher = globalThis.fetch, now = () => performance.now(), limit = COMBAT_ASSET_LIMIT, onAttack, onProjectile} = {}) {
  const attacks = new Map(), projectiles = new Map();
  const validAction = a => a && Number.isInteger(a.action) && typeof a.stance === 'string' &&
    a.delays?.length > 0 && a.delays.every(Number.isFinite) &&
    a.baseDelays?.length === a.delays.length && a.baseDelays.every(Number.isFinite) &&
    a.frameIndices?.length === a.delays.length && a.frameIndices.every(Number.isInteger);
  function get(entries, id, family, valid, onLoad) {
    let entry = entries.get(id);
    if (entry?.data) return Promise.resolve(entry.data);
    if (entry?.promise) return entry.promise;
    if (entry && now() < entry.retry) return Promise.resolve(undefined);
    if (!entry) {
      if (entries.size >= limit) {
        const victim = [...entries].find(([, value]) => !value.promise);
        if (!victim) return Promise.resolve(undefined);
        entries.delete(victim[0]);
      }
      entry = {}; entries.set(id, entry);
    }
    const owner = entry, controller = new AbortController();
    owner.controller = controller;
    owner.promise = Promise.resolve().then(() => fetcher(`/api/${family}/${id}`, {signal: controller.signal}))
      .then(async response => {
        if (!response.ok) throw new Error(`combat metadata ${response.status}`);
        const data = await response.json();
        if (!valid(data)) throw new Error('invalid combat metadata');
        if (entries.get(id) !== owner) return undefined;
        owner.data = data; onLoad?.(data);
        return data;
      }).catch(() => { owner.retry = now() + COMBAT_ASSET_RETRY_MS; return undefined; })
      .finally(() => { owner.promise = undefined; owner.controller = undefined; });
    return owner.promise;
  }
  return {
    peekAttack(id) { return attacks.get(id)?.data; },
    attack(id) {
      if (!Number.isInteger(id) || id < 1300000 || id >= 1500000) return Promise.resolve(undefined);
      return get(attacks, id, 'attack', p => p?.weaponId === id && Number.isInteger(p.speed) && p.speed >= 0 && p.speed <= 6 &&
        Array.isArray(p.melee) && Array.isArray(p.shoot) && [...p.melee, ...p.shoot].every(validAction) &&
        (!p.prone || (validAction(p.prone) && p.prone.action === 32 && p.prone.stance === 'proneStab')), onAttack);
    },
    projectile(id) {
      if (!Number.isInteger(id) || ![206, 207].includes(Math.trunc(id / 10000))) return Promise.resolve(undefined);
      return get(projectiles, id, 'projectile', frames => Array.isArray(frames) && frames.length > 0 &&
        frames.every(f => typeof f.path === 'string' && Number.isFinite(f.delay)), onProjectile);
    },
    clear() {
      for (const entries of [attacks, projectiles]) {
        for (const entry of entries.values()) entry.controller?.abort();
        entries.clear();
      }
    },
  };
}
