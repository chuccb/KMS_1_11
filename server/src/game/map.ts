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
import { mapImagePath } from "../wz/paths.ts";
import type { MapObject, MapSummary, WzArchive } from "../wz/archive.ts";

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
  /** Number of foothold segments (the full geometry is not read yet). */
  footholds: number;
  ladderRopes: number;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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
  return {
    templateId,
    x: asNumber(entry.x),
    y: asNumber(entry.y),
    foothold: asNumber(entry.fh),
    facing: asNumber(entry.f, 0) & 1,
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
  const summaries = archive.mapMetadata([String(mapId).padStart(9, "0")]);
  const summary = summaries[String(mapId).padStart(9, "0")];
  return summary === undefined ? undefined : mapDataFrom(summary, mapId);
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
