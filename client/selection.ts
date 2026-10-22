/** Original CUIs: sub_545450 (windows), sub_54C7B0/54D480 (world rows),
 * sub_42CFE0 (buttons), sub_42E0D0/42E2C0 (three character slots). */

/**
 * Every canvas `UI/Login.img` gives the two selection screens, each next to the path it is.
 *
 * `server/test/presentation-selection.test.ts` re-measures all of them out of `Data.wz` on every
 * run, so a repacked client cannot drift out from under these numbers silently. That matters here
 * more than anywhere else because neither window ever uses a rectangle of its own: `sub_545450`
 * is handed the window's position and the `menu` plate's own size *is* the window, so the plate is
 * the only place the size was ever written down - and quoting it a second time by hand is how the
 * character screen came to say 491 for a 490-wide plate.
 */
export const LOGIN_CELLS = Object.freeze({
  "WorldSelect/menu": Object.freeze({ width: 305, height: 403 }),
  "CharSelect/menu": Object.freeze({ width: 490, height: 398 }),
  "CharSelect/newDlg": Object.freeze({ width: 260, height: 424 }),
  "WorldSelect/wsHeader": Object.freeze({ width: 240, height: 18 }),
  "WorldSelect/wsItem": Object.freeze({ width: 240, height: 25 }),
  "WorldSelect/wsIcon": Object.freeze({ width: 16, height: 19 }),
  "WorldSelect/wsGauge": Object.freeze({ width: 101, height: 7 }),
  "WorldSelect/BtConnect": Object.freeze({ width: 111, height: 24 }),
  "CharSelect/BtSelect": Object.freeze({ width: 141, height: 24 }),
  "CharSelect/BtDelete": Object.freeze({ width: 141, height: 24 }),
  "CharSelect/BtNew": Object.freeze({ width: 141, height: 24 }),
  "CharSelect/BtCheckId": Object.freeze({ width: 43, height: 16 }),
} satisfies Record<string, { readonly width: number; readonly height: number }>);

/** One shorthand, since the login screens only ever ask for `UI/Login.img`. */
const cell = (path: keyof typeof LOGIN_CELLS) => LOGIN_CELLS[path];

const WORLD_HEADER_Y = 181;

export const WORLD_UI = {
  x: 250,
  y: 89,
  width: cell("WorldSelect/menu").width,
  height: cell("WorldSelect/menu").height,
  rowX: 24,
  // `wsItem` rows start directly under the `wsHeader` strip the painter stamps above them.
  rowY: WORLD_HEADER_Y + cell("WorldSelect/wsHeader").height,
  headerY: WORLD_HEADER_Y,
  rowWidth: cell("WorldSelect/wsItem").width,
  rowHeight: cell("WorldSelect/wsItem").height,
  visibleRows: 6,
};
/** No `feetX`/`feetY`/`spacing` here: `characterSlot()` works those out from `CHARACTER_SLOT`. */
export const CHARACTER_UI = {
  x: 161,
  y: 85,
  width: cell("CharSelect/menu").width,
  height: cell("CharSelect/menu").height,
  slots: 3,
};

/**
 * `sub_42E0D0` (`:54643`) is the whole of the character slot hit test, and it gives every one of
 * these numbers: `rc.left = n120 - 50`, `rc.top = 178`, `rc.right = n120`, `rc.bottom = 248`,
 * starting at `n120 = 120` and stepping `n120 += 140` while `n120 < 540`. So a slot is **50x70**,
 * the pitch is **140**, the first one's left edge is 120 - 50 = **70**, and the loop's own
 * `540` is what makes three of them (120 + 3 * 140).
 *
 * The avatar's feet are the slot's own centre x - `70 + 50 / 2 = 95`, which is the `feetX` the
 * old literal spelled out - sitting `footRise` above the slot's bottom edge rather than on it.
 */
const CHARACTER_SLOT = Object.freeze({
  width: 50,
  height: 70,
  pitch: 140,
  top: 178,
  /** `rc.right` of the first slot - the `n120 = 120` the loop starts from. */
  firstRight: 120,
  footRise: 10,
});

export const SELECTION_BUTTONS = [
  {
    id: "world-connect",
    stage: "worlds",
    path: "UI/Login.img/WorldSelect/BtConnect",
    x: 345,
    y: 451,
    width: cell("WorldSelect/BtConnect").width,
    height: cell("WorldSelect/BtConnect").height,
  },
  {
    id: "character-enter",
    stage: "characters",
    path: "UI/Login.img/CharSelect/BtSelect",
    x: 466,
    y: 375,
    width: cell("CharSelect/BtSelect").width,
    height: cell("CharSelect/BtSelect").height,
  },
  {
    id: "character-delete",
    stage: "characters",
    path: "UI/Login.img/CharSelect/BtDelete",
    x: 466,
    y: 407,
    width: cell("CharSelect/BtDelete").width,
    height: cell("CharSelect/BtDelete").height,
  },
  {
    id: "character-new",
    stage: "characters",
    path: "UI/Login.img/CharSelect/BtNew",
    x: 466,
    y: 439,
    width: cell("CharSelect/BtNew").width,
    height: cell("CharSelect/BtNew").height,
  },
];
export function characterSlot(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= CHARACTER_UI.slots) return undefined;
  const left = CHARACTER_SLOT.firstRight - CHARACTER_SLOT.width + index * CHARACTER_SLOT.pitch;
  return {
    x: CHARACTER_UI.x + left,
    y: CHARACTER_UI.y + CHARACTER_SLOT.top,
    width: CHARACTER_SLOT.width,
    height: CHARACTER_SLOT.height,
    feetX: CHARACTER_UI.x + left + CHARACTER_SLOT.width / 2,
    feetY: CHARACTER_UI.y + CHARACTER_SLOT.top + CHARACTER_SLOT.height - CHARACTER_SLOT.footRise,
  };
}

/** Login reader transports u32; native WorldSelect interprets the count as signed LONG. */
export function worldPopulation(world?: { unknownId?: number }) {
  return (world?.unknownId ?? 0) | 0;
}

/** sub_54C7B0: 20 visual levels at count/3000, five source pixels per level, 101×7 WZ gauge.
 * This is UI clipping, NOT server population capacity or an admission/gameplay policy.
 */
export function worldGaugeClip(world: { unknownId?: number }) {
  const level = Math.max(1, Math.min(20, Math.trunc((20 * worldPopulation(world)) / 3000)));
  const x = 5 * (20 - level);
  const gauge = cell("WorldSelect/wsGauge");
  return { x, width: gauge.width - x, height: gauge.height };
}
