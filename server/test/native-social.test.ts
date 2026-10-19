import test from "node:test";
import assert from "node:assert/strict";
import { parseSocialCommand, runSocialCommand } from "../../client/social-commands.ts";
import { partyState, partyInfo, partyCommandLines } from "../../client/party-state.ts";
import { partyInvitation } from "../../client/party-invitation.ts";
import type { ConfirmDialogOptions } from "../../client/itemdialogs.ts";
import { routeChatInput } from "../src/net/chat-input.ts";
import { PartyRegistry } from "../src/game/parties.ts";
import { encodePartyTable, readPartyTable } from "../src/protocol/party.ts";
import { PacketReader } from "../src/protocol/packet.ts";

for (const [text, command, name] of [
  ["/파티정보", "info", ""],
  ["/파티만들기", "create", ""],
  ["/파티탈퇴", "leave", ""],
  ["/파티초대 상대이름", "invite", "상대이름"],
  ["/파티강퇴 OtherUser", "kick", "OtherUser"],
  ["/PARTY info", "info", ""],
  ["/party accept", "accept", ""],
  ["/파티 decline", "decline", ""],
] as const)
  test(`native/alias command consumes ${text}`, () =>
    assert.deepEqual(parseSocialCommand(text), { kind: "party", command, name }));
test("native whisper/find and browser aliases have one shared private parser", () => {
  for (const text of ["/귓속말 상대이름 비밀  내용", "/w 상대이름 비밀  내용"])
    assert.deepEqual(parseSocialCommand(text), {
      kind: "whisper",
      name: "상대이름",
      text: "비밀  내용",
    });
  assert.deepEqual(parseSocialCommand("/찾기 상대이름"), { kind: "find", name: "상대이름" });
  assert.deepEqual(parseSocialCommand("/F OtherUser"), { kind: "find", name: "OtherUser" });
  assert.equal(parseSocialCommand("hello"), undefined);
  assert.equal(
    parseSocialCommand("/파티초대\tOtherUser"),
    undefined,
    "526070 uses literal ASCII space, not tab",
  );
});
test("malformed/unsupported/unknown slash lines and rejected whispers NEVER call public say", async () => {
  const calls: string[] = [];
  const actions = {
    party: async () => {
      calls.push("party");
    },
    whisper: async () => {
      throw Error("private refusal");
    },
    find: async () => {
      calls.push("find");
    },
    trade: async () => {
      calls.push("trade");
    },
    say: async (text: string) => {
      calls.push(text);
    },
    selfName: () => "자기이름",
  };
  for (const text of [
    "/귓속말 OtherUser secret",
    "/w OtherUser secret",
    "/귓속말 OtherUser",
    "/파티만들기 extra",
    "/파티탈퇴 extra",
    "/party invite",
    "/party create OtherUser",
    "/교환\nnext",
    "/unknown private",
    "/w OtherUser secret\nnext",
  ])
    await assert.rejects(routeChatInput(text, actions));
  assert.deepEqual(calls, []);
  await routeChatInput("hello", actions);
  assert.deepEqual(calls, ["hello"]);
});
test("shared router applies original524A00 whisper admission before any private send or public fallback", async () => {
  const sent: string[] = [];
  const actions = {
    party: async () => {},
    whisper: async (name: string) => {
      sent.push(name);
    },
    find: async () => {},
    trade: async () => {},
    say: async () => {
      sent.push("public");
    },
    selfName: () => "자기이름",
  };
  for (const [text, reason] of [
    ["/귓속말 Alt secret", /잘못된 아이디입니다/],
    ["/w 자기이름 secret", /자신에게는 귓속말을 할 수 없습니다/],
    ["/귓속말 Illll secret", /잘못된 아이디입니다/],
  ] as const)
    await assert.rejects(routeChatInput(text, actions), reason);
  assert.deepEqual(sent, [], "4..12 CP949 bytes, four I/l and self-whisper are original refusals");
  await routeChatInput("/귓속말 OtherUser secret", actions);
  assert.deepEqual(sent, ["OtherUser"]);
});
test("synchronous browser consumption never waits for or falls back from private/party/error callbacks", () => {
  const calls: unknown[] = [];
  const actions = {
    party: (command: string, name: string) => calls.push([command, name]),
    request: (name: string, text?: string) => calls.push([name, text]),
    trade: (name: string) => calls.push(["trade", name]),
    error: (message: string) => calls.push(message),
  };
  assert.equal(runSocialCommand("/파티정보", actions), true);
  assert.equal(runSocialCommand("/귓속말 상대이름 secret", actions), true);
  assert.equal(runSocialCommand("/교환 상대이름", actions), true);
  assert.equal(runSocialCommand("public", actions), false);
  assert.deepEqual(calls.slice(0, 2), [
    ["info", ""],
    ["상대이름", "secret"],
  ]);
  assert.deepEqual(calls[2], ["trade", "상대이름"], "/교환 routes to the trade action");
  assert.equal(calls.length, 3);
});
test("six-slot decoder retains empty leading/interior slots; state never promotes compressed leader", () => {
  const members = [
    { characterId: 0, name: "" },
    { characterId: 7, name: "Leader" },
    { characterId: 8, name: "" },
    { characterId: 9, name: "Member" },
  ];
  const decoded = readPartyTable(new PacketReader(encodePartyTable(members)));
  assert.deepEqual(decoded, [
    ...members,
    { characterId: 0, name: "" },
    { characterId: 0, name: "" },
  ]);
  assert.deepEqual(encodePartyTable(decoded), encodePartyTable(members));
  const state = partyState();
  state.receive({ kind: "sync", partyId: 42, members: decoded }, 7);
  assert.equal(state.id, 42);
  assert.equal(state.leader(7), false);
  assert.equal(state.targetId("Leader"), 7);
  assert.equal(state.targetId("leader"), 0);
});
test("55C5E0 state transitions and55CC40 original six-space local info, snapshots, stale bytes and reset", () => {
  const state = partyState();
  assert.deepEqual(partyInfo(state, 7), ["가입한 파티가 없습니다"]);
  state.receive({ kind: "created", partyId: 42 }, 7, "자기이름");
  assert.deepEqual(partyInfo(state, 7), ["파티원: 자기이름     ", "당신은 파티장입니다."]);
  const snapshot = state.roster();
  snapshot[0]!.name = "mutated";
  assert.equal(state.roster()[0]?.name, "자기이름");
  state.receive({ kind: "sync", partyId: 43, members: [{ characterId: 8, name: "OtherUser" }] }, 7);
  assert.equal(state.id, 43, "native sync does not infer self membership");
  assert.deepEqual(partyInfo(state, 7), ["파티원: OtherUser     "]);
  state.receive(
    {
      kind: "left",
      partyId: 43,
      characterId: 7,
      name: "Self",
      kicked: true,
      members: [{ characterId: 7, name: "Self" }],
    },
    7,
  );
  assert.equal(state.id, 0, "named self removal wins over contradictory roster");
  state.receive(
    { kind: "joined", partyId: 44, name: "OtherUser", members: [{ characterId: 7, name: "Self" }] },
    7,
  );
  state.receive({ kind: "ended", partyId: 44, leaderId: 7 }, 7);
  assert.equal(state.id, 0);
  assert.equal(state.roster()[0]?.name, "Self", "native end gates but doesn't zero old bytes");
  assert.deepEqual(partyInfo(state, 7), ["가입한 파티가 없습니다"]);
  state.clear();
  assert.equal(state.roster().length, 6);
  assert.ok(state.roster().every((m) => m.characterId === 0 && m.name === ""));
  assert.deepEqual(partyCommandLines({ kind: "memberNotFound", name: "상대이름" }), [
    "'상대이름'님은 파티의 멤버가 아닙니다.",
  ]);
});
test("registry lifecycle rejects stale parties, drains disbanded outgoing invites, doesn't mutate another party's latest offer", () => {
  const r = new PartyRegistry(),
    a = r.create({ characterId: 1, name: "A" }),
    b = r.create({ characterId: 2, name: "B" });
  assert.equal(r.invite(a.id, 1, 7), true);
  assert.equal(r.invite(a.id, 1, 8), true);
  assert.equal(r.invite(b.id, 2, 8), true);
  assert.equal(r.invite(a.id, 2, 8), false);
  assert.equal(r.invite(a.id, 1, 1), false);
  r.leave(1);
  assert.equal(r.inviteOf(7), undefined);
  assert.deepEqual(r.inviteOf(8), { partyId: b.id, inviterId: 2 });
  assert.equal(
    r.join(a, { characterId: 7, name: "Target" }),
    undefined,
    "held stale Party object cannot create dangling membership",
  );
  assert.equal(r.invite(a.id, 1, 7), false);
  assert.equal(r.partyOf(7), undefined);
  const c = r.create({ characterId: 7, name: "Target" });
  assert.ok(c);
  assert.equal(r.inviteOf(7), undefined);
  assert.equal(r.invite(b.id, 2, 9), true);
  r.create({ characterId: 9, name: "NewLeader" });
  assert.equal(r.inviteOf(9), undefined);
});
test("owned confirmation handles first offer, callbacks, busy, capability, native membership and stale context without closing another owner", () => {
  let options: ConfirmDialogOptions | undefined,
    owner: object | undefined = {},
    allowed = true,
    busy = false,
    closed = 0,
    notices = 0;
  const replies: unknown[] = [];
  const modal = {
    confirm(o: ConfirmDialogOptions) {
      if (busy) return false;
      options = o;
      return true;
    },
    close() {
      closed++;
      options = undefined;
    },
  };
  const prompt = partyInvitation({
    modal,
    context: () => owner,
    canOpen: () => !busy,
    available: () => allowed,
    reply: (id, yes) => replies.push([id, yes]),
    unavailable: () => notices++,
  });
  prompt.offer(1, "첫초대자");
  const first = options!;
  prompt.offer(2, "두번째");
  assert.equal(prompt.pending, 1);
  prompt.membershipChanged(true);
  assert.equal(closed, 1);
  assert.deepEqual(replies, [[1, false]]);
  first.accept(1);
  first.reject?.();
  prompt.membershipChanged(true);
  assert.equal(replies.length, 1);
  assert.equal(closed, 1);
  prompt.offer(3, "OtherUser");
  const stale = options!;
  owner = {};
  stale.accept(1);
  assert.deepEqual(replies.at(-1), [3, false]);
  prompt.offer(4, "OtherUser");
  options!.accept(1);
  options!.reject?.();
  assert.deepEqual(replies.at(-1), [4, true]);
  busy = true;
  prompt.offer(5, "OtherUser");
  assert.deepEqual(replies.at(-1), [5, false]);
  assert.equal(closed, 1);
  allowed = false;
  prompt.offer(6, "OtherUser");
  assert.deepEqual(replies.at(-1), [6, false]);
  assert.equal(notices, 1);
});
