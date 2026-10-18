/**
 * 1:1 교환（交易）的規則：邀請、房間、以及成交時把兩邊的東西交換。
 *
 * EVIDENCE (FINDINGS 4.40)
 * -----------------------------------------------------------------------------
 * 2003 的交易**沒有**「先把道具交給伺服器保管」這一步：client 只是把「庫存的哪一格、幾個、放到第幾格」
 * 送出去（c2s `0x25 type 11`，`sub_4D5C80`），道具一直留在自己的庫存裡，直到成交。所以伺服器要：
 *
 * 1. 記住每一邊「承諾了什麼」（道具格 + 數量 + 錢），並在成交時**重新驗證**它還在——這是一段
 *    可以長達幾分鐘的窗口，這期間玩家可以把東西丟掉、賣掉或用在別的地方。
 * 2. 兩邊都按下確認（c2s `type 13`）之後才交換，而且交換要**原子**：任何一邊放不下就整個不換。
 *
 * client 沒有任何「拒絕邀請」的封包（`sub_481910` 的模態對話框只有按「是」才送 `type 3`），所以
 * 邀請一定要有**逾時**，否則那張「等待對方回答」的狀態會永遠留著。這是本模組自己的政策，不是 binary
 * 的：`TRADE_INVITE_TTL_MS`。
 *
 * 兩個 2003 client 的細節也一併編進來：
 *
 * - 交易格是 **1..8**（`sub_4D63C0` 回傳 `y`，`sub_4D5C80` 對 `y <= 0` 直接放棄），所以
 *   `roomSlot` 從 1 開始、上限 8。
 * - 裝備不可堆疊（`sub_4D5C80` 在 `tab == 1` 時根本不寫 count），所以裝備的 `count` 一定是 1。
 */
import type { CharacterItems, Inventory } from "../protocol/chardata.ts";
import type { ItemSlot } from "../protocol/itemslot.ts";
import { INVENTORY_OP, INVENTORY_TAB, type InventoryChange } from "../protocol/inventory.ts";
import { TRADE_SLOTS } from "../protocol/miniroom.ts";
import { grantItem, inventoryTabOfItemId, type MesoWallet } from "./rewards.ts";

/** 邀請的存活時間。client 沒有「拒絕」，所以只能靠伺服器自己收。 */
export const TRADE_INVITE_TTL_MS = 30_000;

/** 一邊承諾的一格道具。`item` 是**當下的快照**，成交時會拿它跟庫存對一次。 */
export interface TradeOffer {
  /** 1..8，`sub_4D63C0` 的那個 y。 */
  roomSlot: number;
  /** 庫存頁 1..4（1 = 裝備）。 */
  tab: number;
  /** 庫存格。 */
  slot: number;
  /** 數量；裝備固定 1（`sub_4D5C80` 不寫這個欄位）。 */
  count: number;
  /** 當下的道具。 */
  item: ItemSlot;
}

/** 房間裡的一邊。 */
export interface TradeSide {
  characterId: number;
  name: string;
  /** 以 `roomSlot` 為鍵：同一個格子再放一次是**取代**。 */
  offers: Map<number, TradeOffer>;
  mesos: number;
  /** 按下了「정말로 교환하시겠습니까?」的「是」。 */
  confirmed: boolean;
}

/** 一個房間。`sides[0]` 是邀請的人，`sides[1]` 是接受的人——也就是 s2c 的 index。 */
export interface TradeRoom {
  id: number;
  sides: [TradeSide, TradeSide];
}

/** 一個還沒被回答的邀請。 */
export interface TradeInvite {
  inviterId: number;
  /** `Date.now()` 的毫秒。 */
  at: number;
}

/** 誰在等誰。 */
export class TradeRegistry {
  private nextRoomId = 1;
  private readonly invites = new Map<number, TradeInvite>();
  private readonly rooms = new Map<number, TradeRoom>();
  private readonly roomByCharacter = new Map<number, number>();

  /** 記下一個邀請（同一組人再邀一次就是覆蓋）。 */
  invite(inviterId: number, targetId: number, now: number): TradeInvite {
    const invite = { inviterId, at: now };
    this.invites.set(targetId, invite);
    return invite;
  }

  /** 某人收到的邀請——逾時的就順手清掉（回 `undefined`）。 */
  inviteOf(targetId: number, now: number): TradeInvite | undefined {
    const invite = this.invites.get(targetId);
    if (invite === undefined) return undefined;
    if (now - invite.at > TRADE_INVITE_TTL_MS) {
      this.invites.delete(targetId);
      return undefined;
    }
    return invite;
  }

  /** 把「某人收到的邀請」清掉（接受、離開、被別人邀都算）。 */
  clearInvite(targetId: number): void {
    this.invites.delete(targetId);
  }

  /** 開一個房間，回傳它；同時清掉兩邊的邀請。 */
  open(
    a: { characterId: number; name: string },
    b: { characterId: number; name: string },
  ): TradeRoom {
    const room: TradeRoom = {
      id: this.nextRoomId++,
      sides: [newSide(a), newSide(b)],
    };
    this.rooms.set(room.id, room);
    this.roomByCharacter.set(a.characterId, room.id);
    this.roomByCharacter.set(b.characterId, room.id);
    this.invites.delete(a.characterId);
    this.invites.delete(b.characterId);
    return room;
  }

  /** 某人所在的房間。 */
  roomOf(characterId: number): TradeRoom | undefined {
    const id = this.roomByCharacter.get(characterId);
    return id === undefined ? undefined : this.rooms.get(id);
  }

  /** 某人在房間裡的那一邊。 */
  sideOf(room: TradeRoom, characterId: number): TradeSide | undefined {
    return room.sides.find((side) => side.characterId === characterId);
  }

  /** 對面的那一邊。 */
  otherSide(room: TradeRoom, characterId: number): TradeSide | undefined {
    return room.sides.find((side) => side.characterId !== characterId);
  }

  /** 關掉房間（兩邊都離開地圖、或有人斷線）。 */
  close(room: TradeRoom): void {
    this.rooms.delete(room.id);
    for (const side of room.sides) this.roomByCharacter.delete(side.characterId);
  }
}

function newSide(who: { characterId: number; name: string }): TradeSide {
  return {
    characterId: who.characterId,
    name: who.name,
    offers: new Map(),
    mesos: 0,
    confirmed: false,
  };
}

/** 一邊在成交時需要的東西。 */
export interface TradeSettlementSide {
  offers: readonly TradeOffer[];
  mesos: number;
  items: CharacterItems;
  wallet: MesoWallet;
}

/** 成交成功：`changes[i]` 是第 i 邊要收到的 `0x0B`，`mesos[i]` 是他最後的錢。 */
export interface TradeSettlementOk {
  ok: true;
  changes: [InventoryChange[], InventoryChange[]];
  /** 交換之後每一邊的 `CharacterItems`（呼叫端要把它寫回角色記錄）。 */
  items: [CharacterItems, CharacterItems];
  mesos: [number, number];
}

/** 成交失敗：`reason` 只給日誌；client 看到的是 `0x50 type 8` 的 `4`。 */
export interface TradeSettlementFailed {
  ok: false;
  reason: string;
}

export type TradeSettlement = TradeSettlementOk | TradeSettlementFailed;

function inventoryOf(items: CharacterItems, tab: number): Inventory | undefined {
  if (!Number.isInteger(tab) || tab < 1 || tab > 4) return undefined;
  return items.inventories[tab - 1];
}

/**
 * 把一邊承諾的每一格從庫存拿掉，回傳要送給他的 `0x0B`。
 *
 * 先驗證再動手：格子裡必須還是同一個道具、數量也還夠（裝備是 1）。任何一格不對就回 `undefined`，
 * 呼叫端會把整個交易判失敗——不會有「拿了一半」的狀態。
 */
function takeOffers(
  items: CharacterItems,
  offers: readonly TradeOffer[],
): { changes: InventoryChange[]; taken: Array<{ offer: TradeOffer; item: ItemSlot }> } | undefined {
  const changes: InventoryChange[] = [];
  const taken: Array<{ offer: TradeOffer; item: ItemSlot }> = [];
  for (const offer of offers) {
    const inventory = inventoryOf(items, offer.tab);
    if (inventory === undefined) return undefined;
    const current = inventory.items.get(offer.slot);
    if (current === undefined || current.itemId !== offer.item.itemId) return undefined;
    const rechargeable = Math.floor(current.itemId / 10000) === 207;
    if (!Number.isInteger(offer.count) || offer.count < 0 || (offer.count === 0 && !rechargeable))
      return undefined;
    if (rechargeable && (current.kind !== "nonequip" || offer.count !== current.quantity))
      return undefined;
    if (current.kind === "equip") {
      if (offer.count !== 1) return undefined;
      inventory.items.delete(offer.slot);
      changes.push({ op: INVENTORY_OP.clear, inventory: offer.tab, slot: offer.slot });
      taken.push({ offer, item: current });
      continue;
    }
    if (current.quantity < offer.count) return undefined;
    const remaining = current.quantity - offer.count;
    if (remaining === 0) {
      inventory.items.delete(offer.slot);
      changes.push({ op: INVENTORY_OP.clear, inventory: offer.tab, slot: offer.slot });
    } else {
      const left = { ...current, quantity: remaining };
      inventory.items.set(offer.slot, left);
      changes.push({ op: INVENTORY_OP.put, inventory: offer.tab, slot: offer.slot, item: left });
    }
    taken.push({ offer, item: { ...current, quantity: offer.count } as ItemSlot });
  }
  return { changes, taken };
}

/**
 * 交換兩邊承諾的東西。
 *
 * 兩邊的 `CharacterItems` 都先複製一份再動（`structuredClone`），所以任何一步失敗都只是丟掉副本，
 * 兩邊的真實庫存一個 byte 都沒動。成功時回傳新的 `CharacterItems`，呼叫端負責寫回角色記錄。
 */
export function settleTrade(
  left: TradeSettlementSide,
  right: TradeSettlementSide,
): TradeSettlement {
  if (left.wallet.balance < left.mesos)
    return { ok: false, reason: "left cannot pay the mesos it offered" };
  if (right.wallet.balance < right.mesos)
    return { ok: false, reason: "right cannot pay the mesos it offered" };
  const leftItems = structuredClone(left.items);
  const rightItems = structuredClone(right.items);
  const leftTaken = takeOffers(leftItems, left.offers);
  if (leftTaken === undefined) return { ok: false, reason: "left no longer owns an offered item" };
  const rightTaken = takeOffers(rightItems, right.offers);
  if (rightTaken === undefined)
    return { ok: false, reason: "right no longer owns an offered item" };

  // 把兩邊拿出來的東西放進對面的庫存。`grantItem` 會沿用快照（裝備的素質、現金的 sn）——
  // 交易搬的是**同一個道具**，不是重新生成一個。
  const leftChanges = [...leftTaken.changes];
  for (const { offer, item } of rightTaken.taken) {
    const granted = grantItem(leftItems, item.itemId, offer.count, item);
    if (granted === undefined)
      return { ok: false, reason: `left has no room for item ${item.itemId}` };
    leftChanges.push(granted.change);
  }
  const rightChanges = [...rightTaken.changes];
  for (const { offer, item } of leftTaken.taken) {
    const granted = grantItem(rightItems, item.itemId, offer.count, item);
    if (granted === undefined)
      return { ok: false, reason: `right has no room for item ${item.itemId}` };
    rightChanges.push(granted.change);
  }

  left.wallet.spend(left.mesos);
  right.wallet.earn(left.mesos);
  right.wallet.spend(right.mesos);
  left.wallet.earn(right.mesos);
  return {
    ok: true,
    changes: [leftChanges, rightChanges],
    items: [leftItems, rightItems],
    mesos: [left.wallet.balance, right.wallet.balance],
  };
}

/** 這一頁是不是裝備頁（`sub_4D5C80` 用它決定要不要寫 count）。 */
export function isEquipTab(tab: number): boolean {
  return tab === INVENTORY_TAB.equip;
}

/** 一個 `roomSlot` 是不是合法的交易格。 */
export function isTradeSlot(roomSlot: number): boolean {
  return Number.isInteger(roomSlot) && roomSlot >= 1 && roomSlot <= TRADE_SLOTS;
}

/** 這個道具 id 應該出現在哪一頁——拿來驗證封包自稱的 `tab`。 */
export function tabOfItem(itemId: number): number {
  return inventoryTabOfItemId(itemId);
}
