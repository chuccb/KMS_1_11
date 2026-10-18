import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_UI,
  CHARACTER_UI,
  SELECTION_BUTTONS,
  characterSlot,
} from "../../client/selection.ts";

test("world and character windows retain native creation coordinates and three slots", () => {
  assert.deepEqual([WORLD_UI.x, WORLD_UI.y, WORLD_UI.width, WORLD_UI.height], [250, 89, 305, 403]);
  assert.deepEqual(
    [CHARACTER_UI.x, CHARACTER_UI.y, CHARACTER_UI.width, CHARACTER_UI.height],
    [161, 85, 491, 398],
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
