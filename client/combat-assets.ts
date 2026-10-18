import type { BasicAttackProfile } from "../server/src/game/basicattack.ts";
import type { SpriteFrame } from "../server/src/game/sprites.ts";
import {
  isActiveSkillMetadata,
  isBasicAttackProfile,
  isSpriteFrames,
  type ActiveSkillMetadata,
} from "./combat-resource-validation.ts";

/** Browser resource policy, NOT native gameplay constants: 64 entries per family, 5s retry.
 * Pending requests are never evicted to make room. clear aborts them and late results cannot
 * revive cleared entries. Actor ownership / field epochs remain the caller's responsibility.
 */
export const COMBAT_ASSET_LIMIT = 64;
export const COMBAT_ASSET_RETRY_MS = 5000;
export interface ResourceResponse {
  ok: boolean;
  status?: number;
  json?(): Promise<unknown>;
}
interface CacheEntry<T> {
  data?: T;
  promise?: Promise<T | undefined>;
  retry?: number;
  controller?: AbortController;
}
interface CombatAssetOptions {
  fetcher?: (url: string, options: { signal: AbortSignal }) => Promise<ResourceResponse>;
  now?: () => number;
  limit?: number;
  onAttack?: (profile: BasicAttackProfile) => void;
  onProjectile?: (frames: SpriteFrame[]) => void;
}
export function combatAssets({
  fetcher = globalThis.fetch,
  now = () => performance.now(),
  limit = COMBAT_ASSET_LIMIT,
  onAttack,
  onProjectile,
}: CombatAssetOptions = {}) {
  const attacks = new Map<number, CacheEntry<BasicAttackProfile>>();
  const projectiles = new Map<number, CacheEntry<SpriteFrame[]>>();
  const skills = new Map<number, CacheEntry<ActiveSkillMetadata>>();

  function get<T>(
    entries: Map<number, CacheEntry<T>>,
    id: number,
    family: string,
    valid: (value: unknown) => value is T,
    onLoad?: (data: T) => void,
  ): Promise<T | undefined> {
    let entry = entries.get(id);
    if (entry?.data) return Promise.resolve(entry.data);
    if (entry?.promise) return entry.promise;
    if (entry?.retry !== undefined && now() < entry.retry) return Promise.resolve(undefined);
    if (!entry) {
      if (entries.size >= limit) {
        const victim = [...entries].find(([, value]) => !value.promise);
        if (!victim) return Promise.resolve(undefined);
        entries.delete(victim[0]);
      }
      entry = {};
      entries.set(id, entry);
    }
    const owner = entry,
      controller = new AbortController();
    owner.controller = controller;
    owner.promise = Promise.resolve()
      .then(() => fetcher(`/api/${family}/${id}`, { signal: controller.signal }))
      .then(async (response) => {
        if (!response.ok) throw new Error(`combat metadata ${response.status}`);
        const data: unknown = await response.json?.();
        if (!valid(data)) throw new Error("invalid combat metadata");
        if (entries.get(id) !== owner) return undefined;
        owner.data = data;
        onLoad?.(data);
        return data;
      })
      .catch(() => {
        owner.retry = now() + COMBAT_ASSET_RETRY_MS;
        return undefined;
      })
      .finally(() => {
        owner.promise = undefined;
        owner.controller = undefined;
      });
    return owner.promise;
  }
  return {
    peekSkill(id: number) {
      return skills.get(id)?.data;
    },
    skill(id: number) {
      if (!Number.isInteger(id) || id < 1000000 || id > 4999999) return Promise.resolve(undefined);
      return get(
        skills,
        id,
        "active-skill",
        (value): value is ActiveSkillMetadata => isActiveSkillMetadata(value) && value.id === id,
      );
    },
    peekAttack(id: number) {
      return attacks.get(id)?.data;
    },
    attack(id: number) {
      if (!Number.isInteger(id) || id < 1300000 || id >= 1500000) return Promise.resolve(undefined);
      return get(
        attacks,
        id,
        "attack",
        (value): value is BasicAttackProfile =>
          isBasicAttackProfile(value) && value.weaponId === id,
        onAttack,
      );
    },
    projectile(id: number) {
      if (!Number.isInteger(id) || ![206, 207].includes(Math.trunc(id / 10000)))
        return Promise.resolve(undefined);
      return get(
        projectiles,
        id,
        "projectile",
        (value): value is SpriteFrame[] => isSpriteFrames(value) && value.length > 0,
        onProjectile,
      );
    },
    clear() {
      for (const entries of [attacks, projectiles, skills]) {
        for (const entry of entries.values()) entry.controller?.abort();
        entries.clear();
      }
    },
  };
}
