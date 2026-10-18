/**
 * The avatar: the look the wire carries, turned into the picture the 2003 client draws.
 *
 * WHAT A LOOK IS
 * --------------
 * The field packets send a face id, a hair id and the ids of the worn items (`0x1C`'s list,
 * `CharacterData.appearanceA`/`B`). Everything else - which canvas, which origin, which draw
 * order - lives in `Data.wz` under `Character/`:
 *
 *   `Character/00002000.img`   body and bare arm, one canvas per stance frame (`stand1/0/body`,
 *                              `stand1/0/arm`, …), each with its own `origin` and a `z` name
 *   `Character/00012000.img`   head; the stance frames are UOLs to `front/head`
 *   `Character/Hair/<id>.img`  `default/hair`, `hairOverHead`, `hairShade`, plus `backDefault/backHair`
 *   `Character/Face/<id>.img`  `default/face` and one folder per emotion (`smile`, `cry`, …)
 *   `Character/<Folder>/<id>`  one image per worn item, parts named after the slot
 *                              (`mail`/`mailArm` for a top, `pants`, `shoes`, `weapon`, …)
 *
 * Origins locate pixels within each part, NOT every part at the feet. Solve the frame's neck,
 * navel, hand and brow anchors first, then sort by the original z names (including armOverHair
 * and armBelowHead during attacks). Part identity must never be inferred from that draw depth.
 *
 * THE `z` ORDER
 * -------------
 * Native 4011C0 assigns decreasing negative ranks to empty zmap entries; explicit integer
 * entries reset the counter. 4C1610 also accepts numeric canvas z. smap maps each canvas z name
 * to visual slots; intersect these with info/vslot before 402130 resolves equipment occlusion.
 * The body/afterimage/face are ordered CHILDREN of one world layer, not separate world depths.
 */
import type { WzArchive } from "../wz/archive.ts";
import { artReaderOf, frameNames, nodeRecord, type ArtReader, type CanvasArt } from "./wzart.ts";
import { bitmapOf, boundsOf, cropBitmap, drawCanvas, type Bitmap } from "./raster.ts";
import { encodePng } from "../wz/png.ts";
import { WzNode } from "../wz/img.ts";
import { faceFramePath, faceImagePath } from "./face.ts";
export { faceImagePath, FACE_EMOTIONS } from "./face.ts";

/** The look: what the packets carry, plus the body/head images that are always the same. */
export interface AvatarLook {
  faceId: number;
  hairId: number;
  /** Worn item ids in slot order (`0x1C` order); the hair is not in this list. */
  items: number[];
}

/** A composed character frame. */
/** A composed frame before it is encoded: the pixels plus where they go relative to the feet. */
export interface AvatarBitmap {
  bitmap: Bitmap;
  /** The left edge of the bitmap in the character's own coordinates (the feet are 0,0). */
  dx: number;
  /** The top edge of the bitmap, negative because it hangs above the feet. */
  dy: number;
  /** 509860 reads canvas originY (+132), NOT height. Preserve the untrimmed composite anchor. */
  damageOriginY?: number;
  /** Packed PNG/bitmap: back plane on top, front plane below, both this many pixels tall. */
  planeHeight?: number;
}

export interface AvatarFrame {
  png: Uint8Array;
  width: number;
  height: number;
  /** Where the picture's top-left goes, relative to the character's position. */
  dx: number;
  dy: number;
  /** 509860 reads canvas originY (+132), NOT height. Preserve the untrimmed composite anchor. */
  damageOriginY?: number;
  /** Packed PNG/bitmap: back plane on top, front plane below, both this many pixels tall. */
  planeHeight?: number;
}

/** `1040001` -> `Clothes` - the folder under `Character/` that holds the item's image. */
export function characterFolderOf(itemId: number): string | undefined {
  // The 2003 archive's own folders (`Character/*`): the first two digits of an item id are its slot.
  const group = Math.floor(itemId / 10000);
  if (group === 100) return "Cap";
  if (group === 101 || group === 102 || group === 103) return "Accessory";
  if (group === 104 || group === 105 || group === 106) return "Clothes";
  if (group === 107) return "Shoes";
  if (group === 108) return "Glove";
  if (group === 109) return "Shield";
  if (group === 110) return "Cape";
  if (group >= 111 && group <= 112) return "Accessory";
  if (group >= 130 && group <= 199) return "Weapon";
  return undefined;
}

/** `Character/<folder>/<8-digit id>.img` for one worn item, or `undefined` for an unknown group. */
export function itemImagePath(itemId: number): string | undefined {
  const folder = characterFolderOf(itemId);
  if (folder === undefined) return undefined;
  return `Character/${folder}/${String(itemId).padStart(8, "0")}.img`;
}

/** `Character/Hair/00030000.img` / `Character/Face/00020000.img`. */
export function hairImagePath(hairId: number): string {
  return `Character/Hair/${String(hairId).padStart(8, "0")}.img`;
}


const BODY_IMAGE = "Character/00002000.img";
const HEAD_IMAGE = "Character/00012000.img";

/** 4011C0: the real native ranks, including explicit numeric resets (not array indices). */
export function zRanksOf(archive: WzArchive): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!archive.has("zmap.img")) return ranks;
  let rank = 0;
  for (const entry of archive.objects("zmap.img")[0]?.props ?? []) {
    const number = entry.value === null || entry.value === undefined || entry.value === ""
      ? NaN : Number(entry.value);
    rank = Number.isFinite(number) ? Math.trunc(number) : rank - 1;
    ranks.set(entry.name, rank);
  }
  return ranks;
}

const slotMaps = new WeakMap<WzArchive, Map<string, string>>();
function slotMapOf(archive: WzArchive): Map<string, string> {
  let map = slotMaps.get(archive);
  if (map) return map;
  map = new Map();
  if (archive.has("smap.img")) for (const entry of archive.objects("smap.img")[0]?.props ?? []) {
    if (typeof entry.value === "string") map.set(entry.name, entry.value);
  }
  slotMaps.set(archive, map);
  return map;
}

/** Two-character slot ids are NOT individual letters: H1 and H5 are different hair regions. */
export function visualSlots(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const out: string[] = [];
  for (let i = 0; i + 1 < value.length; i += 2) out.push(value.slice(i, i + 2));
  return out;
}

/** 4C1610: absent z defaults to 0; numeric strings work; unknown named z is not body/arm. */
export function avatarPartRank(z: CanvasArt["z"], ranks: Map<string, number>): number {
  if (z === undefined) return 0;
  if (typeof z === "number") return Math.trunc(z);
  if (ranks.has(z)) return ranks.get(z)!;
  return z.trim() !== "" && Number.isFinite(Number(z)) ? Math.trunc(Number(z)) : -2147483648;
}

/** 402130, walked back-to-front. Equal islot priorities coexist; a conflict hides a WHOLE part.
 * Owners of earlier slots are deliberately not rolled back after a later conflict, like native.
 */
export function occludeAvatarParts<T extends { slots: string[]; slotRank: number }>(parts: readonly T[]): T[] {
  const owners = new Map<string, T>();
  const hidden = new Set<T>();
  for (const part of parts) {
    for (const slot of part.slots) {
      const owner = owners.get(slot);
      if (owner === undefined) owners.set(slot, part);
      else if (owner.slotRank > part.slotRank) { hidden.add(part); break; }
      else if (owner.slotRank < part.slotRank) { hidden.add(owner); owners.set(slot, part); }
    }
  }
  return parts.filter((part) => !hidden.has(part));
}

/** One canvas placed on the character: the picture, where its origin goes, and its draw rank. */
interface Layer {
  art: CanvasArt;
  /** Position of the canvas' own `origin` in character coordinates (`0,0` is at the feet). */
  x: number;
  y: number;
  rank: number;
  order: number;
  image: string;
  slots: string[];
  slotRank: number;
}

function layerOf(art: CanvasArt, x: number, y: number, image: string,
  ranks: Map<string, number>, order: { value: number }): Layer {
  return { art, x, y, image, rank: avatarPartRank(art.z, ranks), order: order.value++, slots: [], slotRank: -2147483647 };
}

/** What a placed part can anchor other parts to: name -> point in character coordinates. */
type Anchors = Record<string, { x: number; y: number }>;

/** A placed part: the position of its origin and the anchors it publishes. */
interface Parent {
  x: number;
  y: number;
  anchors: Anchors;
}

/**
 * Every `map` anchor of a canvas, as character coordinates.
 *
 * `map.neck = [-4, -32]` on a body canvas means "the neck is 4 left and 32 up from this canvas'
 * origin, in the character's own coordinates", so a canvas whose origin sits at `(x, y)` publishes
 * the neck at `(x - 4, y - 32)`.
 */
function anchorsOf(x: number, y: number, reader: ArtReader, path: string): Anchors {
  const out: Anchors = {};
  const map = reader.node(path)?.canvas?.props.find((entry) => entry.name === "map")?.value;
  if (!(map instanceof WzNode) || map.kind !== "props") return out;
  for (const entry of map.props) {
    const vector = entry.value;
    if (!(vector instanceof WzNode) || vector.kind !== "vector" || !Array.isArray(vector.value)) continue;
    const [ax, ay] = vector.value as [number, number];
    if (typeof ax !== "number" || typeof ay !== "number") continue;
    out[entry.name] = { x: x + ax, y: y + ay };
  }
  return out;
}

/**
 * Placing one part against its parent.
 *
 * The part's own `map` names the point it hangs from (`navel` for clothing, `hand` for a weapon,
 * `brow` for hair and the face, `neck` for the head); the parent's matching anchor is where that
 * point goes. Without a shared name the part goes on the parent's origin, which is what the client
 * does for a part whose anchor the parent does not publish.
 */
const ANCHOR_ORDER = ["hand", "navel", "brow", "neck"] as const;

function placePart(reader: ArtReader, path: string, parents: readonly Parent[]): Parent {
  const own = anchorsOf(0, 0, reader, path);
  for (const name of ANCHOR_ORDER) {
    const mine = own[name];
    if (mine === undefined) continue;
    for (const parent of parents) {
      const theirs = parent.anchors[name];
      if (theirs === undefined) continue;
      const x = theirs.x - mine.x;
      const y = theirs.y - mine.y;
      return { x, y, anchors: anchorsOf(x, y, reader, path) };
    }
  }
  const fallback = parents[parents.length - 1];
  return { x: fallback.x, y: fallback.y, anchors: anchorsOf(fallback.x, fallback.y, reader, path) };
}

/** Adds every part of one frame node (`stand1/0`) that resolves to a canvas, placed against `parent`. */
function addFrameParts(
  reader: ArtReader,
  layers: Layer[],
  framePath: string,
  ranks: Map<string, number>,
  order: { value: number },
  parent: Parent,
  placed?: { skip?: string },
): void {
  const frame = reader.node(framePath);
  if (frame === undefined || frame.kind !== "props") return;
  for (const entry of frame.props) {
    if (placed?.skip !== undefined && entry.name === placed.skip) continue;
    const path = `${framePath}/${entry.name}`;
    const art = reader.at(path);
    if (art === undefined) continue;
    const at = placePart(reader, path, [parent]);
    layers.push(layerOf(art, at.x, at.y, framePath.slice(0, framePath.indexOf(".img") + 4), ranks, order));
  }
}

/** Exact action frame, or undefined; missing equipment poses must not fall back to standing. */
function stanceNode(reader: ArtReader, image: string, stance: string, frame: number): string | undefined {
  for (const [tryStance, tryFrame] of [
    [stance, frame],
    // Missing equipment actions are intentionally invisible (e.g. swords on ropes).
    // The body alone may fall back for an unsupported overall action; never mix poses per item.
  ] as const) {
    const path = `${image}/${tryStance}/${tryFrame}`;
    if (reader.node(path) !== undefined) return path;
  }
  return undefined;
}

/** How many frames a stance has (`stand1`: 3, `walk1`: 4) - the client's animation uses this. */
export function frameCountOf(reader: ArtReader, stance: string): number {
  const node = reader.node(`${BODY_IMAGE}/${stance}`);
  return Math.max(1, node === undefined ? 1 : frameNames(node).length);
}

/** The delay of one body frame (`stand1/0` says 500, `walk1/0` says 180). */
export function frameDelayOf(reader: ArtReader, stance: string, frame: number): number {
  const node = reader.node(`${BODY_IMAGE}/${stance}/${frame}`);
  const delay = node === undefined ? undefined : nodeRecord(node).delay;
  return typeof delay === "number" && delay > 0 ? delay : 180;
}

/**
 * The stance the field shows: the body image's own name for what a character is doing.
 * `stand1` is idle, `walk1`/`walk2` the two walk cycles, `alert` the "!" pause, `jump` a jump.
 */
export function stanceOf(action: number, moving: boolean): string {
  // The wire's action byte is not the stance table (that table is client-side), so the viewer only
  // distinguishes what it can see: moving or not.
  void action;
  return moving ? "walk1" : "stand1";
}

/**
 * Composes one frame of an avatar at its own origin (`0,0` = the character's feet).
 *
 * `emotion` is one of `FACE_EMOTIONS`; `undefined` uses the face's neutral canvas. `flip` mirrors
 * the finished picture; the original WZ canvases face left.
 */
/**
 * The composed pixels of one avatar frame.
 *
 * Every part hangs off an anchor the body publishes (`navel`, `neck`, `hand`, `brow`), which is what
 * makes a 2003 avatar look right: the head is placed on the neck, the weapon in the hand, the shoes
 * under the navel - not each part around its own picture's centre.
 */
export function composeAvatarBitmap(
  archive: WzArchive,
  look: AvatarLook,
  options: {
    stance?: string;
    frame?: number;
    emotion?: string;
    /** Independent face clock index, not the body frame. */
    faceFrame?: number;
    flip?: boolean;
    /** Two same-origin native avatar planes packed vertically; used by the field compositor. */
    planes?: boolean;
    ranks?: Map<string, number>;
    reader?: ArtReader;
  } = {},
): AvatarBitmap | undefined {
  const reader = options.reader ?? artReaderOf(archive);
  if (reader === undefined) return undefined;
  const ranks = options.ranks ?? zRanksOf(archive);
  const requestedStance = options.stance ?? "stand1";
  // 508290 retains WZ info/walk and info/stand. A crossbow/two-handed weapon must not
  // disappear simply because the browser called its neutral stance "stand1".
  let normalStance = requestedStance;
  if (requestedStance === "stand1" || requestedStance === "walk1") {
    const weaponId = look.items.find((id) => id >= 1300000 && id < 1500000);
    const weaponImage = weaponId === undefined ? undefined : itemImagePath(weaponId);
    const info = nodeRecord(weaponImage === undefined ? undefined : reader.node(`${weaponImage}/info`));
    const mode = requestedStance === "stand1" ? "stand" : "walk";
    if (info[mode] === 2) normalStance = `${mode}2`;
  }
  const stance = reader.node(`${BODY_IMAGE}/${normalStance}`) ? normalStance : "stand1";
  const frame = options.frame ?? 0;
  const flip = options.flip === true;
  /** Canvas traversal order is retained for native equal-z parts. */
  const order = { value: 0 };
  let layers: Layer[] = [];

  // -- body (skin): the frame at the character's own origin -----------------
  const bodyFrame = stanceNode(reader, BODY_IMAGE, stance, frame);
  const bodyArt = bodyFrame === undefined ? undefined : reader.at(`${bodyFrame}/body`);
  const body: Parent = bodyArt === undefined
    ? { x: 0, y: 0, anchors: {} }
    : { x: 0, y: 0, anchors: anchorsOf(0, 0, reader, `${bodyFrame}/body`) };
  if (bodyArt !== undefined) {
    layers.push(layerOf(bodyArt, 0, 0, BODY_IMAGE, ranks, order));
  }

  // -- head: hung from the body's neck -------------------------------------
  const headFrame = stanceNode(reader, HEAD_IMAGE, stance, frame);
  const headArt = headFrame === undefined ? undefined : reader.at(`${headFrame}/head`);
  const head: Parent = headArt === undefined
    ? { x: body.x, y: body.y, anchors: body.anchors }
    : placePart(reader, `${headFrame}/head`, [body]);
  if (headArt !== undefined) {
    layers.push(layerOf(headArt, head.x, head.y, HEAD_IMAGE, ranks, order));
  }

  const hairImage = hairImagePath(look.hairId);
  // Do NOT add backDefault/backHair to every front-facing action. The action's own UOL list
  // selects backHair/backHairBelowCap for rope/ladder and individual back-facing attack frames.

  // -- the rest of the body frame: the bare arm, and the hand it publishes --
  if (bodyFrame !== undefined) addFrameParts(reader, layers, bodyFrame, ranks, order, body, { skip: "body" });
  // The arm's z changes during swing/stab. Finding rank=="arm" loses the hand precisely in
  // those attack frames; it also confuses identity with draw order. Keep the original z and
  // locate the actual arm against the same body anchor used by addFrameParts.
  const armPath = bodyFrame === undefined ? undefined : `${bodyFrame}/arm`;
  const hand: Parent | undefined = armPath === undefined || reader.at(armPath) === undefined
    ? undefined : placePart(reader, armPath, [body]);

  // -- worn items ---------------------------------------------------------
  for (const itemId of look.items) {
    const image = itemImagePath(itemId);
    if (image === undefined || Math.floor(itemId / 10000) === 101) continue;
    const framePath = stanceNode(reader, image, stance, frame);
    if (framePath === undefined) continue;
    const parents: Parent[] = hand === undefined ? [head, body] : [hand, head, body];
    const frameNode = reader.node(framePath);
    if (frameNode === undefined || frameNode.kind !== "props") continue;
    for (const entry of frameNode.props) {
      const path = `${framePath}/${entry.name}`;
      const art = reader.at(path);
      if (art === undefined) continue;
      const at = placePart(reader, path, parents);
      layers.push(layerOf(art, at.x, at.y, image, ranks, order));
    }
  }

  // -- hair and face, hung from the head's brow ---------------------------
  const hairFrame = reader.node(`${hairImage}/${stance}/${frame}`) !== undefined
    ? `${hairImage}/${stance}/${frame}`
    : undefined;
  if (hairFrame !== undefined) addFrameParts(reader, layers, hairFrame, ranks, order, head);

  // 408400 merges the 101 face accessory's same expression/frame with the face, on the brow.
  // 102 eyewear/103 earrings still follow their own original body-stance lists above.
  const faceVisible = reader.node(bodyFrame ?? "")?.get("face") !== 0;
  if (faceVisible) {
    const expression = options.emotion;
    const faceFrame = options.faceFrame ?? 0;
    const images = [faceImagePath(look.faceId), ...look.items
      .filter((id) => Math.floor(id / 10000) === 101)
      .map(itemImagePath).filter((path): path is string => path !== undefined)];
    for (const image of images) {
      const path = faceFramePath(reader, image, expression, faceFrame);
      if (path) addFrameParts(reader, layers, path, ranks, order, head);
    }
  }

  // -- compose ------------------------------------------------------------
  if (layers.length === 0) return undefined;
  layers.sort((left, right) => left.rank - right.rank || left.order - right.order);
  const smap = slotMapOf(archive);
  const infos = new Map<string, { slots: Set<string>; rank: number }>();
  for (const layer of layers) {
    let info = infos.get(layer.image);
    if (!info) {
      const raw = nodeRecord(reader.node(`${layer.image}/info`));
      const priorities = visualSlots(raw.islot).map((slot) => ranks.get(slot)).filter((rank): rank is number => rank !== undefined);
      info = { slots: new Set(visualSlots(raw.vslot)), rank: Math.max(-2147483647, ...priorities) };
      infos.set(layer.image, info);
    }
    layer.slotRank = info.rank;
    layer.slots = typeof layer.art.z === "string"
      ? visualSlots(smap.get(layer.art.z)).filter((slot) => info.slots.has(slot)) : [];
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    const { art } = layer;
    // Mirror part positions around x=0 as well as the pixels, or the sword stays in the old hand.
    // Native WZ faces left; flip=true is the right-facing composition.
    const x = flip ? -layer.x : layer.x;
    const left = flip ? x + art.ox - (art.width - 1) : x - art.ox;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + art.width - 1);
    minY = Math.min(minY, layer.y - art.oy);
    maxY = Math.max(maxY, layer.y - art.oy + art.height - 1);
  }
  const width = Math.ceil(maxX - minX + 1);
  const height = Math.ceil(maxY - minY + 1);
  if (width <= 0 || height <= 0 || width > 400 || height > 400) return undefined;
  const canvas = bitmapOf(width, height);
  const back = bitmapOf(width, height);
  const front = bitmapOf(width, height);
  const faceRank = ranks.get("face") ?? -36;
  for (const layer of occludeAvatarParts(layers)) {
    const { art } = layer;
    const plane = layer.rank >= faceRank ? front : back;
    drawCanvas(plane, { width: art.width, height: art.height, data: art.rgba },
      (flip ? -layer.x : layer.x) - minX, layer.y - minY, art.ox, art.oy, 255, flip);
  }
  // Even the flat preview folds the two native canvases (RGBA8 source-over is not exactly
  // associative after rounding). This also makes the packed and flat origins/crops identical.
  drawCanvas(canvas, back, 0, 0);
  drawCanvas(canvas, front, 0, 0);
  // Same crop/origin for both native planes: don't move face/hair independently of the body.
  if (options.planes) {
    const bounds = boundsOf(canvas) ?? { left: 0, top: 0, right: width - 1, bottom: height - 1 };
    const lower = cropBitmap(back, bounds), upper = cropBitmap(front, bounds);
    const packed = bitmapOf(lower.width, lower.height * 2);
    packed.data.set(lower.data);
    packed.data.set(upper.data, lower.data.length);
    return { bitmap: packed, dx: bounds.left + minX, dy: bounds.top + minY,
      damageOriginY: Math.max(0, -minY), planeHeight: lower.height };
  }
  const trimmed = trimTransparent(canvas);
  return { bitmap: trimmed.image, dx: trimmed.left + minX, dy: trimmed.top + minY, damageOriginY: Math.max(0, -minY) };
}

/** The same frame as a PNG, plus the offsets the browser needs to place it. */
export function composeAvatar(
  archive: WzArchive,
  look: AvatarLook,
  options: {
    stance?: string;
    frame?: number;
    emotion?: string;
    /** Independent face clock index, not the body frame. */
    faceFrame?: number;
    flip?: boolean;
    /** Two same-origin native avatar planes packed vertically; used by the field compositor. */
    planes?: boolean;
    ranks?: Map<string, number>;
    reader?: ArtReader;
  } = {},
): AvatarFrame | undefined {
  const composed = composeAvatarBitmap(archive, look, options);
  if (composed === undefined) return undefined;
  return {
    png: encodePng(composed.bitmap),
    width: composed.bitmap.width,
    height: composed.bitmap.height,
    dx: composed.dx,
    dy: composed.dy,
    damageOriginY: composed.damageOriginY,
    ...(composed.planeHeight !== undefined ? { planeHeight: composed.planeHeight } : {}),
  };
}

/** Cuts the transparent border off, keeping the offset of what is left. */
function trimTransparent(image: Bitmap): { image: Bitmap; left: number; top: number } {
  const bounds = boundsOf(image);
  if (bounds === undefined) return { image, left: 0, top: 0 };
  return { image: cropBitmap(image, bounds), left: bounds.left, top: bounds.top };
}

/** A one-entry list of the look, for callers that only have a hair and a face (an NPC-style test). */
export function lookOf(faceId: number, hairId: number, items: readonly number[] = []): AvatarLook {
  return { faceId, hairId, items: [...items] };
}

/** The worn item ids a `0x1C` look list carries (the hair is the first entry). */
export function wornItemsOf(look: readonly number[]): { hair: number; items: number[] } {
  return { hair: look[0] ?? 30000, items: look.slice(1) };
}
