import test from "node:test";
import assert from "node:assert/strict";
import { syntheticSocialPeer, byteName } from "./fixtures/synthetic-social-peer.ts";
import { encodePartyResult, readClientPartyRequest } from "../src/protocol/party.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeStatUpdate } from "../src/protocol/stat.ts";
import { routeChatInput } from "../src/net/chat-input.ts";
import { encodeCp949, decodeCp949 } from "../src/protocol/cp949.ts";
import { readClientUserRequest, encodeUserWhisperAnswer } from "../src/protocol/field.ts";
import { clientEventJson } from "../src/net/client-event-json.ts";

test("synthetic native peer: all local party guards/info → actualJSON; fixed slots, map persistence, death read-only, authoritative membership only", async (t) => {
  const p = await syntheticSocialPeer(t),
    { session, events, send, barrier, packets } = p;
  const requests = () => packets.filter((p) => p[0] === 0x26);
  const feedback = () => events.at(-1);
  await session.partyCommand("info");
  assert.deepEqual(feedback(), {
    kind: "party-command",
    feedback: { kind: "info", lines: ["가입한 파티가 없습니다"] },
  });
  await session.partyCommand("leave");
  assert.deepEqual(feedback(), { kind: "party-command", feedback: { kind: "notInParty" } });
  for (const command of ["invite", "kick"]) {
    await session.partyCommand(command, "Missing");
    assert.deepEqual(feedback(), { kind: "party-command", feedback: { kind: "notLeader" } });
  }
  await barrier();
  assert.equal(requests().length, 0);
  await session.partyCommand("create");
  await barrier();
  assert.deepEqual(readClientPartyRequest(new PacketReader(requests()[0]!, 1)), { kind: "create" });
  await session.partyCommand("info");
  assert.deepEqual(
    feedback(),
    { kind: "party-command", feedback: { kind: "info", lines: ["가입한 파티가 없습니다"] } },
    "sending create does not fake success",
  );
  send(encodePartyResult({ kind: "created", partyId: 42 }));
  await barrier();
  await session.partyCommand("info");
  assert.deepEqual(JSON.parse(JSON.stringify(clientEventJson(events.at(-1)!, 0))), {
    t: "party-command",
    feedback: { kind: "info", lines: ["파티원: 자기이름     ", "당신은 파티장입니다."] },
  });
  await session.partyCommand("create");
  assert.deepEqual(feedback(), { kind: "party-command", feedback: { kind: "alreadyInParty" } });
  await session.partyCommand("invite", "Missing");
  assert.deepEqual(feedback(), { kind: "party-command", feedback: { kind: "targetNotFound" } });
  await session.partyCommand("kick", "Missing");
  assert.deepEqual(feedback(), {
    kind: "party-command",
    feedback: { kind: "memberNotFound", name: "Missing" },
  });
  await session.partyCommand("invite", "상대이름");
  await barrier();
  assert.deepEqual(readClientPartyRequest(new PacketReader(requests().at(-1)!, 1)), {
    kind: "invite",
    targetId: 7,
  });
  send(p.field());
  await barrier();
  await session.partyCommand("info");
  assert.equal(events.at(-1)?.kind, "party-command");
  assert.deepEqual(
    feedback(),
    {
      kind: "party-command",
      feedback: { kind: "info", lines: ["파티원: 자기이름     ", "당신은 파티장입니다."] },
    },
    "party state survives field replacement",
  );
  send(
    encodePartyResult({
      kind: "sync",
      partyId: 42,
      members: [
        { characterId: 0, name: "" },
        { characterId: 91, name: byteName("자기이름") },
        { characterId: 7, name: byteName("상대이름") },
      ],
    }),
  );
  await barrier();
  await session.partyCommand("invite", "상대이름");
  assert.deepEqual(
    feedback(),
    { kind: "party-command", feedback: { kind: "notLeader" } },
    "zero first slot must NOT promote self",
  );
  send(
    encodePartyResult({
      kind: "sync",
      partyId: 42,
      members: [
        { characterId: 91, name: byteName("자기이름") },
        { characterId: 7, name: byteName("상대이름") },
      ],
    }),
  );
  await barrier();
  await session.partyCommand("kick", "상대이름");
  await barrier();
  assert.deepEqual(readClientPartyRequest(new PacketReader(requests().at(-1)!, 1)), {
    kind: "kick",
    targetId: 7,
  });
  send(
    encodePartyResult({
      kind: "left",
      partyId: 42,
      characterId: 91,
      kicked: true,
      name: byteName("자기이름"),
      members: [{ characterId: 91, name: byteName("자기이름") }],
    }),
  );
  await barrier();
  await session.partyCommand("info");
  assert.deepEqual(
    feedback(),
    { kind: "party-command", feedback: { kind: "info", lines: ["가입한 파티가 없습니다"] } },
    "self leave is authoritative even with contradictory self roster",
  );
  send(encodeStatUpdate({ diff: { hp: 0 } }));
  await barrier();
  await session.partyCommand("info");
  assert.equal(events.at(-1)?.kind, "party-command", "read-only info works while dead");
  await assert.rejects(session.partyCommand("create"), /living/);
  assert.equal(requests().length, 3);
  assert.equal(
    events.some((e) => e.kind === "unknown"),
    false,
  );
  session.close();
  await assert.rejects(session.partyCommand("info"), /field session/);
});
test("actual shared bridge chat router → synthetic encrypted0x23 CP949 private/find, never private text in0x12", async (t) => {
  const p = await syntheticSocialPeer(t);
  const actions = {
    party: (c: string, n: string) => p.session.partyCommand(c, n),
    whisper: (n: string, text: string) => p.session.whisper(byteName(n), encodeCp949(text)),
    find: (n: string) => p.session.find(byteName(n)),
    say: (text: string) => p.session.say(encodeCp949(text)),
    selfName: () => p.session.selfView?.name ?? "",
  };
  await routeChatInput("/귓속말 상대이름 비밀내용", actions);
  await p.barrier();
  const packet = p.packets.find((p) => p[0] === 0x23);
  assert.ok(packet);
  const request = readClientUserRequest(new PacketReader(packet, 1));
  assert.equal(request.kind, 6);
  assert.equal(request.name, byteName("상대이름"));
  assert.ok(request.text);
  assert.equal(decodeCp949(request.text), "비밀내용");
  const before = p.packets.length;
  await assert.rejects(routeChatInput("/w OtherUser private", actions), /다른 요청/);
  await assert.rejects(routeChatInput("/교환 OtherUser", actions));
  await assert.rejects(routeChatInput("/unknown secret", actions));
  await p.barrier();
  assert.ok(
    p.packets
      .slice(before)
      .every((p) => p[0] !== 0x12 || new PacketReader(p, 1).readAsciiString() === ""),
  );
  assert.ok(
    p.packets
      .filter((p) => p[0] === 0x12)
      .every((p) => new PacketReader(p, 1).readAsciiString() === ""),
  );
  p.send(encodeUserWhisperAnswer({ name: byteName("상대이름"), delivered: true }));
  await p.barrier();
  // 524A00 admission belongs to the original /귓속말 entry: rejected names never reach 0x23.
  const gated = p.packets.filter((q) => q[0] === 0x23).length;
  await assert.rejects(routeChatInput("/귓속말 Alt secret", actions), /잘못된 아이디입니다/);
  await assert.rejects(
    routeChatInput("/w 자기이름 secret", actions),
    /자신에게는 귓속말을 할 수 없습니다/,
  );
  await p.barrier();
  assert.equal(p.packets.filter((q) => q[0] === 0x23).length, gated, "rejected names send nothing");
  await routeChatInput("/찾기 상대이름", actions);
  await p.barrier();
  const find = p.packets.filter((p) => p[0] === 0x23).at(-1)!;
  assert.deepEqual(readClientUserRequest(new PacketReader(find, 1)), {
    kind: 5,
    name: byteName("상대이름"),
  });
});
