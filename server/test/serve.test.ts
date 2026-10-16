/**
 * The login server, driven over a real TCP socket by a fake client.
 *
 * This is the closest we can get to the oracle run (ADR-004) without the 2003 binary: the test
 * opens a socket, reads the 211-byte handshake, sends the client packets of FINDINGS 4.8 in order
 * and checks every reply field. It also covers the handoff: the id from the 0x03 reply has to
 * come back out of the game server's registry with the right character attached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { CipherState, CLIENT_SEND_MAGIC, SERVER_SEND_MAGIC } from "../src/protocol/cipher.ts";
import { encodeSessionPacket, SessionDeframer, type SessionEvent } from "../src/protocol/session.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { decodeClientPacket, encodeClientPacket, type ClientPacket } from "../src/protocol/login.ts";
import { readCharacterData } from "../src/protocol/chardata.ts";
import { FIELD_OPCODE, readSetField } from "../src/protocol/field.ts";
import { LOGIN_OPCODE, LOGIN_RESULT } from "../src/protocol/replies.ts";
import { GameEntryServer, HandoffRegistry, LoginServer, type AccountRecord } from "../src/net/loginserver.ts";

/** A fake 2003 client: reads the handshake, then speaks the session protocol. */
class FakeClient {
  private readonly socket: net.Socket;
  private readonly sendState: CipherState;
  private readonly deframer: SessionDeframer;
  private readonly serverSendSeed: number;
  private readonly queue: Extract<SessionEvent, { kind: "packet" }>[] = [];
  private waiter: (() => void) | undefined;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.deframer = new SessionDeframer({ expectedMagic: SERVER_SEND_MAGIC });
    this.sendState = new CipherState(0);
    this.serverSendSeed = 0;
    socket.on("data", (chunk) => {
      const before = this.deframer.awaitingHandshake;
      for (const event of this.deframer.push(new Uint8Array(chunk))) {
        if (event.kind === "handshake") {
          // The client adopts the seeds the server chose; its send state is seeded from them.
          (this as { sendState: CipherState }).sendState = new CipherState(event.handshake.sendSeed);
          continue;
        }
        this.queue.push(event);
      }
      if (before !== this.deframer.awaitingHandshake) this.waiter?.();
      this.waiter?.();
    });
  }

  /**
   * Connects and waits for the 211-byte handshake, because the client's send state comes from it:
   * sending before it arrives would use the wrong seed and the server would (rightly) drop the
   * packet on the header check.
   */
  static async connect(port: number): Promise<FakeClient> {
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    const client = new FakeClient(socket);
    await client.handshakeDone();
    return client;
  }

  private handshakeDone(timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise<void>((resolve, reject) => {
      const poll = () => {
        if (!this.deframer.awaitingHandshake) return resolve();
        if (Date.now() > deadline) return reject(new Error("no 211-byte handshake arrived"));
        setTimeout(poll, 10);
      };
      poll();
    });
  }

  /** Waits until the server has sent `count` more packets and returns them. */
  async take(count: number, timeoutMs = 2000): Promise<Uint8Array[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.queue.length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `expected ${count} packet(s), got ${this.queue.length} (queued: ` +
            `${this.queue.map((event) => event.plain[0]?.toString(16)).join(",")})`,
        );
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        setTimeout(resolve, 20);
      });
    }
    const taken = this.queue.splice(0, count).map((event) => event.plain);
    if (process.env.SERVE_TEST_DEBUG) {
      for (const body of taken) process.stderr.write(`[test] s2c ${[...body].map((b) => b.toString(16).padStart(2, "0")).join("")}\n`);
    }
    return taken;
  }

  send(packet: ClientPacket): void {
    this.socket.write(encodeSessionPacket(encodeClientPacket(packet), this.sendState, "c2s"));
  }

  close(): void {
    this.socket.destroy();
  }

  get headersOk(): boolean {
    return this.queue.every((event) => event.headerOk);
  }

  get magic(): number {
    return this.serverSendSeed || CLIENT_SEND_MAGIC;
  }
}

function parseLoginReply(bytes: Uint8Array): {
  result: number;
  account?: { app4: number; app8: number; app9: number };
  worlds?: { name: string; unknownId: number }[];
} {
  const reader = new PacketReader(bytes);
  assert.equal(reader.readByte(), LOGIN_OPCODE.login);
  const result = reader.readByte();
  if (result !== LOGIN_RESULT.ok) return { result };
  const app4 = reader.readU32();
  const app8 = reader.readByte();
  const app9 = reader.readByte();
  const count = reader.readByte();
  const worlds: { name: string; unknownId: number }[] = [];
  for (let i = 0; i < count; i++) worlds.push({ name: reader.readAsciiString(), unknownId: reader.readU32() });
  assert.equal(reader.exhausted, true);
  return { result, account: { app4, app8, app9 }, worlds };
}

test("a client can log in, pick a world and see its characters", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const accounts = new Map<string, AccountRecord>([
    ["admin", { password: "hunter2", characters: [] }],
  ]);
  const handoffs = new HandoffRegistry();
  const server = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: 8585 },
    handoffs,
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    log: (line) => log.push(line),
  });
  const info = await server.listen(0);
  const client = await FakeClient.connect(info.port);
  t.after(async () => {
    client.close();
    await server.close();
  });

  // 1. The client's first packet is always [0x04][id], which is 0 on the login connection.
  client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });

  // 2. A wrong password is refused and does not advance the stage.
  client.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "wrong" });
  const refused = parseLoginReply((await client.take(1))[0]!);
  assert.equal(refused.result, LOGIN_RESULT.wrongCredentials);

  // 3. The right password gets the world list.
  client.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "hunter2" });
  const accepted = parseLoginReply((await client.take(1))[0]!);
  assert.equal(accepted.result, LOGIN_RESULT.ok);
  assert.deepEqual(accepted.worlds, [{ name: "Scania", unknownId: 0 }]);

  // 4. World select: the character slots (none yet).
  client.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
  const worldReply = (await client.take(1))[0]!;
  assert.equal(worldReply[0], LOGIN_OPCODE.worldSelect);
  assert.equal(worldReply[1], LOGIN_RESULT.ok);
  assert.equal(worldReply[2], 0, "no characters yet");

  // 5. Name check -> 0x04 reply; then create -> 0x05 reply carrying the new CharacterData.
  client.send({ kind: "check-name", opcode: 0x06, name: "Hero", appearance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  const nameReply = (await client.take(1))[0]!;
  const nameReader = new PacketReader(nameReply);
  assert.equal(nameReader.readByte(), LOGIN_OPCODE.nameCheckResult);
  assert.equal(nameReader.readAsciiString(), "Hero");
  assert.equal(nameReader.readByte(), 0, "the name is free");

  client.send({ kind: "create-character", opcode: 0x05, name: "Hero" });
  const createReply = (await client.take(1))[0]!;
  const createReader = new PacketReader(createReply);
  assert.equal(createReader.readByte(), LOGIN_OPCODE.createCharacter);
  assert.equal(createReader.readByte(), LOGIN_RESULT.ok);
  const created = readCharacterData(createReader);
  assert.equal(created.stats.name, "Hero");
  assert.equal(created.stats.level, 1);
  assert.ok(created.stats.id > 0);
  assert.equal(createReader.exhausted, true);

  // 6. The same name is now taken.
  client.send({ kind: "check-name", opcode: 0x06, name: "Hero", appearance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  const takenReply = (await client.take(1))[0]!;
  const takenReader = new PacketReader(takenReply);
  takenReader.readByte();
  takenReader.readAsciiString();
  assert.equal(takenReader.readByte(), 1, "the name is taken");

  // 7. Select the character: the reply must carry the game server address and the character id.
  client.send({ kind: "select-character", opcode: 0x03, characterId: created.stats.id });
  const selectReply = (await client.take(1))[0]!;
  const selectReader = new PacketReader(selectReply);
  assert.equal(selectReader.readByte(), LOGIN_OPCODE.selectCharacter);
  assert.equal(selectReader.readByte(), LOGIN_RESULT.ok);
  assert.equal(selectReader.readU32(), 0x0100007f, "127.0.0.1 in network order");
  assert.equal(selectReader.readU16(), 8585);
  const handedId = selectReader.readU32();
  assert.equal(handedId, created.stats.id, "the 0x03 reply carries the client's own character id");
  assert.equal(selectReader.exhausted, true);

  // 8. That id resolves to exactly this character, once.
  assert.deepEqual(
    handoffs.claim(handedId),
    // the entry carries the record the client just got, so the game server can hand it back in 0x16
    { username: "admin", characterId: created.stats.id, characterName: "Hero", character: created },
    `id=0x${handedId.toString(16)} pending=${handoffs.pending}\n${log.join("\n")}`,
  );
  assert.equal(handoffs.claim(handedId), undefined, "a handoff is single use");

  // 9. Delete the character: the answer is 0x06 with the id echoed and a non-zero flag.
  client.send({ kind: "delete-character", opcode: 0x07, characterId: created.stats.id });
  const deleteReply = (await client.take(1))[0]!;
  const deleteReader = new PacketReader(deleteReply);
  assert.equal(deleteReader.readByte(), LOGIN_OPCODE.deleteResult);
  assert.equal(deleteReader.readU32(), created.stats.id);
  assert.equal(deleteReader.readByte(), 1, "flag: deleted (0 would make the client terminate)");
  assert.equal(deleteReader.exhausted, true);
  assert.equal(accounts.get("admin")?.characters.length, 0);

  assert.ok(log.some((line) => line.includes("handshake sent")));
});

test("the game server claims the character id the login server issued", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const accounts = new Map<string, AccountRecord>([["admin", { password: "admin", characters: [] }]]);
  const game = new GameEntryServer({
    handoffs,
    handshake: { clientSendSeed: 0x33333333, clientRecvSeed: 0x44444444 },
    log: (l) => log.push(l),
  });
  const gameInfo = await game.listen(0);
  const login = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: gameInfo.port },
    handoffs,
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    log: (line) => log.push(line),
  });
  const loginInfo = await login.listen(0);
  t.after(async () => {
    await login.close();
    await game.close();
  });

  const client = await FakeClient.connect(loginInfo.port);
  client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  client.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  await client.take(1);
  client.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
  await client.take(1);
  client.send({ kind: "check-name", opcode: 0x06, name: "Hero", appearance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  await client.take(1);
  client.send({ kind: "create-character", opcode: 0x05, name: "Hero" });
  const createReply = (await client.take(1))[0]!;
  const createReader = new PacketReader(createReply);
  createReader.readByte();
  createReader.readByte();
  const character = readCharacterData(createReader);
  client.send({ kind: "select-character", opcode: 0x03, characterId: character.stats.id });
  const selectReply = (await client.take(1))[0]!;
  const selectReader2 = new PacketReader(selectReply);
  selectReader2.readByte();
  selectReader2.readByte();
  selectReader2.readU32();
  selectReader2.readU16();
  const issuedId = selectReader2.readU32();
  assert.equal(issuedId, character.stats.id, "the handoff value is the character's own id");
  client.close();

  // The second connection: the client is the one that speaks now, with its character id.
  const gameClient = await FakeClient.connect(gameInfo.port);
  gameClient.send({ kind: "handshake-reply", opcode: 0x04, value: issuedId });
  const deadline = Date.now() + 2000;
  while (!log.some((line) => line.includes("claimed")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    log.some((line) => line.includes(`character 0x${(issuedId >>> 0).toString(16).padStart(8, "0")} claimed -> "Hero"`)),
    log.join("\n"),
  );

  // ... and the claim is followed by 0x16, the packet that actually puts the client into a map.
  const fieldEntry = (await gameClient.take(1))[0]!;
  assert.equal(fieldEntry[0], FIELD_OPCODE.setField, "the game server's first in-game packet is 0x16");
  const field = readSetField(new PacketReader(fieldEntry, 1));
  assert.equal(field.full, true, "the full form carries the map id inside the CharacterData");
  assert.equal(field.character.stats.mapId, 1000000, "DEFAULT_MAP_ID is a map that exists in Data.wz");
  assert.equal(field.character.stats.id, issuedId, "the same character the handoff named");
  assert.equal(field.character.stats.name, "Hero");
  assert.notEqual(field.randomSeedA | field.randomSeedB | field.randomSeedC, 0, "the field seeds are chosen, not zero");
  gameClient.close();

  // A second client can ask for a different map, and no state leaks between connections.
  const other = await FakeClient.connect(gameInfo.port);
  const otherId = handoffs.issue({ username: "admin", characterId: 4242, characterName: "Alt" });
  other.send({ kind: "handshake-reply", opcode: 0x04, value: otherId });
  const otherField = readSetField(new PacketReader((await other.take(1))[0]!, 1));
  assert.equal(otherField.character.stats.mapId, 1000000);
  assert.equal(otherField.character.stats.id, 4242);
  other.close();
});
