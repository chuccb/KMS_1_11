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
import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";
import { paintVScrollbar, vScrollTravel, VSCR_CELL, type VScrollZone } from "./vscroll.ts";
import { BT_UI_CLOSE } from "./uicontrols.ts";
import { drawItemNo, ITEM_NO_CELL_TOP } from "./itemno.ts";
import { SLOT_PITCH, SLOT_SIZE } from "./slot.ts";

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
  /**
   * `sub_4DA440`: `CCtrlScrollBar id2001` created at (147, 80) with height 208. `arrow` is the cap
   * cell's own size: the tiling pitch down the trough, and the distance `sub_452500` keeps the
   * thumb from each end.
   */
  scrollbar: InventoryBox & { readonly arrow: number };
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
  grid: { x: 6, y: 80, columns: 4, rows: 6, size: SLOT_SIZE, pitch: SLOT_PITCH },
  scrollbar: { x: 147, y: 80, width: VSCR_CELL, height: 208, arrow: VSCR_CELL },
  coin: { x: 8, y: 294, width: 17, height: 17 },
  mesos: { x: 9, y: 296, width: 116, height: 13 },
  tabs: [
    { x: 2, y: 52, width: 34, height: 24 },
    { x: 36, y: 52, width: 34, height: 24 },
    { x: 70, y: 52, width: 34, height: 24 },
    { x: 104, y: 52, width: 36, height: 24 },
  ],
  close: { x: 114, y: 9, width: BT_UI_CLOSE.width, height: BT_UI_CLOSE.height },
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
  /** `sub_452500`: `floor(row * travel / max)` - the native truncates, it does not round. */
  offset: number;
}

/** 4DA810/4DA8B0: independent per-tab row positions; firstSlot = 4*row+1. */
export function inventoryScrollbarGeometry(capacity: number, row: number): InventoryScrollGeometry {
  const max = Math.max(0, Math.ceil(capacity / 4) - 6);
  const travel = vScrollTravel(INVENTORY.scrollbar.height);
  // A non-finite row (never stored: the sender rounds) behaves like the old `?? 0` fallback.
  const safe = Number.isFinite(row) ? row : 0;
  const clamped = Math.max(0, Math.min(max, safe));
  return {
    max,
    row: clamped,
    travel,
    offset: max ? Math.floor((travel * clamped) / max) : 0,
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

/**
 * The rechargeable family: `207xxxx`, the throwing stars and bullets.
 *
 * `sub_463BE0` and `sub_464000` single it out by `itemId / 10000 == 207` - those are dropped whole,
 * with none of the "how many?" dialog a stack gets, because their "quantity" is a round count
 * rather than a stack. The rule is needed by the stack count below, by the shop's buy and sell
 * prompts, by the recharge quote and by the projectile layout, so it lives here once.
 */
export function isRechargeableItem(itemId: number): boolean {
  return Math.floor(itemId / 10000) === 207;
}

/** The number the sheet prints in a cell's bottom-right corner, or `undefined` for none.
 *
 * A stack shows its quantity once it holds more than one - except the rechargeable family
 * (`isRechargeableItem`), whose quantity is a round count and which the page has always printed
 * even at one. A stack with no printed quantity falls back to the rechargeable `ruc` (remaining
 * uses) when that is positive.
 */
export function inventoryStackCount(item: {
  itemId: number;
  quantity?: number;
  ruc?: number;
}): number | undefined {
  if (item.quantity !== undefined && (item.quantity > 1 || isRechargeableItem(item.itemId)))
    return item.quantity;
  if (item.ruc !== undefined && item.ruc > 0) return item.ruc;
  return undefined;
}

/**
 * The tab an item belongs to, in the numbers the wire carries.
 *
 * `sub_4B6B40` flips the inventory to the item it just bought (`this[31][11] != cat - 1` ->
 * `sub_459160(cat - 1)`), and `sub_459160` only accepts `0 <= index < *(this + 14)` - so the index
 * the native hands around is `CCtrlTab`'s own 0-based position. That is ONE LAYER BELOW the number
 * this page stores: `server/src/game/inventory.ts` rejects a tab outside 1..4 and indexes
 * `items.inventories[tab - 1]`, and `INVENTORY_TABS` numbers the four tabs 1..4. The page
 * therefore wants `cat`, not `cat - 1`.
 *
 * This build has no install tab (`Item/Install/*.img` does not exist in Data.wz), so category 3
 * shares "etc" with category 4; category 5 is cash. `server/src/game/rewards.ts` carries the same
 * rule for where a reward lands, and a test pins the two together.
 */
export function inventoryTabOfItem(itemId: number): number {
  const category = Math.floor(itemId / 1_000_000);
  if (category === 1) return 1; // 장비 equip
  if (category === 2) return 2; // 소비 consume
  if (category === 5) return 4; // 캐시 cash
  return 3; // 기타 etc (and 설치 install, for which this build has no tab)
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
  | { kind: "scrollbar"; part: VScrollZone }
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
    // `sub_452500`'s five zones - see the shop's hit test, which splits the track the same way.
    const offset = localY - bar.y;
    const thumbTop = VSCR_CELL + query.scroll.offset;
    return {
      kind: "scrollbar",
      part:
        offset < VSCR_CELL
          ? "prev"
          : offset >= bar.height - VSCR_CELL
            ? "next"
            : offset < thumbTop
              ? "pageUp"
              : offset < thumbTop + VSCR_CELL
                ? query.scroll.max > 0
                  ? "thumb"
                  : "pageDown"
                : "pageDown",
    };
  }
  const slot = inventorySlotAt(localX, localY, query.scroll.row);
  if (slot > 0 && slot <= (query.tabView?.capacity ?? 0)) {
    const item = query.tabView?.items.find((entry) => entry.slot === slot);
    return item ? { kind: "slot", slot, item } : { kind: "slot", slot };
  }
  return { kind: "body" };
}

/**
 * The `CCtrlScrollBar` strip, painted by the shared {@link paintVScrollbar}.
 *
 * `sub_4DA810`/`sub_4DA8B0` keep the row index per tab themselves - the inventory's four tabs
 * scroll independently, and `sub_4DA440` only ever creates the one control - so the painter is
 * handed the two numbers rather than a scroller. `dragging` is the sheet's own thumb capture;
 * there is no per-arrow held state, so the caps keep their `prev0`/`next0` face.
 */
export function drawInventoryScrollbar(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  x: number,
  y: number,
  geometry: InventoryScrollGeometry,
  dragging: boolean,
  pressed?: VScrollZone,
): void {
  paintVScrollbar(ctx, image, { x, y }, INVENTORY.scrollbar, {
    // `geometry.max` counts rows past the six that fit; the painter wants the native `SetMax`.
    max: geometry.max + 1,
    offset: geometry.offset,
    dragging,
    pressed,
  });
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

/**
 * The plate painted over a tab stamp, inside the tab's 34x24 box.
 *
 * The sheet is drawn with its own Korean labels already on the strip, so every face that gets
 * stamped also has to be covered before the page's label goes on. No native constant found for
 * these four numbers - they are the plate that hides the sheet's own text.
 */
export const INVENTORY_TAB_LABEL: Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  baseline: number;
}> = Object.freeze({ left: 6, top: 5, width: 22, height: 13, baseline: 12 });

/** The four faces: an idle face for the sheet's own lit tab, then each tab's label. */
export function drawInventoryTabStrip(
  ctx: CanvasRenderingContext2D,
  sheet: { img: CanvasImageSource; ready: boolean },
  labels: readonly string[],
  originX: number,
  originY: number,
  openTab: number,
): void {
  if (!sheet.ready) return;
  for (const face of inventoryTabFaces(openTab)) {
    if (face.stamped)
      ctx.drawImage(
        sheet.img,
        face.face.x,
        face.face.y,
        face.face.width,
        face.face.height,
        originX + face.box.x,
        originY + face.box.y,
        face.box.width,
        face.face.height,
      );
    // The stamp carries the sheet's own Korean label; cover it and draw the right one.
    ctx.fillStyle = face.lit ? "#ffffff" : "#ccddee";
    ctx.fillRect(
      originX + face.box.x + INVENTORY_TAB_LABEL.left,
      originY + face.box.y + INVENTORY_TAB_LABEL.top,
      INVENTORY_TAB_LABEL.width,
      INVENTORY_TAB_LABEL.height,
    );
    drawInventoryLabel(
      ctx,
      labels[face.index] ?? "",
      originX + face.box.x + face.box.width / 2,
      originY + face.box.y + INVENTORY_TAB_LABEL.baseline,
      face.lit,
    );
  }
}

/**
 * The stack count's anchor, relative to the cell's own top-left corner - the native hangs it off
 * the cell's LEFT edge, not off its bottom-right corner where we used to put a browser-font copy.
 * `sub_4DB240` (`:225635`) hands `sub_525AE0` `(rect.left, rect.bottom - 12)` at `:225848`, and the
 * rect is the one `sub_4DB990` (`:226041`) builds: `35c + 6, 35r + 80, 35c + 38, 35r + 112`.
 */
export const INVENTORY_COUNT_TOP = ITEM_NO_CELL_TOP;

/**
 * `UI/UIWindow.img/Item/activeIcon` is a 36x36 canvas (`bun tools/wz.ts dump "UI/UIWindow.img"`),
 * exactly two pixels larger than the 32 px slot on every side - so the hover frame hangs two
 * pixels outside the cell on each edge.
 */
export const INVENTORY_ACTIVE_ICON_INSET = 2;

/** One slot's painted content; the icon is loaded (or not) by the caller. */
export interface InventoryCellPaint {
  slot: number;
  icon?: { img: CanvasImageSource; ready: boolean; width: number; height: number };
  count?: number;
}

/** What {@link drawInventoryItems} needs: the cells to fill in and the slot under the cursor. */
export interface InventoryItemPaint {
  /** The first visible row; the slot it holds is `4 * row + 1` (`sub_4DA810`). */
  firstRow: number;
  cells: InventoryCellPaint[];
  /** The hovered slot, which wears the `activeIcon` frame. */
  hovered?: number;
}

/** The open tab's items, then the frame under the cursor - `sub_4DA810`'s own painting order. */
export function drawInventoryItems(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  originX: number,
  originY: number,
  paint: InventoryItemPaint,
): void {
  const { grid } = INVENTORY;
  for (const cell of paint.cells) {
    const at = inventoryCellOrigin(cell.slot, paint.firstRow);
    if (at === undefined) continue;
    const cellX = originX + at.x;
    const cellY = originY + at.y;
    const icon = cell.icon;
    if (icon?.ready)
      ctx.drawImage(
        icon.img,
        cellX + Math.floor((grid.size - icon.width) / 2),
        cellY + Math.floor((grid.size - icon.height) / 2),
      );
    if (cell.count !== undefined)
      drawItemNo(ctx, image, cell.count, cellX, cellY + INVENTORY_COUNT_TOP);
  }
  if (paint.hovered !== undefined) {
    const at = inventoryCellOrigin(paint.hovered, paint.firstRow);
    const frame = image("UI/UIWindow.img/Item/activeIcon");
    if (at !== undefined && frame.ready)
      ctx.drawImage(
        frame.img,
        originX + at.x - INVENTORY_ACTIVE_ICON_INSET,
        originY + at.y - INVENTORY_ACTIVE_ICON_INSET,
      );
  }
}

/** The most `0x17` can carry for one throw-away (`short`). */
export const INVENTORY_DROP_MAX = 32767;

/**
 * `sub_463BE0` warns before one of these leaves: `itemId / 1000 == 4031`
 * ("이 아이템을 버리시면 다시 회수할 수 없습니다").
 */
export function isIrreplaceableItem(itemId: number): boolean {
  return Math.floor(itemId / 1000) === 4031;
}

/**
 * What throwing an item away does, before any dialog or packet is involved (`sub_463BE0`).
 *
 * - A stack in a tab other than the equip one, that is not rechargeable and holds more than one,
 *   asks "몇 개나 버리시겠습니까?" with its own size as the maximum.
 * - Everything else goes out as it stands: the equip tab is always one, a rechargeable stack goes
 *   whole even at zero rounds left, and the count has to fit `0x17`'s signed short.
 */
export type InventoryDropPlan =
  { kind: "ask"; max: number } | { kind: "send"; count: number } | { kind: "refuse" };

export function inventoryDropPlan(
  tab: number,
  itemId: number,
  quantity: number,
): InventoryDropPlan {
  const count = tab === 1 ? 1 : quantity;
  if (tab !== 1 && !isRechargeableItem(itemId) && count > 1)
    return { kind: "ask", max: Math.min(INVENTORY_DROP_MAX, count) };
  if ((count >= 1 || (count === 0 && isRechargeableItem(itemId))) && count <= INVENTORY_DROP_MAX)
    return { kind: "send", count };
  return { kind: "refuse" };
}

/**
 * The meso box the coin button raises (`sub_4DAF70` -> `sub_535C90`).
 *
 * `sub_535C90` is built with `(10, 10, min(wallet, 50000))` - a floor of 10, that same 10 as the
 * starting figure, and a ceiling of 50,000 that never exceeds what the purse actually holds. The
 * button itself greys out below 10 for the same reason (see `inventoryCoinState`).
 */
export const MESO_DROP: Readonly<{ min: number; initial: number; ceiling: number }> = Object.freeze(
  { min: 10, initial: 10, ceiling: 50000 },
);

/** The range the box offers for a purse of `mesos`. */
export function mesoDropBounds(mesos: number): { min: number; initial: number; max: number } {
  return {
    min: MESO_DROP.min,
    initial: MESO_DROP.initial,
    max: Math.min(MESO_DROP.ceiling, mesos),
  };
}

/** Whether an amount the box came back with is one `0x1F` may carry. */
export function mesoDropAllowed(amount: unknown, mesos: number): boolean {
  const { min, max } = mesoDropBounds(mesos);
  return Number.isInteger(amount) && (amount as number) >= min && (amount as number) <= max;
}

/**
 * The three USE-tab families that heal (`sub_462DC0`: `n200 == 200 || 201 || 202`) and the fourth
 * that moves you - the 귀환 주문서 line, `203`.
 *
 * `Item/Consume/0203.img` is 마을 귀환 주문서 ("a scroll that returns you to the nearest town"), and
 * where it leads is the item's own `spec/moveTo`, so it is a **map change, not a heal**: that is why
 * `sub_462DC0` reaches for the other sender for it. A `204` scroll is not here at all - it falls
 * through both branches and a double click on one does nothing.
 */
export const CONSUME_FAMILY = {
  /** `Item/Consume/0200.img` … `0202.img`: potions and food. */
  heal: [200, 201, 202],
  /** `Item/Consume/0203.img`: the return-scroll line. */
  moveTo: 203,
} as const;

/**
 * Which CWvsApp sender a USE-tab item goes to, and the gate that sender keeps.
 *
 * Both senders are byte-for-byte the same except for the opcode and the clock:
 * `sub_55B2C0` writes `0x18` behind `timeGetTime() - *(this + 7) >= 0xC8` (200 ms), `sub_55B4B0`
 * writes `0x19` behind `>= 0x1F4` (500 ms), and each then appends `[s16 slot][u32 itemId]`.
 */
export type ConsumeUseRoute =
  { kind: "heal"; cooldownMs: 200 } | { kind: "map"; cooldownMs: 500 } | { kind: "none" };

/** `sub_462DC0`, the inventory double click: all four families, two of them acting. */
export function consumeUseRoute(itemId: number): ConsumeUseRoute {
  const family = Math.floor(itemId / 10000);
  if ((CONSUME_FAMILY.heal as readonly number[]).includes(family))
    return { kind: "heal", cooldownMs: 200 };
  if (family === CONSUME_FAMILY.moveTo) return { kind: "map", cooldownMs: 500 };
  return { kind: "none" };
}

/**
 * `sub_512570`, the quickslot key: the same 200 ms gate, but the family test is
 * `n200 == 200 || 201 || 202` with no `203` branch at all - a return scroll bound to a quickslot
 * simply does nothing.
 */
export function quickSlotUseRoute(itemId: number): ConsumeUseRoute {
  const route = consumeUseRoute(itemId);
  return route.kind === "heal" ? route : { kind: "none" };
}

/**
 * Whether `sub_526F30` has anything to play for this id.
 *
 * Both senders call it unconditionally, with `Sound/Item.img/%08d/Use` - but the archive only
 * carries the `0200`/`0201`/`0202` lines (`bun tools/wz.ts dump Sound/Item.img`), so a return
 * scroll is silent for the same reason a `204` scroll is: there is no node to play.
 */
export function hasConsumeUseSound(itemId: number): boolean {
  return consumeUseRoute(itemId).kind === "heal";
}
