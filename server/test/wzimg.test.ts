/**
 * The WZ v1 `.img` codec and the `Data.wz` locator.
 *
 * Half of this file writes the byte streams by hand, so the format rules are pinned independently
 * of any file; the other half runs against the shipped `Data.wz` and pins the same goldens the
 * Python twin asserts (`tools/tests/test_wzimg.py`), which is what keeps the two readers honest.
 * The archive half skips itself when `Data.wz` is not in the checkout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  ImageStream, PIXEL_FORMATS, WzCanvas, WzImageError, WzNode, canvasToRgba, decodePixels,
  pixelBpp, walkCanvases,
} from "../src/wz/img.ts";
import { WzArchive, plain } from "../src/wz/archive.ts";
import { encodePng } from "../src/wz/png.ts";
import { runWzCommand } from "../src/wz/cli.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
/** One archive instance for the whole file: opening it scans the tail and reads 87 MB. */
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

// ---------------------------------------------------------------------------
// a tiny writer, mirroring the codec (synthetic fixtures)
// ---------------------------------------------------------------------------
function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function f64(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeDoubleLE(value);
  return out;
}

function asciiString(text: string): Buffer {
  const encoded = Buffer.from(text, "latin1");
  const out = Buffer.alloc(encoded.length + 1);
  out[0] = 256 - encoded.length;
  for (let i = 0; i < encoded.length; i++) out[i + 1] = encoded[i] ^ ((i - 86) & 0xff);
  return out;
}

function utf16String(text: string): Buffer {
  const encoded = Buffer.from(text, "utf16le");
  const out = Buffer.alloc(encoded.length + 1);
  out[0] = encoded.length / 2;
  for (let i = 0; i < encoded.length / 2; i++) {
    const word = (encoded[2 * i] | (encoded[2 * i + 1] << 8)) ^ ((i - 21846) & 0xffff);
    out[1 + 2 * i] = word & 0xff;
    out[2 + 2 * i] = word >> 8;
  }
  return out;
}

function compact(value: number): Buffer {
  if (value >= -128 && value <= 127) return Buffer.from([value & 0xff]);
  return Buffer.concat([Buffer.from([0x80]), i32(value)]);
}

function i32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeInt32LE(value);
  return out;
}

function entry(name: string, type: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x00]), asciiString(name), Buffer.from([type]), value]);
}

function propList(...entries: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00]), compact(entries.length), ...entries]);
}

function object(cls: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x73]), asciiString(cls), body]);
}

/** `0x73 "Canvas"` - the 8 bytes that precede a canvas body anywhere it appears. */
const CANVAS_HEADER = object("Canvas", Buffer.alloc(0));

function canvasBody(width: number, height: number, format: number, options: { props?: Buffer; pixelBlock?: Buffer } = {}): Buffer {
  const props = options.props ?? Buffer.alloc(0);
  const block = options.pixelBlock ?? Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from([0x00, options.props ? 0x01 : 0x00]),
    props,
    compact(width), compact(height), compact(format), compact(0),
    ...Array.from({ length: 4 }, () => compact(0)),
    u32(block.length),
    block,
  ]);
}

function canvasBytes(width: number, height: number, format: number, pixels: Buffer, options: { props?: Buffer; pixelBlock?: Buffer } = {}): Buffer {
  const block = options.pixelBlock ?? Buffer.concat([Buffer.from([0x00]), deflateSync(pixels)]);
  return Buffer.concat([CANVAS_HEADER, canvasBody(width, height, format, { ...options, pixelBlock: block })]);
}

function canvasOf(inner: Buffer): WzCanvas {
  return new ImageStream(inner.subarray(CANVAS_HEADER.length)).body("Canvas", Infinity).value as WzCanvas;
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------
test("compact integers use one byte or the 0x80 escape", () => {
  const stream = new ImageStream(Buffer.concat([
    Buffer.from([0x7f, 0x80]), i32(12345), Buffer.from([0xff, 0x81]),
  ]));
  assert.equal(stream.compact(), 127);
  assert.equal(stream.compact(), 12345);
  assert.equal(stream.compact(), -1);
  assert.equal(stream.compact(), -127);
});

test("int64 compact escapes to eight bytes", () => {
  const escaped = Buffer.alloc(9);
  escaped[0] = 0x80;
  escaped.writeBigInt64LE(-(2n ** 40n), 1);
  const stream = new ImageStream(Buffer.concat([Buffer.from([0x05]), escaped]));
  assert.equal(stream.i64Compact(), 5n);
  assert.equal(stream.i64Compact(), -(2n ** 40n));
});

test("the ASCII mask starts at 0xaa and the UTF-16 mask at 0xaaaa", () => {
  assert.equal(asciiString("Property").toString("hex"), "f8fad9c3ddcbddc4c8");
  assert.equal(new ImageStream(asciiString("Property")).string(), "Property");
  assert.equal(new ImageStream(utf16String("가나A")).string(), "가나A");
  assert.equal(new ImageStream(Buffer.from([0x00])).string(), "");
});

// ---------------------------------------------------------------------------
// property lists and name references
// ---------------------------------------------------------------------------
test("the scalar types have the sizes PCOM dictates", () => {
  const blob = propList(
    entry("a", 2, u16(300)),
    entry("b", 11, u16(7)),
    entry("c", 3, compact(-5)),
    entry("d", 4, compact(70000)),
    entry("e", 19, compact(1)),
    entry("f", 6, Buffer.from([0x09])),
    entry("g", 5, f64(1.5)),
    entry("h", 0, Buffer.alloc(0)),
  );
  const stream = new ImageStream(blob);
  const props = stream.propList();
  assert.equal(stream.p, blob.length, "every entry must be consumed");
  assert.deepEqual(props.map((item) => item.name), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual(props.map((item) => item.value), [300, 7, -5, 70000, 1, 9n, 1.5, null]);
});

test("a string value can reference an earlier string by name-table key", () => {
  // The key is the offset of the string's own length byte, relative to the image.
  const first = entry("z", 8, Buffer.concat([Buffer.from([0x00]), asciiString("A")]));
  const key = Buffer.byteLength(propList(first)) - Buffer.byteLength(asciiString("A"));
  const second = Buffer.concat([Buffer.from([0x00]), asciiString("w"), Buffer.from([0x08, 0x01]), u32(key)]);
  const stream = new ImageStream(propList(first, second));
  const props = stream.propList();
  assert.equal(props[0].value, "A");
  assert.equal(props[1].value, "A", "flag + u32 reuses the cached string");
  assert.equal(stream.p, propList(first, second).length);
});

test("an unknown key is read at its own offset and the cursor stays put", () => {
  const first = entry("z", 8, Buffer.concat([Buffer.from([0x00]), asciiString("A")]));
  const head = Buffer.concat([Buffer.from([0x00, 0x00, 0x02]), first, Buffer.from([0x00]), asciiString("w"), Buffer.from([0x08, 0x01])]);
  const key = head.length + 4;
  const blob = Buffer.concat([head, u32(key), asciiString("cached")]);
  const stream = new ImageStream(blob);
  const props = stream.propList();
  assert.equal(props[1].value, "cached");
  assert.equal(stream.p, key, "the cursor stays where the entry ended");
});

test("entry tag 1 carries a key, tag 0 spells the name out", () => {
  const first = entry("first", 3, compact(1));
  // The name's length byte is one byte behind the entry tag.
  const key = Buffer.byteLength(Buffer.from([0x00, 0x00, 0x02])) + 1;
  const blob = propList(first, Buffer.concat([Buffer.from([0x01]), u32(key), Buffer.from([0x03]), compact(9)]));
  const props = new ImageStream(blob).propList();
  assert.equal(props[0].name, "first");
  assert.equal(props[1].name, "first");
  assert.equal(props[1].value, 9);
});

test("nested objects use their declared size, and a mismatch is an error", () => {
  const inner = object("Property", propList(entry("k", 3, compact(4))));
  const good = propList(entry("outer", 9, Buffer.concat([u32(inner.length), inner])));
  const node = new ImageStream(good).propList()[0].value as WzNode;
  assert.equal(node.kind, "props");
  assert.equal(node.get("k"), 4);

  const bad = propList(entry("outer", 9, Buffer.concat([u32(inner.length + 3), inner])));
  assert.throws(() => new ImageStream(bad).propList(), WzImageError);
});

// ---------------------------------------------------------------------------
// class bodies
// ---------------------------------------------------------------------------
test("a class name can be inline (0x73) or a name-table key (0x1B)", () => {
  const inline = Buffer.concat([Buffer.from([0x73]), asciiString("Canvas")]);
  const stream = new ImageStream(Buffer.concat([inline, Buffer.from([0x1b]), u32(1)]));
  assert.equal(stream.className(), "Canvas");
  assert.equal(stream.p, inline.length);
  assert.equal(stream.className(), "Canvas", "0x1B carries the key of the length byte");
  assert.equal(stream.p, inline.length + 5);
});

test("0x23 is the '#' class, 0x41 is not a class at all", () => {
  assert.equal(new ImageStream(Buffer.from([0x23])).className(), "#");
  assert.throws(() => new ImageStream(Buffer.from([0x41])).className(), WzImageError);
});

test("an object sequence stops at 0x41", () => {
  const first = object("Property", propList(entry("k", 3, compact(4))));
  const stream = new ImageStream(Buffer.concat([first, Buffer.from([0x41])]));
  const objects = stream.objects();
  assert.equal(objects.length, 1);
  assert.equal(stream.p, first.length + 1);
});

test("Shape2D vectors and convex hulls parse", () => {
  const vector = Buffer.concat([compact(-3), compact(9)]);
  const node = new ImageStream(vector).body("Shape2D#Vector2D", vector.length);
  assert.deepEqual(node.value, [-3, 9]);

  const first = Buffer.concat([Buffer.from([0x73]), asciiString("Shape2D#Vector2D"), compact(1), compact(2)]);
  const second = Buffer.concat([Buffer.from([0x1b]), u32(2), compact(3), compact(4)]);
  const body = Buffer.concat([compact(2), first, second]);
  const convex = new ImageStream(body).body("Shape2D#Convex2D", body.length);
  assert.equal(convex.kind, "convex");
  assert.deepEqual((convex.value as WzNode[]).map((item) => item.value), [[1, 2], [3, 4]]);
});

test("UOL kind 0 spells the target path out, kind 1 reuses the key", () => {
  const outLink = Buffer.concat([Buffer.from([0x00, 0x00]), asciiString("../../swingPF/0/body")]);
  assert.equal(new ImageStream(outLink).body("UOL", outLink.length).value, "../../swingPF/0/body");

  const inLink = Buffer.concat([Buffer.from([0x00, 0x01]), u32(2)]);
  const both = new ImageStream(Buffer.concat([outLink, inLink]));
  both.p = outLink.length;
  assert.equal(both.body("UOL", inLink.length).value, "../../swingPF/0/body");
});

test("unknown classes keep their bytes (Sound_DX8 and friends)", () => {
  const body = Buffer.from([1, 2, 3, 4, 5]);
  const node = new ImageStream(body).body("Sound_DX8", body.length);
  assert.equal(node.kind, "raw");
  assert.deepEqual([...(node.value as Uint8Array)], [1, 2, 3, 4, 5]);
});

// ---------------------------------------------------------------------------
// canvas
// ---------------------------------------------------------------------------
test("a canvas keeps its header and decodes its pixels", () => {
  const pixels = Buffer.from(Array.from({ length: 16 * 32 * 2 }, (_, i) => i & 0xff));
  const inner = propList(entry("icon", 9, Buffer.concat([u32(canvasBytes(16, 32, 1, pixels).length), canvasBytes(16, 32, 1, pixels)])));
  const canvas = walkCanvases(new ImageStream(inner).propList())[0];
  assert.equal(canvas.width, 16);
  assert.equal(canvas.height, 32);
  assert.equal(canvas.format, 1);
  assert.equal(canvas.bpp, 2);
  assert.equal(canvas.expectedBytes, 1024);
  assert.deepEqual(Buffer.from(canvas.pixels!), pixels);
  assert.equal(canvas.partial, false);
});

test("a stream without its adler32 trailer still decodes", () => {
  const pixels = Buffer.from(Array.from({ length: 8 * 8 * 2 }, (_, i) => (i * 7) & 0xff));
  const full = deflateSync(pixels);
  const truncated = full.subarray(0, full.length - 4); // this build's writer drops the trailer
  const canvas = canvasOf(canvasBytes(8, 8, 1, pixels, {
    pixelBlock: Buffer.concat([Buffer.from([0x00]), truncated]),
  }));
  assert.deepEqual(Buffer.from(canvas.pixels!), pixels);
});

test("a short stream is reported as partial (the rest of the surface stays zero)", () => {
  const pixels = Buffer.alloc(8 * 8 * 2);
  const canvas = canvasOf(canvasBytes(8, 8, 1, pixels, {
    pixelBlock: Buffer.concat([Buffer.from([0x00]), deflateSync(pixels.subarray(0, 32))]),
  }));
  assert.equal(canvas.pixels!.length, 32);
  assert.equal(canvas.partial, true);
});

test("a non-zero pixel flag yields no pixels at all", () => {
  assert.equal(decodePixels(Buffer.from([0x01, 0x78, 0x9c]), 4), null);
});

test("bytes per pixel comes from the low byte of the format", () => {
  assert.equal(pixelBpp(1), 2);
  assert.equal(pixelBpp(2), 4);
  assert.equal(pixelBpp(513), 2); // 0x201 - 16bpp plus a flag bit
});

// ---------------------------------------------------------------------------
// the real archive
// ---------------------------------------------------------------------------
test("the container header is the one NameSpace.dll checks", needsArchive, () => {
  assert.equal(archive!.description, "Package file v1.0 Copyright 2002 Wizet, ZMS");
  assert.equal(archive!.wzVersion, 95);
  assert.equal(archive!.dataStart, 0x3c);
  assert.equal(archive!.shellSize, statSync(DATA_WZ).size - 60);
  assert.equal(archive!.treeEnd, 0x756e);
  assert.equal(archive!.images.length, 1052);
});

test("every image resolves to a parsable blob, 922 of them where the tree says", needsArchive, () => {
  const counts = { declared: 0, scanned: 0, missing: 0 };
  for (const image of archive!.images) counts[image.source] += 1;
  assert.deepEqual(counts, { declared: 922, scanned: 130, missing: 0 });
  for (const image of archive!.images) {
    assert.ok(archive!.objects(image.path).length > 0, image.path);
  }
});

test("the tail carries 4 objects no directory entry points at", needsArchive, () => {
  const unlisted = archive!.unlistedObjects();
  assert.equal(unlisted.length, 4);
  assert.equal(unlisted.reduce((sum, hit) => sum + hit.length, 0), 172_999);
});

test("an opaque blob is not accepted as an image", needsArchive, () => {
  // Mob/0210100.img's declared offset holds 22,122 bytes of noise that parses as one
  // unknown-class object of exactly the right length; the `Property` root check rejects it.
  assert.equal(archive!.image("Mob/0210100.img")?.source, "scanned");
  const root = archive!.objects("Mob/0210100.img")[0];
  assert.equal(root.cls, "Property");
  const info = root.props.find((item) => item.name === "info")!.value as WzNode;
  assert.equal(info.get("name"), "슬라임");
  assert.equal(info.get("level"), 6);
});

test("the canvas census is stable", needsArchive, () => {
  const stats = archive!.canvasCensus();
  assert.equal(stats.canvases, 55_379);
  assert.equal(stats["fmt 1"], 55_314);
  assert.equal(stats["fmt 513"], 65);
  assert.equal(stats["pixels exact"], 55_377);
  assert.equal(stats["pixels short (zero padded)"], 2);
  assert.equal(stats["pixels not decoded"], undefined);
});

test("the cap's icon pixels are byte-identical to the Python reader's", needsArchive, () => {
  const canvases = archive!.canvases("Character/Cap/01000000.img");
  assert.deepEqual(canvases.map((canvas) => [canvas.width, canvas.height]), [
    [29, 30], [29, 28], [45, 47], [4, 13], [41, 33],
  ]);
  assert.equal(canvases[0].pixels!.length, 29 * 30 * 2);
  assert.equal(
    createHash("sha256").update(canvases[0].pixels!).digest("hex").slice(0, 16),
    "acd38811c1f1f1a0",
  );
});

test("every name-table key in the archive hits", needsArchive, () => {
  let hits = 0;
  let misses = 0;
  class Counting extends ImageStream {
    override atKey(key: number): string {
      if (this.names.has(key)) hits += 1;
      else misses += 1;
      return super.atKey(key);
    }
  }
  for (const image of archive!.images) {
    new Counting(archive!.blob(image.path)).objects();
  }
  assert.equal(misses, 0, "no key needed the seek fallback");
  assert.equal(hits, 696_774);
});

test("map metadata matches the Python manifest", needsArchive, () => {
  const all = archive!.mapMetadata();
  assert.equal(Object.keys(all).length, 100);
  const map = all["001000000"]; // Amherst West Field - the 2003 starting map
  assert.equal(map.info.mapName, "암허스트서쪽필드");
  assert.equal(map.info.streetName, "레인보우스트리트");
  assert.equal(map.info.bgm, "Bgm00/RestNPeace");
  assert.equal(map.info.returnMap, 1010000);
  assert.equal(map.foothold, 289);
  assert.equal(map.ladderRope, 8);
  assert.equal(map.portal[0].pn, "sp");
  assert.equal(map.portal[0].pt, 0);
  assert.equal(map.life.length, 45);
  assert.equal(map.life[0].type, "m");
  assert.equal(map.life[0].id, "0120100");
  assert.equal(map.life[0].x, 509);
});

// ---------------------------------------------------------------------------
// pixels and PNG
// ---------------------------------------------------------------------------
test("ARGB4444 becomes RGBA, alpha nibble included", () => {
  const canvas = canvasOf(canvasBytes(2, 1, 1, Buffer.from([0x00, 0xf0, 0x0f, 0x00])));
  const image = canvasToRgba(canvas)!;
  assert.deepEqual([...image.data], [
    0x00, 0x00, 0x00, 0xff, // 0xF000 - opaque black
    0x00, 0x00, 0xff, 0x00, // 0x000F - transparent blue
  ]);
});

test("RGB565 (format 513) has no alpha to lose", () => {
  const canvas = canvasOf(canvasBytes(3, 1, 513, Buffer.from([0xe0, 0x07, 0x00, 0xf8, 0x1f, 0x00])));
  const image = canvasToRgba(canvas)!;
  assert.deepEqual([...image.data], [
    0x00, 0xff, 0x00, 0xff, // 0x07E0 - pure green
    0xff, 0x00, 0x00, 0xff, // 0xF800 - pure red
    0x00, 0x00, 0xff, 0xff, // 0x001F - pure blue
  ]);
});

test("32bpp canvases are A8R8G8B8 in B, G, R, A byte order", () => {
  const canvas = canvasOf(canvasBytes(1, 1, 2, Buffer.from([0x30, 0x20, 0x10, 0x40])));
  assert.equal(PIXEL_FORMATS[2].bpp, 4);
  assert.deepEqual([...canvasToRgba(canvas)!.data], [0x10, 0x20, 0x30, 0x40]);
});

test("a canvas that did not inflate whole keeps a transparent tail", () => {
  const pixels = Buffer.alloc(4 * 4 * 2);
  const canvas = canvasOf(canvasBytes(4, 4, 1, pixels, {
    pixelBlock: Buffer.concat([Buffer.from([0x00]), deflateSync(pixels.subarray(0, 8))]),
  }));
  const image = canvasToRgba(canvas)!;
  assert.equal(image.data.length, 4 * 4 * 4);
  assert.deepEqual([...image.data.subarray(8)], new Array(56).fill(0));
});

test("a canvas with no pixels at all has no image", () => {
  const canvas = canvasOf(canvasBytes(2, 2, 1, Buffer.alloc(0), {
    pixelBlock: Buffer.from([0x01, 0x78, 0x9c]),
  }));
  assert.equal(canvas.pixels, null);
  assert.equal(canvasToRgba(canvas), null);
});

test("encodePng writes a PNG a reader can un-filter", () => {
  const image = {
    width: 3,
    height: 2,
    data: Uint8Array.from([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]),
  };
  const png = encodePng(image);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    const data = png.subarray(at + 8, at + 8 + length);
    // The stored CRC has to cover the type and the data, exactly as the spec says.
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(Buffer.concat([png.subarray(at + 4, at + 8), data])) >>> 0);
    chunks.push({ type, data });
    at += 12 + length;
  }
  assert.deepEqual(chunks.map((chunk) => chunk.type), ["IHDR", "IDAT", "IEND"]);
  assert.equal(chunks[0].data.readUInt32BE(0), 3);
  assert.equal(chunks[0].data.readUInt32BE(4), 2);
  assert.deepEqual([...chunks[0].data.subarray(8)], [8, 6, 0, 0, 0]);
  const raw = inflateSync(chunks[1].data);
  assert.equal(raw.length, 2 * (3 * 4 + 1));
  for (let row = 0; row < 2; row++) {
    const at = row * 13;
    assert.equal(raw[at], 0, "every scanline is stored with filter type 0");
    assert.deepEqual([...raw.subarray(at + 1, at + 13)], [...image.data.subarray(row * 12, row * 12 + 12)]);
  }
  assert.equal(chunks[2].data.length, 0);
});

test("plain() is the same shape the Python tool writes out", needsArchive, () => {
  const rendered = plain(archive!.canvases("Character/Cap/01000000.img")[0]) as Record<string, unknown>;
  assert.equal(rendered.__canvas__, true);
  assert.equal(rendered.width, 29);
  assert.equal(rendered.format, 1);
  assert.deepEqual((rendered.props as unknown[][])[0].slice(0, 2), ["origin", 9]);
});

test("the orange mushroom renders as an opaque orange cap over nothing", needsArchive, () => {
  const canvas = archive!.canvases("Mob/1210102.img")[0];
  assert.equal(canvas.width, 64);
  assert.equal(canvas.height, 55);
  const image = canvasToRgba(canvas)!;
  // Corner: the transparent background this sprite is cut out of.
  assert.equal(image.data[3], 0);
  // And the body of it is orange (0xFC60 as ARGB4444 is R = 0xF, G = 0x6, B = 0x0). The colour order
  // is the whole point of this test: read as anything but ARGB4444 the cap comes out blue.
  let opaque = 0;
  let redder = 0;
  let bluer = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, b, a] = [image.data[i]!, image.data[i + 2]!, image.data[i + 3]!];
    if (a !== 0xff) continue;
    opaque += 1;
    if (r > b + 8) redder += 1;
    else if (b > r + 8) bluer += 1;
  }
  assert.ok(opaque > 1000, `expected an opaque sprite, got ${opaque} opaque pixels`);
  assert.ok(redder > bluer * 4, `expected a red-dominant sprite, got ${redder} red and ${bluer} blue`);
});

test("wz png writes one file per canvas", needsArchive, () => {
  const dir = mkdtempSync(join(tmpdir(), "kms111-wz-"));
  try {
    assert.equal(runWzCommand(["png", "UI/Basic.img", "--out", dir, "--quiet", "--data", DATA_WZ]), 0);
    const files = readdirSync(dir).sort();
    assert.equal(files.length, 97);
    assert.equal(files[0], "000_24x23.png");
    assert.ok(statSync(join(dir, files[0])).size > 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wz commands report what they find and fail cleanly otherwise", needsArchive, () => {
  assert.equal(runWzCommand(["census", "--json", "--data", DATA_WZ]), 0);
  assert.equal(runWzCommand(["dump", "no/such.img", "--data", DATA_WZ]), 1);
  assert.equal(runWzCommand(["png", "UI/Basic.img", "--data", DATA_WZ]), 1, "png needs --out");
});
