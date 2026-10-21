/**
 * Every modeless sheet's declared size, checked against the art it paints.
 *
 * The layouts in `client/` were written down by reading the screen; this file asks `Data.wz` what
 * the plates actually measure and asserts the two agree. That matters because the numbers had no
 * other guardian: `SHOP.width` feeds the hit test, `TRADE_WINDOW.home` feeds the centring, and the
 * 176x315 trio (stat / equip / skill) used to be re-spelled at a dozen use sites with nothing to
 * catch a drift between the constant and the canvas.
 *
 * Two native rules come along for the ride, because the same numbers prove both:
 *
 *  - `sub_461C50` centres a window on the 800x600 client: `((800 - w) >> 1, (600 - h) >> 1)`. The
 *    shop (407x291 -> 196,154) and the trade room (367x295 -> 216,152) are the two that use it.
 *  - `sub_43D750` reads the registry for the rest: `8 * (3 * i + 3)` for windows 0..3, 8/8 for
 *    window 4 and 500/50 for window 5. Those four defaults are exactly the inventory (24,24), the
 *    equip window (48,48), the stat window (72,72) and the skill book (96,96); the messenger is
 *    the 500/50 one.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";
import { INVENTORY } from "../../client/inventory-window.ts";
import { SHOP } from "../../client/shop-window.ts";
import { TRADE_WINDOW } from "../../client/trade-state.ts";
import { MESSENGER_WINDOW } from "../../client/messenger-state.ts";
import { EQUIP_WINDOW } from "../../client/equipment.ts";
import { SKILL_WINDOW } from "../../client/skills.ts";
import { STAT_WINDOW } from "../../client/statwindow.ts";

/** Every sheet that declares both a size and the art it paints with. */
const SHEETS: readonly {
  name: string;
  art: string;
  width: number;
  height: number;
}[] = [
  { name: "inventory", art: "Item/backgrnd", width: INVENTORY.width, height: INVENTORY.height },
  { name: "shop", art: "Shop/backgrnd", width: SHOP.width, height: SHOP.height },
  { name: "trade", art: "Trade/backgrnd", width: TRADE_WINDOW.width, height: TRADE_WINDOW.height },
  { name: "stat", art: "Stat/backgrnd", width: STAT_WINDOW.width, height: STAT_WINDOW.height },
  { name: "equip", art: "Equip/backgrnd", width: EQUIP_WINDOW.width, height: EQUIP_WINDOW.height },
  { name: "skill", art: "Skill/backgrnd", width: SKILL_WINDOW.width, height: SKILL_WINDOW.height },
];

test(
  "each sheet declares exactly the size of the UI/UIWindow.img plate it paints with",
  needsArchive,
  () => {
    for (const sheet of SHEETS) {
      assert.equal(
        canvasSize("UI/UIWindow.img", sheet.art),
        `${sheet.width}x${sheet.height}`,
        `${sheet.name} declares ${sheet.width}x${sheet.height}`,
      );
    }
  },
);

test(
  "the messenger is the one composite: 200px of backgrnd plus the 97px charView column",
  needsArchive,
  () => {
    assert.equal(canvasSize("UI/UIWindow.img", "Messenger/backgrnd"), "200x335");
    assert.equal(canvasSize("UI/UIWindow.img", "Messenger/charView"), "97x322");
    const { width, height, charView } = MESSENGER_WINDOW;
    assert.equal(charView.x, 200, "the column starts where the backgrnd ends");
    assert.equal(charView.x + 97, width, "297 is 200 of backgrnd plus 97 of charView");
    assert.equal(height, 335, "and the height is the backgrnd's own");
    // The charView is 322 tall inside a 335-tall window, so it sits 13 down - its own y.
    assert.equal(charView.y, 13);
    assert.equal(charView.y + 322, 335);
  },
);

test(
  "the stat window's detail pane is a second 176x192 plate hanging off the parent's right edge",
  needsArchive,
  () => {
    assert.equal(canvasSize("UI/UIWindow.img", "Stat/backgrnd2"), "176x192");
    // `client/statwindow.ts` attaches it at parent +(176,123): 123 + 192 lands on the parent's own
    // bottom edge, which is why the hit test can use `STAT_WINDOW.height` for both.
    assert.equal(STAT_WINDOW.width, 176);
    assert.equal(123 + 192, STAT_WINDOW.height);
  },
);

test("sub_461C50 centres the shop and the trade room on the 800x600 client", () => {
  for (const [name, window] of [
    ["shop", SHOP],
    ["trade", TRADE_WINDOW],
  ] as const) {
    assert.equal(window.home.x, (800 - window.width) >> 1, `${name} x`);
    assert.equal(window.home.y, (600 - window.height) >> 1, `${name} y`);
  }
  assert.deepEqual(SHOP.home, { x: 196, y: 154 }, "407x291");
  assert.deepEqual(TRADE_WINDOW.home, { x: 216, y: 152 }, "367x295");
});

test("sub_43D750's registry defaults are the four remaining homes, 8*(3i+3) then 500/50", () => {
  const defaultHome = (index: number) => 8 * (3 * index + 3);
  // Window 0 = inventory, 1 = equip, 2 = stat, 3 = skill - in the order sub_43D750 walks them.
  const windows: readonly [string, { x: number; y: number }][] = [
    ["inventory", INVENTORY.home],
    ["equip", EQUIP_WINDOW.home],
    ["stat", STAT_WINDOW.home],
    ["skill", SKILL_WINDOW.home],
  ];
  for (const [index, [name, home]] of windows.entries()) {
    assert.deepEqual(home, { x: defaultHome(index), y: defaultHome(index) }, name);
  }
  // Window 5 is the one hardcoded pair; window 4 is 8/8 and has no sheet in this build.
  assert.deepEqual(MESSENGER_WINDOW.home, { x: 500, y: 50 });
});
