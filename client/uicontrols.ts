/**
 * The shared control sprites: one four-state button face plus the cell sizes `Data.wz` gives them.
 *
 * Every original window builds its buttons out of the same two things, and until now each window
 * wrote both out by hand:
 *
 *  - **The four-state sprite.** `CCtrlButton` carries `normal`, `mouseOver`, `pressed` and
 *    `disabled`, stored in the WZ as `<path>/<face>/0`. Which face is showing is the same
 *    precedence everywhere - a disabled button is disabled whether or not the pointer is on it -
 *    yet the ternary that picks it was copied into a dozen places.
 *  - **The cell's own size.** `sub_4E0FF0` creates the messenger's close button with
 *    `CCtrlButton::Create(this, 1000, 152, 9, 2, &path)` - position and type only, no rectangle -
 *    because a type-2 button takes its rectangle from the sprite. So the size a window hit-tests
 *    is the size in the WZ, which is why these numbers are here rather than next to each window.
 *
 * Everything below was measured out of `Data.wz` (`server/test/ui-controls.test.ts` re-measures it
 * on every run, so a repacked client cannot drift out from under these constants silently).
 *
 * The names say which strip they came from, and each one is repeated by more than one window:
 * `BT_UI_CLOSE` by the equipment, inventory, shop, stat, skill, system-menu and messenger windows,
 * `BT_DIALOG` by the creation, login, revive and system-menu screens, `UTIL_DLG_BUTTON` by the NPC
 * dialogue's own row of buttons.
 */

/** The four faces a `CCtrlButton` sprite carries, in the order the WZ lists them. */
export type UiButtonFace = "normal" | "mouseOver" | "pressed" | "disabled";

/** Every face, in the order a warm pass asks for them. */
export const UI_BUTTON_FACES: readonly UiButtonFace[] = [
  "normal",
  "mouseOver",
  "pressed",
  "disabled",
];

/** One sprite's width and height, the way `Data.wz` declares it. */
export interface UiCell {
  readonly width: number;
  readonly height: number;
}

/**
 * Which face is showing.
 *
 * Disabled wins: a greyed-out button is greyed out whether or not the pointer is over it, and
 * `sub_4E0FF0`'s warm pass asks for `disabled` last precisely because it is the one state a live
 * button never reaches on its own.
 */
export function uiButtonFace(state: {
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly hover?: boolean;
}): UiButtonFace {
  if (state.disabled) return "disabled";
  return state.pressed ? "pressed" : state.hover ? "mouseOver" : "normal";
}

/** `<base>/<face>/0` - the path every one of these strips is stored under. */
export function buttonSprite(base: string, face: UiButtonFace): string {
  return `${base}/${face}/0`;
}

/** All four faces of one button, for a `warm()` pass that only wants what it draws. */
export function buttonSprites(
  base: string,
  faces: readonly UiButtonFace[] = UI_BUTTON_FACES,
): string[] {
  return faces.map((face) => buttonSprite(base, face));
}

/**
 * `UI/UIWindow.img/BtUIClose` and `.../BtUIClose2`, both 32x15 in all four faces. The close
 * button every window shares; `BtUIClose2` is the NPC dialogue's copy, the same size.
 */
export const BT_UI_CLOSE: UiCell = Object.freeze({ width: 32, height: 15 });

/**
 * `UI/Basic.img/BtOK` and `UI/Basic.img/BtCancel`, both 65x24 in all four faces. The two buttons
 * the creation screen, the login dialog, the revive panel and the system menu all stamp.
 */
export const BT_DIALOG: UiCell = Object.freeze({ width: 65, height: 24 });

/** `UI/Basic.img/BtComboBox`, 17x16 in all four faces: the creation screen's dropdown arrow. */
export const BT_COMBO_BOX: UiCell = Object.freeze({ width: 17, height: 16 });

/**
 * `UI/UIWindow.img/UtilDlgEx` and `.../UtilDlgEx2`: `BtOK`, `BtCancel`, `BtClose`, `BtNext`,
 * `BtNo`, `BtPrev` and `BtYes` are all 50x23 in all four faces. The NPC dialogue's button row.
 */
export const UTIL_DLG_BUTTON: UiCell = Object.freeze({ width: 50, height: 23 });

/**
 * `UI/UIWindow.img/GameMenu/BtQuest`, `BtParty`, `BtCommunity`, `BtGameOpt`, `BtSysOpt` and
 * `BtQuit`, all 136x23 in all four faces: the six rows of the system menu's own page.
 */
export const BT_GAME_MENU: UiCell = Object.freeze({ width: 136, height: 23 });

/** `UI/Basic.img/CheckBox`: cells 0..3, 12x12 each. 0 normal, 1 pressed, 2 checked, 3 both. */
export const CHECK_BOX: UiCell = Object.freeze({ width: 12, height: 12 });

/**
 * `UI/Basic.img/Slider`: the two end caps are 3x4, the 1x2 fill stretches between them, and the
 * four thumb faces are 17x16. The system menu's sound sliders are built out of these three, and
 * the thumb is centred by halving its own width (`sliderCenter(...) - 8`).
 */
export const SLIDER: {
  readonly cap: UiCell;
  readonly mid: UiCell;
  readonly thumb: UiCell;
} = Object.freeze({
  cap: Object.freeze({ width: 3, height: 4 }),
  mid: Object.freeze({ width: 1, height: 2 }),
  thumb: Object.freeze({ width: 17, height: 16 }),
});
