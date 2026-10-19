import { assertPartyInviteIdentity } from "../src/net/webclient.ts";
import { partyMessage, partyInvitationText } from "../../client/party.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { FameRequestClock, FAME_REQUEST_INTERVAL } from "../src/client/fame.ts";
import { fameMessage } from "../../client/fame.ts";
import {
  playerMenuRows,
  playerMenuLayout,
  playerMenuRowRect,
  playerMenuRowAt,
  playerContains,
  playerMenuParty,
} from "../../client/player-menu-data.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeFameResult, readFameResult, describeFameResult } from "../src/protocol/fame.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";

test("55D7B0 reserves on SEND, first request allowed, exact300000 boundary, no automatic refund", () => {
  let now = 0;
  const clock = new FameRequestClock(() => now);
  assert.equal(FAME_REQUEST_INTERVAL, 300000);
  assert.equal(clock.reserve(), true);
  assert.equal(clock.reserve(), false);
  now = 299999;
  assert.equal(clock.reserve(), false);
  now = 300000;
  assert.equal(clock.reserve(), true);
  now = 599999;
  assert.equal(clock.reserve(), false);
  now = 600000;
  assert.equal(clock.reserve(), true);
  clock.reset();
  assert.equal(clock.reserve(), true);
});
test("55D7B0 signed DWORD elapsed wraps at2^32 and keeps native negative-half behavior", () => {
  let now = 0xfffffff0;
  const clock = new FameRequestClock(() => now);
  assert.equal(clock.reserve(), true);
  now += 299999;
  assert.equal(clock.reserve(), false);
  now++;
  assert.equal(clock.reserve(), true);
  now += 0x80000000;
  assert.equal(clock.reserve(), false);
});
test("55C390 all response texts and silent1, local self for5, font6 local refusals", () => {
  for (const up of [true, false]) {
    const suffix = up ? "올려주었습니다." : "내렸습니다.";
    assert.equal(
      fameMessage({ kind: "changed", name: "상대", up }, "자신"),
      `'상대'님의 인기도를 ${suffix}`,
    );
    assert.equal(
      fameMessage({ kind: "received", name: "상대", up }, "자신"),
      `'상대'님께서 '자신'님의 인기도를 ${suffix}`,
    );
  }
  assert.equal(fameMessage({ kind: "ignored" }, "자신"), undefined);
  assert.equal(
    fameMessage({ kind: "beginner" }, ""),
    "초보자는 인기도를 올리거나 내리지 못합니다.",
  );
  assert.equal(
    fameMessage({ kind: "alreadyToday" }, ""),
    "오늘은 더 이상 인기도를 올리거나 내리지 못합니다.",
  );
  assert.equal(
    fameMessage({ kind: "alreadyThisMonth" }, ""),
    "이번 달에는 더 이상 지정된 캐릭터의 인기도를 올리거나 내리지 못합니다.",
  );
  assert.equal(
    fameMessage({ kind: "unknown", type: 255 }, ""),
    "알 수 없는 오류로 인기도를 올리거나 내리지 못했습니다.",
  );
  assert.equal(fameMessage({ kind: "notFound" }, ""), "캐릭터를 찾을 수 없습니다");
  assert.equal(fameMessage({ kind: "cooldown" }, ""), "잠시 후 다시 시도해 보세요");
});
test("0x12 defaults6..255 are generic, consume only type; malformed named payloads still fail", () => {
  for (let type = 6; type <= 255; type++) {
    const reader = new PacketReader(Uint8Array.of(type, 0xaa)),
      result = readFameResult(reader);
    assert.deepEqual(result, { kind: "unknown", type });
    assert.equal(reader.readByte(), 0xaa);
    assert.deepEqual(encodeFameResult(result), Uint8Array.of(0x12, type));
    assert.equal(describeFameResult(result), `0x12 fame: unknown type ${type}`);
  }
  for (const type of [-1, 0, 5, 256, 6.5, NaN])
    assert.throws(() => encodeFameResult({ kind: "unknown", type }), RangeError);
  for (const bytes of [[], [0], [5], [0, 2, 0, 65], [5, 0, 0]])
    assert.throws(() => readFameResult(new PacketReader(Uint8Array.from(bytes))));
  const name = Buffer.from(encodeCp949("가나다")).toString("latin1");
  assert.deepEqual(
    readFameResult(new PacketReader(encodeFameResult({ kind: "received", name, up: true }), 1)),
    { kind: "received", name, up: true },
    "codec keeps its raw CP949 byte-string contract",
  );
});
test("5128B0 native row order/labels; original no-op0 and unfinished trade visibly disabled", () => {
  const rows = playerMenuRows("상대", false);
  assert.deepEqual(
    rows.map((row) => row.text),
    ["상대", "개인정보", "인기도 +", "인기도 -", "귓속말", "교환신청"],
  );
  assert.deepEqual(
    rows.map((row) => row.enabled),
    [false, false, true, true, true, false],
  );
  assert.equal(playerMenuRows("상대", true).at(-1)?.action, "invite");
  assert.ok(rows[1]?.reason && rows[5]?.reason);
});
test("52F0B0 native89x96/111; cursor-bottom anchor and explicit reachable-edge browser policy", () => {
  assert.deepEqual(playerMenuLayout({ x: 300, y: 400 }, 6), {
    x: 300,
    y: 304,
    width: 89,
    height: 96,
  });
  assert.deepEqual(playerMenuLayout({ x: 300, y: 400 }, 7), {
    x: 300,
    y: 289,
    width: 89,
    height: 111,
  });
  assert.deepEqual(playerMenuLayout({ x: 800, y: 0 }, 6), { x: 711, y: 0, width: 89, height: 96 });
  assert.deepEqual(playerMenuLayout({ x: -1, y: 700 }, 7), {
    x: 0,
    y: 489,
    width: 89,
    height: 111,
  });
});
test("52F0B0 native73x13 row hit rect, excludes right/bottom, ignores title/disabled/gaps", () => {
  const rows = playerMenuRows("상대", true),
    rect = playerMenuRowRect(2);
  assert.deepEqual(rect, { x: 12, y: 34, width: 73, height: 13 });
  for (const point of [
    { x: 12, y: 34 },
    { x: 84.99, y: 46.99 },
  ])
    assert.equal(playerMenuRowAt(rows, point), 2);
  for (const point of [
    { x: 85, y: 34 },
    { x: 12, y: 47 },
    { x: 11, y: 34 },
    { x: 12, y: 4 },
    { x: 12, y: 19 },
    { x: 12, y: 79 },
  ])
    assert.equal(playerMenuRowAt(rows, point), undefined);
  assert.equal(playerMenuRowAt(rows, { x: 12, y: 94 }), 6);
});
test("51D6C0/5085E0 first-pool union rectangle, not sprite/facing or two independent rectangles", () => {
  const at = { x: 100, y: 100 };
  assert.equal(playerContains(at, undefined, { x: 78, y: 35 }), true);
  assert.equal(playerContains(at, undefined, { x: 122, y: 35 }), false);
  assert.equal(playerContains(at, undefined, { x: 100, y: 100 }), false);
  assert.equal(
    playerContains(at, { x: 0, y: 200 }, { x: 50, y: 120 }),
    true,
    "gap in UnionRect is hittable",
  );
  assert.equal(playerContains(at, { x: 0, y: 200 }, { x: -22, y: 199 }), true);
  assert.equal(playerContains(at, { x: 0, y: 200 }, { x: 0, y: 200 }), false);
});
test("5128B0 party invitation row is only for first-roster leader; updates/leave/end/session clear", () => {
  const party = playerMenuParty();
  assert.equal(party.leader(1), false);
  party.receive({ kind: "created", partyId: 9 }, 1);
  assert.equal(party.leader(1), true);
  const members = [
    { characterId: 2, name: "Two" },
    { characterId: 1, name: "One" },
  ];
  party.receive({ kind: "sync", partyId: 9, members }, 1);
  assert.equal(party.leader(1), false);
  assert.equal(party.leader(2), true);
  party.receive({ kind: "sync", partyId: 9, members: [{ characterId: 2, name: "Two" }] }, 1);
  assert.equal(party.leader(2), false, "self missing means no current party");
  party.receive({ kind: "created", partyId: 9 }, 1);
  party.clear();
  assert.equal(party.leader(1), false);
});

test("55C5E0 exact self/other join, leave/kick/disband and silent roster; CRLF invitation", () => {
  assert.equal(partyMessage({ kind: "sync", partyId: 1, members: [] }, 1, "자신"), undefined);
  assert.equal(
    partyMessage({ kind: "invite", inviterId: 2, inviterName: "상대" }, 1, "자신"),
    undefined,
  );
  assert.equal(
    partyInvitationText("상대"),
    "'상대'님이 파티에 초대했습니다.\r\n파티에 가입하시겠습니까?",
  );
  assert.equal(
    partyMessage({ kind: "joined", partyId: 1, name: "자신", members: [] }, 1, "자신"),
    "파티에 가입되었습니다.",
  );
  assert.equal(
    partyMessage({ kind: "joined", partyId: 1, name: "상대", members: [] }, 1, "자신"),
    "'상대'님이 파티에 가입하셨습니다",
  );
  for (const kicked of [true, false]) {
    assert.equal(
      partyMessage(
        { kind: "left", partyId: 1, characterId: 1, name: "자신", members: [], kicked },
        1,
        "자신",
      ),
      kicked ? "파티에서 강퇴당했습니다." : "파티를 그만둡니다",
    );
    assert.equal(
      partyMessage(
        { kind: "left", partyId: 1, characterId: 2, name: "상대", members: [], kicked },
        1,
        "자신",
      ),
      kicked ? "'상대'님이 파티에서 강퇴당하셨습니다" : "'상대'님이 파티를 탈퇴하셨습니다",
    );
  }
});

test("558FD0 actually stamps now-minus300000, preserving first-request signed-half idle boundary", () => {
  let now = 0;
  const clock = new FameRequestClock(() => now);
  now = 0x80000000;
  assert.equal(
    clock.reserve(),
    false,
    "not an undefined timestamp that always allows first request",
  );
  now = 0x100000000;
  assert.equal(clock.reserve(), true, "complete DWORD wrap returns to the initial interval");
  clock.reset();
  assert.equal(clock.reserve(), true);
});

test("unverified attached native worlds fail closed for party invite/accept, not create/leave/kick/decline", () => {
  for (const verified of [undefined, false])
    for (const command of ["invite", "accept"])
      assert.throws(() => assertPartyInviteIdentity(verified, command), /身份檢查/);
  for (const command of ["invite", "accept", "create", "leave", "kick", "decline"])
    assert.doesNotThrow(() => assertPartyInviteIdentity(true, command));
  for (const command of ["create", "leave", "kick", "decline"])
    assert.doesNotThrow(() => assertPartyInviteIdentity(false, command));
  const row = playerMenuRows("OtherUser", true, false).at(-1);
  assert.equal(row?.action, "invite");
  assert.equal(row?.enabled, false);
  assert.ok(row?.reason);
});
