import { miniMapArt, type MiniMapArt } from "./minimap.ts";
/**
 * The map as pictures: its background stack, and the tile/object layers behind and in front of the
 * characters.
 *
 * The 2003 client reads `Map/Map/%09d.img` itself and loads each canvas from `Map/Back`,
 * `Map/Tile` and `Map/Obj`. The browser cannot read WZ files, so this module turns one map image
 * into a flat list of sprites - path, position, draw depth, flip, animation frames - which the
 * web client serves as JSON and the page draws.
 *
 * THE WZ SHAPE (verified against `Data.wz` and `MapleStory.exe.c` `sub_469980`/`sub_46A1C0`/
 * `sub_46A9F0`)
 * ---------------------------------------------------------------------------------------------
 *   back      `<n>`: `bS` (background set), `no` (canvas in `Map/Back/<bS>.img/back`), `x`, `y`,
 *             `rx`/`ry` (parallax speed), `type` (tiling), `cx`/`cy` (tile spacing), `a` (alpha),
 *             (this build does not read the later `front` flag)
 *   <0..7>    one layer: `info/tS` (default tile set), `tile` entries (`x`, `y`, `u`, `no`, `zM`)
 *             and `obj` entries (`oS`, `l0`, `l1`, `l2`, `x`, `y`, `z`, `zM`, `f`)
 *
 * Draw depth is the client's own arithmetic: `30000 * layer - 10 * zM + canvasZ`
 * (`sub_46A1C0`, the `10 * (3000 * Value - zM)` term). Lower draws first. The `z` of an object
 * entry uses its own band, `30000*layer + z - 17990` relative to the tile base
 * (`sub_46A9F0`); objects do not use the tile zM formula.
 */
import type { WzArchive } from "../wz/archive.ts";
import { entriesOf, propertyOf, asNumber, asText } from "../wz/props.ts";
import {
  artReaderOf,
  frameDelay,
  frameNames,
  frameAlpha,
  nodeRecord,
  type ArtReader,
} from "./wzart.ts";
import type { WzNode } from "../wz/img.ts";

/** One entry of the map's `back` list, as the page needs it. */
export interface MapBack {
  /** The canvas to draw: `Map/Back/<bS>.img/back/<no>`. */
  path: string;
  /** The canvas' `origin`: the pixel that lands on `(x, y)`. */
  ox: number;
  oy: number;
  x: number;
  y: number;
  /** Parallax speed in percent: `-100` moves with the world, `0` is nailed to the screen. */
  rx: number;
  ry: number;
  /** Tiling mode: 0 none, 1 horizontal, 2 vertical, 3 both, 4/5/6/7 the scrolling variants. */
  type: number;
  /** Tile spacing; 0 means "the canvas' own width/height". */
  cx: number;
  cy: number;
  /** 0..255 opacity (the map's `a`, 255 when absent). */
  a: number;
  /** 46BDA0: 1000*index - 1073869824, normalized to the tile base. */
  z: number;
  /** Compatibility field only; KMS 1.11 does not read modern `front`. */
  front: boolean;
  /** Mirrored (`f = 1`); no shipped map in `Data.wz` uses it, but the field exists on the wire. */
  flip: boolean;
}

/** One animated canvas of a tile or object: a path and how long it stays up. */
export interface MapFrame {
  path: string;
  a0?: number;
  a1?: number;
  /** Milliseconds this frame is shown (`delay`); the archive's default when it does not say. */
  delay: number;
  /** The canvas' `origin` - the pixel that lands on the sprite's `(x, y)`. */
  ox: number;
  oy: number;
}

/** One tile or object placed in the world. */
export interface MapSprite {
  kind: "tile" | "obj";
  /** WZ layer (0..7); actors sort on their current foothold page/group in this same z space. */
  layer: number;
  x: number;
  y: number;
  /** Sort key: lower draws first (behind). */
  z: number;
  flip: boolean;
  frames: MapFrame[];
}

/** The rectangle the camera may show, in world coordinates. */
export interface MapBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MapTitleArt {
  streetName: string;
  mapName: string;
  mark?: { path: string };
}

/** Original CField::46DA30: map info strings and MapHelper mark, independent of minimap. */
export function mapTitleArt(root: unknown, reader: ArtReader): MapTitleArt {
  const info = propertyOf(root, "info");
  const streetName = asText(propertyOf(info, "streetName"));
  const mapName = asText(propertyOf(info, "mapName"));
  const mark = asText(propertyOf(info, "mapMark"));
  if (!mark || mark === "None") return { streetName, mapName };
  const path = `Map/MapHelper.img/mark/${mark}`;
  if (!reader.at(path)) throw new Error(`mapMark canvas cannot be read: ${path}`);
  return { streetName, mapName, mark: { path } };
}

export interface MapArt {
  title?: MapTitleArt;
  miniMap?: MiniMapArt;
  backs: MapBack[];
  sprites: MapSprite[];
  bounds: MapBounds;
  /** Unresolved tile placements. The checked-in archive resolves every tile in all 100 maps. */
  missingTiles: number;
  /** The tile sets the map asks for that the archive does not have, for the log line. */
  missingTileSets: string[];
  /**
   * The blue swirl the client draws on a warp portal (`Map/MapHelper.img/portal/game/pv`), shared by
   * every map. Its frames have no `delay` of their own; the 2003 client steps them at 100 ms.
   */
  portalFrames: MapFrame[];
}

/** The portal animation every map uses (`pt == 2`, the visible kind). */
export function portalFrames(reader: ArtReader): MapFrame[] {
  const out: MapFrame[] = [];
  for (let frame = 0; frame < 32; frame++) {
    const path = `Map/MapHelper.img/portal/game/pv/${frame}`;
    const art = reader.at(path);
    if (art === undefined) break;
    out.push({ path, delay: frameDelay(reader.node(path), "", 120), ox: art.ox, oy: art.oy });
  }
  return out;
}

/** `Map/Map/%09d.img`'s `back` list, in the order the client loads it (its own z order). */
export function mapBacks(root: unknown, reader: ArtReader): MapBack[] {
  const out: MapBack[] = [];
  for (const entry of entriesOf(propertyOf(root, "back"))) {
    // sub_46BD54 fetches the i-th background BY NAME itow(i) and hands that positional i to
    // sub_46BDA0, which stamps z = 1000*i - 1073869824 (-147990 against the tile base
    // -1073721834): the entry's key IS the index. A non-numeric key is a back the original
    // loader never fetches, so it never becomes a back here either.
    const index = Number(entry.name);
    if (!Number.isInteger(index) || index < 0) continue;
    const fields = nodeRecord(entry.value as WzNode);
    const bS = asText(fields.bS);
    if (bS === "") continue;
    const no = asNumber(fields.no);
    const art = reader.at(`Map/Back/${bS}.img/back/${no}`);
    if (art === undefined) continue;
    out.push({
      path: `Map/Back/${bS}.img/back/${no}`,
      ox: art.ox,
      oy: art.oy,
      x: asNumber(fields.x),
      y: asNumber(fields.y),
      rx: asNumber(fields.rx),
      ry: asNumber(fields.ry),
      type: asNumber(fields.type),
      cx: asNumber(fields.cx),
      cy: asNumber(fields.cy),
      a: asNumber(fields.a, 255),
      z: 1000 * index - 147990,
      front: false,
      flip: asNumber(fields.f) !== 0,
    });
  }
  // A canvas the archive does not have would be a hole in the sky; drop it here so the page never
  // asks for a 404 it cannot draw.
  return out.filter((back) => reader.at(back.path) !== undefined);
}

/** The animation frames of a node at `path`; `""` for a plain canvas. */
function framesOf(reader: ArtReader, path: string): MapFrame[] {
  const node = reader.node(path);
  if (node === undefined) return [];
  const names = frameNames(node);
  if (names.length === 0) return [];
  const out: MapFrame[] = [];
  for (const name of names) {
    const framePath = name === "" ? path : `${path}/${name}`;
    const art = reader.at(framePath);
    if (art === undefined) continue;
    out.push({
      path: framePath,
      delay: frameDelay(reader.node(framePath), "", 120),
      ...frameAlpha(reader.node(framePath)),
      ox: art.ox,
      oy: art.oy,
    });
  }
  return out;
}

/**
 * The tiles and objects of the eight layers, flattened and sorted back to front.
 *
 * `tilesetOf` is the layer's `info/tS`; a tile's own `u` picks the folder inside that set. An
 * object names all three folders itself (`oS`/`l0`/`l1`/`l2`).
 */
export function mapSprites(root: unknown, reader: ArtReader): MapSprite[] {
  return mapSpriteScan(root, reader).sprites;
}

/** `mapSprites` plus what it could not draw, for `mapArtFrom`. */
function mapSpriteScan(
  root: unknown,
  reader: ArtReader,
): { sprites: MapSprite[]; missingTiles: number; missingTileSets: string[] } {
  const out: MapSprite[] = [];
  let missingTiles = 0;
  const missingTileSets = new Set<string>();
  for (let layer = 0; layer < 8; layer++) {
    const node = entriesOf(root).find((entry) => entry.name === String(layer))?.value;
    if (node === undefined || (node as WzNode).kind !== "props") continue;
    const layerNode = node as WzNode;
    const tileSet = asText(propertyOf(propertyOf(layerNode, "info"), "tS"));
    const base = 30000 * layer;

    for (const entry of entriesOf(propertyOf(layerNode, "tile"))) {
      const fields = nodeRecord(entry.value as WzNode);
      if (tileSet === "") continue;
      const u = asText(fields.u);
      if (u === "") continue;
      const path = `Map/Tile/${tileSet}.img/${u}/${asNumber(fields.no)}`;
      const frames = framesOf(reader, path);
      if (frames.length === 0) {
        missingTiles++;
        if (reader.node(`Map/Tile/${tileSet}.img`) === undefined) missingTileSets.add(tileSet);
        continue;
      }
      const canvasZ = reader.at(frames[0].path)?.z;
      out.push({
        kind: "tile",
        layer,
        x: asNumber(fields.x),
        y: asNumber(fields.y),
        z: base - 10 * asNumber(fields.zM) + (typeof canvasZ === "number" ? canvasZ : 0),
        flip: false,
        frames,
      });
    }

    for (const entry of entriesOf(propertyOf(layerNode, "obj"))) {
      const fields = nodeRecord(entry.value as WzNode);
      const oS = asText(fields.oS);
      if (oS === "") continue;
      const path = `Map/Obj/${oS}.img/${asText(fields.l0)}/${asText(fields.l1)}/${asText(fields.l2)}`;
      const frames = framesOf(reader, path);
      if (frames.length === 0) continue;
      out.push({
        kind: "obj",
        layer,
        x: asNumber(fields.x),
        y: asNumber(fields.y),
        // sub_46A9F0: z + 30000*layer - 1073739824. Normalize to the tile base.
        z: base + asNumber(fields.z) - 17990,
        flip: asNumber(fields.f) !== 0,
        frames,
      });
    }
  }
  // Gr2D 10013D40 uses layer sequence for equal z, never the canvas' world y.
  out.sort((left, right) => left.z - right.z);
  return { sprites: out, missingTiles, missingTileSets: [...missingTileSets].sort() };
}

/** Where the camera may go: the map's `VR*` when it has them, otherwise the art's own extent. */
export function mapBounds(root: unknown, reader: ArtReader): MapBounds {
  const info = propertyOf(root, "info");
  const left = asNumber(propertyOf(info, "VRLeft"), Number.NaN);
  const top = asNumber(propertyOf(info, "VRTop"), Number.NaN);
  const right = asNumber(propertyOf(info, "VRRight"), Number.NaN);
  const bottom = asNumber(propertyOf(info, "VRBottom"), Number.NaN);
  if (
    Number.isFinite(left) &&
    Number.isFinite(top) &&
    Number.isFinite(right) &&
    Number.isFinite(bottom)
  ) {
    return { left, top, right, bottom };
  }
  // No `VR*` (68 of the 100 maps): use what the sprites actually cover, plus a screen of slack so a
  // map whose art stops a little short of its walkable area still scrolls sensibly.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let layer = 0; layer < 8; layer++) {
    const node = entriesOf(root).find((entry) => entry.name === String(layer))?.value as
      WzNode | undefined;
    if (node === undefined) continue;
    const tileSet = asText(propertyOf(propertyOf(node, "info"), "tS"));
    for (const entry of entriesOf(propertyOf(node, "tile"))) {
      const fields = nodeRecord(entry.value as WzNode);
      const path = `Map/Tile/${tileSet}.img/${asText(fields.u)}/${asNumber(fields.no)}`;
      const art = reader.at(path);
      if (art === undefined) continue;
      const x = asNumber(fields.x) - art.ox;
      const y = asNumber(fields.y) - art.oy;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + art.width);
      maxY = Math.max(maxY, y + art.height);
    }
    for (const entry of entriesOf(propertyOf(node, "obj"))) {
      const fields = nodeRecord(entry.value as WzNode);
      const path = `Map/Obj/${asText(fields.oS)}.img/${asText(fields.l0)}/${asText(fields.l1)}/${asText(fields.l2)}`;
      const node2 = reader.node(path);
      const first = frameNames(node2)[0];
      const art = reader.at(first === undefined || first === "" ? path : `${path}/${first}`);
      if (art === undefined) continue;
      const x = asNumber(fields.x) - art.ox;
      const y = asNumber(fields.y) - art.oy;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + art.width);
      maxY = Math.max(maxY, y + art.height);
    }
  }
  if (!Number.isFinite(minX)) return { left: -400, top: -300, right: 400, bottom: 300 };
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}

/** Everything the page needs to draw one map's static art. */
export function mapArtFrom(root: unknown, reader: ArtReader, imagePath?: string): MapArt {
  const scan = mapSpriteScan(root, reader);
  return {
    ...(imagePath ? { miniMap: miniMapArt(root, reader, imagePath) } : {}),
    title: mapTitleArt(root, reader),
    backs: mapBacks(root, reader),
    sprites: scan.sprites,
    bounds: mapBounds(root, reader),
    portalFrames: portalFrames(reader),
    missingTiles: scan.missingTiles,
    missingTileSets: scan.missingTileSets,
  };
}

/** Reads one map's art out of the archive, or `undefined` when the image is not there. */
export function loadMapArt(
  archive: WzArchive,
  mapId: number,
  reader = artReaderOf(archive),
): MapArt | undefined {
  const imagePath = `Map/Map/${String(mapId).padStart(9, "0")}.img`;
  if (!archive.has(imagePath) || reader === undefined) return undefined;
  const root = archive.objects(imagePath)[0];
  if (root === undefined) return undefined;
  return mapArtFrom(root, reader, imagePath);
}

/**
 * A `mapId -> MapArt` cache over one archive, sharing one art reader - the map endpoint and the
 * `/api/art` endpoint must see the same cached canvases, or the first field of a session decodes
 * every tile twice.
 */
export function mapArtProvider(archive: WzArchive | undefined): ((
  mapId: number,
) => MapArt | undefined) & {
  reader: ArtReader | undefined;
} {
  const reader = artReaderOf(archive);
  const cache = new Map<number, MapArt | undefined>();
  const provider = (mapId: number): MapArt | undefined => {
    if (archive === undefined || reader === undefined) return undefined;
    if (!cache.has(mapId)) cache.set(mapId, loadMapArt(archive, mapId, reader));
    return cache.get(mapId);
  };
  return Object.assign(provider, { reader });
}
