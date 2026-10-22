/**
 * The NPC shop: the four packets (`0x4A`/`0x4B` out, `0x16`/`0x33` in), the two transactions, and the
 * prices they are built from.
 *
 * The codec half runs without `Data.wz` (hand-built bytes, so a change to the wire format fails
 * here first); the trade half needs the archive, because the price comes out of the item's own
 * `info/price` - a shop that could invent a price is exactly what this module refuses to be.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WzArchive } from "../src/wz/archive.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  CLIENT_OBJECT_CLICK_OPCODE,
  CLIENT_SHOP_OPCODE,
  SHOP_REQUEST,
  SHOP_RESULT,
  describeClientObjectClick,
  describeClientShopRequest,
  describeShopOpen,
  describeShopResult,
  encodeClientObjectClick,
  encodeClientShopRequest,
  encodeShopOpen,
  encodeShopResult,
  readClientObjectClick,
  readClientShopRequest,
  readShopOpen,
  readShopResult,
  shopRechargeUnitPrice,
} from "../src/protocol/shop.ts";
import {
  FIELD_OPCODE,
  describeClientFieldPacket,
  describeFieldPacket,
} from "../src/protocol/field.ts";
import {
  DEFAULT_SHOP_MAX_COUNT,
  SELL_PRICE_RATIO,
  npcShopOf,
  shopDefOf,
  shopsOf,
  itemPrice,
  shopKeeper,
  shopResultCode,
  unpricedShopItems,
  type ShopDef,
} from "../src/game/shops.ts";
import { MesoWallet, grantItem } from "../src/game/rewards.ts";
import { consumeSpecOf, healsVitals } from "../src/game/items.ts";
import { scrollSpecOf } from "../src/game/scrolls.ts";
import { INVENTORY_OP } from "../src/protocol/inventory.ts";
import { isEquipItemId, nonEquipSlot } from "../src/protocol/itemslot.ts";
import { startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";

/**
 * 암허스트무기상점 (Amherst weapon shop), NPC 칼 - the shop a new player reaches first:
 * `--map` starts in 1000000, portal 4 leads to 1010000 암허스트, portal 2 to this map (1010001).
 * Hand-built so the tests that do not need the archive still have a real shop to talk about.
 */
/**
 * The shop that stocks the star sets the recharge tests use: 샘 (1011001), the second NPC of
 * 암허스트무기상점. Needs the archive, so it is built inside the tests that have one.
 */
const starShopOf = (): ShopDef => shopDefOf(npcShopOf(archive!, 1011001)!)!;

/**
 * 루나 (1011100) - a shop that stocks the ordinary potions, at the shop's own prices
 * (50 / 160 / 320 / 200, none of which is the item's `info/price`).
 */
const potionShopOf = (): ShopDef => shopDefOf(npcShopOf(archive!, 1011100)!)!;

const AMHERST_WEAPON_SHOP: ShopDef = {
  shopId: 1011000,
  npcTemplateId: 1011000,
  // No prices here on purpose: this fixture stands in for "a shop whose prices the archive has
  // to supply", which is what makes the `shopKeeper(undefined)` case below meaningful.
  items: [{ itemId: 1302007 }, { itemId: 1332000 }],
};

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

const HEX = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

// ---------------------------------------------------------------------------
// the four packets
// ---------------------------------------------------------------------------

test("0x4A opens a shop with its rows: u32 shopId, u16 count, then id/price/max per row", () => {
  const bytes = encodeShopOpen({
    shopId: 1010100,
    items: [
      { itemId: 2000000, price: 25, maxCount: 200 },
      { itemId: 2000001, price: 80, maxCount: 10 },
    ],
  });
  assert.equal(
    HEX(bytes),
    "4a" + // the opcode
      "b4690f00" + // shopId 1010100
      "0200" + // two rows
      "80841e00" +
      "19000000" +
      "c800" + // 2000000, 25, up to 200
      "81841e00" +
      "50000000" +
      "0a00", // 2000001, 80, up to 10
  );
  assert.deepEqual(readShopOpen(new PacketReader(bytes, 1)), {
    shopId: 1010100,
    items: [
      { itemId: 2000000, price: 25, maxCount: 200 },
      { itemId: 2000001, price: 80, maxCount: 10 },
    ],
  });
  assert.equal(
    describeShopOpen(readShopOpen(new PacketReader(bytes, 1))),
    "shop 1010100 with 2 row(s): 2000000 at 25 up to 200, 2000001 at 80 up to 10",
  );
});

test("an empty shop is legal: the client shows the window with no rows", () => {
  const bytes = encodeShopOpen({ shopId: 7, items: [] });
  assert.equal(HEX(bytes), "4a" + "07000000" + "0000");
  assert.deepEqual(readShopOpen(new PacketReader(bytes, 1)), { shopId: 7, items: [] });
  assert.equal(describeShopOpen({ shopId: 7, items: [] }), "shop 7 (empty)");
});

test("a 207 row carries its 8 bytes verbatim, and only a 207 row may", () => {
  const cash = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const bytes = encodeShopOpen({
    shopId: 1,
    items: [{ itemId: 2070000, price: 500, maxCount: 1, cash }],
  });
  assert.equal(
    HEX(bytes),
    "4a" + "01000000" + "0100" + "f0951f00" + "f4010000" + "0102030405060708" + "0100",
  );
  const back = readShopOpen(new PacketReader(bytes, 1));
  assert.deepEqual(back.items[0]?.cash, cash);
  // Refusing is the whole point: the 8 bytes have no located meaning, so they cannot be invented.
  assert.throws(
    () => encodeShopOpen({ shopId: 1, items: [{ itemId: 2070000, price: 500, maxCount: 1 }] }),
    /207 item/,
  );
  assert.throws(
    () => encodeShopOpen({ shopId: 1, items: [{ itemId: 2000000, price: 25, maxCount: 1, cash }] }),
    /not a 207 item/,
  );
});

test("0x4B is one result byte, and the client's own messages sit behind it", () => {
  assert.equal(HEX(encodeShopResult(SHOP_RESULT.silent)), "4b00");
  assert.equal(HEX(encodeShopResult(SHOP_RESULT.notEnoughMesos)), "4b02");
  assert.equal(readShopResult(new PacketReader(encodeShopResult(3), 1)), 3);
  assert.equal(describeShopResult(0), "shop result 0 (silent)");
  assert.equal(describeShopResult(2), "shop result 2 (not enough mesos)");
  assert.equal(describeShopResult(3), "shop result 3 (not enough slots)");
  assert.equal(describeShopResult(9), "shop result 9 (error)");
  assert.throws(() => encodeShopResult(256), /u8/);
});

test("0x16 is the action byte plus the fields that action has", () => {
  assert.equal(
    HEX(encodeClientShopRequest({ kind: "buy", row: 2, itemId: 2000000, count: 1 })),
    "1600" + "0200" + "80841e00" + "0100",
  );
  assert.equal(
    HEX(encodeClientShopRequest({ kind: "sell", slot: 3, itemId: 2000003, count: 5 })),
    "1601" + "0300" + "83841e00" + "0500",
  );
  assert.equal(HEX(encodeClientShopRequest({ kind: "recharge", slot: 1 })), "1602" + "0100");
  assert.equal(HEX(encodeClientShopRequest({ kind: "close" })), "1603");
  assert.equal(SHOP_REQUEST.buy, 0);
  assert.equal(SHOP_REQUEST.sell, 1);
  assert.equal(CLIENT_SHOP_OPCODE, 0x16);
  assert.deepEqual(
    readClientShopRequest(
      new PacketReader(
        encodeClientShopRequest({ kind: "buy", row: 2, itemId: 2000000, count: 1 }),
        1,
      ),
    ),
    {
      kind: "buy",
      row: 2,
      itemId: 2000000,
      count: 1,
    },
  );
  assert.deepEqual(
    readClientShopRequest(
      new PacketReader(
        encodeClientShopRequest({ kind: "sell", slot: 3, itemId: 2000003, count: 5 }),
        1,
      ),
    ),
    {
      kind: "sell",
      slot: 3,
      itemId: 2000003,
      count: 5,
    },
  );
  assert.deepEqual(
    readClientShopRequest(
      new PacketReader(encodeClientShopRequest({ kind: "recharge", slot: 1 }), 1),
    ),
    {
      kind: "recharge",
      slot: 1,
    },
  );
  assert.deepEqual(
    readClientShopRequest(new PacketReader(encodeClientShopRequest({ kind: "close" }), 1)),
    { kind: "close" },
  );
  assert.equal(
    describeClientShopRequest({ kind: "buy", row: 2, itemId: 2000000, count: 1 }),
    "16 shop buy row 2 item 2000000 x1",
  );
  assert.equal(describeClientShopRequest({ kind: "close" }), "16 shop close");
  // An action the client never sends is refused, not guessed at.
  assert.throws(
    () => readClientShopRequest(new PacketReader(Uint8Array.from([9]), 0)),
    /unknown shop action/,
  );
});

test("0x33 is the clicked object's id, and its answer is the empty 0x19", () => {
  const bytes = encodeClientObjectClick({ objectId: 2003 });
  assert.equal(HEX(bytes), "33" + "d3070000");
  assert.equal(CLIENT_OBJECT_CLICK_OPCODE, 0x33);
  assert.deepEqual(readClientObjectClick(new PacketReader(bytes, 1)), { objectId: 2003 });
  assert.equal(describeClientObjectClick({ objectId: 2003 }), "33 object click: id=2003");
});

test("the decode tool understands all five new opcodes", () => {
  const open = encodeShopOpen({
    shopId: 1010100,
    items: [{ itemId: 2000000, price: 25, maxCount: 200 }],
  });
  assert.equal(
    describeFieldPacket(open),
    "0x4a CShopDlg(open): shop 1010100 with 1 row(s): 2000000 at 25 up to 200",
  );
  assert.equal(
    describeFieldPacket(encodeShopResult(2)),
    "0x4b CShopDlg(result): shop result 2 (not enough mesos)",
  );
  assert.equal(
    describeClientFieldPacket(
      encodeClientShopRequest({ kind: "sell", slot: 3, itemId: 2000003, count: 5 }),
    ),
    "16 shop sell slot 3 item 2000003 x5",
  );
  assert.equal(
    describeClientFieldPacket(encodeClientObjectClick({ objectId: 2003 })),
    "33 object click: id=2003",
  );
  assert.equal(
    describeFieldPacket(Uint8Array.from([FIELD_OPCODE.requestRelease])),
    "0x19 CField(cached-character reset)",
  );
});

// ---------------------------------------------------------------------------
// the shop table, the prices, and the two transactions
// ---------------------------------------------------------------------------

test(
  "the 20 archive shops are read out of Npc/*/info/shop and every row is priced",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const shops = shopsOf(archive!);
    // 20 of the 70 Npc/*.img files carry an `info/shop` node, 594 rows between them (ADR-140).
    assert.equal(shops.length, 20);
    assert.equal(
      shops.reduce((total, shop) => total + shop.items.length, 0),
      594,
    );
    // Not one row has to be skipped for want of a price: a row prices itself, or its item does.
    for (const shop of shops) assert.deepEqual(unpricedShopItems(shop, keeper.priceOf), []);
    // The three NPCs the old hand-written table used have NO shop node at all - which is what
    // made that table invented stock at invented prices.
    for (const npc of [1010100, 2003, 12100]) assert.equal(keeper.shopOfNpc(npc), undefined);
    assert.equal(keeper.shopOfNpc(2004), undefined); // an NPC without a shop
    // The real ones a new player can reach: 1000000 -> 1010000 -> 1010001 / 1010003.
    assert.equal(keeper.shopOfNpc(1011000)?.shopId, 1011000); // 칼, 암허스트무기상점
    assert.equal(keeper.shopOfNpc(1011001)?.shopId, 1011001); // 샘, 암허스트무기상점
    assert.equal(keeper.shopOfNpc(11100)?.shopId, 11100); // 루시, 암허스트잡화상점
    assert.equal(keeper.shopOfNpc(1051000)?.shopId, 1051000); // 만슈타인
    // `priceOf` stays the ITEM's own price - the two are deliberately different numbers.
    assert.equal(keeper.priceOf(2000000), 25); // 빨간 포션 info/price
    assert.equal(itemPrice(archive!, 2000000), 25); // the reader behind every row
    assert.equal(itemPrice(undefined, 2000000), undefined); // `--data off` prices nothing
  },
);

test(
  "a shop row's own price is what the client is charged, not the item's info/price",
  needsArchive,
  () => {
    // ADR-140, the actual bug: 541 of the 543 priced rows disagree with the item's `info/price`,
    // so charging the item's price was wrong for almost everything on every shelf.
    const keeper = shopKeeper(archive!);
    const generalStore = shopDefOf(npcShopOf(archive!, 11100)!)!; // 루시, 암허스트잡화상점
    assert.deepEqual(
      keeper.linesOf(generalStore).map((line) => [line.itemId, line.price, line.maxCount]),
      [
        [2000000, 50, DEFAULT_SHOP_MAX_COUNT], // info/price 25 - the shop asks 50
        [2000001, 160, DEFAULT_SHOP_MAX_COUNT], // info/price 80
        [2000002, 320, DEFAULT_SHOP_MAX_COUNT], // info/price 160
        [2010000, 30, DEFAULT_SHOP_MAX_COUNT],
        [2010002, 50, DEFAULT_SHOP_MAX_COUNT],
      ],
    );
    // 만슈타인 (1051000), the NPC this round started from: every row is the shop's own price.
    const weaponShop = shopDefOf(npcShopOf(archive!, 1051000)!)!;
    const byId = new Map(keeper.linesOf(weaponShop).map((line) => [line.itemId, line.price]));
    assert.equal(byId.get(1302007), 3000); // 카알 대검 (info/price 1500)
    assert.equal(byId.get(1332000), 4000); // 삼각 자마다르 (info/price 2000)
    assert.equal(byId.get(1332006), 7000); // 필드 대거 (info/price 3500)
    // 검 (1302000) is a different shelf - NPC 11000 asks 50 for it, while the item's own
    // `info/price` is 1, which is a placeholder rather than a price anyone ever meant.
    const swordShelf = new Map(
      keeper
        .linesOf(shopDefOf(npcShopOf(archive!, 11000)!)!)
        .map((line) => [line.itemId, line.price]),
    );
    assert.equal(swordShelf.get(1302000), 50);
    // ...and the buy path charges that same number.
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 100000;
    const wallet = new MesoWallet(stats);
    const bought = keeper.buy(items, wallet, weaponShop, 1332000, 1);
    assert.equal(bought.kind, "bought");
    if (bought.kind !== "bought") return;
    assert.equal(bought.total, 4000, "the shop row's price, not the item's 2000");
    assert.equal(wallet.balance, 96000);
  },
);

test(
  "the rows the client is sent carry the shop's price, the row's cap and its recharge rate",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const lines = keeper.linesOf(starShopOf());
    // 샘 (1011001) stocks the eight star sets, each at the shop's own price with its own cap.
    // The cap of a 207 row is its `info/slotMax` (4B3780 reads +32 as the set's capacity), not
    // the ordinary buy-dialog cap.
    assert.deepEqual(
      lines
        .filter((line) => Math.floor(line.itemId / 10000) === 207)
        .map((line) => [line.itemId, line.price, line.maxCount, shopRechargeUnitPrice(line)]),
      [
        [2070000, 500, 500, 0.3], // 수비 표창
        [2070001, 500, 500, 0.4], // 월비 표창
        [2070002, 1000, 700, 0.5], // 목비 표창
        [2070003, 1500, 500, 0.6], // 금비 표창
        [2070004, 2500, 400, 0.6], // 토비 표창
        [2070005, 2500, 600, 0.7], // 뇌전 수리검
        [2070006, 5000, 800, 0.8], // 일비 표창
        [2070007, 25000, 600, 1], // 화비 표창
      ],
    );
    // The 8 extra bytes on a 207 row are the per-charge price as an LE float64 (`sub_47A1D0`),
    // not a cash serial - the recharge total is what the UI multiplies this with.
    const starRow = lines.find((line) => line.itemId === 2070000)!;
    assert.equal(shopRechargeUnitPrice(starRow), 0.3);
    // The per-charge rate is the ROW's own too, not the item's `info/unitPrice`: 40 of the 48
    // rechargeable rows agree, but the 24시간 포장마차 (1061001) charges whole mesos per charge
    // (1, 2, 3, ...) where the item itself says 0.3, 0.4, 0.5, ...
    const cart = keeper.linesOf(shopDefOf(npcShopOf(archive!, 1061001)!)!);
    assert.deepEqual(
      cart
        .filter((line) => line.itemId >= 2070000 && line.itemId < 2070003)
        .map((line) => [line.itemId, shopRechargeUnitPrice(line)]),
      [
        [2070000, 1],
        [2070001, 2],
        [2070002, 3],
      ],
    );
    // Equipment is one at a time (the row's cap is 1); ordinary goods take the buy-dialog cap,
    // which is this repository's choice because the archive does not carry one.
    const weapon = lines.find((line) => line.itemId === 1002008)!;
    assert.equal(weapon.maxCount, 1);
    // A row neither the shop nor the archive can price is skipped rather than sent as 0 - the
    // client would print that 0. A shop no longer silently gains every rechargeable in the game:
    // it sells what its own `info/shop` node says it sells (ADR-140).
    const unpriced = { shopId: 1, npcTemplateId: 1, items: [{ itemId: 5000000 }] };
    assert.deepEqual(keeper.linesOf(unpriced), []);
  },
);

test("buying deducts the mesos and grants the item", needsArchive, () => {
  const keeper = shopKeeper(archive!);
  const shop = potionShopOf();
  const items = startingCharacterItems();
  const stats = zeroStats();
  stats.mesos = 100;
  const wallet = new MesoWallet(stats);
  const outcome = keeper.buy(items, wallet, shop, 2000000, 2);
  assert.equal(outcome.kind, "bought");
  if (outcome.kind !== "bought") return;
  // 50 is the SHOP's price for a 빨간 포션; the item's own `info/price` is 25 (ADR-140).
  assert.equal(outcome.unitPrice, 50);
  assert.equal(outcome.total, 100);
  assert.equal(outcome.mesos, 0);
  assert.equal(stats.mesos, 0);
  assert.equal(outcome.change.op, INVENTORY_OP.put);
  assert.equal(items.inventories[1]!.items.get(outcome.slot)?.itemId, 2000000);
});

test(
  "a purchase the wallet cannot pay for, or one the shop will not sell, is refused",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const shop = potionShopOf();
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 30;
    const wallet = new MesoWallet(stats);
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000003, 1), {
      kind: "failed",
      reason: "notEnoughMesos",
    }); // 파란 포션 is 200 at this shop, the wallet has 30
    assert.equal(stats.mesos, 30); // nothing moved
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000000, 0), {
      kind: "failed",
      reason: "badRequest",
    });
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000000, 201), {
      kind: "failed",
      reason: "badRequest",
    });
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000001, 1), {
      kind: "failed",
      reason: "notEnoughMesos",
    }); // 주황 포션 is 160 here
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000002, 1), {
      kind: "failed",
      reason: "notEnoughMesos",
    }); // 하얀 포션 is 320 here
    // An item no ordinary shop stocks is not in this shop either.
    assert.deepEqual(keeper.buy(items, wallet, shop, 4000019, 1), {
      kind: "failed",
      reason: "notInShop",
    });
  },
);

test("selling pays half the item's price and takes the stack down correctly", needsArchive, () => {
  assert.equal(SELL_PRICE_RATIO, 0.5);
  const keeper = shopKeeper(archive!);
  const items = startingCharacterItems();
  const granted = grantItem(items, 2000000, 5);
  assert.ok(granted);
  const stats = zeroStats();
  const wallet = new MesoWallet(stats);
  const first = keeper.sell(items, wallet, granted.slot, 2000000, 2);
  assert.equal(first.kind, "sold");
  if (first.kind !== "sold") return;
  assert.equal(first.unitPrice, 12); // floor(25 * 0.5)
  assert.equal(first.total, 24);
  assert.equal(stats.mesos, 24);
  assert.equal(first.change.op, INVENTORY_OP.put); // the slot keeps the 3 left over
  const left = items.inventories[1]!.items.get(granted.slot);
  assert.equal(left?.kind === "nonequip" ? left.quantity : -1, 3);
  const second = keeper.sell(items, wallet, granted.slot, 2000000, 3);
  assert.equal(second.kind, "sold");
  if (second.kind !== "sold") return;
  assert.equal(second.change.op, INVENTORY_OP.clear); // the stack is gone
  assert.equal(items.inventories[1]!.items.get(granted.slot), undefined);
  assert.equal(stats.mesos, 60);
});

test("selling what is not there, or what cannot be priced, is refused", needsArchive, () => {
  const keeper = shopKeeper(archive!);
  const items = startingCharacterItems();
  const granted = grantItem(items, 2000000, 1);
  assert.ok(granted);
  const stats = zeroStats();
  const wallet = new MesoWallet(stats);
  assert.deepEqual(keeper.sell(items, wallet, granted.slot, 2000000, 2), {
    kind: "failed",
    reason: "notEnoughItems",
  });
  assert.deepEqual(keeper.sell(items, wallet, granted.slot + 1, 2000000, 1), {
    kind: "failed",
    reason: "notEnoughItems",
  });
  assert.deepEqual(keeper.sell(items, wallet, granted.slot, 2000001, 1), {
    kind: "failed",
    reason: "notEnoughItems",
  });
  assert.deepEqual(keeper.sell(items, wallet, granted.slot, 5000000, 1), {
    kind: "failed",
    reason: "unsellable",
  });
  assert.equal(stats.mesos, 0); // nothing paid out
  assert.equal(items.inventories[1]!.items.get(granted.slot)?.itemId, 2000000); // and nothing taken
});

// ---------------------------------------------------------------------------
// the 207 star set: bought whole, recharged by the missing charges, sold whole
// ---------------------------------------------------------------------------

test(
  "a star set bought from the shelf is one complete set in its own slot, never a merge",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const starShop = starShopOf();
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 1000;
    const wallet = new MesoWallet(stats);
    // The shelf sells a *set*: the wire count is fixed at 1 (the original whole-set confirmation)
    // and what lands in the bag is a full slotMax stack. The money is the SHOP ROW's price -
    // 샘 asks 500 for 2070000, while the item's own `info/price` is 250 (ADR-140).
    const outcome = keeper.buy(items, wallet, starShop, 2070000, 1);
    assert.equal(outcome.kind, "bought");
    if (outcome.kind !== "bought") return;
    assert.equal(outcome.unitPrice, 500);
    assert.equal(outcome.total, 500);
    assert.equal(outcome.count, 500, "granted at the WZ slotMax - a complete set, not one charge");
    const set = items.inventories[1]!.items.get(outcome.slot)!;
    assert.ok(set.kind === "nonequip" && set.quantity === 500);
    // A second set does not stack into the first: every set is its own object, in its own slot.
    const second = keeper.buy(items, wallet, starShop, 2070000, 1);
    assert.equal(second.kind, "bought");
    if (second.kind !== "bought") return;
    assert.notEqual(second.slot, outcome.slot);
    assert.equal(wallet.balance, 0, "1000 - two sets at the shop's own price of 500");
    // Two sets in one transaction is not a shape the shelf sells: the row's cap is 1.
    assert.deepEqual(keeper.buy(items, wallet, starShop, 2070000, 2), {
      kind: "failed",
      reason: "badRequest",
    });
  },
);

test(
  "recharge fills a partial star set to its WZ slotMax for ceil(missing × unitPrice)",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const starShop = starShopOf();
    const items = startingCharacterItems();
    items.inventories[1]!.items.set(2, nonEquipSlot(2070000, 100));
    const stats = zeroStats();
    stats.mesos = 1000;
    const wallet = new MesoWallet(stats);
    // Any WZ shop offers the service: the eight 207 rows are appended to every shelf (4B3780), so
    // 리나's potion shop recharges stars exactly like 마이's does.
    const outcome = keeper.recharge!(items, wallet, starShop, 2);
    assert.equal(outcome.kind, "recharged");
    if (outcome.kind !== "recharged") return;
    assert.equal(outcome.itemId, 2070000);
    assert.equal(outcome.count, 400, "the missing charges are what the trade is about");
    assert.equal(outcome.unitPrice, 0.3, "the WZ `info/unitPrice` double");
    assert.equal(outcome.total, 120, "ceil(400 × 0.3)");
    assert.equal(outcome.inventory, 2);
    assert.equal(outcome.slot, 2);
    assert.equal(outcome.mesos, 880);
    assert.deepEqual(outcome.change, {
      op: INVENTORY_OP.put,
      inventory: 2,
      slot: 2,
      item: nonEquipSlot(2070000, 500),
    });
    const held = items.inventories[1]!.items.get(2)!;
    assert.ok(held.kind === "nonequip" && held.quantity === 500 && held.cash === null);
    assert.equal(wallet.balance, 880);
    assert.equal(stats.mesos, 880, "the wallet writes through to the character record");
  },
);

test("recharge rounds the raw double up: the wallet pays ceil, never floor", needsArchive, () => {
  const keeper = shopKeeper(archive!);
  const starShop = starShopOf();
  const items = startingCharacterItems();
  items.inventories[1]!.items.set(1, nonEquipSlot(2070001, 497));
  const stats = zeroStats();
  stats.mesos = 2;
  const wallet = new MesoWallet(stats);
  // 3 missing × 0.4 = 1.2000000000000002 in raw IEEE754. The native UI calculates with the raw
  // double (`sub_4B4AD0`); charging ceil() is this server's explicit reconstruction policy, and 2
  // mesos - not 1 - is the price of those three charges.
  const outcome = keeper.recharge!(items, wallet, starShop, 1);
  assert.equal(outcome.kind, "recharged");
  if (outcome.kind !== "recharged") return;
  assert.equal(outcome.total, 2);
  assert.equal(wallet.balance, 0);
  // One meso short: notEnoughMesos, and the refusal touches neither the set nor the wallet.
  const poor = startingCharacterItems();
  poor.inventories[1]!.items.set(1, nonEquipSlot(2070001, 497));
  const poorStats = zeroStats();
  poorStats.mesos = 1;
  const poorWallet = new MesoWallet(poorStats);
  assert.deepEqual(keeper.recharge!(poor, poorWallet, starShop, 1), {
    kind: "failed",
    reason: "notEnoughMesos",
  });
  const held = poor.inventories[1]!.items.get(1)!;
  assert.ok(held.kind === "nonequip" && held.quantity === 497, "the set stays partial");
  assert.equal(poorWallet.balance, 1);
});

test(
  "what recharge refuses: a full set, a slot that is not stars, a slot that is not there",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const starShop = starShopOf();
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 10000;
    const wallet = new MesoWallet(stats);
    // A full set has nothing missing: badRequest before any money moves (`sub_4B7130` only sends
    // when the client's own computed value is nonzero, and the server re-checks the real slot).
    items.inventories[1]!.items.set(1, nonEquipSlot(2070000, 500));
    assert.deepEqual(keeper.recharge!(items, wallet, starShop, 1), {
      kind: "failed",
      reason: "badRequest",
    });
    // A potion is not rechargeable: no WZ 207 info for it, so notInShop.
    items.inventories[1]!.items.set(2, nonEquipSlot(2000000, 5));
    assert.deepEqual(keeper.recharge!(items, wallet, starShop, 2), {
      kind: "failed",
      reason: "notInShop",
    });
    // An empty slot, and a slot number that cannot exist: notEnoughItems.
    assert.deepEqual(keeper.recharge!(items, wallet, starShop, 3), {
      kind: "failed",
      reason: "notEnoughItems",
    });
    assert.deepEqual(keeper.recharge!(items, wallet, starShop, 0), {
      kind: "failed",
      reason: "notEnoughItems",
    });
    // A cash-serial set is a cash object, not a WZ star set: notEnoughItems (the page's 충전 button
    // is disabled for exactly these, main.js).
    items.inventories[1]!.items.set(
      4,
      nonEquipSlot(2070000, 100, { cash: { sn: 1n, unknown18: 0, unknown1A: 0n } }),
    );
    assert.deepEqual(keeper.recharge!(items, wallet, starShop, 4), {
      kind: "failed",
      reason: "notEnoughItems",
    });
    // Nothing moved anywhere.
    assert.equal(wallet.balance, 10000);
    const full = items.inventories[1]!.items.get(1)!;
    assert.ok(full.kind === "nonequip" && full.quantity === 500);
  },
);

test(
  "a star set sells whole - full or depleted - for floor((setPrice + ceil(count × unitPrice)) × 0.5)",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const items = startingCharacterItems();
    items.inventories[1]!.items.set(1, nonEquipSlot(2070000, 100));
    items.inventories[1]!.items.set(2, nonEquipSlot(2070000, 0)); // a depleted set is still one object
    const stats = zeroStats();
    const wallet = new MesoWallet(stats);
    // `sub_4B4AD0`: the sold value's base is info/price + ceil(quantity × unitPrice) = 250 + 30;
    // the server's existing sell ratio halves that. The count must *be* the whole set.
    const sold = keeper.sell(items, wallet, 1, 2070000, 100);
    assert.equal(sold.kind, "sold");
    if (sold.kind !== "sold") return;
    assert.equal(sold.total, 140);
    assert.equal(sold.unitPrice, 125, "the per-unit basis; for a set the total is authoritative");
    assert.equal(sold.mesos, 140);
    assert.deepEqual(sold.change, { op: INVENTORY_OP.clear, inventory: 2, slot: 1 });
    assert.equal(items.inventories[1]!.items.has(1), false, "the set is gone, not left at 0");
    // The depleted set sells for its base alone: count 0 is the legal shape for it (4D5C80), and
    // floor(250 × 0.5) = 125 is what a bag of nothing-but-the-pouch is worth.
    const empty = keeper.sell(items, wallet, 2, 2070000, 0);
    assert.equal(empty.kind, "sold");
    if (empty.kind !== "sold") return;
    assert.equal(empty.total, 125);
    assert.equal(wallet.balance, 265);
    // A partial sale would create charges (or money) out of nothing: refused, set untouched.
    items.inventories[1]!.items.set(3, nonEquipSlot(2070000, 100));
    assert.deepEqual(keeper.sell(items, wallet, 3, 2070000, 50), {
      kind: "failed",
      reason: "badRequest",
    });
    const held = items.inventories[1]!.items.get(3)!;
    assert.ok(held.kind === "nonequip" && held.quantity === 100);
  },
);

test("a failure code is one of the messages the client can print", () => {
  assert.equal(shopResultCode("notEnoughMesos"), SHOP_RESULT.notEnoughMesos);
  assert.equal(shopResultCode("notEnoughSlots"), SHOP_RESULT.notEnoughSlots);
  assert.equal(shopResultCode("notEnoughItems"), SHOP_RESULT.notEnoughItems);
  assert.equal(shopResultCode("unsellable"), SHOP_RESULT.notEnoughItems2);
  assert.equal(shopResultCode("notInShop"), SHOP_RESULT.notEnoughItems);
  assert.equal(shopResultCode("badRequest"), SHOP_RESULT.error);
  // The client's switch has cases 0..4 and a default, so every code this server sends is either one
  // of the five or lands on the default ("오류가 발생해 거래를 하지 못했습니다").
  for (const failure of [
    "notEnoughMesos",
    "notEnoughSlots",
    "notEnoughItems",
    "unsellable",
    "notInShop",
    "badRequest",
  ] as const) {
    const code = shopResultCode(failure);
    assert.ok(
      (code >= 0 && code <= 4) || code > 4,
      `${failure} -> ${code} is neither a case nor the default of the client's switch`,
    );
  }
  assert.ok(
    shopResultCode("badRequest") > 4,
    "an unusable request is the client's error line, not a case",
  );
});

test("without an archive no shop can be priced, so nothing is sold and nothing is bought", () => {
  const keeper = shopKeeper(undefined);
  assert.equal(keeper.priceOf(2000000), undefined);
  assert.deepEqual(keeper.shopsOfNpc(), [], "no data, no shops - the rule `serve` already follows");
  assert.deepEqual(keeper.linesOf(AMHERST_WEAPON_SHOP), []);
  const items = startingCharacterItems();
  const stats = zeroStats();
  const wallet = new MesoWallet(stats);
  assert.deepEqual(keeper.buy(items, wallet, AMHERST_WEAPON_SHOP, 2000000, 1), {
    kind: "failed",
    reason: "notInShop",
  });
});

test("what a shop sells is something the use path understands", needsArchive, () => {
  // A shop row is only worth a slot if using the item does something: every consumable either
  // restores a vital (the `0x18` families) or names a map (the `0x19` one), out of its own `spec`.
  // The archive's shops sell equipment as well as consumables (ADR-140 - the old hand-written
  // table only ever stocked potions and scrolls), so "is this row worth a slot" is asked per
  // family: a consumable must have a `spec`, a 207 must be rechargeable, and equipment must be
  // an item the archive actually has.
  for (const shop of shopsOf(archive!)) {
    for (const entry of shop.items) {
      const family = Math.floor(entry.itemId / 10000);
      // Stars are ammunition, not a use item: a 207 has no `spec` and `0x18` would refuse it. Its
      // shop-side path is the recharge service (`sub_4B7130` → `0x16` action 2), validated by the
      // WZ `info` (slotMax/unitPrice) instead - asserted right below.
      // Ammunition is not a use item at all: 207 stars (rechargeable) and 206 arrow quivers.
      if (family === 207 || family === 206) continue;
      if (isEquipItemId(entry.itemId)) {
        assert.ok(
          itemPrice(archive!, entry.itemId) !== undefined || entry.price !== undefined,
          `${entry.itemId} is equipment the archive does not have`,
        );
        continue;
      }
      // A 204 scroll is not swallowed for an effect - it is spent on a piece of equipment, so its
      // "does something" proof is the scroll spec, not a consume spec.
      if (family === 204) {
        assert.ok(
          scrollSpecOf(archive!, entry.itemId) !== undefined,
          `${entry.itemId} is a scroll the archive cannot read`,
        );
        continue;
      }
      const spec = consumeSpecOf(archive!, entry.itemId);
      assert.ok(spec !== undefined, `${entry.itemId} has no spec`);
      // Three shapes of "does something": restores a vital, names a map, or grants a timed
      // mechanic (민첩함의 물약 2002000 is +eva for 3 minutes - no heal, no move).
      const doesSomething =
        healsVitals(spec!) ||
        spec!.moveTo !== undefined ||
        (spec!.time !== undefined &&
          (["mad", "pad", "acc", "eva", "pdd", "speed"] as const).some(
            (field) => spec![field] !== undefined,
          ));
      assert.equal(doesSomething, true, `${entry.itemId} (family ${family}) would do nothing`);
    }
  }
  // A star set is something the *recharge* path understands: capped by its WZ slotMax (500),
  // carrying the per-charge float, and no use spec at all - drinking a throwing star is not a
  // thing the client has. Its price is the shop row's own (샘 1011001 asks 500 for 2070000),
  // which is NOT the item's `info/price` of 250 - that difference is what ADR-140 fixed.
  const keeper = shopKeeper(archive!);
  const starShop = starShopOf();
  const starLine = keeper.linesOf(starShop).find((line) => line.itemId === 2070000);
  assert.equal(starLine?.price, 500);
  assert.equal(starLine?.maxCount, 500);
  assert.equal(shopRechargeUnitPrice(starLine!), 0.3);
  assert.equal(consumeSpecOf(archive!, 2070000), undefined);
  // The two scrolls, specifically: -1 is the town `reviveMapId` answers with, and 100000000 is
  // 헤네시스 named outright - the one that makes a map change observable in a test.
  assert.equal(consumeSpecOf(archive!, 2030000)?.moveTo, -1);
  assert.equal(consumeSpecOf(archive!, 2030004)?.moveTo, 100000000);
  assert.equal(itemPrice(archive!, 2030004), 90);
});

test(
  "the shop id of every row is the NPC that opens it (a stable key, not a shared counter)",
  needsArchive,
  () => {
    const shops = shopsOf(archive!);
    const ids = shops.map((shop) => shop.shopId);
    assert.deepEqual(
      ids,
      shops.map((shop) => shop.npcTemplateId),
    );
    assert.equal(new Set(ids).size, ids.length);
  },
);

test("a shop sells out of its own stock and refills it after its period", needsArchive, () => {
  // `info/shop/<item>/stock` is units on hand and `period` the refill interval in hours - the
  // archive only ever uses 4, 6 and 12, all of which divide the 24 hours of a day (ADR-140).
  // 루시 (11100) keeps 100000 of each potion and refills every 4 hours.
  const keeper = shopKeeper(archive!);
  const shop = shopDefOf(npcShopOf(archive!, 11100)!)!;
  const row = shop.items.find((entry) => entry.itemId === 2000000)!;
  assert.equal(row.stock, 100000);
  assert.equal(row.period, 4);
  assert.deepEqual(
    [...new Set(shopsOf(archive!).flatMap((s) => s.items.map((e) => e.period)))].sort(
      (a, b) => (a ?? 0) - (b ?? 0),
    ),
    [4, 6, 12],
    "every period in the archive divides a 24-hour day",
  );

  // A shelf of exactly two units: buy two, and the third is refused - with the one result byte
  // the client can print for it ("물품이 부족합니다", the goods are not there).
  const tiny: ShopDef = {
    shopId: 900001,
    npcTemplateId: 900001,
    items: [{ itemId: 2000000, price: 10, stock: 2, period: 6 }],
  };
  const wallet = new MesoWallet(Object.assign(zeroStats(), { mesos: 1000 }));
  const items = startingCharacterItems();
  assert.equal(keeper.buy(items, wallet, tiny, 2000000, 1).kind, "bought");
  assert.equal(keeper.buy(items, wallet, tiny, 2000000, 1).kind, "bought");
  assert.deepEqual(keeper.buy(items, wallet, tiny, 2000000, 1), {
    kind: "failed",
    reason: "outOfStock",
  });
  assert.equal(shopResultCode("outOfStock"), 1); // 물품이 부족합니다
  // Nothing was charged for the refusal.
  assert.equal(wallet.balance, 980);

  // A row with no `stock` of its own is not a limited shelf - a hand-written row still sells.
  const endless: ShopDef = {
    shopId: 900002,
    npcTemplateId: 900002,
    items: [{ itemId: 2000000, price: 10 }],
  };
  for (let i = 0; i < 5; i++)
    assert.equal(keeper.buy(items, wallet, endless, 2000000, 1).kind, "bought");
});
