/**
 * WZ v1 `.img` value codec - the reader the client's own DLLs implement.
 *
 * Every rule here is pinned twice: against the disassembly and against the shipped `Data.wz`,
 * where all 1,056 images parse to exactly their declared size. The Python twin (`tools/wzimg.py`)
 * is the reference implementation; the two have to agree byte for byte, so the goldens in
 * `test/wzimg.test.ts` are the same numbers as in `tools/tests/test_wzimg.py`.
 *
 * EVIDENCE (all line numbers refer to this repo's decompiler dumps)
 * ----------------------------------------------------------------
 * object markers    `PCOM.dll.c` 16644 (writer: `sub_1000C9A0(name, stream, 0x1B, 0x73)`, the
 *                   reference marker first and the inline marker second) and 16702 (reader
 *                   `switch`: `0x23` = "#", `0x1B` = name-table reference, `0x73` = inline name,
 *                   `0x41` = end of the object sequence).
 * name table        a string is interned at the offset of its own length byte, *relative to the
 *                   start of the image* - the `.img` sub-files were serialised standalone before
 *                   they were copied into the archive. `0x1B`, entry tag 1, string flag 1 and
 *                   `UOL` kind 1 all carry that key. Measured: 697,218 references, no misses.
 * property list     `PCOM.dll.c` 25740-25880 (reader: one tag byte per entry, then
 *                   `sub_1000D020(dst, table, tag)`), 25770 (writer).
 * type table        `PCOM.dll.c` `sub_10018800` - 15 cases: 0,2,3,4,5,6,7,8,9,11,13,16,17,18,19.
 *                   Only 3/4/19 are the one-byte "compact" integer; 2/11/16/17/18 are u16.
 * class bodies      `Canvas.dll.c` `sub_1001D560` (canvas header, "Property" literal at 28799)
 *                   and `sub_1001DE50` (pixel block: flag byte, then zlib, 29177).
 * pixels            `ZLZ.dll` is stock zlib 1.1.3. This build's writer drops the 4-byte adler32
 *                   trailer, so one-shot inflate rejects the stream while the client's
 *                   incremental inflate into a pre-zeroed `width * height * bpp` buffer is happy
 *                   - which is why `decodePixels` asks Node's zlib for `Z_SYNC_FLUSH` finish.
 *
 * Spec: docs/WZ1_FORMAT.md §4.
 */
import { constants as zlibConstants, inflateSync } from "node:zlib";

/** New class name follows as a string (and is interned in the name table). */
export const MARK_CLASS = 0x73;
/** The class name is a `u32` key into the name table. */
export const MARK_NAME_REF = 0x1b;
/** `"#"` - the list class (`Map/Back/*.img` and friends use it for their root object). */
export const MARK_LIST = 0x23;
/** `'A'` - end of an object sequence (a writer that has no class to name writes this). */
export const MARK_END = 0x41;

/** Classes that carry a property list. */
export const PROPERTY_CLASSES = ["Property", "#", ""];

/** The one class whose body is a pixel buffer. */
export const CANVAS_CLASS = "Canvas";

/** Pixel formats the client accepts (`Canvas.dll.c` 29022: `if (n <= 0 || (n > 2 && n != 513))`). */
export const CANVAS_FORMATS = [1, 2, 513];

/** Thrown when a blob does not follow the v1 image grammar. */
export class WzImageError extends Error {}

/** One `name : type = value` of a property list. */
export interface WzEntry {
  name: string;
  type: number;
  value: WzValue;
}

/**
 * The kinds a `WzNode` can have. `canvas` is the one that carries a `WzCanvas` instead of the usual
 * value union, which is why the constructor's value type is the union of both.
 */
export type WzNodeKind = "props" | "vector" | "convex" | "uol" | "raw" | "canvas";

/** What a `WzNode` may hold: every scalar, a canvas, or a nested list of nodes. */
export type WzNodeValue = WzEntry[] | [number, number] | WzNode[] | string | Uint8Array | WzCanvas;

export type WzValue = null | number | bigint | string | Uint8Array | WzCanvas | WzNode;

/** A size-carrying object of the image stream (everything except a top-level object). */
export class WzNode {
  readonly kind: WzNodeKind;
  readonly value: WzNodeValue;

  constructor(kind: WzNodeKind, value: WzNodeValue) {
    this.kind = kind;
    this.value = value;
  }

  /** The entries of a `props` node (`[]` for every other kind). */
  get props(): WzEntry[] {
    return this.kind === "props" ? (this.value as WzEntry[]) : [];
  }

  /** The canvas of a `canvas` node (`undefined` for every other kind). */
  get canvas(): WzCanvas | undefined {
    return this.kind === "canvas" ? (this.value as WzCanvas) : undefined;
  }

  /** The value of a property inside a `props` node, or `undefined`. */
  get(name: string): WzValue | undefined {
    for (const entry of this.props) if (entry.name === name) return entry.value;
    return undefined;
  }
}

/** Pixel buffer of a `Canvas` object. */
export class WzCanvas {
  readonly width: number;
  readonly height: number;
  readonly format: number;
  /** Original canvas magnification exponent (legacy field name): each stored pixel covers 2^pad pixels. */
  readonly pad: number;
  readonly flag: number;
  readonly props: WzEntry[];
  /** `u32` length field plus the pixel block itself (flag byte included). */
  readonly pixelRaw: Uint8Array;
  /** Decoded pixels, or `null` when the block could not be read at all. */
  readonly pixels: Uint8Array | null;
  /** Offset of the canvas header inside the owning archive (when known). */
  readonly offset: number;
  readonly end: number;

  constructor(fields: {
    width: number; height: number; format: number; pad: number; flag: number;
    props: WzEntry[]; pixelRaw: Uint8Array; pixels: Uint8Array | null; offset: number; end: number;
  }) {
    this.width = fields.width;
    this.height = fields.height;
    this.format = fields.format;
    this.pad = fields.pad;
    this.flag = fields.flag;
    this.props = fields.props;
    this.pixelRaw = fields.pixelRaw;
    this.pixels = fields.pixels;
    this.offset = fields.offset;
    this.end = fields.end;
  }

  /** Bytes per pixel implied by the format code. */
  get bpp(): number {
    return pixelBpp(this.format);
  }

  get storageWidth(): number { return Math.max(1, Math.ceil(this.width / 2 ** this.pad)); }
  get storageHeight(): number { return Math.max(1, Math.ceil(this.height / 2 ** this.pad)); }

  /** Native buffer size, before the original canvas magnification is applied. */
  get expectedBytes(): number {
    return this.storageWidth * this.storageHeight * this.bpp;
  }

  /** True when fewer pixels came back than the surface holds (the rest stays zeroed). */
  get partial(): boolean {
    return this.pixels !== null && this.pixels.length !== this.expectedBytes;
  }
}

/** One top-level object of an image stream. */
export interface WzObject {
  cls: string;
  props: WzEntry[];
  offset: number;
  end: number;
}

/** Bytes per pixel for a canvas format code (`1` and `513` are 16bpp - only bit 8 differs). */
export function pixelBpp(format: number): number {
  return (format & 0xff) === 2 ? 4 : 2;
}

/**
 * Decode a canvas pixel block: `u8 flag` (must be 0) followed by a zlib stream that inflates to
 * the caller-supplied native buffer size (before canvas magnification).
 *
 * `Z_SYNC_FLUSH` as the finish mode makes zlib stop when the input runs out instead of demanding
 * the end-of-stream marker, which is what lets the trailer-less streams of this build through.
 * When the bytes are not a usable stream and long enough for the surface, they are taken verbatim.
 */
export function decodePixels(raw: Uint8Array, expected: number): Uint8Array | null {
  if (raw.length === 0 || raw[0] !== 0) return null;
  const body = raw.subarray(1);
  try {
    const out = inflateSync(body, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
    if (out.length > 0) return out.length > expected ? out.subarray(0, expected) : out;
  } catch {
    // Not a usable zlib stream - fall through to the stored-bytes case below.
  }
  return body.length >= expected ? body.subarray(0, expected) : null;
}

/** A decoded 8-bit RGBA surface (what a PNG wants). */
export interface RgbaImage {
  width: number;
  height: number;
  /** `width * height * 4` bytes, row major, straight (not premultiplied) alpha. */
  data: Uint8Array;
}

/**
 * The three pixel layouts the client accepts, and the blitter it picks for each pair of them
 * (`Canvas.dll.c` 14101-14150). Guessing here would put wrong colours on screen, so the table is
 * only filled with layouts the disassembly proves:
 *
 * - `1` - ARGB4444. The 16-to-32bpp expander `sub_1000DBD0` (14505) writes byte 0 = B, byte 1 = G,
 *   byte 2 = R, byte 3 = A of a little-endian dword, each from one nibble.
 * - `2` - A8R8G8B8, the same byte order (B, G, R, A). No canvas in `Data.wz` uses it; the layout
 *   comes from the same expander, whose *output* is a format-2 buffer.
 * - `513` - RGB565, no alpha: the 16-to-16bpp blitter `sub_1000F370` (15664) was checked against
 *   all 65,536 input values and is exactly `R5 = R4<<1|R3`, `G6 = G4<<2|G2`, `B5 = B4<<1|B3` with
 *   R in bits 15-11, G in 10-5 and B in 4-0. Reading the 0x200 bit as "opaque" is what makes the
 *   63 splash-screen canvases come out as images instead of soup.
 */
export const PIXEL_FORMATS: Record<number, { name: string; bpp: number; hasAlpha: boolean }> = {
  1: { name: "ARGB4444", bpp: 2, hasAlpha: true },
  2: { name: "A8R8G8B8", bpp: 4, hasAlpha: true },
  513: { name: "RGB565", bpp: 2, hasAlpha: false },
};

/** `4 bits -> 8 bits` by bit replication (`f -> ff`), the expansion a 16-bit display does. */
function expandNibble(value: number): number {
  return (value << 4) | value;
}

/**
 * Decode a canvas into an RGBA surface. A canvas whose pixel block did not inflate fully keeps a
 * transparent tail, which is the same picture the client draws: it inflates into a pre-zeroed
 * `width * height * bpp` buffer and renders whatever arrived.
 *
 * The client's own 16-to-32bpp expander multiplies each nibble by 16 instead of repeating its top
 * bits (`Canvas.dll.c` 14548, `f -> f0`); bit replication is used here because it covers the whole
 * 0-255 range, which is what the exported PNGs and the browser client need.
 */
export function canvasToRgba(canvas: WzCanvas): RgbaImage | null {
  if (canvas.pixels === null) return null;
  const { storageWidth: width, storageHeight: height, pixels } = canvas;
  const data = new Uint8Array(width * height * 4);
  // The pixel buffer is never longer than the surface (`decodePixels` truncates), but a hand-made
  // canvas can be, so both loops stop at the last whole pixel the result has room for.
  if (canvas.bpp === 2) {
    const opaque565 = canvas.format === 513;
    for (let at = 0, i = 0; i + 1 < pixels.length && at + 4 <= data.length; at += 4, i += 2) {
      const value = pixels[i] | (pixels[i + 1] << 8);
      if (opaque565) {
        // 5-6-5 with R in the high bits: 4, 5 or 6 bits need a replicate-and-shift, not a nibble
        // expand. `expandNibble` on the 6-bit green would not fit, so each channel shifts by itself.
        const r = (value >> 11) & 0x1f;
        const g = (value >> 5) & 0x3f;
        const b = value & 0x1f;
        data[at] = (r << 3) | (r >> 2);
        data[at + 1] = (g << 2) | (g >> 4);
        data[at + 2] = (b << 3) | (b >> 2);
        data[at + 3] = 0xff;
      } else {
        data[at] = expandNibble((value >> 8) & 0x0f);
        data[at + 1] = expandNibble((value >> 4) & 0x0f);
        data[at + 2] = expandNibble(value & 0x0f);
        data[at + 3] = expandNibble((value >> 12) & 0x0f);
      }
    }
  } else {
    for (let i = 0; i + 3 < pixels.length && i + 4 <= data.length; i += 4) {
      data[i] = pixels[i + 2];
      data[i + 1] = pixels[i + 1];
      data[i + 2] = pixels[i];
      data[i + 3] = pixels[i + 3];
    }
  }
  if (canvas.pad === 0) return { width, height, data };
  // Canvas.dll sub_100162B0 samples (x >> level, y >> level), not a zero-padded full-size surface.
  const expanded = new Uint8Array(canvas.width * canvas.height * 4);
  const scale = 2 ** canvas.pad;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      expanded.set(data.subarray(source, source + 4), (y * canvas.width + x) * 4);
    }
  }
  return { width: canvas.width, height: canvas.height, data: expanded };
}

/**
 * Value-level reader for one image blob (a stream of objects).
 *
 * `base` is the offset of `bytes[0]` inside the owning archive; it only shows up in the reported
 * offsets and error messages. The name table is keyed by offsets *relative to the blob*, because
 * that is what the writer of the `.img` sub-file interned them at.
 */
export class ImageStream {
  readonly bytes: Uint8Array;
  readonly base: number;
  p: number;
  readonly names: Map<number, string>;

  constructor(bytes: Uint8Array, base = 0) {
    this.bytes = bytes;
    this.base = base;
    this.p = 0;
    this.names = new Map();
  }

  // -- primitives --------------------------------------------------------
  u8(): number {
    return this.bytes[this.p++];
  }

  u16(): number {
    const value = this.bytes[this.p] | (this.bytes[this.p + 1] << 8);
    this.p += 2;
    return value;
  }

  u32(): number {
    const value =
      (this.bytes[this.p] |
        (this.bytes[this.p + 1] << 8) |
        (this.bytes[this.p + 2] << 16) |
        (this.bytes[this.p + 3] << 24)) >>>
      0;
    this.p += 4;
    return value;
  }

  i32(): number {
    return this.u32() | 0;
  }

  f64(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.p, 8);
    this.p += 8;
    return view.getFloat64(0, true);
  }

  /** One-byte integer; `0x80` escapes to a little-endian int32. */
  compact(): number {
    const value = this.u8();
    if (value === 0x80) return this.i32();
    return value >= 128 ? value - 256 : value;
  }

  /** One-byte integer; `0x80` escapes to a little-endian int64. */
  i64Compact(): bigint {
    const value = this.u8();
    if (value === 0x80) {
      const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.p, 8);
      this.p += 8;
      return view.getBigInt64(0, true);
    }
    return BigInt(value >= 128 ? value - 256 : value);
  }

  /** Masked WZ string (`PCOM.dll.c` `sub_1000D510` / `sub_1000CEE0`), interned on the way out. */
  string(): string {
    const start = this.p;
    const length = this.u8();
    let text: string;
    if (length === 0) {
      text = "";
    } else if (length & 0x80) {
      const count = length === 0x80 ? this.i32() : 256 - length;
      const out = new Uint8Array(count);
      for (let i = 0; i < count; i++) out[i] = this.bytes[this.p + i] ^ ((i - 86) & 0xff);
      this.p += count;
      text = Buffer.from(out).toString("latin1");
    } else {
      const count = length === 0x7f ? this.i32() : length;
      const out = Buffer.alloc(2 * count);
      for (let i = 0; i < count; i++) {
        const at = this.p + 2 * i;
        const word = (this.bytes[at] | (this.bytes[at + 1] << 8)) ^ ((i - 21846) & 0xffff);
        out[2 * i] = word & 0xff;
        out[2 * i + 1] = word >> 8;
      }
      this.p += 2 * count;
      text = out.toString("utf16le");
    }
    this.names.set(start, text);
    return text;
  }

  /**
   * Look a string up by name-table key (a blob-relative offset).
   *
   * Every key in `Data.wz` hits; the fallback (seek to the offset, read the string there, carry
   * on) is the client's own behaviour for a key it has not seen yet.
   */
  atKey(key: number): string {
    const known = this.names.get(key);
    if (known !== undefined) return known;
    const here = this.p;
    this.p = key;
    try {
      return this.string();
    } finally {
      this.p = here;
    }
  }

  // -- objects -----------------------------------------------------------
  /** Class name at the cursor: `0x73` inline, `0x1B` name-table key, `0x23` `"#"`. */
  className(): string {
    const mark = this.u8();
    if (mark === MARK_CLASS) return this.string();
    if (mark === MARK_NAME_REF) return this.atKey(this.u32());
    if (mark === MARK_LIST) return "#";
    throw new WzImageError(`bad object marker 0x${mark.toString(16)} at ${this.base + this.p - 1}`);
  }

  /** Object whose declared size is `size` (value types 9 and 13). */
  object(size: number, depth = 0): WzNode {
    const start = this.p;
    const cls = this.className();
    const node = this.body(cls, start + size, depth);
    if (this.p !== start + size) {
      throw new WzImageError(
        `object ${JSON.stringify(cls)}: consumed ${this.p - start} of ${size} bytes at ${this.base + start}`,
      );
    }
    return node;
  }

  /** Size-less object (an item of a `Shape2D#Convex2D`). */
  inlineObject(depth = 0): WzNode {
    return this.body(this.className(), this.bytes.length, depth);
  }

  /** Body of one object, dispatched on its class name. */
  body(cls: string, limit: number, depth = 0): WzNode {
    if (cls === CANVAS_CLASS) return new WzNode("canvas", this.canvas());
    if (cls === "Shape2D#Vector2D") return new WzNode("vector", [this.compact(), this.compact()]);
    if (cls === "Shape2D#Convex2D") {
      const count = this.compact();
      if (count < 0 || count > 0x1000) throw new WzImageError(`implausible Convex2D count ${count}`);
      const items: WzNode[] = [];
      for (let i = 0; i < count; i++) items.push(this.inlineObject(depth + 1));
      return new WzNode("convex", items);
    }
    if (cls === "UOL") {
      // Link target: u8 flag, u8 kind. kind 0 spells the path out; kind 1 carries the key of a
      // path string another UOL already wrote, so both forms yield that path.
      this.u8();
      const kind = this.u8();
      return new WzNode("uol", kind === 0 ? this.string() : this.atKey(this.u32()));
    }
    if (PROPERTY_CLASSES.includes(cls) || cls.startsWith("Shape2D")) {
      return new WzNode("props", this.propList(depth + 1));
    }
    const raw = this.bytes.subarray(this.p, limit);
    this.p = limit;
    return new WzNode("raw", raw);
  }

  /** `Canvas`: flag, optional props, w/h/format/pad, four zeros, `u32` length, pixel block. */
  canvas(): WzCanvas {
    const start = this.p;
    const flag = this.u8();
    const props = this.u8() ? this.propList(1) : [];
    const width = this.compact();
    const height = this.compact();
    const format = this.compact();
    const pad = this.compact();
    for (let i = 0; i < 4; i++) {
      if (this.compact() !== 0) {
        throw new WzImageError(`canvas at ${this.base + start} has a non-zero reserved word`);
      }
    }
    const pixelLen = this.u32();
    const raw = this.bytes.subarray(this.p, this.p + pixelLen);
    this.p += pixelLen;
    if (pad < 0 || pad > 30) throw new WzImageError(`invalid canvas scale ${pad}`);
    const expected = Math.max(1, Math.ceil(width / 2 ** pad)) * Math.max(1, Math.ceil(height / 2 ** pad)) * pixelBpp(format);
    return new WzCanvas({
      width, height, format, pad, flag, props, pixelRaw: raw,
      pixels: decodePixels(raw, expected),
      offset: this.base + start, end: this.base + this.p,
    });
  }

  /** `u16 0`, compact count, then the entries. */
  propList(depth = 0): WzEntry[] {
    if (depth > 100) throw new WzImageError("property nesting too deep");
    this.p += 2;
    const count = this.compact();
    if (count < 0 || count > 0x10000) throw new WzImageError(`implausible property count ${count}`);
    const out: WzEntry[] = [];
    for (let i = 0; i < count; i++) out.push(this.entry(depth));
    return out;
  }

  entry(depth = 0): WzEntry {
    const name = this.entryName();
    const type = this.u8();
    return { name, type, value: this.value(type, depth) };
  }

  /** Entry name: tag 0 = string follows, tag 1 = `u32` name-table key. */
  entryName(): string {
    const tag = this.u8();
    if (tag === 0) return this.string();
    if (tag === 1 || tag === 2) return this.atKey(this.u32());
    throw new WzImageError(`bad entry tag 0x${tag.toString(16)} at ${this.base + this.p - 1}`);
  }

  value(type: number, depth = 0): WzValue {
    switch (type) {
      case 0:
        return null;
      case 3:
      case 4:
      case 19:
        return this.compact();
      case 2:
      case 11:
      case 16:
      case 17:
      case 18:
        return this.u16();
      case 6:
        return this.i64Compact();
      case 5:
      case 7:
        return this.f64();
      case 8: {
        const flag = this.u8();
        return flag === 0 ? this.string() : this.atKey(this.u32());
      }
      case 9:
      case 13: {
        const size = this.u32();
        if ([MARK_CLASS, MARK_NAME_REF, MARK_LIST].includes(this.bytes[this.p])) {
          return this.object(size, depth + 1);
        }
        const raw = this.bytes.subarray(this.p, this.p + size);
        this.p += size;
        return new WzNode("raw", raw);
      }
      default:
        throw new WzImageError(`unknown property type ${type} at ${this.base + this.p - 1}`);
    }
  }

  // -- whole blob --------------------------------------------------------
  /** Parse one top-level object at the cursor. */
  one(): WzObject {
    const start = this.p;
    const cls = this.className();
    if (cls === CANVAS_CLASS) throw new WzImageError(`size-less Canvas at ${this.base + start}`);
    let node: WzNode;
    if (PROPERTY_CLASSES.includes(cls) || cls.startsWith("Shape2D")) {
      node = new WzNode("props", this.propList(1));
    } else {
      node = this.body(cls, this.bytes.length, 1);
    }
    return { cls, props: node.props, offset: this.base + start, end: this.base + this.p };
  }

  /** Every top-level object of the blob, in file order. */
  objects(): WzObject[] {
    const out: WzObject[] = [];
    while (this.p < this.bytes.length) {
      if (this.bytes[this.p] === MARK_END) {
        this.p += 1;
        break;
      }
      if (![MARK_CLASS, MARK_NAME_REF, MARK_LIST].includes(this.bytes[this.p])) {
        throw new WzImageError(`not an object marker 0x${this.bytes[this.p].toString(16)} at ${this.p}`);
      }
      out.push(this.one());
    }
    return out;
  }
}

/** Parse one image blob into its top-level objects. */
export function parseImage(bytes: Uint8Array, base = 0): WzObject[] {
  return new ImageStream(bytes, base).objects();
}

/** Everything the image parser can put in a tree: a node's value, or a value itself. */
export type WzTree = WzValue | WzNodeValue;

/** Every `Canvas` inside an object tree, depth first (property order preserved). */
export function walkCanvases(value: WzTree, out: WzCanvas[] = []): WzCanvas[] {
  if (value instanceof WzCanvas) {
    out.push(value);
  } else if (value instanceof WzNode) {
    walkCanvases(value.value, out);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      // A property list is an array of entries; a vector is an array of two numbers.
      walkCanvases(isEntry(item) ? (item as WzEntry).value : (item as WzValue), out);
    }
  }
  return out;
}

/** Duck-type test for `WzEntry` (a plain `{name, type, value}` record). */
function isEntry(value: unknown): value is WzEntry {
  return typeof value === "object" && value !== null && "type" in value && "name" in value;
}

/** The `name : type = value` pair with that name, or `undefined`. */
export function getEntry(props: WzEntry[], name: string): WzEntry | undefined {
  return props.find((entry) => entry.name === name);
}

/** The value of the property `name` in a property list, or `undefined`. */
export function getProperty(props: WzEntry[], name: string): WzValue | undefined {
  return getEntry(props, name)?.value;
}
