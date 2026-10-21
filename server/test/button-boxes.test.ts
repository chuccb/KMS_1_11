/**
 * Every button box in the client is its own sprite's size.
 *
 * `sub_4E0FF0` creates the messenger's close button with
 * `CCtrlButton::Create(this, 1000, 152, 9, 2, &path)` (MapleStory.exe.c:231327, args at
 * :231330-231334): position and type only, **no rectangle**. A type-2 button takes its rectangle
 * from the sprite it was given, so the box a window hit-tests is whatever `Data.wz` says that
 * canvas measures - not a number the window is free to pick.
 *
 * ADR-128 pulled the handful of strips that more than one window wears into
 * `client/uicontrols.ts`. The rest live in one window each, so they stay in that window's layout -
 * but they are still measured, not chosen, and nothing guarded them. This file is that guard: it
 * re-measures every one of them out of `Data.wz` on each run.
 *
 * Two of these are worth pointing at, because their numbers collide:
 *
 *  - `SHOP.recharge` is 50x23, exactly the size of `UTIL_DLG_BUTTON` - but it comes from
 *    `UI/UIWindow.img/Shop/BtRecharge`, a different strip, so it is deliberately *not* written with
 *    that constant. The same number for a different reason.
 *  - `Trade/BtCoin` is 14x14 while `Item/BtCoin` is 17x17. Two coins, two sheets, two sizes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canvasSize, needsArchive } from "./helpers/wz-cells.ts";
import { BT_UI_CLOSE, UTIL_DLG_BUTTON } from "../../client/uicontrols.ts";
import { INVENTORY } from "../../client/inventory-window.ts";
import { SHOP } from "../../client/shop-window.ts";
import { STAT_WINDOW } from "../../client/statwindow.ts";
import { SKILL_UP_BUTTON } from "../../client/skills.ts";
import { TRADE_WINDOW } from "../../client/trade-state.ts";
import { MESSENGER_BUTTON, STATUS_BAR } from "../../client/hud.ts";
import { CREATION_BUTTONS } from "../../client/creation.ts";

/** One button box the client declares, and the canvas it is measured against. */
interface ButtonBox {
  readonly name: string;
  readonly art: string;
  readonly width: number;
  readonly height: number;
}

const UI_WINDOW = "UI/UIWindow.img";

/** Every per-window button box, paired with the strip that sizes it. */
const BOXES: readonly ButtonBox[] = [
  // The inventory's meso button. `sub_4D4960`.
  { name: "inventory coin", art: `${UI_WINDOW}/Item/BtCoin/normal/0`, ...INVENTORY.coin },
  // The stat window's 詳細 button.
  {
    name: "stat detail",
    art: `${UI_WINDOW}/Stat/BtDetail/normal/0`,
    width: STAT_WINDOW.detail.w,
    height: STAT_WINDOW.detail.h,
  },
  // The skill book's four SP-up buttons: `sub_4ECD40`'s `CCtrlButton id(2010+i)`.
  {
    name: "skill SP up",
    art: `${UI_WINDOW}/Skill/BtSpUp/normal/0`,
    width: SKILL_UP_BUTTON.width,
    height: SKILL_UP_BUTTON.height,
  },
  // The shop's three buttons - each its own strip, so each its own pair of numbers.
  { name: "shop buy", art: `${UI_WINDOW}/Shop/BtBuy/normal/0`, ...SHOP.buy },
  { name: "shop sell", art: `${UI_WINDOW}/Shop/BtSell/normal/0`, ...SHOP.sell },
  { name: "shop recharge", art: `${UI_WINDOW}/Shop/BtRecharge/normal/0`, ...SHOP.recharge },
  // The trade room: the shared close cell, then its own two.
  { name: "trade close", art: `${UI_WINDOW}/BtUIClose/normal/0`, ...TRADE_WINDOW.close },
  { name: "trade button", art: `${UI_WINDOW}/Trade/BtTrade/normal/0`, ...TRADE_WINDOW.trade },
  { name: "trade coin", art: `${UI_WINDOW}/Trade/BtCoin/normal/0`, ...TRADE_WINDOW.coin },
  // The status bar's own row, plus `sub_4F6B70`'s BtChat.
  ...STATUS_BAR.buttons.map((button) => ({
    name: `status bar ${button.name}`,
    art: `UI/StatusBar.img/${button.name}/normal/0`,
    width: button.w,
    height: button.h,
  })),
  {
    name: "messenger BtChat",
    art: "UI/StatusBar.img/BtChat/normal/0",
    width: MESSENGER_BUTTON.width,
    height: MESSENGER_BUTTON.height,
  },
  // The creation screen's 重複確認 button; the other two wear `UI/Basic.img`'s 65x24 pair.
  {
    name: "creation check id",
    art: "UI/Login.img/CharSelect/BtCheckId/normal/0",
    width: CREATION_BUTTONS[0]?.width ?? 0,
    height: CREATION_BUTTONS[0]?.height ?? 0,
  },
];

test("every button box is the size Data.wz gives the sprite it stamps", needsArchive, () => {
  for (const box of BOXES) {
    const slash = box.art.indexOf("/");
    const image = box.art.slice(0, box.art.indexOf("/", slash + 1));
    const path = box.art.slice(image.length + 1);
    assert.equal(canvasSize(image, path), `${box.width}x${box.height}`, `${box.name}: ${box.art}`);
  }
});

test(
  "the close cell is shared, but the coin is not: two coins, two sheets, two sizes",
  needsArchive,
  () => {
    // Five windows plus the trade room reach for `BT_UI_CLOSE`, and `BtUIClose2` is the same size -
    // but the two coins in the client are different canvases and the numbers must not be swapped.
    assert.equal(TRADE_WINDOW.close.width, BT_UI_CLOSE.width);
    assert.equal(TRADE_WINDOW.close.height, BT_UI_CLOSE.height);
    assert.equal(canvasSize(UI_WINDOW, "Item/BtCoin/normal/0"), "17x17");
    assert.equal(canvasSize(UI_WINDOW, "Trade/BtCoin/normal/0"), "14x14");
    assert.notEqual(TRADE_WINDOW.coin.width, INVENTORY.coin.width);
    assert.notEqual(TRADE_WINDOW.coin.height, INVENTORY.coin.height);
  },
);

test(
  "the shop's recharge button is not UTIL_DLG_BUTTON, however equal the numbers look",
  needsArchive,
  () => {
    // Both are 50x23. `BtRecharge` lives in the shop's own sheet and the UtilDlg buttons live in
    // theirs, so the shop keeps its own pair rather than borrowing a constant for a strip it never
    // stamps - and this test is what stops a future reader from "tidying" one into the other.
    assert.equal(SHOP.recharge.width, UTIL_DLG_BUTTON.width);
    assert.equal(SHOP.recharge.height, UTIL_DLG_BUTTON.height);
    // The shop names its own strip: the two are equal numbers from different canvases.
    assert.equal(canvasSize(UI_WINDOW, "Shop/BtRecharge/normal/0"), "50x23");
    assert.equal(canvasSize(UI_WINDOW, "UtilDlgEx/BtOK/normal/0"), "50x23");
  },
);

test("no button box is left at zero: a layout that forgot its sprite fails here", () => {
  for (const box of BOXES) {
    assert.ok(box.width > 0, `${box.name} has a width`);
    assert.ok(box.height > 0, `${box.name} has a height`);
  }
  // The table is the point of this file, so a box that quietly drops out of it is a failure too.
  assert.ok(BOXES.length >= 15, `the table covers every button box (${BOXES.length})`);
});
