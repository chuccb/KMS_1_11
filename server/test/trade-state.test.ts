/** CTradingRoomDlg geometry and room model, cross-checked against the PE and the WZ sheet. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_WINDOW,
  TRADE_TEXT,
  tradeSlotRect,
  tradeState,
  tradeFinishText,
} from "../../client/trade-state.ts";
import {
  encodeMiniRoomEnter,
  encodeMiniRoomItem,
  encodeMiniRoomInvite,
  encodeMiniRoomLock,
  encodeMiniRoomMesos,
  encodeMiniRoomFinish,
  readMiniRoomResult,
  TRADE_SLOTS,
  type MiniRoomParticipant,
} from "../src/protocol/miniroom.ts";
import { nonEquipSlot } from "../src/protocol/itemslot.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";

/** Protocol names cross the wire as CP949 byte strings, exactly like the fixture's. */
const byteName = (text: string) => Buffer.from(encodeCp949(text)).toString("latin1");

const participant = (index: number, name: string): MiniRoomParticipant => ({
  index,
  name,
  face: 20000,
  look: [30000],
  level: 20 + index,
});
const read = (bytes: Uint8Array) => readMiniRoomResult(new PacketReader(bytes, 1));

test("trade sheet geometry is sub_4D63C0's grid and sub_461C50's centring", () => {
  assert.deepEqual(
    { w: TRADE_WINDOW.width, h: TRADE_WINDOW.height, home: TRADE_WINDOW.home },
    { w: 367, h: 295, home: { x: 216, y: 152 } },
    "((800-367)>>1, (600-295)>>1)",
  );
  assert.deepEqual(tradeSlotRect("mine", 1), { x: 292, y: 129, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("mine", 2), { x: 327, y: 129, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("mine", 8), { x: 327, y: 234, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("theirs", 1), { x: 11, y: 129, width: 32, height: 32 });
  assert.deepEqual(tradeSlotRect("theirs", 7), { x: 11, y: 234, width: 32, height: 32 });
  assert.equal(tradeSlotRect("mine", 0), undefined);
  assert.equal(tradeSlotRect("mine", TRADE_SLOTS + 1), undefined);
  assert.deepEqual(TRADE_WINDOW.names, { left: 44, right: 327, y: 110 });
  assert.deepEqual(TRADE_WINDOW.mesos, { left: 84, right: 366, y: 277 });
  assert.deepEqual(TRADE_WINDOW.lock.mine, { x: 286, y: 124, width: 76, height: 144 });
  assert.deepEqual(TRADE_WINDOW.lock.theirs, { x: 4, y: 124, width: 76, height: 144 });
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
        roomKind: 1,
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
        roomKind: 1,
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
        roomKind: 1,
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
