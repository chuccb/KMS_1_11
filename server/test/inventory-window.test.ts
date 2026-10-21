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
  drawInventoryStackCount,
  inventoryCellOrigin,
  inventoryCoinState,
  inventoryScrollbarGeometry,
  inventorySlotAt,
  inventoryStackCount,
  inventoryTabFaces,
  inventoryTabIndex,
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
    // A real snapshot, so a test can prove a painter leaves nothing behind.
    save() {
      calls.push("save");
      stack.push(state());
    },
    restore() {
      calls.push("restore");
      const previous = stack.pop();
      if (previous) Object.assign(ctx, previous);
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
    strokeStyle: "",
    lineWidth: 0,
    fillText(text: string, x: number, y: number) {
      calls.push(`fillText:${text},${x},${y}`);
    },
    strokeText(text: string, x: number, y: number) {
      calls.push(`strokeText:${text},${x},${y}`);
    },
  };
  const asked: string[] = [];
  const image = (path: string): CanvasImage => {
    asked.push(path);
    return { ready: true, img: path as unknown as CanvasImageSource };
  };
  const tracked = [
    "font",
    "textAlign",
    "textBaseline",
    "fillStyle",
    "strokeStyle",
    "lineWidth",
  ] as const;
  const stack: Record<string, unknown>[] = [];
  const state = () =>
    Object.fromEntries(tracked.map((key) => [key, ctx[key]])) as Record<string, unknown>;
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

test("a cell origin is the exact inverse of the slot hit test, for every visible slot of every row", () => {
  const { grid } = INVENTORY;
  for (const firstRow of [0, 1, 6, 19]) {
    for (let index = 0; index < grid.columns * grid.rows; index++) {
      const slot = grid.columns * firstRow + index + 1;
      const cell = inventoryCellOrigin(slot, firstRow);
      assert.ok(cell, `slot ${slot} on row ${firstRow}`);
      // The hit test reads the middle of the 32px face, so ask it about the cell's own centre.
      assert.equal(
        inventorySlotAt(cell?.x ?? -1, cell?.y ?? -1, firstRow),
        slot,
        `slot ${slot} at row ${firstRow} round-trips`,
      );
    }
  }
  // A slot scrolled past the page has no cell at all: the sheet shows six rows of four.
  assert.equal(inventoryCellOrigin(1, 1), undefined, "slot 1 is above row 1's first slot");
  assert.equal(inventoryCellOrigin(25, 0), undefined, "slot 25 is below the sixth row");
  assert.equal(inventoryCellOrigin(4, 1), undefined, "one before row 1's first slot");
  assert.deepEqual(inventoryCellOrigin(5, 1), { x: grid.x, y: grid.y }, "firstSlot = 4*row + 1");
  assert.deepEqual(inventoryCellOrigin(24, 0), {
    x: grid.x + 3 * grid.pitch,
    y: grid.y + 5 * grid.pitch,
  });
});

test("the printed stack count: quantities over one, always for the 207 family, else the ruc", () => {
  assert.equal(inventoryStackCount({ itemId: 2000002, quantity: 1 }), undefined, "one potion");
  assert.equal(inventoryStackCount({ itemId: 2000002, quantity: 2 }), 2);
  assert.equal(inventoryStackCount({ itemId: 2000002 }), undefined);
  // 207xxxx is the rechargeable family: `sub_463BE0` drops it whole with no count dialog, and its
  // "quantity" is the round count, so the sheet prints it even at one.
  assert.equal(inventoryStackCount({ itemId: 2070000, quantity: 1 }), 1);
  assert.equal(inventoryStackCount({ itemId: 2070016, quantity: 200 }), 200);
  assert.equal(inventoryStackCount({ itemId: 2060000, quantity: 1 }), undefined, "not 207");
  // With no printable quantity the rechargeable remaining-uses count takes over.
  assert.equal(inventoryStackCount({ itemId: 2070000, ruc: 0 }), undefined, "no rounds left");
  assert.equal(inventoryStackCount({ itemId: 2070000, ruc: 700 }), 700);
  assert.equal(inventoryStackCount({ itemId: 2070000, quantity: 1, ruc: 700 }), 1, "quantity wins");
  assert.equal(inventoryStackCount({ itemId: 1002000, ruc: 5 }), 5, "equipment can carry a ruc");
});

test("the stack count prints bottom-right inside the cell, outlined, and leaves the context clean", () => {
  const { ctx, calls } = fakeContext();
  ctx.font = "leftover";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  drawInventoryStackCount(ctx, 700, 100, 200);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("fillText") || call.startsWith("strokeText")),
    ["strokeText:700,100,200", "fillText:700,100,200"],
    `the black outline goes down first: ${calls.join(" ")}`,
  );
  // `save`/`restore` is the point: the old inline block left lineWidth and the alignment dirty.
  assert.deepEqual([calls[0], calls.at(-1)], ["save", "restore"]);
  assert.equal(ctx.strokeStyle, "", "the outline colour does not leak out of the painter");
  assert.equal(ctx.lineWidth, 0, "nor does the 2px stroke width");
  assert.equal(ctx.font, "leftover");
  assert.equal(ctx.textAlign, "left");
  assert.equal(ctx.textBaseline, "alphabetic");
});

test("BtCoin greys out for a dead character, a light purse or a request in flight", () => {
  const idle = { dead: false, mesos: 5000, busy: false, pressed: false, hover: false };
  assert.equal(inventoryCoinState(idle), "normal");
  assert.equal(inventoryCoinState({ ...idle, hover: true }), "mouseOver");
  // CCtrlButton keeps its pressed face only while the pointer is still on the button.
  assert.equal(inventoryCoinState({ ...idle, pressed: true }), "normal");
  assert.equal(inventoryCoinState({ ...idle, pressed: true, hover: true }), "pressed");
  assert.equal(
    inventoryCoinState({ ...idle, pressed: true, hover: true, dead: true }),
    "disabled",
    "a dead character outranks the press",
  );
  assert.equal(inventoryCoinState({ ...idle, mesos: 9 }), "disabled", "under the 10-meso minimum");
  assert.equal(inventoryCoinState({ ...idle, mesos: 10 }), "normal", "exactly 10 is enough");
  assert.equal(inventoryCoinState({ ...idle, busy: true }), "disabled");
});

test("the tab strip lights the open tab and always re-stamps cell 0, which the sheet paints lit", () => {
  assert.deepEqual(
    INVENTORY_TABS.map((tab) => [tab.tab, inventoryTabIndex(tab.tab)]),
    [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ],
  );
  assert.equal(inventoryTabIndex(9), 0, "an unknown tab falls back to the first");
  const faces = inventoryTabFaces(3);
  assert.equal(faces.length, 4, "sub_4581F0 rejects n4 >= 4");
  assert.deepEqual(
    faces.map((face) => [face.index, face.lit, face.stamped]),
    [
      [0, false, true],
      [1, false, false],
      [2, true, true],
      [3, false, false],
    ],
    "cell 0 is stamped because the sheet itself is drawn with the first tab lit",
  );
  assert.deepEqual(
    faces.map((face) => face.face),
    [INVENTORY.idleTab, INVENTORY.idleTab, INVENTORY.litTab, INVENTORY.idleTab],
  );
  assert.deepEqual(
    faces.map((face) => face.box),
    INVENTORY.tabs,
  );
  // With the first tab open there is only one stamp: cell 0 is the lit one.
  assert.deepEqual(
    inventoryTabFaces(1).map((face) => face.stamped),
    [true, false, false, false],
  );
});
