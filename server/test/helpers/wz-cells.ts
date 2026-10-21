/**
 * Reading `Data.wz` canvases out of a test.
 *
 * Two things make this worth one shared helper instead of a copy in every test that needs it. The
 * archive is expensive to open - `WzArchive.open` scans the tail of an 87 MB file - so one instance
 * serves the whole process. And a canvas does not arrive as a `WzCanvas`: it arrives as a `WzNode`
 * whose value is one, which is why the walker has to look a level down before it recurses, and why
 * a naive `for (const entry of node.value)` throws `{} is not iterable`.
 *
 * Every test that uses this skips itself when `Data.wz` is not in the checkout, the same way
 * `wzimg.test.ts` and `art.test.ts` do.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WzArchive } from "../../src/wz/archive.ts";
import { WzCanvas, WzNode, type WzEntry, type WzTree } from "../../src/wz/img.ts";

const DATA_WZ = fileURLToPath(new URL("../../../Data.wz", import.meta.url));

/** One archive instance per process; `null` when the archive is not checked out. */
export const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;

/** Spread into a `test()`'s options so the test skips itself without the archive. */
export const needsArchive = { skip: archive === null };

function isEntry(value: unknown): value is WzEntry {
  return typeof value === "object" && value !== null && "name" in value && "value" in value;
}

/** `w x h` of a canvas, wherever it is in the tree. */
function sizeOf(value: WzTree): string | undefined {
  const canvas = value instanceof WzNode ? value.value : value;
  return canvas instanceof WzCanvas ? `${canvas.width}x${canvas.height}` : undefined;
}

/** The entry named `name` inside a node's property list, if the node holds one. */
function childOf(value: WzTree | undefined, name: string): WzTree | undefined {
  const inner = value instanceof WzNode ? value.value : undefined;
  if (!Array.isArray(inner)) return undefined;
  return (inner as WzEntry[]).find((entry) => entry.name === name)?.value;
}

/**
 * Depth-first walk that keeps each canvas's own path.
 *
 * A canvas is a `WzNode` wrapping a `WzCanvas`, so the node arm checks for the canvas first and
 * only recurses when the node holds a property list instead.
 */
export function canvasesUnder(value: WzTree, prefix: string, out: Map<string, string>): void {
  const size = sizeOf(value);
  if (size !== undefined) {
    out.set(prefix, size);
    return;
  }
  const inner = value instanceof WzNode ? value.value : value;
  if (Array.isArray(inner)) {
    for (const entry of inner) {
      if (isEntry(entry))
        canvasesUnder(entry.value, prefix ? `${prefix}/${entry.name}` : entry.name, out);
    }
  }
}

/** Every canvas under `UI/<image>/<strip>`, keyed by its path below the strip. */
export function cellsOf(image: string, strip: string): Map<string, string> {
  const out = new Map<string, string>();
  if (archive === null) return out;
  for (const object of archive.objects(image)) {
    const found = object.props.find((entry) => entry.name === strip);
    if (found !== undefined) canvasesUnder(found.value, "", out);
  }
  return out;
}

/**
 * The declared size of one canvas, written the way the client asks for it.
 *
 * `canvasSize("UI/UIWindow.img", "Item/backgrnd")` -> `"162x315"`, or `undefined` when the archive
 * is missing or the path is not there.
 */
export function canvasSize(image: string, path: string): string | undefined {
  if (archive === null) return undefined;
  const parts = path.split("/");
  let node = childOf(objectProps(image), parts[0] ?? "");
  for (const part of parts.slice(1)) node = childOf(node, part);
  return node === undefined ? undefined : sizeOf(node);
}

/** The top-level property list of one image, as a single pseudo-node. */
function objectProps(image: string): WzTree | undefined {
  for (const object of archive?.objects(image) ?? []) {
    return new WzNode("props", object.props);
  }
  return undefined;
}
