/** The shared CCtrlScrollBar state machine, cross-checked against sub_4521E0/4523D0/4524C0/4522B0. */
import test from "node:test";
import assert from "node:assert/strict";
import { REPEAT_MS, vScrollPage, vScrollScroller } from "../../client/vscroll.ts";

/** The messenger log's bar: 12px arrows, 218px track (sub_4E0FF0's Create at {179,58,12,218}). */
const bar = () => vScrollScroller({ x: 179, y: 58, width: 12, height: 218, arrow: 12 });
const local = (y: number) => ({ x: 184, y: 58 + y });

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
