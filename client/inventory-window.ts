/**
 * Native inventory sheet layout, hit-testing and scroll math.
 *
 * Extracted from client/main.js: the geometry is pure, so it can be unit-tested instead of only
 * being reachable through the page. main.js keeps the mutable state and calls these helpers.
 *
 * Native anchors, all re-read against this checkout's own evidence in ADR-110:
 *  - `sub_43D750` loads the window positions out of the registry: for i in 0..5 it reads
 *    `uiWndX%d` / `uiWndY%d` / `uiOpt%d`, with defaults `8 * (3 * i + 3)` for windows 0..3
 *    (window 0 = the inventory, so 24, 24), 8/8 for window 4, 500/50 for window 5, and it clamps
 *    an X above 784. `uiOpt0` defaults to 0, so the sheet starts hidden.
 *  - `sub_4DA440` (the inventory window) creates its controls by id:
 *    `CCtrlScrollBar id2001 at (147, 80) height 208`, then `*(*(this + 218) + 44) = 142`, and
 *    `CCtrlButton id2002 at (8, 294)` - the meso button exactly as `sub_4D4960` paints it.
 *  - `sub_4DA810`, the scroll notification handler, is where the per-tab row lives:
 *    `if (n2001 == 2001 && n500 >= 0x12C && n500 <= 0x130 && dword_5C2684[*(this + 222)] != a4)
 *       { sub_500EE0(this + 22); dword_5C2684[*(this + 222)] = a4; *(this + 221) = 4 * a4 + 1; }`
 *    - one row per tab, stored in an array, and the first slot is `4 * row + 1`.
 *  - `sub_4581F0` (the CCtrlTab creator) rejects `n4 >= 4`: the strip is four tabs.
 *  - `UI/UIWindow.img` `BtCoin/normal/0` is a 17x17 canvas, which is the button's drawn size.
 */
import type { CanvasImage, ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";

export interface InventoryBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slot grid: 32 px cells at a 35 px pitch, four across and six down (24 slots). */
export interface InventoryGrid {
  x: number;
  y: number;
  columns: number;
  rows: number;
  size: number;
  pitch: number;
}

export interface InventoryLayout {
  path: string;
  width: number;
  height: number;
  /** `sub_43D750`: `uiWndX0`/`uiWndY0` default to `8 * (3 * 0 + 3)` = 24, `uiOpt0` defaults to 0. */
  home: UiPoint;
  grid: InventoryGrid;
  /** `sub_4DA440`: `CCtrlScrollBar id2001` created at (147, 80) with height 208. */
  scrollbar: InventoryBox;
  /** `sub_4DA440`: `CCtrlButton id2002` at (8, 294); `BtCoin/normal/0` is a 17x17 canvas. */
  coin: InventoryBox;
  /** The meso field, ending where the sheet's own `메소` label starts. */
  mesos: InventoryBox;
  /** Tab boxes, measured from the separators the sheet draws at x=35/69/104/139. */
  tabs: InventoryBox[];
  /** The CLOSE button's pentagon, top right of the sheet. */
  close: InventoryBox;
  /** The lit and idle tab faces, both taken out of the sheet's own strip. */
  litTab: InventoryBox;
  idleTab: InventoryBox;
}

export const INVENTORY: InventoryLayout = {
  path: "UI/UIWindow.img/Item/backgrnd",
  width: 162,
  height: 315,
  home: { x: 24, y: 24 },
  grid: { x: 6, y: 80, columns: 4, rows: 6, size: 32, pitch: 35 },
  scrollbar: { x: 147, y: 80, width: 12, height: 208 },
  coin: { x: 8, y: 294, width: 17, height: 17 },
  mesos: { x: 9, y: 296, width: 116, height: 13 },
  tabs: [
    { x: 2, y: 52, width: 34, height: 24 },
    { x: 36, y: 52, width: 34, height: 24 },
    { x: 70, y: 52, width: 34, height: 24 },
    { x: 104, y: 52, width: 36, height: 24 },
  ],
  close: { x: 114, y: 9, width: 32, height: 15 },
  litTab: { x: 2, y: 52, width: 34, height: 24 },
  idleTab: { x: 36, y: 52, width: 34, height: 24 },
};

/** The four tab labels, in the client's own order (장비 / 소비 / 설치 / 기타). */
export const INVENTORY_TABS: { tab: number; label: string }[] = [
  { tab: 1, label: "장비" },
  { tab: 2, label: "소비" },
  { tab: 3, label: "설치" },
  { tab: 4, label: "기타" },
];

/** The tab the window shows (a `0x0B` inventory number) and the rows it can scroll. */
export interface InventoryTabView {
  tab: number;
  capacity: number;
  items: readonly { slot: number }[];
}

export interface InventoryScrollGeometry {
  /** How far the first row can move: 24 slots show six rows of four at a time. */
  max: number;
  row: number;
  /** Thumb travel: the bar minus both 12 px end caps and the thumb itself. */
  travel: number;
  offset: number;
}

/** 4DA810/4DA8B0: independent per-tab row positions; firstSlot = 4*row+1. */
export function inventoryScrollbarGeometry(capacity: number, row: number): InventoryScrollGeometry {
  const max = Math.max(0, Math.ceil(capacity / 4) - 6);
  const travel = INVENTORY.scrollbar.height - 36;
  // A non-finite row (never stored: the sender rounds) behaves like the old `?? 0` fallback.
  const safe = Number.isFinite(row) ? row : 0;
  const clamped = Math.max(0, Math.min(max, safe));
  return {
    max,
    row: clamped,
    travel,
    offset: max ? Math.round((travel * clamped) / max) : 0,
  };
}

/** Clamp a requested row to the tab's reachable range, rounding the way the native sender does. */
export function clampInventoryScroll(capacity: number, row: number): number {
  const { max } = inventoryScrollbarGeometry(capacity, 0);
  return Math.max(0, Math.min(max, Math.round(row)));
}

/**
 * Where a slot's cell sits inside the sheet, or `undefined` when the slot is not on the page the
 * window is showing. The exact inverse of `inventorySlotAt`: `4DA810` keeps one row per tab and
 * makes the page's first slot `4 * row + 1`, so a slot scrolled off the six visible rows has no
 * cell at all.
 */
export function inventoryCellOrigin(slot: number, firstRow: number): UiPoint | undefined {
  const { grid } = INVENTORY;
  const index = slot - 1 - grid.columns * firstRow;
  if (index < 0) return undefined;
  const column = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  if (row >= grid.rows) return undefined;
  return { x: grid.x + column * grid.pitch, y: grid.y + row * grid.pitch };
}

/** The number the sheet prints in a cell's bottom-right corner, or `undefined` for none.
 *
 * A stack shows its quantity once it holds more than one - except the `207xxxx` throwing-star and
 * bullet family, the rechargeable one: `sub_463BE0`/`sub_464000` drop it whole with no count dialog
 * (`*(_DWORD *)(v6 + 12) / 10000 == 207`), and its "quantity" is the round count, which the page has
 * always printed even at one. A stack with no printed quantity falls back to the rechargeable
 * `ruc` (remaining uses) when that is positive.
 */
export function inventoryStackCount(item: {
  itemId: number;
  quantity?: number;
  ruc?: number;
}): number | undefined {
  if (item.quantity !== undefined && (item.quantity > 1 || Math.floor(item.itemId / 10000) === 207))
    return item.quantity;
  if (item.ruc !== undefined && item.ruc > 0) return item.ruc;
  return undefined;
}

/** The stack count, bottom-right inside the cell, with the outline the browser font needs. */
export function drawInventoryStackCount(
  ctx: CanvasRenderingContext2D,
  value: number,
  right: number,
  bottom: number,
): void {
  ctx.save();
  ctx.font = "10px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.strokeText(String(value), right, bottom);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(value), right, bottom);
  ctx.restore();
}

/** `UI/UIWindow.img/Item/BtCoin/<state>/0` (`sub_4D4960`). */
export type InventoryCoinState = "disabled" | "pressed" | "mouseOver" | "normal";

/**
 * The meso button's face. A dead character, a purse under the 10-meso minimum the dialog asks for,
 * or any request already in flight greys it out; a press only shows while the pointer is still on
 * the button, the way `CCtrlButton` keeps its own pressed face.
 */
export function inventoryCoinState(view: {
  dead: boolean;
  mesos: number;
  busy: boolean;
  pressed: boolean;
  hover: boolean;
}): InventoryCoinState {
  if (view.dead || view.mesos < 10 || view.busy) return "disabled";
  if (view.pressed && view.hover) return "pressed";
  return view.hover ? "mouseOver" : "normal";
}

/** `sub_4581F0`'s tab strip: the index of a `0x0B` inventory number, or 0 when it is unknown. */
export function inventoryTabIndex(tab: number): number {
  const found = INVENTORY_TABS.findIndex((entry) => entry.tab === tab);
  return found < 0 ? 0 : found;
}

export interface InventoryTabFace {
  index: number;
  lit: boolean;
  /** The tab's box on the sheet. */
  box: InventoryBox;
  /** The face to stamp: the lit one for the open tab, an idle one for the rest. */
  face: InventoryBox;
  /**
   * Whether the sheet's own pixels under this tab have to be covered first. The sheet is painted
   * with its first tab lit, so cell 0 needs an idle face whenever the open tab is not 0.
   */
  stamped: boolean;
}

/** The four faces of the strip for the open tab, in sheet order. */
export function inventoryTabFaces(tab: number): InventoryTabFace[] {
  const litIndex = inventoryTabIndex(tab);
  return INVENTORY.tabs.map((box, index) => {
    const lit = index === litIndex;
    return {
      index,
      lit,
      box,
      face: lit ? INVENTORY.litTab : INVENTORY.idleTab,
      stamped: lit || index === 0,
    };
  });
}

/** The slot number under a grid point, or 0 when the point is not on a cell. */
export function inventorySlotAt(localX: number, localY: number, firstRow: number): number {
  const { grid } = INVENTORY;
  const column = Math.floor((localX - grid.x) / grid.pitch);
  const row = Math.floor((localY - grid.y) / grid.pitch);
  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) return 0;
  // Inside the 32-px face, not the 3-px gap between cells.
  if (localX - grid.x - column * grid.pitch >= grid.size) return 0;
  if (localY - grid.y - row * grid.pitch >= grid.size) return 0;
  return (row + firstRow) * grid.columns + column + 1;
}

export type InventoryHit =
  | { kind: "coin" }
  | { kind: "close" }
  | { kind: "tab"; index: number; tab: number }
  | { kind: "scrollbar"; part: "prev" | "next" | "thumb" | "track" }
  | { kind: "slot"; slot: number; item?: { slot: number } }
  | { kind: "body" };

export interface InventoryWindowQuery {
  /** The sheet's current CConfig position, not the CLOSE control coordinate. */
  position: UiPoint;
  x: number;
  y: number;
  tabView: InventoryTabView | undefined;
  scroll: InventoryScrollGeometry;
}

function inside(box: InventoryBox, localX: number, localY: number): boolean {
  return (
    localX >= box.x && localX < box.x + box.width && localY >= box.y && localY < box.y + box.height
  );
}

/**
 * What of the window is at a surface point; a point outside the sheet is `undefined`.
 * Callers decide whether the sheet is open at all, so this stays a pure geometry query.
 */
export function inventoryWindowAt(query: InventoryWindowQuery): InventoryHit | undefined {
  const localX = query.x - query.position.x;
  const localY = query.y - query.position.y;
  if (localX < 0 || localY < 0 || localX >= INVENTORY.width || localY >= INVENTORY.height)
    return undefined;
  if (inside(INVENTORY.coin, localX, localY)) return { kind: "coin" };
  if (inside(INVENTORY.close, localX, localY)) return { kind: "close" };
  const tab = INVENTORY.tabs.findIndex((box) => inside(box, localX, localY));
  if (tab >= 0) return { kind: "tab", index: tab, tab: INVENTORY_TABS[tab]?.tab ?? tab + 1 };
  const bar = INVENTORY.scrollbar;
  if (inside(bar, localX, localY)) {
    const offset = localY - bar.y;
    const onThumb =
      query.scroll.max > 0 &&
      offset >= 12 + query.scroll.offset &&
      offset < 24 + query.scroll.offset;
    return {
      kind: "scrollbar",
      part: offset < 12 ? "prev" : offset >= bar.height - 12 ? "next" : onThumb ? "thumb" : "track",
    };
  }
  const slot = inventorySlotAt(localX, localY, query.scroll.row);
  if (slot > 0 && slot <= (query.tabView?.capacity ?? 0)) {
    const item = query.tabView?.items.find((entry) => entry.slot === slot);
    return item ? { kind: "slot", slot, item } : { kind: "slot", slot };
  }
  return { kind: "body" };
}

/** The CCtrlScrollBar strip, clipped to the bar's own rectangle. */
export function drawInventoryScrollbar(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  x: number,
  y: number,
  geometry: InventoryScrollGeometry,
  dragging: boolean,
): void {
  const bar = INVENTORY.scrollbar;
  const stamp = (piece: string, offset: number): void => {
    const art: CanvasImage = image(
      `UI/Basic.img/VScr/${geometry.max ? "enabled" : "disabled"}/${piece}`,
    );
    if (art.ready) ctx.drawImage(art.img, x + bar.x, y + bar.y + offset);
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + bar.x, y + bar.y, 12, bar.height);
  ctx.clip();
  for (let py = 12; py < bar.height - 12; py += 12) stamp("base", py);
  stamp(geometry.max ? "prev0" : "prev", 0);
  stamp(geometry.max ? "next0" : "next", bar.height - 12);
  if (geometry.max) stamp(dragging ? "thumb1" : "thumb0", 12 + geometry.offset);
  ctx.restore();
}

/** One tab label, in the sheet's own colours: black on the lit tab, slate on the idle ones. */
export function drawInventoryLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  centerX: number,
  baselineY: number,
  lit: boolean,
): void {
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = lit ? "#000000" : "#44586e";
  ctx.fillText(label, centerX, baselineY);
}
