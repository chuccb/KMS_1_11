/** Synthetic encrypted TCP peer only: no login service, account, gameplay, save or player LIVE. */
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { clientEventJson } from "../src/net/client-event-json.ts";
import { ClientSession, type ClientEvent } from "../src/client/session.ts";
import { CipherState } from "../src/protocol/cipher.ts";
import {
  encodeLegacyHandshake,
  LEGACY_HANDSHAKE_BODY_BYTES,
  encodeSessionPacket,
} from "../src/protocol/session.ts";
import { characterDataOf } from "../src/protocol/chardata.ts";
import { encodeSetField } from "../src/protocol/field.ts";
import { encodeSystemNotice } from "../src/protocol/notice.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { PacketWriter } from "../src/protocol/packet.ts";
import { gameFeedback } from "../../client/feedback.ts";

test(
  "55CDE0 encrypted coalesced receive keeps0/1 type and CP949; unknown2..255 ignored, JSON projection reaches chat vs modal without field loss",
  { timeout: 10000 },
  async (t) => {
    const character = characterDataOf({
      id: 91,
      name: "Feedback",
      level: 1,
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
    const sockets = new Set<net.Socket>(),
      events: ClientEvent[] = [];
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const state = new CipherState(0x22222222);
      socket.write(
        encodeLegacyHandshake(new Uint8Array(LEGACY_HANDSHAKE_BODY_BYTES), 0x11111111, 0x22222222),
      );
      socket.once("data", () => {
        const packets = [
          encodeSetField({
            mode: 0,
            full: true,
            randomSeedA: 1,
            randomSeedB: 2,
            randomSeedC: 3,
            character,
          }),
          encodeSystemNotice(encodeCp949("채팅")),
          encodeSystemNotice(encodeCp949("알림"), 1),
        ];
        for (let type = 2; type <= 255; type++) {
          const writer = new PacketWriter(16);
          writer.writeByte(0x13);
          writer.writeByte(type);
          writer.writeStringBytes(encodeCp949("무시"));
          packets.push(writer.toBytes());
        }
        packets.push(encodeSystemNotice(new Uint8Array(), 1));
        socket.write(
          Buffer.concat(packets.map((packet) => encodeSessionPacket(packet, state, "s2c"))),
        );
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
    await session.enterGame({ result: 0, ip: "127.0.0.1", port: address.port, characterId: 91 });
    const notices = events.filter((event) => event.kind === "system-notice");
    assert.deepEqual(notices, [
      { kind: "system-notice", type: 0, text: "채팅" },
      { kind: "system-notice", type: 1, text: "알림" },
      { kind: "system-notice", type: 1, text: "" },
    ]);
    assert.equal(
      events.some((event) => event.kind === "unknown"),
      false,
    );
    const chat: string[] = [],
      dialogs: string[] = [];
    let open = false,
      done: (() => void) | undefined;
    const feedback = gameFeedback({
      now: () => 0,
      blocked: () => false,
      chat: (text) => chat.push(text),
      item: async () => null,
      onError: (error) => {
        throw error;
      },
      dialog: {
        get open() {
          return open;
        },
        notice(options) {
          open = true;
          dialogs.push(options.text);
          done = () => {
            open = false;
            options.accept(1);
          };
          return true;
        },
        close() {
          open = false;
        },
      },
    });
    for (const event of notices) {
      feedback.receive(JSON.parse(JSON.stringify(clientEventJson(event, 123))));
    }
    assert.deepEqual(chat, ["[공지사항] 채팅"]);
    feedback.tick();
    assert.deepEqual(dialogs, ["알림"]);
    assert.ok(done);
    done();
    feedback.tick();
    assert.deepEqual(dialogs, ["알림", ""]);
    feedback.dispose();
  },
);
