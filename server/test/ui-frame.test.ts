/**
 * The `UtilDlgEx` window frame - `client/uiframe.ts` and `drawUtilFrame`.
 *
 * `CUtilDlgEx` (`sub_531110`) builds every dialog - the NPC dialogue, the count box, the drop box -
 * out of eight canvases, `UI/UIWindow.img/UtilDlgEx/Border/0..7`, and `UtilDlgEx2` repeats all
 * eight sizes for the server's own palette. `drawUtilFrame` used to spell the measurements out by
 * hand (13, 7, 54, 8, 4, 18, 31, 49); every one of them is one of those eight cells, or a sum or a
 * difference of two of them, and this file is what says so.
 *
 * Two things are pinned here:
 *
 *  - **The eight measurements**, re-read out of `Data.wz` on every run, for both palettes, so a
 *    repacked client cannot drift out from under `client/uiframe.ts`.
 *  - **The four offsets the painter asks for**, re-derived from the cells, so `frameBodyTop()` and
 *    `frameBottomInset()` stay honest - and the whole stamp list of a real frame, so the rewrite
 *    from literals to constants is provably byte-for-byte the same drawing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";
import {
  frameBodyTop,
  frameBottomInset,
  frameSprite,
  UTIL_DLG_FRAME,
} from "../../client/uiframe.ts";
import { drawUtilFrame } from "../../client/utildialog.ts";

const frame = UTIL_DLG_FRAME;

/** The eight pieces in the order the WZ stores them, so the table reads like the strip. */
const PIECES = [
  frame.topLeft,
  frame.top,
  frame.topRight,
  frame.left,
  frame.right,
  frame.bottomLeft,
  frame.bottom,
  frame.bottomRight,
] as const;

/** A canvas that records every stamp as `index@x,y`, plus the clip rectangles it was under. */
function recorder() {
  const drawn: string[] = [];
  const rects: string[] = [];
  let clip: string | undefined;
  const ctx = {
    save() {},
    restore() {
      clip = undefined;
    },
    beginPath() {},
    rect(x: number, y: number, w: number, h: number) {
      clip = `${x},${y},${w},${h}`;
      rects.push(clip);
    },
    clip() {},
    fillRect(x: number, y: number, w: number, h: number) {
      drawn.push(`fill ${x},${y},${w},${h}`);
    },
    fillStyle: "",
    drawImage(image: unknown, x: number, y: number) {
      drawn.push(`${String(image).split("/").pop()}@${x},${y}`);
    },
  } as unknown as CanvasRenderingContext2D;
  const image = (path: string) => ({ ready: true, img: path as unknown as CanvasImageSource });
  return { ctx, image, drawn, rects };
}

test("the eight pieces are stored in the order their indexes say, with no gaps", () => {
  assert.deepEqual(
    PIECES.map((piece) => piece.index),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(frameSprite(false, frame.topLeft), "UI/UIWindow.img/UtilDlgEx/Border/0");
  assert.equal(frameSprite(true, frame.bottomRight), "UI/UIWindow.img/UtilDlgEx2/Border/7");
  assert.equal(frameSprite(false, frame.bottomRight), "UI/UIWindow.img/UtilDlgEx/Border/7");
});

test(
  "every one of the eight cells is the size Data.wz gives it, in both palettes",
  needsArchive,
  () => {
    for (const server of [false, true]) {
      const image = "UI/UIWindow.img";
      const strip = `UtilDlgEx${server ? "2" : ""}`;
      for (const piece of PIECES)
        assert.equal(
          canvasSize(image, `${strip}/Border/${piece.index}`),
          `${piece.width}x${piece.height}`,
          `${strip}/Border/${piece.index}`,
        );
    }
  },
);

test("the four offsets the painter asks for come out of the cells, not out of thin air", () => {
  // 13: the top-right corner is 31 tall and the two 18-tall corners are bottom-aligned inside it.
  assert.equal(frameBodyTop(frame), 13);
  assert.equal(frame.topRight.height - frame.topLeft.height, 13);
  assert.equal(frame.topRight.height, 31);
  assert.equal(frame.topLeft.height, 18);
  // 18: what the three bottom pieces share, measured up from the frame's own bottom edge.
  assert.equal(frameBottomInset(frame), 18);
  assert.equal(frame.bottomLeft.height, 18);
  assert.equal(frame.bottom.height, 18);
  assert.equal(frame.bottomRight.height, 18);
  // 49 is the two of them: the top strip plus the bottom border.
  assert.equal(frame.topRight.height + frameBottomInset(frame), 49);
  // 7 / 54 / 8: the left corner's, the top-right corner's and the right border's widths.
  assert.equal(frame.topLeft.width, 7);
  assert.equal(frame.topRight.width, 54);
  assert.equal(frame.right.width, 8);
  // 4: the edge fills - 4 wide across the top and bottom, 4 tall down the two sides.
  assert.equal(frame.top.width, 4);
  assert.equal(frame.bottom.width, 4);
  assert.equal(frame.left.height, 4);
  assert.equal(frame.right.height, 4);
});

test("drawUtilFrame stamps exactly what the literal version stamped", () => {
  const { ctx, image, drawn, rects } = recorder();
  drawUtilFrame(ctx, image, 40, 30, 300, 200);

  // The numbers below are the ones the old literal version spelled out; they are recomputed from
  // the constants next to them so a reader can see they are the same arithmetic.
  const body = 13,
    inset = 31,
    bottom = 18;
  assert.equal(body, frameBodyTop(frame));
  assert.equal(inset, frame.topRight.height);
  assert.equal(bottom, frameBottomInset(frame));

  const expected: string[] = [`fill 40,${30 + body},300,${200 - body}`];
  for (let px = 7; px < 300 - 8; px += 4) {
    expected.push(`1@${40 + px},${30 + body}`);
    expected.push(`6@${40 + px},${30 + 200 - bottom}`);
  }
  for (let py = 31; py < 200 - 18; py += 4) {
    expected.push(`3@40,${30 + py}`);
    expected.push(`4@${40 + 300 - 8},${30 + py}`);
  }
  expected.push(`0@40,${30 + body}`);
  expected.push(`2@${40 + 300 - 54},30`);
  expected.push(`5@40,${30 + 200 - bottom}`);
  expected.push(`7@${40 + 300 - 8},${30 + 200 - bottom}`);

  assert.deepEqual(drawn, expected);
  // The two clip rectangles: the body's own box, then the band the side edges tile down.
  assert.deepEqual(rects, [
    `${40 + 7},${30 + body},${300 - 15},${200 - body}`,
    `40,${30 + inset},300,${200 - 49}`,
  ]);
});

test("a short frame clips the side edges to nothing rather than drawing past the bottom", () => {
  // `height - inset - bottom` goes negative on a frame shorter than the two borders; the old code
  // clamped it with `Math.max(0, ...)` and the rewrite must keep that.
  const { ctx, image, rects } = recorder();
  drawUtilFrame(ctx, image, 0, 0, 120, 40);
  assert.equal(rects[1], `0,31,120,0`, "the side-edge band is clamped to zero height");
  assert.ok(rects[1]?.endsWith(",0"));
});

test("the clip earns its keep: a 4px fill cell can overshoot the right border by up to 3px", () => {
  // Unlike the scrollbar trough, where the tiling provably never leaves the bar, the top and
  // bottom fills here tile until their own cell would cross the right border - so on most widths
  // the last cell hangs over it, and the clip is what cuts it off. Worth saying out loud, because
  // "clip the repeats" looks like it could be deleted and it cannot.
  const width = 300;
  let last = 0;
  for (let px = frame.topLeft.width; px < width - frame.right.width; px += frame.top.width)
    last = px;
  assert.equal(last, 291, "the last fill cell starts here");
  assert.equal(last + frame.top.width, 295, "and ends three pixels past the border");
  assert.equal(width - frame.right.width, 292, "where the right border starts");
  assert.ok(
    last + frame.top.width > width - frame.right.width,
    "so the overhang is real, not hypothetical",
  );
  assert.ok(
    last + frame.top.width - (width - frame.right.width) < frame.top.width,
    "and never by as much as a whole cell",
  );
  // The two ends of the top are the two corners; the bottom's are 7 and 8.
  assert.equal(frame.topLeft.width + frame.topRight.width, 61, "7 + 54");
  assert.equal(frame.bottomLeft.width + frame.bottomRight.width, 15, "7 + 8");
});
