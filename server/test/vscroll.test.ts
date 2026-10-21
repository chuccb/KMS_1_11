/** The shared CCtrlScrollBar state machine, cross-checked against sub_4521E0/4523D0/4524C0/4522B0. */
import test from "node:test";
import assert from "node:assert/strict";
import { INVENTORY } from "../../client/inventory-window.ts";
import { drawDialogueScrollbar } from "../../client/npcdialogue.ts";
import { MESSENGER_WINDOW } from "../../client/messenger-state.ts";
import { SHOP } from "../../client/shop-window.ts";
import { SKILL_SCROLLBAR } from "../../client/skills.ts";
import { TRADE_WINDOW } from "../../client/trade-state.ts";
import {
  paintVScrollbar,
  REPEAT_MS,
  vScrollPage,
  vScrollScroller,
  type VScrollBarGeometry,
  type VScrollPaint,
} from "../../client/vscroll.ts";

/** The messenger log's bar: 12px arrows, 218px track (sub_4E0FF0's Create at {179,58,12,218}). */
const bar = () => vScrollScroller({ x: 179, y: 58, width: 12, height: 218, arrow: 12 });
const local = (y: number) => ({ x: 184, y: 58 + y });

/** Every CCtrlScrollBar in the client, named by the window that creates it. */
const BARS: [string, VScrollBarGeometry][] = [
  ["trade", TRADE_WINDOW.scrollbar],
  ["messenger", MESSENGER_WINDOW.scrollbar],
  ["skill", SKILL_SCROLLBAR],
  ["shop buy", SHOP.scrollbar.buy],
  ["shop sell", SHOP.scrollbar.sell],
  ["inventory", INVENTORY.scrollbar],
];

/** Paint a bar and report the bare cell names, in the order they hit the canvas. */
function cells(bar: VScrollBarGeometry, paint: VScrollPaint): string[] {
  const drawn: string[] = [];
  const ctx = {
    drawImage(image: unknown) {
      drawn.push(String(image));
    },
  } as unknown as CanvasRenderingContext2D;
  const image = (path: string) => ({ ready: true, img: path as unknown as CanvasImageSource });
  paintVScrollbar(ctx, image, { x: 0, y: 0 }, bar, paint);
  return drawn.map((path) => path.replace("UI/Basic.img/VScr/", ""));
}

test("a held arrow repeats once per 50 ms while the cursor stays in the zone", () => {
  const scroll = bar();
  scroll.sync(60); // max = 60 - 15 = 45
  assert.equal(scroll.max, 45);
  scroll.by(-(scroll.max - 1)); // the fresh list is pinned at the bottom; walk to the top first

  // sub_4521E0: the press acts once immediately and stamps +56 zone / +60 tick.
  scroll.activate("next", local(210).y, 1000);
  assert.equal(scroll.pos, 1);

  // sub_4524C0's gate: `TickCount - lastAct > 0x32` - 20 ms is not enough...
  scroll.tick(1020, 184, 58 + 210);
  assert.equal(scroll.pos, 1);
  // ...51 ms is, and each act restamps, so the cadence is one step per gate window.
  scroll.tick(1051, 184, 58 + 210);
  assert.equal(scroll.pos, 2);
  scroll.tick(1060, 184, 58 + 210);
  assert.equal(scroll.pos, 2, "the gate restamps per act, not per press");
  scroll.tick(1102, 184, 58 + 210);
  assert.equal(scroll.pos, 3);
  assert.equal(REPEAT_MS, 50);
});

test("leaving the pressed zone stops the repeat (sub_4523D0 re-hits the live cursor)", () => {
  const scroll = bar();
  scroll.sync(60); // the view starts pinned at the bottom: here() = max - 1 = 44
  scroll.activate("prev", local(4).y, 100);
  assert.equal(scroll.pos, 43);
  // The cursor drifted onto the track (a page zone): zone != pressed, so nothing repeats.
  scroll.tick(200, 184, 58 + 100);
  assert.equal(scroll.pos, 43);
  // Back on the arrow, the repeat resumes.
  scroll.tick(200, 184, 58 + 4);
  assert.equal(scroll.pos, 42);
});

test("a held track click repeats whole pages, and the thumb never repeats", () => {
  const scroll = bar();
  scroll.sync(60); // max 45 -> sub_452600 pages by max(floor(45/16), 16) = 16
  assert.equal(vScrollPage(45), 16);
  scroll.by(-(scroll.max - 1)); // start from the top so the pages have room to walk down
  // v = 200 stays a pageDown hit for every position the repeats walk through (the thumb
  // top reaches 194 only at the very bottom, and the next arrow starts at 206).
  scroll.activate("pageDown", local(200).y, 0);
  assert.equal(scroll.pos, 16);
  scroll.tick(51, 184, 58 + 200);
  assert.equal(scroll.pos, 32);
  scroll.tick(102, 184, 58 + 200);
  assert.equal(scroll.pos, 44, "clamped to max - 1");

  // sub_4524C0 excludes zones 100 and 105: a held thumb drag never auto-repeats.
  const other = bar();
  other.sync(60);
  other.activate("thumb", local(60).y, 0);
  assert.equal(other.dragging, true);
  const held = other.pos;
  other.tick(1000, 184, 58 + 60);
  assert.equal(other.pos, held, "the thumb only moves through moveTo");
});

test("release acts on nothing - the original's release-page compare is dead code", () => {
  const scroll = bar();
  scroll.sync(60);
  scroll.activate("pageDown", local(150).y, 0);
  const pos = scroll.pos;
  // sub_4522B0 compares [esi+3Ch] (the press TICKCOUNT) against the release zone, which can
  // never be equal: the page-flip-on-release path never runs. Only capture/press clear.
  scroll.end();
  assert.equal(scroll.pos, pos);
  assert.equal(scroll.pressed, undefined);
  assert.equal(scroll.dragging, false);
});

test("a bar with max <= 1 neither acts nor repeats", () => {
  const scroll = bar();
  scroll.sync(10); // max = 1
  scroll.activate("next", local(210).y, 0);
  assert.equal(scroll.pressed, undefined);
  scroll.tick(1000, 184, 58 + 210);
  assert.equal(scroll.pos, 0);
});

test("a scroller carries exactly the two numbers the painter reads (VScrollPaint)", () => {
  const scroll = bar();
  scroll.sync(60); // max = 60 - 15 = 45, and a fresh list is pinned at the bottom
  // Structural: the shop and the inventory keep a row index instead of a CCtrlScrollBar, so the
  // painter takes the two numbers rather than the scroller, and a live one satisfies it as-is.
  const paint: VScrollPaint = scroll;
  assert.equal(paint.max, scroll.max);
  assert.equal(paint.offset, scroll.thumbTop() - 12);
  assert.equal(paint.offset, 182, "pinned at the bottom, the thumb has run the whole 218 - 36");
  scroll.by(-(scroll.max - 1));
  assert.equal(paint.offset, 0, "and at the top it is flush under the prev cap");
  assert.equal(paint.pressed, undefined);
  assert.equal(paint.dragging, false);
});

test("one painter draws all six CCtrlScrollBars, and every one of them declares its cap", () => {
  for (const [name, bar] of BARS) {
    assert.equal(bar.arrow, 12, `${name}'s cap is the 12px VScr cell`);
    assert.ok(Number.isFinite(bar.arrow), `${name} has an arrow: without one the thumb is NaN`);
    let tiles = 0;
    for (let y = bar.arrow; y < bar.height - bar.arrow; y += bar.arrow) tiles += 1;
    const trough = (prefix: string) => Array.from({ length: tiles }, () => `${prefix}/base`);
    assert.deepEqual(
      cells(bar, { max: 45, offset: 30, dragging: true }),
      ["enabled/prev0", ...trough("enabled"), "enabled/next0", "enabled/thumb1"],
      `${name}: an overflowing list, dragged`,
    );
    // `max <= 1` is a list that fits: the plain caps and no thumb at all.
    assert.deepEqual(
      cells(bar, { max: 1, offset: 0 }),
      ["disabled/prev", ...trough("disabled"), "disabled/next"],
      `${name}: a list that fits`,
    );
    // sub_4521E0's held face, which the trade window is the only one to reach.
    assert.deepEqual(
      cells(bar, { max: 45, offset: 0, pressed: "next" }),
      ["enabled/prev0", ...trough("enabled"), "enabled/next1", "enabled/thumb0"],
      `${name}: the next arrow held down`,
    );
  }
});

test("the NPC dialogue's bar is the seventh CCtrlScrollBar, drawn by the same painter", () => {
  // The dialogue keeps its position as a count of 8px steps, not as a scroller, so it hands the
  // painter the two numbers: `max` is one more than `maxScroll` (the native `SetMax`), and `offset`
  // is `sub_452500`'s `floor(pos * travel / (max - 1))` - the dialogue used to round it.
  const layout = {
    textX: 11,
    textY: 36,
    textWidth: 254,
    visibleHeight: 240,
    maxScroll: 8,
    scroll: 3,
  };
  const drawn: { image: string; x: number; y: number }[] = [];
  const ctx = {
    drawImage(image: unknown, x: number, y: number) {
      drawn.push({ image: String(image), x, y });
    },
  } as unknown as CanvasRenderingContext2D;
  const image = (path: string) => ({ ready: true, img: path as unknown as CanvasImageSource });
  drawDialogueScrollbar(ctx, image, { x: 100, y: 50 }, layout, true);

  const bar = { x: 100 + layout.textX + layout.textWidth, y: 50 + layout.textY };
  const travel = layout.visibleHeight - 36;
  assert.equal(bar.x, 365, "the bar hangs off the text field's right edge");
  let tiles = 0;
  for (let y = 12; y < layout.visibleHeight - 12; y += 12) tiles += 1;
  const trough = Array.from({ length: tiles }, () => "UI/Basic.img/VScr/enabled/base");
  assert.deepEqual(
    drawn.map((entry) => entry.image),
    [
      "UI/Basic.img/VScr/enabled/prev0",
      ...trough,
      "UI/Basic.img/VScr/enabled/next0",
      "UI/Basic.img/VScr/enabled/thumb1",
    ],
    "prev, a tiled trough, next, and the dragged thumb",
  );
  assert.equal(drawn[0]?.y, bar.y);
  assert.equal(drawn.at(-2)?.y, bar.y + layout.visibleHeight - 12);
  // 204 * 3 / 8 = 76.5 -> the native truncates to 76; rounding gave 77.
  assert.equal((travel * 3) / 8, 76.5);
  assert.equal(drawn.at(-1)?.y, bar.y + 12 + 76);
  for (const entry of drawn) assert.equal(entry.x, bar.x, "the bar is one cell wide");
});
