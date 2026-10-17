import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  MESSENGER_INVITE_RESULT,
  MESSENGER_OPCODE,
  MESSENGER_ROOM_SIZE,
  describeMessengerResult,
  encodeClientMessengerRequest,
  encodeMessengerChat,
  encodeMessengerInvite,
  encodeMessengerInviteResult,
  encodeMessengerJoinFailed,
  encodeMessengerLeft,
  encodeMessengerParticipant,
  readClientMessengerRequest,
  readMessengerResult,
  type ClientMessengerRequest,
} from "../src/protocol/messenger.ts";
import { MESSENGER_INVITE_TTL_MS, MessengerRegistry } from "../src/game/messenger.ts";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parse(bytes: Uint8Array): ClientMessengerRequest {
  return readClientMessengerRequest(new PacketReader(bytes, 1));
}

function event(bytes: Uint8Array) {
  return readMessengerResult(new PacketReader(bytes, 1));
}

const HERO = { characterId: 1, name: "Hero" };
const ALT = { characterId: 2, name: "Alt" };
const THIRD = { characterId: 3, name: "Third" };

test("0x24 round-trips every request type", () => {
  // enter: [opcode][0][u32 roomId] - the window's create/open packet (sub_4DDFE0).
  assert.equal(hex(encodeClientMessengerRequest({ kind: "enter", roomId: 0 })), "240000000000");
  assert.equal(hex(encodeClientMessengerRequest({ kind: "enter", roomId: 7 })), "240007000000");
  assert.deepEqual(parse(encodeClientMessengerRequest({ kind: "enter", roomId: 7 })), {
    kind: "enter",
    roomId: 7,
  });
  // leave: one byte (sub_4DE280).
  assert.equal(hex(encodeClientMessengerRequest({ kind: "leave" })), "2402");
  assert.deepEqual(parse(encodeClientMessengerRequest({ kind: "leave" })), { kind: "leave" });
  // a slash command: [opcode][3][u16 len][bytes] - /q never gets here (the client handles it).
  // The command word itself is CP949 on the wire; the codec does not translate it, and the server
  // never matches on it (it takes whatever follows the first space - see `messengerInviteTarget`).
  assert.equal(hex(encodeClientMessengerRequest({ kind: "command", text: "/invite Alt" })), "24030b002f696e766974652041 6c74".replace(/ /g, ""));
  assert.deepEqual(parse(encodeClientMessengerRequest({ kind: "command", text: "/invite Alt" })), {
    kind: "command",
    text: "/invite Alt",
  });
  // chat: [opcode][5][u16 len][bytes].
  // The client composes "name : text" itself before sending (sub_4DE490).
  assert.equal(hex(encodeClientMessengerRequest({ kind: "chat", line: "Hero : hi" })), "240509004865726f203a206869");
  assert.deepEqual(parse(encodeClientMessengerRequest({ kind: "chat", line: "Hero : hi" })), {
    kind: "chat",
    line: "Hero : hi",
  });
});

test("0x24 rejects the types the client never sends", () => {
  // 1, 4 and 6.. are not senders: sub_4DDFE0/sub_4DE280/sub_4E24B0/sub_4DE490 cover 0/2/3/5 only.
  for (const type of [1, 4, 6, 9]) {
    assert.throws(() => parse(new Uint8Array([0x24, type])), RangeError);
  }
});

test("0x4d type 0 carries slot, level, face, the look list and the announce flag", () => {
  const bytes = encodeMessengerParticipant(
    { slot: 1, name: "Alt", level: 12, face: 20000, look: [30000, 1040001] },
    true,
  );
  // [opcode][0][slot 1][level 12][face 20000=0x4e20] look (little endian, 0-terminated) [name][announce 1]
  assert.equal(
    hex(bytes),
    "4d00" + "01" + "0c" + "204e0000" + "30750000" + "81de0f00" + "00000000" + "0300416c74" + "01",
  );
  assert.deepEqual(event(bytes), {
    kind: "participant",
    participant: { slot: 1, level: 12, face: 20000, look: [30000, 1040001], name: "Alt" },
    announce: true,
  });
});

test("0x4d type 0 refuses a slot the client cannot address", () => {
  const participant = { slot: 3, name: "Third", level: 1, face: 20000, look: [] };
  assert.throws(() => encodeMessengerParticipant(participant, false), RangeError);
  assert.equal(MESSENGER_ROOM_SIZE, 3);
});

test("0x4d types 1..5 round-trip", () => {
  assert.equal(hex(encodeMessengerJoinFailed()), "4d0101");
  assert.deepEqual(event(encodeMessengerJoinFailed()), { kind: "joinFailed", code: 1 });

  assert.equal(hex(encodeMessengerLeft(2)), "4d0202");
  assert.deepEqual(event(encodeMessengerLeft(2)), { kind: "left", slot: 2 });

  // The invite carries the name the modal shows and the room id its "yes" sends back.
  assert.equal(hex(encodeMessengerInvite({ inviterName: "Hero", roomId: 7 })), "4d03" + "04004865726f" + "07000000");
  assert.deepEqual(event(encodeMessengerInvite({ inviterName: "Hero", roomId: 7 })), {
    kind: "invite",
    inviterName: "Hero",
    roomId: 7,
  });

  // name first, then the flag (`sub_4E19A0` reads the string before the byte).
  assert.equal(
    hex(encodeMessengerInviteResult({ ok: MESSENGER_INVITE_RESULT.notFound, name: "Nobody" })),
    "4d04" + "06004e6f626f6479" + "00",
  );
  assert.deepEqual(event(encodeMessengerInviteResult({ ok: MESSENGER_INVITE_RESULT.sent, name: "Alt" })), {
    kind: "inviteResult",
    ok: 1,
    name: "Alt",
  });

  // One string, already formatted - the client splits on " : " (sub_4E1E30's strstr).
  assert.equal(hex(encodeMessengerChat("Hero : hi")), "4d05" + "09004865726f203a206869");
  assert.deepEqual(event(encodeMessengerChat("Hero : hi")), { kind: "chat", line: "Hero : hi" });
});

test("0x4d describes every type it can read", () => {
  assert.match(describeMessengerResult(event(encodeMessengerLeft(0))), /slot 0 left/);
  assert.match(describeMessengerResult(event(encodeMessengerChat("A : b"))), /A : b/);
  assert.equal(MESSENGER_OPCODE.request, 0x24);
  assert.equal(MESSENGER_OPCODE.result, 0x4d);
});

test("a room holds three, one per character, and the slot is the index", () => {
  const registry = new MessengerRegistry();
  const room = registry.create(HERO);
  assert.equal(room.id, 1);
  assert.equal(room.members.length, 1);
  assert.equal(registry.slotOf(HERO.characterId), 0);

  assert.equal(registry.join(room.id, ALT), room);
  assert.equal(registry.slotOf(ALT.characterId), 1);
  assert.equal(registry.join(room.id, THIRD), room);
  assert.equal(registry.slotOf(THIRD.characterId), 2);

  // The fourth one does not fit (sub_4DF3E0 only addresses 0..2).
  const fourth = { characterId: 4, name: "Fourth" };
  assert.equal(registry.join(room.id, fourth), undefined);
  assert.equal(registry.roomOf(fourth.characterId), undefined);
  assert.deepEqual(registry.size, { rooms: 1, invites: 0 });
});

test("leaving closes the gap and an empty room disappears", () => {
  const registry = new MessengerRegistry();
  const room = registry.create(HERO);
  registry.join(room.id, ALT);
  registry.join(room.id, THIRD);

  const left = registry.leave(ALT.characterId);
  assert.ok(left !== undefined);
  assert.equal(left.slot, 1);
  assert.equal(left.member.name, "Alt");
  // Slots are array indices, so the third member moves from 2 to 1 - the client is told by slot.
  assert.equal(registry.slotOf(THIRD.characterId), 1);

  registry.leave(HERO.characterId);
  assert.equal(registry.room(room.id)?.members.length, 1);
  registry.leave(THIRD.characterId);
  assert.equal(registry.room(room.id), undefined);
  assert.deepEqual(registry.size, { rooms: 0, invites: 0 });

  // Leaving a room you are not in is a no-op, not an error.
  assert.equal(registry.leave(HERO.characterId), undefined);
});

test("one character cannot be in two rooms", () => {
  const registry = new MessengerRegistry();
  const first = registry.create(HERO);
  const second = registry.create(ALT);
  assert.notEqual(first.id, second.id);
  assert.equal(registry.join(second.id, HERO), undefined);
  assert.equal(registry.roomOf(HERO.characterId)?.id, first.id);
});

test("invites expire, are replaced, and are spent by joining", () => {
  const registry = new MessengerRegistry();
  const room = registry.create(HERO);
  const now = 1_000_000;

  registry.invite(ALT.characterId, { roomId: room.id, inviterName: "Hero" }, now);
  const invite = registry.inviteOf(ALT.characterId, now + 1);
  assert.deepEqual(invite, { roomId: room.id, inviterName: "Hero", expiresAt: now + MESSENGER_INVITE_TTL_MS });

  // A second invite replaces the first: one slot per character, like the trade invitation.
  registry.invite(ALT.characterId, { roomId: 99, inviterName: "Someone" }, now + 10);
  assert.equal(registry.inviteOf(ALT.characterId, now + 11)?.roomId, 99);

  // Expiry is lazy: the entry is still in the map, but `inviteOf` answers undefined and drops it.
  assert.equal(registry.inviteOf(ALT.characterId, now + 10 + MESSENGER_INVITE_TTL_MS), undefined);
  assert.deepEqual(registry.size, { rooms: 1, invites: 0 });

  // Joining spends the invite, so a second join needs a second invitation.
  registry.invite(ALT.characterId, { roomId: room.id, inviterName: "Hero" }, now);
  assert.equal(registry.join(room.id, ALT), room);
  assert.equal(registry.inviteOf(ALT.characterId, now), undefined);
});
