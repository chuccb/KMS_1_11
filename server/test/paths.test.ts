/**
 * The WZ paths are evidence, not convention: `mapImagePath` has to keep producing exactly the
 * string the client passes to its own formatter (`L"Map/Map/%09d.img"`, `sub_4694F0`). A capture
 * of the original client loading a map is what would confirm the padding, until then this test
 * pins the format the binary shows.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { MAP_HELPER_PATH, MAP_NODES, mapImagePath } from "../src/wz/paths.ts";

test("mapImagePath is the client's %09d format", () => {
  assert.equal(mapImagePath(1000000), "Map/Map/001000000.img"); // the 2003 starting map
  assert.equal(mapImagePath(100), "Map/Map/000000100.img");
  assert.equal(mapImagePath(0), "Map/Map/000000000.img");
  assert.equal(mapImagePath(999999999), "Map/Map/999999999.img");
});

test("a negative or fractional map id is refused instead of formatted", () => {
  assert.throws(() => mapImagePath(-1), RangeError);
  assert.throws(() => mapImagePath(1.5), RangeError);
});

test("the located node names are the client's own literals", () => {
  assert.deepEqual(Object.values(MAP_NODES), ["foothold", "ladderRope", "portal"]);
  assert.equal(MAP_HELPER_PATH, "Map/MapHelper.img");
});
