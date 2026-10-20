/**
 * Native shop sheet geometry, unit-tested after it left client/main.js. Every number is the
 * client's own layout - the anchors are listed in client/shop-window.ts and were re-read against
 * `MapleStory.exe.c` and this checkout's Data.wz - not a convenience invented for the test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SHOP,
  SHOP_SIDES,
  clampShopScroll,
  drawShopScrollbar,
  drawShopTabs,
  type ShopRow,
  shopListOf,
  shopRowAt,
  shopScrollbarGeometry,
  shopTabAt,
  shopVisibleRows,
  shopWindowAt,
} from "../../client/shop-window.ts";
import { INVENTORY_TABS } from "../../client/inventory-window.ts";

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
  assert.equal(shopScrollbarGeometry("buy", 12, 3)?.offset, Math.round(buy.travel / 2));
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
  assert.deepEqual(query(home.x + bar.x + 6, home.y + bar.y + 100), {
    kind: "scrollbar",
    side: "buy",
    part: "track",
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

test("the scrollbar clips its trough between the two caps and drops a fixed-size thumb", () => {
  const geometry = shopScrollbarGeometry("buy", 12, 3);
  assert.ok(geometry);
  const { ctx, calls, drawn, asked, image } = fakeContext();
  drawShopScrollbar(ctx, image, "buy", 196, 154, geometry);
  const bar = SHOP.scrollbar.buy;
  assert.deepEqual([calls[0], calls.at(-1)], ["save", "restore"]);
  assert.ok(calls.includes(`rect:385,${154 + bar.y + 12},12,${bar.height - 24}`), calls.join(" "));
  assert.ok(calls.includes("clip"));
  assert.deepEqual(
    drawn.map((entry) => String(entry.image).replace("UI/Basic.img/VScr/enabled/", "")),
    [
      "prev0",
      ...Array.from({ length: Math.ceil((bar.height - 24) / 12) }, () => "base"),
      "next0",
      "thumb0",
    ],
  );
  const thumb = drawn.at(-1);
  assert.equal(thumb?.y, 154 + bar.y + 12 + geometry.offset);
  assert.equal(
    asked.every((path) => path.startsWith("UI/Basic.img/VScr/enabled/")),
    true,
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
