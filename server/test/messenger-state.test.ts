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

test("sub_4E1E30's flag is 'last char is not 0' and a chat row clears the speaker", () => {
  const model = messengerState();
  model.openLocal();
  model.receive(member(0, "갑"));
  // sub_416B00(right(line,1), "0"): anything but "0" raises the tint (0xCFFFFFFF).
  model.receive({ kind: "chat", line: "갑2" });
  assert.deepEqual(model.room?.typing, [true, false, false]);
  model.receive({ kind: "chat", line: "갑0" });
  assert.deepEqual(model.room?.typing, [false, false, false]);
  // The separator path runs the same member loop with the flag false: the speaker's own
  // "name : text" row takes the tint back down before the row is appended.
  model.receive({ kind: "chat", line: "갑1" });
  const out = model.receive({ kind: "chat", line: "갑 : 안녕" });
  assert.deepEqual(model.room?.typing, [false, false, false]);
  assert.deepEqual(out, [
    { kind: "typing", name: "갑", on: false },
    { kind: "line", text: "갑 : 안녕" },
  ]);
  // A row from a member who was not typing only appends.
  assert.deepEqual(model.receive({ kind: "chat", line: "갑 : 다시" }), [
    { kind: "line", text: "갑 : 다시" },
  ]);
});

test("type 6 re-stamps an occupied cell in place and ignores an empty one", () => {
  const model = messengerState();
  model.openLocal();
  const rows = model.room?.lines.length;
  // Empty cell: sub_4E2170's `if (name != 0)` guard drops the update silently.
  assert.deepEqual(
    model.receive({ kind: "cellUpdate", slot: 1, level: 40, face: 21000, look: [31000] }),
    [],
  );
  // (locals: asserting on model.room.slots[1] directly would narrow the element access)
  const empty: unknown = model.room?.slots[1];
  assert.equal(empty, undefined);
  model.receive({ ...member(1, "을"), announce: false });
  const out = model.receive({
    kind: "cellUpdate",
    slot: 1,
    level: 40,
    face: 21000,
    look: [31000, 1040009],
  });
  assert.deepEqual(out, [{ kind: "cell", slot: 1 }]);
  const cell = model.room?.slots[1];
  assert.equal(cell?.name, "을", "the name stays");
  assert.equal(cell?.level, 40);
  assert.equal(cell?.face, 21000);
  assert.deepEqual(cell?.look, [31000, 1040009]);
  assert.equal(model.room?.lines.length, rows, "no row is printed");
  // Out-of-range slots are dropped like every other type.
  assert.deepEqual(model.receive({ kind: "cellUpdate", slot: 3, level: 1, face: 1, look: [] }), []);
});

test("type 7 replays the whole roster silently, exactly three cells", () => {
  const model = messengerState();
  model.openLocal();
  model.receive(member(0, "갑"));
  model.receive({ kind: "chat", line: "갑1" });
  const rows = model.room?.lines.length;
  const out = model.receive(
    {
      kind: "roster",
      cells: [
        { action: "keep" },
        { action: "fill", level: 7, face: 20500, look: [33000], name: "새" },
        { action: "clear" },
      ],
    },
    999,
  );
  assert.deepEqual(out, [
    { kind: "cell", slot: 1 },
    { kind: "cell", slot: 2 },
  ]);
  assert.equal(model.room?.slots[0]?.name, "갑", "keep leaves the cell alone");
  assert.deepEqual(model.room?.typing, [true, false, false], "keep does not reset the flag");
  assert.equal(model.room?.slots[1]?.name, "새");
  assert.equal(model.room?.slots[1]?.since, 999, "fill reseeds the animation clock");
  assert.equal(model.room?.slots[2], undefined);
  assert.equal(model.room?.lines.length, rows, "announce=0: fill prints no entrance row");
  // Clear also takes the typing flag down with the cell.
  model.receive({ kind: "chat", line: "갑1" });
  model.receive({
    kind: "roster",
    cells: [{ action: "clear" }, { action: "keep" }, { action: "keep" }],
  });
  assert.deepEqual(model.room?.typing, [false, false, false]);
});

test("sub_4DEE50's log is an unbounded ZList and member.since seeds the avatar clock", () => {
  const model = messengerState();
  model.openLocal();
  model.receive(member(0, "갑"), 1234);
  assert.equal(model.room?.slots[0]?.since, 1234);
  for (let i = 0; i < 300; i++) model.receive({ kind: "chat", line: `갑 : 줄 ${i}` });
  // The native list only ever grows (the scrollbar takes count-15 as its max); no browser cap.
  assert.equal(model.room?.lines.length, 5 + 300);
  // The wrap constants the renderer shares with sub_4DEE50: width 170, four-space indent.
  assert.equal(MESSENGER_WINDOW.log.wrap, 170);
  assert.equal(MESSENGER_WINDOW.log.indent, "    ");
});
