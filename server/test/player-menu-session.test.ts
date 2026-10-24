/** Encrypted synthetic peer ONLY. No LoginServer/GameEntryServer, real login/account/player/save/LIVE. */
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { ClientSession, type ClientEvent } from "../src/client/session.ts";
import { clientEventJson } from "../src/net/client-event-json.ts";
import { CipherState } from "../src/protocol/cipher.ts";
import {
  encodeLegacyHandshake,
  LEGACY_HANDSHAKE_BODY_BYTES,
  encodeSessionPacket,
  SessionDeframer,
} from "../src/protocol/session.ts";
import { characterDataOf } from "../src/protocol/chardata.ts";
import {
  encodeSetField,
  encodeUserEnterField,
  encodeUserLeaveField,
  CLIENT_FIELD_OPCODE,
} from "../src/protocol/field.ts";
import { encodeFameResult, readClientFameRequest } from "../src/protocol/fame.ts";
import { encodePartyResult, readClientPartyRequest } from "../src/protocol/party.ts";
import { encodeStatUpdate } from "../src/protocol/stat.ts";
import { encodeSystemNotice } from "../src/protocol/notice.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { fameMessage } from "../../client/fame.ts";

const byteName = (text: string) => Buffer.from(encodeCp949(text)).toString("latin1");
test(
  "encrypted0x12→Session→actualJSON CP949/default/silent/stat;0x20 same-map lookup before cooldown, refused burn, map lifetime; party offer identity and Korean roster",
  { timeout: 10000 },
  async (t) => {
    const character = characterDataOf({
      id: 91,
      name: byteName("자기이름"),
      level: 20,
      job: 0,
      str: 8,
      dex: 6,
      int: 6,
      luk: 5,
      hp: 50,
      maxHp: 50,
      mp: 50,
      maxMp: 50,
      ap: 3,
      mapId: 1000000,
    });
    const field = () =>
      encodeSetField({
        mode: 0,
        full: true,
        randomSeedA: 1,
        randomSeedB: 2,
        randomSeedC: 3,
        character,
      });
    const enter = (id = 7, name = "상대이름") =>
      encodeUserEnterField({
        characterId: id,
        name: byteName(name),
        unknown64: 0,
        face: 20000,
        unknownA: 0,
        unknownB: 0,
        avatarItems: [],
        x: 100,
        y: 100,
        action: 6,
        foothold: 1,
      });
    const sockets = new Set<net.Socket>(),
      events: ClientEvent[] = [],
      received: Uint8Array[] = [];
    let peer: net.Socket | undefined,
      barriers = 0;
    const sendState = new CipherState(0x22222222);
    const send = (...packets: Uint8Array[]) => {
      assert.ok(peer);
      peer.write(
        Buffer.concat(packets.map((packet) => encodeSessionPacket(packet, sendState, "s2c"))),
      );
    };
    const server = net.createServer((socket) => {
      peer = socket;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const receive = new SessionDeframer({ recvState: new CipherState(0x11111111) });
      socket.write(
        encodeLegacyHandshake(new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES), 0x11111111, 0x22222222),
      );
      socket.on("data", (chunk) => {
        for (const packet of receive.push(
          new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
        )) {
          if (packet.kind !== "packet") continue;
          assert.equal(packet.headerOk, true);
          received.push(packet.plain);
          if (packet.opcode === 0x04)
            send(
              field(),
              enter(),
              encodeFameResult({ kind: "changed", name: byteName("상대이름"), up: true }),
              encodeFameResult({ kind: "received", name: byteName("주는사람"), up: false }),
              encodeFameResult({ kind: "ignored" }),
              encodeFameResult({ kind: "beginner" }),
              encodeFameResult({ kind: "alreadyToday" }),
              encodeFameResult({ kind: "alreadyThisMonth" }),
              encodeFameResult({ kind: "unknown", type: 255 }),
              encodeStatUpdate({ diff: { fame: 7 } }),
            );
          else if (packet.opcode === 0x20) send(encodeFameResult({ kind: "beginner" }));
          else if (packet.opcode === CLIENT_FIELD_OPCODE.chat)
            send(encodeSystemNotice(encodeCp949(String(++barriers))));
        }
        assert.equal(receive.failure, undefined);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const session = new ClientSession({ loginPort: 0 });
    t.after(() => session.close());
    session.onEvent((event) => events.push(event));
    const waitFor = (predicate: (event: ClientEvent) => boolean) =>
      new Promise<ClientEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(Error("synthetic peer event timeout"));
        }, 3000);
        const off = session.onEvent((event) => {
          if (predicate(event)) {
            off();
            clearTimeout(timer);
            resolve(event);
          }
        });
      });
    const barrier = async () => {
      const n = barriers + 1,
        done = waitFor((event) => event.kind === "system-notice" && event.text === String(n));
      await session.say(new Uint8Array());
      await done;
    };
    await session.enterGame({ result: 0, ip: "127.0.0.1", port: address.port, characterId: 91 });
    await barrier();
    assert.equal(session.selfView?.name, "자기이름");
    assert.equal(session.selfView?.fame, 7);
    const fame = events.filter((event) => event.kind === "fame");
    assert.equal(fame.length, 7);
    assert.deepEqual(fame[0]?.result, { kind: "changed", name: "상대이름", up: true });
    assert.deepEqual(fame[1]?.result, { kind: "received", name: "주는사람", up: false });
    assert.equal(
      fameMessage(fame[1]!.result, session.selfView!.name),
      "'주는사람'님께서 '자기이름'님의 인기도를 내렸습니다.",
    );
    assert.deepEqual(JSON.parse(JSON.stringify(clientEventJson(fame[0]!, 1))), {
      t: "fame",
      result: { kind: "changed", name: "상대이름", up: true },
    });
    const fieldEvent = events.find((event) => event.kind === "field");
    assert.ok(fieldEvent);
    assert.equal(clientEventJson(fieldEvent, 1).partyInviteIdentity, false);
    assert.equal(clientEventJson(fieldEvent, 1, true).partyInviteIdentity, true);
    assert.equal(
      clientEventJson(fieldEvent, 1).playerMenu,
      true,
      "old running bridges cannot advertise new handlers",
    );
    await session.giveFame("Missing", true);
    assert.deepEqual(events.at(-1), { kind: "fame", result: { kind: "notFound" } });
    const refusal = waitFor((event) => event.kind === "fame" && event.result.kind === "beginner");
    await session.giveFame("상대이름", true);
    await refusal;
    await session.giveFame("상대이름", false);
    assert.deepEqual(events.at(-1), { kind: "fame", result: { kind: "cooldown" } });
    await session.giveFame("Missing", true);
    assert.deepEqual(
      events.at(-1),
      { kind: "fame", result: { kind: "notFound" } },
      "lookup wins over cooldown",
    );
    await barrier();
    assert.deepEqual(
      received
        .filter((p) => p[0] === 0x20)
        .map((p) => readClientFameRequest(new PacketReader(p, 1))),
      [{ targetId: 7, up: true }],
    );
    // 0x14 개인정보 (sub_512700, the player DOUBLE-click): resolve the name in the same map
    // like fame, wire-exact [0x14][u32 charid]; a missing name sends nothing at all, and the
    // original has no s2c consumer - the peer never answers and no session event may appear.
    const eventCountBeforeInfo = events.length;
    await session.playerInfo("Missing");
    await session.playerInfo("상대이름");
    await barrier();
    assert.deepEqual(
      received.filter((p) => p[0] === CLIENT_FIELD_OPCODE.playerInfo).map((p) => [...p]),
      [[0x14, 7, 0, 0, 0]],
      "unknown name must not send, known name sends exactly [0x14][u32 charid]",
    );
    assert.equal(events.length, eventCountBeforeInfo + 1, "only the barrier notice is new");
    const sync = waitFor((event) => event.kind === "party" && event.result.kind === "sync");
    send(
      encodePartyResult({
        kind: "sync",
        partyId: 1,
        members: [
          { characterId: 91, name: byteName("자기이름") },
          { characterId: 7, name: byteName("상대이름") },
        ],
      }),
    );
    let event = await sync;
    assert.ok(event.kind === "party" && event.result.kind === "sync");
    assert.deepEqual(
      event.result.members.map((m) => m.name),
      ["자기이름", "상대이름", "", "", "", ""],
    );
    const invite = waitFor((event) => event.kind === "party" && event.result.kind === "invite");
    send(
      encodePartyResult({ kind: "invite", inviterId: 7, inviterName: byteName("첫초대자") }),
      encodePartyResult({ kind: "invite", inviterId: 8, inviterName: byteName("둘초대자") }),
    );
    event = await invite;
    assert.ok(event.kind === "party" && event.result.kind === "invite");
    assert.equal(event.result.inviterName, "첫초대자");
    await barrier();
    assert.equal(
      events.filter((e) => e.kind === "party" && e.result.kind === "invite").length,
      1,
      "second offer cannot replace active modal",
    );
    await session.replyToPartyInvite(8, true);
    await barrier();
    assert.equal(
      received.filter((p) => p[0] === 0x26).length,
      0,
      "stale/wrong modal id does not clear or accept first invitation",
    );
    await session.replyToPartyInvite(7, true);
    await barrier();
    assert.deepEqual(
      received
        .filter((p) => p[0] === 0x26)
        .map((p) => readClientPartyRequest(new PacketReader(p, 1))),
      [{ kind: "accept", inviterId: 7 }],
    );
    const secondInvite = waitFor((e) => e.kind === "party" && e.result.kind === "invite");
    send(encodePartyResult({ kind: "invite", inviterId: 8, inviterName: byteName("둘초대자") }));
    await secondInvite;
    await session.replyToPartyInvite(8, false);
    await session.replyToPartyInvite(8, true);
    await barrier();
    assert.equal(
      received.filter((p) => p[0] === 0x26).length,
      1,
      "decline emits no native packet and stale accept is ignored",
    );
    // Map replacement closes pending invitations, but does NOT reset the app's five-minute fame clock.
    const pending = waitFor((e) => e.kind === "party" && e.result.kind === "invite");
    send(encodePartyResult({ kind: "invite", inviterId: 7, inviterName: byteName("첫초대자") }));
    await pending;
    const entered = waitFor((e) => e.kind === "user-enter");
    send(field(), enter(7, "OtherUser"));
    await entered;
    await session.replyToPartyInvite(7, true);
    await session.giveFame("otheruser", false);
    assert.deepEqual(
      events.at(-1),
      { kind: "fame", result: { kind: "cooldown" } },
      "native ASCII-case-insensitive name lookup",
    );
    await barrier();
    assert.equal(received.filter((p) => p[0] === 0x20).length, 1);
    assert.equal(received.filter((p) => p[0] === 0x26).length, 1);
    await session.partyCommand("invite", "otheruser");
    await barrier();
    assert.deepEqual(
      readClientPartyRequest(new PacketReader(received.filter((p) => p[0] === 0x26).at(-1)!, 1)),
      { kind: "invite", targetId: 7 },
    );
    const asciiRoster = waitFor((e) => e.kind === "party" && e.result.kind === "sync");
    send(
      encodePartyResult({
        kind: "sync",
        partyId: 1,
        members: [
          { characterId: 91, name: byteName("자기이름") },
          { characterId: 7, name: "OtherUser" },
        ],
      }),
    );
    await asciiRoster;
    await session.partyCommand("kick", "otheruser");
    assert.deepEqual(
      events.at(-1),
      { kind: "party-command", feedback: { kind: "memberNotFound", name: "otheruser" } },
      "55DB00 exact strcmp refusal is local font6, not a generic bridge error",
    );
    await session.partyCommand("kick", "OtherUser");
    await barrier();
    assert.deepEqual(
      readClientPartyRequest(new PacketReader(received.filter((p) => p[0] === 0x26).at(-1)!, 1)),
      { kind: "kick", targetId: 7 },
    );
    const left = waitFor((e) => e.kind === "user-leave");
    send(encodeUserLeaveField(7));
    await left;
    await session.giveFame("OtherUser", true);
    assert.deepEqual(events.at(-1), { kind: "fame", result: { kind: "notFound" } });
    await session.partyCommand("invite", "OtherUser");
    assert.deepEqual(events.at(-1), {
      kind: "party-command",
      feedback: { kind: "targetNotFound" },
    });
    const finalInvite = waitFor((e) => e.kind === "party" && e.result.kind === "invite");
    send(encodePartyResult({ kind: "invite", inviterId: 7, inviterName: byteName("첫초대자") }));
    await finalInvite;
    const dead = waitFor((e) => e.kind === "self" && e.self.hp === 0);
    send(encodeStatUpdate({ diff: { hp: 0 } }));
    await dead;
    await session.replyToPartyInvite(7, true);
    await session.partyCommand("decline");
    await barrier();
    assert.equal(
      received.filter((p) => p[0] === 0x26).length,
      3,
      "death clears invitation without synthesizing accept",
    );
    assert.equal(
      events.some((event) => event.kind === "unknown"),
      false,
    );
    session.close();
    await assert.rejects(session.giveFame("OtherUser", true), /living field session/);
  },
);
