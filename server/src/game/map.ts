/**
 * What the server knows about a map.
 *
 * The client loads its own copy of `Map/Map/%09d.img` when `0x16` names a map id (FINDINGS 4.11.2b),
 * so the server does not have to ship map files - but it does have to read the same image for the
 * parts it must be authoritative about: where the monsters and NPCs stand, where the portals go,
 * and (later) the footholds the movement is checked against. All of that lives in `Data.wz`, which
 * is why this module is a thin translation layer over `WzArchive.mapMetadata()` and nothing else.
 *
 * WZ shape (`Map/Map/001000000.img`, see docs/WZ1_FORMAT.md section 4):
 *
 *   info        mapName/streetName/bgm/returnMap/town/... - `bgm` is the sound path the client
 *               plays, `returnMap` is the id a death/scroll sends you back to
 *   life        one property list per spawn: `type` (`m` = mob, `n` = NPC), `id` (the template id
 *               as a 7-digit *string*), `x`, `y`, `fh` (foothold), `cy`, `rx0`/`rx1` (the region it
 *               may wander in), optionally `f` (facing)
 *   portal      `pn` (name), `pt` (type), `x`, `y`, `tm`/`tn` (target map id / target portal name)
 *   foothold    pages -> groups -> items; this module only counts them for now
 */
import { asNumber, asText, entriesOf, propertyOf } from "../wz/props.ts";
import { mapImagePath } from "../wz/paths.ts";
import { footholdSegments, mapSummary } from "../wz/archive.ts";
import type { FootholdSegments, MapObject, MapSummary, WzArchive } from "../wz/archive.ts";

// The types this module's API is written in come from the archive layer; re-exporting them keeps the
// import list of a caller that only talks maps down to one module.
export type { MapObject, MapSummary, FootholdSegments, WzArchive } from "../wz/archive.ts";

/** A monster or NPC spawn point from the WZ `life` list. */
export interface LifeSpawn {
  /** WZ `id` string parsed: `"0120100"` -> `1210100` (`Mob/0120100.img`). */
  templateId: number;
  x: number;
  y: number;
  /** WZ `fh`: the foothold the spawn sits on, or 0 when the map does not say. */
  foothold: number;
  /** WZ `f`: facing (0 = right, 1 = left; the same meaning the `0x2F` packet carries). */
  facing: number;
  /** WZ `rx0`: the left end of the range the map lets this spawn wander in. */
  rx0: number;
  /** WZ `rx1`: the right end of that range. */
  rx1: number;
  /** WZ `cy`: the foothold's y at `x` (verified for every spawn in the game). */
  cy: number;
}

export interface MapPortal {
  name: string;
  type: number;
  x: number;
  y: number;
  /** WZ `tm`/`tn`: where the portal leads (0 / "" when it is a spawn point). */
  toMapId: number;
  toName: string;
}

export interface MapLadder {
  id: number;
  x: number;
  y1: number;
  y2: number;
  ladder: boolean;
  page?: number;
  upperFoothold?: boolean;
}

export interface MapData {
  id: number;
  /** `Map/Map/%09d.img` - the file the client loads for this map. */
  imagePath: string;
  name: string;
  streetName: string;
  bgm: string;
  returnMapId: number;
  mobs: LifeSpawn[];
  npcs: LifeSpawn[];
  portals: MapPortal[];
  /** Number of foothold segments. */
  footholds: number;
  ladderRopes: number;
  /**
   * The map's foothold geometry, keyed by foothold id (`life.fh`). Only `loadMapData` fills this -
   * `mapDataFrom` gets the count from a `MapSummary`, which does not carry the segments.
   */
  footholdSegments?: FootholdSegments;
  climbables?: MapLadder[];
}

/**
 * The `returnMap` value the shipped data uses for "this map has no map to send you back to": 25 of
 * the 100 maps carry it (`analysis/map_meta.json`). It is **not** a map id - there is no
 * `Map/Map/999999999.img` - so a server that passed it on would send a player into a map nobody can
 * read. Every town carries its own id here instead (`test/map.test.ts` pins that for Henesys).
 */
export const RETURN_MAP_NONE = 999999999;

/**
 * Where the player who revived goes (c2s `0x0D` with `kind = 0`, the `CUIRevive` dialog's OK:
 * `sub_4E9E70` -> `sub_472590(0, nullptr)`, FINDINGS 4.32).
 *
 * The client is no help here: it never reads `returnMap` (the string does not occur anywhere in its
 * code), it only promises "you will be moved to a safe town" and asks the server to do it. So the
 * destination is the server's answer, and the map's own `info/returnMap` is the only thing in the
 * data that answers it. A map whose value is `RETURN_MAP_NONE` sends the player back into the map
 * they died in - the `0x16` that does it is what brings them back to life in the first place
 * (`sub_4C2780` builds a fresh local user, FINDINGS 4.32), so "same map" is a real revive and not a
 * fallback that leaves someone dead.
 *
 * Returns an id, not a promise: whether that map can actually be read is `FieldRegistry`'s answer,
 * and the caller re-enters the current map when it cannot (`GameEntryServer.revive`).
 */
export function reviveMapId(map: MapData): number {
  const target = map.returnMapId;
  return Number.isInteger(target) && target > 0 && target !== RETURN_MAP_NONE ? target : map.id;
}

/** `"0120100"` -> `1210100`; a `life` entry without a usable id is dropped, not guessed at. */
function templateIdOf(entry: MapObject): number | undefined {
  const id = asNumber(entry.id, Number.NaN);
  if (Number.isFinite(id)) return id;
  const text = asText(entry.id);
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toSpawn(entry: MapObject): LifeSpawn | undefined {
  const templateId = templateIdOf(entry);
  if (templateId === undefined) return undefined;
  const x = asNumber(entry.x);
  return {
    templateId,
    x,
    y: asNumber(entry.y),
    foothold: asNumber(entry.fh),
    facing: asNumber(entry.f, 0) & 1,
    // A spawn that does not say where it may wander stands still: x..x is a range of one point.
    rx0: asNumber(entry.rx0, x),
    rx1: asNumber(entry.rx1, x),
    cy: asNumber(entry.cy, asNumber(entry.y)),
  };
}

/** Split the `life` list into mobs and NPCs (`type` is `m` or `n`). */
function toSpawns(life: MapObject[]): { mobs: LifeSpawn[]; npcs: LifeSpawn[] } {
  const mobs: LifeSpawn[] = [];
  const npcs: LifeSpawn[] = [];
  for (const entry of life) {
    const spawn = toSpawn(entry);
    if (spawn === undefined) continue;
    const type = asText(entry.type);
    if (type === "m") mobs.push(spawn);
    else if (type === "n") npcs.push(spawn);
  }
  return { mobs, npcs };
}

/** Turn one `Map/Map/*.img` summary (already plain values) into `MapData`. */
export function mapDataFrom(summary: MapSummary, id: number): MapData {
  const { mobs, npcs } = toSpawns(summary.life);
  const portals: MapPortal[] = summary.portal.map((portal) => ({
    name: asText(portal.pn),
    type: asNumber(portal.pt),
    x: asNumber(portal.x),
    y: asNumber(portal.y),
    toMapId: asNumber(portal.tm),
    toName: asText(portal.tn),
  }));
  return {
    id,
    imagePath: mapImagePath(id),
    name: asText(summary.info.mapName),
    streetName: asText(summary.info.streetName),
    bgm: asText(summary.info.bgm),
    returnMapId: asNumber(summary.info.returnMap),
    mobs,
    npcs,
    portals,
    footholds: summary.foothold,
    ladderRopes: summary.ladderRope,
  };
}

/** Read one map out of `Data.wz`; `undefined` when the archive has no such `Map/Map/*.img`. */
export function loadMapData(archive: WzArchive, mapId: number): MapData | undefined {
  const imagePath = mapImagePath(mapId);
  if (!archive.has(imagePath)) return undefined;
  const root = archive.objects(imagePath)[0];
  if (root === undefined) return undefined;
  const map = mapDataFrom(mapSummary(root), mapId);
  map.footholdSegments = footholdSegments(root);
  map.climbables = entriesOf(propertyOf(root, "ladderRope")).map((entry) => ({
    id: Number(entry.name),
    x: asNumber(propertyOf(entry.value, "x")),
    y1: asNumber(propertyOf(entry.value, "y1")),
    y2: asNumber(propertyOf(entry.value, "y2")),
    ladder: asNumber(propertyOf(entry.value, "l")) !== 0,
    page: asNumber(propertyOf(entry.value, "page")),
    upperFoothold: asNumber(propertyOf(entry.value, "uf")) !== 0,
  }));
  return map;
}

/**
 * A `mapId -> MapData` cache around `loadMapData`, so a running server reads each map once.
 * `undefined` means "no such map" or "no archive attached": callers decide what to do with that.
 */
export function mapDataProvider(archive: WzArchive | undefined): (mapId: number) => MapData | undefined {
  const cache = new Map<number, MapData | undefined>();
  return (mapId: number): MapData | undefined => {
    if (archive === undefined) return undefined;
    if (!cache.has(mapId)) cache.set(mapId, loadMapData(archive, mapId));
    return cache.get(mapId);
  };
}

/** sub_4A3920 appends all non-type-3 portals to the native spawn array in WZ enumeration order. */
export function spawnPortalIndex(map: MapData, name = "sp"): number {
  const portals = map.portals.filter(p => p.type !== 3);
  const index = portals.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  const fallback = portals.findIndex(p => p.name.toLowerCase() === "sp");
  const result = index >= 0 ? index : Math.max(0, fallback);
  if (result > 255) throw new Error("native spawn portal index exceeds u8");
  return result;
}
export interface MapDestination { id: number; name: string; streetName: string }
/** Read-only, lazy list of real archive maps, reusing the game's provider/cache. */
export function mapCatalogOf(archive: WzArchive, provider = mapDataProvider(archive)): () => MapDestination[] {
  let cached: MapDestination[] | undefined;
  return () => cached ??= archive.images.flatMap(image => {
    const match = /^Map\/Map\/(\d{9})\.img$/.exec(image.path);
    if (!match) return [];
    const map = provider(Number(match[1]));
    return map ? [{id:map.id,name:map.name,streetName:map.streetName}] : [];
  }).sort((a,b)=>a.id-b.id);
}
