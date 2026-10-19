/**
 * The messenger bridge in ClientSession: every `0x4D` frame becomes a `messenger` event
 * verbatim, and the four `0x24` methods leave only when a field session exists
 * (`sub_4DE280`/`sub_4E24B0`/`sub_4DE490`/`sub_4DDFE0`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { syntheticSocialPeer, byteName } from "./fixtures/synthetic-social-peer.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  encodeMessengerChat,
  encodeMessengerInvite,
  encodeMessengerInviteResult,
  encodeMessengerJoinFailed,
  encodeMessengerLeft,
  encodeMessengerParticipant,
  readClientMessengerRequest,
  type ClientMessengerRequest,
} from "../src/protocol/messenger.ts";
import type { ClientEvent } from "../src/client/session.ts";

const messengerEvents = (events: ClientEvent[]) =>
  events.filter((e): e is Extract<ClientEvent, { kind: "messenger" }> => e.kind === "messenger");
const lastRequest = (packets: Uint8Array[]): ClientMessengerRequest => {
  const packet = [...packets].reverse().find((p) => p[0] === 0x24);
  assert.ok(packet, "no 0x24 was sent");
  return readClientMessengerRequest(new PacketReader(packet, 1));
};

test("0x4D becomes messenger events; 0x24 leaves with the native payloads", async (t) => {
  const p = await syntheticSocialPeer(t);

  // 1. BtChat opens a fresh room: `0x24 type 0` with roomId 0 (`sub_4DDFE0`).
  await p.session.messengerEnter(0);
  await p.barrier();
  assert.deepEqual(lastRequest(p.packets), { kind: "enter", roomId: 0 });

  // 2. The server fills the room; every type decodes into one event each.
  p.send(
    encodeMessengerParticipant(
      { slot: 0, name: byteName("자기이름"), level: 30, face: 20001, look: [30000] },
      false,
    ),
  );
  p.send(
    encodeMessengerParticipant(
      { slot: 1, name: byteName("상대이름"), level: 25, face: 20002, look: [30000, 1012000] },
      true,
    ),
  );
  p.send(encodeMessengerChat(byteName("상대이름1")));
  p.send(encodeMessengerChat(byteName("상대이름 : 안녕")));
  p.send(encodeMessengerLeft(1));
  p.send(encodeMessengerJoinFailed(1));
  p.send(encodeMessengerInviteResult({ name: byteName("상대이름"), ok: 0 }));
  await p.barrier();
  const events = messengerEvents(p.events).map((e) => e.event);
  assert.deepEqual(events, [
    {
      kind: "participant",
      announce: false,
      participant: { slot: 0, name: "자기이름", level: 30, face: 20001, look: [30000] },
    },
    {
      kind: "participant",
      announce: true,
      participant: { slot: 1, name: "상대이름", level: 25, face: 20002, look: [30000, 1012000] },
    },
    { kind: "chat", line: "상대이름1" },
    { kind: "chat", line: "상대이름 : 안녕" },
    { kind: "left", slot: 1 },
    { kind: "joinFailed", code: 1 },
    { kind: "inviteResult", name: "상대이름", ok: 0 },
  ]);

  // 3. The invite modal's yes re-sends the room id the server carried in type 3.
  p.send(encodeMessengerInvite({ inviterName: byteName("정"), roomId: 42 }));
  await p.barrier();
  const invite = messengerEvents(p.events).at(-1);
  assert.deepEqual(invite?.event, { kind: "invite", inviterName: "정", roomId: 42 });

  // 4. Say / command / leave map onto types 5 / 3 / 2 with the native string payloads.
  await p.session.messengerSay("자기이름 : 안녕");
  await p.session.messengerCommand("친구");
  await p.session.messengerLeave();
  await p.barrier();
  const tail = p.packets
    .filter((packet) => packet[0] === 0x24)
    .map((packet) => readClientMessengerRequest(new PacketReader(packet, 1)));
  assert.deepEqual(tail.slice(-3), [
    { kind: "chat", line: byteName("자기이름 : 안녕") },
    { kind: "command", text: byteName("친구") },
    { kind: "leave" },
  ]);
});
