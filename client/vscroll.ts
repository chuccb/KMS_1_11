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
 *   bar is disabled.
 * - Hold-to-repeat (`sub_4523D0`, the control's OnTimer, vftable[0]): every UI tick, while
 *   the capture is down and `max > 1`, the cursor zone is re-hit from GetCursorPos and the
 *   pressed zone's action repeats iff the cursor is STILL in that zone and `sub_4524C0`'s
 *   gate passes - zone not 100/105 (arrows and pages repeat, the thumb never does) and
 *   `GetTickCount() - +60 > 0x32`, i.e. one repeat per **50 ms** (+60 restamped per act;
 *   press itself stamps +56 zone / +60 tick after acting once). Release (`sub_4522B0`)
 *   re-hits the zone and its page branches compare **[esi+3Ch] - the press TICKCOUNT -
 *   against the release zone**, which is never equal in practice: the original's
 *   release-acts-again page path is dead code, so release only ends the thumb drag.
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
  /** The `UI/Basic.img/VScr` cell edge - see {@link VSCR_CELL}. */
  readonly arrow: number;
}

/**
 * The `UI/Basic.img/VScr` cell edge in px - the one measurement the whole strip is built from.
 *
 * Every cell in the sheet is 12x12: `enabled/{prev0,prev1,next0,next1,base,thumb0,thumb1}` and
 * `disabled/{prev,next,base}`. The EXE carries no `VScr` string of its own - the names reach
 * `CCtrlScrollBar` through `sub_4591A0` - so `bun tools/wz.ts dump "UI/Basic.img"` is the only
 * oracle, and it reports `Canvas 12x12` for all ten cells. Being square, that one number is at
 * once the bar's width, both end caps, the thumb, and the pitch the trough tiles at.
 */
export const VSCR_CELL = 12;

/**
 * How far the thumb may travel: the track less the two end caps and the thumb itself.
 *
 * All three are one {@link VSCR_CELL} tall, hence `height - 3 * VSCR_CELL` - the `height - 36`
 * the inventory and shop sheets and the NPC dialogue have always written out longhand.
 */
export function vScrollTravel(height: number, arrow: number = VSCR_CELL): number {
  return height - 3 * arrow;
}

/** One of `sub_452500`'s hit zones: 101/102 arrows, 103/104 page, 105 thumb (100 = none). */
export type VScrollZone = "prev" | "next" | "pageUp" | "pageDown" | "thumb";

/** `sub_4524C0`'s gate: a held arrow/page repeats at most once per 50 ms. */
export const REPEAT_MS = 50;

/** `sub_452600`: a track click pages by `max / 16`, but never less than 16 lines. */
export function vScrollPage(max: number): number {
  return Math.max(16, Math.floor(max / 16));
}

/**
 * The held-arrow cadence on its own: `sub_4521E0` pressing, `sub_4523D0`'s timer re-hitting the
 * live cursor, `sub_4524C0`'s 50 ms gate and `sub_4522B0` releasing - with none of the position
 * handling, so a window that keeps its own row index can share the one implementation.
 *
 * The shop, the inventory and the NPC dialogue do exactly that: `sub_4B6EC0` and `sub_4DA810`
 * store a plain integer, not a `CCtrlScrollBar`, so until now only the trade, messenger and skill
 * windows had a held arrow at all. `vScrollScroller` below owns one of these too.
 *
 * `tick` takes the zone under the cursor *now*, never the one the press started in: the original
 * re-hits from `GetCursorPos` every tick, so drifting off the arrow stops the repeat and drifting
 * back resumes it, and the press itself is not cleared until `release`.
 */
export function pressRepeat(repeatMs: number = REPEAT_MS) {
  let zone: VScrollZone | undefined,
    lastAct = 0;
  const self = {
    /** The zone the pointer went down in, and the face the bar is drawn with. */
    get zone() {
      return zone;
    },
    /** `sub_4521E0`: button-down. The press acts once immediately - the caller does the acting. */
    press(at: VScrollZone, now = 0): void {
      zone = at;
      lastAct = now;
    },
    /**
     * `sub_4523D0` + `sub_4524C0`: one UI tick while the capture is down. Returns whether the
     * pressed zone should act again; the gate restamps per act, so the cadence is one per window.
     */
    tick(now: number, at: VScrollZone | undefined): boolean {
      if (zone === undefined || at !== zone) return false;
      if (now - lastAct <= repeatMs) return false;
      lastAct = now;
      return true;
    },
    /** `sub_4522B0`: release drops the pressed art and stops the repeat. */
    release(): void {
      zone = undefined;
      lastAct = 0;
    },
  };
  return self;
}
export type PressRepeat = ReturnType<typeof pressRepeat>;

/**
 * The scrollbar state machine. `rowCapacity` is how many wrapped lines the owning list
 * paints at once (16 for both the trade and the messenger log: `sub_4D5730`'s
 * `for (y = 26; y < 234; y += 13)` and `sub_4E1320`'s `for (i = 63; i < 271; i += 13)`),
 * so `max = max(1, rows - (rowCapacity - 1))`.
 */
export function vScrollScroller(bar: VScrollBarGeometry, rowCapacity = 16) {
  const repeat = pressRepeat();
  let rows = 0,
    max = 1,
    pos: number | undefined,
    drag: { startY: number; startPos: number } | undefined;
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
      return repeat.zone;
    },
    /** `sub_452500`'s thumb top, relative to the bar's own top. */
    thumbTop(): number {
      if (max <= 1) return bar.arrow;
      return bar.arrow + Math.floor((here() * vScrollTravel(bar.height, bar.arrow)) / (max - 1));
    },
    /**
     * `sub_452500`'s travel term alone: how far the thumb has moved down the trough, so that
     * `paintVScrollbar` never has to know what an arrow is. This is the one number a caller that
     * keeps its own row state (the shop, the inventory) has to hand over.
     */
    get offset(): number {
      return self.thumbTop() - bar.arrow;
    },
    reset() {
      rows = 0;
      max = 1;
      pos = drag = undefined;
      repeat.release();
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
    /** `sub_4521E0`: the button-down action of one zone, stamping +56/+60. */
    activate(zone: VScrollZone, y: number, now = 0) {
      if (max <= 1) return;
      repeat.press(zone, now);
      if (zone === "prev") self.by(-1);
      else if (zone === "next") self.by(1);
      else if (zone === "pageUp") self.by(-vScrollPage(max));
      else if (zone === "pageDown") self.by(vScrollPage(max));
      else drag = { startY: y, startPos: here() };
    },
    /**
     * `sub_4523D0` + `sub_4524C0`: one UI tick while the capture is down. The zone is
     * re-hit from the live cursor, so dragging the pointer out of the pressed zone stops
     * the repeat; the 50 ms gate makes the cadence, and the thumb never repeats.
     */
    tick(now: number, x: number, y: number) {
      if (max <= 1 || repeat.zone === "thumb") return;
      if (!repeat.tick(now, self.hit(x, y))) return;
      const zone = repeat.zone;
      if (zone === "prev") self.by(-1);
      else if (zone === "next") self.by(1);
      else if (zone === "pageUp") self.by(-vScrollPage(max));
      else self.by(vScrollPage(max));
    },
    /** `sub_4526A0`: `pos = startPos + max * dy / (track - 3*arrow)`, truncated then clamped. */
    moveTo(y: number) {
      if (drag === undefined || max <= 1) return;
      const travel = vScrollTravel(bar.height, bar.arrow);
      settle(Math.trunc(drag.startPos + (max * (y - drag.startY)) / travel));
    },
    /** `sub_4525B0`: arrows and the wheel step the position, clamped by `sub_452150`. */
    by(delta: number) {
      if (max <= 1) return;
      settle(here() + delta);
    },
    /**
     * `sub_4522B0`: release ends the drag and the pressed art. Its page-zone branches
     * compare the press tickcount against the release zone and can never fire (dead code
     * in the original), so nothing acts on release - faithfully.
     */
    end() {
      drag = undefined;
      repeat.release();
    },
  };
  return self;
}
export type VScroll = ReturnType<typeof vScrollScroller>;

/**
 * The two numbers plus the two bits of state {@link paintVScrollbar} reads.
 *
 * A {@link VScroll} satisfies this as it stands, which is why the trade, messenger and skill
 * windows can hand their scroller straight over. The shop and the inventory do not use a
 * {@link VScroll} at all - they keep the row index themselves, because `sub_4DA810`/`sub_4DA8B0`
 * and `sub_4B6EC0` store one integer per side and per tab, not a `CCtrlScrollBar` - so they
 * hand the same two numbers over by hand instead.
 *
 * `max` is the native `SetMax`, `rows - (capacity - 1)`, so at most 1 means a list that fits and
 * the bar is drawn from the `disabled` cells. Callers that count "rows past the visible ones"
 * instead (`rows - capacity`) have to add the one back.
 */
export interface VScrollPaint {
  /** The native `SetMax`; at most 1 draws the disabled cells and no thumb. */
  readonly max: number;
  /** `sub_452500`'s `floor(pos * travel / (max - 1))`: how far the thumb has slid. */
  readonly offset: number;
  /** `sub_4521E0`: the zone the pointer is holding down, for the `prev1`/`next1` art. */
  readonly pressed?: VScrollZone | undefined;
  /** `sub_4526A0`: the thumb is being dragged, for `thumb1`. */
  readonly dragging?: boolean;
}

/**
 * The `UI/Basic.img/VScr` cells at the control's rect: `prev` on top, `base` tiles down
 * the track, `next` at the bottom and - while `max = rows - (capacity - 1) > 1` - the
 * thumb at `sub_452500`'s position. `prev1`/`next1`/`thumb1` are the pressed/drag cells.
 *
 * The trough is tiled from `arrow` while `< height - arrow`, so the three windows whose bar
 * height is not a whole number of cells (the shop's 207 and 174) leave a few pixels of sheet
 * under the `next` cap - the same thing `sub_452500`'s own loop does, which is why no clip is
 * set: the cells never leave the bar's rectangle in the first place.
 */
export function paintVScrollbar(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  at: { x: number; y: number },
  bar: VScrollBarGeometry,
  paint: VScrollPaint,
) {
  const enabled = paint.max > 1,
    prefix = `UI/Basic.img/VScr/${enabled ? "enabled" : "disabled"}`;
  const stamp = (name: string, y: number) => {
    const art = image(`${prefix}/${name}`);
    if (art.ready) ctx.drawImage(art.img, at.x + bar.x, at.y + y);
  };
  stamp(enabled && paint.pressed === "prev" ? "prev1" : enabled ? "prev0" : "prev", bar.y);
  for (let y = bar.y + bar.arrow; y < bar.y + bar.height - bar.arrow; y += bar.arrow)
    stamp("base", y);
  stamp(
    enabled && paint.pressed === "next" ? "next1" : enabled ? "next0" : "next",
    bar.y + bar.height - bar.arrow,
  );
  if (enabled) stamp(paint.dragging ? "thumb1" : "thumb0", bar.y + bar.arrow + paint.offset);
}
