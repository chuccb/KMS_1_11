/**
 * Native shop sheet layout, hit-testing, scroll math and strip painting.
 *
 * Extracted from client/main.js for the same reason as the inventory sheet: the geometry is pure,
 * so it can be unit-tested instead of only being reachable through a live shop. main.js keeps the
 * shop model, the scroll offsets and the pointer state, and calls these helpers with them.
 *
 * Native anchors, all re-read against this checkout's own evidence in ADR-110:
 *  - `sub_461C50` builds the sheet and ends with
 *    `sub_545450(this, (800 - v17) >> 1, (600 - v16) >> 1, v15, pv, 10, a3)` - the window is
 *    centred on the 800x600 client, `((800 - w) >> 1, (600 - h) >> 1)`.
 *  - `UI/UIWindow.img` carries the 407x291 shop canvas, and (800-407)>>1 = 196,
 *    (600-291)>>1 = 154, which is exactly `SHOP.home`. The plate size and the home point are
 *    therefore not two independent hard-codes: either one proves the other.
 *  - `sub_4582A0` is the CCtrlTab painter. It asks `sub_4591A0` for the piece names:
 *    0 = `UI/Basic.img/Tab/left%d`, 1 = `middle%d`, 2 = `right%d`, 3 = `fill%d`, and the state it
 *    passes is a per-tab byte: 1 for the lit tab, 2 for the tab that follows it, 0 otherwise
 *    (`n2_1 = v28 == v55; if (...) n2_1 = 2;`), with `fill` taking only lit/not-lit.
 *  - `sub_4581F0` (the CCtrlTab creator) refuses `n4 >= 4`, i.e. a strip holds at most four tabs.
 *  - `UI/Basic.img/Tab` canvases are left 4x24, middle 14x24, right 12x24 and fill 1x24 - the
 *    four-pixel cap, the fourteen-pixel crease at each tab's right edge, the twelve-pixel end cap
 *    and the one-pixel fill columns that stretch a tab to its width.
 *  - `UI/Basic.img/VScr` canvases are 12x12: the trough, both caps and the thumb are twelve
 *    pixels, which is where the scrollbar's width and the 12-px offsets above and below the
 *    thumb's travel come from.
 */
import { INVENTORY_TABS } from "./inventory-window.ts";
import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";

export type ShopSide = "buy" | "sell";
export const SHOP_SIDES: readonly ShopSide[] = ["buy", "sell"];

export interface ShopBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShopList {
  x: number;
  y: number;
  rows: number;
  pitch: number;
  slot: number;
  nameX: number;
  nameRight: number;
}

export interface ShopLayout {
  path: string;
  width: number;
  height: number;
  /** `sub_461C50`: the window is centred, `((800 - w) >> 1, (600 - h) >> 1)`. */
  home: UiPoint;
  close: ShopBox;
  buy: ShopBox;
  sell: ShopBox;
  recharge: ShopBox;
  tabs: ShopBox;
  buyList: ShopList;
  sellList: ShopList;
  /**
   * The two selected-row faces, 188x34 - two pixels wider and taller than the 32-px row, so the
   * raised frame shows. The sheet's row has its slot at x=6/y=68 (left) and x=209/y=91 (right);
   * the sprite's slot interior sits one pixel inside its own edge, which is what puts the stamps
   * at (1,67) and (204,90).
   */
  face: Record<ShopSide, { path: string; x: number; y: number }>;
  /** The dark field left of the sheet's own `메소` label. */
  mesos: { right: number; y: number };
  /** 12-px scrollbars (`UI/Basic.img/VScr` canvases are 12x12), drawn only when a list overflows. */
  scrollbar: Record<ShopSide, { x: number; y: number; height: number }>;
}

export const SHOP: ShopLayout = {
  path: "UI/UIWindow.img/Shop/backgrnd",
  width: 407,
  height: 291,
  home: { x: 196, y: 154 },
  close: { x: 188, y: 9, width: 32, height: 15 },
  buy: { x: 78, y: 31, width: 46, height: 19 },
  sell: { x: 283, y: 31, width: 46, height: 19 },
  recharge: { x: 225, y: 29, width: 50, height: 23 },
  tabs: { x: 206, y: 65, width: 198, height: 24 },
  buyList: { x: 6, y: 68, rows: 6, pitch: 35, slot: 32, nameX: 42, nameRight: 184 },
  sellList: { x: 209, y: 91, rows: 5, pitch: 35, slot: 32, nameX: 245, nameRight: 388 },
  face: {
    buy: { path: "UI/UIWindow.img/Shop/buy", x: 1, y: 67 },
    sell: { path: "UI/UIWindow.img/Shop/sell", x: 204, y: 90 },
  },
  mesos: { right: 368, y: 272 },
  scrollbar: {
    buy: { x: 189, y: 68, height: 207 },
    sell: { x: 390, y: 89, height: 174 },
  },
};

/** A buy row (itemId/price) or a sell row (slot/itemId/quantity); only the shape the sheet reads. */
export interface ShopRow {
  slot?: number;
  itemId: number;
  [field: string]: unknown;
}

/** The list geometry for one side. */
export function shopListOf(side: ShopSide): ShopList {
  return side === "buy" ? SHOP.buyList : SHOP.sellList;
}

/** How many rows a list shows at once (6 on the left, 5 under the tabs). */
export function shopVisibleRows(side: ShopSide): number {
  return shopListOf(side).rows;
}

/** The row index under a window-local point, or undefined. */
export function shopRowAt(
  side: ShopSide,
  localX: number,
  localY: number,
  scrollRow: number,
): number | undefined {
  const list = shopListOf(side);
  const row = Math.floor((localY - list.y) / list.pitch);
  if (row < 0 || row >= list.rows) return undefined;
  // Inside the 32-px row face, not the 3-px gap below it.
  if (localY - list.y - row * list.pitch >= list.slot) return undefined;
  if (localX < list.x || localX >= SHOP.scrollbar[side].x) return undefined;
  return row + scrollRow;
}

/** Which tab of the strip is under a window-local point, or -1. */
export function shopTabAt(localX: number, localY: number): number {
  const { tabs } = SHOP;
  if (localY < tabs.y || localY >= tabs.y + tabs.height) return -1;
  if (localX < tabs.x || localX >= tabs.x + tabs.width) return -1;
  const inner = tabs.width - 4 - 12;
  return Math.max(0, Math.min(3, Math.floor(((localX - tabs.x - 4) * 4) / inner)));
}

export interface ShopScrollGeometry {
  max: number;
  /** Thumb travel: the bar minus both 12 px caps and the thumb itself. */
  travel: number;
  offset: number;
}

/** VScr's thumb is a fixed 12px sprite; only its position changes, not its painted size.
 * A list that fits needs no bar at all, hence `undefined`. */
export function shopScrollbarGeometry(
  side: ShopSide,
  rowCount: number,
  scrollRow: number,
): ShopScrollGeometry | undefined {
  const max = rowCount - shopVisibleRows(side);
  if (max <= 0) return undefined;
  const travel = SHOP.scrollbar[side].height - 36;
  return {
    max,
    travel,
    offset: Math.round((travel * Math.min(max, scrollRow)) / max),
  };
}

/** Clamp a requested scroll position the way the native setter does (no rounding: rows are whole). */
export function clampShopScroll(side: ShopSide, rowCount: number, position: number): number {
  const max = Math.max(0, rowCount - shopVisibleRows(side));
  return Math.max(0, Math.min(max, position));
}

export type ShopHit =
  | { kind: "close" }
  | { kind: "button"; button: "buy" | "sell" | "recharge" }
  | { kind: "tab"; index: number; tab: number }
  | { kind: "scrollbar"; side: ShopSide; part: "prev" | "next" | "thumb" | "track" }
  | { kind: `${ShopSide}-row`; index: number; row: ShopRow }
  | { kind: "body" };

export interface ShopWindowQuery {
  /** Where the sheet currently sits (CConfig position). */
  position: UiPoint;
  x: number;
  y: number;
  rows: Record<ShopSide, readonly ShopRow[]>;
  scroll: Record<ShopSide, number>;
}

function inside(box: ShopBox, localX: number, localY: number): boolean {
  return (
    localX >= box.x && localX < box.x + box.width && localY >= box.y && localY < box.y + box.height
  );
}

/**
 * What of the shop is at a surface point, or `undefined` outside the sheet. Callers decide whether
 * a shop is open at all. Rows are tested per side in the sheet's own order (buy then sell), and a
 * point both windows cover belongs to the shop - the desktop client stacks its modeless windows
 * the same way, drawing the inventory first.
 */
export function shopWindowAt(query: ShopWindowQuery): ShopHit | undefined {
  const localX = query.x - query.position.x;
  const localY = query.y - query.position.y;
  if (localX < 0 || localY < 0 || localX >= SHOP.width || localY >= SHOP.height) return undefined;
  if (inside(SHOP.close, localX, localY)) return { kind: "close" };
  for (const button of ["buy", "sell", "recharge"] as const) {
    if (inside(SHOP[button], localX, localY)) return { kind: "button", button };
  }
  const tab = shopTabAt(localX, localY);
  if (tab >= 0) return { kind: "tab", index: tab, tab: INVENTORY_TABS[tab]?.tab ?? tab + 1 };
  for (const side of SHOP_SIDES) {
    const geometry = shopScrollbarGeometry(side, query.rows[side].length, query.scroll[side]);
    const bar = SHOP.scrollbar[side];
    if (geometry !== undefined && inside({ ...bar, width: 12 }, localX, localY)) {
      const offset = localY - bar.y;
      return {
        kind: "scrollbar",
        side,
        part:
          offset < 12
            ? "prev"
            : offset >= bar.height - 12
              ? "next"
              : offset >= 12 + geometry.offset && offset < 24 + geometry.offset
                ? "thumb"
                : "track",
      };
    }
    const row = shopRowAt(side, localX, localY, query.scroll[side]);
    const rows = query.rows[side];
    if (row !== undefined && row < rows.length)
      return { kind: `${side}-row`, index: row, row: rows[row] as ShopRow };
  }
  return { kind: "body" };
}

/** The 12-px `UI/Basic.img/VScr` strip: arrows, a clipped tiled trough and a fixed-size thumb. */
export function drawShopScrollbar(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  side: ShopSide,
  originX: number,
  originY: number,
  geometry: ShopScrollGeometry,
): void {
  const bar = SHOP.scrollbar[side];
  const x = originX + bar.x;
  const y = originY + bar.y;
  const stamp = (piece: string, at: number): void => {
    const entry = image(`UI/Basic.img/VScr/enabled/${piece}`);
    if (entry.ready) ctx.drawImage(entry.img, x, at);
  };
  stamp("prev0", y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + 12, 12, bar.height - 24);
  ctx.clip();
  for (let tile = 12; tile < bar.height - 12; tile += 12) stamp("base", y + tile);
  ctx.restore();
  stamp("next0", y + bar.height - 12);
  stamp("thumb0", y + 12 + geometry.offset);
}

/**
 * The four category tabs, built out of `UI/Basic.img/Tab` the way `CCtrlTab` (sub_4582A0) paints
 * them: one 4-px `left` cap, a run of 1-px `fill` columns per tab, a 14-px `middle` crease at each
 * tab's right edge, and one 12-px `right` cap that fades back into the sheet's navy strip. The
 * crease is state 1 under the lit tab and state 2 when the next tab is the lit one.
 */
export function drawShopTabs(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  originX: number,
  originY: number,
  openTab: number,
): void {
  const { tabs } = SHOP;
  const count = INVENTORY_TABS.length;
  const open = Math.max(
    0,
    INVENTORY_TABS.findIndex((entry) => entry.tab === openTab),
  );
  const x0 = originX + tabs.x;
  const y = originY + tabs.y;
  const cap = 4;
  const right = 12;
  const inner = tabs.width - cap - right;
  const stamp = (piece: string, x: number): void => {
    const entry = image(`UI/Basic.img/Tab/${piece}`);
    if (entry.ready) ctx.drawImage(entry.img, x, y);
  };
  stamp(`left${open === 0 ? 1 : 0}`, x0);
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let start = x0 + cap;
  for (let index = 0; index < count; index++) {
    const end = x0 + cap + Math.round((inner * (index + 1)) / count);
    const lit = index === open;
    // The crease belongs to this tab's right edge, so the last one sits under the right cap.
    if (index < count - 1) {
      const piece = lit ? "middle1" : index + 1 === open ? "middle2" : "middle0";
      stamp(piece, end - 14);
    }
    const state = lit ? 1 : 0;
    for (let fill = start; fill < end - (index < count - 1 ? 14 : 0); fill++)
      stamp(`fill${state}`, fill);
    // `sub_4582A0` drops an unselected label one pixel, which is what makes the lit tab stand out.
    ctx.fillStyle = "#000000";
    ctx.fillText(INVENTORY_TABS[index]?.label ?? "", (start + end) / 2, y + (lit ? 12 : 13));
    start = end;
  }
  stamp(`right${open === count - 1 ? 1 : 0}`, x0 + tabs.width - right);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
