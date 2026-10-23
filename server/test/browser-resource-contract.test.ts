import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { mapCatalogOf, mapDataProvider } from "../src/game/map.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { startWebClient } from "../src/net/webclient.ts";
import {
  browserMapName,
  isBrowserMapArtResource,
  isBrowserMapName,
  isBrowserMapResource,
  type BrowserMapArtResource,
  type BrowserMapResource,
} from "../../client/map-resources.ts";
import { RETURN_MAP_NONE } from "../../client/map-constants.ts";
import { isCreationCatalog, isMapDestinations } from "../../client/ui-resource-validation.ts";
import { isNpcMetadata } from "../../client/entity-resource-validation.ts";
import { ACTIVE_SKILLS } from "../../client/active-skills.ts";
import {
  isActiveSkillMetadata,
  isBasicAttackProfile,
  isMobMetadata,
  isSkillCatalogue,
  isSpriteFrames,
} from "../../client/combat-resource-validation.ts";

test("browser metadata guards accept original WZ HTTP responses, without a game connection", async () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const server = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    art: artProviderOf(archive),
    mapProvider: mapDataProvider(archive),
    mapCatalog: mapCatalogOf(archive),
    skills: skillCatalogOf(archive),
  });
  try {
    const endpoints: [string, (data: unknown) => boolean][] = [
      ...[1302000, 1332000, 1372000, 1452000, 1462000, 1472000].map(
        (id) => [`/api/attack/${id}`, isBasicAttackProfile] as [string, (data: unknown) => boolean],
      ),
      ["/api/projectile/2060000", isSpriteFrames],
      ["/api/maps", isMapDestinations],
      ["/api/map/100000000", isBrowserMapResource],
      ["/api/map/100000000/art", isBrowserMapArtResource],
      ["/api/creation", isCreationCatalog],
      ["/api/mob/100100", isMobMetadata],
      ...[1001000, 1002000, 1002001, 2100].map(
        (id) => [`/api/npc/${id}`, isNpcMetadata] as [string, (data: unknown) => boolean],
      ),
      ["/api/skills/100", isSkillCatalogue],
      ["/api/skills/200", isSkillCatalogue],
      ...Object.keys(ACTIVE_SKILLS).map(
        (id) =>
          [`/api/active-skill/${id}`, isActiveSkillMetadata] as [
            string,
            (data: unknown) => boolean,
          ],
      ),
    ];
    for (const [path, valid] of endpoints) {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
      assert.equal(response.status, 200, path);
      const data: unknown = await response.json();
      assert.equal(valid(data), true, path);
    }

    const catalogResponse = await fetch(`http://127.0.0.1:${server.port}/api/maps`);
    assert.equal(catalogResponse.status, 200, "/api/maps");
    const catalog: unknown = await catalogResponse.json();
    assert.ok(isMapDestinations(catalog));
    assert.equal(catalog.length, 100);
    for (const { id } of catalog) {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/map/${id}`);
      assert.equal(response.status, 200, `map ${id}`);
      const resource: unknown = await response.json();
      assert.ok(
        isBrowserMapResource(resource) && resource.id === id,
        `map ${id} endpoint satisfies the browser DTO and identity contract`,
      );
    }
  } finally {
    await server.close();
  }
});

test("browser map-art DTO guard accepts every map built from the checked-in Data.wz", () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const maps = mapCatalogOf(archive)();
  const art = artProviderOf(archive);

  assert.equal(maps.length, 100, "the checked-in archive has the audited 100 original maps");
  for (const { id } of maps)
    assert.ok(isBrowserMapArtResource(art.mapArt(id)), `map ${id} produces drawable browser art`);
});

test("metadata boundaries reject malformed geometry, skill numbers and optional art", () => {
  assert.equal(
    isSpriteFrames([{ path: "original", delay: 30 }]),
    false,
    "missing origins are not typed as drawable frames",
  );
  assert.equal(
    isBasicAttackProfile({
      weaponId: 1302000,
      speed: 2,
      group: 1,
      melee: [],
      shoot: [],
      hitEffects: { hit1: [{ path: "original", delay: NaN, ox: 0, oy: 0 }] },
    }),
    false,
  );
  assert.equal(
    isSkillCatalogue({
      job: 100,
      books: [{ id: 100, name: "warrior", skills: [{ levels: [{ values: { hp: "10" } }] }] }],
    }),
    false,
  );
  assert.equal(
    isMobMetadata({ templateId: 100100, actions: {}, attacks: [{ type: 1, sp: null }] }),
    false,
  );
});

test("map resource guards validate IDs, terrain, portals and spawns without rejecting map zero", () => {
  const resource: BrowserMapResource = {
    id: 0,
    name: "Map",
    streetName: "Street",
    bgm: "Bgm00/Map",
    recovery: 1,
    physicalBounds: { left: -30, top: -300, right: 130, bottom: 10 },
    portals: [{ name: "sp", type: 0, x: 0, y: 10, toMapId: 0, toName: "" }],
    footholds: [{ id: 1, x1: 0, y1: 0, x2: 100, y2: 0, prev: 0, next: 0, layer: 0, group: 0 }],
    ladders: [{ id: 0, x: 30, y1: 0, y2: 30, ladder: true, page: 0, upperFoothold: false }],
    mobs: [{ templateId: 100100, x: 30, y: 0, foothold: 1 }],
    npcs: [],
  };
  const name = { id: 0, name: "Map", streetName: "Street" };

  assert.equal(isBrowserMapName(name), true);
  assert.equal(browserMapName(name), "Street:Map");
  assert.equal(isBrowserMapResource(resource), true);
  assert.equal(isBrowserMapResource({ ...resource, id: RETURN_MAP_NONE }), false);
  assert.equal(
    isBrowserMapResource({
      ...resource,
      physicalBounds: { ...resource.physicalBounds!, left: 200 },
    }),
    false,
    "inverted physical bounds cannot enter collision setup",
  );
  assert.equal(
    isBrowserMapResource({
      ...resource,
      footholds: [{ ...resource.footholds[0]!, x1: Number.NaN }],
    }),
    false,
  );
  assert.equal(
    isBrowserMapResource({
      ...resource,
      portals: [{ ...resource.portals[0]!, toMapId: Number.POSITIVE_INFINITY }],
    }),
    false,
  );
  assert.equal(
    isBrowserMapResource({
      ...resource,
      ladders: [{ ...resource.ladders[0]!, ladder: 1 }],
    }),
    false,
  );
  assert.equal(
    isBrowserMapResource({
      ...resource,
      mobs: [{ ...resource.mobs[0]!, foothold: Number.NaN }],
    }),
    false,
  );
});

test("map art guard accepts optional minimaps and rejects malformed drawable frames", () => {
  const frame = {
    path: "Map/MapHelper.img/portal/game/pv/0",
    delay: 120,
    ox: 0,
    oy: 0,
    a0: 0,
    a1: 255,
  };
  const art: BrowserMapArtResource = {
    title: { streetName: "Street", mapName: "Map", mark: { path: "Map/MapHelper.img/mark/town" } },
    miniMap: {
      path: "Map/Map/000000000.img/miniMap/canvas",
      canvasWidth: 210,
      canvasHeight: 112,
      width: 2100,
      height: 1120,
      centerX: 0,
      centerY: 0,
      mag: 1,
      npcs: [{ x: 10, y: 20 }],
    },
    backs: [
      {
        path: "Map/Back/sunny.img/back/0",
        ox: 0,
        oy: 0,
        x: 0,
        y: 0,
        rx: 100,
        ry: 100,
        type: 0,
        cx: 0,
        cy: 0,
        a: 255,
        z: -147990,
        front: false,
        flip: false,
      },
    ],
    sprites: [{ kind: "tile", layer: 0, x: 0, y: 0, z: 0, flip: false, frames: [frame] }],
    bounds: { left: -400, top: -300, right: 400, bottom: 300 },
    missingTiles: 0,
    missingTileSets: [],
    portalFrames: [frame],
  };

  assert.equal(isBrowserMapArtResource(art), true);
  assert.equal(isBrowserMapArtResource({ ...art, miniMap: undefined }), true);
  assert.equal(
    isBrowserMapArtResource({
      ...art,
      sprites: [{ ...art.sprites[0]!, frames: [{ ...frame, delay: Number.NaN }] }],
    }),
    false,
  );
  assert.equal(isBrowserMapArtResource({ ...art, missingTiles: -1 }), false);
  assert.equal(
    isBrowserMapArtResource({
      ...art,
      bounds: { ...art.bounds, right: -401 },
    }),
    false,
  );
  assert.equal(
    isBrowserMapArtResource({
      ...art,
      miniMap: { ...art.miniMap!, width: 0 },
    }),
    false,
  );
  assert.equal(
    isBrowserMapArtResource({
      ...art,
      backs: [{ ...art.backs[0]!, flip: 1 }],
    }),
    false,
  );
});
