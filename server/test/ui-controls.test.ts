/**
 * The shared control sprites - `client/uicontrols.ts`.
 *
 * Two things were copied into a dozen places before this module existed:
 *
 *  - **The four-state face.** Every `CCtrlButton` sprite is stored as `<path>/<face>/0` with
 *    `normal`, `mouseOver`, `pressed` and `disabled`, and the ternary that picks one was spelled
 *    out separately in the equipment, stat, skill, messenger, creation, login, revive, NPC-dialogue
 *    and system-menu windows. They disagreed in two places: the stat window's close button had no
 *    `disabled` arm, and the login screen's title buttons used `!dialogOpen &&` twice instead.
 *  - **The cell's own size.** `sub_4E0FF0` creates the messenger's close button with
 *    `CCtrlButton::Create(this, 1000, 152, 9, 2, &path)` (MapleStory.exe.c:231327, args at :231330-231334) - position and
 *    type only, no rectangle - because a type-2 button takes its rectangle from its sprite. So the
 *    box a window hit-tests is whatever `Data.wz` says the sprite is, and the 32x15 that five
 *    windows each wrote out by hand is `BtUIClose`'s cell, not five independent choices.
 *
 * This file re-measures every one of those cells out of `Data.wz` on each run, so a repacked
 * client cannot drift out from under the constants, and then pins each window's box to them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, cellsOf, needsArchive } from "./helpers/wz-cells.ts";
import {
  BT_COMBO_BOX,
  BT_DIALOG,
  BT_GAME_MENU,
  BT_STATUS_BAR_PAGE,
  BT_STATUS_BAR_WHISPER,
  BT_STATUS_BAR_WIDE,
  BT_UI_CLOSE,
  buttonSprite,
  buttonSprites,
  CHECK_BOX,
  SLIDER,
  uiButtonFace,
  UI_BUTTON_FACES,
  UTIL_DLG_BUTTON,
  type UiButtonFace,
} from "../../client/uicontrols.ts";
import { EQUIP_WINDOW } from "../../client/equipment.ts";
import { INVENTORY } from "../../client/inventory-window.ts";
import { SHOP } from "../../client/shop-window.ts";
import { SKILL_CLOSE } from "../../client/skills.ts";
import { STAT_WINDOW } from "../../client/statwindow.ts";
import { MESSENGER_WINDOW } from "../../client/messenger-state.ts";
import { dialogueButtons } from "../../client/npcdialogue-layout.ts";
import { MESSENGER_BUTTON, STATUS_BAR } from "../../client/hud.ts";

/** Every face of one strip, measured: they are all the same size, or the strip is not shared. */
function allFaces(image: string, strip: string): string[] {
  const cells = cellsOf(image, strip);
  return [...cells.values()];
}

test("the four faces, in the order the client asks for them", () => {
  assert.deepEqual([...UI_BUTTON_FACES], ["normal", "mouseOver", "pressed", "disabled"]);
  // `disabled` is last because it is the one face a live button never reaches on its own.
  assert.deepEqual(
    UI_BUTTON_FACES.map((face) => buttonSprite("UI/Basic.img/BtOK", face)),
    [
      "UI/Basic.img/BtOK/normal/0",
      "UI/Basic.img/BtOK/mouseOver/0",
      "UI/Basic.img/BtOK/pressed/0",
      "UI/Basic.img/BtOK/disabled/0",
    ],
  );
  assert.deepEqual(
    buttonSprites("UI/UIWindow.img/BtUIClose"),
    UI_BUTTON_FACES.map((face) => `UI/UIWindow.img/BtUIClose/${face}/0`),
  );
  // The warm passes that only want three faces ask for the first three.
  assert.equal(buttonSprites("X", ["normal", "mouseOver", "pressed"]).length, 3);
});

test("which face is showing: disabled beats pressed beats hover beats idle", () => {
  assert.equal(uiButtonFace({}), "normal");
  assert.equal(uiButtonFace({ hover: true }), "mouseOver");
  assert.equal(uiButtonFace({ pressed: true }), "pressed");
  assert.equal(uiButtonFace({ disabled: true }), "disabled");
  // The precedence is what the copied ternaries disagreed about.
  assert.equal(uiButtonFace({ disabled: true, pressed: true, hover: true }), "disabled");
  assert.equal(uiButtonFace({ pressed: true, hover: true }), "pressed", "pressed wins over hover");
  assert.equal(
    uiButtonFace({ disabled: false, pressed: false, hover: false }),
    "normal",
    "false is not truthy",
  );
  // A disabled button stays disabled under the pointer: this is the arm the stat window lacked.
  assert.equal(uiButtonFace({ disabled: true, hover: true }), "disabled");
});

test(
  "BtUIClose and BtUIClose2 are 32x15 in every face, which is the box every close button uses",
  needsArchive,
  () => {
    for (const strip of ["BtUIClose", "BtUIClose2"]) {
      const sizes = new Set(allFaces("UI/UIWindow.img", strip));
      assert.equal(sizes.size, 1, `${strip}: one size across the four faces`);
      assert.equal([...sizes][0], `${BT_UI_CLOSE.width}x${BT_UI_CLOSE.height}`);
    }
    assert.equal(BT_UI_CLOSE.width, 32);
    assert.equal(BT_UI_CLOSE.height, 15);
    // sub_4E0FF0's `CCtrlButton::Create(this, 1000, 152, 9, 2, &path)` carries no rectangle, so
    // the sprite IS the box - which is why the same 32x15 is the hit test, not just the art.
    assert.equal(MESSENGER_WINDOW.close.width, BT_UI_CLOSE.width);
    assert.equal(MESSENGER_WINDOW.close.height, BT_UI_CLOSE.height);
  },
);

test("five windows close the same way, off the one constant", () => {
  assert.deepEqual(
    [EQUIP_WINDOW.close, STAT_WINDOW.close].map((box) => [box.w, box.h]),
    [
      [BT_UI_CLOSE.width, BT_UI_CLOSE.height],
      [BT_UI_CLOSE.width, BT_UI_CLOSE.height],
    ],
    "the equipment and the stat window are the same 176x315 plate",
  );
  assert.equal(INVENTORY.close.width, BT_UI_CLOSE.width);
  assert.equal(INVENTORY.close.height, BT_UI_CLOSE.height);
  assert.equal(SHOP.close.width, BT_UI_CLOSE.width);
  assert.equal(SHOP.close.height, BT_UI_CLOSE.height);
  assert.equal(SKILL_CLOSE.width, BT_UI_CLOSE.width);
  assert.equal(SKILL_CLOSE.height, BT_UI_CLOSE.height);
  // The skill window's (128, 9) is the equipment's and the stat window's, on the same plate.
  assert.deepEqual([SKILL_CLOSE.x, SKILL_CLOSE.y], [EQUIP_WINDOW.close.x, EQUIP_WINDOW.close.y]);
  assert.deepEqual([SKILL_CLOSE.x, SKILL_CLOSE.y], [STAT_WINDOW.close.x, STAT_WINDOW.close.y]);
});

test(
  "BtOK and BtCancel are 65x24, BtComboBox 17x16 - the creation and login buttons",
  needsArchive,
  () => {
    for (const strip of ["BtOK", "BtCancel"]) {
      const sizes = new Set(allFaces("UI/Basic.img", strip));
      assert.equal(sizes.size, 1, `${strip}: one size across the four faces`);
      assert.equal([...sizes][0], `${BT_DIALOG.width}x${BT_DIALOG.height}`);
    }
    assert.equal(BT_DIALOG.width, 65);
    assert.equal(BT_DIALOG.height, 24);
    // The combo box's arrow is the one button in the strip that is not a dialog button.
    assert.equal(
      canvasSize("UI/Basic.img", "BtComboBox/normal/0"),
      `${BT_COMBO_BOX.width}x${BT_COMBO_BOX.height}`,
    );
    assert.equal(BT_COMBO_BOX.width, 17);
    assert.equal(BT_COMBO_BOX.height, 16);
  },
);

test(
  "the NPC dialogue's own row: UtilDlgEx(2) buttons are 50x23, the GameMenu rows 136x23",
  needsArchive,
  () => {
    for (const image of ["UI/UIWindow.img", "UI/UIWindow.img"])
      for (const strip of ["UtilDlgEx", "UtilDlgEx2"]) {
        const cells = cellsOf(image, strip);
        const buttons = [...cells.entries()].filter(([path]) => path.startsWith("Bt"));
        assert.ok(buttons.length > 0, `${strip} has buttons`);
        for (const [path, size] of buttons)
          assert.equal(size, `${UTIL_DLG_BUTTON.width}x${UTIL_DLG_BUTTON.height}`, path);
      }
    assert.equal(UTIL_DLG_BUTTON.width, 50);
    assert.equal(UTIL_DLG_BUTTON.height, 23);
    for (const name of ["Quest", "Party", "Community", "GameOpt", "SysOpt", "Quit"])
      assert.equal(
        canvasSize("UI/UIWindow.img", `GameMenu/Bt${name}/normal/0`),
        `${BT_GAME_MENU.width}x${BT_GAME_MENU.height}`,
        name,
      );
    assert.equal(BT_GAME_MENU.width, 136);
    assert.equal(BT_GAME_MENU.height, 23);
  },
);

test("dialogueButtons gives the close button the close cell and the rest the dialog cell", () => {
  const buttons = dialogueButtons(
    { kind: "say", unknownA: false, unknownB: false } as never,
    300,
    200,
  );
  const close = buttons.find((button) => button.key === "close");
  assert.ok(close);
  assert.equal(close.width, BT_UI_CLOSE.width, "the close button wears BtUIClose2");
  assert.equal(close.height, BT_UI_CLOSE.height);
  const rest = buttons.filter((button) => button.key !== "close");
  assert.ok(rest.length > 0, "a say body carries at least its primary button");
  for (const button of rest) {
    assert.equal(button.width, UTIL_DLG_BUTTON.width);
    assert.equal(button.height, UTIL_DLG_BUTTON.height);
  }
});

test(
  "the CheckBox cells are 12x12 and the Slider is a 3x4 cap, a 1x2 fill and a 17x16 thumb",
  needsArchive,
  () => {
    for (let i = 0; i < 4; i++)
      assert.equal(
        canvasSize("UI/Basic.img", `CheckBox/${i}`),
        `${CHECK_BOX.width}x${CHECK_BOX.height}`,
        `cell ${i}`,
      );
    assert.equal(CHECK_BOX.width, 12);
    assert.equal(CHECK_BOX.height, 12);
    assert.equal(canvasSize("UI/Basic.img", "Slider/left"), "3x4");
    assert.equal(canvasSize("UI/Basic.img", "Slider/mid"), "1x2");
    assert.equal(canvasSize("UI/Basic.img", "Slider/right"), "3x4");
    for (const face of ["Normal", "Pressed", "Disabled", "MouseOver"])
      assert.equal(
        canvasSize("UI/Basic.img", `Slider/thumb${face}`),
        `${SLIDER.thumb.width}x${SLIDER.thumb.height}`,
        face,
      );
    assert.equal(SLIDER.cap.width, 3);
    assert.equal(SLIDER.cap.height, 4);
    assert.equal(SLIDER.mid.width, 1);
    assert.equal(SLIDER.mid.height, 2);
    assert.equal(SLIDER.thumb.width, 17);
    assert.equal(SLIDER.thumb.height, 16);
  },
);

test("the slider's three pieces fit the box the way the cell sizes say they must", () => {
  // A SYSTEM MENU sound slider is a 122x16 box: the caps and the fill are both centred in it,
  // which is where the old y+6 and y+7 came from, and the thumb centres by halving its own width.
  const h = 16;
  assert.equal((h - SLIDER.cap.height) / 2, 6, "the 4px caps sit 6 down a 16px box");
  assert.equal((h - SLIDER.mid.height) / 2, 7, "the 2px fill sits 7 down the same box");
  assert.equal(Math.floor(SLIDER.thumb.width / 2), 8, "the 17px thumb is centred by 8");
  // The fill tiles from the left cap's right edge to the right cap's left edge, so the two caps
  // and the fill exactly cover the box with no overlap and no gap.
  const w = 122;
  let tiles = 0;
  for (let dx = SLIDER.cap.width; dx < w - SLIDER.cap.width; dx += SLIDER.mid.width) tiles += 1;
  assert.equal(SLIDER.cap.width * 2 + tiles * SLIDER.mid.width, w);
});

test("a face is one of the four the WZ stores, and nothing else is accepted", () => {
  const faces: UiButtonFace[] = ["normal", "mouseOver", "pressed", "disabled"];
  for (const face of faces) assert.ok(UI_BUTTON_FACES.includes(face));
  assert.equal(UI_BUTTON_FACES.length, 4);
  // The sprite path is `<strip>/<face>/0` - no state ever reaches for `/1`.
  assert.ok(buttonSprite("UI/Basic.img/BtOK", "pressed").endsWith("/pressed/0"));
});

test(
  "the status bar's three sizes are its seven strips' own, and all seven carry four faces",
  needsArchive,
  () => {
    const strips: [string[], { width: number; height: number }][] = [
      [["BtItem", "BtEquip", "BtStat", "BtSkill"], BT_STATUS_BAR_PAGE],
      [["BtChat", "BtMenu"], BT_STATUS_BAR_WIDE],
      [["BtWhisper"], BT_STATUS_BAR_WHISPER],
    ];
    for (const [names, cell] of strips)
      for (const strip of names) {
        const faces = allFaces("UI/StatusBar.img", strip);
        // The preload used to ask for three. Every one of the seven strips has a `disabled`
        // canvas, so a face that is never fetched is a face that pops in late - not a face the
        // archive does not have.
        assert.equal(faces.length, 4, `${strip}: four faces, not three`);
        const sizes = new Set(faces);
        assert.equal(sizes.size, 1, `${strip}: the four faces agree on a size`);
        assert.equal([...sizes][0], `${cell.width}x${cell.height}`, strip);
      }
    assert.equal(`${BT_STATUS_BAR_PAGE.width}x${BT_STATUS_BAR_PAGE.height}`, "36x35");
    assert.equal(`${BT_STATUS_BAR_WIDE.width}x${BT_STATUS_BAR_WIDE.height}`, "38x17");
    assert.equal(`${BT_STATUS_BAR_WHISPER.width}x${BT_STATUS_BAR_WHISPER.height}`, "14x23");

    // sub_4F6B70 gives none of the seven a rectangle, so each box IS the strip it stamps.
    for (const button of STATUS_BAR.buttons)
      assert.equal(
        canvasSize("UI/StatusBar.img", `${button.name}/normal/0`),
        `${button.w}x${button.h}`,
        `${button.name}: the hit box is the sprite`,
      );
    assert.equal(
      canvasSize("UI/StatusBar.img", "BtChat/normal/0"),
      `${MESSENGER_BUTTON.width}x${MESSENGER_BUTTON.height}`,
    );
    // The three sizes are three, not one: a 38x17 menu must not be reshaped into a 14x23 whisper
    // button by anyone tidying these into a single constant later on.
    assert.notEqual(
      `${BT_STATUS_BAR_WIDE.width}x${BT_STATUS_BAR_WIDE.height}`,
      `${BT_STATUS_BAR_WHISPER.width}x${BT_STATUS_BAR_WHISPER.height}`,
    );
  },
);
