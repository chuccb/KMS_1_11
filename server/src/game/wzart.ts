/**
 * Archive nodes as art a renderer can place: one canvas out of a property tree, as RGBA and PNG.
 *
 * WHY THIS IS SEPARATE FROM `wz/img.ts`
 * ------------------------------------
 * `wz/img.ts` is the decoder: it turns bytes into `WzCanvas`, `WzNode` and `WzEntry`. This module is
 * the *lookup* on top of it - "the canvas at `Map/Tile/woodMarble.img/bsc/0`", "its `origin`", "what
 * `z` does it name" - which the map layers (`game/mapart.ts`), the character compositor
 * (`game/avatar.ts`) and the NPC/mob sprites (`game/sprites.ts`) all ask for. The path syntax is the
 * archive's own: an image path, then the names of the nodes inside it, separated by `/`.
 *
 * Two things the archive does that a naive walk would get wrong:
 *
 *   - **UOLs.** A hair image does not repeat its canvases for every stance; `stand1/0/hair` is a
 *     `uol` whose value is `../../default/hair`. The target is resolved relative to the node that
 *     holds the UOL, not to the image root, and the chain can have more than one hop.
 *   - **`z`.** A canvas carries its own draw depth as a property. Tiles use a number; character
 *     parts use a name (`body`, `mailChest`, ...) that `zmap.img` orders - see `game/avatar.ts`.
 *
 * Everything is cached by full path: a map asks for the same tile four hundred times, and an idle
 * character asks for the same `stand1/0/body` every half second.
 */
import type { WzEntry, WzNode, WzObject } from "../wz/img.ts";
import { WzNode as WzNodeClass, canvasToRgba } from "../wz/img.ts";
import { encodePng } from "../wz/png.ts";

/** The part of `WzArchive` this module needs, so a test can hand it a fake tree. */
export interface ArtSource {
  has(path: string): boolean;
  objects(path: string): WzObject[];
}

/** One canvas, ready to draw: its pixels, its PNG and the anchor the archive gives it. */
export interface CanvasArt {
  /** Lazily encoded PNG (RGBA, no palette); metadata/compositing must not compress unused parts. */
  png: Uint8Array;
  /** The same pixels, for `game/raster.ts`. */
  rgba: Uint8Array;
  width: number;
  height: number;
  /** `origin` from the canvas' own properties - the point that lands on the object's position. */
  ox: number;
  oy: number;
  /** The canvas' `z` property: a number for tiles, a name for a character part. */
  z: number | string | undefined;
}

/** A path split into its image and the nodes inside it. */
export function splitArtPath(path: string): { image: string; nodes: string[] } {
  const mark = path.indexOf(".img");
  if (mark < 0) throw new RangeError(`art path "${path}" has no .img`);
  const end = path.indexOf("/", mark + 4);
  if (end < 0) return { image: path, nodes: [] };
  return { image: path.slice(0, end), nodes: path.slice(end + 1).split("/") };
}

/** The property of a node by name; `undefined` for anything that is not a property list. */
export function nodeProperty(node: WzNode | undefined, name: string): unknown {
  if (node === undefined || node.kind !== "props") return undefined;
  for (const entry of node.props) if (entry.name === name) return entry.value;
  return undefined;
}

/** Every property of a node as a plain record (empty for a non-`props` node). */
export function nodeRecord(node: WzNode | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (node === undefined || node.kind !== "props") return out;
  for (const entry of node.props) out[entry.name] = entry.value;
  return out;
}

/** A vector (`WzNode` of kind `vector`) as `[x, y]`, or `undefined`. */
export function vectorOf(node: unknown): [number, number] | undefined {
  if (!(node instanceof WzNodeClass) || !Array.isArray(node.value)) return undefined;
  const [x, y] = node.value as [number, number];
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  return [x, y];
}

/**
 * Applies a UOL value to the path of the node that holds it.
 *
 * `base` is the path *of the UOL node itself* - `["stand1", "0", "hair"]` - and a value of
 * `"../../default/hair"` leaves `["default", "hair"]`. Every `..` drops the last part; anything else
 * is appended as further names.
 */
export function uolTarget(base: readonly string[], value: string): string[] {
  const parts = base.slice(0, -1);
  for (const piece of value.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts;
}

/** A reader of canvases over one source, with a cache keyed by full path. */
export interface ArtReader {
  /** The canvas at `path`, or `undefined` when there is no canvas there. */
  at(path: string): CanvasArt | undefined;
  /** The node at `path` (UOLs resolved); used to enumerate frames of an animated object. */
  node(path: string): WzNode | undefined;
  /** How many distinct paths have been resolved - the cache's size, for tests and logs. */
  readonly size: number;
  /** Drops every cached canvas and root (a test that overwrites its fixture). */
  clear(): void;
}

/** Builds the reader. `undefined` in, `undefined` out (`--data off` has no art at all). */
export function artReaderOf(source: ArtSource | undefined): ArtReader | undefined {
  if (source === undefined) return undefined;
  const cache = new Map<string, CanvasArt | undefined>();
  const nodes = new Map<string, WzNode | undefined>();
  const roots = new Map<string, WzObject | undefined>();
  const rootOf = (image: string): WzObject | undefined => {
    if (!roots.has(image))
      roots.set(image, source.has(image) ? source.objects(image)[0] : undefined);
    return roots.get(image);
  };

  /** Walks `parts` from the image root, following UOLs, and hands back the path that landed. */
  const resolvedPaths = new Map<string, string | undefined>();
  const resolve = (
    image: string,
    parts: readonly string[],
  ): { node: WzNode; path: string[] } | undefined => {
    if (parts.length === 0) {
      // The image root itself: a property list, wrapped so the caller sees one node type.
      const root = rootOf(image);
      return root === undefined
        ? undefined
        : { node: new WzNodeClass("props", root.props), path: [] };
    }
    let current = parts.slice();
    for (let hop = 0; hop < 12; hop++) {
      let entries: readonly WzEntry[] = rootOf(image)?.props ?? [];
      let node: WzNode | undefined;
      let uol: string | undefined;
      let index = 0;
      for (; index < current.length; index++) {
        const entry = entries.find((candidate) => candidate.name === current[index]);
        if (entry === undefined || !(entry.value instanceof WzNodeClass)) return undefined;
        const child = entry.value;
        if (child.kind === "uol") {
          uol = typeof child.value === "string" ? child.value : "";
          break;
        }
        node = child;
        entries = child.kind === "props" ? child.props : [];
      }
      if (uol === undefined) return node === undefined ? undefined : { node, path: current };
      current = [...uolTarget(current.slice(0, index + 1), uol), ...current.slice(index + 1)];
    }
    return undefined;
  };

  const reader: ArtReader = {
    get size() {
      return cache.size;
    },
    clear(): void {
      cache.clear();
      nodes.clear();
      roots.clear();
      resolvedPaths.clear();
    },
    node(path: string): WzNode | undefined {
      if (nodes.has(path)) return nodes.get(path);
      const { image, nodes: parts } = splitArtPath(path);
      const landed = resolve(image, parts);
      nodes.set(path, landed?.node);
      // A UOL alias and its target are one canvas; remember where the lookup landed so `at()` can
      // key its cache by the target rather than by the alias.
      resolvedPaths.set(
        path,
        landed === undefined ? undefined : `${image}/${landed.path.join("/")}`,
      );
      return landed?.node;
    },
    at(path: string): CanvasArt | undefined {
      const node = reader.node(path);
      const canonical = resolvedPaths.get(path) ?? path;
      if (cache.has(canonical)) return cache.get(canonical);
      let art: CanvasArt | undefined;
      const canvas = node?.canvas;
      // Compare against native dimensions: level-4 backgrounds have one pixel per 16x16 block.
      // A real partial stream remains invalid, but neither shipped scaled background is partial.
      const needed = canvas?.expectedBytes ?? 0;
      const complete =
        canvas !== undefined &&
        canvas.pixels !== null &&
        (needed === 0 || canvas.pixels.length >= needed);
      if (canvas !== undefined && complete) {
        const rgba = canvasToRgba(canvas);
        if (rgba !== null) {
          let ox = 0;
          let oy = 0;
          let z: number | string | undefined;
          for (const entry of canvas.props) {
            if (entry.name === "origin") {
              const origin = vectorOf(entry.value);
              if (origin !== undefined) [ox, oy] = origin;
            } else if (entry.name === "z") {
              if (typeof entry.value === "number" || typeof entry.value === "string")
                z = entry.value;
            }
          }
          let png: Uint8Array | undefined;
          art = {
            get png() {
              return (png ??= new Uint8Array(encodePng(rgba)));
            },
            rgba: rgba.data,
            width: rgba.width,
            height: rgba.height,
            ox,
            oy,
            z,
          };
        }
      }
      cache.set(canonical, art);
      return art;
    },
  };
  return reader;
}

/**
 * The frames of an animated node (`Mob/*.img/move`, `Map/Obj/*` with two or more canvases), in
 * property order. A node that is a canvas itself is a one-frame animation.
 */
export function frameNames(node: WzNode | undefined): string[] {
  if (node === undefined) return [];
  if (node.kind === "canvas") return [""];
  if (node.kind !== "props") return [];
  const names: string[] = [];
  let index = 0;
  for (;;) {
    if (!node.props.some((entry) => entry.name === String(index))) break;
    names.push(String(index));
    index += 1;
  }
  return names;
}

/** Canvas metadata lives in canvas.props, NOT WzNode.props. Preserve property frames too. */
export function frameProperty(node: WzNode | undefined, name: string): unknown {
  const props = node?.kind === "canvas" ? node.canvas?.props : node?.props;
  return props?.find((entry) => entry.name === name)?.value;
}

/** Read alpha endpoints only when present; -1 means retain, as in the native layer API. */
export function frameAlpha(node: WzNode | undefined): { a0?: number; a1?: number } {
  const result: { a0?: number; a1?: number } = {};
  for (const name of ["a0", "a1"] as const) {
    const value = frameProperty(node, name);
    if (typeof value === "number" && Number.isFinite(value)) result[name] = Math.trunc(value);
  }
  return result;
}

/** The delay of a resolved canvas or a numbered child, including standalone canvases. */
export function frameDelay(node: WzNode | undefined, name: string, fallback: number): number {
  const frame = name === "" ? node : nodeProperty(node, name);
  const delay = frameProperty(frame instanceof WzNodeClass ? frame : undefined, "delay");
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? delay : fallback;
}
