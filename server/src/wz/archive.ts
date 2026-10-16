/**
 * `Data.wz` (PKG1) reader: the directory tree, and where each image's bytes really are.
 *
 * The Python twin is `tools/wz1.py` + `tools/wzdata.py`; the numbers in `test/wzimg.test.ts` are
 * the same ones `tools/tests/test_wzimg.py` pins, so the two readers verify each other.
 *
 * EVIDENCE / MEASURED LAYOUT (docs/WZ1_FORMAT.md §1, §2, §4.7)
 * -----------------------------------------------------------
 * container  `"PKG1"`, `u64 shellSize = fileSize - 60`, `u32 dataOffset` (0x3C), a NUL-terminated
 *            description, `u16` version (95 for this 1.11 client). `NameSpace.dll.c` `sub_10028F90`.
 * tree       prefix order: `compact count`, then per entry `u8 tag`, name, `compact size`,
 *            `compact checksum`, `u32 cache key`; child blocks follow after all of a block's
 *            entries. tag 3 = directory, 4 = image, 2 = name back-reference (the `u32` is the
 *            tagged offset of the first entry that spelled the name, minus `dataOffset`).
 * offsets    an entry carries **no offset**. Blobs start at `treeEnd` and follow each other in
 *            tree order - which holds for 922 of the 1,052 images. The tail of this archive has
 *            4 complete `Property` objects that no entry references (172,999 bytes - exactly the
 *            old `fileSize - treeEnd - sum(sizes)` discrepancy) *between* the images, so the last
 *            130 images sit somewhere else than the cumulative sum says.
 * safety     parsing to the exact size is not enough (`Mob/0210100.img`'s declared offset holds
 *            22,122 bytes of noise that parses as one unknown-class object of exactly the right
 *            length), so a blob also has to start with a `Property` root. Misses fall back to a
 *            whole-file scan matched by size, and every image records which route it took.
 *
 * The whole file is read once into a Buffer (87 MB): this is the loader/tool, not a hot path.
 * Nothing outside this module knows how the bytes are stored, so a lazy reader can replace the
 * internals without touching callers.
 */
import { readFileSync } from "node:fs";

import {
  ImageStream, WzCanvas, WzNode, getProperty, parseImage, walkCanvases,
} from "./img.ts";
import type { WzEntry, WzObject, WzTree, WzValue } from "./img.ts";

// Callers of this module work with `WzObject` (a parsed image) as much as with an archive, so the
// type is re-exported instead of making every caller import from `img.ts` as well.
export type { WzEntry, WzObject, WzNode, WzCanvas, WzValue, WzTree, WzEntry as WzProperty } from "./img.ts";

export const TYPE_NAME_REFERENCE = 2;
export const TYPE_DIRECTORY = 3;
export const TYPE_IMAGE = 4;

/** Classes an image blob may start with (measured: all 1,052 are `Property`). */
export const IMAGE_ROOT_CLASSES = ["Property", "#"];

/** The literal every plain `Property` object starts with - the scan's needle. */
export const PROPERTY_MARKER = Buffer.from([0x73, 0xf8, 0xfa, 0xd9, 0xc3, 0xdd, 0xcb, 0xdd, 0xc4, 0xc8]);

export type ResolveSource = "declared" | "scanned" | "missing";

/** One image of the tree, plus the byte range it really occupies. */
export interface WzImageInfo {
  path: string;
  name: string;
  size: number;
  checksum: number;
  cacheKey: number;
  dataOffset: number | null;
  source: ResolveSource;
}

interface TreeNode {
  path: string;
  name: string;
  type: number;
  size: number;
  checksum: number;
  cacheKey: number;
  children: TreeNode[];
}

/** One object of a map's `life`/`portal` list, exactly as the file stores it. */
export type MapObject = Record<string, WzValue>;

export interface MapSummary {
  info: Record<string, WzValue>;
  foothold: number;
  ladderRope: number;
  portal: MapObject[];
  life: MapObject[];
}

/** Where one object of the file starts and how long it is. */
export interface ScanHit {
  offset: number;
  length: number;
}

export class WzArchive {
  readonly path: string;
  readonly shellSize: number;
  readonly dataStart: number;
  readonly description: string;
  readonly wzVersion: number;
  /** Offset of the first image blob (= end of the directory tree). */
  readonly treeEnd: number;
  /** Every image, in tree order, with its verified byte range. */
  readonly images: WzImageInfo[];

  private readonly bytes: Buffer;
  private readonly byPath: Map<string, WzImageInfo>;
  private readonly blobs: Map<string, Buffer>;
  private readonly imagesBySize: Map<number, WzImageInfo[]>;

  static open(path: string): WzArchive {
    const bytes = readFileSync(path);
    if (bytes.subarray(0, 4).toString("latin1") !== "PKG1") {
      throw new Error(`${path}: not a WZ v1 package`);
    }
    const shellSize = Number(bytes.readBigUInt64LE(4));
    const dataStart = bytes.readUInt32LE(12);
    const description = bytes.subarray(16, bytes.indexOf(0, 16)).toString("latin1");
    const wzVersion = bytes.readUInt16LE(dataStart);
    const { tree, treeEnd } = parseTree(bytes, dataStart);
    const images = resolveImages(bytes, tree, treeEnd);
    return new WzArchive({ path, bytes, shellSize, dataStart, description, wzVersion, treeEnd, images });
  }

  private constructor(fields: {
    path: string; bytes: Buffer; shellSize: number; dataStart: number; description: string;
    wzVersion: number; treeEnd: number; images: WzImageInfo[];
  }) {
    this.path = fields.path;
    this.bytes = fields.bytes;
    this.shellSize = fields.shellSize;
    this.dataStart = fields.dataStart;
    this.description = fields.description;
    this.wzVersion = fields.wzVersion;
    this.treeEnd = fields.treeEnd;
    this.images = fields.images;
    this.byPath = new Map(fields.images.map((image) => [image.path, image]));
    this.blobs = new Map();
    this.imagesBySize = new Map();
    for (const image of fields.images) {
      const list = this.imagesBySize.get(image.size) ?? [];
      list.push(image);
      this.imagesBySize.set(image.size, list);
    }
  }

  // -- reading -----------------------------------------------------------
  /** The verified byte range of one image. */
  image(path: string): WzImageInfo | undefined {
    return this.byPath.get(path);
  }

  /** The raw bytes of one image (cached; the views share the file buffer). */
  blob(path: string): Buffer {
    const cached = this.blobs.get(path);
    if (cached !== undefined) return cached;
    const info = this.byPath.get(path);
    if (info === undefined) throw new Error(`no such image: ${path}`);
    if (info.dataOffset === null) throw new Error(`image is unresolved: ${path}`);
    const blob = this.bytes.subarray(info.dataOffset, info.dataOffset + info.size);
    this.blobs.set(path, blob);
    return blob;
  }

  /** The top-level objects of one image. */
  objects(path: string): WzObject[] {
    return parseImage(this.blob(path));
  }

  /**
   * Whether the archive has that image at all - the non-throwing companion of `image()`.
   *
   * `objects()` throws on a path the tree does not have, which is right for a caller that asked for
   * one specific file, but wrong for the many paths the game computes from ids (`Map/Map/%09d.img`,
   * `Mob/%07d.img`): those want "no such map/mob" as a value, not as an exception.
   */
  has(path: string): boolean {
    return this.byPath.has(path);
  }

  /** Every canvas of one image, depth first. */
  canvases(path: string): WzCanvas[] {
    const out: WzCanvas[] = [];
    for (const object of this.objects(path)) walkCanvases(object.props, out);
    return out;
  }

  /** Images of exactly that declared size - the key the scan fallback matches on. */
  imagesOfSize(size: number): WzImageInfo[] {
    return this.imagesBySize.get(size) ?? [];
  }

  /** How many canvases the whole archive holds and whether their pixels come back whole. */
  canvasCensus(): Record<string, number> {
    const stats: Record<string, number> = {};
    const bump = (key: string): void => {
      stats[key] = (stats[key] ?? 0) + 1;
    };
    let canvases = 0;
    for (const image of this.images) {
      let objects: WzObject[];
      try {
        objects = this.objects(image.path);
      } catch (error) {
        bump(`image parse failed: ${(error as Error).name}`);
        continue;
      }
      for (const object of objects) {
        for (const canvas of walkCanvases(object.props)) {
          canvases += 1;
          bump(`fmt ${canvas.format}`);
          if (canvas.pixels === null) bump("pixels not decoded");
          else if (canvas.partial) bump("pixels short (zero padded)");
          else bump("pixels exact");
        }
      }
    }
    stats.canvases = canvases;
    return stats;
  }

  /** Objects in the file that no image of the same size claims (stale leftovers). */
  unlistedObjects(): ScanHit[] {
    const sizes = new Set(this.images.map((image) => image.size));
    return scanFile(this.bytes).filter(({ length }) => !sizes.has(length));
  }

  // -- map metadata ------------------------------------------------------
  /** `info` / `foothold` / `ladderRope` / `portal` / `life` for `Map/Map/*.img`. */
  mapMetadata(ids?: string[]): Record<string, MapSummary> {
    const wanted = ids === undefined ? null : new Set(ids);
    const out: Record<string, MapSummary> = {};
    for (const image of this.images) {
      if (!image.path.startsWith("Map/Map/") || !image.path.endsWith(".img")) continue;
      const mapId = image.path.slice("Map/Map/".length, -".img".length);
      if (wanted !== null && !wanted.has(mapId)) continue;
      out[mapId] = mapSummary(this.objects(image.path)[0]);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// directory tree
// ---------------------------------------------------------------------------
function parseTree(bytes: Buffer, dataStart: number): { tree: TreeNode[]; treeEnd: number } {
  const stream = new ImageStream(bytes);
  stream.p = dataStart + 2; // the version word sits between the header and the tree
  const nameRefs = new Map<number, string>();

  const parseBlock = (prefix: string): TreeNode[] => {
    const count = stream.compact();
    const entries: TreeNode[] = [];
    for (let i = 0; i < count; i++) {
      const tagOffset = stream.p;
      const type = stream.u8();
      let name: string;
      if (type === TYPE_NAME_REFERENCE) {
        const ref = stream.u32();
        const known = nameRefs.get(ref);
        if (known === undefined) throw new Error(`unresolved name reference ${ref} at ${tagOffset}`);
        name = known;
      } else {
        name = stream.string();
        nameRefs.set(tagOffset - dataStart, name);
      }
      entries.push({
        path: prefix ? `${prefix}/${name}` : name,
        name, type,
        size: stream.compact(),
        checksum: stream.compact(),
        cacheKey: stream.u32(),
        children: [],
      });
    }
    for (const entry of entries) {
      if (entry.type === TYPE_DIRECTORY) entry.children = parseBlock(entry.path);
    }
    return entries;
  };

  const tree = parseBlock("");
  return { tree, treeEnd: stream.p };
}

function* walkTree(nodes: TreeNode[]): Generator<TreeNode> {
  for (const node of nodes) {
    yield node;
    if (node.children.length) yield* walkTree(node.children);
  }
}

function imageInfo(node: TreeNode, dataOffset: number | null, source: ResolveSource): WzImageInfo {
  return {
    path: node.path, name: node.name, size: node.size, checksum: node.checksum,
    cacheKey: node.cacheKey, dataOffset, source,
  };
}

// ---------------------------------------------------------------------------
// locating the blobs
// ---------------------------------------------------------------------------
/** `[offset, offset + size)` is one complete image with a `Property` root? */
function parsesExactly(bytes: Buffer, offset: number, size: number): boolean {
  try {
    const objects = parseImage(bytes.subarray(offset, offset + size));
    if (objects.length === 0 || !IMAGE_ROOT_CLASSES.includes(objects[0].cls)) return false;
    return objects[0].offset === 0 && objects[objects.length - 1].end === size;
  } catch {
    return false;
  }
}

/** Every object in the file that starts with the plain `Property` marker. */
export function scanFile(bytes: Buffer): ScanHit[] {
  const out: ScanHit[] = [];
  let at = bytes.indexOf(PROPERTY_MARKER);
  while (at >= 0) {
    const stream = new ImageStream(bytes.subarray(at));
    try {
      stream.one();
      out.push({ offset: at, length: stream.p });
    } catch {
      // Not an object start: the marker also occurs inside nested objects and inside pixel data.
    }
    at = bytes.indexOf(PROPERTY_MARKER, at + 1);
  }
  return out;
}

function resolveImages(bytes: Buffer, tree: TreeNode[], treeEnd: number): WzImageInfo[] {
  const nodes = [...walkTree(tree)].filter((node) => node.type === TYPE_IMAGE);
  const resolved = new Map<string, WzImageInfo>();
  const pending: TreeNode[] = [];
  let offset = treeEnd;
  for (const node of nodes) {
    // The cumulative offset is only a hint: verify the blob before trusting it.
    if (parsesExactly(bytes, offset, node.size)) {
      resolved.set(node.path, imageInfo(node, offset, "declared"));
      offset += node.size;
    } else {
      pending.push(node);
    }
  }
  if (pending.length > 0) {
    const bySize = new Map<number, number[]>();
    for (const hit of scanFile(bytes)) {
      const list = bySize.get(hit.length) ?? [];
      list.push(hit.offset);
      bySize.set(hit.length, list);
    }
    const taken = new Set<number>();
    for (const image of resolved.values()) if (image.dataOffset !== null) taken.add(image.dataOffset);
    for (const node of pending) {
      const candidate = (bySize.get(node.size) ?? []).find((at) => !taken.has(at));
      if (candidate === undefined) {
        resolved.set(node.path, imageInfo(node, null, "missing"));
      } else {
        taken.add(candidate);
        resolved.set(node.path, imageInfo(node, candidate, "scanned"));
      }
    }
  }
  return nodes.map((node) => resolved.get(node.path)!);
}

// ---------------------------------------------------------------------------
// turning values into the shapes callers want
// ---------------------------------------------------------------------------
/** The JSON-safe shape of a decoded value (mirrors `tools/wzdata.py` `plain`). */
export function plain(value: WzTree): unknown {
  if (value instanceof WzCanvas) {
    return {
      __canvas__: true,
      width: value.width,
      height: value.height,
      format: value.format,
      pixel_bytes: value.pixelRaw.length,
      decoded_bytes: value.pixels?.length ?? null,
      props: value.props.map((entry) => [entry.name, entry.type, plain(entry.value)]),
    };
  }
  if (value instanceof WzNode) return plain(value.value);
  if (value instanceof Uint8Array) return { __bytes__: value.length };
  if (Array.isArray(value)) {
    return value.map((item) => (isEntry(item) ? [item.name, item.type, plain(item.value)] : plain(item)));
  }
  if (typeof value === "bigint") return Number(value);
  return value;
}

function isEntry(value: unknown): value is WzEntry {
  return typeof value === "object" && value !== null && "name" in value && "type" in value;
}

/**
 * Properties of a nested object as a plain record.
 *
 * A parsed `WzNode` is the normal case; a value that is *already* plain (a fixture, or data that
 * went through `plain()`) is accepted as well, which keeps `mapSummary` usable without an archive.
 */
function asRecord(node: WzValue | undefined): Record<string, WzValue> {
  if (node instanceof WzNode) {
    const out: Record<string, WzValue> = {};
    for (const entry of node.props) out[entry.name] = entry.value;
    return out;
  }
  if (typeof node !== "object" || node === null || Array.isArray(node) || node instanceof Uint8Array) return {};
  // A canvas is an object too, but its fields are not properties of a WZ node; the parser returns
  // `[]` for everything that is not a property list, so this does the same.
  if (node instanceof WzCanvas) return {};
  return node as unknown as Record<string, WzValue>;
}

/** A property list (`portal`, `life`, ...) as plain records, from a `WzNode` or a plain array. */
function asList(node: WzValue | undefined): Record<string, WzValue>[] {
  const items: WzValue[] = node instanceof WzNode
    ? node.props.map((entry) => entry.value)
    : Array.isArray(node)
      ? (node as WzValue[])
      : [];
  const out: Record<string, WzValue>[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (Object.keys(record).length > 0) out.push(record);
  }
  return out;
}

/** Count the footholds of a `foothold` node (`page` -> `group` -> items). */
function footholdCount(node: WzValue | undefined): number {
  if (!(node instanceof WzNode)) return 0;
  let total = 0;
  for (const page of node.props) {
    if (!(page.value instanceof WzNode)) continue;
    for (const group of page.value.props) {
      if (group.value instanceof WzNode) total += group.value.props.length;
    }
  }
  return total;
}

/** The five nodes the client's map loader reads (`sub_469980`), reduced to useful numbers. */
export function mapSummary(root: WzObject | undefined): MapSummary {
  const summary: MapSummary = { info: {}, foothold: 0, ladderRope: 0, portal: [], life: [] };
  if (root === undefined) return summary;
  for (const entry of root.props) {
    switch (entry.name) {
      case "info":
        summary.info = asRecord(entry.value);
        break;
      case "foothold":
        summary.foothold = footholdCount(entry.value);
        break;
      case "ladderRope":
        summary.ladderRope = entry.value instanceof WzNode ? entry.value.props.length : 0;
        break;
      case "portal":
      case "life":
        summary[entry.name] = asList(entry.value);
        break;
      default:
        break;
    }
  }
  return summary;
}

/**
 * One foothold segment: the client's `FOOTHOLD` item, i.e. the line from `(x1,y1)` to `(x2,y2)`.
 *
 * The WZ tree is `foothold -> <page> -> <group> -> <item>`; the **item key is the foothold id** that
 * `life.fh` and the `CMovePath` element's `foothold` field name, and `prev`/`next` chain segments
 * into a polyline (0 = end of the chain). Verified against every spawn in the game: for all 100 maps
 * (30,338 segments, no duplicate item keys) each of the 2,322 `life` entries resolves to a segment
 * that covers its `x` and whose interpolated y equals its `cy`.
 */
export interface FootholdSegment {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  prev: number;
  next: number;
}

/** Every foothold segment of a map, keyed by foothold id. */
export type FootholdSegments = Map<number, FootholdSegment>;

/** `foothold` -> page -> group -> `<item = foothold id>`: the segments of one map. */
export function footholdSegments(root: WzObject | undefined): FootholdSegments {
  const segments: FootholdSegments = new Map();
  if (root === undefined) return segments;
  const foothold = root.props.find((entry) => entry.name === "foothold")?.value;
  if (!(foothold instanceof WzNode)) return segments;
  for (const page of foothold.props) {
    if (!(page.value instanceof WzNode)) continue;
    for (const group of page.value.props) {
      if (!(group.value instanceof WzNode)) continue;
      for (const item of group.value.props) {
        const id = Number.parseInt(item.name, 10);
        const values = asRecord(item.value);
        const x1 = values.x1;
        const y1 = values.y1;
        const x2 = values.x2;
        const y2 = values.y2;
        if (!Number.isFinite(id) || typeof x1 !== "number" || typeof y1 !== "number") continue;
        if (typeof x2 !== "number" || typeof y2 !== "number") continue;
        segments.set(id, {
          id,
          x1,
          y1,
          x2,
          y2,
          prev: typeof values.prev === "number" ? values.prev : 0,
          next: typeof values.next === "number" ? values.next : 0,
        });
      }
    }
  }
  return segments;
}

/**
 * The polyline one foothold id belongs to, in walking order (`prev`/`next`, not tree order).
 *
 * The chain is what the client's foothold tree links together: `next` walks forward, `prev` walks
 * back to the head. A segment whose neighbours are missing from the map is its own chain.
 */
export function footholdChain(segments: FootholdSegments, id: number): FootholdSegment[] {
  const first = segments.get(id);
  if (first === undefined) return [];
  const chain: FootholdSegment[] = [first];
  const seen = new Set<number>([id]);
  for (const step of ["next", "prev"] as const) {
    let current = first;
    while (current[step] !== 0) {
      const next = segments.get(current[step]);
      if (next === undefined || seen.has(next.id)) break;
      seen.add(next.id);
      if (step === "next") chain.push(next);
      else chain.unshift(next);
      current = next;
    }
  }
  return chain;
}

/** The segment of a chain that covers `x` (the chain is a polyline, so at most one should). */
export function footholdSegmentAt(chain: FootholdSegment[], x: number): FootholdSegment | undefined {
  let best: FootholdSegment | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of chain) {
    const low = Math.min(segment.x1, segment.x2);
    const high = Math.max(segment.x1, segment.x2);
    if (x < low || x > high) continue;
    const distance = Math.abs(x - segment.x1) + Math.abs(x - segment.x2);
    if (distance < bestDistance) {
      best = segment;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The y of a foothold at `x`, interpolated along the segment that covers that x.
 *
 * A foothold that does not reach `x` returns `undefined` rather than a guessed y, because "outside
 * the foothold" is exactly what makes something fall in this game.
 */
export function footholdYAt(chain: FootholdSegment[], x: number): number | undefined {
  const segment = footholdSegmentAt(chain, x);
  if (segment === undefined) return undefined;
  if (segment.x1 === segment.x2) return Math.min(segment.y1, segment.y2);
  const t = (x - segment.x1) / (segment.x2 - segment.x1);
  return Math.round(segment.y1 + t * (segment.y2 - segment.y1));
}

/** The walkable x range of a foothold chain: the union of its segments. */
export function footholdRange(chain: FootholdSegment[]): { x0: number; x1: number } | undefined {
  if (chain.length === 0) return undefined;
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  for (const segment of chain) {
    x0 = Math.min(x0, segment.x1, segment.x2);
    x1 = Math.max(x1, segment.x1, segment.x2);
  }
  return { x0, x1 };
}

/** A property list's `name` -> value lookup. */
export function propsOf(props: WzEntry[]): Record<string, WzValue> {
  const out: Record<string, WzValue> = {};
  for (const entry of props) out[entry.name] = entry.value;
  return out;
}

/** The value of the property `name` in a property list, or `undefined`. */
export function property(props: WzEntry[], name: string): WzValue | undefined {
  return getProperty(props, name);
}
