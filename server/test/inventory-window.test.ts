/** Native inventory sheet geometry (sub_43D750 / sub_43E340 / 4DA440 / 4DA810), now unit-tested
 * after it left client/main.js. Every number here is the client's own layout, not a convenience.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSUME_FAMILY,
  INVENTORY,
  INVENTORY_ACTIVE_ICON_INSET,
  INVENTORY_COUNT_TOP,
  INVENTORY_DROP_MAX,
  INVENTORY_TABS,
  INVENTORY_TAB_LABEL,
  MESO_DROP,
  clampInventoryScroll,
  consumeUseRoute,
  drawInventoryItems,
  drawInventoryLabel,
  drawInventoryScrollbar,
  drawInventoryTabStrip,
  hasConsumeUseSound,
  inventoryCellOrigin,
  inventoryCoinState,
  inventoryDropPlan,
  inventoryScrollbarGeometry,
  inventorySlotAt,
  inventoryStackCount,
  isIrreplaceableItem,
  isRechargeableItem,
  mesoDropAllowed,
  mesoDropBounds,
  inventoryTabFaces,
  inventoryTabIndex,
  inventoryTabOfItem,
  inventoryWindowAt,
  quickSlotUseRoute,
  type InventoryTabView,
} from "../../client/inventory-window.ts";
import { ITEM_NO_CELL_TOP } from "../../client/itemno.ts";
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
    fillRect(x: number, y: number, width: number, height: number) {
      calls.push(`fillRect:${x},${y},${width},${height}`);
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

test("the bought item's tab is the wire's 1-based number, and agrees with where rewards land", async () => {
  // The page stores the wire tab (1..4): server/src/game/inventory.ts rejects anything else and
  // indexes items.inventories[tab - 1]. The `- 1` in sub_4B6B40's tail is CCtrlTab's own 0-based
  // position, one layer below that, and must not be copied into inventoryTab.
  assert.equal(inventoryTabOfItem(1302000), 1, "equipment -> 장비");
  assert.equal(inventoryTabOfItem(2000002), 2, "potion -> 소비");
  assert.equal(inventoryTabOfItem(4000000), 3, "etc -> 기타");
  assert.equal(inventoryTabOfItem(3010000), 3, "install has no tab of its own in this build");
  assert.equal(inventoryTabOfItem(5000000), 4, "cash");
  assert.equal(inventoryTabOfItem(999999), 3, "an id below the first category lands in etc");
  for (const tab of [inventoryTabOfItem(1000000), inventoryTabOfItem(5999999)])
    assert.ok(tab >= 1 && tab <= 4, `every id maps into the four tabs, got ${tab}`);
  for (const tab of INVENTORY_TABS)
    assert.ok(
      [1000000, 2000000, 4000000, 5000000].some((id) => inventoryTabOfItem(id) === tab.tab),
      `tab ${tab.tab} (${tab.label}) is reachable`,
    );
  // The same rule decides where the server puts a reward; if either side moves, this fails.
  const { inventoryTabOfItemId } = await import("../src/game/rewards.ts");
  for (const category of [0, 1, 2, 3, 4, 5, 6, 9]) {
    assert.equal(
      inventoryTabOfItem(category * 1_000_000),
      inventoryTabOfItemId(category * 1_000_000),
      `category ${category} must land the client and the server on the same tab`,
    );
  }
  for (const itemId of [1302000, 2000002, 2070000, 3010000, 4001000, 5000000])
    assert.equal(inventoryTabOfItem(itemId), inventoryTabOfItemId(itemId), `item ${itemId}`);
});

test("207xxxx is the rechargeable family, the one whose count is rounds rather than a stack", () => {
  assert.equal(isRechargeableItem(2070000), true);
  assert.equal(isRechargeableItem(2070016), true);
  assert.equal(isRechargeableItem(2079999), true, "the whole 207 block");
  assert.equal(isRechargeableItem(2069999), false, "arrows are 206, not 207");
  assert.equal(isRechargeableItem(2080000), false);
  assert.equal(isRechargeableItem(2000002), false);
  // sub_463BE0 reads it as itemId / 10000 == 207, so the boundary is the block, not the item.
  assert.equal(isRechargeableItem(2069999), false);
  assert.equal(isRechargeableItem(2070000 - 1), false);
  // The stack count leans on it: a rechargeable prints its quantity even at one.
  assert.equal(inventoryStackCount({ itemId: 2070000, quantity: 1 }), 1);
  assert.equal(inventoryStackCount({ itemId: 2060000, quantity: 1 }), undefined);
});

test("sub_535C90's meso box: floor 10, that 10 as the starting figure, ceiling 50000 or the purse", () => {
  // FINDINGS 4.34: sub_535C90(dlg, 기본값, 하한, 상한) with (10, 10, min(메소, 50000)).
  assert.deepEqual(MESO_DROP, { min: 10, initial: 10, ceiling: 50000 });
  assert.deepEqual(mesoDropBounds(0), { min: 10, initial: 10, max: 0 });
  assert.deepEqual(mesoDropBounds(9), { min: 10, initial: 10, max: 9 });
  assert.deepEqual(mesoDropBounds(10), { min: 10, initial: 10, max: 10 });
  assert.deepEqual(mesoDropBounds(49999), { min: 10, initial: 10, max: 49999 });
  assert.deepEqual(mesoDropBounds(50000), { min: 10, initial: 10, max: 50000 });
  assert.deepEqual(
    mesoDropBounds(50001),
    { min: 10, initial: 10, max: 50000 },
    "the purse never raises the ceiling",
  );
  assert.deepEqual(mesoDropBounds(4_000_000), { min: 10, initial: 10, max: 50000 });
});

test("mesoDropAllowed holds the same range the box was opened with", () => {
  assert.equal(mesoDropAllowed(10, 10), true, "exactly the floor");
  assert.equal(mesoDropAllowed(9, 10), false);
  assert.equal(mesoDropAllowed(11, 10), false, "above what the purse holds");
  assert.equal(mesoDropAllowed(50000, 50001), true);
  assert.equal(mesoDropAllowed(50001, 50001), false, "the ceiling is a ceiling");
  assert.equal(mesoDropAllowed(10.5, 100), false, "the wire carries an integer");
  assert.equal(mesoDropAllowed(undefined, 100), false);
  assert.equal(mesoDropAllowed("10", 100), false);
  // A purse that grew between the box opening and the answer is the server's to refuse, not here.
  assert.equal(mesoDropAllowed(40, 30), false);
});

test("4031xxxx is the family sub_463BE0 confirms before dropping, whatever tab it sits in", () => {
  assert.equal(isIrreplaceableItem(4031000), true);
  assert.equal(isIrreplaceableItem(4031999), true, "the whole 4031 block");
  assert.equal(isIrreplaceableItem(4032000), false);
  assert.equal(isIrreplaceableItem(4030000), false);
  assert.equal(isIrreplaceableItem(4001000), false);
});

test("inventoryDropPlan: equips drop one, other stacks ask, and nothing leaves above a u16-max", () => {
  assert.equal(INVENTORY_DROP_MAX, 32767);
  // Tab 1 is 장비: one, and the snapshot guard is the only confirmation.
  assert.deepEqual(inventoryDropPlan(1, 1302000, 1), { kind: "send", count: 1 });
  assert.deepEqual(
    inventoryDropPlan(1, 1302000, 40),
    { kind: "send", count: 1 },
    "equips do not stack",
  );
  // A single one of anything goes without a word.
  assert.deepEqual(inventoryDropPlan(2, 2000002, 1), { kind: "send", count: 1 });
  assert.deepEqual(inventoryDropPlan(4, 4001000, 1), { kind: "send", count: 1 });
  // Stacks ask, capped at the u16 the 0x17 opcode can carry.
  assert.deepEqual(inventoryDropPlan(2, 2000002, 2), { kind: "ask", max: 2 });
  assert.deepEqual(inventoryDropPlan(2, 2000002, 32767), { kind: "ask", max: 32767 });
  // The box itself is capped, so an over-long stack still asks - just never for more than fits.
  assert.deepEqual(inventoryDropPlan(2, 2000002, 32768), { kind: "ask", max: 32767 });
  assert.deepEqual(inventoryDropPlan(2, 2000002, 100000), { kind: "ask", max: 32767 });
  // A 207 is confirmed whole, so sub_4D5C80's own rule lets a count of 0 through.
  assert.deepEqual(inventoryDropPlan(2, 2070000, 0), { kind: "send", count: 0 });
  assert.deepEqual(inventoryDropPlan(2, 2070000, 1), { kind: "send", count: 1 });
  assert.deepEqual(inventoryDropPlan(2, 2070000, 500), { kind: "send", count: 500 });
  // A 207 is confirmed whole, so an over-long one has no box to fall back on - it is just refused.
  assert.deepEqual(inventoryDropPlan(2, 2070000, 32768), { kind: "refuse" });
  // A plain stack that somehow reads 0 has nothing to drop and nothing to ask.
  assert.deepEqual(inventoryDropPlan(2, 2000002, 0), { kind: "refuse" });
  assert.deepEqual(inventoryDropPlan(2, 2000002, -1), { kind: "refuse" });
  // The 4031 confirm decides nothing here - the page's own guard does that before the box.
  assert.deepEqual(inventoryDropPlan(4, 4031000, 3), { kind: "ask", max: 3 });
});

test("the USE tab sends 200/201/202 through 0x18 and 203 through 0x19, each on its own gate", () => {
  // sub_462DC0: `n200 == 200 || 201 || 202` -> sub_55B2C0 (0xC8 = 200 ms); `203` -> sub_55B4B0
  // (0x1F4 = 500 ms); anything else, a 204 scroll included, falls through both branches.
  for (const family of CONSUME_FAMILY.heal) {
    assert.deepEqual(
      consumeUseRoute(family * 10000),
      { kind: "heal", cooldownMs: 200 },
      `family ${family}`,
    );
    assert.deepEqual(consumeUseRoute(family * 10000 + 9999), { kind: "heal", cooldownMs: 200 });
  }
  assert.deepEqual(consumeUseRoute(CONSUME_FAMILY.moveTo * 10000), {
    kind: "map",
    cooldownMs: 500,
  });
  assert.deepEqual(consumeUseRoute(2030000), { kind: "map", cooldownMs: 500 }, "마을 귀환 주문서");
  assert.deepEqual(consumeUseRoute(2040000), { kind: "none" }, "a scroll: no double-click action");
  assert.deepEqual(
    consumeUseRoute(2070000),
    { kind: "none" },
    "a rechargeable: not a consumable use",
  );
  assert.deepEqual(consumeUseRoute(1302000), { kind: "none" }, "an equip");
  assert.deepEqual(consumeUseRoute(1999999), { kind: "none" }, "below the family");
  assert.deepEqual(consumeUseRoute(2050000), { kind: "none" }, "above it");
});

test("sub_512570's quickslot never reaches the 0x19 sender", () => {
  for (const family of CONSUME_FAMILY.heal)
    assert.deepEqual(quickSlotUseRoute(family * 10000), { kind: "heal", cooldownMs: 200 });
  assert.deepEqual(
    quickSlotUseRoute(2030000),
    { kind: "none" },
    "no 203 branch exists in sub_512570",
  );
  assert.deepEqual(quickSlotUseRoute(2040000), { kind: "none" });
});

test("sub_526F30 has a Use sound for the three healing families and nothing else", () => {
  // Sound/Item.img carries 0200xxxx / 0201xxxx / 0202xxxx only - no 0203, no 0204.
  assert.equal(hasConsumeUseSound(2000000), true);
  assert.equal(hasConsumeUseSound(2010000), true);
  assert.equal(hasConsumeUseSound(2020000), true);
  assert.equal(hasConsumeUseSound(2030000), false);
  assert.equal(hasConsumeUseSound(2040000), false);
  assert.equal(hasConsumeUseSound(1302000), false);
});

/**
 * The item painter: every icon is centred in its 32 px slot, the count hangs off the cell's LEFT
 * edge 20 px down, and the hovered cell wears the 36x36 `activeIcon`.
 *
 * The frame's 2 px inset is not a guess - `UI/UIWindow.img/Item/activeIcon` really is a 36x36
 * canvas (`bun tools/wz.ts dump "UI/UIWindow.img"`), two pixels larger than the slot on each side.
 * The count's (0, +20) is not a guess either: `sub_4DB240` (`:225635`) hands `sub_525AE0`
 * `(rect.left, rect.bottom - 12)` at `:225848`, and `sub_4DB990` (`:226041`) builds that rect as
 * `35c + 6, 35r + 80, 35c + 38, 35r + 112`. It used to be a browser-font copy hanging off the
 * bottom-right corner - that was ours, not the original's.
 */
test("the grid centres each icon in its slot and hangs the count off the cell's top-left", () => {
  const { ctx, calls, drawn, image } = fakeContext();
  const { grid } = INVENTORY;
  const cell = inventoryCellOrigin(1, 0);
  assert.ok(cell);
  const icon = (name: string, width: number, height: number) => ({
    img: name as unknown as CanvasImageSource,
    ready: true,
    width,
    height,
  });
  drawInventoryItems(ctx, image, 0, 0, {
    firstRow: 0,
    cells: [
      { slot: 1, icon: icon("icon", 30, 24), count: 700 },
      // Slot 25 is the row below the six this page shows, so it paints nothing at all.
      { slot: 25, icon: icon("off-page", 32, 32) },
    ],
    hovered: 1,
  });
  assert.equal(
    drawn.length,
    2 + 3,
    "one icon, three count glyphs and one hover frame; the off-page slot draws nothing",
  );
  // Centred in the slot, whatever the icon measures.
  assert.equal(drawn[0]?.x, cell.x + Math.floor((grid.size - 30) / 2));
  assert.equal(drawn[0]?.y, cell.y + Math.floor((grid.size - 24) / 2));
  // `sub_525AE0`: the count starts at the cell's own left edge, 20 px down, and each glyph steps by
  // its own width - "700" advances 8 then 8, because only `1` is the narrow 5 px one.
  assert.deepEqual(
    drawn.slice(1, 4).map((entry) => [entry.image, entry.x, entry.y]),
    [
      ["UI/Basic.img/ItemNo/7", cell.x, cell.y + INVENTORY_COUNT_TOP],
      ["UI/Basic.img/ItemNo/0", cell.x + 8, cell.y + INVENTORY_COUNT_TOP],
      ["UI/Basic.img/ItemNo/0", cell.x + 16, cell.y + INVENTORY_COUNT_TOP],
    ],
  );
  assert.equal(INVENTORY_COUNT_TOP, ITEM_NO_CELL_TOP);
  // No browser text left in this painter: the count is stamped, not typed.
  assert.deepEqual(
    calls.filter((call) => call.startsWith("strokeText") || call.startsWith("fillText")),
    [],
  );
  // The hover frame, two pixels outside the cell on every side.
  assert.equal(drawn[4]?.image, "UI/UIWindow.img/Item/activeIcon");
  assert.equal(drawn[4]?.x, cell.x - INVENTORY_ACTIVE_ICON_INSET);
  assert.equal(drawn[4]?.y, cell.y - INVENTORY_ACTIVE_ICON_INSET);
});

test("the tab strip covers each face's own label and prints the page's four in tab order", () => {
  const { ctx, calls, drawn } = fakeContext();
  const sheet = { img: "sheet" as unknown as CanvasImageSource, ready: true };
  drawInventoryTabStrip(
    ctx,
    sheet,
    INVENTORY_TABS.map((tab) => tab.label),
    0,
    0,
    2, // 소비 - the second tab
  );
  // Two faces are stamped from the sheet: the open tab's lit one, and - because the sheet ships
  // with its first tab already lit - an idle one over cell 0.
  assert.deepEqual(
    drawn.map((entry) => String(entry.image)),
    ["sheet", "sheet"],
  );
  // Four label plates, each covering the Korean the stamp carries.
  const plates = calls.filter((call) => call.startsWith("fillRect"));
  assert.equal(plates.length, 4);
  assert.equal(
    plates[1],
    `fillRect:${INVENTORY.tabs[1].x + INVENTORY_TAB_LABEL.left},` +
      `${INVENTORY.tabs[1].y + INVENTORY_TAB_LABEL.top},` +
      `${INVENTORY_TAB_LABEL.width},${INVENTORY_TAB_LABEL.height}`,
  );
  assert.deepEqual(
    calls
      .filter((call) => call.startsWith("fillText"))
      .map((call) => call.slice("fillText:".length).split(",")[0]),
    INVENTORY_TABS.map((tab) => tab.label),
  );
  // Each label sits at its own tab's centre, on the plate's baseline.
  assert.deepEqual(
    calls.filter((call) => call.startsWith("fillText")).map((call) => Number(call.split(",")[1])),
    INVENTORY.tabs.map((box) => box.x + box.width / 2),
  );
});
