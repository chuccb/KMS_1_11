/**
 * The `UtilDlgEx` window frame: eight border cells that tile into any rectangle.
 *
 * `CUtilDlgEx` (`sub_531110`) draws every dialog - the NPC dialogue, the count box, the drop box -
 * out of the same eight canvases, stored as `UI/UIWindow.img/UtilDlgEx/Border/0..7` (and
 * `UtilDlgEx2/Border/0..7`, the same eight sizes again, for the server's own palette). Each cell
 * carries the index it is stored under, so a painter can ask for `frame.topLeft` and get the right
 * `Border/<n>` without anyone writing the number twice.
 *
 * Every measurement `drawUtilFrame` used to spell out comes out of these eight:
 *
 *  - **13** is `topRight.height - topLeft.height` (31 - 18): the top strip is 31 tall because the
 *    top-right corner is, and the two 18-tall corners are bottom-aligned inside it.
 *  - **7 / 54 / 8** are the left corner's, the top-right corner's and the right border's widths.
 *  - **4** is the edge fill's own width (top and bottom) and height (left and right).
 *  - **18** is the height of the three bottom pieces, and **49** is 31 + 18.
 *
 * `server/test/ui-frame.test.ts` re-measures all eight out of `Data.wz` on every run, so a repacked
 * client cannot drift out from under these numbers, and then re-derives the four offsets above to
 * prove the frame is still built out of them.
 */
import type { UiCell } from "./uicontrols.ts";

/** One border cell: the index it is stored under, plus the size `Data.wz` gives it. */
export interface UiFramePiece extends UiCell {
  /** The `Border/<index>` this piece is stored as. */
  readonly index: number;
}

/**
 * The eight pieces, named by where they sit in the frame.
 *
 * The order is the WZ's: 0 and 5 are the left corners, 2 and 7 the right ones, 1 and 6 the two
 * edge fills that stretch horizontally, 3 and 4 the two that stretch vertically.
 */
export const UTIL_DLG_FRAME: Readonly<{
  topLeft: UiFramePiece;
  top: UiFramePiece;
  topRight: UiFramePiece;
  left: UiFramePiece;
  right: UiFramePiece;
  bottomLeft: UiFramePiece;
  bottom: UiFramePiece;
  bottomRight: UiFramePiece;
}> = Object.freeze({
  /** `Border/0` - 7x18, the body's top-left corner. */
  topLeft: Object.freeze({ index: 0, width: 7, height: 18 }),
  /** `Border/1` - 4x18, the top edge, tiled from the left corner to the right border. */
  top: Object.freeze({ index: 1, width: 4, height: 18 }),
  /** `Border/2` - 54x31, the top-right corner; the tallest piece along the top. */
  topRight: Object.freeze({ index: 2, width: 54, height: 31 }),
  /** `Border/3` - 7x4, the left edge, tiled from the top strip to the bottom border. */
  left: Object.freeze({ index: 3, width: 7, height: 4 }),
  /** `Border/4` - 8x4, the right edge, tiled the same way. */
  right: Object.freeze({ index: 4, width: 8, height: 4 }),
  /** `Border/5` - 7x18, the body's bottom-left corner. */
  bottomLeft: Object.freeze({ index: 5, width: 7, height: 18 }),
  /** `Border/6` - 4x18, the bottom edge, tiled across with the top edge. */
  bottom: Object.freeze({ index: 6, width: 4, height: 18 }),
  /** `Border/7` - 8x18, the bottom-right corner. */
  bottomRight: Object.freeze({ index: 7, width: 8, height: 18 }),
});

export type UiFrame = typeof UTIL_DLG_FRAME;

/**
 * Where the body starts, below the top strip.
 *
 * The top-right corner is 31 tall and the two 18-tall corners are bottom-aligned inside that band,
 * so they are stamped 31 - 18 = 13 down from the frame's own top edge. This is the `13` that used
 * to be spelled out five times in `drawUtilFrame`.
 */
export function frameBodyTop(frame: UiFrame): number {
  return frame.topRight.height - frame.topLeft.height;
}

/**
 * How far the bottom border reaches up from the frame's own bottom edge - the height the three
 * bottom pieces share. This is the `18`.
 */
export function frameBottomInset(frame: UiFrame): number {
  return frame.bottomLeft.height;
}

/** `Border/<index>`, under whichever of the two palettes the caller asked for. */
export function frameSprite(server: boolean, piece: UiFramePiece): string {
  return `UI/UIWindow.img/UtilDlgEx${server ? "2" : ""}/Border/${piece.index}`;
}
