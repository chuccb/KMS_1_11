/**
 * The vertical CCtrlScrollBar the 2003 client reuses for every scrollable list
 * (trade log `sub_4D3EF0` id 1003, messenger log `sub_4E0FF0` id 1002, CUISkill, CUIItem...).
 *
 * EVIDENCE (MapleStory.exe.c / .lst)
 * ---------------------------------------------------------------------------
 * - dword layout (`sub_452130`/`sub_452500`/`sub_4526A0` byte reads): +48 pos, +52 max,
 *   +56 last hit zone, +64 capture, +68 arrow length (the COM art cell height, 12 for
 *   `UI/Basic.img/VScr`), +72 track length (the Create `len`), +84/88/92 drag start pos/X/Y.
 * - `sub_452150` clamps into [0, max - 1] whenever max > 1.
 * - `sub_452500` hit zones over the local `v = y - bar.y`: outside the rect or `max <= 1`
 *   is 100 (nothing acts); `v <= arrow` is 101 (up); `v >= len - arrow` is 102 (down);
 *   thumbTop = arrow + floor(pos * (len - 3*arrow) / (max - 1)); `v < thumbTop` is 103
 *   (page up); `v <= thumbTop + arrow` is 105 (thumb); else 104 (page down).
 * - `sub_4525B0` steps by one (notify 300/301), `sub_452600` pages by
 *   `max(floor(max / 16), 16)` (302/303), `sub_452670` saves the drag start and
 *   `sub_4526A0` moves with `pos = startPos + (double)max * dy / (len - 3*arrow)`
 *   truncated (C double->int) then clamped (notify 304). Note the asymmetry: the drag
 *   scales by **max**, the hit test by **max - 1**.
 * - `sub_4522B0` releases the capture on button up; `sub_452340` wheels by the notch
 *   count while the pointer is inside the control's own rect (PtInRect), even when the
 *   bar is disabled; `sub_4523D0`'s hold-to-repeat timer is NOT reproduced here (the
 *   skills window's scrollbar skips it too) - one press is one step/page.
 * - `sub_4D5900`'s append rule pairs with the state below: `wasBottom` is checked
 *   BEFORE the row count grows, then `max = rows - 15` (16 visible lines), and the view
 *   only follows when it was already at the bottom.
 *
 * `pos === undefined` is the pinned bottom, which is exactly the follow invariant:
 * `settle()` folds `pos >= max - 1` back into `undefined` so an append drags the view
 * down only while it sits at the tail.
 */
import type { ImageLookup } from "./render-types.ts";

/** A created scrollbar: window-local rect, arrow cell height and the whole track length. */
export interface VScrollBarGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** The Create `len`: the full control, arrows included. */
  readonly height: number;
  /** The `UI/Basic.img/VScr` cell edge, 12. */
  readonly arrow: number;
}

/** One of `sub_452500`'s hit zones: 101/102 arrows, 103/104 page, 105 thumb (100 = none). */
export type VScrollZone = "prev" | "next" | "pageUp" | "pageDown" | "thumb";

/** `sub_452600`: a track click pages by `max / 16`, but never less than 16 lines. */
export function vScrollPage(max: number): number {
  return Math.max(16, Math.floor(max / 16));
}

/**
 * The scrollbar state machine. `rowCapacity` is how many wrapped lines the owning list
 * paints at once (16 for both the trade and the messenger log: `sub_4D5730`'s
 * `for (y = 26; y < 234; y += 13)` and `sub_4E1320`'s `for (i = 63; i < 271; i += 13)`),
 * so `max = max(1, rows - (rowCapacity - 1))`.
 */
export function vScrollScroller(bar: VScrollBarGeometry, rowCapacity = 16) {
  let rows = 0,
    max = 1,
    pos: number | undefined,
    drag: { startY: number; startPos: number } | undefined,
    pressed: VScrollZone | undefined;
  const here = () => (pos === undefined ? Math.max(0, max - 1) : pos);
  const settle = (value: number) => {
    const p = Math.max(0, Math.min(max - 1, value));
    pos = p >= max - 1 ? undefined : p;
  };
  const self = {
    get rows() {
      return rows;
    },
    get max() {
      return max;
    },
    /** `*(this[58] + 48)`: the first visible wrapped row. */
    get pos() {
      return here();
    },
    get pinnedBottom() {
      return pos === undefined;
    },
    get dragging() {
      return drag !== undefined;
    },
    get pressed() {
      return pressed;
    },
    /** `sub_452500`'s thumb top, relative to the bar's own top. */
    thumbTop(): number {
      if (max <= 1) return bar.arrow;
      return bar.arrow + Math.floor((here() * (bar.height - 3 * bar.arrow)) / (max - 1));
    },
    reset() {
      rows = 0;
      max = 1;
      pos = drag = pressed = undefined;
    },
    /** `sub_4D5900`: resize, then follow to the bottom only if already there. */
    sync(rowCount: number) {
      const wasBottom = pos === undefined || pos >= max - 1;
      rows = rowCount;
      max = Math.max(1, rowCount - (rowCapacity - 1));
      if (wasBottom) pos = undefined;
      else if (pos !== undefined) pos = Math.max(0, Math.min(max - 1, pos));
    },
    /** `sub_452500` in window-local coordinates; undefined = zone 100 (nothing acts). */
    hit(x: number, y: number): VScrollZone | undefined {
      if (max <= 1 || x < bar.x || x >= bar.x + bar.width || y < bar.y || y >= bar.y + bar.height)
        return undefined;
      const v = y - bar.y;
      if (v <= bar.arrow) return "prev";
      if (v >= bar.height - bar.arrow) return "next";
      const thumb = self.thumbTop();
      if (v < thumb) return "pageUp";
      if (v <= thumb + bar.arrow) return "thumb";
      return "pageDown";
    },
    /** The wheel acts over the whole control rect (`sub_452340`'s PtInRect), even disabled. */
    inBar(x: number, y: number): boolean {
      return x >= bar.x && x < bar.x + bar.width && y >= bar.y && y < bar.y + bar.height;
    },
    /** `sub_4521E0`: the button-down action of one zone. */
    activate(zone: VScrollZone, y: number) {
      if (max <= 1) return;
      pressed = zone;
      if (zone === "prev") self.by(-1);
      else if (zone === "next") self.by(1);
      else if (zone === "pageUp") self.by(-vScrollPage(max));
      else if (zone === "pageDown") self.by(vScrollPage(max));
      else drag = { startY: y, startPos: here() };
    },
    /** `sub_4526A0`: `pos = startPos + max * dy / (track - 3*arrow)`, truncated then clamped. */
    moveTo(y: number) {
      if (drag === undefined || max <= 1) return;
      settle(Math.trunc(drag.startPos + (max * (y - drag.startY)) / (bar.height - 3 * bar.arrow)));
    },
    /** `sub_4525B0`: arrows and the wheel step the position, clamped by `sub_452150`. */
    by(delta: number) {
      if (max <= 1) return;
      settle(here() + delta);
    },
    /** `sub_4522B0`: release ends the drag and the pressed art. */
    end() {
      drag = undefined;
      pressed = undefined;
    },
  };
  return self;
}
export type VScroll = ReturnType<typeof vScrollScroller>;

/**
 * The `UI/Basic.img/VScr` cells at the control's rect: `prev` on top, `base` tiles down
 * the track, `next` at the bottom and - while `max = rows - (capacity - 1) > 1` - the
 * thumb at `sub_452500`'s position. `prev1`/`next1`/`thumb1` are the pressed/drag cells.
 */
export function paintVScrollbar(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  at: { x: number; y: number },
  bar: VScrollBarGeometry,
  scroll: VScroll,
) {
  const enabled = scroll.max > 1,
    prefix = `UI/Basic.img/VScr/${enabled ? "enabled" : "disabled"}`;
  const stamp = (name: string, y: number) => {
    const art = image(`${prefix}/${name}`);
    if (art.ready) ctx.drawImage(art.img, at.x + bar.x, at.y + y);
  };
  stamp(enabled && scroll.pressed === "prev" ? "prev1" : enabled ? "prev0" : "prev", bar.y);
  for (let y = bar.y + bar.arrow; y < bar.y + bar.height - bar.arrow; y += bar.arrow)
    stamp("base", y);
  stamp(
    enabled && scroll.pressed === "next" ? "next1" : enabled ? "next0" : "next",
    bar.y + bar.height - bar.arrow,
  );
  if (enabled) stamp(scroll.dragging ? "thumb1" : "thumb0", bar.y + scroll.thumbTop());
}
