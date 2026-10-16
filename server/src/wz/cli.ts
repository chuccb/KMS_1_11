/**
 * The `wz` sub-command: the archive, from the command line.
 *
 *   node server/src/cli.ts wz images [--prefix Character/Cap] [--json]
 *   node server/src/cli.ts wz census [--json]
 *   node server/src/cli.ts wz maps [--json] [--out map_meta.json] [<map id>...]
 *   node server/src/cli.ts wz dump <image path> [--json]
 *   node server/src/cli.ts wz png <image path> --out <dir> [--quiet]
 *
 * Every action reads `Data.wz` (or `--data <path>`) through `WzArchive`, so there is exactly one
 * WZ reader in the project and this file only formats its results. `png` is the one that turns the
 * reader into something a person can judge: decoded pixels as files a viewer can open.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { WzArchive, plain } from "./archive.ts";
import {
  WzCanvas, WzNode, canvasToRgba, getProperty, walkCanvases,
} from "./img.ts";
import type { WzValue } from "./img.ts";
import { encodePng } from "./png.ts";

const USAGE = `wz - read Data.wz (docs/WZ1_FORMAT.md)

usage:
  wz images [--prefix <path>] [--json] [--data <file>]
  wz census [--json] [--data <file>]
  wz maps [--json] [--out <file>] [<map id>...] [--data <file>]
  wz dump <image path> [--json] [--data <file>]
  wz png <image path> --out <dir> [--quiet] [--data <file>]

  images  every image of the archive: path, bytes, and how the reader located it
          (declared = the tree size chain; scanned = found by matching "Property" objects)
  census  canvas totals, per pixel format, and how many of them inflate to a whole surface
  maps    Map/Map/%09d.img -> info, foothold/portal/life counts (all maps, or the ids given)
  dump    one image as an indented tree, or the JSON view that plain() produces
  png     one image -> one PNG per canvas in --out, named <index>_<w>x<h>.png

notes:
  Data.wz defaults to the checkout root; pass --data when running from somewhere else.
`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) out[name] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[name] = argv[++i];
      else out[name] = true;
    } else {
      rest.push(arg);
    }
  }
  out._ = rest.join("\0");
  return out;
}

function positional(args: Record<string, string | boolean>): string[] {
  const raw = typeof args._ === "string" ? args._ : "";
  return raw === "" ? [] : raw.split("\0");
}

function openData(args: Record<string, string | boolean>): WzArchive {
  const path = typeof args.data === "string" ? args.data : "Data.wz";
  return WzArchive.open(path);
}

function print(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------
function runImages(archive: WzArchive, args: Record<string, string | boolean>): number {
  const prefix = typeof args.prefix === "string" ? args.prefix : "";
  const images = archive.images.filter((image) => image.path.startsWith(prefix));
  if (args.json === true) {
    print(JSON.stringify(images, null, 2));
    return 0;
  }
  for (const image of images) {
    print(`${image.path.padEnd(42)} ${String(image.size).padStart(9)} B  ${image.source}`);
  }
  print(`${images.length} images`);
  return 0;
}

function runCensus(archive: WzArchive, args: Record<string, string | boolean>): number {
  const stats = archive.canvasCensus();
  if (args.json === true) {
    print(JSON.stringify(stats, null, 2));
    return 0;
  }
  const order = Object.keys(stats).sort((a, b) => stats[b] - stats[a]);
  for (const key of order) print(`${String(stats[key]).padStart(8)}  ${key}`);
  return 0;
}

function runMaps(archive: WzArchive, args: Record<string, string | boolean>): number {
  const ids = positional(args);
  const maps = archive.mapMetadata(ids.length > 0 ? ids : undefined);
  if (typeof args.out === "string") {
    writeFileSync(args.out, `${JSON.stringify(maps, null, 2)}\n`);
    print(`${Object.keys(maps).length} maps -> ${args.out}`);
  }
  if (args.json === true) {
    print(JSON.stringify(maps, null, 2));
  } else if (typeof args.out !== "string") {
    print("map       name                 footholds ladder  portals  life  bgm");
    for (const [id, map] of Object.entries(maps)) {
      print(
        `${id.padEnd(9)} ${String(map.info.mapName ?? "?").padEnd(20)} ` +
          `${String(map.foothold).padStart(9)} ${String(map.ladderRope).padStart(6)} ` +
          `${String(map.portal.length).padStart(8)} ${String(map.life.length).padStart(5)}  ${String(map.info.bgm ?? "")}`,
      );
    }
    print(`${Object.keys(maps).length} maps`);
  }
  return 0;
}

/** A short readable form of a value, for one-line summaries. */
function shortValue(value: WzValue | undefined): string {
  if (value === undefined) return "?";
  if (value instanceof WzCanvas) return `Canvas ${value.width}x${value.height}`;
  if (value instanceof WzNode) {
    if (value.kind === "vector") return `[${(value.value as number[]).join(",")}]`;
    if (value.kind === "uol") return `-> ${String(value.value)}`;
    if (value.kind === "raw") return `${(value.value as Uint8Array).length}B`;
    return value.kind;
  }
  if (value instanceof Uint8Array) return `${value.length}B`;
  return String(value);
}

/** One line for a canvas: what it measures, how much of it arrived, and its own properties. */
function canvasLine(name: string, canvas: WzCanvas, out: string[], depth: number): void {
  const indent = "  ".repeat(depth);
  out.push(
    `${indent}${name}  Canvas ${canvas.width}x${canvas.height} fmt=${canvas.format} ` +
      `origin=${shortValue(getProperty(canvas.props, "origin"))} ` +
      `pixels=${canvas.pixels?.length ?? 0}/${canvas.expectedBytes}${canvas.partial ? " (short)" : ""}`,
  );
}

/** Indented tree of one image (`props` in property order, canvases as one line each). */
function renderValue(name: string, value: WzValue, out: string[], depth: number): void {
  const indent = "  ".repeat(depth);
  if (value instanceof WzNode) {
    if (value.kind === "canvas") {
      canvasLine(name, value.value as WzCanvas, out, depth);
      for (const entry of (value.value as WzCanvas).props) renderValue(entry.name, entry.value, out, depth + 1);
      return;
    }
    out.push(`${indent}${name}`);
    renderNode(value, out, depth + 1);
    return;
  }
  if (value instanceof WzCanvas) {
    canvasLine(name, value, out, depth);
    return;
  }
  out.push(`${indent}${name} = ${JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? Number(item) : item))}`);
}

function renderNode(node: WzNode, out: string[], depth: number): void {
  const indent = "  ".repeat(depth);
  switch (node.kind) {
    case "props":
      for (const entry of node.props) renderValue(entry.name, entry.value, out, depth);
      break;
    case "vector":
      out.push(`${indent}Vector2D ${JSON.stringify(node.value)}`);
      break;
    case "convex":
      out.push(`${indent}Convex2D x${(node.value as WzNode[]).length}`);
      break;
    case "uol":
      out.push(`${indent}-> ${String(node.value)}`);
      break;
    default:
      out.push(`${indent}<${(node.value as Uint8Array).length} raw bytes>`);
      break;
  }
}

function runDump(archive: WzArchive, args: Record<string, string | boolean>): number {
  const [path] = positional(args);
  if (path === undefined) {
    process.stderr.write(`wz dump needs an image path\n\n${USAGE}`);
    return 1;
  }
  const objects = archive.objects(path);
  if (args.json === true) {
    const view = objects.map((object) => ({
      cls: object.cls,
      offset: object.offset,
      end: object.end,
      props: object.props.map((entry) => ({
        name: entry.name,
        type: entry.type,
        value: plain(entry.value),
      })),
    }));
    print(JSON.stringify(view, null, 2));
    return 0;
  }
  const out: string[] = [`${path} - ${objects.length} object(s)`];
  objects.forEach((object, index) => {
    out.push(`[${index}] ${object.cls} (offset ${object.offset}, ${object.end - object.offset} bytes)`);
    for (const entry of object.props) renderValue(entry.name, entry.value, out, 1);
  });
  print(out.join("\n"));
  return 0;
}

function runPng(archive: WzArchive, args: Record<string, string | boolean>): number {
  const [path] = positional(args);
  const out = typeof args.out === "string" ? args.out : undefined;
  if (path === undefined || out === undefined) {
    process.stderr.write(`wz png needs an image path and --out <dir>\n\n${USAGE}`);
    return 1;
  }
  const objects = archive.objects(path);
  const canvases = objects.flatMap((object) => walkCanvases(object.props));
  mkdirSync(out, { recursive: true });
  let written = 0;
  const skipped: string[] = [];
  canvases.forEach((canvas, index) => {
    const image = canvasToRgba(canvas);
    if (image === null) {
      skipped.push(`${index} ${canvas.width}x${canvas.height} (no pixels)`);
      return;
    }
    const file = join(out, `${String(index).padStart(3, "0")}_${canvas.width}x${canvas.height}.png`);
    writeFileSync(file, encodePng(image));
    written += 1;
    if (args.quiet !== true) {
      const origin = getProperty(canvas.props, "origin");
      print(
        `${file}  fmt=${canvas.format} origin=${JSON.stringify(origin ?? null)}` +
          `${canvas.partial ? " (pixels short - zero padded)" : ""}`,
      );
    }
  });
  print(`${written}/${canvases.length} canvases -> ${out}${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}`);
  return 0;
}

/** Entry point for `node src/cli.ts wz ...`. */
export function runWzCommand(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command === undefined ? 1 : 0;
  }
  const args = parseArgs(rest);
  let archive: WzArchive;
  try {
    archive = openData(args);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
  try {
    switch (command) {
      case "images":
        return runImages(archive, args);
      case "census":
        return runCensus(archive, args);
      case "maps":
        return runMaps(archive, args);
      case "dump":
        return runDump(archive, args);
      case "png":
        return runPng(archive, args);
      default:
        process.stderr.write(`unknown wz command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}
