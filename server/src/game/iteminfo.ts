/**
 * What an item *is* to a person: its name, its price, its description - and its icon, as the
 * archive draws it.
 *
 * WHY THIS IS NOT IN THE PROTOCOL
 * -------------------------------
 * None of this travels on the wire. The 2003 client builds an item's tooltip from the archive it
 * loaded (`Item/<kind>/0XXX.img/<id>/info`), and `0x0B`/`CharacterData` carry only the id and the
 * per-instance numbers (quantity, the 15 equip stats). A rewritten client needs the same lookup, so
 * it lives here once, next to the other archive readers (`game/map.ts`, `game/mobs.ts`).
 *
 * WHERE THE DATA IS (and what is *not* there)
 * -------------------------------------------
 * - Consumables, etc, books and special items: `Item/<kind>/<4-digit>.img`, and the item is a child
 *   named with all eight digits (`02000000`), so `info/name`, `info/price`, `info/desc` and the two
 *   canvas nodes `info/icon` / `info/iconRaw` are one property lookup below the root.
 * - Equipment: **not** under `Item/` in this build. It is `Character/<Category>/<8-digit>.img`
 *   (`Character/Weapon/01302000.img`), and there `info` sits at the root of the image. The category
 *   directory is found by scanning the archive's own image list instead of hard-coding a table of
 *   ten names - the archive is the evidence, and a hard-coded table would silently miss a category.
 * - There is no `String/` image in this `Data.wz` (see `analysis/data_wz_manifest.json`), which is
 *   where later MapleStory versions keep names. Here the names live inside the item images, which is
 *   why this module can answer at all.
 *
 * ICONS
 * -----
 * `info/iconRaw` is what `sub_47CE40` hands to the drawer, and it is 27x27 rather than `icon`'s
 * 27x30 with an origin below the baseline; both are exported as PNG through `wz/png.ts`, the same
 * encoder `wz png` uses. A missing canvas is `undefined`, never a placeholder: a caller that draws a
 * placeholder is making a choice this module cannot make for it.
 */
import type { WzCanvas, WzObject } from "../wz/img.ts";
import { canvasToRgba, WzNode } from "../wz/img.ts";
import { encodePng } from "../wz/png.ts";
import { asNumber, asText, entriesOf, propertyOf } from "../wz/props.ts";
import { ITEM_KIND_BY_PREFIX } from "../wz/paths.ts";

/**
 * The part of `WzArchive` this module needs.
 *
 * Narrower than the class on purpose: a test can hand it a handful of fake images instead of
 * inflating an 87 MB archive, and the type still accepts the real one.
 */
export interface ItemSource {
  /** Every image of the archive; only `path` is read. */
  readonly images: readonly { readonly path: string }[];
  has(path: string): boolean;
  objects(path: string): WzObject[];
}

/** The human-visible facts about one item id. Every field but `id` is optional: a WZ entry may not have it. */
export interface ItemInfo {
  id: number;
  /** `info/name` - the archive's own string, not a translation. */
  name?: string;
  /** `info/price` - the number the shop window prints (`game/shops.ts` reads the same field). */
  price?: number;
  /** `info/desc` - the multi-line tooltip body, with the archive's own `\n` escapes. */
  desc?: string;
  /** `info/iconRaw` (or `info/icon`), the node `sub_47CE40` draws for a drop. */
  iconRaw?: ItemIcon;
  /** `info/incPAD` - a weapon's or glove's attack. The only number a damage roll needs. */
  incPAD?: number;
}

/** Where one item id's `info` node lives: the image, and the child of its root (null = the root itself). */
export interface ItemLocation {
  imagePath: string;
  nodeName: string | null;
}

/** `02000000` for `2000000`: the eight-digit form every item image uses as a child name. */
export function paddedItemId(itemId: number): string {
  return String(itemId).padStart(8, "0");
}

/**
 * The image that carries an item id, or `undefined` when the archive has none.
 *
 * `Item/<kind>/<4-digit>.img` is a *path builder* (`wz/paths.ts`, located in the client); the
 * equipment half is a scan, because the directory names (`Cap`, `Weapon`, `Clothes`, …) are the
 * archive's layout rather than something the binary spells out.
 */
export function locateItemImage(
  imagePaths: readonly string[],
  itemId: number,
): ItemLocation | undefined {
  if (!Number.isInteger(itemId) || itemId < 0) return undefined;
  const padded = paddedItemId(itemId);
  const kind = ITEM_KIND_BY_PREFIX[padded.slice(0, 2)];
  if (kind !== undefined) {
    return { imagePath: `Item/${kind}/${padded.slice(0, 4)}.img`, nodeName: padded };
  }
  // Equipment: `Character/<Category>/<padded>.img`. A category can hold only one file per id, so the
  // first match is the only match; the scan is cached per id by the catalog below.
  const suffix = `/${padded}.img`;
  for (const path of imagePaths) {
    if (!path.startsWith("Character/") || !path.endsWith(suffix)) continue;
    if (path.split("/").length !== 3) continue;
    return { imagePath: path, nodeName: null };
  }
  return undefined;
}

/**
 * Where an item's own picture is, and how to draw it.
 *
 * An icon is a canvas with an `origin`, and the origin is not decoration: a ground drop and a shop
 * row both anchor the icon by it, and item icons do not agree on it (`-4,27` for a snail shell,
 * `-3,30` for a red potion). The path is the archive path `/api/png` already serves.
 */
export interface ItemIcon {
  path: string;
  width: number;
  height: number;
  ox: number;
  oy: number;
}

/** The catalog a browser (or any other client) can ask about item ids. */
export interface ItemCatalog {
  /** `undefined` when the archive does not carry the item at all. */
  info(itemId: number): ItemInfo | undefined;
  /** One PNG, or `undefined` when the item has no canvas. Cached after the first call. */
  icon(itemId: number): Uint8Array | undefined;
}

/**
 * The `info` property list of one item, or `undefined`.
 *
 * `locateItemImage` only says where the item *would* be; this is where the child is really looked up,
 * so a caller never sees a half-resolved item (an id whose image exists but whose child does not).
 */
function infoNodeOf(root: WzObject | undefined, location: ItemLocation): Record<string, unknown> | undefined {
  if (root === undefined) return undefined;
  const node = location.nodeName === null ? root : propertyOf(root, location.nodeName);
  if (node === undefined || node === null) return undefined;
  const info = propertyOf(node, "info");
  if (info === undefined || info === null) return undefined;
  const out: Record<string, unknown> = {};
  for (const entry of entriesOf(info)) out[entry.name] = entry.value;
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * The canvas of one item's `info`, `iconRaw` first - the node `sub_47CE40` draws.
 *
 * A canvas arrives as a `WzNode` of kind `canvas` whose `value` is the `WzCanvas` (the tree is
 * typed that way so a `props` node and a `canvas` node share a shape); the unwrap is `WzNode.canvas`.
 */
function iconCanvasOf(
  root: WzObject | undefined,
  location: ItemLocation,
): { canvas: WzCanvas; name: string } | undefined {
  if (root === undefined) return undefined;
  const node = location.nodeName === null ? root : propertyOf(root, location.nodeName);
  if (node === undefined || node === null) return undefined;
  const info = propertyOf(node, "info");
  for (const name of ["iconRaw", "icon"]) {
    const value = propertyOf(info, name);
    if (value instanceof WzNode) {
      const canvas = value.canvas;
      if (canvas !== undefined) return { canvas, name };
    }
  }
  return undefined;
}

/**
 * Builds the catalog over one archive.
 *
 * `undefined` in, `undefined` out: `--data off` means no archive, and every caller already handles
 * "no data, no answer" for maps, drops and shops the same way. The parsed roots are cached per image
 * path (a shop page asks about many ids of one image) and the resolved location per item id.
 */
export function itemCatalogOf(source: ItemSource | undefined): ItemCatalog | undefined {
  if (source === undefined) return undefined;
  const imagePaths = source.images.map((image) => image.path);
  const locations = new Map<number, ItemLocation | undefined>();
  const roots = new Map<string, WzObject | undefined>();
  const icons = new Map<number, Uint8Array | undefined>();

  const locate = (itemId: number): ItemLocation | undefined => {
    if (!locations.has(itemId)) locations.set(itemId, locateItemImage(imagePaths, itemId));
    return locations.get(itemId);
  };
  const rootOf = (path: string): WzObject | undefined => {
    if (!roots.has(path)) roots.set(path, source.objects(path)[0]);
    return roots.get(path);
  };
  const iconMetas = new Map<number, ItemIcon | undefined>();
  const iconMetaOf = (itemId: number): ItemIcon | undefined => {
    if (iconMetas.has(itemId)) return iconMetas.get(itemId);
    let meta: ItemIcon | undefined;
    const location = locate(itemId);
    if (location !== undefined && source.has(location.imagePath)) {
      const found = iconCanvasOf(rootOf(location.imagePath), location);
      if (found !== undefined) {
        let ox = 0;
        let oy = 0;
        for (const entry of found.canvas.props) {
          if (entry.name !== "origin") continue;
          const origin = entry.value;
          if (origin instanceof WzNode && Array.isArray(origin.value)) {
            const [x, y] = origin.value as [number, number];
            if (typeof x === "number" && typeof y === "number") [ox, oy] = [x, y];
          }
        }
        const parent = location.nodeName === null ? location.imagePath : `${location.imagePath}/${location.nodeName}`;
        meta = {
          path: `${parent}/info/${found.name}`,
          width: found.canvas.width,
          height: found.canvas.height,
          ox,
          oy,
        };
      }
    }
    iconMetas.set(itemId, meta);
    return meta;
  };

  return {
    info(itemId: number): ItemInfo | undefined {
      const location = locate(itemId);
      if (location === undefined || !source.has(location.imagePath)) return undefined;
      const info = infoNodeOf(rootOf(location.imagePath), location);
      if (info === undefined) return undefined;
      const name = asText(info.name, "");
      const price = asNumber(info.price, Number.NaN);
      const desc = asText(info.desc, "");
      const incPAD = asNumber(info.incPAD, Number.NaN);
      const iconMeta = iconMetaOf(itemId);
      return {
        id: itemId,
        ...(name === "" ? {} : { name }),
        ...(Number.isFinite(price) ? { price } : {}),
        ...(desc === "" ? {} : { desc }),
        ...(Number.isFinite(incPAD) ? { incPAD } : {}),
        ...(iconMeta === undefined ? {} : { iconRaw: iconMeta }),
      };
    },

    icon(itemId: number): Uint8Array | undefined {
      if (icons.has(itemId)) return icons.get(itemId);
      let png: Uint8Array | undefined;
      const location = locate(itemId);
      if (location !== undefined && source.has(location.imagePath)) {
        const canvas = iconCanvasOf(rootOf(location.imagePath), location)?.canvas;
        if (canvas !== undefined) {
          const rgba = canvasToRgba(canvas);
          if (rgba !== null) png = encodePng(rgba);
        }
      }
      icons.set(itemId, png);
      return png;
    },
  };
}
