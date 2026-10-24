import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { ClientSession, type ClientEvent } from "../src/client/session.ts";
import {
  encodeHandshake,
  DEFAULT_HANDSHAKE_BODY_BYTES,
  encodeSessionPacket,
} from "../src/protocol/session.ts";
import { CipherState } from "../src/protocol/cipher.ts";
import { characterDataOf } from "../src/protocol/chardata.ts";
import { encodeSetField } from "../src/protocol/field.ts";
import { encodeMobEnterField } from "../src/protocol/mob.ts";
import { encodeNpcEnterField } from "../src/protocol/npc.ts";
import { encodeStatUpdate } from "../src/protocol/stat.ts";
import { expToNextLevel } from "../src/game/exp.ts";

test(
  "coalesced initial field/pool/stat packets preserve wire order, mobs and current EXP denominator",
  { timeout: 10000 },
  async (t) => {
    const character = characterDataOf({
      id: 91,
      name: "Order",
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
    const received: ClientEvent[] = [];
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      const sendState = new CipherState(0x22222222);
      socket.write(
        encodeHandshake(new Uint8Array(DEFAULT_HANDSHAKE_BODY_BYTES), 0x11111111, 0x22222222),
      );
      socket.once("data", () => {
        // A single TCP write forces the first take(0x16) and the subsequent frames into one read.
        const packets = [
          encodeSetField({
            mode: 0,
            full: true,
            randomSeedA: 1,
            randomSeedB: 2,
            randomSeedC: 3,
            character,
          }),
          encodeMobEnterField({
            mobId: 77,
            templateId: 120100,
            x: 100,
            y: 200,
            facing: 0,
          }),
          encodeNpcEnterField({
            npcId: 9,
            templateId: 2003,
            x: 50,
            y: 200,
            facing: 0,
          }),
          encodeStatUpdate({ diff: { level: 2, exp: 0, str: 9, ap: 2 } }),
        ];
        socket.write(
          Buffer.concat(packets.map((packet) => encodeSessionPacket(packet, sendState, "s2c"))),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const port = (server.address() as net.AddressInfo).port;
    const session = new ClientSession({ loginPort: 0 });
    t.after(() => session.close());
    session.onEvent((event) => received.push(event));
    await session.enterGame({
      result: 0,
      ip: "127.0.0.1",
      port,
      characterId: 91,
    });
    assert.deepEqual(
      received.map((e) => e.kind),
      // `skills` joined the initial batch with the native skill books round: the browser's skill
      // window needs the learned list at entry, and session.ts emits it right after inventory in
      // the same 0x16 record handler (map32 travels in the CharacterData the inventory came from).
      ["field", "inventory", "skills", "mob-enter", "npc-enter", "self"],
    );
    assert.equal(
      session.mob(77)?.templateId,
      120100,
      "setField must not erase its initial mob snapshot",
    );
    assert.deepEqual(
      [session.character!.stats.str, session.character!.stats.ap, session.character!.stats.level],
      [9, 2, 2],
    );
    const self = received.find((e) => e.kind === "self");
    assert.ok(self?.kind === "self");
    assert.equal(
      self.self.expToNext,
      expToNextLevel(2),
      "level-up percentages must use the new level, not initial login level",
    );
  },
);
