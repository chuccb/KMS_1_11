/**
 * The two `UI/Basic.img` strips the client's own chrome is measured against.
 *
 * Neither number in this file came from the EXE. `VScr` and the tab pieces have no ASCII in the PE
 * at all - `CCtrlScrollBar` and `CCtrlTab` reach their cells through `sub_4591A0`'s property
 * lookups - so the archive is the only oracle, and the tests below read `Data.wz` rather than trust
 * the constant. That is the whole point of naming them: `12` and `14` were written out longhand in
 * seven and three places respectively, with the thumb's travel appearing as the unexplained
 * `height - 36`, and nothing in the tree said where any of it came from.
 *
 * The invariants are the reason the constants exist:
 *
 *  - a VScr bar is exactly three cells of chrome plus the thumb's travel - `prev` cap, `next` cap,
 *    thumb, and the gap the thumb slides through - so `3 * VSCR_CELL + vScrollTravel(h) === h`;
 *  - a `CCtrlTab` strip is one `left` cap, one `fill` column per pixel of the run, a `middle`
 *    crease at each tab's right edge, and one `right` cap, so the four pieces tile the strip's
 *    declared width exactly.
 *
 * Native cross-checks already recorded in FINDINGS (§4.19, ADR-094) agree with both: the trade
 * log's bar reports `+68 arrowLen=12` / `+72 trackLen=216`, and `sub_452500` splits it at
 * `v <= 12 -> 101`, `v >= 204 -> 102` with `thumbTop = 12 + floor(pos * 180 / (max - 1))` - i.e.
 * `len - 3 * arrow` and `len - arrow`, with `arrow = 12`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { cellsOf, needsArchive } from "./helpers/wz-cells.ts";
import { VSCR_CELL, vScrollTravel } from "../../client/vscroll.ts";
import {
  INVENTORY,
  inventoryScrollbarGeometry,
  inventoryWindowAt,
  type InventoryTabView,
} from "../../client/inventory-window.ts";
import {
  SHOP,
  TAB_FILL,
  TAB_HEIGHT,
  TAB_LEFT,
  TAB_MIDDLE,
  TAB_RIGHT,
  drawShopTabs,
  shopWindowAt,
  type ShopRow,
} from "../../client/shop-window.ts";
import { TRADE_WINDOW } from "../../client/trade-state.ts";
import { MESSENGER_WINDOW } from "../../client/messenger-state.ts";

const VSCR = cellsOf("UI/Basic.img", "VScr");
const TAB = cellsOf("UI/Basic.img", "Tab");

// ---------------------------------------------------------------------------
// UI/Basic.img/VScr - one 12x12 cell behind every scrollbar in the client
// ---------------------------------------------------------------------------

test(
  "every UI/Basic.img/VScr cell is VSCR_CELL square, and both states are complete",
  needsArchive,
  () => {
    assert.deepEqual(
      [...VSCR.keys()].sort(),
      [
        "disabled/base",
        "disabled/next",
        "disabled/prev",
        "enabled/base",
        "enabled/next0",
        "enabled/next1",
        "enabled/prev0",
        "enabled/prev1",
        "enabled/thumb0",
        "enabled/thumb1",
      ],
      "the ten cells, in the archive's own order",
    );
    for (const [path, size] of VSCR) {
      assert.equal(size, `${VSCR_CELL}x${VSCR_CELL}`, `VScr/${path}`);
    }
    // The disabled state has no thumb of its own, which is why a bar that cannot scroll paints
    // `prev`/`next`/`base` and nothing else - see inventory-window's `geometry.max ? ... : ...`.
    assert.deepEqual(
      [...VSCR.keys()].filter((path) => path.includes("thumb")),
      ["enabled/thumb0", "enabled/thumb1"],
    );
  },
);

test("the travel is the track less three cells: both caps and the thumb", () => {
  assert.equal(VSCR_CELL, 12);
  assert.equal(vScrollTravel(208), 208 - 3 * VSCR_CELL);
  assert.equal(vScrollTravel(208, VSCR_CELL), vScrollTravel(208), "the default arrow is the cell");
  const bars: [string, number][] = [
    ["inventory", INVENTORY.scrollbar.height],
    ["shop buy", SHOP.scrollbar.buy.height],
    ["shop sell", SHOP.scrollbar.sell.height],
    ["trade log", TRADE_WINDOW.scrollbar.height],
    ["messenger log", MESSENGER_WINDOW.scrollbar.height],
  ];
  for (const [name, height] of bars) {
    // prev cap + travel + thumb + next cap = the whole track, with nothing left over.
    assert.equal(VSCR_CELL + vScrollTravel(height) + VSCR_CELL + VSCR_CELL, height, name);
  }
});

test("every bar is drawn one cell wide, and every CCtrlScrollBar one cell deep", () => {
  assert.equal(INVENTORY.scrollbar.width, VSCR_CELL);
  assert.equal(SHOP.scrollbar.buy.width, VSCR_CELL);
  assert.equal(SHOP.scrollbar.sell.width, VSCR_CELL);
  for (const [name, bar] of [
    ["trade log", TRADE_WINDOW.scrollbar],
    ["messenger log", MESSENGER_WINDOW.scrollbar],
  ] as const) {
    assert.equal(bar.width, VSCR_CELL, name);
    assert.equal(bar.arrow, VSCR_CELL, name);
  }
});

test("the inventory bar splits into prev / thumb / track / next at whole cells", () => {
  const { home, scrollbar } = INVENTORY;
  const tabView: InventoryTabView = { tab: 2, capacity: 100, items: [] };
  const at = (offset: number) =>
    inventoryWindowAt({
      position: home,
      x: home.x + scrollbar.x + 6,
      y: home.y + scrollbar.y + offset,
      tabView,
      scroll: inventoryScrollbarGeometry(tabView.capacity, 0),
    });
  // A full tab: max = ceil(100/4) - 6 = 19, so the thumb exists and sits at offset 0.
  assert.equal(inventoryScrollbarGeometry(100, 0).max, 19);
  assert.deepEqual(at(0), { kind: "scrollbar", part: "prev" });
  assert.deepEqual(at(VSCR_CELL - 1), { kind: "scrollbar", part: "prev" });
  assert.deepEqual(at(VSCR_CELL), { kind: "scrollbar", part: "thumb" }, "the thumb's top edge");
  assert.deepEqual(at(2 * VSCR_CELL - 1), { kind: "scrollbar", part: "thumb" });
  assert.deepEqual(at(2 * VSCR_CELL), { kind: "scrollbar", part: "track" }, "just below the thumb");
  assert.deepEqual(at(scrollbar.height - VSCR_CELL - 1), { kind: "scrollbar", part: "track" });
  assert.deepEqual(at(scrollbar.height - VSCR_CELL), { kind: "scrollbar", part: "next" });
  assert.deepEqual(at(scrollbar.height - 1), { kind: "scrollbar", part: "next" });
});

test("the shop bar splits the same way, on both sides", () => {
  const { home } = SHOP;
  const rows = (count: number, from = 0): ShopRow[] =>
    Array.from({ length: count }, (_, index) => ({
      slot: index + 1,
      itemId: 2000000 + index + from,
    }));
  for (const side of ["buy", "sell"] as const) {
    const bar = SHOP.scrollbar[side];
    const at = (offset: number) =>
      shopWindowAt({
        position: home,
        x: home.x + bar.x + 6,
        y: home.y + bar.y + offset,
        rows: { buy: rows(12), sell: rows(8, 100) },
        scroll: { buy: 0, sell: 0 },
      });
    assert.deepEqual(at(0), { kind: "scrollbar", side, part: "prev" }, side);
    assert.deepEqual(at(VSCR_CELL - 1), { kind: "scrollbar", side, part: "prev" }, side);
    assert.deepEqual(at(VSCR_CELL), { kind: "scrollbar", side, part: "thumb" }, side);
    assert.deepEqual(at(2 * VSCR_CELL - 1), { kind: "scrollbar", side, part: "thumb" }, side);
    assert.deepEqual(at(2 * VSCR_CELL), { kind: "scrollbar", side, part: "track" }, side);
    assert.deepEqual(at(bar.height - VSCR_CELL), { kind: "scrollbar", side, part: "next" }, side);
    assert.equal(at(bar.height + 1)?.kind, "body", `${side}: below the bar is the sheet`);
  }
});

// ---------------------------------------------------------------------------
// UI/Basic.img/Tab - four piece widths, all 24 tall
// ---------------------------------------------------------------------------

test(
  "every UI/Basic.img/Tab cell is TAB_HEIGHT tall and one of the four named widths",
  needsArchive,
  () => {
    const expected: Record<string, { width: number; height: number }> = {
      left: { width: TAB_LEFT, height: TAB_HEIGHT },
      middle: { width: TAB_MIDDLE, height: TAB_HEIGHT },
      right: { width: TAB_RIGHT, height: TAB_HEIGHT },
      fill: { width: TAB_FILL, height: TAB_HEIGHT },
    };
    assert.deepEqual(
      [...TAB.keys()].sort(),
      ["fill0", "fill1", "left0", "left1", "middle0", "middle1", "middle2", "right0", "right1"],
      "the nine cells: `fill` and `left`/`right` are lit/not-lit, `middle` also has the crease",
    );
    for (const [path, size] of TAB) {
      const piece = path.replace(/\d+$/, "");
      const want = expected[piece];
      assert.ok(want, `unexpected Tab cell ${path}`);
      assert.equal(size, `${want.width}x${want.height}`, `Tab/${path}`);
    }
  },
);

test("both tab strips are one cell tall, and the four pieces tile the shop strip's width", () => {
  assert.equal(SHOP.tabs.height, TAB_HEIGHT);
  for (const [index, box] of INVENTORY.tabs.entries()) {
    assert.equal(box.height, TAB_HEIGHT, `inventory tab ${index}`);
  }
  // left cap + (one fill column per px, less a crease per interior tab edge) + right cap.
  const drawn: { image: unknown; x: number }[] = [];
  const ctx = {
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    drawImage(image: unknown, x: number) {
      drawn.push({ image, x });
    },
    fillText() {},
  } as unknown as CanvasRenderingContext2D;
  const image = (path: string) => ({ ready: true, img: path as unknown as CanvasImageSource });
  drawShopTabs(ctx, image, 0, 0, 1);
  const width = (piece: string) =>
    drawn.filter((entry) => String(entry.image).endsWith(`Tab/${piece}`)).length;
  assert.equal(width("left1"), 1);
  assert.equal(width("right0"), 1);
  const filled = drawn.filter((entry) => String(entry.image).includes("fill")).length;
  const creases = drawn.filter((entry) => String(entry.image).includes("middle")).length;
  assert.equal(
    TAB_LEFT + filled * TAB_FILL + creases * TAB_MIDDLE + TAB_RIGHT,
    SHOP.tabs.width,
    "the pieces cover the strip exactly, with no gap and no overlap",
  );
  assert.equal(filled * TAB_FILL + creases * TAB_MIDDLE, SHOP.tabs.width - TAB_LEFT - TAB_RIGHT);
});
