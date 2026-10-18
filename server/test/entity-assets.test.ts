import test from "node:test";
import assert from "node:assert/strict";
import { entityAssets } from "../../client/entity-assets.ts";
import { isNpcMetadata, isNpcBehavior } from "../../client/entity-resource-validation.ts";
import { isMobMetadata } from "../../client/combat-resource-validation.ts";
import type { NpcArt, MobArt, MobAttackArt } from "../src/game/sprites.ts";

// Minimal unit metadata only. Game/HTTP coverage separately reads original Data.wz.
const frame = { path: "Npc/original.img/stand/0", delay: 31, ox: 10, oy: 20 };
const npc: NpcArt = {
  templateId: 1001000,
  name: "Own NPC name",
  clickBounds: { left: -22, top: -65, right: 22, bottom: 0 },
  actions: { stand: [frame] },
  behavior: {
    movable: false,
    speak: ["", "native speech"],
    extraActions: [{ name: "blink", speak: [""] }],
  },
};
const attack: MobAttackArt = {
  action: 10,
  name: "attack1",
  type: 0,
  conMP: 5,
  duration: 300,
  visualDuration: 150,
  effectAfter: 30,
  attackAfter: 60,
  range: { left: -10, top: -10, right: 10, bottom: 10 },
  effect: [{ ...frame, path: "Mob/effect" }],
  hit: [{ ...frame, path: "Mob/hit" }],
  ball: [{ ...frame, path: "Mob/ball" }],
};
const mob: MobArt = {
  templateId: 100100,
  bodyAttack: true,
  pushed: 7,
  maxMP: 10,
  attacks: [attack],
  actions: { stand: [{ ...frame, path: "Mob/stand" }] },
};
function response(data: unknown, status = 200) {
  return {
    ok: status === 200,
    status,
    async json(): Promise<unknown> {
      return data;
    },
  };
}
function deferred<T>() {
  return Promise.withResolvers<T>();
}
function fixture(
  fetcher: NonNullable<Parameters<typeof entityAssets>[0]["fetch"]>,
  onNpc?: (data: NpcArt) => void,
) {
  const images: string[] = [],
    loaded: NpcArt[] = [],
    errors: unknown[] = [];
  let generation = 1;
  const assets = entityAssets({
    generation: () => generation,
    image: (path) => images.push(path),
    onNpc: (data) => {
      loaded.push(data);
      onNpc?.(data);
    },
    onError: (_kind, _id, error) => errors.push(error),
    fetch: fetcher,
  });
  return {
    assets,
    images,
    loaded,
    errors,
    nextGeneration() {
      generation++;
    },
  };
}

test("NPC schema retains own bounds/name, dense speech and linked actions; rejects malformed nested payloads", () => {
  assert.equal(isNpcMetadata(npc), true);
  assert.equal(isNpcBehavior(npc.behavior), true);
  for (const value of [
    null,
    [],
    { ...npc, templateId: "1001000" },
    { ...npc, name: 1 },
    { ...npc, clickBounds: { ...npc.clickBounds, top: NaN } },
    { ...npc, actions: { stand: [{ ...frame, ox: "10" }] } },
    { ...npc, behavior: { ...npc.behavior, movable: 1 } },
    { ...npc, behavior: { ...npc.behavior, speak: [null] } },
    { ...npc, behavior: { ...npc.behavior, extraActions: [{ name: "blink", speak: "wrong" }] } },
  ])
    assert.equal(isNpcMetadata(value), false);
});
test("NPC and mob loading are fully separate, deduplicated and warm the actual native paths", async () => {
  const requests: string[] = [];
  const { assets, images, loaded, errors } = fixture(async (path) => {
    requests.push(path);
    return response(path.includes("/npc/") ? npc : mob);
  });
  const pending = assets.load("npc", npc.templateId);
  assert.equal(assets.load("npc", npc.templateId), pending);
  await pending;
  await assets.load("mob", mob.templateId);
  await assets.load("npc", npc.templateId);
  assert.deepEqual(requests, ["/api/npc/1001000", "/api/mob/100100"]);
  assert.equal(assets.npcActions.get(npc.templateId), npc.actions);
  assert.deepEqual(assets.npcMetadata.get(npc.templateId), {
    name: npc.name,
    clickBounds: npc.clickBounds,
    behavior: npc.behavior,
  });
  assert.deepEqual(loaded, [npc]);
  assert.equal(assets.mobActions.get(mob.templateId)?.stand[0]?.delay, 60);
  assert.equal(assets.mobActions.get(mob.templateId)?.stand[0]?.rawDelay, 31);
  assert.equal(mob.actions.stand[0]?.delay, 31, "Never mutate metadata or native WZ source");
  assert.deepEqual(assets.mobMetadata.get(mob.templateId), { attacks: [attack], maxMP: 10 });
  assert.equal(assets.bodyAttack.get(mob.templateId), true);
  assert.equal(assets.pushed.get(mob.templateId), 7);
  assert.deepEqual(images, [frame.path, "Mob/effect", "Mob/hit", "Mob/ball", "Mob/stand"]);
  assert.deepEqual(errors, []);
});
test("optional mob flags use the documented old defaults, never enable body attack without true", async () => {
  const { assets } = fixture(async () => response({ templateId: 100100, actions: {} }));
  await assets.load("mob", 100100);
  assert.equal(assets.bodyAttack.get(100100), false);
  assert.equal(assets.pushed.get(100100), 1);
  assert.deepEqual(assets.mobMetadata.get(100100), { attacks: [], maxMP: 0 });
});
test("HTTP, invalid JSON, wrong template and invalid schemas are negative-cached only until clear; no pictures or partial metadata escape", async () => {
  for (const bad of [
    response(null, 404),
    response(null, 503),
    response({ ...npc, templateId: 1 }),
    response({ ...npc, behavior: null }),
    {
      ok: true,
      status: 200,
      async json() {
        throw new Error("bad JSON");
      },
    },
  ]) {
    let calls = 0;
    const { assets, images, loaded, errors } = fixture(async () => {
      calls++;
      return calls === 1 ? bad : response(npc);
    });
    await assets.load("npc", npc.templateId);
    await assets.load("npc", npc.templateId);
    assert.equal(calls, 1);
    assert.equal(errors.length, 1);
    assert.equal(assets.npcActions.has(npc.templateId), false);
    assert.equal(assets.npcMetadata.size, 0);
    assert.deepEqual(images, []);
    assert.deepEqual(loaded, []);
    assets.clear();
    await assets.load("npc", npc.templateId);
    assert.equal(calls, 2);
    assert.equal(assets.npcMetadata.get(npc.templateId)?.name, npc.name);
  }
});
test("invalid mob attacks/flags cannot partially enable contact or publish fallback actions", async () => {
  for (const value of [
    { ...mob, templateId: 1 },
    { ...mob, bodyAttack: "true" },
    { ...mob, pushed: Infinity },
    { ...mob, attacks: [{ ...attack, ball: [{ ...frame, delay: "30" }] }] },
  ]) {
    assert.equal(isMobMetadata(value) && value.templateId === mob.templateId, false);
    const { assets, images, errors } = fixture(async () => response(value));
    await assets.load("mob", mob.templateId);
    assert.equal(assets.mobActions.size, 0);
    assert.equal(assets.bodyAttack.size, 0);
    assert.equal(assets.pushed.size, 0);
    assert.equal(assets.mobMetadata.size, 0);
    assert.deepEqual(images, []);
    assert.equal(errors.length, 1);
  }
});
test("clear before the request microtask cancels ownership without even starting network work", async () => {
  let calls = 0;
  const { assets, images, errors } = fixture(async () => {
    calls++;
    return response(npc);
  });
  const pending = assets.load("npc", npc.templateId);
  assets.clear();
  await pending;
  assert.equal(calls, 0);
  assert.deepEqual(images, []);
  assert.deepEqual(errors, []);
});
test("same-generation clear and re-entry use request identity; late success/failure cannot overwrite or delete a new owner", async () => {
  for (const fail of [false, true]) {
    const old = deferred<ReturnType<typeof response>>(),
      fresh = deferred<ReturnType<typeof response>>();
    const signals: AbortSignal[] = [];
    const { assets, images, errors } = fixture(async (_path, { signal }) => {
      signals.push(signal);
      return signals.length === 1 ? old.promise : fresh.promise;
    });
    const first = assets.load("npc", npc.templateId);
    await Promise.resolve();
    assets.clear();
    assert.equal(signals[0]?.aborted, true);
    const second = assets.load("npc", npc.templateId);
    await Promise.resolve();
    if (fail) old.reject(new Error("old failure"));
    else old.resolve(response({ ...npc, name: "stale" }));
    await first;
    assert.equal(assets.npcActions.has(npc.templateId), true, "new pending marker survives");
    assert.equal(assets.npcMetadata.size, 0);
    assert.deepEqual(images, []);
    assert.deepEqual(errors, []);
    fresh.resolve(response({ ...npc, name: "current" }));
    await second;
    assert.equal(assets.npcMetadata.get(npc.templateId)?.name, "current");
    assert.deepEqual(images, [frame.path]);
  }
});
test("generation changes while parsing JSON never publish stale art, warm its PNGs or notify NPC presentation", async () => {
  const json = deferred<unknown>(),
    entered = deferred<void>();
  const { assets, images, loaded, errors, nextGeneration } = fixture(async () => ({
    ok: true,
    status: 200,
    json() {
      entered.resolve();
      return json.promise;
    },
  }));
  const pending = assets.load("npc", npc.templateId);
  await entered.promise;
  nextGeneration();
  json.resolve(npc);
  await pending;
  assert.equal(assets.npcMetadata.size, 0);
  assert.deepEqual(images, []);
  assert.deepEqual(loaded, []);
  assert.deepEqual(errors, []);
  assets.clear();
  assert.equal(assets.npcActions.size, 0);
});
test("consumer errors roll back all published metadata and negative-cache the failing owner", async () => {
  const { assets, errors } = fixture(
    async () => response(npc),
    () => {
      throw new Error("presentation failed");
    },
  );
  await assets.load("npc", npc.templateId);
  assert.equal(assets.npcActions.size, 0);
  assert.equal(assets.npcMetadata.size, 0);
  assert.equal(errors.length, 1);
  const mobAssets = entityAssets({
    generation: () => 1,
    image() {
      throw new Error("preload failed");
    },
    onNpc() {},
    fetch: async () => response(mob),
  });
  await mobAssets.load("mob", mob.templateId);
  assert.equal(mobAssets.mobActions.size, 0);
  assert.equal(mobAssets.mobMetadata.size, 0);
  assert.equal(mobAssets.bodyAttack.size, 0);
  assert.equal(mobAssets.pushed.size, 0);
});
test("invalid template IDs never fetch or allocate a pending slot; clear releases every owned table", async () => {
  let calls = 0;
  const { assets } = fixture(async (path) => {
    calls++;
    return response(path.includes("/npc/") ? npc : mob);
  });
  for (const id of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assets.load("mob", id);
  assert.equal(calls, 0);
  assert.equal(assets.mobActions.size, 0);
  await assets.load("npc", npc.templateId);
  await assets.load("mob", mob.templateId);
  assets.clear();
  for (const table of [
    assets.npcActions,
    assets.mobActions,
    assets.npcMetadata,
    assets.mobMetadata,
    assets.bodyAttack,
    assets.pushed,
  ])
    assert.equal(table.size, 0);
});
