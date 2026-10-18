/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";

import type { ResourceResponse } from "../../client/combat-assets.ts";
import { combatAssets } from "../../client/combat-assets.ts";
const action = {
  action: 32,
  stance: "proneStab",
  baseDelays: [300, 400],
  delays: [262, 350],
  frameIndices: [0, 1],
  effects: {},
};
const profile = (id: number) => ({
  weaponId: id,
  group: 1,
  speed: 2,
  melee: [],
  shoot: [],
  prone: action,
});
const response = (id: number) => ({ ok: true, json: async () => profile(id) });

test("deduplicates pending metadata, retains immutable data, and never invents prone in standing table", async () => {
  let calls = 0,
    warmed = 0;
  const cache = combatAssets({
    fetcher: async () => {
      calls++;
      return response(1302000);
    },
    onAttack: () => warmed++,
  });
  const a = cache.attack(1302000),
    b = cache.attack(1302000);
  assert.equal(a, b);
  const result = await a;
  assert.ok(result);
  assert.ok(result.prone);
  assert.equal(result.prone.action, 32);
  assert.deepEqual(result.melee, []);
  assert.equal(await cache.attack(1302000), result);
  assert.equal(cache.peekAttack(1302000), result);
  assert.equal(calls, 1);
  assert.equal(warmed, 1);
});

test("failure retries after FIVE seconds, pending saturation never aborts old requests", async () => {
  let now = 0,
    calls = 0,
    resolve: ((value: ResourceResponse) => void) | undefined,
    signal: AbortSignal | undefined;
  const cache = combatAssets({
    limit: 1,
    now: () => now,
    fetcher: async (_url: string, options: { signal: AbortSignal }) => {
      calls++;
      signal = options.signal;
      return await new Promise((r) => {
        resolve = r;
      });
    },
  });
  const first = cache.attack(1302000);
  await Promise.resolve();
  assert.equal(await cache.attack(1402000), undefined);
  assert.equal(signal!.aborted, false);
  assert.equal(calls, 1);
  resolve!({ ok: false });
  assert.equal(await first, undefined);
  now = 4999;
  assert.equal(await cache.attack(1302000), undefined);
  assert.equal(calls, 1);
  now = 5000;
  const retry = cache.attack(1302000);
  await Promise.resolve();
  assert.equal(calls, 2);
  resolve!(response(1302000));
  await retry;
});

test("clear aborts pending work; late successful response cannot populate/warm a new cache generation", async () => {
  let resolve: ((value: ResourceResponse) => void) | undefined,
    signal: AbortSignal | undefined,
    warmed = 0;
  const cache = combatAssets({
    fetcher: async (_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return await new Promise((r) => {
        resolve = r;
      });
    },
    onAttack: () => warmed++,
  });
  const old = cache.attack(1302000);
  await Promise.resolve();
  cache.clear();
  assert.equal(signal!.aborted, true);
  resolve!(response(1302000));
  assert.equal(await old, undefined);
  assert.equal(cache.peekAttack(1302000), undefined);
  assert.equal(warmed, 0);
});

test("bad ids, invalid indices and missing projectile metadata never become fake animation defaults", async () => {
  let calls = 0;
  const cache = combatAssets({
    fetcher: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          weaponId: 1302000,
          speed: 2,
          melee: [],
          shoot: [],
          prone: { ...action, frameIndices: [] },
        }),
      };
    },
  });
  assert.equal(await cache.attack(0), undefined);
  assert.equal(await cache.projectile(2000000), undefined);
  assert.equal(calls, 0);
  assert.equal(await cache.attack(1302000), undefined);
  assert.equal(calls, 1);
});

test("independent effect metadata rejects corrupt sprite clocks, not replaced by body frames", async () => {
  const cache = combatAssets({
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        ...profile(1302000),
        prone: {
          ...action,
          afterimages: {
            0: [{ path: "Character/Afterimage/swordOL.img/0/proneStab/0/0", delay: NaN }],
          },
        },
      }),
    }),
  });
  assert.equal(await cache.attack(1302000), undefined);
});
