/**
 * The one item slot, and the pitch the native lays slots out on.
 *
 * Every window that shows items used to spell these two numbers separately - `size: 32,
 * pitch: 35` in the inventory, `slot: 32, pitch: 35` in both shop lists, `size: 32, pitch: 35` in
 * the trade room, a bare `32` in the quick slots and another in the equip window's hit test. They
 * are not five independent choices; they are one UI-wide cell, and five separate places in the
 * original say so:
 *
 *  - inventory `sub_4DB990` (`MapleStory.exe.c:226041`) builds the cell as
 *
 *      SetRect(lprc,
 *              35 * ((slot - first) % 4) + 6,   35 * ((slot - first) / 4) + 80,
 *              35 * ((slot - first) % 4) + 38,  35 * ((slot - first) / 4) + 112);
 *
 *    - pitch 35 on both axes, and 38 - 6 = 112 - 80 = 32. Both numbers in one statement.
 *  - trade `sub_4D5440` (`:219870`, `:219871`) - `n146 = 35 * (v2 % 2) + 291` and
 *    `v26 = 35 * (v2 / 2) + 160`; `v26` is the row's bottom, so a 32 px cell per row.
 *  - shop `sub_4B5B10` / `sub_4B5FA0` - `n71 += 35` and `n110 += 35`, with the icon anchored
 *    `v50 - v54 + 32` (`:190521`) off the row's top edge.
 *  - equip `sub_4D9110` (`:223711`) - `x < p < x + 32 && y < q < y + 32`, strict on both sides.
 *  - quick slots `sub_4FC440` (`:257805`) - `n245 = v41 - v46 + 32`, the slot's own height again.
 *
 * The 3 px the pitch leaves over the cell is the gutter between two slots, not part of either one:
 * the inventory and both shop lists refuse a click that lands in it.
 */
export const SLOT_SIZE = 32;

/** Row-to-row (and column-to-column) distance wherever the native lays slots out in a grid. */
export const SLOT_PITCH = 35;
