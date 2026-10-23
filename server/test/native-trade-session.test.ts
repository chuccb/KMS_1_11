/**
 * The browser half of the 1:1 exchange: ClientSession decodes `0x50` into `trade` events and
 * sends `0x25` under the 2003 client's own guards (`sub_471A40`, `sub_4D5C80`, `sub_4D5F50`,
 * `sub_4D61F0`, `sub_4D31F0`). Synthetic encrypted peer - NOT LoginServer/LIVE/account/save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { syntheticSocialPeer, byteName } from "./fixtures/synthetic-social-peer.ts";
import { routeChatInput } from "../src/net/chat-input.ts";
import { clientEventJson } from "../src/net/client-event-json.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  MINIROOM_KIND,
  encodeMiniRoomEnter,
  encodeMiniRoomFinish,
  encodeMiniRoomInvite,
  encodeMiniRoomItem,
  encodeMiniRoomLock,
  encodeMiniRoomMesos,
  encodeMiniRoomRefused,
  readClientMiniRoomRequest,
  type ClientMiniRoomRequest,
  type MiniRoomParticipant,
} from "../src/protocol/miniroom.ts";
import { nonEquipSlot } from "../src/protocol/itemslot.ts";
import type { ClientEvent } from "../src/client/session.ts";

const participant = (index: number, name: string): MiniRoomParticipant => ({
  index,
  name: byteName(name),
  face: 20000,
  look: [30000],
  level: 20 + index,
});
const lastRequest = (packets: Uint8Array[]): ClientMiniRoomRequest => {
  // The barrier's own 0x12 say may trail the request under test; take the last 0x25.
  const packet = [...packets].reverse().find((p) => p[0] === 0x25);
  assert.ok(packet, "no 0x25 was sent");
  return readClientMiniRoomRequest(new PacketReader(packet, 1));
};
const tradeEvents = (events: ClientEvent[]) =>
  events.filter((e): e is Extract<ClientEvent, { kind: "trade" }> => e.kind === "trade");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("0x50 becomes trade events; 0x25 leaves only under the native guards", async (t) => {
  const p = await syntheticSocialPeer(t);
  const actions = {
    party: async () => {},
    whisper: async () => {},
    find: async () => {},
    trade: (name: string) => p.session.tradeInvite(name),
    say: async () => {},
    selfName: () => p.session.selfView?.name ?? "",
  };

  // 1. An invitation arrives decoded (CP949 name) and holds a single modal ticket.
  p.send(encodeMiniRoomInvite({ inviterId: 7, inviterName: byteName("상대이름") }));
  await p.barrier();
  const invite = tradeEvents(p.events).at(-1);
  assert.ok(invite);
  assert.deepEqual(invite.event, {
    kind: "invite",
    inviterId: 7,
    inviterName: "상대이름",
  });

  // 2. Yes answers once with `type 3` + the echoed id; a second answer sends nothing.
  await p.session.tradeReply(7, true);
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), { kind: "accept", inviterId: 7 });
  const afterAnswer = p.packets.length;
  await p.session.tradeReply(7, true);
  await p.session.tradeReply(8, true);
  assert.equal(p.packets.length, afterAnswer, "one modal, one answer");

  // 3. The room opens; my side is index 1 and the other side is index 0.
  p.send(
    encodeMiniRoomEnter({
      roomKind: MINIROOM_KIND.trade,
      myIndex: 1,
      participants: [participant(0, "상대이름"), participant(1, "자기이름")],
    }),
  );
  await p.barrier();
  const opened = tradeEvents(p.events).at(-1);
  assert.equal(opened?.event.kind, "enter");

  // 4. Offers carry the native throttle: the first passes, the next 500 ms do not.
  await p.session.tradeOfferItem({ tab: 2, slot: 3, count: 5, roomSlot: 1 });
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), {
    kind: "offerItem",
    tab: 2,
    slot: 3,
    count: 5,
    roomSlot: 1,
  });
  const throttled = p.packets.length;
  await p.session.tradeOfferItem({ tab: 2, slot: 4, count: 1, roomSlot: 2 });
  await p.session.tradeOfferMesos(500);
  assert.equal(p.packets.length, throttled, "sub_4D5C80/4D5F50's 0x1F4 throttle");
  await sleep(520);
  await p.session.tradeOfferMesos(500);
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), { kind: "offerMesos", amount: 500 });

  // 5. Peer packets decode with their side index intact (the view maps me to the right).
  p.send(encodeMiniRoomMesos({ index: 0, amount: 777 }));
  p.send(
    encodeMiniRoomItem({
      index: 0,
      roomSlot: 4,
      item: nonEquipSlot(5_000_001, 3, {
        cash: { sn: 0x123456789abcdefn, unknown18: 3, unknown1A: 0x102030405060708n },
      }),
    }),
  );
  p.send(encodeMiniRoomLock());
  await p.barrier();
  const peerish = tradeEvents(p.events)
    .slice(-3)
    .map((e) => e.event);
  assert.deepEqual(peerish[0], { kind: "mesos", index: 0, amount: 777 });
  assert.equal(peerish[1]?.kind, "item");
  if (peerish[1]?.kind === "item") {
    assert.equal(peerish[1].index, 0);
    assert.equal(peerish[1].roomSlot, 4);
    assert.deepEqual(peerish[1].item.cash, {
      sn: 0x123456789abcdefn,
      unknown18: 3,
      unknown1A: 0x102030405060708n,
    });
    const browserMessage = clientEventJson({ kind: "trade", event: peerish[1] }, 0);
    assert.deepEqual(browserMessage, {
      t: "trade",
      event: {
        kind: "item",
        index: 0,
        roomSlot: 4,
        item: {
          kind: "nonequip",
          itemId: 5_000_001,
          cash: { sn: "81985529216486895", unknown18: 3, unknown1A: "72623859790382856" },
          quantity: 3,
        },
      },
    });
    const serialized = JSON.stringify(browserMessage);
    assert.ok(serialized, "the bridge's direct JSON.stringify produces a string");
    assert.deepEqual(
      JSON.parse(serialized),
      browserMessage,
      "decimal u64 fields round-trip exactly",
    );
  }
  assert.deepEqual(peerish[2], { kind: "lock" });

  // 6. My confirm locks my side and sends `type 13`; a locked side offers nothing more.
  await sleep(520);
  await p.session.tradeConfirm();
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), { kind: "confirm" });
  await sleep(520);
  const locked = p.packets.length;
  await p.session.tradeOfferMesos(1);
  assert.equal(p.packets.length, locked, "sub_4D61F0's lock stops further offers");

  // 7. `/교환` for a name that is not in this field is the original refusal, no packet.
  const before = p.packets.filter((q) => q[0] === 0x25).length;
  await routeChatInput("/교환 없는사람", actions);
  await p.barrier();
  assert.equal(p.packets.filter((q) => q[0] === 0x25).length, before);
  const feedback = p.events.filter((e) => e.kind === "trade-command").at(-1);
  assert.deepEqual(feedback, {
    kind: "trade-command",
    feedback: { kind: "notFound" },
  });

  // 8. Closing sends `type 7` once and drops the room; a second close sends nothing.
  await p.session.tradeLeave();
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), { kind: "leave" });
  const left = p.packets.length;
  await p.session.tradeLeave();
  assert.equal(p.packets.length, left, "sub_4D31F0 sends once per open room");

  // 9. With no room up `/교환`-by-menu invites again; with a room up it is the original
  //    "다른 작업중에는 1:1교환을 할 수 없습니다" feedback instead of a second packet.
  await p.session.tradeInviteId(7);
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), {
    kind: "invite",
    roomKind: MINIROOM_KIND.trade,
    targetId: 7,
  });
  p.send(
    encodeMiniRoomEnter({
      roomKind: MINIROOM_KIND.trade,
      myIndex: 0,
      participants: [participant(0, "자기이름")],
    }),
  );
  await p.barrier();
  await p.session.tradeInviteId(7);
  const busy = p.events.filter((e) => e.kind === "trade-command").at(-1);
  assert.deepEqual(busy, {
    kind: "trade-command",
    feedback: { kind: "windowOpen" },
  });

  // 10. Refusals and finishes ride through as events for the view's boxes.
  p.send(encodeMiniRoomRefused({ code: 2, name: byteName("상대이름") }));
  p.send(encodeMiniRoomFinish(1));
  await p.barrier();
  const tails = tradeEvents(p.events)
    .slice(-2)
    .map((e) => e.event);
  assert.deepEqual(tails[0], { kind: "refused", code: 2, name: "상대이름" });
  assert.deepEqual(tails[1], { kind: "finish", code: 1 });
  p.session.close();
});
