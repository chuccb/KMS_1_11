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
 * WHERE THE SHOP DATA COMES FROM (ADR-140)
 * ----------------------------------------
 * It is in the archive, and it always was: **`Npc/<id>.img/info/shop`**. 20 of the 70 `Npc/*.img`
 * files carry one, 594 rows between them, each with its own `price`, `stock`, `period` and
 * (on the rechargeable 207 family) `unitPrice`. A previous reading of this module said the stock
 * had lived in 2003 server scripts that are gone; that was wrong, and it meant the server was
 * selling hand-picked items at the wrong prices.
 *
 * **The shop's `price` is not the item's `info/price`, and using the item's was a real bug.**
 * Of the 543 rows that carry a price, 541 disagree with the item's own `info/price` - by a factor
 * of 2 most of the time, but not always:
 *
 * | item | name | `info/price` | shop `price` |
 * |---|---|---|---|
 * | 1302000 | 검 | 1 | **50** |
 * | 1302007 | 카알 대검 | 1500 | **3000** |
 * | 1332000 | 삼각 자마다르 | 2000 | **4000** |
 * | 1402001 | 목검 | 1500 | **100** |
 *
 * So this module reads the shop row first and only falls back to `info/price` for the 8 rows that
 * carry no price of their own (all of them 207 rows, priced through `unitPrice` instead).
 *
 * `stock` and `period` are read and honoured: `stock` is how many units the shop holds, and it is
 * refilled to `stock` every `period` hours. That `period` is an interval in **hours** is an
 * inference, not something the client proves - the evidence is that the archive only ever uses
 * 4, 6 and 12, all of which divide the 24 hours of a day, and that they sort by category
 * (consumables 4, equipment 6 or 12). It is stated as an inference in FINDINGS and named by a
 * constant here, so it stays one line to change.
 *
 * WHAT IS STILL A CHOICE (like the drop rates, ADR-007/ADR-010)
 * -------------------------------------------------------------
 * How much a *sale* pays (`SELL_PRICE_RATIO`, a fraction of the price) and the buy-dialog cap for
 * ordinary goods (`DEFAULT_SHOP_MAX_COUNT`) are not in the archive. They are named constants below
 * and pinned by `test/shops.test.ts`, replaceable without touching the network layer.
 *
 * The client is told the price in `0x4A` itself (`u32 price` per row), so a disagreement between
 * this table and the archive would show up on screen - `linesOf` therefore refuses to build a row
 * whose price it cannot read, instead of sending 0.
 */
import { itemCatalogOf } from "./iteminfo.ts";
import { isEquipItemId } from "../protocol/itemslot.ts";
import { entriesOf, infoOf, propertyOf } from "../wz/props.ts";
import { itemImagePath, npcImagePath } from "../wz/paths.ts";
import type { WzArchive } from "../wz/archive.ts";
import type { CharacterItems } from "../protocol/chardata.ts";
import { grantItem, takeItem, type MesoWallet } from "./rewards.ts";
import type { InventoryChange } from "../protocol/inventory.ts";
import { INVENTORY_OP } from "../protocol/inventory.ts";
import { SHOP_RESULT, encodeRechargeUnitPrice, type ShopLine } from "../protocol/shop.ts";

/**
 * The most of one item a single purchase may take - the upper bound of the client's buy dialog
 * (which starts at 1), not the default quantity (the shop list's `u16 maxCount`, FINDINGS 4.22). A choice: the wire could carry more,
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

/**
 * Hours between two restocks, for a row whose `info/shop` entry carries no `period`.
 *
 * Every one of the 594 rows in this archive does carry one, and it is always 4, 6 or 12 - all
 * divisors of 24, which is why hours is the reading used. This constant exists so that a
 * hand-written row (the tests make them) has a defined behaviour rather than "never restocks".
 */
export const RESTOCK_FALLBACK_HOURS = 6;

/**
 * One row of a shop's stock.
 *
 * A row built from `Npc/<id>.img/info/shop` carries everything the archive gives; a hand-written
 * row (only the tests build one) may leave all of it out and fall back to the item's own `info`.
 */
export interface ShopEntry {
  itemId: number;
  /** The shop row's own `price`. Falls back to the item's `info/price`. */
  price?: number;
  /** Per-charge price, for the rechargeable 207 family. Falls back to `info/unitPrice`. */
  unitPrice?: number;
  /** How many units the shop holds, and what a restock refills it to. */
  stock?: number;
  /** Restock interval in hours; `RESTOCK_FALLBACK_HOURS` when the row does not say. */
  period?: number;
  /** Buy-dialog cap for ordinary goods; a 207 row uses the item's `slotMax` instead. */
  maxCount?: number;
}

/**
 * One row exactly as `Npc/<id>.img/info/shop/<itemId>` holds it.
 *
 * `price` is absent on 8 of the 594 rows - all of them 207 rows, which are priced per charge
 * through `unitPrice` instead.
 */
export interface NpcShopRow {
  itemId: number;
  price?: number;
  stock: number;
  period: number;
  unitPrice?: number;
}

/**
 * The shop an NPC keeps, read out of the archive.
 *
 * `Npc/<id>.img` keeps it under `info`, not at the top level - the top level has only `info` and
 * the animation nodes, which is why an earlier reading of these files found no shop at all.
 */
export interface NpcShop {
  npcTemplateId: number;
  rows: readonly NpcShopRow[];
}

/**
 * `Npc/<id>.img/info/shop`, or `undefined` for an NPC that just talks.
 *
 * A row the archive mis-shapes (an item id that is not a number) is skipped rather than fatal: the
 * other rows of the shop are still worth selling.
 */
export function npcShopOf(
  archive: WzArchive | undefined,
  npcTemplateId: number,
): NpcShop | undefined {
  if (!archive || !Number.isInteger(npcTemplateId) || npcTemplateId < 0) return undefined;
  // `Npc/%07d.img` - the original's own format string (`sub_411E50`), zero padded, so that
  // `Npc/0000220.img` resolves for template id 220.
  const path = npcImagePath(npcTemplateId);
  if (!archive.has(path)) return undefined;
  const shop = infoOf(archive.objects(path)[0]).shop;
  if (shop === undefined) return undefined;
  const rows: NpcShopRow[] = [];
  for (const entry of entriesOf(shop)) {
    const itemId = Number(entry.name);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) continue;
    const fields: Record<string, unknown> = {};
    for (const field of entriesOf(entry.value)) fields[field.name] = field.value;
    const row: NpcShopRow = {
      itemId,
      ...(typeof fields.price === "number" && fields.price >= 0 ? { price: fields.price } : {}),
      stock: typeof fields.stock === "number" && fields.stock >= 0 ? fields.stock : 0,
      period:
        typeof fields.period === "number" && fields.period > 0
          ? fields.period
          : RESTOCK_FALLBACK_HOURS,
    };
    if (typeof fields.unitPrice === "number" && fields.unitPrice > 0)
      row.unitPrice = fields.unitPrice;
    rows.push(row);
  }
  return { npcTemplateId, rows };
}

/**
 * Every `Npc/*.img` that carries a shop, in template-id order.
 *
 * Walks the archive's own `Npc/` images rather than a table of ids, so a shop added to the data
 * shows up without touching this module.
 */
export function npcShopsOf(archive: WzArchive | undefined): NpcShop[] {
  const out: NpcShop[] = [];
  if (!archive) return out;
  const ids: number[] = [];
  for (const [path] of (archive as unknown as { byPath: Map<string, unknown> }).byPath) {
    const match = /^Npc\/(\d+)\.img$/.exec(path);
    if (match) ids.push(Number(match[1]));
  }
  ids.sort((a, b) => a - b);
  for (const id of ids) {
    const shop = npcShopOf(archive, id);
    if (shop) out.push(shop);
  }
  return out;
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
 * Turn an archive shop into the `ShopDef` the rest of this module works with.
 *
 * `shopId` is what the `0x4A` packet carries (`dlg+144`); the client never sends it back, so the
 * server only needs it to be stable per shop. Using the NPC's template id keeps it free of a
 * separate numbering scheme.
 */
export function shopDefOf(npcShop: NpcShop): ShopDef {
  return {
    shopId: npcShop.npcTemplateId,
    npcTemplateId: npcShop.npcTemplateId,
    items: npcShop.rows.map((row) => ({
      itemId: row.itemId,
      ...(row.price === undefined ? {} : { price: row.price }),
      ...(row.unitPrice === undefined ? {} : { unitPrice: row.unitPrice }),
      stock: row.stock,
      period: row.period,
    })),
  };
}

/**
 * Every shop this server opens: the 20 `Npc/*.img` files that carry an `info/shop` node.
 *
 * None of them is the three NPCs the previous hand-written table picked - `1010100` 리나, `2003`
 * 로빈 and `12100` 마이 have no `shop` node at all in this archive, so that table was selling
 * invented stock at invented prices. The real ones are reachable from where a new player starts:
 * `--map` puts a character in 1000000 (암허스트서쪽필드), whose portal 4 leads to 1010000
 * (암허스트), and from there portal 2 leads to 1010001 (암허스트무기상점 - 칼 1011000 and 샘
 * 1011001) and portal 4 to 1010003 (암허스트잡화상점 - 루시 11100).
 *
 * `undefined` archive (`--data off`) gives no shops at all, which is the same "no data, no
 * drops" rule `serve` already follows.
 */
export function shopsOf(archive: WzArchive | undefined): readonly ShopDef[] {
  return npcShopsOf(archive).map(shopDefOf);
}

/** Why a trade did not happen. The caller turns this into the `0x4B` result byte. */
export type TradeFailure =
  | "notInShop"
  | "outOfStock"
  | "badRequest"
  | "notEnoughMesos"
  | "notEnoughSlots"
  | "notEnoughItems"
  | "unsellable";

/** A trade that happened, in the terms the three packets need. */
export interface TradeDone {
  kind: "bought" | "sold" | "recharged";
  itemId: number;
  count: number;
  /** Ordinary purchase/sale unit basis; a recharge uses its WZ per-charge rate. Total is authoritative for a set sale. */
  unitPrice: number;
  total: number;
  /** Tab and slot whose state changed - the `0x0B` change below says what to send. */
  inventory: number;
  slot: number;
  change: InventoryChange;
  /** The wallet's balance after the trade (`0x0D`, flag `0x40000`). */
  mesos: number;
}

/** The result of a purchase, sale, or recharge. */
export type TradeOutcome = TradeDone | { kind: "failed"; reason: TradeFailure };

/** What a field session needs from the shop module, with the archive's prices already wired in. */
export interface ShopKeeper {
  /** The shop an NPC opens, or `undefined` for an NPC that just talks. */
  shopOfNpc(npcTemplateId: number): ShopDef | undefined;
  /** Every shop the archive carries - 20 in this build. */
  shopsOfNpc(): readonly ShopDef[];
  /** The `0x4A` rows for a shop: priced, cappable, and never a row without a price. */
  linesOf(shop: ShopDef): ShopLine[];
  /** `info/price` of an item, or `undefined` when the archive does not price it. */
  priceOf(itemId: number): number | undefined;
  /** What a sale of one unit pays. */
  sellPriceOf(itemId: number): number | undefined;
  buy(
    items: CharacterItems,
    wallet: MesoWallet,
    shop: ShopDef,
    itemId: number,
    count: number,
  ): TradeOutcome;
  /** Optional for embedders with a custom keeper; real WZ shops implement this service. */
  recharge?(items: CharacterItems, wallet: MesoWallet, shop: ShopDef, slot: number): TradeOutcome;
  sell(
    items: CharacterItems,
    wallet: MesoWallet,
    slot: number,
    itemId: number,
    count: number,
  ): TradeOutcome;
}

/**
 * The item ids of a shop that can be neither priced by its own row nor by the archive - the caller
 * logs them and `linesOf` skips them.
 *
 * A row that carries its own `price` is never unpriced, however the *item's* `info` looks: the
 * two are different numbers and the row wins (ADR-140).
 */
export function unpricedShopItems(
  shop: ShopDef,
  priceOf: (itemId: number) => number | undefined,
): number[] {
  return shop.items
    .filter((entry) => (entry.price ?? priceOf(entry.itemId)) === undefined)
    .map((entry) => entry.itemId);
}

/**
 * The shop module over one archive.
 *
 * `archive` may be `undefined` (`--data off`), and then no shop can be priced: `linesOf` is empty
 * and every buy fails with `notInShop`, which is the same "no data, no drops" rule `serve` already
 * follows.
 */
export function shopKeeper(archive: WzArchive | undefined): ShopKeeper {
  const catalog = itemCatalogOf(archive);
  const priceOf = (itemId: number): number | undefined => catalog?.info(itemId)?.price;
  const sellPriceOf = (itemId: number): number | undefined => {
    const price = priceOf(itemId);
    if (price === undefined) return undefined;
    return Math.floor(price * SELL_PRICE_RATIO);
  };
  /** Per-charge rate of a 207 item. A shop row's own `unitPrice` wins over the item's `info`. */
  const unitPriceOf = (entry: ShopEntry): number | undefined => {
    if (Math.floor(entry.itemId / 10000) !== 207) return undefined;
    if (entry.unitPrice !== undefined) return entry.unitPrice;
    return catalog?.info(entry.itemId)?.unitPrice;
  };
  /**
   * The price one unit is sold at: **the shop row's own price**, not the item's `info/price`.
   * 541 of the 543 priced rows in this archive disagree with the item's own price, so reading the
   * item instead was charging the wrong amount for almost everything (ADR-140).
   */
  const buyPriceOf = (entry: ShopEntry): number | undefined => entry.price ?? priceOf(entry.itemId);
  // No fixed/fallback 200-stack limit for stars. The archive owns capacity and unit price.
  const rechargeInfo = (
    itemId: number,
  ): { itemId: number; maxCount: number; unitPrice: number; price: number } | undefined => {
    if (!archive || Math.floor(itemId / 10000) !== 207 || !archive.has(itemImagePath(itemId)))
      return undefined;
    const info = infoOf(
      propertyOf(archive.objects(itemImagePath(itemId))[0], String(itemId).padStart(8, "0")),
    );
    const { slotMax, unitPrice, price } = info;
    if (
      typeof slotMax !== "number" ||
      !Number.isInteger(slotMax) ||
      slotMax <= 0 ||
      slotMax > 32767 ||
      typeof unitPrice !== "number" ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      typeof price !== "number" ||
      !Number.isSafeInteger(price) ||
      price < 0
    )
      return undefined;
    return { itemId, maxCount: slotMax, unitPrice, price };
  };
  const rechargeables = new Map<number, NonNullable<ReturnType<typeof rechargeInfo>>>();
  const starPath = itemImagePath(2070000);
  if (archive?.has(starPath))
    for (const entry of entriesOf(archive.objects(starPath)[0])) {
      const info = rechargeInfo(Number(entry.name));
      if (info) rechargeables.set(info.itemId, info);
    }
  const linesOf = (shop: ShopDef): ShopLine[] => {
    const lines: ShopLine[] = [];
    for (const entry of shop.items) {
      const price = buyPriceOf(entry);
      if (price === undefined) continue; // no price, no row - never a 0 the client would print
      const unitPrice = unitPriceOf(entry);
      const cash = unitPrice === undefined ? undefined : encodeRechargeUnitPrice(unitPrice);
      // A 207 row without its per-charge rate is not a rechargeable the client can price.
      if (Math.floor(entry.itemId / 10000) === 207 && cash === undefined) continue;
      lines.push({
        ...(cash === undefined ? {} : { cash }),
        itemId: entry.itemId,
        price,
        // 4B3780: a 207 row's cap is the set's capacity; equipment is one at a time; the rest
        // take the buy-dialog cap, which the archive does not carry.
        maxCount: isEquipItemId(entry.itemId)
          ? 1
          : (rechargeables.get(entry.itemId)?.maxCount ?? entry.maxCount ?? DEFAULT_SHOP_MAX_COUNT),
      });
    }
    return lines;
  };
  const shops = shopsOf(archive);
  // On-hand counts, and when each row is next refilled. Deliberately in memory: a restart refills
  // every shop, which is the same "the world restarts with the process" rule the rest of `serve`
  // already follows, and it keeps the save format untouched.
  const onHand = new Map<string, { count: number; refillsAt: number }>();
  /** `shopId:itemId` - two numbers no shop can share, so one map is enough. */
  const stockKey = (shop: ShopDef, itemId: number): string => `${shop.shopId}:${itemId}`;
  const stockOf = (shop: ShopDef, entry: ShopEntry, now: number): number => {
    if (entry.stock === undefined) return Number.MAX_SAFE_INTEGER; // a hand-written row: unlimited
    const key = stockKey(shop, entry.itemId);
    const held = onHand.get(key);
    const refillsAt = held?.refillsAt ?? now + (entry.period ?? RESTOCK_FALLBACK_HOURS) * 3_600_000;
    // `period` is in hours (ADR-140): 4, 6 and 12 are the only values the archive uses.
    if (held === undefined || now >= refillsAt) {
      onHand.set(key, { count: entry.stock, refillsAt });
      return entry.stock;
    }
    return held.count;
  };
  const takeFromStock = (shop: ShopDef, entry: ShopEntry, units: number, now: number): boolean => {
    const held = stockOf(shop, entry, now);
    if (held < units) return false;
    const key = stockKey(shop, entry.itemId);
    const current = onHand.get(key);
    if (current) current.count = held - units;
    return true;
  };
  return {
    shopOfNpc: (npcTemplateId) => shops.find((shop) => shop.npcTemplateId === npcTemplateId),
    shopsOfNpc: () => shops,
    linesOf,
    priceOf,
    sellPriceOf: (itemId) => {
      const price = priceOf(itemId);
      return price === undefined ? undefined : Math.floor(price * SELL_PRICE_RATIO);
    },
    buy: (items, wallet, shop, itemId, count) => {
      const entry = shop.items.find((row) => row.itemId === itemId);
      if (entry === undefined) return { kind: "failed", reason: "notInShop" };
      const price = buyPriceOf(entry);
      if (price === undefined) return { kind: "failed", reason: "notInShop" };
      const recharge = rechargeables.get(itemId);
      if (Math.floor(itemId / 10000) === 207 && !recharge)
        return { kind: "failed", reason: "notInShop" };
      const maxCount = recharge ? 1 : (entry.maxCount ?? DEFAULT_SHOP_MAX_COUNT);
      if (!Number.isInteger(count) || count <= 0) return { kind: "failed", reason: "badRequest" };
      if (isEquipItemId(itemId) && count !== 1) return { kind: "failed", reason: "badRequest" };
      if (count > maxCount) return { kind: "failed", reason: "badRequest" };
      const total = price * count;
      if (wallet.balance < total) return { kind: "failed", reason: "notEnoughMesos" };
      const grantedCount = recharge?.maxCount ?? count;
      // A rechargeable is sold as one complete set, so that is what leaves the shelf.
      if (!takeFromStock(shop, entry, grantedCount, Date.now()))
        return { kind: "failed", reason: "outOfStock" };
      const granted = grantItem(items, itemId, grantedCount, undefined, catalog);
      if (granted === undefined) return { kind: "failed", reason: "notEnoughSlots" };
      // The balance was checked above, so this cannot fail; if it ever did, the grant would have to
      // be taken back - which is exactly why the check comes first.
      wallet.spend(total);
      return {
        kind: "bought",
        itemId,
        count: grantedCount,
        unitPrice: price,
        total,
        inventory: granted.inventory,
        slot: granted.slot,
        change: granted.change,
        mesos: wallet.balance,
      };
    },
    recharge: (items, wallet, shop, slot) => {
      const tab = items.inventories[1],
        item = tab?.items.get(slot);
      if (
        !Number.isInteger(slot) ||
        slot <= 0 ||
        !item ||
        item.kind !== "nonequip" ||
        item.cash !== null
      )
        return { kind: "failed", reason: "notEnoughItems" };
      const info = rechargeables.get(item.itemId);
      if (!info || !linesOf(shop).some((row) => row.itemId === item.itemId))
        return { kind: "failed", reason: "notInShop" };
      const missing = info.maxCount - item.quantity;
      if (!Number.isInteger(item.quantity) || item.quantity < 0 || missing <= 0)
        return { kind: "failed", reason: "badRequest" };
      // Native UI calculates the raw double; server rounding is an explicit reconstruction policy.
      const total = Math.ceil(missing * info.unitPrice);
      if (!Number.isSafeInteger(total) || total <= 0)
        return { kind: "failed", reason: "badRequest" };
      if (!wallet.spend(total)) return { kind: "failed", reason: "notEnoughMesos" };
      const next = { ...item, quantity: info.maxCount };
      tab!.items.set(slot, next);
      return {
        kind: "recharged",
        itemId: item.itemId,
        count: missing,
        unitPrice: info.unitPrice,
        total,
        inventory: 2,
        slot,
        change: { op: INVENTORY_OP.put, inventory: 2, slot, item: next },
        mesos: wallet.balance,
      };
    },
    sell: (items, wallet, slot, itemId, count) => {
      const recharge = rechargeables.get(itemId);
      if (!Number.isInteger(count) || count < 0 || (count === 0 && !recharge))
        return { kind: "failed", reason: "badRequest" };
      const unitPrice = sellPriceOf(itemId);
      if (unitPrice === undefined) return { kind: "failed", reason: "unsellable" };
      // A star set is a single object, including at zero charges. Never multiply the base set price
      // by its charge count or allow partial sales (either would create money/charges).
      const held = items.inventories[1]?.items.get(slot);
      if (
        Math.floor(itemId / 10000) === 207 &&
        (!recharge ||
          !held ||
          held.itemId !== itemId ||
          held.kind !== "nonequip" ||
          held.cash !== null ||
          held.quantity !== count ||
          count > recharge.maxCount)
      )
        return { kind: "failed", reason: "badRequest" };
      const total = recharge
        ? Math.floor((recharge.price + Math.ceil(count * recharge.unitPrice)) * SELL_PRICE_RATIO)
        : unitPrice * count;
      if (!Number.isSafeInteger(total) || wallet.balance + total > 0xffffffff)
        return { kind: "failed", reason: "badRequest" };
      const taken = takeItem(items, itemId, slot, count);
      if (taken === undefined) return { kind: "failed", reason: "notEnoughItems" };
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
  return itemCatalogOf(archive)?.info(itemId)?.price;
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
  // "물품이 부족합니다" - the goods are not there. The shop sold out, which is the one
  // situation that string was written for; the shop does not silently serve from nowhere.
  if (failure === "outOfStock") return SHOP_RESULT.notEnoughItems;
  return SHOP_RESULT.error;
}
