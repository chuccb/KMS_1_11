/** Read-only API resource tests. No player/session/save or import-time I/O. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  itemMetadataCache,
  ITEM_METADATA_POLICY,
  readItemMetadata,
} from "../../client/item-metadata.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const response = (status: number, value: unknown) => ({
  status,
  async json() {
    return value;
  },
});
test("item facts identity/name/shared-tooltip projection validates unknown without coerced IDs or fabricated labels", () => {
  assert.deepEqual(
    readItemMetadata({ id: 1, name: "가", price: 2, unitPrice: 0.5, cash: false }, 1),
    { id: 1, name: "가", price: 2, unitPrice: 0.5, cash: false },
  );
  assert.equal(readItemMetadata({ id: 1 }, 1).name, undefined);
  assert.equal(Object.isFrozen(readItemMetadata({ id: 1 }, 1)), true);
  for (const value of [
    null,
    [],
    { id: "1" },
    { id: 2 },
    { id: 1, name: 7 },
    { id: 1, price: Infinity },
    { id: 1, sfx: 2 },
    { id: 1, cash: 1 },
    { id: 1, requirements: {} },
    { id: 1, equipment: { ruc: 1, stats: { pad: "1" } } },
    { id: 1, iconRaw: { path: 1 } },
    { id: 1, desc: [] },
  ])
    assert.throws(() => readItemMetadata(value, 1));
});
test("item metadata coalesces in-flight readers, preserves full facts, caches200 and definitive404, never reads404 JSON", async () => {
  let reads = 0;
  const wait = deferred<ReturnType<typeof response>>(),
    errors: unknown[] = [];
  const cache = itemMetadataCache({
    now: () => 0,
    onError: (e) => errors.push(e),
    read: () => {
      reads++;
      return wait.promise;
    },
  });
  const first = cache.load(1),
    second = cache.load(1);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(reads, 1);
  wait.resolve(response(200, { id: 1, name: "name", incPAD: 10 }));
  const facts = await first;
  assert.ok(facts);
  assert.equal(facts.incPAD, 10);
  assert.equal(await cache.load(1), facts);
  assert.equal(reads, 1);
  assert.equal(cache.entries.get(1), facts);
  const missing = itemMetadataCache({
    now: () => 0,
    onError: (e) => errors.push(e),
    read: async () => ({
      status: 404,
      json() {
        throw Error("must not decode404");
      },
    }),
  });
  assert.equal(await missing.load(99), null);
  assert.equal(missing.entries.has(99), true);
  assert.equal(await missing.load(99), null);
  assert.deepEqual(errors, []);
});
test("network/500/JSON/identity/label failures are observable transient failures, retry cooldown then recover, not permanent missing WZ", async () => {
  for (const fault of ["network", "http", "json", "id", "name"] as const) {
    let now = 0,
      reads = 0;
    const errors: unknown[] = [];
    const cache = itemMetadataCache({
      now: () => now,
      onError: (e) => errors.push(e),
      read: async () => {
        reads++;
        if (reads > 1) return response(200, { id: 1, name: "recovered" });
        if (fault === "network") throw Error("network");
        if (fault === "http") return response(500, null);
        if (fault === "json")
          return {
            status: 200,
            json: async () => {
              throw Error("json");
            },
          };
        return response(200, fault === "id" ? { id: 2, name: "bad" } : { id: 1, name: 5 });
      },
    });
    assert.equal(await cache.load(1), undefined);
    assert.equal(cache.entries.has(1), false);
    assert.equal(errors.length, 1);
    assert.equal(await cache.load(1), undefined);
    assert.equal(reads, 1);
    now = ITEM_METADATA_POLICY.retryMs - 1;
    await cache.load(1);
    assert.equal(reads, 1);
    now++;
    assert.equal((await cache.load(1))?.name, "recovered");
    assert.equal(reads, 2);
    assert.equal(errors.length, 1);
  }
});
test("clear/dispose abort ownership, suppress queued I/O and stale JSON, do not let old finally remove new same-id request", async () => {
  const first = deferred<ReturnType<typeof response>>(),
    second = deferred<ReturnType<typeof response>>();
  let reads = 0;
  const signals: AbortSignal[] = [],
    errors: unknown[] = [];
  const cache = itemMetadataCache({
    now: () => 0,
    onError: (e) => errors.push(e),
    read: (_id, signal) => {
      signals.push(signal);
      return ++reads === 1 ? first.promise : second.promise;
    },
  });
  const old = cache.load(1);
  await Promise.resolve();
  cache.clear();
  assert.equal(signals[0]?.aborted, true);
  const fresh = cache.load(1);
  await Promise.resolve();
  first.resolve(response(200, { id: 1, name: "old" }));
  assert.equal(await old, undefined);
  assert.equal(cache.load(1), fresh);
  second.resolve(response(200, { id: 1, name: "new" }));
  assert.equal((await fresh)?.name, "new");
  assert.deepEqual(errors, []);
  const notStarted = cache.load(2);
  cache.dispose();
  cache.dispose();
  assert.equal(await notStarted, undefined);
  assert.equal(reads, 2);
  assert.equal(await cache.load(3), undefined);
  assert.equal(cache.entries.size, 0);
});
test("browser-only cache/pending budgets are bounded; eviction reloads; invalid IDs never start fetch", async () => {
  let reads = 0;
  const errors: unknown[] = [];
  const cache = itemMetadataCache({
    now: () => 0,
    onError: (e) => errors.push(e),
    read: async (id) => {
      reads++;
      return response(200, { id, name: String(id) });
    },
  });
  for (let id = 0; id <= ITEM_METADATA_POLICY.entries; id++) await cache.load(id);
  assert.equal(cache.entries.size, ITEM_METADATA_POLICY.entries);
  assert.equal(cache.entries.has(0), false);
  await cache.load(0);
  assert.equal(reads, ITEM_METADATA_POLICY.entries + 2);
  for (const id of [-1, NaN, 1.1, 2 ** 32]) assert.equal(await cache.load(id), undefined);
  assert.equal(reads, ITEM_METADATA_POLICY.entries + 2);
  assert.equal(errors.length, 4);
  const wait = deferred<ReturnType<typeof response>>();
  let starts = 0;
  const pending = itemMetadataCache({
    now: () => 0,
    onError: (e) => errors.push(e),
    read: () => {
      starts++;
      return wait.promise;
    },
  });
  const tasks = Array.from({ length: ITEM_METADATA_POLICY.pending }, (_, id) => pending.load(id));
  assert.equal(await pending.load(9999), undefined);
  assert.equal(starts, ITEM_METADATA_POLICY.pending);
  pending.clear();
  wait.resolve(response(200, { id: 0 }));
  await Promise.all(tasks);
  assert.equal(pending.entries.size, 0);
  assert.match(String(errors.at(-1)), /budget/);
});

test("item metadata projection accepts every original equipment template and representative consume/ammo/etc facts without numeric-label substitution", async () => {
  const { WzArchive } = await import("../src/wz/archive.ts");
  const { itemCatalogOf } = await import("../src/game/iteminfo.ts");
  const archive = WzArchive.open(new URL("../../Data.wz", import.meta.url).pathname),
    catalog = itemCatalogOf(archive);
  assert.ok(catalog);
  const ids = new Set([4000019, 2000000, 2070000]);
  for (const image of archive.images) {
    const match = /^Character\/[^/]+\/(\d+)\.img$/.exec(image.path);
    if (match) {
      const id = Number(match[1]);
      if (id >= 1000000 && id < 2000000) ids.add(id);
    }
  }
  let checked = 0;
  for (const id of ids) {
    const facts = catalog.info(id);
    assert.ok(facts, `Original equipment/item ${id} must not be called absent`);
    const projected = readItemMetadata(facts, id);
    assert.equal(projected.name, facts.name);
    assert.deepEqual(projected.iconRaw, facts.iconRaw);
    assert.deepEqual(projected.equipment, facts.equipment);
    checked++;
  }
  assert.ok(checked > 100, "Full archive equipment coverage, not one convenient sword");
});
