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
import { INVENTORY_TABS, isRechargeableItem } from "./inventory-window.ts";
import { drawItemNo, ITEM_NO_CELL_TOP } from "./itemno.ts";
import { SLOT_PITCH, SLOT_SIZE } from "./slot.ts";
import { TAB_FILL, TAB_LEFT, TAB_MIDDLE, TAB_RIGHT } from "./tabstrip.ts";
import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";
import { paintVScrollbar, vScrollTravel, VSCR_CELL } from "./vscroll.ts";
import { BT_UI_CLOSE } from "./uicontrols.ts";

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
  /**
   * 12-px scrollbars (`UI/Basic.img/VScr` canvases are 12x12), drawn only when a list overflows.
   * `arrow` is the cap cell's own size, which is the tiling pitch down the trough and the distance
   * the thumb keeps from each end - `sub_452500`'s `3 * arrow`.
   */
  scrollbar: Record<
    ShopSide,
    { x: number; y: number; width: number; height: number; arrow: number }
  >;
}

export const SHOP: ShopLayout = {
  path: "UI/UIWindow.img/Shop/backgrnd",
  width: 407,
  height: 291,
  home: { x: 196, y: 154 },
  close: { x: 188, y: 9, width: BT_UI_CLOSE.width, height: BT_UI_CLOSE.height },
  buy: { x: 78, y: 31, width: 46, height: 19 },
  sell: { x: 283, y: 31, width: 46, height: 19 },
  recharge: { x: 225, y: 29, width: 50, height: 23 },
  tabs: { x: 206, y: 65, width: 198, height: 24 },
  buyList: { x: 6, y: 68, rows: 6, pitch: SLOT_PITCH, slot: SLOT_SIZE, nameX: 42, nameRight: 184 },
  sellList: {
    x: 209,
    y: 91,
    rows: 5,
    pitch: SLOT_PITCH,
    slot: SLOT_SIZE,
    nameX: 245,
    nameRight: 388,
  },
  face: {
    buy: { path: "UI/UIWindow.img/Shop/buy", x: 1, y: 67 },
    sell: { path: "UI/UIWindow.img/Shop/sell", x: 204, y: 90 },
  },
  mesos: { right: 368, y: 272 },
  scrollbar: {
    buy: { x: 189, y: 68, width: VSCR_CELL, height: 207, arrow: VSCR_CELL },
    sell: { x: 390, y: 89, width: VSCR_CELL, height: 174, arrow: VSCR_CELL },
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
  const inner = tabs.width - TAB_LEFT - TAB_RIGHT;
  return Math.max(0, Math.min(3, Math.floor(((localX - tabs.x - TAB_LEFT) * 4) / inner)));
}

export interface ShopScrollGeometry {
  /**
   * Rows past the ones that fit: `rows - capacity`, so a list that fits has none. This is one less
   * than the native `SetMax` (`rows - (capacity - 1)`), which is what {@link paintVScrollbar}
   * compares to 1 to pick the enabled or the disabled cells.
   */
  max: number;
  /** Thumb travel: the bar minus both 12 px caps and the thumb itself. */
  travel: number;
  /** `sub_452500`: `floor(pos * travel / max)` - the native truncates, it does not round. */
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
  const travel = vScrollTravel(SHOP.scrollbar[side].height);
  return {
    max,
    travel,
    offset: Math.floor((travel * Math.min(max, scrollRow)) / max),
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
    if (geometry !== undefined && inside(bar, localX, localY)) {
      const offset = localY - bar.y;
      const onThumb =
        offset >= VSCR_CELL + geometry.offset && offset < 2 * VSCR_CELL + geometry.offset;
      return {
        kind: "scrollbar",
        side,
        part:
          offset < VSCR_CELL
            ? "prev"
            : offset >= bar.height - VSCR_CELL
              ? "next"
              : onThumb
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

/**
 * The 12-px `UI/Basic.img/VScr` strip, painted by the shared {@link paintVScrollbar}.
 *
 * The shop keeps its scroll position as a plain row index per side (`sub_4B6EC0`'s `m_nCurPos`,
 * clamped by `sub_4B6EC0`'s own setter rather than by a `CCtrlScrollBar`), so it hands the painter
 * the two numbers directly. The cap is never drawn pressed: unlike the trade window the shop has
 * no per-arrow held state, and `sub_4521E0`'s `+56/+60` stamps belong to the control, not to
 * whichever window happens to own one.
 */
export function drawShopScrollbar(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  side: ShopSide,
  originX: number,
  originY: number,
  geometry: ShopScrollGeometry,
): void {
  paintVScrollbar(ctx, image, { x: originX, y: originY }, SHOP.scrollbar[side], {
    // `geometry.max` counts rows past the visible ones; the painter wants the native `SetMax`.
    max: geometry.max + 1,
    offset: geometry.offset,
  });
}

/**
 * The four category tabs the way `CCtrlTab` (sub_4582A0) paints them. The crease is state 1 under
 * the lit tab and state 2 when the next tab is the lit one.
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
  const inner = tabs.width - TAB_LEFT - TAB_RIGHT;
  const stamp = (piece: string, x: number): void => {
    const entry = image(`UI/Basic.img/Tab/${piece}`);
    if (entry.ready) ctx.drawImage(entry.img, x, y);
  };
  stamp(`left${open === 0 ? 1 : 0}`, x0);
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let start = x0 + TAB_LEFT;
  for (let index = 0; index < count; index++) {
    const end = x0 + TAB_LEFT + Math.round((inner * (index + 1)) / count);
    const lit = index === open;
    // The crease belongs to this tab's right edge, so the last one sits under the right cap.
    const crease = index < count - 1 ? TAB_MIDDLE : 0;
    if (index < count - 1) {
      const piece = lit ? "middle1" : index + 1 === open ? "middle2" : "middle0";
      stamp(piece, end - TAB_MIDDLE);
    }
    const state = lit ? 1 : 0;
    for (let fill = start; fill < end - crease; fill += TAB_FILL) stamp(`fill${state}`, fill);
    // `sub_4582A0` drops an unselected label one pixel, which is what makes the lit tab stand out.
    ctx.fillStyle = "#000000";
    ctx.fillText(INVENTORY_TABS[index]?.label ?? "", (start + end) / 2, y + (lit ? 12 : 13));
    start = end;
  }
  stamp(`right${open === count - 1 ? 1 : 0}`, x0 + tabs.width - TAB_RIGHT);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * `sub_4B5B10`: where a row's icon goes, inside the row's own box.
 *
 * With a raw icon the sheet anchors it by that icon's origin - `sub_4B5FA0` asks for `209 - v53`
 * and `v50 - v54 + 32`, which is this list's `x` (209 on the sell pane) and its 32px row face.
 * Without one the icon is centred in the slot instead. The two branches do not agree on the y
 * anchor on purpose: the raw form hangs the icon off the row's BOTTOM (`slot - oy`), the centred
 * one off its top.
 */
export function shopRowIconOrigin(
  list: ShopList,
  width: number,
  height: number,
  raw: { ox: number; oy: number } | undefined,
): { left: number; top: number } {
  return raw !== undefined
    ? { left: list.x - raw.ox, top: list.slot - raw.oy }
    : {
        left: list.x + Math.floor((list.slot - width) / 2),
        top: Math.floor((list.slot - height) / 2),
      };
}

/** `sub_4B5FA0` prints a stack count on the sell pane for everything except equipment (1xxxxxx). */
export function shopRowStackCount(row: { itemId: number; quantity?: number }): number | undefined {
  if (isEquipmentItem(row.itemId)) return undefined;
  return row.quantity;
}

/**
 * The meso figure under a row's name (`sub_4B4AD0`).
 *
 * The shelf shows the shop's own price; the sell pane shows the item's `info/price` plus
 * `ceil(count * info/unitPrice)`. That sum is the native display basis - it is not a promise about
 * the reconstructed server's resale policy, which is a separate rule.
 */
export function shopRowPrice(
  side: ShopSide,
  row: { price?: number; quantity?: number },
  info: { price?: number; unitPrice?: number } | undefined,
): number | undefined {
  if (side === "buy") return row.price;
  if (info?.price === undefined) return undefined;
  return info.price + Math.ceil((row.quantity ?? 1) * (info.unitPrice ?? 0));
}

/** Whether the picked row is on the page the pane is showing, so its highlighted face is drawn. */
export function shopPickedRowVisible(picked: number, scroll: number, list: ShopList): boolean {
  return picked >= scroll && picked < scroll + list.rows;
}

/**
 * Where a row's two text lines sit, relative to the row's own top edge.
 *
 * `sub_4B5B10` (the buy pane) puts the name at `n71_2` and the price at `n71_1 + 16`;
 * `sub_4B5FA0` (the sell pane) puts them at `n110_1 - 16` and `n110`, and `n110` starts at 110 -
 * which is the sell list's first row (y=91) plus 19. So the 16 px gap between the lines is the
 * native one, and 3/19 are just that pair anchored to the row's top edge instead of its price.
 */
export const SHOP_ROW_NAME_TOP = 3;
export const SHOP_ROW_PRICE_TOP = 19;
/** Our own clipping box: one line of the 11 px row font. No native constant found for it. */
export const SHOP_ROW_TEXT_CLIP = 14;

/**
 * `sub_4B5FA0`'s stack count: x = `n110_2` = 209 (the sell list's own `x`) and y = `n110 + 1` = 111,
 * against the 91 the sell row starts at - so it is the same `(cell.left, cell.top + 20)` anchor
 * every other `sub_525AE0` caller uses. The glyphs themselves come out of `client/itemno.ts`.
 */
export const SHOP_STACK_TOP = ITEM_NO_CELL_TOP;

/** One line of row text, clipped to the column it belongs in. */
export function drawShopRowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
): void {
  ctx.save();
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.beginPath();
  ctx.rect(x, y - 1, width, SHOP_ROW_TEXT_CLIP);
  ctx.clip();
  ctx.fillStyle = "#000000";
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The item's icon, as far as the row painter cares: loaded or not, how big, and its WZ origin. */
export interface ShopRowIcon {
  img: CanvasImageSource;
  ready: boolean;
  width: number;
  height: number;
  /** The icon's own origin; `sub_4B5FA0` anchors by the origin, not by the icon's centre. */
  raw?: { ox: number; oy: number };
}

/** One row's painted content. Icons and names live outside this module, so the caller resolves them. */
export interface ShopRowPaint {
  icon?: ShopRowIcon;
  /** The sell pane's stack count; `undefined` on the buy pane and for equipment (`1xxxxxx`). */
  stack?: number;
  name: string;
  /** Mesos, already resolved by `shopRowPrice`. */
  price?: number;
}

/** What {@link drawShopList} needs: one entry per visible row, in painting order. */
export interface ShopListPaint {
  /** Index into the full row list of the picked row, or -1 when nothing is picked. */
  picked: number;
  scroll: number;
  /** The whole list's length - it is what decides whether a scrollbar appears at all. */
  total: number;
  /** `shopVisibleRows(side)` entries; `undefined` where the list has run out. */
  rows: (ShopRowPaint | undefined)[];
}

/**
 * One list: the picked row's face, then each visible row's icon, stack count, name and price, then
 * the scrollbar when the list overflows. `sub_4B5B10` (buy) and `sub_4B5FA0` (sell) are the same
 * loop - `n71 += 35` and `n110 += 35` - with the count drawn only on the sell side.
 */
export function drawShopList(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  side: ShopSide,
  originX: number,
  originY: number,
  paint: ShopListPaint,
): void {
  const list = shopListOf(side);
  if (shopPickedRowVisible(paint.picked, paint.scroll, list)) {
    const face = image(SHOP.face[side].path);
    if (face.ready)
      ctx.drawImage(
        face.img,
        originX + SHOP.face[side].x,
        originY + SHOP.face[side].y + (paint.picked - paint.scroll) * list.pitch,
      );
  }
  for (let row = 0; row < list.rows; row++) {
    const entry = paint.rows[row];
    if (entry === undefined) continue;
    const cellY = originY + list.y + row * list.pitch;
    const icon = entry.icon;
    if (icon?.ready) {
      const at = shopRowIconOrigin(list, icon.width, icon.height, icon.raw);
      ctx.drawImage(icon.img, originX + at.left, cellY + at.top);
    }
    if (entry.stack !== undefined)
      drawItemNo(ctx, image, entry.stack, originX + list.x, cellY + SHOP_STACK_TOP);
    const nameWidth = list.nameRight - list.nameX;
    drawShopRowText(ctx, entry.name, originX + list.nameX, cellY + SHOP_ROW_NAME_TOP, nameWidth);
    if (entry.price !== undefined)
      drawShopRowText(
        ctx,
        `${entry.price} 메소`,
        originX + list.nameX,
        cellY + SHOP_ROW_PRICE_TOP,
        nameWidth,
      );
  }
  const geometry = shopScrollbarGeometry(side, paint.total, paint.scroll);
  if (geometry !== undefined) drawShopScrollbar(ctx, image, side, originX, originY, geometry);
}

/**
 * How the shop asks for a count when you buy (`sub_4B6B40`, FINDINGS 4.19).
 *
 * A rechargeable stack is confirmed whole and forced to one - "정말로 사시겠습니까?" - because its
 * count is rounds, not items. Equipment is always exactly one, with no dialog at all. Everything
 * else gets "몇 개를 사시겠습니까?" with the row's own maximum.
 *
 * Selling is a different pair of branches: there the rechargeable confirm is the only special
 * case, and equipment goes through the count dialog like anything else.
 */
export type ShopBuyCount = "confirm" | "one" | "quantity";

export function shopBuyCount(itemId: number): ShopBuyCount {
  if (isRechargeableItem(itemId)) return "confirm";
  return isEquipmentItem(itemId) ? "one" : "quantity";
}

/** Equipment: the leading 1 of `1xxxxxx`. `sub_4B5FA0` prints no stack count for these. */
export function isEquipmentItem(itemId: number): boolean {
  return Math.floor(itemId / 1_000_000) === 1;
}

/**
 * Whether a shop request is allowed out at all - the five gates `buy`, `sell` and `recharge` all
 * pass in the same order, before either looks at the row it was asked about.
 */
export interface ShopActionState {
  /** A shop request is already in flight. */
  shopPending: boolean;
  /** An inventory slot request is already in flight. */
  slotPending: boolean;
  /** A meso request is already in flight. */
  mesoPending: boolean;
  /** A modal dialog owns the input. */
  modalOpen: boolean;
  /** The player's own HP; `undefined` before the view arrives, and then nothing is blocked. */
  hp: number | undefined;
}

export function shopActionBlocked(state: ShopActionState): boolean {
  return (
    state.shopPending ||
    state.slotPending ||
    state.mesoPending ||
    state.modalOpen ||
    (state.hp !== undefined && state.hp <= 0)
  );
}

/**
 * The widest count the `0x30` shop request can carry.
 *
 * The count is a `u16`, which is why `server/src/client/session.ts` refuses anything above this
 * (and below 1, or below 0 for a 207 sell). The native boxes never clamp - `sub_4B6B40` asks for
 * `row[8]` straight - because no real stack comes close; the page clamps so a value the box
 * produced can always be sent.
 */
export const SHOP_COUNT_WIRE_MAX = 65535;

/** What a `sub_535C90`-style count box is opened with (`initial`, `min`, `max`). */
export interface ShopCountBounds {
  initial: number;
  min: number;
  max: number;
}

/**
 * `sub_4B6B40` -> `sub_4B7960(prompt, 1, row[8])`: buying starts at 1 with the row's maximum.
 */
export function shopBuyBounds(maxCount: number): ShopCountBounds {
  return { initial: 1, min: 1, max: Math.min(SHOP_COUNT_WIRE_MAX, maxCount) };
}

/**
 * `sub_4B6E90` -> `sub_535C90(total, 1, total)`: selling offers the whole stack, and starts there.
 *
 * The `Math.max(1, ...)` is the one place the page does not follow the native through: a stack that
 * reads zero would give the box `(0, 1, 0)`, which can never be answered. Nothing reaches it in
 * practice - an empty 207 is the rechargeable confirm's business, not the count dialog's - and a
 * box that cannot be answered is worse than one that offers a single item.
 */
export function shopSellBounds(quantity: number): ShopCountBounds {
  const total = Math.min(SHOP_COUNT_WIRE_MAX, Math.max(1, quantity));
  return { initial: total, min: 1, max: total };
}

/**
 * `sub_4B7130` -> `sub_4B4AD0`: the refill fee for a 207 stack.
 *
 * The rate is the WZ `unitPrice` read as a **double** (`sub_47A1D0` does the same), and the fee is
 * `ceil((capacity - roundsOnHand) * rate)` - capacity first, which is why `sub_4B3780` copies the
 * row's own `maxCount` rather than a global. A stack that is already full has nothing to buy, so
 * there is no quote at all.
 */
export function rechargeableRefillCost(
  maxCount: number,
  unitPrice: number,
  quantity: number,
): number | undefined {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity >= maxCount) return undefined;
  const total = Math.ceil((maxCount - quantity) * unitPrice);
  return Number.isSafeInteger(total) && total > 0 ? total : undefined;
}
