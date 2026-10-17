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
 * Every canvas is already in the character's own coordinate system: its `origin` is the point that
 * sits on the character's position (the feet), so the compositor never solves an anchor chain - it
 * adds the pictures in `z` order.
 *
 * THE `z` ORDER
 * -------------
 * `z` is a *name* (`body`, `mailChest`, `hair`, `weapon`, …), and `zmap.img` lists those names in the
 * order the client walks them. The list starts with the frontmost part and ends with the backmost
 * (`body` before `head` before `hair` before `cap`, `backHair` last), so a smaller index draws later.
 * This module caches that table and turns a `z` name into a rank; an unknown name falls back to the
 * part's own name and then to `body`, which keeps a modded item visible instead of invisible.
 */
import type { WzArchive } from "../wz/archive.ts";
import { artReaderOf, frameNames, nodeRecord, type ArtReader, type CanvasArt } from "./wzart.ts";
import { bitmapOf, boundsOf, cropBitmap, drawCanvas, type Bitmap } from "./raster.ts";
import { encodePng } from "../wz/png.ts";
import { WzNode } from "../wz/img.ts";

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
}

export interface AvatarFrame {
  png: Uint8Array;
  width: number;
  height: number;
  /** Where the picture's top-left goes, relative to the character's position. */
  dx: number;
  dy: number;
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
export function faceImagePath(faceId: number): string {
  return `Character/Face/${String(faceId).padStart(8, "0")}.img`;
}

const BODY_IMAGE = "Character/00002000.img";
const HEAD_IMAGE = "Character/00012000.img";

/**
 * The `z` table: name -> rank, read once from `zmap.img`.
 *
 * The archive lists the names front to back, so `rank = names.length - index` (a bigger rank draws
 * later). A caller can hand its own table (tests), and a name the table does not know gets `0`.
 */
export function zRanksOf(archive: WzArchive): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!archive.has("zmap.img")) return ranks;
  const names = archive.objects("zmap.img")[0]?.props.map((entry) => entry.name) ?? [];
  names.forEach((name, index) => ranks.set(name, names.length - index));
  // The five names a body part can have that `zmap.img` in this data file does not list, with the
  // ranks that keep them on the right side of the parts around them.
  const fallbacks: Record<string, number> = {
    body: 60,
    arm: 40,
    hand: 45,
    lHand: 45,
    rHand: 45,
    head: 55,
    face: 50,
  };
  for (const [name, rank] of Object.entries(fallbacks)) if (!ranks.has(name)) ranks.set(name, rank);
  return ranks;
}

/** One canvas placed on the character: the picture, where its origin goes, and its draw rank. */
interface Layer {
  art: CanvasArt;
  /** Position of the canvas' own `origin` in character coordinates (`0,0` is at the feet). */
  x: number;
  y: number;
  rank: number;
  order: number;
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
    const zName = typeof art.z === "string" ? art.z : entry.name;
    layers.push({ art, x: at.x, y: at.y, rank: ranks.get(zName) ?? ranks.get(entry.name) ?? 0, order: order.value++ });
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

/** The emotion folders `Face/*.img` carries, in the wire's order (`EMOTION_NAMES`). */
export const FACE_EMOTIONS = [
  "blink",
  "hit",
  "smile",
  "troubled",
  "cry",
  "angry",
  "bewildered",
  "stunned",
  "vomit",
] as const;

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
 * the finished picture, because every WZ canvas is drawn facing right.
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
    flip?: boolean;
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
  /** Insertion order breaks `z` ties the way the client's own list does. */
  const order = { value: 0 };
  const layers: Layer[] = [];

  // -- body (skin): the frame at the character's own origin -----------------
  const bodyFrame = stanceNode(reader, BODY_IMAGE, stance, frame);
  const bodyArt = bodyFrame === undefined ? undefined : reader.at(`${bodyFrame}/body`);
  const body: Parent = bodyArt === undefined
    ? { x: 0, y: 0, anchors: {} }
    : { x: 0, y: 0, anchors: anchorsOf(0, 0, reader, `${bodyFrame}/body`) };
  if (bodyArt !== undefined) {
    layers.push({ art: bodyArt, x: 0, y: 0, rank: ranks.get(typeof bodyArt.z === "string" ? bodyArt.z : "body") ?? 0, order: order.value++ });
  }

  // -- head: hung from the body's neck -------------------------------------
  const headFrame = stanceNode(reader, HEAD_IMAGE, stance, frame);
  const headArt = headFrame === undefined ? undefined : reader.at(`${headFrame}/head`);
  const head: Parent = headArt === undefined
    ? { x: body.x, y: body.y, anchors: body.anchors }
    : placePart(reader, `${headFrame}/head`, [body]);
  if (headArt !== undefined) {
    layers.push({ art: headArt, x: head.x, y: head.y, rank: ranks.get(typeof headArt.z === "string" ? headArt.z : "head") ?? 0, order: order.value++ });
  }

  // -- back hair, behind everything ---------------------------------------
  const hairImage = hairImagePath(look.hairId);
  const backHairPath = `${hairImage}/backDefault/backHair`;
  const backHair = stance === "rope" || stance === "ladder" ? undefined : reader.at(backHairPath);
  if (backHair !== undefined) {
    const at = placePart(reader, backHairPath, [head, body]);
    layers.push({ art: backHair, x: at.x, y: at.y, rank: ranks.get("backHair") ?? 0, order: order.value++ });
  }

  // -- the rest of the body frame: the bare arm, and the hand it publishes --
  if (bodyFrame !== undefined) addFrameParts(reader, layers, bodyFrame, ranks, order, body, { skip: "body" });
  const armLayer = layers.find((layer) => layer.rank === (ranks.get("arm") ?? 0));
  const hand: Parent | undefined = armLayer === undefined
    ? undefined
    : {
        x: armLayer.x,
        y: armLayer.y,
        anchors: anchorsOf(armLayer.x, armLayer.y, reader, `${bodyFrame}/arm`),
      };

  // -- worn items ---------------------------------------------------------
  for (const itemId of look.items) {
    const image = itemImagePath(itemId);
    if (image === undefined) continue;
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
      const zName = typeof art.z === "string" ? art.z : entry.name;
      layers.push({ art, x: at.x, y: at.y, rank: ranks.get(zName) ?? ranks.get(entry.name) ?? 0, order: order.value++ });
    }
  }

  // -- hair and face, hung from the head's brow ---------------------------
  const hairFrame = reader.node(`${hairImage}/${stance}/${frame}`) !== undefined
    ? `${hairImage}/${stance}/${frame}`
    : `${hairImage}/default`;
  addFrameParts(reader, layers, hairFrame, ranks, order, head);

  const faceImage = faceImagePath(look.faceId);
  const emotion = options.emotion;
  const facePath = emotion !== undefined && reader.node(`${faceImage}/${emotion}/0/face`) !== undefined
    ? `${faceImage}/${emotion}/0`
    : `${faceImage}/default`;
  // Body frame face=0 is the original back-facing action flag, not an absent face asset.
  const faceVisible = reader.node(bodyFrame ?? "")?.get("face") !== 0;
  if (faceVisible) addFrameParts(reader, layers, facePath, ranks, order, head);

  // -- compose ------------------------------------------------------------
  if (layers.length === 0) return undefined;
  layers.sort((left, right) => left.rank - right.rank || left.order - right.order);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    const { art } = layer;
    // A left-facing character is the mirror of the right-facing one: the part positions flip around
    // x = 0 as well, not only the pictures, or the sword would stay in the same hand.
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
  for (const layer of layers) {
    const { art } = layer;
    drawCanvas(
      canvas,
      { width: art.width, height: art.height, data: art.rgba },
      (flip ? -layer.x : layer.x) - minX,
      layer.y - minY,
      art.ox,
      art.oy,
      255,
      flip,
    );
  }
  const trimmed = trimTransparent(canvas);
  return { bitmap: trimmed.image, dx: trimmed.left + minX, dy: trimmed.top + minY };
}

/** The same frame as a PNG, plus the offsets the browser needs to place it. */
export function composeAvatar(
  archive: WzArchive,
  look: AvatarLook,
  options: {
    stance?: string;
    frame?: number;
    emotion?: string;
    flip?: boolean;
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
