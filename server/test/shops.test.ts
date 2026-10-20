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
  SHOPS,
  itemPrice,
  shopKeeper,
  shopResultCode,
  unpricedShopItems,
} from "../src/game/shops.ts";
import { MesoWallet, grantItem } from "../src/game/rewards.ts";
import { consumeSpecOf, healsVitals } from "../src/game/items.ts";
import { INVENTORY_OP } from "../src/protocol/inventory.ts";
import { nonEquipSlot } from "../src/protocol/itemslot.ts";
import { startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";

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
  "every shop row is priced by the archive, and the three shops name real NPCs",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    for (const shop of SHOPS) assert.deepEqual(unpricedShopItems(shop, keeper.priceOf), []);
    assert.equal(keeper.shopOfNpc(1010100)?.shopId, 1010100); // 리나, 헤네시스
    assert.equal(keeper.shopOfNpc(2003)?.shopId, 2003); // 로빈, 달팽이사냥터
    assert.equal(keeper.shopOfNpc(12100)?.shopId, 12100); // 마이, 암허스트
    assert.equal(keeper.shopOfNpc(2004), undefined); // an NPC without a shop
    assert.equal(keeper.priceOf(2000000), 25); // 빨간 포션
    assert.equal(keeper.priceOf(2000001), 80); // 주황 포션
    assert.equal(keeper.priceOf(2000002), 160); // 하얀 포션
    assert.equal(keeper.priceOf(2000003), 100); // 파란 포션
    assert.equal(keeper.priceOf(5000000), undefined); // a book: no price in this build
    assert.equal(itemPrice(archive!, 2000000), 25); // the reader behind every row
    assert.equal(itemPrice(undefined, 2000000), undefined); // `--data off` prices nothing
  },
);

test(
  "the rows the client is sent carry the archive's price and the shop's cap",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const lines = keeper.linesOf(SHOPS[0]!);
    assert.deepEqual(
      lines.map((line) => [line.itemId, line.price, line.maxCount]),
      [
        [2000000, 25, DEFAULT_SHOP_MAX_COUNT],
        [2000001, 80, DEFAULT_SHOP_MAX_COUNT],
        [2000002, 160, DEFAULT_SHOP_MAX_COUNT],
        [2000003, 100, DEFAULT_SHOP_MAX_COUNT],
        [2000004, 1000, DEFAULT_SHOP_MAX_COUNT],
        [2030000, 75, DEFAULT_SHOP_MAX_COUNT],
        // 4B3780: every WZ shop also carries the eight rechargeable 207 rows at price 0 - the
        // client files a price-0 row into its recharge list, never into the buy list. Slot caps
        // and unit floats are the archive's own (Item/Consume/0207.img, MESO_RECHARGE.md table).
        [2070000, 0, 500], // 수비 표창
        [2070001, 0, 500], // 월비 표창
        [2070002, 0, 700], // 목비 표창
        [2070003, 0, 500], // 금비 표창
        [2070004, 0, 400], // 토비 표창
        [2070005, 0, 600], // 뇌전 수리검
        [2070006, 0, 800], // 일비 표창
        [2070007, 0, 600], // 화비 표창
      ],
    );
    // The 8 extra bytes on a 207 row are the per-charge price as an LE float64 (`sub_47A1D0`),
    // not a cash serial - the recharge total is what the UI multiplies this with.
    const starRow = lines.find((line) => line.itemId === 2070000)!;
    assert.equal(shopRechargeUnitPrice(starRow), 0.3);
    // A row without a price is skipped rather than sent as 0 - the client would print the 0. The
    // 207 rows are the documented exception: there, price 0 *is* the mark of a recharge-only row,
    // so even a shop with nothing sellable still offers the eight star sets (4B3780).
    const unpriced = { shopId: 1, npcTemplateId: 1, items: [{ itemId: 5000000 }] };
    assert.deepEqual(
      keeper.linesOf(unpriced).map((line) => [line.itemId, line.price]),
      [
        [2070000, 0],
        [2070001, 0],
        [2070002, 0],
        [2070003, 0],
        [2070004, 0],
        [2070005, 0],
        [2070006, 0],
        [2070007, 0],
      ],
    );
    assert.deepEqual(unpricedShopItems(unpriced, keeper.priceOf), [5000000]);
  },
);

test("buying deducts the mesos and grants the item", needsArchive, () => {
  const keeper = shopKeeper(archive!);
  const items = startingCharacterItems();
  const stats = zeroStats();
  stats.mesos = 100;
  const wallet = new MesoWallet(stats);
  const shop = SHOPS[0]!;
  const outcome = keeper.buy(items, wallet, shop, 2000000, 2);
  assert.equal(outcome.kind, "bought");
  if (outcome.kind !== "bought") return;
  assert.equal(outcome.unitPrice, 25);
  assert.equal(outcome.total, 50);
  assert.equal(outcome.mesos, 50);
  assert.equal(stats.mesos, 50);
  assert.equal(outcome.change.op, INVENTORY_OP.put);
  assert.equal(items.inventories[1]!.items.get(outcome.slot)?.itemId, 2000000);
});

test(
  "a purchase the wallet cannot pay for, or one the shop will not sell, is refused",
  needsArchive,
  () => {
    const keeper = shopKeeper(archive!);
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 30;
    const wallet = new MesoWallet(stats);
    const shop = SHOPS[0]!;
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000003, 1), {
      kind: "failed",
      reason: "notEnoughMesos",
    }); // 100 mesos
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
    }); // 80
    assert.deepEqual(keeper.buy(items, wallet, shop, 2000002, 1), {
      kind: "failed",
      reason: "notEnoughMesos",
    }); // 160
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
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 1000;
    const wallet = new MesoWallet(stats);
    // The shelf sells a *set*: the wire count is fixed at 1 (the original whole-set confirmation),
    // the money is the set's WZ `info/price`, and what lands in the bag is a full slotMax stack.
    const outcome = keeper.buy(items, wallet, SHOPS[2]!, 2070000, 1);
    assert.equal(outcome.kind, "bought");
    if (outcome.kind !== "bought") return;
    assert.equal(outcome.unitPrice, 250);
    assert.equal(outcome.total, 250);
    assert.equal(outcome.count, 500, "granted at the WZ slotMax - a complete set, not one charge");
    const set = items.inventories[1]!.items.get(outcome.slot)!;
    assert.ok(set.kind === "nonequip" && set.quantity === 500);
    // A second set does not stack into the first: every set is its own object, in its own slot.
    const second = keeper.buy(items, wallet, SHOPS[2]!, 2070000, 1);
    assert.equal(second.kind, "bought");
    if (second.kind !== "bought") return;
    assert.notEqual(second.slot, outcome.slot);
    assert.equal(wallet.balance, 500);
    // Two sets in one transaction is not a shape the shelf sells: the row's cap is 1.
    assert.deepEqual(keeper.buy(items, wallet, SHOPS[2]!, 2070000, 2), {
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
    const items = startingCharacterItems();
    items.inventories[1]!.items.set(2, nonEquipSlot(2070000, 100));
    const stats = zeroStats();
    stats.mesos = 1000;
    const wallet = new MesoWallet(stats);
    // Any WZ shop offers the service: the eight 207 rows are appended to every shelf (4B3780), so
    // 리나's potion shop recharges stars exactly like 마이's does.
    const outcome = keeper.recharge!(items, wallet, SHOPS[0]!, 2);
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
  const items = startingCharacterItems();
  items.inventories[1]!.items.set(1, nonEquipSlot(2070001, 497));
  const stats = zeroStats();
  stats.mesos = 2;
  const wallet = new MesoWallet(stats);
  // 3 missing × 0.4 = 1.2000000000000002 in raw IEEE754. The native UI calculates with the raw
  // double (`sub_4B4AD0`); charging ceil() is this server's explicit reconstruction policy, and 2
  // mesos - not 1 - is the price of those three charges.
  const outcome = keeper.recharge!(items, wallet, SHOPS[0]!, 1);
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
  assert.deepEqual(keeper.recharge!(poor, poorWallet, SHOPS[0]!, 1), {
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
    const items = startingCharacterItems();
    const stats = zeroStats();
    stats.mesos = 10000;
    const wallet = new MesoWallet(stats);
    // A full set has nothing missing: badRequest before any money moves (`sub_4B7130` only sends
    // when the client's own computed value is nonzero, and the server re-checks the real slot).
    items.inventories[1]!.items.set(1, nonEquipSlot(2070000, 500));
    assert.deepEqual(keeper.recharge!(items, wallet, SHOPS[0]!, 1), {
      kind: "failed",
      reason: "badRequest",
    });
    // A potion is not rechargeable: no WZ 207 info for it, so notInShop.
    items.inventories[1]!.items.set(2, nonEquipSlot(2000000, 5));
    assert.deepEqual(keeper.recharge!(items, wallet, SHOPS[0]!, 2), {
      kind: "failed",
      reason: "notInShop",
    });
    // An empty slot, and a slot number that cannot exist: notEnoughItems.
    assert.deepEqual(keeper.recharge!(items, wallet, SHOPS[0]!, 3), {
      kind: "failed",
      reason: "notEnoughItems",
    });
    assert.deepEqual(keeper.recharge!(items, wallet, SHOPS[0]!, 0), {
      kind: "failed",
      reason: "notEnoughItems",
    });
    // A cash-serial set is a cash object, not a WZ star set: notEnoughItems (the page's 충전 button
    // is disabled for exactly these, main.js).
    items.inventories[1]!.items.set(
      4,
      nonEquipSlot(2070000, 100, { cash: { sn: 1n, unknown18: 0, unknown1A: 0n } }),
    );
    assert.deepEqual(keeper.recharge!(items, wallet, SHOPS[0]!, 4), {
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
  assert.deepEqual(keeper.linesOf(SHOPS[0]!), []);
  const items = startingCharacterItems();
  const stats = zeroStats();
  const wallet = new MesoWallet(stats);
  assert.deepEqual(keeper.buy(items, wallet, SHOPS[0]!, 2000000, 1), {
    kind: "failed",
    reason: "notInShop",
  });
});

test("what a shop sells is something the use path understands", needsArchive, () => {
  // A shop row is only worth a slot if using the item does something: every consumable either
  // restores a vital (the `0x18` families) or names a map (the `0x19` one), out of its own `spec`.
  for (const shop of SHOPS) {
    for (const entry of shop.items) {
      // Stars are ammunition, not a use item: a 207 has no `spec` and `0x18` would refuse it. Its
      // shop-side path is the recharge service (`sub_4B7130` → `0x16` action 2), validated by the
      // WZ `info` (slotMax/unitPrice) instead - asserted right below and in the recharge tests.
      if (Math.floor(entry.itemId / 10000) === 207) continue;
      const spec = consumeSpecOf(archive!, entry.itemId);
      assert.ok(spec !== undefined, `${entry.itemId} has no spec`);
      const family = Math.floor(entry.itemId / 10000);
      assert.equal(
        healsVitals(spec!) || spec!.moveTo !== undefined,
        true,
        `${entry.itemId} (family ${family}) would do nothing when used`,
      );
    }
  }
  // The star set on the reconstructed 마이 shelf is something the *recharge* path understands: a
  // priced row (250) capped by its WZ slotMax (500), carrying the per-charge float, and no use
  // spec at all - drinking a throwing star is not a thing the client has.
  const keeper = shopKeeper(archive!);
  const starLine = keeper.linesOf(SHOPS[2]!).find((line) => line.itemId === 2070000);
  assert.equal(starLine?.price, 250);
  assert.equal(starLine?.maxCount, 500);
  assert.equal(shopRechargeUnitPrice(starLine!), 0.3);
  assert.equal(consumeSpecOf(archive!, 2070000), undefined);
  // The two scrolls, specifically: -1 is the town `reviveMapId` answers with, and 100000000 is
  // 헤네시스 named outright - the one that makes a map change observable in a test.
  assert.equal(consumeSpecOf(archive!, 2030000)?.moveTo, -1);
  assert.equal(consumeSpecOf(archive!, 2030004)?.moveTo, 100000000);
  assert.equal(itemPrice(archive!, 2030004), 90);
});

test("the shop id of every row is the NPC that opens it (a stable key, not a shared counter)", () => {
  const ids = SHOPS.map((shop) => shop.shopId);
  assert.deepEqual(
    ids,
    SHOPS.map((shop) => shop.npcTemplateId),
  );
  assert.equal(new Set(ids).size, ids.length);
});
