/**
 * Native shop sheet geometry, unit-tested after it left client/main.js. Every number is the
 * client's own layout - the anchors are listed in client/shop-window.ts and were re-read against
 * `MapleStory.exe.c` and this checkout's Data.wz - not a convenience invented for the test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOP,
  SHOP_COUNT_WIRE_MAX,
  SHOP_ROW_NAME_TOP,
  SHOP_ROW_PRICE_TOP,
  SHOP_SIDES,
  SHOP_STACK_TOP,
  clampShopScroll,
  rechargeableRefillCost,
  shopActionBlocked,
  shopBuyBounds,
  shopBuyCount,
  shopListOf,
  shopPickedRowVisible,
  shopRowIconOrigin,
  shopRowPrice,
  shopRowStackCount,
  drawShopList,
  drawShopScrollbar,
  drawShopTabs,
  type ShopRow,
  isEquipmentItem,
  shopScrollbarGeometry,
  shopRowAt,
  shopSellBounds,
  shopTabAt,
  shopVisibleRows,
  shopWindowAt,
  type ShopRowPaint,
} from "../../client/shop-window.ts";
import { INVENTORY_TABS, isRechargeableItem } from "../../client/inventory-window.ts";

const rows = (count: number, from = 0): ShopRow[] =>
  Array.from({ length: count }, (_, index) => ({
    slot: index + 1,
    itemId: 2000000 + index + from,
  }));

test("the sheet is centred at (196,154) on a 407x291 plate, with both lists on their own pitch", () => {
  assert.deepEqual(SHOP.home, { x: (800 - 407) >> 1, y: (600 - 291) >> 1 });
  assert.deepEqual(SHOP.home, { x: 196, y: 154 });
  assert.deepEqual(SHOP.close, { x: 188, y: 9, width: 32, height: 15 });
  assert.deepEqual(SHOP.buy, { x: 78, y: 31, width: 46, height: 19 });
  assert.deepEqual(SHOP.sell, { x: 283, y: 31, width: 46, height: 19 });
  assert.deepEqual(SHOP.recharge, { x: 225, y: 29, width: 50, height: 23 });
  assert.deepEqual(SHOP.tabs, { x: 206, y: 65, width: 198, height: 24 });
  assert.equal(shopVisibleRows("buy"), 6);
  assert.equal(shopVisibleRows("sell"), 5);
  assert.deepEqual(shopListOf("buy"), SHOP.buyList);
  assert.deepEqual(shopListOf("sell"), SHOP.sellList);
  assert.deepEqual(SHOP_SIDES, ["buy", "sell"]);
});

test("a row is its 32px face on a 35px pitch; the 3px gap and the scrollbar gutter are not rows", () => {
  const list = SHOP.buyList;
  assert.equal(shopRowAt("buy", list.x, list.y, 0), 0);
  assert.equal(shopRowAt("buy", list.x + 31, list.y + 31, 0), 0);
  assert.equal(shopRowAt("buy", list.x, list.y + 32, 0), undefined, "the gap below a face");
  assert.equal(shopRowAt("buy", list.x, list.y + list.pitch, 0), 1);
  assert.equal(shopRowAt("buy", list.x, list.y - 1, 0), undefined);
  assert.equal(shopRowAt("buy", list.x - 1, list.y, 0), undefined);
  assert.equal(
    shopRowAt("buy", SHOP.scrollbar.buy.x, list.y, 0),
    undefined,
    "the scrollbar gutter starts at bar.x",
  );
  assert.equal(shopRowAt("buy", list.x, list.y + 6 * list.pitch, 0), undefined, "only six rows");
  assert.equal(shopRowAt("buy", list.x, list.y, 6), 6, "a scrolled list shifts the index");
  const sell = SHOP.sellList;
  assert.equal(shopRowAt("sell", sell.x, sell.y, 0), 0);
  assert.equal(shopRowAt("sell", sell.x, sell.y + 5 * sell.pitch, 0), undefined, "only five rows");
});

test("the tab strip is four equal columns inside its 198px box, minus the two caps", () => {
  const { tabs } = SHOP;
  assert.equal(shopTabAt(tabs.x - 1, tabs.y + 10), -1);
  assert.equal(shopTabAt(tabs.x + 4, tabs.y - 1), -1);
  assert.equal(shopTabAt(tabs.x + tabs.width, tabs.y + 10), -1);
  assert.equal(shopTabAt(tabs.x + tabs.height, tabs.y + tabs.height), -1);
  assert.equal(shopTabAt(tabs.x + 4, tabs.y + 10), 0);
  assert.equal(shopTabAt(tabs.x + tabs.width - 13, tabs.y + 10), 3);
  assert.equal(shopTabAt(tabs.x + 4, tabs.y + tabs.height - 1), 0);
  const inner = tabs.width - 4 - 12;
  for (let index = 0; index < 4; index++) {
    const x = tabs.x + 4 + Math.round((inner * (index + 0.5)) / 4);
    assert.equal(shopTabAt(x, tabs.y + 10), index, `middle of column ${index}`);
  }
});

test("a list that fits has no scrollbar; an overflowing one maps its rows onto the travel", () => {
  assert.equal(shopScrollbarGeometry("buy", 6, 0), undefined, "six rows fit the left list");
  assert.equal(shopScrollbarGeometry("sell", 5, 0), undefined, "five rows fit the right list");
  const buy = shopScrollbarGeometry("buy", 12, 0);
  assert.ok(buy);
  assert.equal(buy.max, 6);
  assert.equal(buy.travel, SHOP.scrollbar.buy.height - 36);
  assert.equal(buy.offset, 0);
  assert.equal(shopScrollbarGeometry("buy", 12, 6)?.offset, buy.travel);
  // `sub_452500` truncates: halfway of a 12-row buy list is 171 * 3 / 6 = 85.5, so the thumb sits
  // 85 px down the trough. Rounding instead (the old code) put it one pixel too far.
  assert.equal(shopScrollbarGeometry("buy", 12, 3)?.offset, Math.floor((buy.travel * 3) / 6));
  assert.equal(shopScrollbarGeometry("buy", 12, 3)?.offset, 85, "85.5 truncates to 85");
  assert.equal(
    shopScrollbarGeometry("buy", 12, 999)?.offset,
    buy.travel,
    "the offset clamps even when the row does not",
  );
  assert.equal(shopScrollbarGeometry("sell", 8, 0)?.max, 3);
});

test("setShopScroll clamps without rounding, because rows are whole", () => {
  assert.equal(clampShopScroll("buy", 12, 2.5), 2.5);
  assert.equal(clampShopScroll("buy", 12, -3), 0);
  assert.equal(clampShopScroll("buy", 12, 99), 6);
  assert.equal(clampShopScroll("buy", 4, 3), 0, "a short list cannot scroll");
});

const query = (
  x: number,
  y: number,
  buy: ShopRow[] = rows(12),
  sell: ShopRow[] = rows(8, 100),
  scroll = { buy: 0, sell: 0 },
  position = SHOP.home,
) => shopWindowAt({ position, x, y, rows: { buy, sell }, scroll });

test("the window reports what a surface point is over, in the sheet's own order", () => {
  const { home } = SHOP;
  assert.equal(query(home.x - 1, home.y + 40), undefined, "left of the sheet");
  assert.equal(query(home.x + 40, home.y - 1), undefined, "above the sheet");
  assert.equal(query(home.x + SHOP.width, home.y + 40), undefined);
  assert.deepEqual(query(home.x + SHOP.close.x + 16, home.y + SHOP.close.y + 7), {
    kind: "close",
  });
  assert.deepEqual(query(home.x + SHOP.buy.x + 23, home.y + SHOP.buy.y + 9), {
    kind: "button",
    button: "buy",
  });
  assert.deepEqual(query(home.x + SHOP.sell.x + 23, home.y + SHOP.sell.y + 9), {
    kind: "button",
    button: "sell",
  });
  assert.deepEqual(query(home.x + SHOP.recharge.x + 25, home.y + SHOP.recharge.y + 11), {
    kind: "button",
    button: "recharge",
  });
  for (const [index, label] of INVENTORY_TABS.entries()) {
    const inner = SHOP.tabs.width - 4 - 12;
    const x = SHOP.tabs.x + 4 + Math.round((inner * (index + 0.5)) / 4);
    assert.deepEqual(
      query(home.x + x, home.y + SHOP.tabs.y + 10),
      { kind: "tab", index, tab: label.tab },
      `tab ${index}`,
    );
  }
  assert.deepEqual(query(home.x + SHOP.buyList.x, home.y + SHOP.buyList.y), {
    kind: "buy-row",
    index: 0,
    row: { slot: 1, itemId: 2000000 },
  });
  assert.deepEqual(query(home.x + SHOP.sellList.x, home.y + SHOP.sellList.y), {
    kind: "sell-row",
    index: 0,
    row: { slot: 1, itemId: 2000100 },
  });
  // y=275 is below the last sell row (91 + 5*35 = 266) and in the 3px gap of the last buy row.
  assert.deepEqual(query(home.x + 20, home.y + 275), { kind: "body" });
});

test("the scrollbars are hit before the rows they overlap, and report their own side", () => {
  const { home } = SHOP;
  const bar = SHOP.scrollbar.buy;
  assert.deepEqual(query(home.x + bar.x + 6, home.y + bar.y + 4), {
    kind: "scrollbar",
    side: "buy",
    part: "prev",
  });
  assert.deepEqual(query(home.x + bar.x + 6, home.y + bar.y + bar.height - 6), {
    kind: "scrollbar",
    side: "buy",
    part: "next",
  });
  // ADR-131: the trough is not one zone. sub_452500 splits it at the thumb - 103 page up above
  // it, 104 page down below - and a held press is what makes the difference visible.
  assert.deepEqual(query(home.x + bar.x + 6, home.y + bar.y + 100), {
    kind: "scrollbar",
    side: "buy",
    part: "pageDown",
  });
  const offset = shopScrollbarGeometry("buy", 12, 3)?.offset ?? 0;
  assert.deepEqual(
    query(home.x + bar.x + 6, home.y + bar.y + 12 + offset + 4, rows(12), rows(8), {
      buy: 3,
      sell: 0,
    }),
    {
      kind: "scrollbar",
      side: "buy",
      part: "thumb",
    },
  );
  const sellBar = SHOP.scrollbar.sell;
  assert.deepEqual(query(home.x + sellBar.x + 6, home.y + sellBar.y + 4), {
    kind: "scrollbar",
    side: "sell",
    part: "prev",
  });
  // A list that fits has no bar, so the point falls through to whatever is behind it.
  assert.deepEqual(query(home.x + sellBar.x + 6, home.y + sellBar.y + 4, rows(12), rows(5)), {
    kind: "body",
  });
});

test("a scrolled list reports the row the player actually sees, and the sheet follows its position", () => {
  const { home } = SHOP;
  assert.deepEqual(
    query(home.x + SHOP.buyList.x, home.y + SHOP.buyList.y, rows(12), rows(8), {
      buy: 6,
      sell: 0,
    }),
    {
      kind: "buy-row",
      index: 6,
      row: { slot: 7, itemId: 2000006 },
    },
  );
  // Past the end of a scrolled list the row is empty sheet again.
  assert.deepEqual(
    query(home.x + SHOP.buyList.x, home.y + SHOP.buyList.y + 5 * 35, rows(7), rows(8), {
      buy: 2,
      sell: 0,
    }),
    {
      kind: "body",
    },
  );
  const moved = { x: 40, y: 60 };
  assert.deepEqual(
    query(
      moved.x + SHOP.buyList.x,
      moved.y + SHOP.buyList.y,
      rows(12),
      rows(8),
      {
        buy: 0,
        sell: 0,
      },
      moved,
    ),
    {
      kind: "buy-row",
      index: 0,
      row: { slot: 1, itemId: 2000000 },
    },
  );
  assert.equal(
    query(moved.x - 1, moved.y + 40, rows(12), rows(8), { buy: 0, sell: 0 }, moved),
    undefined,
  );
});

/** Records the canvas calls the painters make; no browser canvas is involved. */
function fakeContext() {
  const calls: string[] = [];
  const drawn: { image: unknown; x: number; y: number }[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
  const ctx = {
    save() {
      calls.push("save");
    },
    restore() {
      calls.push("restore");
    },
    beginPath() {
      calls.push("beginPath");
    },
    rect(x: number, y: number, width: number, height: number) {
      calls.push(`rect:${x},${y},${width},${height}`);
    },
    clip() {
      calls.push("clip");
    },
    drawImage(image: unknown, x: number, y: number) {
      drawn.push({ image, x, y });
    },
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y });
    },
  };
  const asked: string[] = [];
  const image = (path: string) => {
    asked.push(path);
    return { ready: true, img: path as unknown as CanvasImageSource };
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, drawn, texts, asked, image };
}

test("the scrollbar is the shared VScr strip: two caps, a tiled trough, a fixed thumb", () => {
  const geometry = shopScrollbarGeometry("buy", 12, 3);
  assert.ok(geometry);
  const { ctx, calls, drawn, asked, image } = fakeContext();
  drawShopScrollbar(ctx, image, "buy", 196, 154, geometry);
  const bar = SHOP.scrollbar.buy;
  // ADR-127: the trough is tiled the way `sub_452500` tiles it - from `arrow` while
  // `< height - arrow` - so no cell ever leaves the bar's rectangle and the old clip is gone.
  assert.deepEqual(
    calls.filter(
      (call) => call === "save" || call === "restore" || call === "clip" || call.startsWith("rect"),
    ),
    [],
    `the painter pushes no canvas state: ${calls.join(" ")}`,
  );
  let tiles = 0;
  for (let y = bar.arrow; y < bar.height - bar.arrow; y += bar.arrow) tiles += 1;
  assert.deepEqual(
    drawn.map((entry) => String(entry.image).replace("UI/Basic.img/VScr/enabled/", "")),
    ["prev0", ...Array.from({ length: tiles }, () => "base"), "next0", "thumb0"],
  );
  assert.equal(drawn[0]?.x, 196 + bar.x, "the bar hangs off the sheet's own x");
  assert.equal(drawn[0]?.y, 154 + bar.y, "the prev cap tops the bar");
  const next = drawn.find((entry) => String(entry.image).endsWith("next0"));
  assert.equal(next?.y, 154 + bar.y + bar.height - bar.arrow, "the next cap ends it");
  const thumb = drawn.at(-1);
  assert.equal(thumb?.y, 154 + bar.y + bar.arrow + geometry.offset, "the thumb rides the travel");
  assert.equal(
    asked.every((path) => path.startsWith("UI/Basic.img/VScr/enabled/")),
    true,
    "the buy list overflows, so the bar is drawn enabled",
  );
});

test("the tab strip paints four labels, lifts the lit one one pixel and marks both creases", () => {
  const { ctx, drawn, texts, image } = fakeContext();
  drawShopTabs(ctx, image, 196, 154, 2);
  assert.deepEqual(
    texts.map((entry) => entry.text),
    INVENTORY_TABS.map((tab) => tab.label),
  );
  assert.deepEqual(
    texts.map((entry) => entry.y),
    INVENTORY_TABS.map((_, index) => 154 + SHOP.tabs.y + (index === 1 ? 12 : 13)),
    "tab 2 (index 1) is the lit one",
  );
  const pieces = drawn.map((entry) => String(entry.image).replace("UI/Basic.img/Tab/", ""));
  assert.equal(pieces[0], "left0");
  assert.equal(pieces.at(-1), "right0");
  assert.equal(pieces.filter((piece) => piece === "middle1").length, 1, "the lit tab's crease");
  assert.equal(pieces.filter((piece) => piece === "middle2").length, 1, "the next tab's crease");
  assert.equal(
    pieces.filter((piece) => piece === "middle0").length,
    1,
    "the two unlit creases below",
  );
  assert.equal(pieces.filter((piece) => piece === "fill1").length > 0, true);
  assert.equal(pieces.filter((piece) => piece === "fill0").length > 0, true);
  assert.equal(pieces.filter((piece) => piece === "middle").length, 0);

  const first = fakeContext();
  drawShopTabs(first.ctx, first.image, 196, 154, 1);
  assert.equal(String(first.drawn[0]?.image).endsWith("Tab/left1"), true);
  const last = fakeContext();
  drawShopTabs(last.ctx, last.image, 196, 154, 4);
  assert.equal(String(last.drawn.at(-1)?.image).endsWith("Tab/right1"), true);
});

test("sub_4B5B10: a raw icon is anchored by its own origin, a plain one is centred in the slot", () => {
  const buy = shopListOf("buy");
  const sell = shopListOf("sell");
  assert.equal(sell.x, 209, "this is the 209 sub_4B5FA0 asks for");
  assert.equal(sell.slot, 32, "and the 32px row face the same call adds");
  // With a raw icon the sheet does NOT centre: x = 209 - ox and y = slot - oy, so the icon hangs
  // off the row's bottom edge rather than sitting inside it.
  assert.deepEqual(shopRowIconOrigin(sell, 32, 32, { ox: 8, oy: 40 }), { left: 201, top: -8 });
  assert.deepEqual(shopRowIconOrigin(sell, 32, 32, { ox: 0, oy: 32 }), { left: 209, top: 0 });
  // Without one the icon is centred in the 32x32 slot, on both axes.
  assert.deepEqual(shopRowIconOrigin(sell, 32, 32, undefined), { left: 209, top: 0 });
  assert.deepEqual(shopRowIconOrigin(sell, 24, 18, undefined), {
    left: 209 + Math.floor(8 / 2),
    top: Math.floor(14 / 2),
  });
  // The same rule on the buy pane, whose list starts at x=6.
  assert.deepEqual(shopRowIconOrigin(buy, 32, 32, { ox: 8, oy: 40 }), { left: -2, top: -8 });
  assert.deepEqual(shopRowIconOrigin(buy, 30, 30, undefined), { left: 7, top: 1 });
});

test("sub_4B5FA0 prints a stack count for everything except equipment, and only what it has", () => {
  assert.equal(shopRowStackCount({ itemId: 2000002, quantity: 50 }), 50);
  assert.equal(shopRowStackCount({ itemId: 2000002, quantity: 1 }), 1);
  assert.equal(
    shopRowStackCount({ itemId: 1302000, quantity: 1 }),
    undefined,
    "equipment (1xxxxxx) has no count",
  );
  assert.equal(shopRowStackCount({ itemId: 2000002 }), undefined, "nothing to print");
  assert.equal(
    shopRowStackCount({ itemId: 1000000, quantity: 3 }),
    undefined,
    "the boundary of the 1xxxxxx family is equipment too",
  );
  assert.equal(shopRowStackCount({ itemId: 2000000, quantity: 3 }), 3);
});

test("sub_4B4AD0: the shelf shows its own price, the sell pane adds ceil(count x unitPrice)", () => {
  assert.equal(shopRowPrice("buy", { price: 1200 }, undefined), 1200);
  assert.equal(shopRowPrice("buy", { price: 0 }, undefined), 0, "a free item still prints 0");
  assert.equal(shopRowPrice("buy", {}, undefined), undefined);
  // The buy side never asks for item info, so a stack's own count cannot change what it shows.
  assert.equal(shopRowPrice("buy", { price: 1200, quantity: 99 }, { price: 7 }), 1200);
  const potion = { price: 100, unitPrice: 50 };
  assert.equal(shopRowPrice("sell", { quantity: 1 }, potion), 150);
  assert.equal(shopRowPrice("sell", { quantity: 2 }, potion), 200);
  assert.equal(shopRowPrice("sell", { quantity: 3 }, potion), 250);
  assert.equal(
    shopRowPrice("sell", {}, potion),
    150,
    "a row with no count is treated as one, not zero",
  );
  assert.equal(
    shopRowPrice("sell", { quantity: 3 }, { price: 100 }),
    100,
    "unitPrice defaults to 0",
  );
  assert.equal(
    shopRowPrice("sell", { quantity: 3 }, undefined),
    undefined,
    "no info, no figure - the page falls back to the name line alone",
  );
  assert.equal(
    shopRowPrice("sell", { quantity: 3 }, { unitPrice: 50 }),
    undefined,
    "unitPrice alone is not a price",
  );
  // The ceiling is the native one: 1.5 rounds up, not down.
  assert.equal(shopRowPrice("sell", { quantity: 3 }, { price: 10, unitPrice: 0.5 }), 12);
});

test("the picked row's highlighted face is only drawn while that row is on the page", () => {
  const buy = shopListOf("buy");
  assert.equal(buy.rows, 6);
  assert.equal(shopPickedRowVisible(3, 0, buy), true);
  assert.equal(shopPickedRowVisible(5, 0, buy), true);
  assert.equal(shopPickedRowVisible(6, 0, buy), false, "the sixth row is off the six-row page");
  // Scrolled down one the page shows rows 1..6, so 0 has gone and 6 has come in.
  assert.equal(shopPickedRowVisible(6, 1, buy), true, "scrolled down one, it is the last visible");
  assert.equal(shopPickedRowVisible(5, 1, buy), true);
  assert.equal(shopPickedRowVisible(0, 1, buy), false, "scrolled past");
  assert.equal(shopPickedRowVisible(7, 1, buy), false, "one past the page");
  // -1 is the buy pane's "nothing picked" before a row is chosen. It falls outside the range for
  // every scroll the pane can actually reach - clampShopScroll keeps the scroll at 0 or above.
  assert.equal(shopPickedRowVisible(-1, 0, buy), false);
  assert.equal(shopPickedRowVisible(-1, 3, buy), false);
  assert.equal(clampShopScroll("buy", 20, -5), 0, "so the -1 case cannot be reached");
});

test("sub_4B6B40 asks for a count three different ways: confirm, exactly one, or how many", () => {
  // A rechargeable stack is confirmed whole and forced to one.
  assert.equal(shopBuyCount(2070000), "confirm");
  assert.equal(shopBuyCount(2070016), "confirm");
  // Equipment is always exactly one, with no dialog at all.
  assert.equal(shopBuyCount(1302000), "one");
  assert.equal(shopBuyCount(1000000), "one");
  assert.equal(isEquipmentItem(1302000), true);
  assert.equal(isEquipmentItem(2000002), false);
  // Everything else asks.
  assert.equal(shopBuyCount(2000002), "quantity");
  assert.equal(shopBuyCount(4000000), "quantity");
  // The rechargeable check wins over the equipment one: 207xxxx is never category 1 anyway, but
  // the order is what the native compares first.
  assert.equal(shopBuyCount(2070000), "confirm");
  // The sell pane only special-cases the rechargeable confirm; equipment goes through the dialog.
  assert.equal(isRechargeableItem(2070000), true);
  assert.equal(isRechargeableItem(1302000), false);
});

test("sub_4B5FA0 prints no stack count on equipment, whatever quantity the row carries", () => {
  assert.equal(shopRowStackCount({ itemId: 1302000, quantity: 1 }), undefined);
  assert.equal(shopRowStackCount({ itemId: 1302000 }), undefined);
  assert.equal(shopRowStackCount({ itemId: 1999999, quantity: 7 }), undefined);
  assert.equal(shopRowStackCount({ itemId: 2000000, quantity: 7 }), 7);
  // 207xxxx is not equipment, so its rounds do print.
  assert.equal(shopRowStackCount({ itemId: 2070000, quantity: 200 }), 200);
});

test("sub_4B6B40 buys from 1 up to the row's own maximum; sub_4B6E90 sells the whole stack", () => {
  // FINDINGS 4.19: sub_4B7960(prompt, 1, row[8]) for a buy, sub_535C90(total, 1, total) for a sell.
  // The native never clamps - no stack is that long - but the 0x30 count is a u16 that the server
  // refuses above 65535, so the box tops out there rather than offering an unsendable figure.
  assert.equal(SHOP_COUNT_WIRE_MAX, 65535);
  assert.deepEqual(shopBuyBounds(1), { initial: 1, min: 1, max: 1 });
  assert.deepEqual(shopBuyBounds(100), { initial: 1, min: 1, max: 100 });
  assert.deepEqual(shopBuyBounds(65535), { initial: 1, min: 1, max: 65535 });
  assert.deepEqual(shopBuyBounds(65536), { initial: 1, min: 1, max: 65535 });
  assert.deepEqual(shopSellBounds(1), { initial: 1, min: 1, max: 1 });
  assert.deepEqual(
    shopSellBounds(100),
    { initial: 100, min: 1, max: 100 },
    "defaulting to the whole stack",
  );
  assert.deepEqual(shopSellBounds(65536), { initial: 65535, min: 1, max: 65535 });
  // A stack that reads 0 is still a stack of one as far as the box is concerned.
  assert.deepEqual(shopSellBounds(0), { initial: 1, min: 1, max: 1 });
});

test("sub_4B4AD0's refill fee is ceil((capacity - rounds) * unitPrice), the rate read as a double", () => {
  // WZ: the eight 207 rows carry base capacities 500/500/700/500/400/600/800/600 and rates
  // 0.3/0.4/0.5/0.6/0.6/0.7/0.8/1, so the fee is a ceil of a fractional product.
  assert.equal(rechargeableRefillCost(500, 0.3, 0), 150);
  assert.equal(rechargeableRefillCost(500, 0.3, 1), 150, "ceil(499 * 0.3) = ceil(149.7)");
  assert.equal(rechargeableRefillCost(500, 0.3, 499), 1, "ceil(0.3)");
  assert.equal(rechargeableRefillCost(500, 1, 100), 400);
  // A stack at or over capacity has nothing left to buy, so there is no quote at all.
  assert.equal(rechargeableRefillCost(500, 0.3, 500), undefined);
  assert.equal(rechargeableRefillCost(500, 0.3, 501), undefined);
  assert.equal(rechargeableRefillCost(500, 0.3, -1), undefined);
  assert.equal(rechargeableRefillCost(500, 0.3, 1.5), undefined, "rounds are whole");
  // A zero rate would be a free refill, which the native refuses to quote.
  assert.equal(rechargeableRefillCost(500, 0, 0), undefined);
  // Fractional doubles survive: 0.1 is not exact in binary, and the ceil is what the client pays.
  assert.equal(rechargeableRefillCost(700, 0.1, 0), 70);
});

/**
 * The row painter, against `sub_4B5B10` (the buy pane) and `sub_4B5FA0` (the sell pane).
 *
 * Those two are the same loop - `n71 += 35` and `n110 += 35` - and the sell pane's `n110` starts at
 * 110, which is its first row (y=91) plus the 19 the price line sits at. So a paint at the origin
 * puts the two text lines on 94 and 110 and the stack count on `n110 + 1` = 111, from `n110_2` =
 * 209, the list's own x.
 */
test("one row paints its name and price on sub_4B5FA0's two lines and its count at the list's x", () => {
  const { ctx, drawn, texts, image } = fakeContext();
  const list = SHOP.sellList;
  assert.equal(list.y, 91);
  assert.equal(list.x, 209, "sub_4B5FA0's n110_2");
  assert.equal(list.nameX, 245, "sub_4B5FA0's n245");
  drawShopList(ctx, image, "sell", 0, 0, {
    picked: -1,
    scroll: 0,
    total: 1,
    rows: [{ stack: 123, name: "빨간 포션", price: 310 }],
  });
  assert.equal(list.y + SHOP_ROW_NAME_TOP, 94, "sub_4B5FA0's n110 - 16");
  assert.equal(list.y + SHOP_ROW_PRICE_TOP, 110, "sub_4B5FA0's n110");
  assert.equal(list.y + SHOP_STACK_TOP, 111, "sub_4B5FA0's n110 + 1");
  assert.deepEqual(
    texts.map((entry) => [entry.text, entry.x, entry.y]),
    [
      ["빨간 포션", list.nameX, list.y + SHOP_ROW_NAME_TOP],
      ["310 메소", list.nameX, list.y + SHOP_ROW_PRICE_TOP],
    ],
  );
  // `sub_525AE0`: one ItemNo glyph per digit from the list's own x, each advanced by ITS OWN width.
  // `1` is the narrow 5 px one, so "123" steps 5 then 8 - not a flat 8 twice.
  assert.deepEqual(
    drawn
      .filter((entry) => String(entry.image).startsWith("UI/Basic.img/ItemNo/"))
      .map((entry) => [String(entry.image).replace("UI/Basic.img/ItemNo/", ""), entry.x, entry.y]),
    [
      ["1", list.x, list.y + SHOP_STACK_TOP],
      ["2", list.x + 5, list.y + SHOP_STACK_TOP],
      ["3", list.x + 5 + 8, list.y + SHOP_STACK_TOP],
    ],
  );
});

test("the picked face shows only while the pick is on the page; the bar only when the list overflows", () => {
  const row: ShopRowPaint = { name: "x", price: 1 };
  const build = (picked: number, scroll: number, total: number) => {
    const context = fakeContext();
    drawShopList(context.ctx, context.image, "buy", 196, 154, {
      picked,
      scroll,
      total,
      rows: Array.from({ length: SHOP.buyList.rows }, () => row),
    });
    return context.drawn;
  };
  const parts = (drawn: { image: unknown; x: number; y: number }[], needle: string) =>
    drawn.filter((entry) => String(entry.image).includes(needle));
  const short = build(2, 0, 3);
  assert.equal(parts(short, "VScr").length, 0, "three rows fit in six, so there is no bar");
  assert.equal(parts(short, "Shop/buy").length, 1, "the picked row's face");
  assert.equal(
    parts(short, "Shop/buy")[0]?.y,
    154 + SHOP.face.buy.y + 2 * SHOP.buyList.pitch,
    "the third row's face, two pitches down the page",
  );
  const long = build(0, 4, 40);
  assert.equal(parts(long, "Shop/buy").length, 0, "row 0 is scrolled off the top");
  assert.equal(parts(long, "VScr").length > 0, true, "forty rows in six, so there is a bar");
});

test("a shop request is blocked by any of the five gates, and by nothing else", () => {
  const clear = {
    shopPending: false,
    slotPending: false,
    mesoPending: false,
    modalOpen: false,
    hp: 100,
  };
  assert.equal(shopActionBlocked(clear), false);
  for (const gate of ["shopPending", "slotPending", "mesoPending", "modalOpen"] as const)
    assert.equal(shopActionBlocked({ ...clear, [gate]: true }), true, gate);
  assert.equal(shopActionBlocked({ ...clear, hp: 0 }), true, "dead");
  assert.equal(shopActionBlocked({ ...clear, hp: -1 }), true);
  assert.equal(shopActionBlocked({ ...clear, hp: 1 }), false, "1 hp is alive");
  // Before the view arrives there is no hp to test, and the original `selfView?.hp <= 0` is false
  // then as well - so the guard must not block just because the player is unknown.
  assert.equal(shopActionBlocked({ ...clear, hp: undefined }), false);
});

test("the trough splits into pageUp and pageDown at the thumb, the way sub_452500 zones it", () => {
  const { home } = SHOP;
  const bar = SHOP.scrollbar.buy;
  const many = rows(20); // 6 visible, so 15 rows of travel and the thumb sits mid-trough
  const scroll = { buy: 7, sell: 0 };
  const geometry = shopScrollbarGeometry("buy", many.length, scroll.buy);
  assert.ok(geometry);
  const thumbTop = bar.arrow + geometry.offset;
  assert.ok(thumbTop > bar.arrow, `the thumb has left the top of the trough: ${geometry.offset}`);
  assert.ok(thumbTop < bar.height - 2 * bar.arrow, "and has not reached the next cap yet");
  const part = (offset: number) => {
    const hit = query(home.x + bar.x + 6, home.y + bar.y + offset, many, rows(8), scroll);
    // Narrowed rather than cast, so a point that stops being a scrollbar says so.
    return hit?.kind === "scrollbar" ? hit.part : `not a scrollbar: ${JSON.stringify(hit)}`;
  };
  assert.equal(part(2), "prev");
  assert.equal(part(bar.height - 2), "next");
  assert.equal(part(bar.arrow + 1), "pageUp", "just under the prev cap, above the thumb");
  assert.equal(part(thumbTop - 1), "pageUp", "the last pixel before the thumb");
  assert.equal(part(thumbTop), "thumb");
  assert.equal(part(thumbTop + bar.arrow - 1), "thumb", "the thumb is one arrow-cell tall");
  assert.equal(part(thumbTop + bar.arrow), "pageDown", "and the trough resumes below it");
  assert.equal(part(bar.height - bar.arrow - 1), "pageDown", "up to the next cap");
});

test("a held arrow shows the pressed art, and only on the pane the press belongs to", () => {
  const geometry = shopScrollbarGeometry("buy", 12, 3);
  assert.ok(geometry);
  const { ctx, drawn, image } = fakeContext();
  drawShopScrollbar(ctx, image, "buy", 196, 154, geometry, "prev");
  const names = drawn.map((entry) => String(entry.image).replace("UI/Basic.img/VScr/enabled/", ""));
  assert.equal(names[0], "prev1", "sub_4521E0: the down-arrow face, not the idle one");
  assert.ok(!names.includes("next1"), "the other cap stays idle");

  const nextHeld = fakeContext();
  drawShopScrollbar(nextHeld.ctx, nextHeld.image, "buy", 196, 154, geometry, "next");
  const nextNames = nextHeld.drawn.map((entry) =>
    String(entry.image).replace("UI/Basic.img/VScr/enabled/", ""),
  );
  assert.equal(nextNames[0], "prev0", "holding next leaves the prev cap idle");
  assert.ok(nextNames.includes("next1"), nextNames.join(" "));

  // The list painter takes the zone from its own pane's paint: the sell pane's bar stays idle
  // while the buy pane's arrow is held, which is why the press carries a side at all.
  const both = fakeContext();
  drawShopList(both.ctx, both.image, "buy", 196, 154, {
    picked: -1,
    scroll: 3,
    total: 12,
    rows: [],
    pressed: "next",
  });
  const buyCells = both.drawn
    .map((entry) => String(entry.image))
    .filter((name) => name.startsWith("UI/Basic.img/VScr/"));
  assert.ok(buyCells.includes("UI/Basic.img/VScr/enabled/next1"), buyCells.join(" "));
  const sellOnly = fakeContext();
  drawShopList(sellOnly.ctx, sellOnly.image, "sell", 196, 154, {
    picked: -1,
    scroll: 0,
    total: 12,
    rows: [],
    pressed: undefined,
  });
  const sellCells = sellOnly.drawn
    .map((entry) => String(entry.image))
    .filter((name) => name.startsWith("UI/Basic.img/VScr/"));
  assert.ok(
    sellCells.every((name) => !name.endsWith("1")),
    `the idle pane has no pressed face: ${sellCells.join(" ")}`,
  );
});
