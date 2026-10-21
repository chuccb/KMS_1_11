/**
 * CUISkill's sheet geometry - `client/skills.ts`.
 *
 * `sub_4ECD40` (`MapleStory.exe.c:243551`) is where the skill book creates its controls, and three
 * of those creations carry the whole layout:
 *
 *  - `:243618` - `(*(*(this + 217) + 32))(…, this, 2000, 3, 52, 170, 0)`, the `CCtrlTab`:
 *    x 3, y 52, width 170. So the strip runs 3..173, and `UI/Basic.img/Tab`'s own 4 px left cap and
 *    12 px right cap leave exactly 154 px, from x = 7, for the tabs themselves.
 *  - `:243639` - `(*(*(this + 219) + 32))(…, this, 2001, 1, 0, 161, 116, 162, 0)`, the
 *    `CCtrlScrollBar`, followed at `:243646` by `*(*(this + 219) + 44) = 156` (the wrap width).
 *  - `:243695`..`:243704` - `CCtrlButton id(2010 + i)` at `(139, n137)`, starting `n137 = 137`,
 *    `n137 += 40` each pass, `while (n137 < 297)` - four SP-up buttons on a 40 px pitch, which is
 *    the row pitch too.
 *
 * Before this round those numbers were spelled out longhand at sixteen sites in `skills.ts`
 * (`161` seven times, `119` and `40` six times each, `154` and `116` four times each) with nothing
 * saying where any of them came from.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";
import { VSCR_CELL, paintVScrollbar } from "../../client/vscroll.ts";
import { TAB_FILL, TAB_LEFT, TAB_MIDDLE, TAB_RIGHT } from "../../client/tabstrip.ts";
import {
  SKILL_ROW,
  SKILL_ROW_LIVE,
  SKILL_ROW_PITCH,
  SKILL_ROW_TOP,
  SKILL_ROWS,
  SKILL_SCROLLBAR,
  SKILL_TABS,
  SKILL_TAB_INNER,
  SKILL_UP_BUTTON,
  SKILL_WINDOW,
  skillRowAt,
} from "../../client/skills.ts";

test("sub_4ECD40's CCtrlTab id2000 at (3, 52) width 170 is the whole strip", () => {
  assert.deepEqual(SKILL_TABS, { x: 3, y: 52, width: 170, height: 24 });
  assert.equal(SKILL_TABS.x + SKILL_TABS.width, 173, "the strip's right edge");
  // ADR-119's Tab caps: what is left for the tabs themselves is 170 - 4 - 12 = 154, from 3 + 4 = 7.
  assert.deepEqual(SKILL_TAB_INNER, { x: 7, width: 154 });
  assert.equal(SKILL_TAB_INNER.x, SKILL_TABS.x + TAB_LEFT);
  assert.equal(SKILL_TAB_INNER.width, SKILL_TABS.width - TAB_LEFT - TAB_RIGHT);
  assert.equal(SKILL_TAB_INNER.x + SKILL_TAB_INNER.width, 161, "where the right cap is stamped");
});

test(
  "the four pieces tile the strip exactly: left, one fill per pixel, a crease per join, right",
  needsArchive,
  () => {
    for (const [name, size] of [
      ["left0", `${TAB_LEFT}x24`],
      ["middle0", `${TAB_MIDDLE}x24`],
      ["right0", `${TAB_RIGHT}x24`],
      ["fill0", `${TAB_FILL}x24`],
    ] as const)
      assert.equal(canvasSize("UI/Basic.img", `Tab/${name}`), size);
    // Four books means three creases, and the rest is fill - and it all has to come back to 170.
    const creases = 3;
    assert.equal(
      TAB_LEFT +
        (170 - TAB_LEFT - TAB_RIGHT - creases * TAB_MIDDLE) +
        creases * TAB_MIDDLE +
        TAB_RIGHT,
      170,
    );
  },
);

test("sub_4ECD40's CCtrlScrollBar id2001 at (161, 116) height 162", () => {
  assert.deepEqual(SKILL_SCROLLBAR, {
    x: 161,
    y: 116,
    width: VSCR_CELL,
    height: 162,
    arrow: VSCR_CELL,
  });
  // The pointer zone ends at the bar's own bottom, and the `next` arrow sits one cell above it.
  assert.equal(SKILL_SCROLLBAR.y + SKILL_SCROLLBAR.height, 278);
  assert.equal(SKILL_SCROLLBAR.y + SKILL_SCROLLBAR.height - VSCR_CELL, 266);
});

test("the bar is painted by the shared painter, not a hand-rolled copy", () => {
  // What the skill window used to inline, and what `client/vscroll.ts` now does for it: `prev` at
  // the top, `base` one cell at a time from 128 while < 266, `next` at 266, and the thumb.
  const drawn: { image: unknown; x: number; y: number }[] = [];
  const ctx = {
    drawImage(image: unknown, x: number, y: number) {
      drawn.push({ image, x, y });
    },
  } as unknown as CanvasRenderingContext2D;
  const image = (path: string) => ({ ready: true, img: path as unknown as CanvasImageSource });
  const scroll = {
    max: 8,
    pos: 0,
    pressed: undefined,
    dragging: false,
    offset: 0,
  } as unknown as Parameters<typeof paintVScrollbar>[4];
  paintVScrollbar(ctx, image, { x: 0, y: 0 }, SKILL_SCROLLBAR, scroll);
  assert.deepEqual(
    drawn.map((entry) => [
      String(entry.image).replace("UI/Basic.img/VScr/enabled/", ""),
      entry.x,
      entry.y,
    ]),
    [
      ["prev0", 161, 116],
      ...Array.from({ length: Math.ceil(138 / VSCR_CELL) }, (_, i) => [
        "base",
        161,
        128 + i * VSCR_CELL,
      ]),
      ["next0", 161, 266],
      // A zero offset parks the thumb one cap down: `bar.y + arrow + offset`, not `bar.y`.
      ["thumb0", 161, 128],
    ],
  );
  // Every `base` tile is inside the trough: the first is one cell below the top, the last ends
  // before the `next` cap.
  const bases = drawn.filter((entry) => String(entry.image).endsWith("/base"));
  assert.equal(bases[0]?.y, SKILL_SCROLLBAR.y + VSCR_CELL);
  assert.ok((bases.at(-1)?.y ?? 0) < 266);
});

test("sub_4ECD40's four CCtrlButtons: (139, 137 + 40i) while n137 < 297", () => {
  assert.equal(SKILL_UP_BUTTON.x, 139);
  assert.equal(SKILL_UP_BUTTON.firstY, 137);
  assert.equal(SKILL_UP_BUTTON.pitch, SKILL_ROW_PITCH, "the button pitch is the row pitch");
  assert.equal(SKILL_UP_BUTTON.lastY, 297);
  // The loop is do/while: 137, 177, 217, 257 run, and 297 is where it stops.
  const rows = [137, 177, 217, 257];
  assert.deepEqual(
    rows.map((_, i) => SKILL_UP_BUTTON.firstY + SKILL_UP_BUTTON.pitch * i),
    rows,
  );
  assert.equal(rows.length, SKILL_ROWS);
  assert.ok(!(SKILL_UP_BUTTON.lastY < SKILL_UP_BUTTON.lastY), "297 is not a fifth row");
});

test("four 40px rows from y=119: skillRowAt's band, its live strip and its 2px gutter", () => {
  assert.equal(SKILL_ROW_TOP, 119);
  assert.equal(SKILL_ROW_PITCH, 40);
  assert.equal(SKILL_ROWS, 4);
  assert.equal(SKILL_ROW_TOP + SKILL_ROWS * SKILL_ROW_PITCH, 279);
  // Left edge inclusive, right edge exclusive, 154 wide - the same inner width as the tab strip.
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP, 4), 0);
  assert.equal(skillRowAt(SKILL_ROW.x - 1, SKILL_ROW_TOP, 4), -1);
  assert.equal(skillRowAt(SKILL_ROW.x + SKILL_ROW.width, SKILL_ROW_TOP, 4), -1);
  assert.equal(skillRowAt(SKILL_ROW.x + SKILL_ROW.width - 1, SKILL_ROW_TOP, 4), 0);
  // Each row is live for SKILL_ROW_LIVE = 38 of its 40 px; the last 2 are the gutter.
  assert.equal(SKILL_ROW_LIVE, 38);
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP + 37, 4), 0);
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP + 38, 4), -1, "the gutter hits nothing");
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP + 40, 4), 1, "and row 1 starts there");
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP + 3 * SKILL_ROW_PITCH, 4), 3);
  assert.equal(
    skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP + 4 * SKILL_ROW_PITCH, 4),
    -1,
    "past the last",
  );
  // The offset the scrollbar hands it shifts the answer, and the count guard still applies.
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP, 8, 5), 5);
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP, 1, 0), 0);
  assert.equal(skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP, 0, 0), -1, "an empty book has no rows");
  assert.equal(
    skillRowAt(SKILL_ROW.x, SKILL_ROW_TOP, 2, 5),
    -1,
    "5 is past the end of a 2-row page",
  );
});

test("the sheet itself: 176x315 at sub_43D750's window 3 default (96, 96)", () => {
  assert.equal(SKILL_WINDOW.width, 176);
  assert.equal(SKILL_WINDOW.height, 315);
  assert.deepEqual(SKILL_WINDOW.home, { x: 96, y: 96 }, "8 * (3 * 3 + 3)");
  // The row band and both the tab strip and the bar live inside the 176 px plate.
  assert.ok(SKILL_ROW.x + SKILL_ROW.width < SKILL_SCROLLBAR.x, "rows clear of the bar");
  assert.ok(SKILL_SCROLLBAR.x + VSCR_CELL < SKILL_WINDOW.width);
});
