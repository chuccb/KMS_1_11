import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchBrowserMapArtResource,
  fetchBrowserMapName,
  fetchBrowserMapResource,
  type MapResourceFetcher,
  type MapResourceJsonResponse,
} from "../../client/map-resource-loader.ts";

const mapId = 100000000;
const mapPayload = {
  id: mapId,
  name: "Town",
  streetName: "Street",
  bgm: "Bgm00/000",
  recovery: 0,
  portals: [],
  footholds: [],
  ladders: [],
  mobs: [],
  npcs: [],
};
const artPayload = {
  backs: [],
  sprites: [],
  bounds: { left: 0, top: 0, right: 0, bottom: 0 },
  missingTiles: 0,
  missingTileSets: [],
  portalFrames: [],
};

function response(
  payload: unknown,
  status = 200,
  ok = status >= 200 && status < 300,
): MapResourceJsonResponse {
  return { ok, status, json: async () => payload };
}

test("map-name lookup validates its response and leaves metadata failures optional", async () => {
  const urls: string[] = [];
  const fetcher: MapResourceFetcher = async (url) => {
    urls.push(url);
    return response(mapPayload);
  };

  const name = await fetchBrowserMapName(mapId, fetcher);
  assert.equal(name?.id, mapId);
  assert.equal(name?.name, "Town");
  assert.equal(name?.streetName, "Street");
  assert.deepEqual(urls, [`/api/map/${mapId}`]);
  assert.equal(
    await fetchBrowserMapName(mapId, async () => response({ ...mapPayload, id: mapId + 1 })),
    undefined,
  );
  assert.equal(await fetchBrowserMapName(mapId, async () => response({ id: mapId })), undefined);
  assert.equal(await fetchBrowserMapName(mapId, async () => response({}, 503)), undefined);
  assert.equal(
    await fetchBrowserMapName(mapId, async () => {
      throw new Error("offline");
    }),
    undefined,
  );
});

test("map-resource lookup reports HTTP and contract failures without weakening the ID check", async () => {
  const urls: string[] = [];
  const fetcher: MapResourceFetcher = async (url) => {
    urls.push(url);
    return response(mapPayload);
  };

  assert.deepEqual(await fetchBrowserMapResource(mapId, () => true, fetcher), mapPayload);
  assert.deepEqual(urls, [`/api/map/${mapId}`]);
  await assert.rejects(
    fetchBrowserMapResource(
      mapId,
      () => true,
      async () => response({}, 503),
    ),
    new RegExp(`map ${mapId}: HTTP 503`),
  );
  await assert.rejects(
    fetchBrowserMapResource(
      mapId,
      () => true,
      async () => response({ id: mapId }),
    ),
    new RegExp(`map ${mapId}: invalid map resource`),
  );
  await assert.rejects(
    fetchBrowserMapResource(
      mapId,
      () => true,
      async () => response({ ...mapPayload, id: mapId + 1 }),
    ),
    new RegExp(`map ${mapId}: invalid map resource`),
  );
});

test("map-resource generation fence discards a response after its field owner changes", async () => {
  let resolvePayload!: (payload: unknown) => void;
  let signalJsonStarted!: () => void;
  const payload = new Promise<unknown>((resolve) => {
    resolvePayload = resolve;
  });
  const jsonStarted = new Promise<void>((resolve) => {
    signalJsonStarted = resolve;
  });
  let current = true;
  const pendingResponse: MapResourceJsonResponse = {
    ok: true,
    status: 200,
    json() {
      signalJsonStarted();
      return payload;
    },
  };
  const request = fetchBrowserMapResource(
    mapId,
    () => current,
    async () => pendingResponse,
  );

  await jsonStarted;
  current = false;
  resolvePayload({ deliberately: "not a map" });
  assert.equal(await request, undefined);
});

test("map-art lookup distinguishes ready, missing, stale, and invalid responses", async () => {
  const urls: string[] = [];
  const ready = await fetchBrowserMapArtResource(
    mapId,
    () => true,
    async (url) => {
      urls.push(url);
      return response(artPayload);
    },
  );
  assert.deepEqual(ready, { kind: "ready", art: artPayload });
  assert.deepEqual(urls, [`/api/map/${mapId}/art`]);

  let parsed = false;
  const missing = await fetchBrowserMapArtResource(
    mapId,
    () => true,
    async () => ({
      ok: false,
      status: 503,
      async json() {
        parsed = true;
        return {};
      },
    }),
  );
  assert.deepEqual(missing, { kind: "http-error", status: 503 });
  assert.equal(parsed, false);

  let current = true;
  const stale = await fetchBrowserMapArtResource(
    mapId,
    () => current,
    async () => ({
      ok: true,
      status: 200,
      async json() {
        current = false;
        return { deliberately: "not art" };
      },
    }),
  );
  assert.deepEqual(stale, { kind: "stale" });
  await assert.rejects(
    fetchBrowserMapArtResource(
      mapId,
      () => true,
      async () => response({ deliberately: "not art" }),
    ),
    new RegExp(`map ${mapId}: invalid map art resource`),
  );
});
