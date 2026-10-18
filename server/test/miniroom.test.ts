import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  MINIROOM_KIND,
  MINIROOM_OPCODE,
  MINIROOM_REFUSAL,
  MINIROOM_RESULT_TYPE,
  TRADE_FINISH,
  TRADE_SLOTS,
  describeClientMiniRoomRequest,
  encodeClientMiniRoomRequest,
  encodeMiniRoomEnter,
  encodeMiniRoomFinish,
  encodeMiniRoomInvite,
  encodeMiniRoomItem,
  encodeMiniRoomLock,
  encodeMiniRoomMesos,
  encodeMiniRoomMessage,
  encodeMiniRoomParticipant,
  encodeMiniRoomRefused,
  readClientMiniRoomRequest,
  readMiniRoomResult,
} from "../src/protocol/miniroom.ts";
import { emptyCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import { equipSlot, nonEquipSlot, type ItemSlot } from "../src/protocol/itemslot.ts";
import { INVENTORY_OP } from "../src/protocol/inventory.ts";
import {
  TRADE_INVITE_TTL_MS,
  TradeRegistry,
  isTradeSlot,
  settleTrade,
  type TradeOffer,
} from "../src/game/trades.ts";
import { MesoWallet, grantItem } from "../src/game/rewards.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parse(bytes: Uint8Array) {
  return readClientMiniRoomRequest(new PacketReader(bytes, 1));
}

function room(bytes: Uint8Array) {
  return readMiniRoomResult(new PacketReader(bytes, 1));
}

test("0x25: every request the 2003 client can send", () => {
  // `/교환`: `sub_471A40` writes `0`, then `1`, then the target id.
  assert.equal(
    hex(encodeClientMiniRoomRequest({ kind: "invite", roomKind: 1, targetId: 62 })),
    "2500013e000000",
  );
  assert.deepEqual(
    parse(encodeClientMiniRoomRequest({ kind: "invite", roomKind: 1, targetId: 62 })),
    {
      kind: "invite",
      roomKind: 1,
      targetId: 62,
    },
  );
  // The modal's "yes" (`sub_481910` at `.text:00481a2a`).
  assert.equal(hex(encodeClientMiniRoomRequest({ kind: "accept", inviterId: 61 })), "25033d000000");
  // Equip: the tab is 1, so no count goes on the wire (`sub_4D5C80`).
  assert.equal(
    hex(
      encodeClientMiniRoomRequest({ kind: "offerItem", tab: 1, slot: 5, count: null, roomSlot: 2 }),
    ),
    "250b01050002",
  );
  assert.deepEqual(
    parse(
      encodeClientMiniRoomRequest({ kind: "offerItem", tab: 1, slot: 5, count: null, roomSlot: 2 }),
    ),
    { kind: "offerItem", tab: 1, slot: 5, count: null, roomSlot: 2 },
  );
  // A stack: the count is there.
  assert.equal(
    hex(
      encodeClientMiniRoomRequest({ kind: "offerItem", tab: 2, slot: 3, count: 10, roomSlot: 1 }),
    ),
    "250b0203000a0001",
  );
  assert.equal(
    hex(encodeClientMiniRoomRequest({ kind: "offerMesos", amount: 10_000 })),
    "250c10270000",
  );
  assert.equal(hex(encodeClientMiniRoomRequest({ kind: "confirm" })), "250d");
  assert.equal(hex(encodeClientMiniRoomRequest({ kind: "leave" })), "2507");
  assert.equal(
    hex(encodeClientMiniRoomRequest({ kind: "inviteByName", name: "Alt" })),
    "25050300416c74",
  );
  assert.equal(MINIROOM_OPCODE.request, 0x25);
  assert.equal(MINIROOM_OPCODE.result, 0x50);
});

test("0x25: an unknown type is refused, and 13 is not a request", () => {
  assert.throws(() => parse(new Uint8Array([0x25, 0x63])), RangeError);
  assert.deepEqual(parse(new Uint8Array([0x25, 13])), { kind: "confirm" });
  assert.equal(describeClientMiniRoomRequest({ kind: "confirm" }), "0x25 miniroom: confirm");
  assert.equal(
    describeClientMiniRoomRequest({ kind: "offerItem", tab: 2, slot: 3, count: 10, roomSlot: 1 }),
    "0x25 miniroom: offer item tab=2 slot=3 count=10 roomSlot=1",
  );
});

test("0x50 type 1 and 2: the invitation and its refusal", () => {
  assert.equal(
    hex(encodeMiniRoomInvite({ inviterId: 61, inviterName: "Hero" })),
    "500104004865726f3d000000",
  );
  assert.deepEqual(room(encodeMiniRoomInvite({ inviterId: 61, inviterName: "Hero" })), {
    kind: "invite",
    inviterId: 61,
    inviterName: "Hero",
  });
  // code 0 is the silent "request received" (sub_481B20 shows nothing).
  assert.equal(hex(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.ok })), "500200");
  assert.equal(hex(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.notFound })), "500201");
  // "that player is busy" carries the name.
  assert.equal(
    hex(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.busy, name: "Alt" })),
    "5002020300416c74",
  );
  assert.deepEqual(room(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.busy, name: "Alt" })), {
    kind: "refused",
    code: 2,
    name: "Alt",
  });
});

const HERO = { index: 0, name: "Hero", face: 20_000, look: [30_000, 1_000_002], level: 12 };
const ALT = { index: 1, name: "Alt", face: 20_001, look: [30_001], level: 8 };

test("0x50 type 4: the enter packet, and its 0xff terminator", () => {
  const bytes = encodeMiniRoomEnter({
    roomKind: MINIROOM_KIND.trade,
    myIndex: 1,
    participants: [HERO, ALT],
  });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], MINIROOM_RESULT_TYPE.enter);
  assert.equal(bytes[2], 1, "room kind 1 = trade (sub_481570 only allocates for 1)");
  assert.equal(bytes[3], 2, "count");
  assert.equal(bytes[4], 1, "myIndex");
  assert.equal(bytes[bytes.length - 1], 0xff, "the terminator byte has its top bit set");
  const parsed = room(bytes);
  assert.deepEqual(parsed, {
    kind: "enter",
    roomKind: 1,
    myIndex: 1,
    participants: [HERO, ALT],
  });
});

test("0x50 type 3 and 6: one participant", () => {
  assert.deepEqual(room(encodeMiniRoomParticipant(ALT)), { kind: "participant", participant: ALT });
  const bytes = encodeMiniRoomParticipant(ALT);
  assert.equal(bytes[1], MINIROOM_RESULT_TYPE.participant);
  assert.equal(bytes[2], 1, "the index is the byte before the participant");
});

test("0x50 type 5 / 8 / 12 / 13: the small ones", () => {
  assert.deepEqual(room(encodeMiniRoomMessage("hi")), { kind: "message", text: "hi" });
  assert.equal(hex(encodeMiniRoomMessage("hi")), "50050002006869");
  assert.deepEqual(room(encodeMiniRoomFinish(TRADE_FINISH.done)), { kind: "finish", code: 3 });
  assert.deepEqual(room(encodeMiniRoomMesos({ index: 1, amount: 1234 })), {
    kind: "mesos",
    index: 1,
    amount: 1234,
  });
  assert.equal(hex(encodeMiniRoomLock()), "500d");
  assert.deepEqual(room(encodeMiniRoomLock()), { kind: "lock" });
});

test("0x50 type 11: the item carries its category byte", () => {
  const bytes = encodeMiniRoomItem({ index: 0, roomSlot: 3, item: nonEquipSlot(2_000_000, 10) });
  assert.equal(bytes[1], MINIROOM_RESULT_TYPE.item);
  assert.equal(bytes[2], 0);
  assert.equal(bytes[3], 3);
  assert.equal(
    bytes[4],
    2,
    "itemId / 1000000 = 2 for a consume item (sub_45E6A0's third arg is 0)",
  );
  const parsed = room(bytes);
  assert.equal(parsed.kind, "item");
  if (parsed.kind !== "item") return;
  assert.equal(parsed.roomSlot, 3);
  assert.equal(parsed.item.itemId, 2_000_000);
  assert.throws(
    () => encodeMiniRoomItem({ index: 0, roomSlot: 0, item: nonEquipSlot(2_000_000, 1) }),
    RangeError,
  );
  assert.throws(
    () =>
      encodeMiniRoomItem({ index: 0, roomSlot: TRADE_SLOTS + 1, item: nonEquipSlot(2_000_000, 1) }),
    RangeError,
  );
});

test("TradeRegistry: an invite expires, a room is one per character", () => {
  const trades = new TradeRegistry();
  trades.invite(1, 2, 1_000);
  assert.equal(trades.inviteOf(2, 1_000)?.inviterId, 1);
  assert.equal(
    trades.inviteOf(2, 1_000 + TRADE_INVITE_TTL_MS + 1),
    undefined,
    "the 2003 client has no decline",
  );
  const room = trades.open({ characterId: 1, name: "Hero" }, { characterId: 2, name: "Alt" });
  assert.equal(trades.roomOf(1), room);
  assert.equal(trades.roomOf(2), room);
  assert.equal(trades.sideOf(room, 2)?.name, "Alt");
  assert.equal(trades.otherSide(room, 2)?.characterId, 1);
  assert.equal(trades.inviteOf(2, 1_000), undefined, "opening a room clears both invites");
  trades.close(room);
  assert.equal(trades.roomOf(1), undefined);
  assert.equal(trades.roomOf(2), undefined);
});

/** Two characters with a 24-slot tab each and a wallet. */
function character(mesos: number) {
  const items = emptyCharacterItems();
  for (const inventory of items.inventories) inventory.capacity = 24;
  const stats = { ...zeroStats(), mesos };
  return { items, wallet: new MesoWallet(stats), stats };
}

function offerOf(
  roomSlot: number,
  tab: number,
  slot: number,
  item: ItemSlot,
  count = 1,
): TradeOffer {
  return { roomSlot, tab, slot, count, item };
}

test("settleTrade: items and mesos swap, and the 0x0B changes match", () => {
  const hero = character(5_000);
  const alt = character(1_000);
  grantItem(hero.items, 2_000_000, 10);
  grantItem(alt.items, 2_000_001, 3);
  const heroOffer = offerOf(1, 2, 1, nonEquipSlot(2_000_000, 10), 10);
  const altOffer = offerOf(1, 2, 1, nonEquipSlot(2_000_001, 3), 3);
  const result = settleTrade(
    { offers: [heroOffer], mesos: 2_000, items: hero.items, wallet: hero.wallet },
    { offers: [altOffer], mesos: 500, items: alt.items, wallet: alt.wallet },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Hero gave 10 red potions and 2000 mesos, got 3 blue potions and 500 mesos.
  assert.deepEqual(result.mesos, [3_500, 2_500]);
  const heroTab = result.items[0].inventories[1]!;
  assert.equal(heroTab.items.get(1)?.itemId, 2_000_001, "Alt's stack took the slot Hero emptied");
  const altTab = result.items[1].inventories[1]!;
  assert.equal(altTab.items.get(1)?.itemId, 2_000_000);
  assert.equal(
    result.changes[0].some((change) => change.op === INVENTORY_OP.put),
    true,
  );
  assert.equal(
    result.changes[1].some((change) => change.op === INVENTORY_OP.put),
    true,
  );
});

test("settleTrade: a partial stack stays behind, and the change is a put", () => {
  const hero = character(0);
  const alt = character(0);
  grantItem(hero.items, 2_000_000, 10);
  const result = settleTrade(
    {
      offers: [offerOf(2, 2, 1, nonEquipSlot(2_000_000, 10), 4)],
      mesos: 0,
      items: hero.items,
      wallet: hero.wallet,
    },
    { offers: [], mesos: 0, items: alt.items, wallet: alt.wallet },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].inventories[1]!.items.get(1)?.kind, "nonequip");
  const left = result.items[0].inventories[1]!.items.get(1);
  assert.equal(left?.kind === "nonequip" ? left.quantity : 0, 6);
  assert.deepEqual(result.changes[0][0], {
    op: INVENTORY_OP.put,
    inventory: 2,
    slot: 1,
    item: left,
  });
});

test("settleTrade: an item that is gone, or a full bag, fails without moving anything", () => {
  const hero = character(0);
  const alt = character(0);
  grantItem(hero.items, 2_000_000, 10);
  const heroOffer = offerOf(1, 2, 1, nonEquipSlot(2_000_000, 10), 10);
  hero.items.inventories[1]!.items.delete(1); // traded away / dropped in the meantime
  const gone = settleTrade(
    { offers: [heroOffer], mesos: 0, items: hero.items, wallet: hero.wallet },
    { offers: [], mesos: 0, items: alt.items, wallet: alt.wallet },
  );
  assert.deepEqual(gone.ok, false);

  // The other side has no room at all: capacity 0 means "no slots".
  const full = character(0);
  for (const inventory of full.items.inventories) inventory.capacity = 0;
  const greedy = character(0);
  grantItem(greedy.items, 2_000_000, 1);
  const noRoom = settleTrade(
    {
      offers: [offerOf(1, 2, 1, nonEquipSlot(2_000_000, 1), 1)],
      mesos: 0,
      items: greedy.items,
      wallet: greedy.wallet,
    },
    { offers: [], mesos: 0, items: full.items, wallet: full.wallet },
  );
  assert.equal(noRoom.ok, false);
  if (noRoom.ok) return;
  assert.match(noRoom.reason, /no room/);
  assert.equal(
    greedy.items.inventories[1]!.items.get(1)?.itemId,
    2_000_000,
    "the clone failed, not the record",
  );
});

test("settleTrade: mesos that are not there are refused", () => {
  const hero = character(100);
  const alt = character(100);
  const result = settleTrade(
    { offers: [], mesos: 500, items: hero.items, wallet: hero.wallet },
    { offers: [], mesos: 0, items: alt.items, wallet: alt.wallet },
  );
  assert.equal(result.ok, false);
  assert.equal(hero.wallet.balance, 100);
});

test("isTradeSlot is 1..8, and the equip tab is 1", () => {
  assert.equal(isTradeSlot(1), true);
  assert.equal(isTradeSlot(8), true);
  assert.equal(isTradeSlot(0), false);
  assert.equal(isTradeSlot(9), false);
  // An equip offer has to be a single item: `sub_4D5C80` never writes a count for tab 1.
  const hero = character(0);
  const alt = character(0);
  grantItem(hero.items, 1_000_002);
  const result = settleTrade(
    {
      offers: [offerOf(1, 1, 1, equipSlot(1_000_002), 2)],
      mesos: 0,
      items: hero.items,
      wallet: hero.wallet,
    },
    { offers: [], mesos: 0, items: alt.items, wallet: alt.wallet },
  );
  assert.equal(result.ok, false);
});
