/**
 * `UI/Basic.img/Tab` - the four pieces every `CCtrlTab` strip in the game is built out of.
 *
 * These are the canvases' own sizes, measured out of `Data.wz` (`server/test/ui-basic-cells.test.ts`
 * re-measures them and fails if the art ever disagrees): `left` is 4x24, `middle` 14x24, `right`
 * 12x24 and `fill` 1x24. `sub_4582A0` stamps them left cap, then `middle` at every crease, then
 * `fill` one pixel at a time across the rest, then the right cap - so a strip's paintable middle is
 * always its own width less `TAB_LEFT` and `TAB_RIGHT`.
 *
 * They live here rather than in any one window because three sheets wear the same strip: the shop
 * (`SHOP.tabs`), the skill book (`SKILL_TABS`) and the inventory (`inventoryTabFaces`).
 */
export const TAB_LEFT = 4;
export const TAB_MIDDLE = 14;
export const TAB_RIGHT = 12;
export const TAB_FILL = 1;

/** Every `UI/Basic.img/Tab` canvas is this tall. */
export const TAB_HEIGHT = 24;
