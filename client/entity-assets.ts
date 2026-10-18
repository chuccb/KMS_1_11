/** NPC/mob metadata boundary and field-scoped resource ownership, independent of game authority. */
import type { MobArt, NpcArt, SpriteFrame } from "../server/src/game/sprites.ts";
import { isMobMetadata } from "./combat-resource-validation.ts";
import { isNpcMetadata } from "./entity-resource-validation.ts";
import { nativeMobActions } from "./mob-reaction.ts";

export type EntityKind = "npc" | "mob";
interface EntityResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
interface EntityAssetOptions {
  generation(): number;
  image(path: string): unknown;
  onNpc(data: NpcArt): void;
  onError?(kind: EntityKind, templateId: number, error: unknown): void;
  fetch?(path: string, options: { signal: AbortSignal }): Promise<EntityResponse>;
}
interface RequestOwner {
  generation: number;
  controller: AbortController;
  promise: Promise<void>;
}
/** Failures are negative-cached until clear/field change, preserving the previous browser policy.
 * No fabricated actions, bounds, hits or movement. Missing metadata never enables contact damage.
 * Clear aborts requests AND invalidates identity even if a test/peer ignores AbortSignal.
 */
export function entityAssets({
  generation,
  image,
  onNpc,
  onError = () => {},
  fetch: fetcher = (path, options) => globalThis.fetch(path, options),
}: EntityAssetOptions) {
  const npcActions = new Map<number, Record<string, SpriteFrame[]> | undefined>();
  const mobActions = new Map<
    number,
    ReturnType<typeof nativeMobActions<SpriteFrame>> | undefined
  >();
  const npcMetadata = new Map<number, Pick<NpcArt, "name" | "clickBounds" | "behavior">>();
  const mobMetadata = new Map<number, Required<Pick<MobArt, "attacks" | "maxMP">>>();
  const bodyAttack = new Map<number, boolean>(),
    pushed = new Map<number, number>();
  const missing = new Set<string>(),
    requests = new Map<string, RequestOwner>();
  function current(key: string, owner: RequestOwner) {
    return requests.get(key) === owner && owner.generation === generation();
  }
  function preload(actions: Record<string, SpriteFrame[]>) {
    for (const frames of Object.values(actions)) for (const frame of frames) image(frame.path);
  }
  function load(kind: EntityKind, templateId: number): Promise<void> {
    if (!Number.isSafeInteger(templateId) || templateId < 0) return Promise.resolve();
    const key = `${kind}:${templateId}`,
      table = kind === "npc" ? npcActions : mobActions;
    const pending = requests.get(key);
    if (pending && pending.generation === generation()) return pending.promise;
    if (table.has(templateId) || missing.has(key)) return Promise.resolve();
    table.set(templateId, undefined);
    const owner: RequestOwner = {
      generation: generation(),
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    requests.set(key, owner);
    owner.promise = Promise.resolve()
      .then(async () => {
        if (!current(key, owner)) return;
        const response = await fetcher(`/api/${kind}/${templateId}`, {
          signal: owner.controller.signal,
        });
        if (!current(key, owner)) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: unknown = await response.json();
        if (!current(key, owner)) return;
        if (kind === "mob") {
          if (!isMobMetadata(data) || data.templateId !== templateId)
            throw new Error("Invalid mob metadata or template identity");
          mobActions.set(templateId, nativeMobActions(data.actions));
          bodyAttack.set(templateId, data.bodyAttack === true);
          pushed.set(templateId, data.pushed ?? 1);
          mobMetadata.set(templateId, { attacks: data.attacks ?? [], maxMP: data.maxMP ?? 0 });
          for (const attack of data.attacks ?? [])
            for (const frames of [attack.effect, attack.hit, attack.ball])
              for (const frame of frames) image(frame.path);
          preload(data.actions);
        } else {
          if (!isNpcMetadata(data) || data.templateId !== templateId)
            throw new Error("Invalid NPC metadata or template identity");
          npcActions.set(templateId, data.actions);
          npcMetadata.set(templateId, {
            name: data.name,
            clickBounds: data.clickBounds,
            behavior: data.behavior,
          });
          onNpc(data);
          preload(data.actions);
        }
      })
      .catch((error) => {
        if (!current(key, owner)) return;
        table.delete(templateId);
        if (kind === "npc") npcMetadata.delete(templateId);
        else {
          bodyAttack.delete(templateId);
          pushed.delete(templateId);
          mobMetadata.delete(templateId);
        }
        missing.add(key);
        onError(kind, templateId, error);
      })
      .finally(() => {
        if (requests.get(key) === owner) requests.delete(key);
      });
    return owner.promise;
  }
  function clear() {
    for (const request of requests.values()) request.controller.abort();
    requests.clear();
    npcActions.clear();
    mobActions.clear();
    npcMetadata.clear();
    mobMetadata.clear();
    bodyAttack.clear();
    pushed.clear();
    missing.clear();
  }
  return { npcActions, mobActions, npcMetadata, mobMetadata, bodyAttack, pushed, load, clear };
}
