import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MAP_COMMAND_ID, RETURN_MAP_NONE } from "../../client/map-constants.ts";
import {
  mapSearchMessages,
  parseMapCommand,
  type MapCatalogFetcher,
} from "../../client/map-commands.ts";
import { isMapDestinations } from "../../client/ui-resource-validation.ts";

function catalogFetcher(payload: unknown, status = 200): MapCatalogFetcher {
  return async (path) => {
    assert.equal(path, "/api/maps");
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test("map command parser preserves aliases and the signed-32-bit destination policy", () => {
  for (const alias of ["map", "warp", "go", "헉맵"])
    assert.deepEqual(parseMapCommand(`/${alias} 1000000`), { kind: "warp", mapId: 1_000_000 });
  assert.deepEqual(parseMapCommand("/MAP 001000000"), { kind: "warp", mapId: 1_000_000 });
  assert.deepEqual(parseMapCommand("/map 0"), { kind: "warp", mapId: 0 });
  assert.deepEqual(parseMapCommand(`/map ${MAX_MAP_COMMAND_ID}`), {
    kind: "warp",
    mapId: MAX_MAP_COMMAND_ID,
  });

  for (const text of [
    "/map",
    "/map -1",
    "/map +1",
    "/map 1.5",
    `/map ${RETURN_MAP_NONE}`,
    `/map ${MAX_MAP_COMMAND_ID + 1}`,
  ])
    assert.deepEqual(parseMapCommand(text), { kind: "invalid-warp" }, text);

  assert.deepEqual(parseMapCommand("/maps Victoria Road"), {
    kind: "search",
    query: "Victoria Road",
  });
  assert.deepEqual(parseMapCommand("/maps"), { kind: "search", query: "" });
  assert.deepEqual(parseMapCommand("/WHERE"), { kind: "where" });
  assert.equal(parseMapCommand("/mapping 1000000"), undefined);
});

test("map catalog guard accepts only safe, commandable destination IDs", () => {
  const valid = [{ id: 1_000_000, name: "Henesys", streetName: "Victoria Road" }];
  assert.equal(isMapDestinations(valid), true);
  assert.equal(isMapDestinations([{ ...valid[0], id: 0 }]), true, "real map zero is valid");
  assert.equal(isMapDestinations([]), true);

  for (const id of [NaN, Infinity, -1, 1.5, MAX_MAP_COMMAND_ID + 1, RETURN_MAP_NONE, "1000000"])
    assert.equal(isMapDestinations([{ ...valid[0], id }]), false, String(id));
  assert.equal(isMapDestinations([{ ...valid[0], name: 4 }]), false);
  assert.equal(isMapDestinations([{ id: 1_000_000, name: "Henesys" }]), false);
});

test("map search is case-insensitive, filters all summary fields, and caps displayed rows at 20", async () => {
  const catalog = Array.from({ length: 22 }, (_, index) => ({
    id: 1_000_000 + index,
    name: `Henesys ${index}`,
    streetName: "Victoria Road",
  }));
  const messages = await mapSearchMessages("HENESYS", catalogFetcher(catalog));

  assert.equal(messages.length, 21);
  assert.deepEqual(messages[0], {
    channel: "地圖",
    text: "1000000 · Victoria Road / Henesys 0",
  });
  assert.deepEqual(messages[19], {
    channel: "地圖",
    text: "1000019 · Victoria Road / Henesys 19",
  });
  assert.deepEqual(messages[20], {
    channel: "系統",
    text: "共 22 筆，先顯示20筆；可加關鍵字縮小範圍。/map ID 前往。",
  });

  const streetMatches = await mapSearchMessages("VICTORIA ROAD", catalogFetcher(catalog));
  assert.equal(streetMatches.length, 21);
  const idMatches = await mapSearchMessages("1000000", catalogFetcher(catalog));
  assert.deepEqual(idMatches, [
    { channel: "地圖", text: "1000000 · Victoria Road / Henesys 0" },
    { channel: "系統", text: "共 1 筆。/map ID 前往。" },
  ]);
});

test("map search reports no matches, malformed catalogs, HTTP errors, and fetch failures", async () => {
  assert.deepEqual(await mapSearchMessages("absent", catalogFetcher([])), [
    { channel: "系統", text: "沒有符合的地圖。" },
  ]);
  assert.deepEqual(
    await mapSearchMessages(
      "",
      catalogFetcher([{ id: RETURN_MAP_NONE, name: "not a map", streetName: "" }]),
    ),
    [{ channel: "系統", text: "地圖清單讀取失敗：地圖清單格式錯誤。" }],
  );
  assert.deepEqual(await mapSearchMessages("", catalogFetcher([], 503)), [
    { channel: "系統", text: "地圖清單讀取失敗：HTTP 503" },
  ]);
  assert.deepEqual(
    await mapSearchMessages("", async () => {
      throw new Error("offline");
    }),
    [{ channel: "系統", text: "地圖清單讀取失敗：offline" }],
  );
  assert.deepEqual(
    await mapSearchMessages("", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw "bad JSON";
      },
    })),
    [{ channel: "系統", text: "地圖清單讀取失敗：bad JSON" }],
  );
});
