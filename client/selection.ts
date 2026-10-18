/** Original CUIs: sub_545450 (windows), sub_54C7B0/54D480 (world rows),
 * sub_42CFE0 (buttons), sub_42E0D0/42E2C0 (three character slots). */
export const WORLD_UI = {
  x: 250,
  y: 89,
  width: 305,
  height: 403,
  rowX: 24,
  rowY: 199,
  rowWidth: 240,
  rowHeight: 25,
  visibleRows: 6,
};
export const CHARACTER_UI = {
  x: 161,
  y: 85,
  width: 491,
  height: 398,
  slots: 3,
  feetX: 95,
  feetY: 238,
  spacing: 140,
};
export const SELECTION_BUTTONS = [
  {
    id: "world-connect",
    stage: "worlds",
    path: "UI/Login.img/WorldSelect/BtConnect",
    x: 345,
    y: 451,
    width: 111,
    height: 24,
  },
  {
    id: "character-enter",
    stage: "characters",
    path: "UI/Login.img/CharSelect/BtSelect",
    x: 466,
    y: 375,
    width: 141,
    height: 24,
  },
  {
    id: "character-delete",
    stage: "characters",
    path: "UI/Login.img/CharSelect/BtDelete",
    x: 466,
    y: 407,
    width: 141,
    height: 24,
  },
  {
    id: "character-new",
    stage: "characters",
    path: "UI/Login.img/CharSelect/BtNew",
    x: 466,
    y: 439,
    width: 141,
    height: 24,
  },
];
export function characterSlot(index: number) {
  if (index < 0 || index >= 3) return undefined;
  return {
    x: CHARACTER_UI.x + 70 + index * 140,
    y: CHARACTER_UI.y + 178,
    width: 50,
    height: 70,
    feetX: CHARACTER_UI.x + 95 + index * 140,
    feetY: CHARACTER_UI.y + 238,
  };
}

/** Login reader transports u32; native WorldSelect interprets the count as signed LONG. */
export function worldPopulation(world?: { unknownId?: number }) {
  return (world?.unknownId ?? 0) | 0;
}
