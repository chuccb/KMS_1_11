/** CUIMessenger's browser model, cross-checked against the PE evidence in ADR-095. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSENGER_TEXT,
  MESSENGER_WINDOW,
  messengerLogScroller,
  messengerState,
} from "../../client/messenger-state.ts";

const member = (slot: number, name: string) => ({
  kind: "participant" as const,
  announce: false,
  participant: { slot, name, level: 30, face: 20001, look: [30000, 1012000] },
});

test("the room opens on the five help rows and mirrors sub_4E18D0's eight types", () => {
  const model = messengerState();
  assert.equal(model.open, false);
  model.openLocal();
  assert.deepEqual(model.room?.lines, MESSENGER_TEXT.help);
  // (mapped: a direct deepEqual against three undefineds would narrow the slot type away)
  assert.deepEqual(
    model.room?.slots.map((m) => m === undefined),
    [true, true, true],
  );

  // type 0 fills a cell; announce adds the entrance row (sub_4DF3E0).
  model.receive(member(0, "갑"));
  assert.equal(model.room?.slots[0]?.name, "갑");
  assert.equal(model.room?.lines.length, 5);
  model.receive({ ...member(1, "을"), announce: true });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.enter("을"));

  // type 2 takes the name from the cell before clearing it (sub_4DF8B0).
  model.receive({ kind: "left", slot: 1 });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.left("을"));
  assert.equal(model.room?.slots[1], undefined);
  model.receive({ kind: "left", slot: 1 });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.left("을"), "no row for an empty cell");

  // type 1 and type 4 print their fixed rows.
  model.receive({ kind: "joinFailed", code: 1 });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.joinFailed);
  model.receive({ kind: "inviteResult", name: "병", ok: 0 });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.notFound("병"));
  model.receive({ kind: "inviteResult", name: "병", ok: 1 });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.inviteSent("병"));

  // type 5: a separator-less row is the typing flag, never a printed line.
  const before = model.room?.lines.length;
  model.receive({ kind: "chat", line: "갑1" });
  assert.equal(model.room?.lines.length, before);
  assert.deepEqual(model.room?.typing, [true, false, false]);
  assert.equal(model.typingNames(), "갑" + MESSENGER_TEXT.typingSuffix);
  model.receive({ kind: "chat", line: "갑0" });
  assert.equal(model.typingNames(), "");
  model.receive({ kind: "chat", line: "없는사람1" });
  assert.deepEqual(model.room?.typing, [false, false, false], "unknown speakers tint nobody");
  model.receive({ kind: "chat", line: "갑 : 안녕" });
  assert.equal(model.room?.lines.at(-1), "갑 : 안녕");

  // type 3 with the window open prints one row instead of raising the modal.
  model.receive({ kind: "invite", inviterName: "정", roomId: 42 });
  assert.equal(model.room?.lines.at(-1), MESSENGER_TEXT.inviteLine("정"));
  assert.equal(model.pendingInvite, undefined);
  model.closeLocal();
  assert.equal(model.open, false);

  // Closed window: the modal ticket, answered exactly once.
  model.receive({ kind: "invite", inviterName: "정", roomId: 42 });
  assert.deepEqual(model.pendingInvite, { inviterName: "정", roomId: 42 });
  assert.equal(model.answerInvite(41), false);
  assert.equal(model.answerInvite(42), true);
  assert.equal(model.pendingInvite, undefined);
});

test("sub_4E24B0's slash rules and sub_4DE490's composed chat row", () => {
  const model = messengerState();
  assert.deepEqual(model.say("hello", "me"), { kind: "refused" }, "no window, no send");
  model.openLocal();
  assert.deepEqual(model.say("", "me"), { kind: "refused" });
  assert.deepEqual(model.say("/q", "me"), { kind: "close" });
  assert.deepEqual(model.say("/Q", "me"), { kind: "close" });
  assert.deepEqual(model.say("/초대 친구", "me"), { kind: "command", name: "친구" });
  assert.deepEqual(model.say("/초대", "me"), { kind: "refused" }, "empty name is refused");
  assert.deepEqual(model.say("/초대 me", "me"), { kind: "refused" }, "self invite is refused");
  assert.deepEqual(model.say("/기타", "me"), { kind: "refused" }, "unknown slash is a no-op");
  assert.deepEqual(model.say("안녕", "me"), { kind: "chat", line: "me : 안녕" });
  assert.deepEqual(model.typingLine("me", true), "me1");
  assert.deepEqual(model.typingLine("me", false), "me0");
});

test("the messenger log scrollbar is the same CCtrlScrollBar at (179,58) len 218", () => {
  const bar = MESSENGER_WINDOW.scrollbar;
  assert.deepEqual([bar.x, bar.y, bar.height, bar.arrow], [179, 58, 218, 12]);
  const scroll = messengerLogScroller();
  scroll.sync(40); // max = 25, pinned
  assert.equal(scroll.max, 25);
  assert.equal(scroll.pos, 24);
  assert.equal(scroll.thumbTop(), 12 + Math.floor((24 * (218 - 36)) / 24));
  assert.equal(scroll.hit(bar.x + 5, bar.y + 5), "prev");
  assert.equal(scroll.hit(bar.x + 5, bar.y + 210), "next");
  scroll.by(-24);
  assert.equal(scroll.pos, 0);
  assert.equal(scroll.hit(bar.x + 5, bar.y + 100), "pageDown");
  scroll.reset();
  assert.equal(scroll.max, 1);
});
