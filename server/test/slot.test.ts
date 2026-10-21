/**
 * The one item slot - `client/slot.ts`.
 *
 * `SLOT_SIZE = 32` and `SLOT_PITCH = 35` were spelled out five separate times in the client (the
 * inventory grid, both shop lists, the trade room, the quick slots and the equip window's hit
 * test) with nothing tying them together. They are not five independent choices, and five separate
 * places in the original say so:
 *
 *  - `sub_4DB990` (`MapleStory.exe.c:226041`) builds the inventory cell as
 *    `SetRect(lprc, 35 * ((slot - first) % 4) + 6, 35 * ((slot - first) / 4) + 80,
 *                   35 * ((slot - first) % 4) + 38, 35 * ((slot - first) / 4) + 112)`
 *    - pitch 35 on both axes and 38 - 6 = 112 - 80 = 32. Both numbers in one statement.
 *  - `sub_4D5440` (`:219870`, `:219871`) - `n146 = 35 * (v2 % 2) + 291`, `v26 = 35 * (v2 / 2) + 160`.
 *  - `sub_4B5B10` / `sub_4B5FA0` - `n71 += 35` and `n110 += 35`.
 *  - `sub_4D9110` (`:223711`) - `x < p < x + 32 && y < q < y + 32`.
 *  - `sub_4FC440` (`:257805`) - `n245 = v41 - v46 + 32`.
 *
 * This file pins the shared constants to those sites, and pins each client grid to the constants.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";
import { SLOT_PITCH, SLOT_SIZE } from "../../client/slot.ts";
import { ITEM_NO_CELL_RISE, ITEM_NO_CELL_TOP } from "../../client/itemno.ts";
import { INVENTORY } from "../../client/inventory-window.ts";
import { SHOP } from "../../client/shop-window.ts";
import { TRADE_WINDOW, tradeSlotRect } from "../../client/trade-state.ts";
import { QUICK_SLOTS, quickSlotAt, quickSlotIconOrigin } from "../../client/quickslots.ts";
import { EQUIP_SLOTS, equipSlotAt } from "../../client/equipment.ts";

test("sub_4DB990's one SetRect carries both numbers: 38-6 and 112-80 are the cell, 35 the pitch", () => {
  // SetRect(lprc, 35c + 6, 35r + 80, 35c + 38, 35r + 112) - read straight off :226041.
  assert.equal(38 - 6, SLOT_SIZE);
  assert.equal(112 - 80, SLOT_SIZE);
  // The pitch is what separates one cell's origin from the next, on both axes.
  assert.deepEqual(INVENTORY.grid, {
    x: 6,
    y: 80,
    columns: 4,
    rows: 6,
    size: SLOT_SIZE,
    pitch: SLOT_PITCH,
  });
});

test("every client grid declares the one native cell", () => {
  // sub_4B5B10 (`n71 += 35`) and sub_4B5FA0 (`n110 += 35`) - one pitch, both shop lists.
  assert.equal(SHOP.buyList.slot, SLOT_SIZE);
  assert.equal(SHOP.buyList.pitch, SLOT_PITCH);
  assert.equal(SHOP.sellList.slot, SLOT_SIZE);
  assert.equal(SHOP.sellList.pitch, SLOT_PITCH);
  // sub_4D5440 (:219870 / :219871) - the trade room's eight-per-side grid.
  assert.equal(TRADE_WINDOW.slots.size, SLOT_SIZE);
  assert.equal(TRADE_WINDOW.slots.pitch, SLOT_PITCH);
  assert.deepEqual(tradeSlotRect("mine", 1), {
    x: 291,
    y: 128,
    width: SLOT_SIZE,
    height: SLOT_SIZE,
  });
});

test(
  "UI/UIWindow.img/Item/activeIcon is one slot plus two pixels on every side",
  needsArchive,
  () => {
    // The hover frame is the only canvas in the sheet sized off the slot itself, so the art file
    // corroborates SLOT_SIZE rather than the other way round.
    assert.equal(
      canvasSize("UI/UIWindow.img", "Item/activeIcon"),
      `${SLOT_SIZE + 4}x${SLOT_SIZE + 4}`,
    );
  },
);

test("sub_4D9110: the equip window's 14 hit boxes are SLOT_SIZE square and strict on both sides", () => {
  // `x < p < x + 32 && y < q < y + 32` (:223711) - the corner itself is not inside the slot.
  const [sx, sy] = EQUIP_SLOTS[0] ?? [];
  assert.ok(sx !== undefined && sy !== undefined);
  assert.equal(equipSlotAt(sx, sy), 0, "the top-left corner is outside");
  assert.equal(equipSlotAt(sx + 1, sy + 1), 1);
  assert.equal(equipSlotAt(sx + SLOT_SIZE - 1, sy + SLOT_SIZE - 1), 1, "the last pixel is inside");
  assert.equal(equipSlotAt(sx + SLOT_SIZE, sy + SLOT_SIZE), 0, "and the far corner is outside");
  assert.equal(EQUIP_SLOTS.length, 14, "the table sub_4D9110 walks ends at dword_5BC3DC");
});

test("sub_4FC440: a quick slot is SLOT_SIZE square, and its icon bottoms out on the slot", () => {
  const [slot] = QUICK_SLOTS;
  assert.ok(slot);
  assert.equal(quickSlotAt(slot.x, slot.y), 0, "index 0: findIndex, not one-based");
  assert.equal(quickSlotAt(slot.x + SLOT_SIZE, slot.y), -1, "the right edge is exclusive");
  assert.equal(quickSlotAt(slot.x + SLOT_SIZE - 1, slot.y + SLOT_SIZE - 1), 0);
  assert.equal(quickSlotAt(slot.x - 1, slot.y), -1);
  // `n245 = v41 - v46 + 32` (:257805): with no origin the icon lands flush with the slot's top.
  assert.deepEqual(quickSlotIconOrigin(slot, undefined), { x: slot.x, y: slot.y });
  assert.deepEqual(
    quickSlotIconOrigin(slot, { ox: 4, oy: 24 }),
    { x: slot.x - 4, y: slot.y + SLOT_SIZE - 24 },
    "an icon whose origin sits 8 above the slot's bottom hangs 8 down",
  );
});

test("the count sits ITEM_NO_CELL_RISE up from the cell's bottom edge", () => {
  assert.equal(ITEM_NO_CELL_RISE, 12, "every sub_525AE0 caller hands it `rect.bottom - 12`");
  assert.equal(ITEM_NO_CELL_TOP, SLOT_SIZE - ITEM_NO_CELL_RISE);
  assert.equal(ITEM_NO_CELL_TOP, 20);
});

test("the inventory's four columns end one pixel clear of its scrollbar", () => {
  // The pitch and the bar's x are not independent: 6 + 4 * 35 = 146, and sub_4DA440 creates the
  // CCtrlScrollBar at x 147 - so the fourth column's right edge (113) and the bar never overlap.
  const { grid, scrollbar } = INVENTORY;
  assert.equal(grid.x + grid.columns * SLOT_PITCH, scrollbar.x - 1);
  // The fourth column runs 111..143, and the bar starts at 147 - four px of clear air between them.
  assert.equal(grid.x + (grid.columns - 1) * SLOT_PITCH, 111);
  assert.equal(grid.x + (grid.columns - 1) * SLOT_PITCH + SLOT_SIZE, 143);
  assert.ok(143 < scrollbar.x, "the last column and the bar do not collide");
});
