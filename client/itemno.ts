/**
 * The one number painter: `sub_525AE0` (`MapleStory.exe.c:298618`).
 *
 * Every count in the UI - the inventory's stack, the shop's stack, the trade room's offer, the
 * quick slot's and the status bar's meso count - is drawn by this one routine, and this module is
 * its single home. Before ADR-123 there were three separate hand-rolled copies of it plus one
 * browser-font impostor, and they did not agree with each other.
 *
 * What `sub_525AE0` does, read off the body:
 *
 *  - `sub_411E50(&v36, "%d", ArgList)` formats the count as a decimal string, then walks it one
 *    character at a time.
 *  - Per character: `itoa_w(*(char *)(v6 + v36) - 48, Buffer)` turns the ASCII digit back into the
 *    number 0..9, and `sub_406EC0(sub_402E20(&lVal), &pvarg, v27)` looks that name up in the
 *    property object passed as the fifth argument - i.e. `UI/Basic.img/ItemNo/{digit}`.
 *  - The glyph canvas is drawn with its **top-left** at the running x and at one shared y, so the
 *    routine is left- and top-anchored, never right- or baseline-anchored.
 *  - `n146 += a6 + v34` - the advance is the glyph's **own width** plus the sixth argument. That
 *    sixth argument is a real, varying spacing: `sub_504480` (`:265177`) passes the literal `1`
 *    (`:265265`, `v21 = 1`), while the inventory, the trade room and the shop all pass 0.
 *
 * The anchors the three window painters hand it are all `(rect.left, rect.bottom - 12)` against a
 * 32px cell, i.e. **(0, +20) from the cell's top-left corner**:
 *
 *  - inventory `sub_4DB240` (`:225635`, call `:225848`) - `sub_4DB990` (`:226041`) sets the cell
 *    rect to `35c + 6, 35r + 80, 35c + 38, 35r + 112`, and the call uses `rect.left` /
 *    `rect.bottom - 12`.
 *  - trade `sub_4D5440` (`:219827`, call `:219951`) - `n146 = 35 * (v2 % 2) + 291`,
 *    `v26 = 35 * (v2 / 2) + 160`, drawn at `(n146, v26 - 12)`.
 *  - shop `sub_4B5FA0` (`:190388`, call `:190691`) - `n110_2 = 209`, y = `n110 + 1`.
 *  - `sub_4FC440` (`:257680`, call `:257831`) - `LODWORD(v36) = v41 + 20`. The `+ 20` again.
 */
import { SLOT_SIZE } from "./slot.ts";
import type { CanvasImage } from "./render-types.ts";

/** The property `sub_525AE0` indexes by digit (`sub_402E20(&lVal)` -> `sub_406EC0`). */
export const ITEM_NO_PATH = "UI/Basic.img/ItemNo";

/**
 * `UI/Basic.img/ItemNo`: ten glyphs, every one 11 px tall. Nine are 8 px wide; `1` is a narrow 5 px
 * one, so a count does **not** advance in even steps - "11" is 10 px wide, "88" is 16 px. That is
 * the original's own quirk, and why the advance has to be per glyph rather than a flat pitch.
 */
export const ITEM_NO_WIDTH: readonly number[] = [8, 5, 8, 8, 8, 8, 8, 8, 8, 8];

/** Every glyph in `UI/Basic.img/ItemNo` is this tall. */
export const ITEM_NO_HEIGHT = 11;

/** The digits of a count, most significant first - `sub_411E50`'s `"%d"`. */
export function itemNoDigits(value: number): number[] {
  return Array.from(String(Math.max(0, Math.trunc(value))), (character) => Number(character));
}

/** What every one of these painters subtracts from the cell's BOTTOM (`rect.bottom - 12`). */
export const ITEM_NO_CELL_RISE = 12;

/**
 * Where a cell puts its count: `rect.bottom - ITEM_NO_CELL_RISE`, which against a SLOT_SIZE-tall
 * cell is 20 px down from its own top edge. Four independent call sites agree (see the module doc),
 * which is what makes this a native constant rather than one we picked.
 */
export const ITEM_NO_CELL_TOP = SLOT_SIZE - ITEM_NO_CELL_RISE;

/** `n146 += a6 + v34`: this glyph's own width, plus the caller's spacing. */
export function itemNoAdvance(digit: number, gap = 0): number {
  return (ITEM_NO_WIDTH[digit] ?? 0) + gap;
}

/**
 * Paint a count the way `sub_525AE0` does.
 *
 * Nothing is drawn until every glyph has loaded: advancing by each glyph's own width means a
 * missing middle digit would slide every digit after it to the wrong x.
 */
export function drawItemNo(
  ctx: CanvasRenderingContext2D,
  image: (path: string) => CanvasImage,
  value: number,
  x: number,
  y: number,
  gap = 0,
): void {
  const glyphs = itemNoDigits(value).map((digit) => ({
    digit,
    art: image(`${ITEM_NO_PATH}/${digit}`),
  }));
  if (!glyphs.every((glyph) => glyph.art.ready)) return;
  let at = x;
  for (const glyph of glyphs) {
    ctx.drawImage(glyph.art.img, at, y);
    at += itemNoAdvance(glyph.digit, gap);
  }
}
