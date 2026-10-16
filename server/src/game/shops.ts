/**
 * NPC shops: which NPC sells what, what it costs, and the two transactions the shop window can ask
 * for. The wire formats live in `protocol/shop.ts`; this module is the server's side of them.
 *
 * WHAT IS EVIDENCE
 * ----------------
 * The *prices* are the client's own data: every item in `Item/Consume/0200.img` carries
 * `info/price` (빨간 포션 25, 주황 포션 80, 하얀 포션 160, 파란 포션 100, and the 엘릭서 line at
 * 1000/2500/310), and that is the number the shop window prints. `itemPrice` reads it out of the
 * archive, so a shop never invents a price - an item the file does not price cannot be sold here at
 * all (`ShopLine` has no price to carry).
 *
 * WHAT IS A CHOICE (like the drop rates, ADR-007/ADR-010)
 * ------------------------------------------------------
 * The bundle: `Item/` in this build has no shop data and no prices outside the items themselves -
 * shop stock lived on the 2003 server as scripts, and that server is gone. So which NPC keeps a
 * shop, which items it stocks, how many of one item a customer may buy at once, and how much a sale
 * pays (a fraction of `info/price`) are this repository's decisions, named constants below and
 * pinned by `test/shops.test.ts`. They are all replaceable without touching the network layer.
 *
 * The client is told the price in `0x4A` itself (`u32 price` per row), so a disagreement between
 * this table and the archive would show up on screen - `shopLines` therefore refuses to build a row
 * whose price it cannot read, instead of sending 0.
 */
import { infoOf, propertyOf } from "../wz/props.ts";
import { itemImagePath } from "../wz/paths.ts";
import type { WzArchive } from "../wz/archive.ts";
import type { CharacterItems } from "../protocol/chardata.ts";
import { grantItem, takeItem, type MesoWallet } from "./rewards.ts";
import type { InventoryChange } from "../protocol/inventory.ts";
import { SHOP_RESULT, type ShopLine } from "../protocol/shop.ts";

/**
 * The most of one item a single purchase may take - the quantity the client's buy dialog starts at
 * and caps at (the shop list's `u16 maxCount`, FINDINGS 4.22). A choice: the wire could carry more,
 * and the client will not stop the server from sending a bigger row.
 */
export const DEFAULT_SHOP_MAX_COUNT = 200;

/**
 * What a sale pays, as a fraction of the item's own `info/price`.
 *
 * A **choice**: the client only ever shows the buy price, and the 2003 trade-in rate is not in the
 * binary. One half is the convention this repository starts from.
 */
export const SELL_PRICE_RATIO = 0.5;

/** One row of a shop's stock: the item, and how many of it one purchase may take. */
export interface ShopEntry {
  itemId: number;
  /** Defaults to `DEFAULT_SHOP_MAX_COUNT`. */
  maxCount?: number;
}

/**
 * A shop an NPC opens: the dialogue the client shows and the rows it fills.
 *
 * `shopId` is what the `0x4A` packet carries (`dlg+144`); the client never sends it back, so the
 * server only needs it to be stable per shop. Using the NPC's template id keeps it free of a
 * separate numbering scheme.
 */
export interface ShopDef {
  shopId: number;
  /** `Npc/<id>.img` - the NPC (the map's `life` id) that opens this shop when clicked. */
  npcTemplateId: number;
  items: readonly ShopEntry[];
}

/**
 * The three shops this server opens, on three shop-NPCs the shipping maps actually have.
 *
 * `1010100` 리나 (헤네시스, map 100000000), `2003` 로빈 (달팽이사냥터, map 40000) and `12100` 마이
 * (암허스트, map 1010000) are NPCs `life` puts in those maps; *that* they keep a shop is this
 * table's decision, and they sell the potions and the two town scrolls the archive prices.
 * Equipment is deliberately absent: in this build equipment images live under
 * `Character/<type>/<id>.img`, not `Item/`, and nothing located says how a shop row for one is
 * priced.
 *
 * 암허스트's shop is the one a **new player** can reach: `--map` starts a character in 1000000
 * (암허스트서쪽필드, which has no shop NPC of its own) and the first town the data leads to is
 * 1010000 - the same town `reviveMapId` puts a dead player back into. 마을 귀환 주문서 (`02030000`)
 * is in every shop because it is the item that makes that trip repeatable, and 헤네시스 귀환
 * 주문서 (`02030004`) is the one that names a town outright, which is what makes a *map change* by
 * item observable (`handleUseItem` -> `enterMap`). Both cost what the archive says (75 / 90).
 */
export const SHOPS: readonly ShopDef[] = [
  {
    shopId: 1010100, // 리나 - 헤네시스
    npcTemplateId: 1010100,
    items: [
      { itemId: 2000000 }, // 빨간 포션 (25)
      { itemId: 2000001 }, // 주황 포션 (80)
      { itemId: 2000002 }, // 하얀 포션 (160)
      { itemId: 2000003 }, // 파란 포션 (100)
      { itemId: 2000004 }, // 엘릭서 (1000)
      { itemId: 2030000 }, // 마을 귀환 주문서 (75)
    ],
  },
  {
    shopId: 2003, // 로빈 - 달팽이사냥터
    npcTemplateId: 2003,
    items: [
      { itemId: 2000000 }, // 빨간 포션 (25)
      { itemId: 2000003 }, // 파란 포션 (100)
      { itemId: 2030000 }, // 마을 귀환 주문서 (75)
    ],
  },
  {
    shopId: 12100, // 마이 - 암허스트
    npcTemplateId: 12100,
    items: [
      { itemId: 2000000 }, // 빨간 포션 (25)
      { itemId: 2000003 }, // 파란 포션 (100)
      { itemId: 2030000 }, // 마을 귀환 주문서 (75)
      { itemId: 2030004 }, // 헤네시스 귀환 주문서 (90)
    ],
  },
];

/** Why a trade did not happen. The caller turns this into the `0x4B` result byte. */
export type TradeFailure =
  | "notInShop"
  | "badRequest"
  | "notEnoughMesos"
  | "notEnoughSlots"
  | "notEnoughItems"
  | "unsellable";

/** A trade that happened, in the terms the three packets need. */
export interface TradeDone {
  kind: "bought" | "sold";
  itemId: number;
  count: number;
  /** Per unit, as the shop window showed it. */
  unitPrice: number;
  total: number;
  /** Tab and slot whose state changed - the `0x0B` change below says what to send. */
  inventory: number;
  slot: number;
  change: InventoryChange;
  /** The wallet's balance after the trade (`0x0D`, flag `0x40000`). */
  mesos: number;
}

/** The result of a buy or a sell. */
export type TradeOutcome = TradeDone | { kind: "failed"; reason: TradeFailure };

/** What a field session needs from the shop module, with the archive's prices already wired in. */
export interface ShopKeeper {
  /** The shop an NPC opens, or `undefined` for an NPC that just talks. */
  shopOfNpc(npcTemplateId: number): ShopDef | undefined;
  /** The `0x4A` rows for a shop: priced, cappable, and never a row without a price. */
  linesOf(shop: ShopDef): ShopLine[];
  /** `info/price` of an item, or `undefined` when the archive does not price it. */
  priceOf(itemId: number): number | undefined;
  /** What a sale of one unit pays. */
  sellPriceOf(itemId: number): number | undefined;
  buy(items: CharacterItems, wallet: MesoWallet, shop: ShopDef, itemId: number, count: number): TradeOutcome;
  sell(items: CharacterItems, wallet: MesoWallet, slot: number, itemId: number, count: number): TradeOutcome;
}

/** The item ids of a shop that the archive cannot price - the caller logs them, the shop skips them. */
export function unpricedShopItems(shop: ShopDef, priceOf: (itemId: number) => number | undefined): number[] {
  return shop.items.map((entry) => entry.itemId).filter((itemId) => priceOf(itemId) === undefined);
}

/**
 * The shop module over one archive.
 *
 * `archive` may be `undefined` (`--data off`), and then no shop can be priced: `linesOf` is empty
 * and every buy fails with `notInShop`, which is the same "no data, no drops" rule `serve` already
 * follows.
 */
export function shopKeeper(archive: WzArchive | undefined): ShopKeeper {
  const priceOf = (itemId: number): number | undefined => itemPrice(archive, itemId);
  const sellPriceOf = (itemId: number): number | undefined => {
    const price = priceOf(itemId);
    if (price === undefined) return undefined;
    return Math.floor(price * SELL_PRICE_RATIO);
  };
  const linesOf = (shop: ShopDef): ShopLine[] => {
    const lines: ShopLine[] = [];
    for (const entry of shop.items) {
      const price = priceOf(entry.itemId);
      if (price === undefined) continue; // no price, no row - never a 0 the client would print
      lines.push({ itemId: entry.itemId, price, maxCount: entry.maxCount ?? DEFAULT_SHOP_MAX_COUNT });
    }
    return lines;
  };
  return {
    shopOfNpc: (npcTemplateId) => SHOPS.find((shop) => shop.npcTemplateId === npcTemplateId),
    linesOf,
    priceOf,
    sellPriceOf,
    buy: (items, wallet, shop, itemId, count) => {
      const entry = shop.items.find((row) => row.itemId === itemId);
      if (entry === undefined) return { kind: "failed", reason: "notInShop" };
      const price = priceOf(itemId);
      if (price === undefined) return { kind: "failed", reason: "notInShop" };
      const maxCount = entry.maxCount ?? DEFAULT_SHOP_MAX_COUNT;
      if (!Number.isInteger(count) || count <= 0) return { kind: "failed", reason: "badRequest" };
      if (count > maxCount) return { kind: "failed", reason: "badRequest" };
      const total = price * count;
      if (wallet.balance < total) return { kind: "failed", reason: "notEnoughMesos" };
      const granted = grantItem(items, itemId, count);
      if (granted === undefined) return { kind: "failed", reason: "notEnoughSlots" };
      // The balance was checked above, so this cannot fail; if it ever did, the grant would have to
      // be taken back - which is exactly why the check comes first.
      wallet.spend(total);
      return {
        kind: "bought",
        itemId,
        count,
        unitPrice: price,
        total,
        inventory: granted.inventory,
        slot: granted.slot,
        change: granted.change,
        mesos: wallet.balance,
      };
    },
    sell: (items, wallet, slot, itemId, count) => {
      if (!Number.isInteger(count) || count <= 0) return { kind: "failed", reason: "badRequest" };
      const unitPrice = sellPriceOf(itemId);
      if (unitPrice === undefined) return { kind: "failed", reason: "unsellable" };
      const taken = takeItem(items, itemId, slot, count);
      if (taken === undefined) return { kind: "failed", reason: "notEnoughItems" };
      const total = unitPrice * count;
      wallet.earn(total);
      return {
        kind: "sold",
        itemId,
        count,
        unitPrice,
        total,
        inventory: taken.inventory,
        slot: taken.slot,
        change: taken.change,
        mesos: wallet.balance,
      };
    },
  };
}

/**
 * `info/price` of an item, straight out of its image (`Item/Consume/0200.img/02000000/info/price`).
 *
 * `undefined` for an item the archive does not have, or one whose `info` has no price - a shop deal
 * is never priced by this server.
 */
export function itemPrice(archive: WzArchive | undefined, itemId: number): number | undefined {
  if (archive === undefined) return undefined;
  const path = itemImagePath(itemId);
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  const node = propertyOf(root, String(itemId).padStart(8, "0"));
  const info = infoOf(node);
  return typeof info.price === "number" ? info.price : undefined;
}

/**
 * The `0x4B` byte for a refused trade.
 *
 * The codes are the client's own switch (`sub_4B73A0` case 75 → its message table), so a failure is
 * always something the client can *say*: the two "물품이 부족합니다" codes are 1 and 4, and which of
 * them the original server used for what is not located - this server uses 1 for "you do not have
 * it" and 4 for "this shop cannot buy it at all".
 */
export function shopResultCode(failure: TradeFailure): number {
  if (failure === "notEnoughMesos") return SHOP_RESULT.notEnoughMesos;
  if (failure === "notEnoughSlots") return SHOP_RESULT.notEnoughSlots;
  if (failure === "notEnoughItems") return SHOP_RESULT.notEnoughItems;
  if (failure === "unsellable") return SHOP_RESULT.notEnoughItems2;
  if (failure === "notInShop") return SHOP_RESULT.notEnoughItems;
  return SHOP_RESULT.error;
}
