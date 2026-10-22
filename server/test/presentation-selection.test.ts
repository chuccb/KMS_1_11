import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_UI,
  CHARACTER_UI,
  LOGIN_CELLS,
  SELECTION_BUTTONS,
  characterSlot,
  worldGaugeClip,
} from "../../client/selection.ts";
import { NEW_CHARACTER_UI, CREATION_BUTTONS } from "../../client/creation.ts";
import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";

test("world and character windows retain native creation coordinates and three slots", () => {
  assert.deepEqual(
    [WORLD_UI.x, WORLD_UI.y, WORLD_UI.width, WORLD_UI.height],
    [250, 89, LOGIN_CELLS["WorldSelect/menu"].width, LOGIN_CELLS["WorldSelect/menu"].height],
  );
  assert.deepEqual(
    [CHARACTER_UI.x, CHARACTER_UI.y, CHARACTER_UI.width, CHARACTER_UI.height],
    [161, 85, LOGIN_CELLS["CharSelect/menu"].width, LOGIN_CELLS["CharSelect/menu"].height],
  );
  assert.deepEqual(
    [0, 1, 2].map((i) => {
      const slot = characterSlot(i);
      assert.ok(slot);
      return slot.feetX;
    }),
    [256, 396, 536],
  );
  assert.equal(characterSlot(3), undefined);
  assert.equal(characterSlot(-1), undefined);
  const first = characterSlot(0);
  assert.ok(first);
  assert.equal(first.feetY, 323);
});
test("selection hit regions match native button controls", () => {
  assert.deepEqual(
    SELECTION_BUTTONS.map(({ x, y, width, height }) => [x, y, width, height]),
    [
      [345, 451, 111, 24],
      [466, 375, 141, 24],
      [466, 407, 141, 24],
      [466, 439, 141, 24],
    ],
  );
});

/**
 * Every size the two selection screens use, measured rather than restated.
 *
 * The old version of this test wrote the numbers out a second time - `[161, 85, 491, 398]` - so
 * it could never fail: the character screen had been one pixel wider than the plate it stamps for
 * as long as it had a number at all, and nothing here noticed. A test that repeats the constant
 * is not a regression; measuring the canvas is.
 */
test(
  "every UI/Login.img size the selection screens use is the canvas Data.wz declares",
  needsArchive,
  () => {
    for (const [path, cell] of Object.entries(LOGIN_CELLS)) {
      // A button strip is a directory of four faces, so its size is the `normal` canvas inside it.
      const declared =
        canvasSize("UI/Login.img", path) ?? canvasSize("UI/Login.img", `${path}/normal/0`);
      assert.equal(declared, `${cell.width}x${cell.height}`, path);
    }
    // The numbers that were wrong, or that nothing checked at all.
    assert.equal(LOGIN_CELLS["CharSelect/menu"].width, 490, "not the 491 the old literal said");
    assert.equal(CHARACTER_UI.width, LOGIN_CELLS["CharSelect/menu"].width);
    assert.equal(CHARACTER_UI.height, LOGIN_CELLS["CharSelect/menu"].height);
    assert.equal(WORLD_UI.width, LOGIN_CELLS["WorldSelect/menu"].width);
    assert.equal(WORLD_UI.height, LOGIN_CELLS["WorldSelect/menu"].height);
    // A world row is the `wsItem` strip, and the rows start under the `wsHeader` above them.
    assert.equal(WORLD_UI.rowWidth, LOGIN_CELLS["WorldSelect/wsItem"].width);
    assert.equal(WORLD_UI.rowHeight, LOGIN_CELLS["WorldSelect/wsItem"].height);
    assert.equal(
      WORLD_UI.rowY,
      WORLD_UI.headerY + LOGIN_CELLS["WorldSelect/wsHeader"].height,
      "199 = 181 + 18",
    );
    // The new-character plate and the name-check button come out of the same table.
    assert.equal(NEW_CHARACTER_UI.width, LOGIN_CELLS["CharSelect/newDlg"].width);
    assert.equal(NEW_CHARACTER_UI.height, LOGIN_CELLS["CharSelect/newDlg"].height);
    assert.equal(CREATION_BUTTONS[0]?.width, LOGIN_CELLS["CharSelect/BtCheckId"].width);
    assert.equal(CREATION_BUTTONS[0]?.height, LOGIN_CELLS["CharSelect/BtCheckId"].height);
  },
);

test("the four selection buttons keep their own places, and BtConnect stays the narrow one", () => {
  assert.deepEqual(
    SELECTION_BUTTONS.map(({ id, stage, x, y, width, height }) => [id, stage, x, y, width, height]),
    [
      ["world-connect", "worlds", 345, 451, 111, 24],
      ["character-enter", "characters", 466, 375, 141, 24],
      ["character-delete", "characters", 466, 407, 141, 24],
      ["character-new", "characters", 466, 439, 141, 24],
    ],
  );
  // The three character buttons are one strip size and BtConnect is another; a tidy-up that
  // folded them into a single constant would silently resize the world screen's button.
  assert.equal(SELECTION_BUTTONS[0]?.width, 111);
  assert.deepEqual(
    SELECTION_BUTTONS.slice(1).map((button) => button.width),
    [141, 141, 141],
  );
  assert.equal(LOGIN_CELLS["CharSelect/BtSelect"].width, LOGIN_CELLS["CharSelect/BtNew"].width);
  assert.notEqual(
    LOGIN_CELLS["WorldSelect/BtConnect"].width,
    LOGIN_CELLS["CharSelect/BtSelect"].width,
  );
});

test("sub_42E0D0's slot rect: 50x70, three of them 140 apart, the first at window-local 70", () => {
  // rc.left = n120 - 50, rc.top = 178, rc.right = n120, rc.bottom = 248; n120 runs 120, 260, 400.
  const slots = [0, 1, 2].map((index) => characterSlot(index));
  assert.deepEqual(
    slots.map((slot) => [slot?.x, slot?.y, slot?.width, slot?.height]),
    [
      [161 + 70, 85 + 178, 50, 70],
      [161 + 210, 85 + 178, 50, 70],
      [161 + 350, 85 + 178, 50, 70],
    ],
  );
  // The loop stops at `n120 >= 540`, and 120 + 3 * 140 is 540 - that is what makes three slots.
  assert.equal(120 + 3 * 140, 540);
  assert.equal(characterSlot(3), undefined);
  assert.equal(characterSlot(-1), undefined);
  assert.equal(characterSlot(0.5), undefined, "sub_42E0D0 indexes by a whole slot");
  // The feet are the slot's own centre x, 10px above its bottom edge.
  assert.deepEqual(
    slots.map((slot) => slot?.feetX),
    [161 + 95, 161 + 235, 161 + 375],
  );
  assert.deepEqual(
    slots.map((slot) => slot?.feetY),
    [85 + 238, 85 + 238, 85 + 238],
    "238 = 178 + 70 - 10",
  );
});

test("sub_54C7B0's gauge clip is the 101x7 wsGauge canvas, cut from its own left edge", () => {
  const gauge = LOGIN_CELLS["WorldSelect/wsGauge"];
  assert.equal(gauge.width, 101);
  assert.equal(gauge.height, 7);
  // A quiet world shows the first level: 5 * (20 - 1) = 95px of the 101 cut off the left.
  assert.deepEqual(worldGaugeClip({ unknownId: 1 }), { x: 95, width: 6, height: 7 });
  // And a full one shows all of it.
  assert.deepEqual(worldGaugeClip({ unknownId: 3000 }), { x: 0, width: 101, height: 7 });
});
