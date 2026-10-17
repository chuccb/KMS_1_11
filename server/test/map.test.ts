/**
 * `src/game/map.ts` - the server's view of a map, read out of the same `Data.wz` the client reads.
 *
 * The point of these tests is the contract between the two halves of a rebuild: the client loads
 * `Map/Map/%09d.img` for itself (FINDINGS 4.11.2b), so the server only has to agree with it about
 * *spawns*. If the numbers here drift, monsters appear (or fail to appear) somewhere the map file
 * does not have them.
 *
 * The synthetic half runs always; the archive half skips itself when `Data.wz` is not checked out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WzArchive, mapSummary, type MapObject, type WzObject } from "../src/wz/archive.ts";
import { RETURN_MAP_NONE, mapCatalogOf, spawnPortalIndex, mapDataFrom, mapDataProvider, loadMapData, reviveMapId, type MapData } from "../src/game/map.ts";
import { encodeMobEnterField } from "../src/protocol/mob.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

/** The map `DEFAULT_MAP_ID` names - the one the game server sends a fresh character into. */
const DEFAULT_MAP = 1000000;
/** 헤네시스: a town, so it has NPCs and no monsters at all. */
const HENESYS = 100000000;
/** 달팽이사냥터 (the snail field next to Amherst): monsters and one NPC. */
const SNAIL_FIELD = 40000;

test("life entries become spawns, and an entry the WZ does not describe is dropped", () => {
  const life: MapObject[] = [
    { type: "m", id: "0120100", x: 509, y: 300, fh: 32, f: 1 },
    { type: "m", id: 1210100, x: -1, y: -2, fh: 0 }, // a number, not a 7-digit string
    { type: "n", id: "1012000", x: 0, y: 0, fh: 1 },
    { type: "m", x: 1, y: 1, fh: 1 }, // no id: not a spawn we can name
    { type: "x", id: "1210100", x: 0, y: 0, fh: 0 }, // neither "m" nor "n"
  ];
  const summary = mapSummary({
    props: [{ name: "life", value: life }, { name: "info", value: { mapName: "Test" } }],
  } as unknown as WzObject);
  const map = mapDataFrom(summary, 1234);
  assert.deepEqual(map.mobs, [
    { templateId: 120100, x: 509, y: 300, foothold: 32, facing: 1, rx0: 509, rx1: 509, cy: 300 },
    // `f` defaults to 0 = right; `rx0`/`rx1`/`cy` fall back to the spawn itself when the WZ is silent
    { templateId: 1210100, x: -1, y: -2, foothold: 0, facing: 0, rx0: -1, rx1: -1, cy: -2 },
  ]);
  assert.deepEqual(map.npcs, [
    { templateId: 1012000, x: 0, y: 0, foothold: 1, facing: 0, rx0: 0, rx1: 0, cy: 0 },
  ]);
  assert.equal(map.name, "Test");
  assert.equal(map.imagePath, "Map/Map/000001234.img", "the client's own path (%09d), not a server file");
  assert.deepEqual(map.portals, []);
});

test("a portal keeps both halves of its target, so a warp can be validated", () => {
  const summary = mapSummary({
    props: [
      {
        name: "portal",
        value: [
          { pn: "sp", pt: 0, x: 100, y: 200, tm: 0, tn: "" },
          { pn: "out00", pt: 1, x: -5, y: -6, tm: 1000000, tn: "in00" },
        ],
      },
    ],
  } as unknown as WzObject);
  const map = mapDataFrom(summary, 1);
  assert.deepEqual(map.portals, [
    { name: "sp", type: 0, x: 100, y: 200, toMapId: 0, toName: "" },
    { name: "out00", type: 1, x: -5, y: -6, toMapId: 1000000, toName: "in00" },
  ]);
});

test("the default map has monsters, and each one encodes into a legal 0x2F", needsArchive, () => {
  const map = loadMapData(archive!, DEFAULT_MAP);
  assert.notEqual(map, undefined, `map ${DEFAULT_MAP} must be in Data.wz`);
  const data = map as MapData;
  assert.equal(data.imagePath, "Map/Map/001000000.img");
  assert.ok(data.mobs.length > 0, "a fresh character is sent to a map that has something to fight");
  assert.equal(data.npcs.length, 0);
  assert.ok(data.bgm.length > 0, "the map names a BGM the client can play");
  assert.ok(data.portals.length > 0);
  assert.ok(data.footholds > 0, "the spawns stand on real footholds");

  for (const [index, mob] of data.mobs.entries()) {
    const bytes = encodeMobEnterField({ mobId: index + 1, templateId: mob.templateId, x: mob.x, y: mob.y, facing: mob.facing });
    assert.equal(bytes[0], 0x2f);
    assert.ok(mob.templateId > 0, `mob ${index} has a template id`);
    assert.ok(mob.facing === 0 || mob.facing === 1, `mob ${index} faces left or right, not ${mob.facing}`);
    assert.ok(mob.x > -32768 && mob.x < 32768 && mob.y > -32768 && mob.y < 32768, "coordinates fit s16");
  }
});

test("a town is all NPCs and no monsters", needsArchive, () => {
  const map = loadMapData(archive!, HENESYS);
  assert.notEqual(map, undefined);
  const data = map as MapData;
  assert.equal(data.imagePath, "Map/Map/100000000.img");
  assert.equal(data.mobs.length, 0, "헤네시스 has nothing to spawn");
  assert.equal(data.npcs.length, 2);
  assert.deepEqual(data.npcs.map((npc) => npc.templateId), [1012000, 1010100], "Heena and Roger");
  assert.equal(data.name, "헤네시스");
  assert.equal(data.returnMapId, HENESYS, "a town sends you back to itself");
});

test("a monster field spawns the ids the WZ lists, in order", needsArchive, () => {
  const map = loadMapData(archive!, SNAIL_FIELD);
  assert.notEqual(map, undefined);
  const data = map as MapData;
  assert.equal(data.imagePath, "Map/Map/000040000.img");
  assert.equal(data.mobs.length, 63);
  assert.equal(data.npcs.length, 1);
  assert.equal(data.mobs[0]?.templateId, 100100, "the first life entry is the snail (0100100)");
  assert.ok(data.mobs.every((mob) => mob.templateId > 0));
  assert.ok(data.mobs.some((mob) => mob.foothold > 0), "spawns are anchored to footholds");
});

test("a revive goes to the map's own info/returnMap, and to the map itself when the data has none", () => {
  const withReturnMap = (returnMap: unknown): MapData =>
    mapDataFrom(
      mapSummary({
        props: [{ name: "info", value: { mapName: "Test", returnMap } }],
      } as unknown as WzObject),
      40000,
    );
  assert.equal(reviveMapId(withReturnMap(100000000)), 100000000, "the town the map names");
  assert.equal(
    reviveMapId(withReturnMap(RETURN_MAP_NONE)),
    40000,
    "999999999 is not a map id: a town sends you back into itself",
  );
  assert.equal(reviveMapId(withReturnMap(undefined)), 40000, "no returnMap at all is the same answer");
});

test("an unknown map id is undefined, not an empty map", needsArchive, () => {
  assert.equal(loadMapData(archive!, 999999999), undefined);
  assert.equal(loadMapData(archive!, 1), undefined, "map 1 has no Map/Map/*.img either");
});

test("the real data sends a field to its town and a town back to itself", needsArchive, () => {
  const field = loadMapData(archive!, DEFAULT_MAP) as MapData;
  assert.equal(field.returnMapId, 1010000, "the field next to Amherst names the town");
  assert.equal(reviveMapId(field), 1010000);
  const town = loadMapData(archive!, 1010000) as MapData;
  assert.equal(town.name, "암허스트");
  assert.equal(town.returnMapId, RETURN_MAP_NONE, "a town has no map to send you back to");
  assert.equal(reviveMapId(town), 1010000, "so a revive there re-enters the town");
  assert.equal(loadMapData(archive!, RETURN_MAP_NONE), undefined, "and the sentinel is not a map");
});

test("the provider reads each map once and can be handed anywhere", needsArchive, () => {
  const provider = mapDataProvider(archive!);
  const first = provider(DEFAULT_MAP);
  assert.equal(provider(DEFAULT_MAP), first, "the second call is the cached object");
  assert.equal(provider(SNAIL_FIELD)?.imagePath, "Map/Map/000040000.img");
  assert.equal(provider(999999999), undefined, "a miss is cached too, and stays a miss");
  assert.equal(mapDataProvider(undefined)(DEFAULT_MAP), undefined, "no archive means no maps");
});

test("native spawn portal index excludes type 3 but includes sp and hidden type 1", needsArchive, () => {
  const base = loadMapData(archive!, DEFAULT_MAP)!;
  const portal = base.portals[0]!;
  const map = {...base,portals:[{...portal,name:"sp",type:0},{...portal,name:"auto",type:3},{...portal,name:"hidden",type:1},{...portal,name:"door",type:2}]};
  assert.equal(spawnPortalIndex(map,"HIDDEN"),1);
  assert.equal(spawnPortalIndex(map,"door"),2);
  assert.equal(spawnPortalIndex(map,"auto"),0);
  assert.equal(spawnPortalIndex(map,"missing"),0);
});
test("real archive map catalog is cached and includes actual map zero; tn names resolve in native spawn pool", needsArchive, () => {
  const provider=mapDataProvider(archive!),catalog=mapCatalogOf(archive!,provider);
  const maps=catalog();assert.equal(maps.length,100);assert.equal(catalog(),maps);
  assert.equal(maps[0]!.id,0);assert.ok(maps[0]!.name.length>0);
  const map=provider(1000000)!,destination=provider(map.portals.find(p=>p.name==="east00")!.toMapId)!;
  const index=spawnPortalIndex(destination,"west00");
  assert.equal(destination.portals.filter(p=>p.type!==3)[index]!.name,"west00");
  assert.notEqual(index,spawnPortalIndex(destination,"sp"));
});

// Regression source only; new recovery work was not executed for this delivery.
test("4707E0 recovery multiplier defaults to one, and zero is not replaced with a fabricated heal",()=>{
  const base={info:{},life:[],portal:[],foothold:0,ladderRope:0};
  assert.equal(mapDataFrom(base,1000000).recovery,1);
  assert.equal(mapDataFrom({...base,info:{recovery:0}},1000000).recovery,0);
  assert.equal(mapDataFrom({...base,info:{recovery:1.5}},1000000).recovery,1.5);
});
