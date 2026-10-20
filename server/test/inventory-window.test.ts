/** Native inventory sheet geometry (sub_43D750 / sub_43E340 / 4DA440 / 4DA810), now unit-tested
 * after it left client/main.js. Every number here is the client's own layout, not a convenience.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY,
  INVENTORY_TABS,
  clampInventoryScroll,
  drawInventoryLabel,
  drawInventoryScrollbar,
  inventoryScrollbarGeometry,
  inventorySlotAt,
  inventoryWindowAt,
  type InventoryTabView,
} from "../../client/inventory-window.ts";
import type { CanvasImage } from "../../client/render-types.ts";

test("the sheet keeps the native layout: 162x315 at (24,24), 4x6 grid of 32px cells on a 35px pitch", () => {
  assert.equal(INVENTORY.width, 162);
  assert.equal(INVENTORY.height, 315);
  assert.deepEqual(INVENTORY.home, { x: 24, y: 24 });
  assert.equal(INVENTORY.grid.columns, 4);
  assert.equal(INVENTORY.grid.rows, 6);
  assert.equal(INVENTORY.grid.size, 32);
  assert.equal(INVENTORY.grid.pitch, 35);
  assert.deepEqual(INVENTORY.scrollbar, { x: 147, y: 80, width: 12, height: 208 });
  assert.deepEqual(INVENTORY.coin, { x: 8, y: 294, width: 17, height: 17 });
  assert.deepEqual(INVENTORY.close, { x: 114, y: 9, width: 32, height: 15 });
  assert.deepEqual(
    INVENTORY_TABS.map((tab) => tab.tab),
    [1, 2, 3, 4],
  );
  // The separators the sheet draws at x=35/69/104/139 give the fourth tab two extra pixels.
  assert.deepEqual(
    INVENTORY.tabs.map((box) => [box.x, box.width]),
    [
      [2, 34],
      [36, 34],
      [70, 34],
      [104, 36],
    ],
  );
});

test("the scrollbar only travels past the 24 slots a full sheet shows (six rows of four)", () => {
  const full = inventoryScrollbarGeometry(24, 0);
  assert.equal(full.max, 0);
  assert.equal(full.offset, 0, "an unscrollable tab has no thumb offset");
  assert.equal(full.travel, 208 - 36);
  const long = inventoryScrollbarGeometry(100, 0);
  assert.equal(long.max, Math.ceil(100 / 4) - 6);
  assert.equal(inventoryScrollbarGeometry(100, 999).row, long.max, "rows clamp to the last one");
  assert.equal(inventoryScrollbarGeometry(100, -5).row, 0);
  assert.equal(inventoryScrollbarGeometry(100, long.max).offset, long.travel);
  assert.equal(inventoryScrollbarGeometry(100, long.max / 2).offset, Math.round(long.travel / 2));
});

test("setInventoryScroll rounds like the native sender and stays inside the tab", () => {
  assert.equal(clampInventoryScroll(100, 3.4), 3);
  assert.equal(clampInventoryScroll(100, 3.6), 4);
  assert.equal(clampInventoryScroll(24, 4), 0, "a 24-slot tab cannot scroll");
  assert.equal(clampInventoryScroll(100, 1e6), inventoryScrollbarGeometry(100, 0).max);
});

test("a slot is its 32px face: the 3px gap between cells is not a slot", () => {
  const { grid } = INVENTORY;
  assert.equal(inventorySlotAt(grid.x, grid.y, 0), 1, "the first cell is slot 1");
  assert.equal(inventorySlotAt(grid.x + 31, grid.y + 31, 0), 1);
  assert.equal(inventorySlotAt(grid.x + 32, grid.y, 0), 0, "the gap after a 32px face");
  assert.equal(inventorySlotAt(grid.x, grid.y + 32, 0), 0);
  assert.equal(inventorySlotAt(grid.x + grid.pitch, grid.y, 0), 2, "one column right");
  assert.equal(inventorySlotAt(grid.x, grid.y + grid.pitch, 0), 5, "one row down");
  assert.equal(inventorySlotAt(grid.x + 3 * grid.pitch, grid.y + 5 * grid.pitch, 0), 24);
  assert.equal(inventorySlotAt(grid.x, grid.y, 6), 25, "firstSlot = 4*row + 1");
  assert.equal(inventorySlotAt(grid.x - 1, grid.y, 0), 0);
  assert.equal(inventorySlotAt(grid.x, grid.y - 1, 0), 0);
  assert.equal(inventorySlotAt(grid.x + 4 * grid.pitch, grid.y, 0), 0, "off the right edge");
  assert.equal(inventorySlotAt(grid.x, grid.y + 6 * grid.pitch, 0), 0, "off the bottom edge");
});

const tab = (capacity: number, slots: number[]): InventoryTabView => ({
  tab: 2,
  capacity,
  items: slots.map((slot) => ({ slot })),
});
const at = (
  x: number,
  y: number,
  tabView: InventoryTabView | undefined,
  position = INVENTORY.home,
) =>
  inventoryWindowAt({
    position,
    x,
    y,
    tabView,
    scroll: inventoryScrollbarGeometry(tabView?.capacity ?? 0, 0),
  });

test("the window reports what a surface point is over, in the sheet's own order", () => {
  const { home, close, coin, scrollbar } = INVENTORY;
  assert.equal(at(home.x - 1, home.y + 40, tab(24, [])), undefined, "left of the sheet");
  assert.equal(at(home.x + 40, home.y - 1, tab(24, [])), undefined, "above the sheet");
  assert.equal(at(home.x + INVENTORY.width, home.y + 40, tab(24, [])), undefined);
  assert.deepEqual(at(home.x + coin.x + 4, home.y + coin.y + 4, tab(24, [])), { kind: "coin" });
  assert.deepEqual(at(home.x + close.x + 16, home.y + close.y + 7, tab(24, [])), {
    kind: "close",
  });
  for (const [index, box] of INVENTORY.tabs.entries()) {
    assert.deepEqual(
      at(home.x + box.x + 2, home.y + box.y + 10, tab(24, [])),
      { kind: "tab", index, tab: INVENTORY_TABS[index]?.tab },
      `tab ${index}`,
    );
  }
  // The bar is a 12px-wide strip; its first and last 12px are the two arrow caps.
  assert.deepEqual(at(home.x + scrollbar.x + 6, home.y + scrollbar.y + 4, tab(24, [])), {
    kind: "scrollbar",
    part: "prev",
  });
  assert.deepEqual(at(home.x + scrollbar.x + 6, home.y + scrollbar.y + 204, tab(24, [])), {
    kind: "scrollbar",
    part: "next",
  });
  assert.deepEqual(at(home.x + scrollbar.x + 6, home.y + scrollbar.y + 100, tab(24, [])), {
    kind: "scrollbar",
    part: "track",
  });
  assert.deepEqual(at(home.x + INVENTORY.grid.x, home.y + INVENTORY.grid.y, tab(24, [1])), {
    kind: "slot",
    slot: 1,
    item: { slot: 1 },
  });
  assert.deepEqual(at(home.x + INVENTORY.grid.x, home.y + INVENTORY.grid.y, tab(24, [2])), {
    kind: "slot",
    slot: 1,
  });
  assert.deepEqual(at(home.x + 60, home.y + 40, tab(24, [])), { kind: "body" });
  // A slot past the tab's capacity is empty sheet, not a slot.
  assert.deepEqual(at(home.x + INVENTORY.grid.x, home.y + INVENTORY.grid.y, tab(0, [])), {
    kind: "body",
  });
});

test("a scrolled tab puts the thumb under the pointer and offsets the rows it reports", () => {
  const view = tab(100, []);
  const scroll = inventoryScrollbarGeometry(100, 10);
  const bar = INVENTORY.scrollbar;
  assert.deepEqual(
    inventoryWindowAt({
      position: INVENTORY.home,
      x: INVENTORY.home.x + bar.x + 6,
      y: INVENTORY.home.y + bar.y + 12 + scroll.offset + 4,
      tabView: view,
      scroll,
    }),
    { kind: "scrollbar", part: "thumb" },
  );
  assert.deepEqual(
    inventoryWindowAt({
      position: INVENTORY.home,
      x: INVENTORY.home.x + INVENTORY.grid.x,
      y: INVENTORY.home.y + INVENTORY.grid.y,
      tabView: view,
      scroll,
    }),
    { kind: "slot", slot: 41 },
    "row 10 starts at slot 4*10+1",
  );
});

test("the window follows its CConfig position, not the sheet's default spot", () => {
  const moved = { x: 300, y: 120 };
  assert.deepEqual(at(moved.x + 60, moved.y + 40, tab(24, []), moved), { kind: "body" });
  assert.equal(at(moved.x - 1, moved.y + 200, tab(24, []), moved), undefined);
});

/** Records the canvas calls the painter makes; no browser canvas is involved. */
function fakeContext() {
  const calls: string[] = [];
  const drawn: { image: unknown; x: number; y: number }[] = [];
  const ctx = {
    save() {
      calls.push("save");
    },
    restore() {
      calls.push("restore");
    },
    beginPath() {
      calls.push("beginPath");
    },
    rect(x: number, y: number, width: number, height: number) {
      calls.push(`rect:${x},${y},${width},${height}`);
    },
    clip() {
      calls.push("clip");
    },
    drawImage(image: unknown, x: number, y: number) {
      drawn.push({ image, x, y });
    },
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    fillText(text: string, x: number, y: number) {
      calls.push(`fillText:${text},${x},${y}`);
    },
  };
  const asked: string[] = [];
  const image = (path: string): CanvasImage => {
    asked.push(path);
    return { ready: true, img: path as unknown as CanvasImageSource };
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, drawn, asked, image };
}

test("the scrollbar is clipped to its bar, tiles its base and only shows a thumb on a long tab", () => {
  const { ctx, calls, drawn, asked, image } = fakeContext();
  drawInventoryScrollbar(ctx, image, 24, 24, inventoryScrollbarGeometry(24, 0), false);
  assert.deepEqual([calls[0], calls.at(-1)], ["save", "restore"]);
  assert.ok(calls.includes("rect:171,104,12,208"), `clip rectangle: ${calls.join(" ")}`);
  assert.ok(calls.includes("clip"));
  assert.deepEqual(
    drawn.map((entry) => entry.image),
    [
      ...Array.from(
        { length: Math.ceil((208 - 12) / 12) - 1 },
        () => "UI/Basic.img/VScr/disabled/base",
      ),
      "UI/Basic.img/VScr/disabled/prev",
      "UI/Basic.img/VScr/disabled/next",
    ],
  );
  assert.equal(
    asked.some((path) => path.includes("enabled")),
    false,
    "24 slots never scroll",
  );
  assert.equal(
    drawn.some((entry) => String(entry.image).includes("thumb")),
    false,
  );

  const long = fakeContext();
  drawInventoryScrollbar(long.ctx, long.image, 24, 24, inventoryScrollbarGeometry(100, 0), false);
  assert.equal(
    long.asked.some((path) => path.includes("enabled")),
    true,
  );
  assert.equal(
    long.drawn.filter((entry) => String(entry.image).endsWith("thumb0")).length,
    1,
    "the idle thumb",
  );
  const dragging = fakeContext();
  drawInventoryScrollbar(
    dragging.ctx,
    dragging.image,
    24,
    24,
    inventoryScrollbarGeometry(100, 3),
    true,
  );
  assert.equal(
    dragging.drawn.filter((entry) => String(entry.image).endsWith("thumb1")).length,
    1,
    "the pressed thumb while dragging",
  );
  // The thumb rides the bar: 12px past the top cap, plus the geometry's own offset.
  const thumb = dragging.drawn.find((entry) => String(entry.image).endsWith("thumb1"));
  assert.equal(
    thumb?.y,
    24 + INVENTORY.scrollbar.y + 12 + inventoryScrollbarGeometry(100, 3).offset,
  );
});

test("a tab label uses the sheet's own colours: black when lit, slate when idle", () => {
  const lit = fakeContext();
  drawInventoryLabel(lit.ctx, "소비", 100, 64, true);
  assert.equal(lit.ctx.fillStyle, "#000000");
  assert.ok(lit.calls.includes("fillText:소비,100,64"));
  const idle = fakeContext();
  drawInventoryLabel(idle.ctx, "장비", 30, 64, false);
  assert.equal(idle.ctx.fillStyle, "#44586e");
  assert.equal(idle.ctx.textAlign, "center");
  assert.equal(idle.ctx.textBaseline, "middle");
});
