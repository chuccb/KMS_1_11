/** CTradingRoomDlg geometry and room model, cross-checked against the PE and the WZ sheet. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_WINDOW,
  TRADE_TEXT,
  tradeLogPage,
  tradeLogScroller,
  tradeSlotRect,
  tradeState,
  tradeFinishText,
} from "../../client/trade-state.ts";
import {
  encodeClientMiniRoomRequest,
  encodeMiniRoomEnter,
  encodeMiniRoomItem,
  encodeMiniRoomInvite,
  encodeMiniRoomLock,
  encodeMiniRoomMesos,
  encodeMiniRoomFinish,
  MINIROOM_KIND,
  readClientMiniRoomRequest,
  readMiniRoomResult,
  TRADE_SLOTS,
  type MiniRoomParticipant,
} from "../src/protocol/miniroom.ts";
import { ITEM_NO_CELL_TOP } from "../../client/itemno.ts";
import { tradeOfferCount } from "../../client/trade-window.ts";
import { nonEquipSlot } from "../src/protocol/itemslot.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { clientEventJson } from "../src/net/client-event-json.ts";

/** Protocol names cross the wire as CP949 byte strings, exactly like the fixture's. */
const byteName = (text: string) => Buffer.from(encodeCp949(text)).toString("latin1");

const participant = (index: number, name: string): MiniRoomParticipant => ({
  index,
  name,
  face: 20000,
  look: [30000],
  level: 20 + index,
});
const readProtocol = (bytes: Uint8Array) => readMiniRoomResult(new PacketReader(bytes, 1));
const read = (bytes: Uint8Array) =>
  clientEventJson({ kind: "trade", event: readProtocol(bytes) }, 0).event;

test("native cash-block BigInts stay raw and enter shared trade state as exact decimal strings", () => {
  const state = tradeState();
  state.receiveProtocol(
    readProtocol(
      encodeMiniRoomEnter({
        roomKind: MINIROOM_KIND.trade,
        myIndex: 0,
        participants: [participant(0, "Self"), participant(1, "Peer")],
      }),
    ),
  );

  const nativeItem = readProtocol(
    encodeMiniRoomItem({
      index: 1,
      roomSlot: 2,
      item: nonEquipSlot(5_000_001, 3, {
        cash: { sn: 0x123456789abcdefn, unknown18: 3, unknown1A: 0x102030405060708n },
      }),
    }),
  );
  assert.equal(nativeItem.kind, "item");
  if (nativeItem.kind !== "item") throw new Error("expected a MiniRoom item event");
  assert.equal(typeof nativeItem.item.cash?.sn, "bigint");

  state.receiveProtocol(nativeItem);

  assert.equal(
    typeof nativeItem.item.cash?.sn,
    "bigint",
    "projection does not mutate the protocol event",
  );
  assert.deepEqual(state.theirSide()?.offers.get(2)?.item.cash, {
    sn: "81985529216486895",
    unknown18: 3,
    unknown1A: "72623859790382856",
  });
});

test("trade sheet geometry is sub_4D63C0's grid and sub_461C50's centring", () => {
  assert.deepEqual(
    { w: TRADE_WINDOW.width, h: TRADE_WINDOW.height, home: TRADE_WINDOW.home },
    { w: 367, h: 295, home: { x: 216, y: 152 } },
    "((800-367)>>1, (600-295)>>1)",
  );
  // sub_4D5440 builds the cell grid itself at :219870 / :219871 - `35 * (v2 % 2) + 291` for the
  // column and `35 * (v2 / 2) + 160` for the row's BOTTOM, then steps `n146 -= 281` for the other
  // side. A 32px cell whose bottom is 35r + 160 starts at 35r + 128, and 291 - 281 is 10.
  assert.deepEqual(tradeSlotRect("mine", 1), { x: 291, y: 128, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("mine", 2), { x: 326, y: 128, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("mine", 8), { x: 326, y: 233, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("theirs", 1), { x: 10, y: 128, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("theirs", 7), { x: 10, y: 233, width: 32, height: 32 });
  assert.equal(tradeSlotRect("mine", 0), undefined);
  assert.equal(tradeSlotRect("mine", TRADE_SLOTS + 1), undefined);
  assert.deepEqual(TRADE_WINDOW.names, { left: 44, right: 327, y: 110 });
  assert.deepEqual(TRADE_WINDOW.mesos, { left: 84, right: 366, y: 277 });
  assert.deepEqual(TRADE_WINDOW.lock.mine, { x: 286, y: 124, width: 76, height: 144 });
  assert.deepEqual(TRADE_WINDOW.lock.theirs, { x: 4, y: 124, width: 76, height: 144 });
  // sub_4D5730 walks `for (y = 26; y < 234; y += 13)` at x=94 -> exactly 16 log rows.
  assert.deepEqual(TRADE_WINDOW.log.line, { x: 94, firstY: 26, pitch: 13, lastY: 234 });
  assert.equal(
    Math.floor(
      (TRADE_WINDOW.log.line.lastY - TRADE_WINDOW.log.line.firstY) / TRADE_WINDOW.log.line.pitch,
    ),
    16,
  );
  // sub_4D5440 hands sub_525AE0 the cell rect's own left edge and `bottom - 12`, so the count sits
  // at (35c+291, 35r+148) - flush with the cell's left edge, ITEM_NO_CELL_TOP down from its top.
  assert.deepEqual(TRADE_WINDOW.count, { dx: 0, dy: ITEM_NO_CELL_TOP });
  for (const [column, row, x, y] of [
    [0, 0, 291, 148],
    [1, 0, 326, 148],
    [0, 3, 291, 253],
  ] as const) {
    const cell = tradeSlotRect("mine", row * 2 + column + 1);
    assert.ok(cell);
    assert.deepEqual(
      { x: cell.x + TRADE_WINDOW.count.dx, y: cell.y + TRADE_WINDOW.count.dy },
      { x, y },
      `35*${column}+291, 35*${row}+148`,
    );
  }
});

test("the client-owned strings keep their original wording and line breaks", () => {
  assert.equal(
    TRADE_TEXT.invite("상대"),
    "'상대'님께서 1:1 교환을\r\n 요청하였습니다\r\n요청에 응하시겠습니까?",
  );
  assert.equal(TRADE_TEXT.confirm, "정말로 교환하시겠습니까?");
  assert.equal(TRADE_TEXT.mesos, "얼마를 올리시겠습니까?");
  assert.equal(TRADE_TEXT.busy("상대"), "'상대'님은 다른 일을 하는 중입니다");
  assert.equal(TRADE_TEXT.gm, "관리용 아이디는 1:1교환을 할 수 없습니다");
  assert.equal(TRADE_TEXT.windowOpen, "다른 작업중에는 1:1교환을 할 수 없습니다");
  assert.equal(tradeFinishText(1), "상대방이 교환을 취소했습니다.");
  assert.equal(tradeFinishText(3), "교환이 성사되었습니다.\r\n결과를 확인해 주세요.");
  assert.equal(tradeFinishText(4), "교환에 실패하였습니다.");
  assert.equal(tradeFinishText(0), undefined);
});

test("0x50 transitions build the room the window paints; type 7 stays a no-op", () => {
  const state = tradeState();
  assert.equal(state.open, false);
  assert.deepEqual(
    state.receive(read(encodeMiniRoomInvite({ inviterId: 7, inviterName: byteName("상대") }))),
    [{ kind: "invite", inviterId: 7, inviterName: byteName("상대") }],
  );
  assert.deepEqual(state.pendingInvite, { id: 7, name: byteName("상대") });
  const enter = state.receive(
    read(
      encodeMiniRoomEnter({
        roomKind: MINIROOM_KIND.trade,
        myIndex: 1,
        participants: [participant(0, byteName("상대")), participant(1, byteName("나"))],
      }),
    ),
  );
  assert.deepEqual(enter, [{ kind: "opened", myIndex: 1 }]);
  assert.equal(state.pendingInvite, undefined, "entering clears the modal ticket");
  const room = state.room;
  assert.ok(room);
  assert.equal(room.myIndex, 1);
  assert.equal(room.participants.get(0)?.name, byteName("상대"));
  assert.equal(state.me()?.name, byteName("나"));
  assert.equal(state.them()?.name, byteName("상대"));
  assert.deepEqual(state.receive(read(encodeMiniRoomMesos({ index: 0, amount: 1234 }))), [
    { kind: "mesos", index: 0 },
  ]);
  assert.equal(state.theirSide()?.mesos, 1234);
  assert.equal(state.mySide()?.mesos, 0);
  state.receive(
    read(encodeMiniRoomItem({ index: 1, roomSlot: 3, item: nonEquipSlot(2000001, 12) })),
  );
  assert.equal(state.mySide()?.offers.get(3)?.count, 12);
  state.receive(
    read(
      encodeMiniRoomItem({
        index: 1,
        roomSlot: 4,
        item: nonEquipSlot(5_000_001, 2, {
          cash: { sn: 0x123456789abcdefn, unknown18: 3, unknown1A: 0x102030405060708n },
        }),
      }),
    ),
  );
  assert.deepEqual(state.mySide()?.offers.get(4)?.item.cash, {
    sn: "81985529216486895",
    unknown18: 3,
    unknown1A: "72623859790382856",
  });
  assert.deepEqual(state.receive(read(encodeMiniRoomLock())), [{ kind: "locked" }]);
  assert.equal(state.theirSide()?.confirmed, true, "type 13 locks the OTHER side");
  assert.equal(state.mySide()?.confirmed, false);
  assert.equal(state.confirmLocally(), true);
  assert.equal(state.mySide()?.confirmed, true);
  assert.deepEqual(state.receive(read(encodeMiniRoomFinish(3))), [{ kind: "closed", code: 3 }]);
  assert.equal(state.open, false);
});

test("sub_4D5C80/sub_4D5F50 guards: locked, alone, 500 ms throttle, occupied cell", () => {
  const alone = tradeState();
  alone.receive(
    read(
      encodeMiniRoomEnter({
        roomKind: MINIROOM_KIND.trade,
        myIndex: 0,
        participants: [participant(0, byteName("나"))],
      }),
    ),
  );
  assert.equal(alone.canOffer(1000), false, "alone in the room");
  const state = tradeState();
  state.receive(
    read(
      encodeMiniRoomEnter({
        roomKind: MINIROOM_KIND.trade,
        myIndex: 0,
        participants: [participant(0, byteName("나")), participant(1, byteName("상대"))],
      }),
    ),
  );
  assert.equal(state.canOffer(1000), true);
  state.markOffer(1000);
  assert.equal(state.canOffer(1499), false, "native 0x1F4 throttle");
  assert.equal(state.canOffer(1500), true);
  state.receive(
    read(encodeMiniRoomItem({ index: 0, roomSlot: 2, item: nonEquipSlot(2000001, 1) })),
  );
  assert.equal(state.roomSlotForDrop(327 + 5, 129 + 5), undefined, "slot 2 is occupied");
  assert.equal(state.roomSlotForDrop(292 + 5, 129 + 5), 1);
  assert.equal(state.roomSlotForDrop(11 + 5, 129 + 5), undefined, "their side takes no drops");
  state.confirmLocally();
  assert.equal(state.canOffer(2000), false, "my lock stops offers");
});

// --------------------------------------------------------------------------- the log scrollbar

test("sub_452500 zones, sub_452150 clamps and sub_4D5900's follow rule", () => {
  const bar = TRADE_WINDOW.scrollbar;
  const scroll = tradeLogScroller();
  // Disabled while the log fits: max <= 1 means zone 100 everywhere, but PtInRect still wheels.
  assert.equal(scroll.max, 1);
  assert.equal(scroll.pinnedBottom, true);
  assert.equal(scroll.hit(bar.x, bar.y), undefined);
  assert.equal(scroll.hit(bar.x + 5, bar.y + 100), undefined);
  assert.ok(scroll.inBar(bar.x + 5, bar.y + 100));
  scroll.activate("next", 0);
  scroll.by(3);
  assert.equal(scroll.pos, 0, "nothing moves while disabled");
  assert.equal(scroll.thumbTop(), bar.arrow, "thumb parks under the up arrow");

  // sub_4D5900: max = rows - 15; the view follows the bottom while it is at the bottom.
  scroll.sync(20);
  assert.equal(scroll.max, 5);
  assert.equal(scroll.pos, 4);
  assert.equal(scroll.pinnedBottom, true);
  scroll.sync(30);
  assert.equal(scroll.pos, 14, "still pinned, so the append scrolled along");
  scroll.by(-2);
  assert.equal(scroll.pos, 12);
  assert.equal(scroll.pinnedBottom, false);
  scroll.sync(40);
  assert.equal(scroll.max, 25);
  assert.equal(scroll.pos, 12, "sub_4D5900 only follows when already at the bottom");
  scroll.sync(18);
  assert.equal(scroll.max, 3);
  assert.equal(scroll.pos, 2, "sub_452150 clamps into [0, max - 1]");
  scroll.sync(24);
  assert.equal(scroll.pos, 8, "the clamped view was at the bottom, so it follows again");

  // sub_452500's zones, with the view pinned so the thumb sits at the track end.
  scroll.reset();
  scroll.sync(32); // max = 17, pinned at 16 -> thumbTop = 12 + floor(16 * 180 / 16) = 192
  const wy = (v: number) => bar.y + v;
  assert.equal(scroll.hit(bar.x, wy(0)), "prev");
  assert.equal(scroll.hit(bar.x, wy(12)), "prev", "v <= 12 is the up arrow");
  assert.equal(scroll.hit(bar.x, wy(13)), "pageUp");
  assert.equal(scroll.hit(bar.x, wy(191)), "pageUp");
  assert.equal(scroll.hit(bar.x, wy(192)), "thumb");
  assert.equal(scroll.hit(bar.x + 11, wy(203)), "thumb", "v <= thumbTop + 12");
  assert.equal(scroll.hit(bar.x, wy(204)), "next", "v >= 204 is the down arrow, thumb or not");
  assert.equal(scroll.hit(bar.x + 12, wy(100)), undefined, "outside the control rect");
  assert.equal(scroll.hit(bar.x - 1, wy(100)), undefined);
  assert.equal(scroll.hit(bar.x, wy(216)), undefined);

  // sub_4525B0 steps by one; sub_452600 pages by max(floor(max / 16), 16).
  scroll.activate("prev", wy(scroll.thumbTop()));
  assert.equal(scroll.pos, 15);
  assert.equal(scroll.pressed, "prev");
  scroll.end();
  assert.equal(scroll.pressed, undefined);
  scroll.activate("next", wy(210));
  assert.equal(scroll.pinnedBottom, true, "one step down re-pins at max - 1");
  assert.equal(tradeLogPage(17), 16);
  assert.equal(tradeLogPage(185), 16, "floor(185 / 16) = 11 loses to the 16-line page");
  assert.equal(tradeLogPage(385), 24);
  scroll.sync(200); // max = 185, pinned at 184
  scroll.activate("pageUp", wy(100));
  assert.equal(scroll.pos, 168);
  scroll.activate("pageDown", wy(100));
  assert.equal(scroll.pinnedBottom, true);

  // sub_452670/sub_4526A0: the thumb drag is startPos + max * dy / 180, truncated then clamped.
  scroll.reset();
  scroll.sync(181); // max = 166
  scroll.by(-100);
  assert.equal(scroll.pos, 65);
  const startY = wy(scroll.thumbTop()); // 21 + 12 + floor(65 * 180 / 165) = 103
  assert.equal(startY, 103);
  scroll.activate("thumb", startY);
  assert.equal(scroll.dragging, true);
  scroll.moveTo(startY + 89);
  assert.equal(scroll.pos, 147, "65 + trunc(166 * 89 / 180) = 65 + 82");
  scroll.moveTo(startY + 90);
  assert.equal(scroll.pos, 148);
  scroll.moveTo(startY - 90);
  assert.equal(scroll.pos, 0, "negative results clamp at the top");
  scroll.moveTo(startY + 10000);
  assert.equal(scroll.pinnedBottom, true, "dragging past the end re-pins");
  scroll.end();
  assert.equal(scroll.dragging, false);
  scroll.reset();
  assert.equal(scroll.max, 1);
  assert.equal(scroll.pos, 0);
});

test("sub_4D5C80 writes the count only for a tab other than 1, and the codec agrees", () => {
  // sub_4D5C80 (`MapleStory.exe.c:220282`): `[u8 11][u8 tab][u16 slot]`, then `if (v12 != 1)` -
  // v12 being the *tab* byte, never the item id - `[u16 count]`, then `[u8 roomSlot]`. Tab 1 is
  // 장비, which does not stack, so the count would be meaningless there.
  assert.equal(tradeOfferCount(1, 1), null, "an equip carries no count byte");
  assert.equal(tradeOfferCount(1, 200), null, "whatever the equip tab claims to hold");
  assert.equal(tradeOfferCount(1, undefined), null);
  assert.equal(tradeOfferCount(2, 50), 50);
  assert.equal(tradeOfferCount(4, undefined), 1, "a missing quantity is one");
  assert.equal(tradeOfferCount(2, 0), 0, "a spent 207 is offered whole, count and all");

  // Cross-pin against the codec that reads it back: the two have to agree on where the byte goes.
  for (const tab of [1, 2, 3, 4]) {
    const quantity = tab === 1 ? 1 : 7;
    const count = tradeOfferCount(tab, quantity);
    const bytes = encodeClientMiniRoomRequest({
      kind: "offerItem",
      tab,
      slot: 3,
      count,
      roomSlot: 5,
    });
    assert.equal(bytes.length, tab === 1 ? 6 : 8, `tab ${tab} packet length`);
    const read = readClientMiniRoomRequest(new PacketReader(bytes, 1));
    assert.deepEqual(
      read,
      { kind: "offerItem", tab, slot: 3, count: tab === 1 ? null : 7, roomSlot: 5 },
      `tab ${tab} round trip`,
    );
  }
});
