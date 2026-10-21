/**
 * `sub_525AE0` (`MapleStory.exe.c:298618`) - the one routine every count in the UI is painted by.
 *
 * Its body was missing from the notes until now: ADR-120 recorded it as an `idb` declaration with
 * no body (line 5343 is only the forward declaration) and left the shop's flat 8 px pitch
 * unresolved. The body is at `:298618`, and it settles the question:
 *
 *  - `sub_411E50(&v36, "%d", ArgList)` formats the count, then walks it a character at a time.
 *  - `itoa_w(*(char *)(v6 + v36) - 48, Buffer)` turns the ASCII digit back into 0..9 and looks that
 *    name up in the property object passed as the fifth argument - `UI/Basic.img/ItemNo/{digit}`.
 *  - The glyph is drawn at the running x and one shared y, i.e. **left- and top-anchored**.
 *  - `n146 += a6 + v34` - the advance is the glyph's **own width** plus the sixth argument.
 *
 * That sixth argument is a real, varying spacing: `sub_504480` (`:265177`) passes the literal `1`
 * (`:265265`). `sub_473990` - which sits between the assignment and the call at the inventory,
 * trade and shop sites - has no body in this checkout, so their value is read off the assignment
 * immediately before it, and all three are 0.
 *
 * The anchors are the other half, and four call sites agree on them:
 * `(rect.left, rect.bottom - 12)` against a 32 px cell, i.e. **(0, +20) from the cell's top-left**:
 * inventory `sub_4DB240` (`:225848`), trade `sub_4D5440` (`:219951`), shop `sub_4B5FA0`
 * (`:190691`), and `sub_4FC440` (`:257831`, `LODWORD(v36) = v41 + 20`).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";
import {
  ITEM_NO_CELL_TOP,
  ITEM_NO_HEIGHT,
  ITEM_NO_PATH,
  ITEM_NO_WIDTH,
  drawItemNo,
  itemNoAdvance,
  itemNoDigits,
} from "../../client/itemno.ts";

/** A context that only records what `drawItemNo` stamps, and where. */
function fakeContext() {
  const drawn: { image: unknown; x: number; y: number }[] = [];
  return {
    drawn,
    ctx: {
      drawImage(image: unknown, x: number, y: number) {
        drawn.push({ image, x, y });
      },
    } as unknown as CanvasRenderingContext2D,
  };
}

/** Glyphs whose `img` is the path itself, so a test can name what got stamped. */
const image = (path: string) => ({ ready: true, img: path as unknown as CanvasImageSource });

test(
  "UI/Basic.img/ItemNo really is ten 11px glyphs, nine of them 8px wide and `1` a narrow 5px one",
  needsArchive,
  () => {
    ITEM_NO_WIDTH.forEach((width, digit) => {
      assert.equal(canvasSize("UI/Basic.img", `ItemNo/${digit}`), `${width}x${ITEM_NO_HEIGHT}`);
    });
  },
);

test('sub_411E50\'s "%d": the digits of a count, most significant first', () => {
  assert.deepEqual(itemNoDigits(700), [7, 0, 0]);
  assert.deepEqual(itemNoDigits(0), [0]);
  assert.deepEqual(itemNoDigits(1), [1]);
  // The native truncates and clamps rather than printing a sign or a fraction.
  assert.deepEqual(itemNoDigits(-5), [0]);
  assert.deepEqual(itemNoDigits(12.9), [1, 2]);
});

test("n146 += a6 + v34: each glyph advances by its own width, plus the caller's spacing", () => {
  assert.equal(itemNoAdvance(1), 5, "`1` is the narrow one");
  assert.equal(itemNoAdvance(8), 8);
  assert.equal(itemNoAdvance(8, 1), 9, "sub_504480 passes the literal 1");
});

test("the painter is left- and top-anchored, and steps by each glyph's own width", () => {
  const { ctx, drawn } = fakeContext();
  drawItemNo(ctx, image, 101, 692, 584);
  assert.deepEqual(
    drawn.map((entry) => [entry.image, entry.x, entry.y]),
    [
      [`${ITEM_NO_PATH}/1`, 692, 584],
      [`${ITEM_NO_PATH}/0`, 697, 584],
      [`${ITEM_NO_PATH}/1`, 705, 584],
    ],
    '"101" steps 5 then 8; nothing is right- or baseline-anchored',
  );
  drawn.length = 0;
  drawItemNo(ctx, image, 101, 692, 584, 1);
  assert.deepEqual(
    drawn.map((entry) => entry.x),
    [692, 698, 707],
    "with sub_504480's gap of 1 every step grows by one",
  );
});

test("nothing is stamped until every glyph has loaded", () => {
  const { ctx, drawn } = fakeContext();
  // A missing middle digit would slide every digit after it, so the painter waits for all of them.
  const partial = (path: string) => ({
    ready: !path.endsWith("/0"),
    img: path as unknown as CanvasImageSource,
  });
  drawItemNo(ctx, partial, 101, 692, 584);
  assert.equal(drawn.length, 0);
  drawItemNo(ctx, () => ({ ready: false, img: "" as unknown as CanvasImageSource }), 12, 0, 0);
  assert.equal(drawn.length, 0);
});

test("every 32px cell painter hands sub_525AE0 (rect.left, rect.bottom - 12)", () => {
  // `sub_4DB990` (`:226041`) builds the inventory cell as 35c+6, 35r+80, 35c+38, 35r+112.
  const inventoryCell = { left: 6, top: 80, right: 38, bottom: 112 };
  assert.equal(inventoryCell.bottom - 12, inventoryCell.top + ITEM_NO_CELL_TOP);
  // `sub_4D5440` (`:219871`) runs the trade room's rows at 35r + 160, i.e. a 32px cell from 128.
  assert.equal(160 - 12, 128 + ITEM_NO_CELL_TOP);
  // `sub_4B5FA0` (`:190691`) draws the shop's stack at n110 + 1 = 111, from a row that starts at 91.
  assert.equal(111, 91 + ITEM_NO_CELL_TOP);
  // `sub_4FC440` (`:257831`) is the plainest of all: `LODWORD(v36) = v41 + 20`.
  assert.equal(ITEM_NO_CELL_TOP, 20);
});
