import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader, PacketUnderflowError } from "../src/protocol/packet.ts";
import {
  PARTY_MAX_MEMBERS,
  PARTY_OPCODE,
  PARTY_REQUEST_TYPE,
  PARTY_RESULT_TYPE,
  describeClientPartyRequest,
  describePartyResult,
  encodeClientPartyRequest,
  encodePartyResult,
  encodePartyTable,
  readClientPartyRequest,
  readPartyResult,
  readPartyTable,
  type PartyMember,
  type PartyResult,
} from "../src/protocol/party.ts";
import { PartyRegistry } from "../src/game/parties.ts";
import { describeClientFieldPacket, describeFieldPacket } from "../src/protocol/field.ts";

/** `07000000 09000000 00000000 …` for two members, then the 13-byte names, per FINDINGS 4.37. */
const TWO_MEMBERS: PartyMember[] = [
  { characterId: 7, name: "hero" },
  { characterId: 9, name: "alt" },
];
const TABLE_TWO =
  "070000000900000000000000000000000000000000000000" +
  "6865726f000000000000000000" +
  "616c7400000000000000000000" +
  "00".repeat(13 * 4);
const TABLE_ONE =
  "070000000000000000000000000000000000000000000000" +
  "6865726f000000000000000000" +
  "00".repeat(13 * 5);

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function bytesFromHex(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "hex"));
}

// ---------------------------------------------------------------------------------------- 0x26 (c2s)

test("0x26 party requests: the five senders' bytes (FINDINGS 4.37)", () => {
  // `sub_471CD0` writes type 0 and nothing else.
  assert.equal(hex(encodeClientPartyRequest({ kind: "create" })), "2600");
  // `sub_471E90` writes type 1 and a literal 0; the second byte has no located meaning yet.
  assert.equal(hex(encodeClientPartyRequest({ kind: "leave", unknown: 0 })), "260100");
  // The invite dialog's "yes" echoes the inviter id it read from `0x10` type 3 (`sub_55C5E0`).
  assert.equal(hex(encodeClientPartyRequest({ kind: "accept", inviterId: 7 })), "260207000000");
  // `/파티초대 <name>`: `sub_472050` writes the target's character id from the CUserPool entry.
  assert.equal(hex(encodeClientPartyRequest({ kind: "invite", targetId: 9 })), "260309000000");
  // `/파티강퇴 <name>`: `sub_4722E0` writes the id `sub_55DB00` found in the party table.
  assert.equal(hex(encodeClientPartyRequest({ kind: "kick", targetId: 300 })), "26042c010000");
});

test("0x26 round-trips, and refuses a type it has no sender for", () => {
  const requests = [
    { kind: "create" },
    { kind: "leave", unknown: 0 },
    { kind: "accept", inviterId: 7 },
    { kind: "invite", targetId: 9 },
    { kind: "kick", targetId: 300 },
  ] as const;
  for (const request of requests) {
    const bytes = encodeClientPartyRequest(request);
    assert.deepEqual(readClientPartyRequest(new PacketReader(bytes, 1)), request);
  }
  assert.equal(hex(encodeClientPartyRequest({ kind: "create" })).slice(0, 2), "26");
  assert.throws(
    () => readClientPartyRequest(new PacketReader(bytesFromHex("2605"), 1)),
    RangeError,
  );
  assert.throws(
    () => readClientPartyRequest(new PacketReader(bytesFromHex("2603"), 1)),
    PacketUnderflowError,
  );
});

test("describeClientPartyRequest names each request", () => {
  assert.equal(describeClientPartyRequest({ kind: "create" }), "0x26 party: create");
  assert.equal(
    describeClientPartyRequest({ kind: "leave", unknown: 0 }),
    "0x26 party: leave (unknown=0)",
  );
  assert.equal(
    describeClientPartyRequest({ kind: "accept", inviterId: 7 }),
    "0x26 party: accept inviter=7",
  );
  assert.equal(
    describeClientPartyRequest({ kind: "invite", targetId: 9 }),
    "0x26 party: invite target=9",
  );
  assert.equal(
    describeClientPartyRequest({ kind: "kick", targetId: 9 }),
    "0x26 party: kick target=9",
  );
  // The decode tool reaches it through the field describer, like the other c2s packets.
  assert.equal(
    describeClientFieldPacket(encodeClientPartyRequest({ kind: "invite", targetId: 9 })),
    "0x26 party: invite target=9",
  );
});

// ---------------------------------------------------------------------------------------- the table

test("the 102-byte roster is `u32 id[6]` + `char name[6][13]`", () => {
  const table = encodePartyTable(TWO_MEMBERS);
  assert.equal(table.length, 102);
  assert.equal(hex(table), TABLE_TWO);
  assert.deepEqual(readPartyTable(new PacketReader(table)), [
    ...TWO_MEMBERS,
    ...Array.from({ length: 4 }, () => ({ characterId: 0, name: "" })),
  ]);
  // Six slots is the client's own limit (`sub_45F5C0` copies 0x66 bytes).
  assert.equal(PARTY_MAX_MEMBERS, 6);
  assert.throws(
    () =>
      encodePartyTable([
        ...TWO_MEMBERS,
        ...TWO_MEMBERS,
        ...TWO_MEMBERS,
        { characterId: 1, name: "x" },
      ]),
    RangeError,
  );
});

// ---------------------------------------------------------------------------------------- 0x10 (s2c)

test("0x10 party results: bytes for every type the client reads", () => {
  assert.equal(hex(encodePartyResult({ kind: "created", partyId: 1 })), "100601000000");
  assert.equal(
    hex(encodePartyResult({ kind: "invite", inviterId: 7, inviterName: "hero" })),
    "10030700000004006865726f",
  );
  assert.equal(
    hex(encodePartyResult({ kind: "sync", partyId: 1, members: TWO_MEMBERS })),
    `100501000000${TABLE_TWO}`,
  );
  assert.equal(
    hex(encodePartyResult({ kind: "joined", partyId: 1, name: "alt", members: TWO_MEMBERS })),
    `100d010000000300616c74${TABLE_TWO}`,
  );
  // `flag = 1` is "somebody left": the kicked byte says which, and the table is the one *after* it.
  assert.equal(
    hex(
      encodePartyResult({
        kind: "left",
        partyId: 1,
        characterId: 9,
        kicked: false,
        name: "alt",
        members: [TWO_MEMBERS[0]!],
      }),
    ),
    `100a010000000900000001000300616c74${TABLE_ONE}`,
  );
  // `flag = 0` is "the leader left, the party is gone": two u32s and nothing else.
  assert.equal(
    hex(encodePartyResult({ kind: "ended", partyId: 1, leaderId: 7 })),
    "100a010000000700000000",
  );
  assert.equal(hex(encodePartyResult({ kind: "alreadyInParty" })), "1007");
  assert.equal(hex(encodePartyResult({ kind: "beginnerCannotCreate" })), "1008");
  assert.equal(hex(encodePartyResult({ kind: "notInParty" })), "100b");
  assert.equal(hex(encodePartyResult({ kind: "full" })), "100f");
  assert.equal(hex(encodePartyResult({ kind: "unknown" })), "1000");
});

test("0x10 round-trips, and an unknown type reads as the client's default case", () => {
  const results: PartyResult[] = [
    { kind: "created", partyId: 1 },
    { kind: "invite", inviterId: 7, inviterName: "hero" },
    { kind: "sync", partyId: 1, members: TWO_MEMBERS },
    { kind: "joined", partyId: 1, name: "alt", members: TWO_MEMBERS },
    {
      kind: "left",
      partyId: 1,
      characterId: 9,
      kicked: true,
      name: "alt",
      members: [TWO_MEMBERS[0]!],
    },
    { kind: "ended", partyId: 1, leaderId: 7 },
    { kind: "alreadyInParty" },
    { kind: "beginnerCannotCreate" },
    { kind: "notInParty" },
    { kind: "full" },
    { kind: "unknown" },
  ];
  for (const result of results) {
    const bytes = encodePartyResult(result);
    const decoded = readPartyResult(new PacketReader(bytes, 1));
    const expected =
      "members" in result
        ? {
            ...result,
            members: Array.from(
              { length: 6 },
              (_, i) => result.members[i] ?? { characterId: 0, name: "" },
            ),
          }
        : result;
    assert.deepEqual(decoded, expected);
    assert.deepEqual(
      encodePartyResult(decoded),
      bytes,
      "fixed-slot decode re-encodes byte-exact, including all zero slots",
    );
  }
  // Types with no case (the client's `default`) come back as `unknown`, and `7`/`14` share a message.
  assert.deepEqual(readPartyResult(new PacketReader(bytesFromHex("100e"), 1)), {
    kind: "alreadyInParty",
  });
  assert.deepEqual(readPartyResult(new PacketReader(bytesFromHex("1099"), 1)), { kind: "unknown" });
});

test("describePartyResult and describeFieldPacket name the 0x10 lines", () => {
  assert.equal(
    describePartyResult({ kind: "joined", partyId: 3, name: "alt", members: TWO_MEMBERS }),
    "0x10 party: alt joined 3 [hero, alt]",
  );
  assert.equal(
    describeFieldPacket(encodePartyResult({ kind: "created", partyId: 1 })),
    "0x10 party: created 1",
  );
  assert.match(
    describeFieldPacket(bytesFromHex("100d010000000300616c74"))!,
    /^0x10 party: \(truncated: /,
  );
});

// ---------------------------------------------------------------------------------------- the registry

test("PartyRegistry: create, join, and the roster of six", () => {
  const parties = new PartyRegistry();
  const hero = { characterId: 7, name: "hero" };
  const party = parties.create(hero);
  assert.equal(party.id, 1);
  assert.equal(parties.partyOf(7), party);
  assert.equal(parties.isLeader(7), true);
  assert.equal(parties.count, 1);

  const alt = { characterId: 9, name: "alt" };
  assert.deepEqual(parties.join(party, alt), [hero, alt]);
  assert.equal(parties.partyOf(9), party);
  assert.equal(parties.isLeader(9), false);

  const four = [10, 11, 12, 13].map((id) => ({ characterId: id, name: `p${id}` }));
  for (const member of four) assert.notEqual(parties.join(party, member), undefined);
  assert.equal(parties.hasRoom(party), false);
  // A seventh member and a member of another party are both refused; the first id stays free.
  assert.equal(parties.join(party, { characterId: 14, name: "p14" }), undefined);
  assert.equal(parties.join(party, { characterId: 9, name: "alt" }), undefined);
  assert.equal(parties.partyOf(14), undefined);

  // A second party gets a fresh id, and a character cannot be in two.
  assert.throws(() => parties.create({ characterId: 7, name: "hero" }));
  assert.equal(parties.create({ characterId: 20, name: "other" }).id, 2);
});

test("PartyRegistry: invites are one per target and are consumed by a join", () => {
  const parties = new PartyRegistry();
  const party = parties.create({ characterId: 7, name: "hero" });
  parties.invite(party.id, 7, 9);
  assert.deepEqual(parties.inviteOf(9), { partyId: party.id, inviterId: 7 });
  // A later invite to the same target replaces the earlier one (the client's dialog is modal).
  parties.invite(party.id, 7, 10);
  assert.deepEqual(parties.inviteOf(9), { partyId: party.id, inviterId: 7 });
  parties.join(party, { characterId: 10, name: "p10" });
  assert.equal(parties.inviteOf(10), undefined);
  parties.dropInvite(9);
  assert.equal(parties.inviteOf(9), undefined);
});

test("PartyRegistry: a member leaves, the leader's leave disbands", () => {
  const parties = new PartyRegistry();
  const hero = { characterId: 7, name: "hero" };
  const alt = { characterId: 9, name: "alt" };
  const party = parties.create(hero);
  parties.join(party, alt);

  const left = parties.leave(9)!;
  assert.equal(left.leaderLeft, false);
  assert.deepEqual(left.members, [hero, alt]);
  assert.deepEqual(left.remaining, [hero]);
  assert.deepEqual(party.members, [hero]);
  assert.equal(parties.partyOf(9), undefined);
  assert.equal(parties.leave(9), undefined);

  // The leader leaves: the party is gone and nobody is left pointing at it.
  parties.join(party, { characterId: 11, name: "p11" });
  const ended = parties.leave(7)!;
  assert.equal(ended.leaderLeft, true);
  assert.deepEqual(ended.members, [hero, { characterId: 11, name: "p11" }]);
  assert.deepEqual(ended.remaining, []);
  assert.equal(parties.count, 0);
  assert.equal(parties.partyOf(11), undefined);
  assert.equal(parties.partyOf(7), undefined);

  // A disbanded id is not reused: the next party is 2, not 1.
  assert.equal(parties.create({ characterId: 12, name: "p12" }).id, 2);
  assert.equal(PARTY_REQUEST_TYPE.create, 0);
  assert.equal(PARTY_OPCODE.result, 0x10);
  assert.equal(PARTY_OPCODE.request, 0x26);
  assert.equal(PARTY_RESULT_TYPE.memberLeft, 10);
});

test("PartyRegistry authoritative resolveInvite binds target/confirmed inviter/party/leader; overwritten or dissolved offers cannot redirect acceptance", () => {
  const parties = new PartyRegistry(),
    a = parties.create({ characterId: 1, name: "LeaderA" }),
    b = parties.create({ characterId: 2, name: "LeaderB" });
  assert.equal(parties.resolveInvite(7, 1), undefined);
  parties.invite(a.id, 1, 7);
  assert.equal(parties.resolveInvite(8, 1), undefined);
  assert.equal(parties.resolveInvite(7, 2), undefined);
  assert.equal(parties.resolveInvite(7, 1), a);
  parties.invite(b.id, 2, 7);
  assert.equal(
    parties.resolveInvite(7, 1),
    undefined,
    "old modal A must NOT join current pending party B",
  );
  assert.deepEqual(
    parties.inviteOf(7),
    { partyId: b.id, inviterId: 2 },
    "wrong response cannot consume current offer",
  );
  assert.equal(parties.resolveInvite(7, 2), b);
  parties.leave(2);
  assert.equal(parties.resolveInvite(7, 2), undefined);
  parties.invite(a.id, 1, 7);
  parties.join(a, { characterId: 7, name: "Target" });
  assert.equal(parties.resolveInvite(7, 1), undefined, "join consumes invite");
});
