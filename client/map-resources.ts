import type {
  MapArt,
  MapBack,
  MapBounds,
  MapFrame,
  MapSprite,
  MapTitleArt,
} from "../server/src/game/mapart.ts";
import type { MiniMapArt } from "../server/src/game/minimap.ts";
import type { PhysicalBounds, TerrainSegment } from "./native-terrain.ts";
import type { Ladder } from "./motion-types.ts";
import { isFiniteNumber, isRecord } from "./resource-validation.ts";
import { MAX_MAP_COMMAND_ID, RETURN_MAP_NONE } from "./map-constants.ts";

/** The name-bearing part of the browser's `/api/map/<id>` response. */
export interface BrowserMapName {
  id: number;
  name: string;
  streetName: string;
}

export interface BrowserMapPortal {
  name: string;
  type: number;
  x: number;
  y: number;
  toMapId: number;
  toName: string;
}

export interface BrowserMapSpawn {
  templateId: number;
  x: number;
  y: number;
  foothold: number;
}

/** The exact JSON projection produced by `server/src/net/webclient.ts` for `/api/map/<id>`. */
export interface BrowserMapResource extends BrowserMapName {
  bgm: string;
  recovery: number;
  physicalBounds?: PhysicalBounds;
  portals: BrowserMapPortal[];
  footholds: TerrainSegment[];
  ladders: Ladder[];
  mobs: BrowserMapSpawn[];
  npcs: BrowserMapSpawn[];
}

/** `/api/map/<id>/art` projects `MapArt` without changing its nested shapes. */
export type BrowserMapArtResource = MapArt;

function isMapId(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_MAP_COMMAND_ID &&
    value !== RETURN_MAP_NONE
  );
}

function hasBrowserMapName(value: Record<string, unknown>): boolean {
  return (
    isMapId(value.id) && typeof value.name === "string" && typeof value.streetName === "string"
  );
}

export function isBrowserMapName(value: unknown): value is BrowserMapName {
  return isRecord(value) && hasBrowserMapName(value);
}

/** Keep the original street-before-map ordering used by `/where` and map lookup replies. */
export function browserMapName(value: BrowserMapName): string {
  return [value.streetName, value.name].filter((part) => part.length > 0).join(":");
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isPhysicalBounds(value: unknown): value is PhysicalBounds {
  return (
    isRecord(value) &&
    isFiniteNumber(value.left) &&
    isFiniteNumber(value.top) &&
    isFiniteNumber(value.right) &&
    isFiniteNumber(value.bottom) &&
    value.left <= value.right &&
    value.top <= value.bottom
  );
}

function isTerrainSegment(value: unknown): value is TerrainSegment {
  return (
    isRecord(value) &&
    [value.id, value.x1, value.y1, value.x2, value.y2, value.prev, value.next].every(
      isFiniteNumber,
    ) &&
    isOptionalFiniteNumber(value.layer) &&
    isOptionalFiniteNumber(value.group)
  );
}

function isPortal(value: unknown): value is BrowserMapPortal {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isFiniteNumber(value.type) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.toMapId) &&
    typeof value.toName === "string"
  );
}

function isLadder(value: unknown): value is Ladder {
  return (
    isRecord(value) &&
    isFiniteNumber(value.id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y1) &&
    isFiniteNumber(value.y2) &&
    typeof value.ladder === "boolean" &&
    isOptionalFiniteNumber(value.page) &&
    (value.upperFoothold === undefined || typeof value.upperFoothold === "boolean")
  );
}

function isSpawn(value: unknown): value is BrowserMapSpawn {
  return (
    isRecord(value) &&
    isFiniteNumber(value.templateId) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.foothold)
  );
}

export function isBrowserMapResource(value: unknown): value is BrowserMapResource {
  if (!isRecord(value) || !hasBrowserMapName(value)) return false;
  return (
    typeof value.bgm === "string" &&
    isFiniteNumber(value.recovery) &&
    (value.physicalBounds === undefined || isPhysicalBounds(value.physicalBounds)) &&
    Array.isArray(value.portals) &&
    value.portals.every(isPortal) &&
    Array.isArray(value.footholds) &&
    value.footholds.every(isTerrainSegment) &&
    Array.isArray(value.ladders) &&
    value.ladders.every(isLadder) &&
    Array.isArray(value.mobs) &&
    value.mobs.every(isSpawn) &&
    Array.isArray(value.npcs) &&
    value.npcs.every(isSpawn)
  );
}

function isFrame(value: unknown): value is MapFrame {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    isFiniteNumber(value.delay) &&
    isFiniteNumber(value.ox) &&
    isFiniteNumber(value.oy) &&
    isOptionalFiniteNumber(value.a0) &&
    isOptionalFiniteNumber(value.a1)
  );
}

function isMapBack(value: unknown): value is MapBack {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    [
      value.ox,
      value.oy,
      value.x,
      value.y,
      value.rx,
      value.ry,
      value.type,
      value.cx,
      value.cy,
      value.a,
      value.z,
    ].every(isFiniteNumber) &&
    typeof value.front === "boolean" &&
    typeof value.flip === "boolean"
  );
}

function isMapSprite(value: unknown): value is MapSprite {
  return (
    isRecord(value) &&
    (value.kind === "tile" || value.kind === "obj") &&
    typeof value.layer === "number" &&
    Number.isInteger(value.layer) &&
    value.layer >= 0 &&
    value.layer <= 7 &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    typeof value.flip === "boolean" &&
    Array.isArray(value.frames) &&
    value.frames.length > 0 &&
    value.frames.every(isFrame)
  );
}

function isMapBounds(value: unknown): value is MapBounds {
  return (
    isRecord(value) &&
    isFiniteNumber(value.left) &&
    isFiniteNumber(value.top) &&
    isFiniteNumber(value.right) &&
    isFiniteNumber(value.bottom) &&
    value.left <= value.right &&
    value.top <= value.bottom
  );
}

function isMapTitleArt(value: unknown): value is MapTitleArt {
  return (
    isRecord(value) &&
    typeof value.streetName === "string" &&
    typeof value.mapName === "string" &&
    (value.mark === undefined ||
      (isRecord(value.mark) && typeof value.mark.path === "string" && value.mark.path.length > 0))
  );
}

function isMiniMapArt(value: unknown): value is MiniMapArt {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.canvasWidth === "number" &&
    Number.isSafeInteger(value.canvasWidth) &&
    value.canvasWidth > 0 &&
    typeof value.canvasHeight === "number" &&
    Number.isSafeInteger(value.canvasHeight) &&
    value.canvasHeight > 0 &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    isFiniteNumber(value.centerX) &&
    isFiniteNumber(value.centerY) &&
    typeof value.mag === "number" &&
    Number.isInteger(value.mag) &&
    value.mag >= 0 &&
    value.mag <= 30 &&
    Array.isArray(value.npcs) &&
    value.npcs.every(
      (point: unknown) => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y),
    )
  );
}

/** Deeply validate every field the browser can draw before installing an HTTP art payload. */
export function isBrowserMapArtResource(value: unknown): value is BrowserMapArtResource {
  return (
    isRecord(value) &&
    (value.title === undefined || isMapTitleArt(value.title)) &&
    (value.miniMap === undefined || isMiniMapArt(value.miniMap)) &&
    Array.isArray(value.backs) &&
    value.backs.every(isMapBack) &&
    Array.isArray(value.sprites) &&
    value.sprites.every(isMapSprite) &&
    isMapBounds(value.bounds) &&
    typeof value.missingTiles === "number" &&
    Number.isSafeInteger(value.missingTiles) &&
    value.missingTiles >= 0 &&
    Array.isArray(value.missingTileSets) &&
    value.missingTileSets.every((name: unknown) => typeof name === "string") &&
    Array.isArray(value.portalFrames) &&
    value.portalFrames.every(isFrame)
  );
}
