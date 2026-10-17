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
import { encodeClientPacket, type ClientPacket } from "../src/protocol/login.ts";
import {
  DEFAULT_FACE_ID,
  DEFAULT_HAIR_ID,
  characterDataOf,
  readCharacterData,
  startingCharacterItems,
  withWorn,
  wornOfLook,
  zeroStats,
  type CharacterData,
} from "../src/protocol/chardata.ts";
import { OnlineAccounts } from "../src/net/online.ts";
import {
  CLIENT_FIELD_OPCODE,
  FIELD_OPCODE,
  INTERACT_KIND_CURSOR,
  INTERACT_KIND_REVIVE,
  USER_EFFECT_LEVEL_UP,
  encodeClientAttack,
  encodeClientChangeSlot,
  encodeClientChat,
  encodeClientStatReport,
  encodeClientUseItem,
  encodeClientEmotion,
  readUserEmotion,
  encodeClientInteract,
  encodeClientUserMove,
  encodeClientUserRequest,
  USER_REQUEST_KIND,
  readSetField,
  readUserChat,
  readUserLook,
  readUserFindAnswer,
  readUserWhisperAnswer,
  readUserEffect,
  readUserAttack,
  readUserEnterField,
  readUserMove,
} from "../src/protocol/field.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { toHex } from "../src/protocol/frame.ts";
import {
  DROP_KIND,
  DROP_OPCODE,
  DROP_REMOVE_KIND,
  LOOT_OPCODE,
  readDropAppear,
  readDropRemove,
  readLootNotice,
} from "../src/protocol/drop.ts";
import { INVENTORY_OP, INVENTORY_OPCODE, INVENTORY_TAB, readInventoryChange } from "../src/protocol/inventory.ts";
import {
  MOB_OPCODE,
  readMobEnterField,
  readMobLeaveDelayed,
  readMobMove,
  readMobPresence,
  readMobStat,
} from "../src/protocol/mob.ts";
import { NPC_OPCODE, readNpcEnterField, readNpcState } from "../src/protocol/npc.ts";
import { npcWalkPolicy } from "../src/game/npcs.ts";
import { STAT_OPCODE, readStatUpdate } from "../src/protocol/stat.ts";
import {
  CLIENT_OBJECT_CLICK_OPCODE,
  CLIENT_SHOP_OPCODE,
  SHOP_OPEN_OPCODE,
  SHOP_RESULT,
  SHOP_RESULT_OPCODE,
  encodeClientObjectClick,
  encodeClientShopRequest,
  readShopOpen,
} from "../src/protocol/shop.ts";
import { shopKeeper } from "../src/game/shops.ts";
import { consumeSpecProvider } from "../src/game/items.ts";
import { equipSlot, nonEquipSlot } from "../src/protocol/itemslot.ts";
import {
  QUEST_REPLY_OPCODE,
  QUEST_TALK_OPCODE,
  encodeQuestReply,
  readQuestTalk,
} from "../src/protocol/quest.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MapData } from "../src/game/map.ts";
import { CREATE_CHARACTER_RESULT, LOGIN_OPCODE, LOGIN_RESULT } from "../src/protocol/replies.ts";
import { GameEntryServer, HandoffRegistry, LoginServer, type AccountRecord } from "../src/net/loginserver.ts";
import { MemorySaveStore, loadAccounts } from "../src/game/save.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;

/** A fake 2003 client: reads the handshake, then speaks the session protocol. */
class FakeClient {
  private readonly socket: net.Socket;
  private sendState: CipherState;
  private readonly deframer: SessionDeframer;
  private readonly serverSendSeed: number;
  private readonly queue: Extract<SessionEvent, { kind: "packet" }>[] = [];
  private waiter: (() => void) | undefined;
  private collector: number[] | undefined;

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
          this.sendState = new CipherState(event.handshake.sendSeed);
          continue;
        }
        this.queue.push(event);
        this.collector?.push(event.plain[0] ?? -1);
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

  /**
   * Waits for the first packet with this opcode and returns every packet up to it (inclusive).
   *
   * Counting packets does not work once a field is shared: the mobs walk, the other players move, and
   * the packets under test therefore arrive in a stream that has other things in it. Reading by opcode
   * is what that stream asks for.
   */
  async takeOpcode(opcode: number, timeoutMs = 4000): Promise<Uint8Array[]> {
    const seen: Uint8Array[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
          setTimeout(resolve, 20);
        });
        continue;
      }
      const packet = this.queue.shift()!.plain;
      seen.push(packet);
      if (packet[0] === opcode) return seen;
    }
    throw new Error(
      `no 0x${opcode.toString(16)} arrived; saw [${seen.map((bytes) => bytes[0]!.toString(16)).join(",")}]`,
    );
  }

  /**
   * Everything that arrives within `ms` - the honest way to say "and nothing more".
   *
   * `take(0)` cannot say it: asking for zero packets is answered by an empty list before anything has
   * had a chance to arrive. And a quiet check cannot just demand an empty stream either, because a
   * shared field never goes quiet (the walking mobs keep `0x33` coming) - so the assertion is about
   * *which* packets arrived, and the caller filters.
   */
  async drain(ms = 120): Promise<Uint8Array[]> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return this.queue.splice(0, this.queue.length).map((event) => event.plain);
  }

  /** The opcodes of everything that arrives within `ms`. */
  async drainOpcodes(ms = 120): Promise<number[]> {
    return (await this.drain(ms)).map((bytes) => bytes[0]!);
  }

  send(packet: ClientPacket): void {
    this.socket.write(encodeSessionPacket(encodeClientPacket(packet), this.sendState, "c2s"));
  }

  /**
   * Stops discarding what arrives: every opcode from now on also lands in `into`.
   *
   * The queue is a snapshot of the moment a test looks at it, and a packet the server sends *after*
   * that look is exactly what some tests are about (a heartbeat asking a quiet session); `waiting`
   * is the other way round (it waits for the queue to grow).
   */
  collectOpcodes(into: number[]): void {
    this.collector = into;
  }

  /** Calls `cb` once the server's end of the connection is gone (a FIN or a reset). */
  socketClose(cb: () => void): void {
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      cb();
    };
    this.socket.once("end", once);
    this.socket.once("close", once);
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

  /** How many packets are waiting - used to assert that nothing (more) arrived. */
  get queueLength(): number {
    return this.queue.length;
  }
}

/** Waits until `check()` is true (false on timeout) - the seams where the kernel decides the order. */
async function eventually(check: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
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

  // 2. A wrong password is refused and does not advance the stage - with the code whose message is
  // "잘못된 패스워드입니다." (4, sub_4D0DB0), not the "id was erased or its connection stopped" one.
  client.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "wrong" });
  const refused = parseLoginReply((await client.take(1))[0]!);
  assert.equal(refused.result, LOGIN_RESULT.wrongPassword);
  assert.equal(refused.result, 4);

  // 2b. An id that is not in the table gets its own message: "등록되지 않은 아이디입니다." (5).
  client.send({ kind: "login-request", opcode: 0x01, username: "nobody", password: "wrong" });
  const noSuchAccount = parseLoginReply((await client.take(1))[0]!);
  assert.equal(noSuchAccount.result, LOGIN_RESULT.notRegistered);
  assert.equal(noSuchAccount.result, 5);

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
  // `0x06`'s ten words are the dialog's six picks - face, hair, top, bottom, shoes, weapon - and its
  // four dice rolls (FINDINGS 4.8.1a). The six picks all reach the record: face and hair as the
  // record's own fields, the four clothes as worn equips (the only place the client reads an avatar's
  // clothes from). The dice are still unplaceable, so they are logged and dropped.
  client.send({
    kind: "check-name",
    opcode: 0x06,
    name: "Hero",
    appearance: [20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 7],
  });
  const nameReply = (await client.take(1))[0]!;
  const nameReader = new PacketReader(nameReply);
  assert.equal(nameReader.readByte(), LOGIN_OPCODE.nameCheckResult);
  assert.equal(nameReader.readAsciiString(), "Hero");
  assert.equal(nameReader.readByte(), 0, "the name is free");

  client.send({ kind: "create-character", opcode: 0x05, name: "Hero" });
  const createReply = (await client.take(1))[0]!;
  const createReader = new PacketReader(createReply);
  assert.equal(createReader.readByte(), LOGIN_OPCODE.createCharacter);
  assert.equal(createReader.readByte(), CREATE_CHARACTER_RESULT.created);
  const created = readCharacterData(createReader);
  assert.equal(created.stats.name, "Hero");
  assert.deepEqual(
    [created.stats.appearanceA, created.stats.appearanceB],
    [20000, 30000],
    "the new character carries the face and hair the dialog picked (0x06 words 1 and 2)",
  );
  assert.deepEqual(
    [...(created.items?.worn ?? [])].map(([slot, item]) => [slot, item.itemId]),
    [
      [5, 1040001],
      [6, 1060001],
      [7, 1071000],
      [11, 1302000],
    ],
    "and wears words 3..6 as worn equips, in the slot each item's part code names (sub_45F340)",
  );
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

/**
 * One account, one live session (ADR-018).
 *
 * The 2003 client has a message for this - result `7`, "현재 접속중인 아이디이거나, 현재
 * 서버점검중입니다." - and the seat is held by *either* half of the server: the login connection from
 * `0x01` on, and the field session from the moment the character enters a map. This test walks the
 * whole thing: a second login is refused while the first player is in the field, another account is
 * unaffected, and the seat comes back when the session really ends.
 */
test("a second login for an account that is already online is refused with 7", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const online = new OnlineAccounts();
  const accounts = new Map<string, AccountRecord>([
    ["admin", { password: "admin", characters: [] }],
    ["guest", { password: "guest", characters: [] }],
  ]);
  const stats = zeroStats();
  stats.id = 21;
  stats.name = "Hero";
  stats.level = 1;
  stats.hp = 50;
  stats.maxHp = 50;
  stats.mapId = 1000000;
  accounts.get("admin")!.characters.push(characterDataOf(stats, startingCharacterItems()));

  const game = new GameEntryServer({
    handoffs,
    online,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  const login = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: gameInfo.port },
    handoffs,
    online,
    handshake: { clientSendSeed: 0x33333333, clientRecvSeed: 0x44444444 },
    log: (line) => log.push(line),
  });
  const loginInfo = await login.listen(0);
  t.after(async () => {
    await login.close();
    await game.close();
  });

  /** Logs in and returns the result byte, leaving the connection open. */
  const openLogin = async (username: string, password: string): Promise<{ client: FakeClient; result: number }> => {
    const client = await FakeClient.connect(loginInfo.port);
    client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
    client.send({ kind: "login-request", opcode: 0x01, username, password });
    return { client, result: parseLoginReply((await client.take(1))[0]!).result };
  };

  // 1. The player logs in and enters the map.
  const hero = await openLogin("admin", "admin");
  assert.equal(hero.result, LOGIN_RESULT.ok);
  hero.client.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
  await hero.client.take(1);
  hero.client.send({ kind: "select-character", opcode: 0x03, characterId: 21 });
  const selectReader = new PacketReader((await hero.client.take(1))[0]!);
  selectReader.readByte();
  selectReader.readByte();
  selectReader.readU32();
  selectReader.readU16();
  const issuedId = selectReader.readU32();
  const inGame = await FakeClient.connect(gameInfo.port);
  inGame.send({ kind: "handshake-reply", opcode: 0x04, value: issuedId });
  assert.equal((await inGame.take(1))[0]![0], FIELD_OPCODE.setField, "0x16: the character is in the map");

  // 2. The login connection goes away - which is what the real client does once the 0x03 reply has
  // sent it to the game server. The seat must stay taken: the character is still standing in a map.
  hero.client.close();
  const loginSocketGone = Date.now() + 2000;
  while (online.sessionsOf("admin").some((session) => session.where === "login") && Date.now() < loginSocketGone) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(
    online.sessionsOf("admin").map((session) => session.where),
    ["game"],
    "the field session is now the one holding the account",
  );

  // 3. A second login for the same account is refused - and the client has a message for exactly
  // this result byte (FINDINGS 4.8).
  const second = await openLogin("admin", "admin");
  assert.equal(second.result, LOGIN_RESULT.alreadyConnected);
  assert.equal(second.result, 7);
  second.client.close();
  assert.ok(
    log.some((line) => line.includes('"admin" is already online (game 127.0.0.1:')),
    log.join("\n"),
  );

  // 4. Another account is not affected: the seat is per account.
  const other = await openLogin("guest", "guest");
  assert.equal(other.result, LOGIN_RESULT.ok);
  other.client.close();

  // 5. The player leaves the game. The next login gets in again.
  inGame.close();
  const deadline = Date.now() + 2000;
  let retry = await openLogin("admin", "admin");
  while (retry.result !== LOGIN_RESULT.ok && Date.now() < deadline) {
    retry.client.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    retry = await openLogin("admin", "admin");
  }
  assert.equal(retry.result, LOGIN_RESULT.ok, `the seat came back after the session ended; log:\n${log.join("\n")}`);
  retry.client.close();
});

/**
 * The same character, twice.
 *
 * The account seat makes this impossible through the normal flow, so this test drives it the way it
 * would actually happen: two handoffs for one character id (a second `0x03`, a replaying client, a
 * login server restarted between the two). `FieldInstance.join` would "take the new one" - and leave
 * the older *connection* alive, unseen by everybody but still walking, chatting and hitting monsters,
 * with both connections writing the same `CharacterData` (ADR-017). So the game server refuses the
 * second connection instead, and the first one keeps playing.
 */
test("a character that is already in a field is not entered twice", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const online = new OnlineAccounts();
  const game = new GameEntryServer({
    handoffs,
    online,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    handshake: { clientSendSeed: 0x55555555, clientRecvSeed: 0x66666666 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const stats = zeroStats();
  stats.id = 21;
  stats.name = "Hero";
  stats.level = 1;
  stats.hp = 50;
  stats.maxHp = 50;
  stats.mapId = 1000000;
  const entry = { username: "admin", characterId: 21, characterName: "Hero", character: characterDataOf(stats) };

  const first = await FakeClient.connect(gameInfo.port);
  t.after(() => first.close());
  first.send({ kind: "handshake-reply", opcode: 0x04, value: handoffs.issue(entry) });
  assert.equal((await first.take(1))[0]![0], FIELD_OPCODE.setField, "the first connection gets its 0x16");

  const second = await FakeClient.connect(gameInfo.port);
  t.after(() => second.close());
  second.send({ kind: "handshake-reply", opcode: 0x04, value: handoffs.issue(entry) });
  const gone = new Promise<void>((resolve) => second.socketClose(() => resolve()));
  await gone;
  assert.equal(second.queueLength, 0, "no 0x16, no snapshot: nothing is sent to a refused connection");
  assert.ok(
    log.some((line) => line.includes('character 0x00000015 ("Hero") is already in map 1000000 - refusing the second connection')),
    log.join("\n"),
  );

  // The player who was already there is untouched: chat still works, which means the field and the
  // session are both intact (drain the entry snapshot first, or `take` would hand back a mob).
  await first.drain();
  first.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.chat, body: encodeClientChat({ text: encodeCp949("still here") }).slice(1) });
  const chat = (await first.take(1))[0]!;
  assert.equal(chat[0], FIELD_OPCODE.userMessage, `the first session still gets its chat back; log:\n${log.join("\n")}`);
});

/**
 * The heartbeat is what makes "already online" self-healing.
 *
 * A client that vanishes without closing its socket (a pulled cable, a crashed machine) would
 * otherwise hold its account for as long as the OS keeps the half-open connection - and the next
 * login would be told "you are already connected" about a player who is gone. `0x08` is the packet
 * the 2003 client always echoes (FINDINGS 4.2), so a session that does not answer three times is
 * dropped, and its seat goes with it.
 */
test("a session that stops answering the 0x08 heartbeat loses its seat", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const accounts = new Map<string, AccountRecord>([["admin", { password: "admin", characters: [] }]]);
  const login = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: 1 },
    pingMs: 40,
    handshake: { clientSendSeed: 0x77777777, clientRecvSeed: 0x88888888 },
    log: (line) => log.push(line),
  });
  const info = await login.listen(0);
  t.after(async () => {
    await login.close();
  });

  // This fake client never answers a ping - it is the "cable pulled out" case.
  const silent = await FakeClient.connect(info.port);
  silent.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  silent.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  assert.equal(parseLoginReply((await silent.take(1))[0]!).result, LOGIN_RESULT.ok);
  assert.equal(login.online.isOnline("admin"), true);

  const dropped = new Promise<void>((resolve) => silent.socketClose(() => resolve()));
  const pings: number[] = [];
  silent.collectOpcodes(pings);
  await dropped;
  assert.ok(pings.includes(0x08), `the server asked before giving up (saw ${pings.join(",")})`);
  assert.ok(
    await eventually(() => !login.online.isOnline("admin")),
    "the seat went with the connection (its close handler runs on our side of the FIN)",
  );
  assert.match(log.join("\n"), /heartbeat: login 127\.0\.0\.1:\d+ sent nothing for \d+ ms/);

  // And the account can log in again, without waiting for anything.
  const again = await FakeClient.connect(info.port);
  again.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  again.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  assert.equal(parseLoginReply((await again.take(1))[0]!).result, LOGIN_RESULT.ok);
  again.close();
});

/**
 * A third timeout-free proof of the seat: the login server that is closed releases its seats itself.
 *
 * `close()` is called by the CLI on SIGINT and by every test's cleanup, and the seats are shared
 * between the two halves - so "the sockets will close in a moment" is not good enough: a caller that
 * opens the next server right away would see "already online" about a server that is gone.
 */
test("closing a server gives its seats back before it returns", { timeout: 20000 }, async (t) => {
  const online = new OnlineAccounts();
  const accounts = new Map<string, AccountRecord>([["admin", { password: "admin", characters: [] }]]);
  const first = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: 1 },
    online,
    handshake: { clientSendSeed: 0x99999999, clientRecvSeed: 0xaaaaaaaa },
  });
  const firstInfo = await first.listen(0);
  const client = await FakeClient.connect(firstInfo.port);
  client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  client.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  assert.equal(parseLoginReply((await client.take(1))[0]!).result, LOGIN_RESULT.ok);
  assert.equal(online.isOnline("admin"), true);

  await first.close();
  assert.equal(online.isOnline("admin"), false, "no waiting for the close events");

  const second = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: 1 },
    online,
    handshake: { clientSendSeed: 0xbbbbbbbb, clientRecvSeed: 0xcccccccc },
  });
  const secondInfo = await second.listen(0);
  t.after(async () => {
    client.close();
    await second.close();
  });
  const back = await FakeClient.connect(secondInfo.port);
  back.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  back.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  assert.equal(parseLoginReply((await back.take(1))[0]!).result, LOGIN_RESULT.ok);
  back.close();
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

/**
 * The map the stub provider answers for. Two mobs is enough to prove ordering and that the id
 * sequence is the server's own; the real `Data.wz` numbers are pinned in `map.test.ts`.
 */
const STUB_MAP: MapData = {
  id: 1000000,
  imagePath: "Map/Map/001000000.img",
  name: "암허스트서쪽필드",
  streetName: "레인보우스트리트",
  bgm: "Bgm00/RestNPeace",
  returnMapId: 1010000,
  mobs: [
    { templateId: 120100, x: 509, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 1000, cy: 300 },
    { templateId: 1210100, x: -5, y: 7, foothold: 0, facing: 1, rx0: -5, rx1: -5, cy: 7 },
  ],
  npcs: [{ templateId: 2003, x: 69, y: 275, foothold: 28, facing: 0, rx0: 0, rx1: 0, cy: 275 }],
  portals: [
    { name: "sp", type: 0, x: 100, y: 200, toMapId: 0, toName: "" },
    // The one portal out of this map: `tm` is where it leads, `tn` the name of the portal it lands
    // on in the destination (FINDINGS 4.11.6).
    { name: "west00", type: 2, x: 130, y: 300, toMapId: 2000000, toName: "east00" },
  ],
  footholds: 2,
  ladderRopes: 0,
  // One straight foothold under both spawns, so the test can watch the mobs walk on it.
  footholdSegments: new Map([
    [
      32,
      { id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, prev: 0, next: 0 },
    ],
  ]),
};

/**
 * The map `STUB_MAP`'s `west00` portal leads to: a second field with a world of its own, so a test can
 * watch a player leave one map and arrive in another. Its only portal is called `east00` and *not*
 * `sp`, which is what makes the spawn point visible in a packet: a first entry lands on the map's
 * first portal (`FieldInstance.spawnAt`).
 */
const STUB_MAP_ALT: MapData = {
  id: 2000000,
  imagePath: "Map/Map/002000000.img",
  name: "stub-alt",
  streetName: "stub",
  bgm: "",
  returnMapId: 0,
  mobs: [{ templateId: 120100, x: 700, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 1000, cy: 300 }],
  npcs: [{ templateId: 2003, x: 650, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 0, cy: 300 }],
  portals: [{ name: "east00", type: 2, x: 600, y: 300, toMapId: 1000000, toName: "west00" }],
  footholds: 1,
  ladderRopes: 0,
  footholdSegments: new Map([[32, { id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, prev: 0, next: 0 }]]),
};

/**
 * The town `STUB_MAP`'s `returnMap` names: the revive has a map to move a player to, and it is a map
 * with nothing in it (a town in the shipped data is NPCs only, and this one does not even need those).
 *
 * Its own `returnMap` names a map the test does **not** register, which is the branch a town takes in
 * the real data through `RETURN_MAP_NONE` (`test/map.test.ts`): whatever the reason, the answer is the
 * same - re-enter the map the player is already in, because that field exists by definition.
 */
const STUB_MAP_TOWN: MapData = {
  id: 1010000,
  imagePath: "Map/Map/001010000.img",
  name: "stub-town",
  streetName: "stub",
  bgm: "",
  returnMapId: 1010001,
  mobs: [],
  npcs: [],
  portals: [],
  footholds: 0,
  ladderRopes: 0,
};

test("the game server spawns the map's monsters and NPCs right after 0x16", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 20, maxMP: 0, exp: 1, speedPercent: 100, dieMs: 0 }),
    mobTickMs: 20,
    handshake: { clientSendSeed: 0x55555555, clientRecvSeed: 0x66666666 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  // 0x16, then the map's two mobs, then its one NPC - all four in the same TCP stream.
  const packets = await client.take(4);
  client.close();

  assert.equal(packets[0]![0], FIELD_OPCODE.setField, "0x16 comes first: the field has to exist");
  assert.equal(packets[1]![0], MOB_OPCODE.enterField, "then one 0x2F per mob, in WZ order");
  assert.equal(packets[2]![0], MOB_OPCODE.enterField);
  assert.equal(packets[3]![0], NPC_OPCODE.enterField, "then one 0x39 per NPC (FINDINGS 4.19)");
  assert.equal(client.headersOk, true, "every spawned packet survives the cipher/header check");

  const npc = readNpcEnterField(new PacketReader(packets[3]!, 1), false);
  assert.deepEqual(
    { npcId: npc.npcId, templateId: npc.templateId, x: npc.x, y: npc.y, facing: npc.facing },
    { npcId: 1, templateId: 2003, x: 69, y: 275, facing: 0 },
    "the map's life entry, with an id from the NPC pool's own sequence",
  );

  const first = readMobEnterField(new PacketReader(packets[1]!, 1));
  assert.deepEqual(
    { mobId: first.mobId, templateId: first.templateId, x: first.x, y: first.y, facing: first.facing },
    { mobId: 1, templateId: 120100, x: 509, y: 300, facing: 0 },
    "the first life entry of the map, with a server-chosen pool id",
  );
  const second = readMobEnterField(new PacketReader(packets[2]!, 1));
  assert.deepEqual(
    { mobId: second.mobId, templateId: second.templateId, x: second.x, y: second.y, facing: second.facing },
    { mobId: 2, templateId: 1210100, x: -5, y: 7, facing: 1 },
    "negative coordinates and the left-facing bit survive the wire",
  );
  assert.equal(second.channels, undefined, "no animation channel is claimed by the server yet");
  assert.equal(new PacketReader(packets[2]!, 1).remaining, 21, "a channel-less 0x2F is 22 bytes");
  assert.ok(log.some((line) => line.includes("spawned 2 mobs")), log.join("\n"));

  // ... and then they walk: the mob on foothold 32 gets one 0x33 per leg (mobTickMs = 20 here).
  // `take` returns whole packets, one at a time: the second mob is on foothold 0 (the stub map has
  // no segment for it), so the only thing that can arrive here is a 0x33 for the first mob.
  const moves: Uint8Array[] = [];
  for (let i = 0; i < 5 && moves.length === 0; i++) {
    const packet = (await client.take(1))[0]!;
    if (packet[0] === MOB_OPCODE.move) moves.push(packet);
  }
  assert.equal(moves.length >= 1, true, "the field sends 0x33 for a mob that can walk");
  const move = readMobMove(new PacketReader(moves[0]!, 1));
  assert.equal(move.mobId, 1, "the first mob is the one on the foothold");
  const element = move.body.path.elements[0]!;
  assert.equal(element.y, 300, "walking along the foothold's y");
  assert.ok(element.x > 509 && element.x <= 1000, `the leg ends inside the range, at ${element.x}`);
  assert.equal(move.body.path.originX, 509, "and starts where the mob spawned");
  assert.equal(element.vx, 0);
  assert.equal(element.vy, 0);
  assert.equal(client.headersOk, true, "the movement packets survive the cipher too");
});

test("--npc-walk puts one 0x3B after the NPC's 0x39, and the server keeps no timer", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    npcWalk: npcWalkPolicy("2003"),
    handshake: { clientSendSeed: 0x77777777, clientRecvSeed: 0x88888888 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  const packets = await client.take(5);
  client.close();

  // 0x16, the two mobs, the NPC's 0x39, and then the walk state - the flag belongs to a pool entry,
  // so it cannot come before the packet that makes one.
  assert.deepEqual(packets.map((packet) => packet[0]), [
    FIELD_OPCODE.setField,
    MOB_OPCODE.enterField,
    MOB_OPCODE.enterField,
    NPC_OPCODE.enterField,
    NPC_OPCODE.stateToggle,
  ]);
  assert.deepEqual(
    readNpcState(new PacketReader(packets[4]!, 1)),
    { npcId: 1, on: true },
    "the pool id the 0x39 handed out, not the template id the policy named",
  );
  assert.ok(log.some((line) => line.includes("1 NPCs (1 walking)")), log.join("\n"));
  assert.equal(client.headersOk, true);
});

test("a map the provider does not know still enters, it just has nothing to spawn", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: () => undefined,
    handshake: { clientSendSeed: 0x77777777, clientRecvSeed: 0x88888888 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 8, characterName: "Solo" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  const first = (await client.take(1))[0]!;
  assert.equal(first[0], FIELD_OPCODE.setField, "0x16 is sent even without map data");
  assert.deepEqual(
    await client.drainOpcodes(80),
    [],
    "and no 0x2F follows, rather than a mob at (0,0)",
  );
  assert.ok(log.some((line) => line.includes("has no Map/Map/*.img")), log.join("\n"));
  client.close();
});

/**
 * The whole mob loop over a real socket: a swing kills a monster, and the death comes back as the
 * three packets of FINDINGS 4.17 - `0x34` (the mob's stat/flash), `0x30` (the die animation starts
 * now) and, once that animation is over, `0x31 flag=0` (the corpse goes). A stub template is used so
 * the die animation is 40 ms instead of the real 720: the timing logic is the same code.
 */
test("a swing that kills a mob answers 0x34, 0x30, and then 0x31 when the corpse is over", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    mobTickMs: 20,
    mobRespawnMs: 5000,
    // One guaranteed drop per kill, so the packet after the death is always the same one.
    dropPolicy: () => [{ money: 25 }],
    handshake: { clientSendSeed: 0x99999999, clientRecvSeed: 0xaaaaaaaa },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 11, characterName: "Fighter" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  const spawn = await client.take(4);
  client.close(); // the spawn burst (0x16, two mobs, the NPC) is all this test needs

  const killer = await FakeClient.connect(gameInfo.port);
  t.after(() => killer.close());
  const otherId = handoffs.issue({ username: "admin", characterId: 12, characterName: "Fighter2" });
  killer.send({ kind: "handshake-reply", opcode: 0x04, value: otherId });
  await killer.take(4);
  assert.equal(spawn[1]![0], MOB_OPCODE.enterField);
  assert.equal(spawn[3]![0], NPC_OPCODE.enterField, "the NPC spawn rides along with the mob burst");

  // One swing, one target, 10 damage - exactly the mob's HP, so it dies.
  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  killer.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  const hit = await killer.take(2);
  assert.equal(hit[0]![0], MOB_OPCODE.stat, "0x34 first: the mob's stat, which is its flash state");
  assert.deepEqual(readMobStat(new PacketReader(hit[0]!, 1)), { mobId: 1, mp: 0 });
  assert.equal(hit[1]![0], MOB_OPCODE.leaveDelayed, "then 0x30: the die animation starts now");
  assert.deepEqual(readMobLeaveDelayed(new PacketReader(hit[1]!, 1)), { mobId: 1, delayMs: 0 });
  assert.equal(killer.headersOk, true, "both survive the cipher/header check");

  // The kill pays the monster's own `info.exp` (stub: 1) as a 0x0D stat diff - exp only, because the
  // bar did not fill up (FINDINGS 4.21). The level-up form is its own test below.
  const stat = (await killer.take(1))[0]!;
  assert.equal(stat[0], STAT_OPCODE);
  assert.deepEqual(readStatUpdate(new PacketReader(stat, 1)), { ack: false, diff: { exp: 1 } });

  // The kill also leaves loot: one 0x43 per drop, and the monster's id is in it, which is what makes
  // the client fly the item out of the corpse (FINDINGS 4.18).
  const drop = await killer.take(1);
  assert.equal(drop[0]![0], DROP_OPCODE.appear);
  const loot = readDropAppear(new PacketReader(drop[0]!, 1));
  assert.equal(loot.money, true);
  assert.equal(loot.value, 25);
  assert.equal(loot.mobId, 1, "the drop knows the monster it came out of");
  assert.equal(loot.kind, 0);

  // ... and 40 ms of die animation later the corpse goes. The walking timer is what sends it.
  const corpse = await killer.take(1);
  assert.equal(corpse[0]![0], MOB_OPCODE.presence);
  assert.deepEqual(readMobPresence(new PacketReader(corpse[0]!, 1)), { flag: 0, mobId: 1 });

  assert.ok(
    log.some((line) => line.includes("mob 1 (template 120100) killed by 10")),
    log.join("\n"),
  );
});

/**
 * A kill pays experience, and the player's own numbers move for the first time: the packet is `0x0D`
 * (FINDINGS 4.21), and the diff is exactly "what changed" - `exp`, plus the level and the HP/MP
 * refill when the bar filled up.
 *
 * The character arrives with hp 20/50 and mp 5/30, and the stub monster is worth 20 exp at level 1
 * (the client's own table wants 15 for that level), so one swing has to produce
 * `{ level: 2, exp: 15, hp: 50, mp: 30 }` and nothing else - the client computes the level-up
 * message and the effect from the level it sees (sub_55BEB0).
 */
test("a kill awards the monster's exp as a 0x0D stat diff", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 20, speedPercent: 0, dieMs: 0 }),
    mobTickMs: 20,
    mobRespawnMs: 60_000,
    // No loot, so the only packets after the death are the corpse going and the stat diff.
    dropPolicy: () => [],
    handshake: { clientSendSeed: 0x0badc0de, clientRecvSeed: 0x0feedbac },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const stats = zeroStats();
  stats.id = 21;
  stats.name = "Fighter";
  stats.level = 1;
  stats.exp = 10;
  stats.hp = 20;
  stats.maxHp = 50;
  stats.mp = 5;
  stats.maxMp = 30;

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({
    username: "admin",
    characterId: 21,
    characterName: "Fighter",
    character: characterDataOf(stats, startingCharacterItems()),
  });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  await client.take(4); // 0x16 + the two mobs + the NPC
  t.after(() => client.close());

  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  const hit = await client.take(2);
  assert.equal(hit[0]![0], MOB_OPCODE.stat);
  assert.equal(hit[1]![0], MOB_OPCODE.leaveDelayed);
  const stat = (await client.take(1))[0]!;
  assert.equal(stat[0], STAT_OPCODE, "the kill pays out as 0x0D");
  assert.deepEqual(readStatUpdate(new PacketReader(stat, 1)), {
    ack: false,
    diff: { exp: 15, level: 2, hp: 50, mp: 30 },
  });
  assert.ok(
    log.some((line) => line.includes("+20 exp for killing stub") && line.includes("exp 15, level 2")),
    log.join("\n"),
  );
});

/**
 * The whole reward loop over a real socket, which is the only place it can be checked end to end:
 * a kill drops mesos and an item, the player walks onto them, and the server takes them the way
 * FINDINGS 4.18 says - `0x44` kind 2 (the drop is gone and *this* character took it, which is what
 * plays the pickup sound and the flight animation), then the gain itself: `0x11` for the mesos and,
 * for the item, `0x0B` (the item is in this slot now) plus its own `0x11`.
 *
 * The drop's landing spot is read out of the `0x43` the server sent - exactly what a client would
 * have to do - instead of being predicted, because the spread is drawn from the field's generator.
 */
test("a drop is taken by walking onto it: 0x44 kind 2, the gain, and the notice", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    mobTickMs: 20,
    mobRespawnMs: 60_000,
    dropPolicy: () => [{ money: 25 }, { itemId: 2000000, count: 3 }],
    dropSpreadPx: 0,
    handshake: { clientSendSeed: 0x12345678, clientRecvSeed: 0x87654321 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 11, characterName: "Fighter" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  await client.take(4); // 0x16 + the two mobs + the NPC
  t.after(() => client.close());

  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  // 0x34, 0x30, the kill's exp (0x0D), then the two drops.
  const burst = await client.take(5);
  assert.equal(burst[0]![0], MOB_OPCODE.stat);
  assert.equal(burst[1]![0], MOB_OPCODE.leaveDelayed);
  assert.equal(burst[2]![0], STAT_OPCODE);
  const mesos = readDropAppear(new PacketReader(burst[3]!, 1));
  const item = readDropAppear(new PacketReader(burst[4]!, 1));
  assert.equal(mesos.money, true);
  assert.equal(mesos.value, 25);

  /** Walks the character onto a spot: the first element of a CMovePath is where the server puts us. */
  const walkTo = (x: number, y: number): void => {
    const move = encodeClientUserMove({
      stageByte: 0,
      path: { originX: 0, originY: 0, elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }] },
    });
    client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.userMove, body: move.slice(1) });
  };

  // The field keeps talking while the player walks (the mob's corpse still has to go), so the pickup
  // is found by opcode instead of by counting packets.
  const takeUntil = async (opcode: number): Promise<Uint8Array[]> => {
    const seen: Uint8Array[] = [];
    for (let index = 0; index < 20; index++) {
      try {
        const [packet] = await client.take(1);
        seen.push(packet!);
        if (packet![0] === opcode) return seen;
      } catch {
        throw new Error(
          `no 0x${opcode.toString(16)} in [${seen.map((packet) => packet[0]!.toString(16)).join(",")}]\n` +
            log.join("\n"),
        );
      }
    }
    throw new Error(`no 0x${opcode.toString(16)} in [${seen.map((packet) => packet[0]!.toString(16)).join(",")}]`);
  };

  // Standing on the mesos: the server takes them on the next field tick, without being asked.
  walkTo(mesos.x, mesos.y);

  const mesoPickup = await takeUntil(DROP_OPCODE.remove);
  const takenPacket = mesoPickup[mesoPickup.length - 1]!;
  assert.deepEqual(readDropRemove(new PacketReader(takenPacket, 1)), {
    dropId: mesos.dropId,
    kind: DROP_REMOVE_KIND.taken,
    characterId,
  });
  const mesoNotice = await takeUntil(LOOT_OPCODE);
  assert.deepEqual(readLootNotice(new PacketReader(mesoNotice[mesoNotice.length - 1]!, 1)), {
    kind: "mesos",
    amount: 25,
  });
  // The mesos are part of the character record, so what moves them is a 0x0D diff; the `0x11` line is
  // only the chat notice (FINDINGS 4.22.5).
  const wallet = mesoNotice.find((packet) => packet[0] === STAT_OPCODE);
  assert.ok(wallet !== undefined, "a meso pickup sends the wallet as 0x0D");
  assert.deepEqual(readStatUpdate(new PacketReader(wallet, 1)).diff, { mesos: 25 });
  assert.ok(
    log.some((line) => line.includes("took 25 mesos")),
    log.join("\n"),
  );

  // Standing on the item: 0x44, then 0x0B (the item is in a slot now), then the item's notice.
  walkTo(item.x, item.y);
  const itemPickup = await takeUntil(INVENTORY_OPCODE);
  const changePacket = itemPickup[itemPickup.length - 1]!;
  const change = readInventoryChange(new PacketReader(changePacket, 1));
  assert.equal(change.result, 1);
  assert.deepEqual(change.changes, [
    {
      op: INVENTORY_OP.put,
      inventory: 2,
      slot: 1,
      item: { kind: "nonequip", itemId: 2000000, cash: null, quantity: 3 },
    },
  ]);
  const itemNotice = await takeUntil(LOOT_OPCODE);
  assert.deepEqual(readLootNotice(new PacketReader(itemNotice[itemNotice.length - 1]!, 1)), {
    kind: "item",
    itemId: 2000000,
    count: 3,
  });
  const removal = itemPickup.find((packet) => packet[0] === DROP_OPCODE.remove);
  assert.ok(removal, "the item's 0x44 came before its 0x0B");
  assert.equal(readDropRemove(new PacketReader(removal!, 1)).dropId, item.dropId);

  // The field is empty afterwards: standing there again must not send a second pickup.
  walkTo(item.x, item.y);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(client.queueLength, 0, "nothing is taken twice");
});

/**
 * A swing at a mob this field does not have is logged, not invented: the server answers nothing and
 * the mob it does have stays up. (A 2003 client only sends ids it got from the server, so this is the
 * malformed case - and it must not desync the HP of a different mob.)
 */
test("a swing at an unknown mob id answers nothing and leaves the field alone", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    mobTickMs: 20,
    handshake: { clientSendSeed: 0xbbbbbbbb, clientRecvSeed: 0xcccccccc },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 13, characterName: "Sloppy" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  await client.take(4); // 0x16 + the two mobs + the NPC

  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 99,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 99, hitAnimation: 7, x: 0, y: 0, sequence: 1, damages: [9999] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });
  const answered = await client.drainOpcodes();
  assert.equal(
    answered.includes(MOB_OPCODE.stat),
    false,
    `no mob stat answers for a mob that is not there (saw [${answered.map((op) => op.toString(16)).join(",")}])`,
  );
  assert.ok(log.some((line) => line.includes("no such mob")), log.join("\n"));
});


test("clicking an NPC opens its shop, and buying moves the item and the mesos", { skip: archive === null, timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 20, maxMP: 0, exp: 1, speedPercent: 100, dieMs: 0 }),
    npcTemplate: (templateId: number) => ({ templateId, name: "stub npc" }),
    shops: shopKeeper(archive!),
    // No patrol packets in this test: the mobs are still, so every burst below is exactly the
    // shop's own packets and the order stays readable.
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x77777777, clientRecvSeed: 0x88888888 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  // The wallet starts at 100 mesos, which is enough for two red potions (25 each) and nothing else.
  const stats = { ...zeroStats(), level: 1, mesos: 100 };
  const characterId = handoffs.issue({
    username: "admin",
    characterId: 21,
    characterName: "Shopper",
    character: characterDataOf(stats, startingCharacterItems()),
  });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  await client.take(4); // 0x16 + the two mobs + the NPC

  // Click the NPC: the release byte first, then the window. The NPC pool gave it id 1.
  client.send({
    kind: "unknown",
    opcode: CLIENT_OBJECT_CLICK_OPCODE,
    body: encodeClientObjectClick({ objectId: 1 }).slice(1),
  });
  const opened = await client.take(2);
  assert.equal(opened[0]![0], FIELD_OPCODE.requestRelease, "0x19 comes first: a click arms the client's gate");
  assert.equal(opened[1]![0], SHOP_OPEN_OPCODE);
  const shop = readShopOpen(new PacketReader(opened[1]!, 1));
  assert.equal(shop.shopId, 2003, "로빈's shop, keyed by the NPC template id");
  assert.deepEqual(
    shop.items.map((line) => [line.itemId, line.price]),
    [
      [2000000, 25], // 빨간 포션, straight out of Item/Consume/0200.img
      [2000003, 100], // 파란 포션
      [2030000, 75], // 마을 귀환 주문서, out of Item/Consume/0203.img
    ],
  );
  assert.equal(client.headersOk, true);

  // Buy one red potion: the result, the inventory change, and the mesos.
  client.send({
    kind: "unknown",
    opcode: CLIENT_SHOP_OPCODE,
    body: encodeClientShopRequest({ kind: "buy", row: 0, itemId: 2000000, count: 1 }).slice(1),
  });
  const trade = await client.take(3);
  assert.equal(trade[0]![0], SHOP_RESULT_OPCODE);
  assert.equal(trade[0]![1], SHOP_RESULT.silent, "a trade that happened says nothing in words");
  assert.equal(trade[1]![0], INVENTORY_OPCODE);
  const change = readInventoryChange(new PacketReader(trade[1]!, 1));
  assert.equal(change.changes.length, 1);
  assert.equal(change.changes[0]!.op, INVENTORY_OP.put, "the potion lands in a consume slot");
  assert.equal(trade[2]![0], STAT_OPCODE);
  const diff = readStatUpdate(new PacketReader(trade[2]!, 1));
  assert.deepEqual(diff, { ack: false, diff: { mesos: 75 } }, "the 0x0D flag 0x40000 is the money field");
  assert.ok(log.some((line) => line.includes("bought") && line.includes("mesos 75")), log.join("\n"));

  // A purchase the wallet cannot pay for: the client gets code 2 and nothing moves.
  client.send({
    kind: "unknown",
    opcode: CLIENT_SHOP_OPCODE,
    body: encodeClientShopRequest({ kind: "buy", row: 1, itemId: 2000003, count: 1 }).slice(1),
  });
  const refused = await client.take(1);
  assert.deepEqual([refused[0]![0], refused[0]![1]], [SHOP_RESULT_OPCODE, SHOP_RESULT.notEnoughMesos]);

  // Closing is deliberate silence: the client's close does not arm its in-flight flag, and a 0x4B
  // would make it throw (`sub_4B73A0` case 75).
  client.send({
    kind: "unknown",
    opcode: CLIENT_SHOP_OPCODE,
    body: encodeClientShopRequest({ kind: "close" }).slice(1),
  });
  const answered = await client.drainOpcodes();
  assert.equal(
    answered.includes(SHOP_RESULT_OPCODE) || answered.includes(SHOP_OPEN_OPCODE),
    false,
    "a close is not answered",
  );
  client.close();
});

test("clicking an NPC with no shop opens its dialogue, and 0x15 walks it line by line", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const lines = ["one", "two", "three"];
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 20, maxMP: 0, exp: 1, speedPercent: 100, dieMs: 0 }),
    npcTemplate: (templateId: number) => ({ templateId, name: "stub npc" }),
    // The words are the archive's in production; a stub keeps this test archive-free.
    npcDialogue: () => ({ templateId: 2003, name: "stub npc", lines }),
    // No shops at all: the NPC has nothing to sell, so a click is a conversation.
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x99999999, clientRecvSeed: 0xaaaaaaa },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({ username: "admin", characterId: 31, characterName: "Talker" });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  await client.take(4); // 0x16 + the two mobs + the NPC

  // The click: release byte first, then the first line. The NPC pool gave it id 1.
  client.send({
    kind: "unknown",
    opcode: CLIENT_OBJECT_CLICK_OPCODE,
    body: encodeClientObjectClick({ objectId: 1 }).slice(1),
  });
  const opened = await client.take(2);
  assert.equal(opened[0]![0], FIELD_OPCODE.requestRelease, "0x19 comes first: a click arms the client's gate");
  assert.equal(opened[1]![0], QUEST_TALK_OPCODE);
  const first = readQuestTalk(new PacketReader(opened[1]!, 1));
  assert.deepEqual(first, {
    unknownA: 0,
    npcId: 1,
    body: { kind: "say", message: "one", unknownA: 0, unknownB: 0 },
    }, "the pool id the client clicked, not the template id");
  assert.equal(client.headersOk, true);

  // A click while the dialog is up is refused: the client would throw on a second 0x47.
  client.send({
    kind: "unknown",
    opcode: CLIENT_OBJECT_CLICK_OPCODE,
    body: encodeClientObjectClick({ objectId: 1 }).slice(1),
  });
  const refused = await client.take(1);
  assert.deepEqual([refused[0]![0]], [FIELD_OPCODE.requestRelease], "the release byte, and no second dialog");
  assert.ok(log.some((line) => line.includes("still talking")), log.join("\n"));

  // The primary answer walks to the next line; the second button ends the conversation.
  client.send({ kind: "unknown", opcode: QUEST_REPLY_OPCODE, body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1) });
  const second = await client.take(1);
  assert.equal(second[0]![0], QUEST_TALK_OPCODE);
  assert.equal(readQuestTalk(new PacketReader(second[0]!, 1)).body.message, "two");

  client.send({ kind: "unknown", opcode: QUEST_REPLY_OPCODE, body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1) });
  const third = await client.take(1);
  assert.equal(readQuestTalk(new PacketReader(third[0]!, 1)).body.message, "three");

  client.send({ kind: "unknown", opcode: QUEST_REPLY_OPCODE, body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1) });
  const answered = await client.drainOpcodes();
  assert.equal(
    answered.includes(QUEST_TALK_OPCODE),
    false,
    "the last line's answer ends the talk: nothing follows",
  );
  assert.ok(log.some((line) => line.includes("the last line was read")), log.join("\n"));

  // A reply with no dialog open is dropped, and a new click starts a fresh conversation.
  client.send({ kind: "unknown", opcode: QUEST_REPLY_OPCODE, body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1) });
  assert.equal(
    (await client.drainOpcodes()).includes(QUEST_TALK_OPCODE),
    false,
    "an answer with no dialog is not answered",
  );
  assert.ok(log.some((line) => line.includes("without a dialog open")), log.join("\n"));

  client.send({
    kind: "unknown",
    opcode: CLIENT_OBJECT_CLICK_OPCODE,
    body: encodeClientObjectClick({ objectId: 1 }).slice(1),
  });
  const again = await client.take(2);
  assert.equal(again[1]![0], QUEST_TALK_OPCODE);
  assert.equal(readQuestTalk(new PacketReader(again[1]!, 1)).body.message, "one", "a new talk starts at the first line");

  // The second button (answer 0) closes it without another packet.
  client.send({ kind: "unknown", opcode: QUEST_REPLY_OPCODE, body: encodeQuestReply({ kind: "say", answer: 0 }).slice(1) });
  assert.equal(
    (await client.drainOpcodes()).includes(QUEST_TALK_OPCODE),
    false,
    "the secondary button ends the talk",
  );
  assert.ok(log.some((line) => line.includes("conversation ended")), log.join("\n"));
  client.close();
});

/**
 * The MMO half of ADR-012, over real sockets: two players in one map.
 *
 * The field is the server's, not the connection's (`game/world.ts`), so the second socket sees the
 * first player enter (`0x1C`), their walk (`0x22`), a monster dying under their swing, and their
 * departure (`0x1D`) - while the packets that belong to one player (the exp of that kill, in `0x0D`)
 * go to that player alone. Nothing moves on its own here (`speedPercent: 0`), so every packet in the
 * test is one the test itself caused.
 */
test("two players in one map see each other: 0x1C, 0x22, the same kill, and 0x1D", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    dropPolicy: () => [{ money: 25 }],
    handshake: { clientSendSeed: 0xbbbbbbbb, clientRecvSeed: 0xcccccccc },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" }),
  });
  const heroBurst = await hero.take(4);
  assert.deepEqual(
    heroBurst.map((bytes) => bytes[0]),
    [FIELD_OPCODE.setField, MOB_OPCODE.enterField, MOB_OPCODE.enterField, NPC_OPCODE.enterField],
    "the first player gets the map and its world, and no 0x1C: there is nobody else",
  );

  // The second player into the same map: the snapshot, and then who is already standing there.
  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  // Alt's record is the one a real `0x06` produces: the face and hair the dialog picked, and the four
  // clothes as worn equips - exactly how `createCharacter` dresses a character. The others are
  // hand-built handoffs with no record at all, which is why they arrive in the starter look.
  const altStats = { ...zeroStats(), id: 8, name: "Alt" };
  const altRecord = characterDataOf(
    altStats,
    withWorn(startingCharacterItems(), wornOfLook([20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 7])),
  );
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt", character: altRecord }),
  });
  const altBurst = await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  assert.deepEqual(
    altBurst.map((bytes) => bytes[0]),
    [
      FIELD_OPCODE.setField,
      MOB_OPCODE.enterField,
      MOB_OPCODE.enterField,
      NPC_OPCODE.enterField,
      FIELD_OPCODE.userEnterField,
    ],
    "the joiner gets the world first, then the players",
  );
  const aboutHero = readUserEnterField(new PacketReader(altBurst[4]!, 1));
  assert.deepEqual(
    {
      characterId: aboutHero.characterId,
      name: aboutHero.name,
      x: aboutHero.x,
      y: aboutHero.y,
      foothold: aboutHero.foothold,
    },
    { characterId: 7, name: "Hero", x: 100, y: 200, foothold: 32 },
    "the player already there, at the map's spawn portal and on its foothold",
  );
  assert.deepEqual(
    [aboutHero.face, aboutHero.avatarItems],
    [DEFAULT_FACE_ID, [DEFAULT_HAIR_ID]],
    "and with a face and hair - a hand-built handoff record has no look of its own, so the " +
      "server fills the starter one in rather than sending a user with no face at all",
  );

  const heroSaw = await hero.takeOpcode(FIELD_OPCODE.userEnterField);
  assert.deepEqual(heroSaw.map((bytes) => bytes[0]), [FIELD_OPCODE.userEnterField], "and the one who was there gets the newcomer");
  const aboutAlt = readUserEnterField(new PacketReader(heroSaw[0]!, 1));
  assert.deepEqual([aboutAlt.characterId, aboutAlt.name], [8, "Alt"]);
  assert.deepEqual(
    [aboutAlt.face, aboutAlt.avatarItems],
    [20000, [30000, 1040001, 1060001, 1071000, 1302000]],
    "the face and the worn equips of the record go out as the 0x1C's first u32 and its id list - " +
      "which is the whole reason the clothes are stored as worn equips (`sub_42E2C0`, 4.11.3c)",
  );
  assert.equal(hero.headersOk, true, "every packet of a shared field survives the cipher/header check");

  // A walk: relayed as the other client's own path, with the id in front (0x0E carries none).
  const move = encodeClientUserMove({
    stageByte: 0,
    path: {
      originX: 0,
      originY: 0,
      elements: [{ attr: 0, x: 300, y: 290, vx: 0, vy: 0, action: 0, foothold: 32, duration: 60 }],
    },
  });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.userMove, body: move.slice(1) });
  const altSawMove = await alt.takeOpcode(FIELD_OPCODE.userMove);
  const relayed = readUserMove(new PacketReader(altSawMove[altSawMove.length - 1]!, 1));
  assert.equal(relayed.characterId, 7);
  assert.deepEqual(relayed.path.elements.map((element) => [element.x, element.y]), [[300, 290]]);
  const echoedMoves = (await hero.drain()).filter((bytes) => bytes[0] === FIELD_OPCODE.userMove);
  assert.deepEqual(echoedMoves, [], "the mover is not told about their own walk");

  // One swing kills a monster: the death is the field's, the exp is the attacker's.
  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  const altSawKill = await alt.takeOpcode(DROP_OPCODE.appear);
  assert.deepEqual(
    altSawKill.map((bytes) => bytes[0]),
    [FIELD_OPCODE.userAttack, MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, DROP_OPCODE.appear],
    "the other player sees the swing first, then the hit, the death and the loot - and nothing of the reward",
  );
  // The swing itself: the attacker's own numbers and action, and only the mobs this field accepted.
  const swing = readUserAttack(new PacketReader(altSawKill[0]!, 1));
  assert.deepEqual(
    [swing.characterId, swing.facingLeft, swing.action, swing.hits, swing.speed, swing.targets],
    [7, false, 0, 1, 1, [{ mobId: 1, hitAnimation: 7, damages: [10] }]],
    "0x23 carries the swing the attacker reported, under the attacker's own character id",
  );
  assert.deepEqual(
    [swing.afterimage, swing.skillLevel, swing.skillId, swing.projectileItemId],
    [0, 0, 0, 0],
    "the three fields with no source here go out as their neutral values, not as a guess (FINDINGS 4.11.7b)",
  );
  assert.equal(readDropAppear(new PacketReader(altSawKill[3]!, 1)).mobId, 1, "the loot flies out of the monster that died");

  const heroSawKill = await hero.takeOpcode(DROP_OPCODE.appear);
  assert.deepEqual(
    heroSawKill.map((bytes) => bytes[0]),
    [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, STAT_OPCODE, DROP_OPCODE.appear],
    "the attacker gets the same world packets plus their own exp - no 0x23 for the swing it just played",
  );
  assert.deepEqual(readStatUpdate(new PacketReader(heroSawKill[2]!, 1)).diff, { exp: 1 });

  // The way out: the field tells the one still standing there.
  alt.close();
  const heroSawLeave = await hero.takeOpcode(FIELD_OPCODE.userLeaveField);
  assert.equal(
    new PacketReader(heroSawLeave[heroSawLeave.length - 1]!, 1).readU32(),
    8,
    "the id of the character that left",
  );
  assert.ok(log.some((line) => line.includes('"Alt" (8) entered map 1000000')), log.join("\n"));
  assert.ok(log.some((line) => line.includes("(8) left map 1000000")), log.join("\n"));
});

/**
 * The other two halves of the attack family (ADR-027). A shot and a cast are the *same* body as a
 * swing - one reader serves `0x23`/`0x24`/`0x25` - and the opcode byte alone says which renderer the
 * observer runs, so the relay is the one mapping in `ATTACK_RELAY_OPCODE`.
 *
 * A shot has one field the attacker cannot fill in: it sends the USE-tab **slot** it drew the
 * projectile from (`sub_511630` returns the slot and hands the id back out of band), while the
 * observer's `0x24` wants the item id. The server has a record of that slot - the shop put the pile
 * there - so it relays the id; the two opcodes without a slot send the neutral 0.
 */
/**
 * A drag in the inventory window: c2s `0x17` (FINDINGS 4.34.1). The client moves nothing itself, so
 * the two things worth pinning are its two answers - the `0x0B` that moves the item in this player's
 * own window, and the `0x28` that puts it on everybody else's screen.
 */
test("equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 500, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    dropPolicy: () => [],
    // Standing monsters: this test counts packets by opcode, and a walking one would only add noise.
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x99887766, clientRecvSeed: 0x55443322 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  // The cap is in the bag, not on the head: both the window and the avatar have something to change.
  const heroRecord = characterDataOf({ ...zeroStats(), id: 7, name: "Hero" }, startingCharacterItems());
  heroRecord.items!.inventories[INVENTORY_TAB.equip - 1]!.items.set(2, equipSlot(1002000));
  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero", character: heroRecord }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  const altBurst = await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  const aboutHero = readUserEnterField(new PacketReader(altBurst[altBurst.length - 1]!, 1));
  assert.deepEqual(aboutHero.avatarItems, [DEFAULT_HAIR_ID], "nothing on the head yet - the cap is in the bag");
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // A double-click on the cap: the four fields of `sub_4636B0` - tab 1, slot 2, the part its caller
  // derived from the item id (1002000 -> cap -> 1, written the way a worn slot is written: negative).
  const doubleClick = encodeClientChangeSlot({ tab: INVENTORY_TAB.equip, fromSlot: 2, toSlot: -1, count: -1 });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: doubleClick.slice(1) });

  // The wearer's own window: out of the tab slot, into the worn slot of part 1 - and nothing else,
  // because the client's inventory only ever changes on `0x0B` (FINDINGS 4.6).
  const heroSaw = await hero.takeOpcode(INVENTORY_OPCODE);
  const change = readInventoryChange(new PacketReader(heroSaw[heroSaw.length - 1]!, 1));
  assert.deepEqual(
    change.changes.map((entry) => [entry.op, entry.inventory, entry.slot]),
    [
      [INVENTORY_OP.put, INVENTORY_TAB.equip, -1],
      [INVENTORY_OP.clear, INVENTORY_TAB.equip, 2],
    ],
    "the cap is put at the negative slot - the worn item itself - and the old slot is cleared",
  );
  assert.equal(
    change.changes[0]!.op === INVENTORY_OP.put ? change.changes[0]!.item.itemId : 0,
    1002000,
    "the put carries the item that was moved",
  );
  assert.equal(change.result, 1, "the result byte is the client's own timer flag, not a per-entry status");

  // Everybody else: a `0x28` with the list a `0x1C` would have carried, and the face left alone
  // (flags bit 0 clear, so no face word is on the wire at all - FINDINGS 4.11.8).
  const altSaw = await alt.takeOpcode(FIELD_OPCODE.userLook);
  const look = readUserLook(new PacketReader(altSaw[altSaw.length - 1]!, 1));
  assert.deepEqual(
    [look.characterId, look.face, look.avatarItems],
    [7, undefined, [DEFAULT_HAIR_ID, 1002000]],
    "0x28 names the user, leaves the face and replaces the id list",
  );
  assert.ok(
    log.some((line) => line.includes("tab 1 slot 2 -> worn 1 count=-1") && line.includes("look changed")),
    log.join("\n"),
  );
  // The wearer is not sent their own look: their client draws them from the record it holds, the rule
  // `0x27` and the attack relays follow too.
  assert.deepEqual(
    (await hero.drainOpcodes(150)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
    [],
    "no 0x28 for the player who equipped it",
  );

  // The record itself moved, not a copy of it: this is the object the account table holds, so the
  // worn cap is what a relog reads back (ADR-017).
  assert.equal(heroRecord.items!.worn.get(1)?.itemId, 1002000, "part 1 of the worn group is the cap");
  assert.equal(heroRecord.items!.inventories[INVENTORY_TAB.equip - 1]!.items.has(2), false);

  // The same drag again, now that slot 2 is empty: nothing moves, and the answer is still a `0x0B` -
  // an empty one. `sub_55ACB0` arms the client's one-request gate (FINDINGS 4.6) and only a `0x0B`
  // clears it, so a refusal that stayed silent would freeze the whole window.
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: doubleClick.slice(1) });
  const refused = await hero.takeOpcode(INVENTORY_OPCODE);
  const empty = readInventoryChange(new PacketReader(refused[refused.length - 1]!, 1));
  assert.deepEqual([empty.result, empty.changes], [1, []], "an empty 0x0B is this server's refusal");
  assert.ok(log.some((line) => line.includes("refused (emptySlot)")), log.join("\n"));
  assert.deepEqual(
    (await alt.drainOpcodes(150)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
    [],
    "and a refused drag tells the map nothing",
  );
});

test("a throw-away answers 0x0B and puts the item on the ground for the whole map", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    // A monster with nothing to drop: the only thing that lands here is what the player throws.
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 500, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    dropPolicy: () => [],
    // The field's own tick, which is what takes a drop a player is standing on.
    mobTickMs: 20,
    handshake: { clientSendSeed: 0x0a0b0c0d, clientRecvSeed: 0x01020304 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  // A pile of ten potions in consume slot 4: enough to throw some away and keep the rest.
  const heroRecord = characterDataOf({ ...zeroStats(), id: 9, name: "Hero" }, startingCharacterItems());
  heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.set(4, nonEquipSlot(2000000, 10));
  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 9, characterName: "Hero", character: heroRecord }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 10, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  /** The `0x43` of a drop: the monster block is what a throw-away must not have. */
  const dropBody = (packet: Uint8Array): void => {
    assert.equal(packet.length, 15, "kind 2 is 15 bytes on the wire - no monster block (FINDINGS 4.18.2)");
  };

  // Four of the ten go on the ground. The client's own sender is `sub_463BE0`: the tab and the slot
  // it was dragged from, `toSlot = 0`, and the number the player answered to "몇 개나 버리시겠습니까?".
  const throwAway = encodeClientChangeSlot({ tab: INVENTORY_TAB.consume, fromSlot: 4, toSlot: 0, count: 4 });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: throwAway.slice(1) });

  // The thrower's window: the slot now holds six, and that is the whole `0x0B` - one `put`.
  const answer = await hero.takeOpcode(INVENTORY_OPCODE);
  const change = readInventoryChange(new PacketReader(answer[answer.length - 1]!, 1));
  assert.deepEqual(change.changes, [
    {
      op: INVENTORY_OP.put,
      inventory: INVENTORY_TAB.consume,
      slot: 4,
      item: { kind: "nonequip", itemId: 2000000, cash: null, quantity: 6 },
    },
  ]);
  // The ground, for everyone: the thrower's own client never drew the item anywhere but the slot, so
  // this 0x43 is the only thing that puts it on the map.
  const fromHero = await hero.takeOpcode(DROP_OPCODE.appear);
  const heroSaw = fromHero[fromHero.length - 1]!;
  dropBody(heroSaw);
  const drop = readDropAppear(new PacketReader(heroSaw, 1));
  assert.deepEqual(
    [drop.kind, drop.money, drop.value, drop.mobId],
    [DROP_KIND.placed, false, 2000000, undefined],
    "a placed drop names the item, no mesos, and no monster",
  );
  const fromAlt = await alt.takeOpcode(DROP_OPCODE.appear);
  assert.equal(readDropAppear(new PacketReader(fromAlt[fromAlt.length - 1]!, 1)).dropId, drop.dropId);
  assert.ok(log.some((line) => line.includes("dropped item 2000000 x4")), log.join("\n"));

  // It is under the thrower's feet, and the field leaves it there: the packet's own coordinates are
  // the player's, and `DropField.reachable` only takes a drop that was already there when the player
  // last moved. Without that rule a throw-away would come straight back on the next tick.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(
    (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.remove),
    [],
    "the thrower does not re-take it while standing still",
  );

  /** Walks the character onto a spot: the first element of a CMovePath is where the server puts us. */
  const walkTo = (x: number, y: number): void => {
    const move = encodeClientUserMove({
      stageByte: 0,
      path: { originX: 0, originY: 0, elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }] },
    });
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.userMove, body: move.slice(1) });
  };

  // Stepping off it is not a pickup either, and stepping back on is one: the item goes back into the
  // slot with the count it was thrown with, which is how the throw's number is shown to survive.
  walkTo(drop.x + 80, drop.y);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(
    (await hero.drainOpcodes(50)).filter((opcode) => opcode === DROP_OPCODE.remove),
    [],
    "80 px away is outside the reach",
  );
  walkTo(drop.x, drop.y);
  const back = await hero.takeOpcode(DROP_OPCODE.remove);
  assert.deepEqual(readDropRemove(new PacketReader(back[back.length - 1]!, 1)), {
    dropId: drop.dropId,
    kind: DROP_REMOVE_KIND.taken,
    characterId: 9,
  });
  const pickup = await hero.takeOpcode(INVENTORY_OPCODE);
  const taken = readInventoryChange(new PacketReader(pickup[pickup.length - 1]!, 1));
  assert.deepEqual(taken.changes, [
    {
      op: INVENTORY_OP.put,
      inventory: INVENTORY_TAB.consume,
      slot: 4,
      item: { kind: "nonequip", itemId: 2000000, cash: null, quantity: 10 },
    },
  ]);
  const notice = await alt.takeOpcode(DROP_OPCODE.remove);
  assert.equal(readDropRemove(new PacketReader(notice[notice.length - 1]!, 1)).characterId, 9);

  // A count of zero is not a throw-away the client can send, and it is refused the same way every
  // other impossible drag is: an empty `0x0B`, and nothing on the ground.
  const zero = encodeClientChangeSlot({ tab: INVENTORY_TAB.consume, fromSlot: 4, toSlot: 0, count: 0 });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: zero.slice(1) });
  const nothing = await hero.takeOpcode(INVENTORY_OPCODE);
  assert.deepEqual(readInventoryChange(new PacketReader(nothing[nothing.length - 1]!, 1)).changes, []);
  assert.ok(log.some((line) => line.includes("refused (badCount)")), log.join("\n"));
  assert.deepEqual(
    (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.appear),
    [],
    "a refused throw-away leaves the ground as it was",
  );
});

test("a shot goes out as 0x24 with the projectile id, and a cast as 0x25", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    // A monster with room for two hits, so both relays have a live target.
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 60, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    dropPolicy: () => [],
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x11223344, clientRecvSeed: 0x55667788 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  // The attacker owns a pile of arrows in consume slot 3, which is what a shot's extra `u16` names.
  const heroItems = startingCharacterItems();
  heroItems.inventories[INVENTORY_TAB.consume - 1]!.items.set(3, nonEquipSlot(2060000, 100));
  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({
      username: "admin",
      characterId: 7,
      characterName: "Archer",
      character: characterDataOf({ ...zeroStats(), id: 7, name: "Archer" }, heroItems),
    }),
  });
  await hero.take(4); // 0x16 + the two mobs + the NPC

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);

  // A shot: `0x10` carries the pile it used, `1` arrow's worth of damage, facing left.
  const shot = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: true,
      action: 0x2e,
      speed: 2,
      projectileSlot: 3,
      targets: [{ mobId: 1, hitAnimation: -1, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.shootAttack,
  );
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.shootAttack, body: shot.slice(1) });

  const altShot = await alt.takeOpcode(FIELD_OPCODE.userShootAttack);
  assert.equal(
    altShot[0]![0],
    FIELD_OPCODE.userShootAttack,
    "the observer sees the shot before the monster's reaction - and nothing of someone else's reward",
  );
  const altSawHit = await alt.takeOpcode(MOB_OPCODE.stat);
  assert.equal(altSawHit[altSawHit.length - 1]![0], MOB_OPCODE.stat, "the monster's reaction follows the shot");
  const relayedShot = readUserAttack(new PacketReader(altShot[0]!, 1));
  assert.deepEqual(
    [relayedShot.characterId, relayedShot.facingLeft, relayedShot.action, relayedShot.hits, relayedShot.speed],
    [7, true, 0x2e, 1, 2],
    "0x24 is the shot the attacker reported: their id, their action, their speed (FINDINGS 4.11.7c)",
  );
  assert.equal(relayedShot.projectileItemId, 2060000, "the slot the client named is relayed as the item id");
  assert.deepEqual(relayedShot.targets, [{ mobId: 1, hitAnimation: -1, damages: [10] }]);
  // The attacker gets the world's reaction (and the `0x1C` about Alt joining, which was waiting), but
  // never its own shot back: its client drew that one as it built the packet.
  const heroSawShot = await hero.takeOpcode(MOB_OPCODE.stat);
  assert.equal(heroSawShot[heroSawShot.length - 1]![0], MOB_OPCODE.stat, "the attacker gets the monster's reaction");
  assert.deepEqual(
    heroSawShot.filter((bytes) => bytes[0] === FIELD_OPCODE.userShootAttack || bytes[0] === FIELD_OPCODE.userAttack),
    [],
    "and nothing of its own attack back - it played that locally",
  );

  // A cast: same record, `0x11`'s header has no slot, so the projectile field goes out as 0.
  const cast = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0x20,
      speed: 3,
      targets: [{ mobId: 1, hitAnimation: 3, x: 509, y: 300, sequence: 2, damages: [9] }],
    },
    CLIENT_FIELD_OPCODE.magicAttack,
  );
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.magicAttack, body: cast.slice(1) });

  const altCast = await alt.takeOpcode(FIELD_OPCODE.userMagicAttack);
  assert.equal(altCast[0]![0], FIELD_OPCODE.userMagicAttack, "a cast never goes out as the shot's opcode");
  const relayedCast = readUserAttack(new PacketReader(altCast[0]!, 1));
  assert.deepEqual(
    [relayedCast.characterId, relayedCast.action, relayedCast.speed, relayedCast.projectileItemId],
    [7, 0x20, 3, 0],
    "and its projectile field is the neutral 0: there is no slot in the packet to look up",
  );
  assert.deepEqual(relayedCast.targets, [{ mobId: 1, hitAnimation: 3, damages: [9] }]);
  assert.ok(
    log.some((line) => line.includes("0x24 attack of \"Archer\"") && line.includes("1 target(s)")),
    log.join("\n"),
  );
  assert.ok(log.some((line) => line.includes("0x25 attack of \"Archer\"")), log.join("\n"));
});

/**
 * Character ids are the field's key for a player (`CUserPool`, `sub_51CFE0`) and the handoff's, so two
 * accounts must never be given the same one (ADR-012). The stub has no database to hand out sequences,
 * so it takes the maximum over every account - this pins that it does.
 */
test("two accounts never hand out the same character id", { timeout: 20000 }, async (t) => {
  const handoffs = new HandoffRegistry();
  const accounts = new Map<string, AccountRecord>([
    ["admin", { password: "admin", characters: [] }],
    ["guest", { password: "guest", characters: [] }],
  ]);
  const login = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: 1 },
    handoffs,
    handshake: { clientSendSeed: 0x12341234, clientRecvSeed: 0x56785678 },
  });
  const info = await login.listen(0);
  t.after(async () => {
    await login.close();
  });

  const create = async (username: string, name: string): Promise<number> => {
    const client = await FakeClient.connect(info.port);
    client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
    client.send({ kind: "login-request", opcode: 0x01, username, password: username });
    await client.take(1);
    client.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
    await client.take(1);
    client.send({ kind: "check-name", opcode: 0x06, name, appearance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    await client.take(1);
    client.send({ kind: "create-character", opcode: 0x05, name });
    const reply = (await client.take(1))[0]!;
    client.close();
    return readCharacterData(new PacketReader(reply, 2)).stats.id;
  };

  const first = await create("admin", "Hero");
  const second = await create("guest", "Guest");
  assert.equal(first, 1, "the first character of the server");
  assert.equal(second, 2, "the next one follows the *server's* maximum, not the account's");
});


/**
 * A portal is a map change (FINDINGS 4.25): the client sends the name of the portal under the cursor
 * (`0x0D`, `kind = -1`) and the server answers with the release byte and then the field that portal
 * leads to (`0x16` + that field's own world), while the map the player left is told they are gone
 * (`0x1D`).
 *
 * It also pins the other half of "where do I log in": a character record carries its own map
 * (`CharacterData.mapId`, the only field `sub_4C2780` reads to pick one), so the third client here
 * arrives in map 2000000 by *record* - and finds the player who took the portal standing there, at
 * that map's own spawn portal.
 */
test("a portal moves a player to another map, and the map they left hears about it", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    handshake: { clientSendSeed: 0xdddddddd, clientRecvSeed: 0xeeeeeeee },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // A name that is no portal of this map: the release byte is owed either way - the client's interact
  // gate stays armed until it arrives (`sub_472590`) - and nothing else happens.
  alt.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.interact,
    body: encodeClientInteract({ kind: INTERACT_KIND_CURSOR, name: "nowhere" }).slice(1),
  });
  const release = await alt.take(1);
  assert.equal(release[0]![0], FIELD_OPCODE.requestRelease, "the release byte answers every 0x0D");
  const jumps = (await alt.drain()).filter((bytes) => bytes[0] === FIELD_OPCODE.setField);
  assert.deepEqual(jumps, [], "an unknown portal is not a teleport");
  assert.ok(log.some((line) => line.includes('"nowhere" is no portal of map 1000000')), log.join("\n"));

  // The real one. `tm` of the map's own portal is where it leads, so the answer is a new field.
  alt.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.interact,
    body: encodeClientInteract({ kind: INTERACT_KIND_CURSOR, name: "west00" }).slice(1),
  });
  const moved = await alt.take(4);
  assert.deepEqual(
    moved.map((bytes) => bytes[0]),
    [FIELD_OPCODE.requestRelease, FIELD_OPCODE.setField, MOB_OPCODE.enterField, NPC_OPCODE.enterField],
    "release byte, then the destination map and its world",
  );
  const arrived = readSetField(new PacketReader(moved[1]!, 1));
  assert.equal(arrived.character.stats.mapId, 2000000, "the record the client holds now names the new map");
  assert.deepEqual([arrived.character.stats.id, arrived.character.stats.name], [8, "Alt"]);

  // The map the player left: one 0x1D, and nothing else - the two players are in two maps now.
  const left = await hero.takeOpcode(FIELD_OPCODE.userLeaveField);
  assert.equal(
    new PacketReader(left[left.length - 1]!, 1).readU32(),
    8,
    "exactly the character that walked through the portal",
  );
  const otherFieldNews = (await hero.drain()).filter(
    (bytes) => bytes[0] === FIELD_OPCODE.userEnterField || bytes[0] === FIELD_OPCODE.userLeaveField,
  );
  assert.deepEqual(otherFieldNews, [], "a field does not report what another field is doing");

  // Where a player enters is their own record: this one names map 2000000, so that is the field the
  // new connection is put into - and the player who took the portal is in it.
  const guest = await FakeClient.connect(gameInfo.port);
  t.after(() => guest.close());
  const record = characterDataOf(
    { ...zeroStats(), id: 9, name: "Guest", mapId: 2000000, level: 1, hp: 50, maxHp: 50, mp: 50, maxMp: 50 },
    startingCharacterItems(),
  );
  guest.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 9, characterName: "Guest", character: record }),
  });
  const guestBurst = await guest.takeOpcode(FIELD_OPCODE.userEnterField);
  assert.deepEqual(
    guestBurst.map((bytes) => bytes[0]),
    [FIELD_OPCODE.setField, MOB_OPCODE.enterField, NPC_OPCODE.enterField, FIELD_OPCODE.userEnterField],
    "the record\'s map, its world, then who is in it",
  );
  assert.equal(readSetField(new PacketReader(guestBurst[0]!, 1)).character.stats.mapId, 2000000);
  const aboutAlt = readUserEnterField(new PacketReader(guestBurst[3]!, 1));
  assert.deepEqual(
    [aboutAlt.characterId, aboutAlt.name, aboutAlt.x, aboutAlt.y, aboutAlt.foothold],
    [8, "Alt", 600, 300, 32],
    "the player who took the portal is at the destination\'s own portal, on its foothold",
  );

  // ... and the one who was there hears the newcomer, the same way as in any other map.
  const altSaw = await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  assert.equal(readUserEnterField(new PacketReader(altSaw[altSaw.length - 1]!, 1)).characterId, 9);
  assert.ok(
    log.some((line) => line.includes('"Alt" uses portal "west00" of map 1000000 -> 2000000')),
    log.join("\n"),
  );
});

/**
 * The revive dialog (`0x0D` with `kind = 0`, FINDINGS 4.32): the `CUIRevive` window - the one that
 * appears 2.2 s after a death - answers its OK button and VK_RETURN with `sub_472590(0, nullptr)`, and
 * the player is owed two things: HP back to full, and a `0x16` into the map `info/returnMap` names.
 *
 * The `0x16` *is* the revive, not just a move: it is what rebuilds the client's field and the local
 * user with it (`sub_4C2780` -> `sub_51CBF0` -> `sub_511030`), so the corpse and the dead state
 * belong to the field that is being replaced. That is also why no second packet carries the HP: the
 * record inside that `0x16` is the one the client's HP bar draws (FINDINGS 4.21), so restoring HP
 * before the map is entered is the whole of it - the test starts the character at 1 of 50 and reads
 * 50 out of the packet that comes back.
 *
 * Both halves of "where do I come back" are here: a field whose `returnMap` is a map this server can
 * read (a real map change, with the map they died in told they are gone) and a map whose `returnMap`
 * it cannot (the same branch every town takes through `RETURN_MAP_NONE`: leave and re-enter, which
 * the players standing there see as `0x1D` + `0x1C`).
 */
test("a revive restores HP and re-enters a field: the return map if it can be read, the same map otherwise", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) =>
      mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : mapId === 1010000 ? STUB_MAP_TOWN : undefined,
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    handshake: { clientSendSeed: 0x77777777, clientRecvSeed: 0x88888888 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  /** A record one hit from death, so the packet that comes back says whether HP was restored. */
  const hurt = (id: number, name: string, mapId: number): CharacterData => {
    const stats = zeroStats();
    stats.id = id;
    stats.name = name;
    stats.level = 1;
    stats.hp = 1;
    stats.maxHp = 50;
    stats.mp = 5;
    stats.maxMp = 5;
    stats.mapId = mapId;
    return characterDataOf(stats, startingCharacterItems());
  };

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero", character: hurt(7, "Hero", 1000000) }),
  });
  const wounded = readSetField(new PacketReader((await hero.take(1))[0]!, 1));
  assert.equal(wounded.character.stats.hp, 1, "the record enters the field as it is - a hurt 1/50");

  const witness = await FakeClient.connect(gameInfo.port);
  t.after(() => witness.close());
  witness.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  await witness.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // The revive dialog's OK: the same `0x0D` a portal click uses, with `kind = 0` and no name.
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.interact,
    body: encodeClientInteract({ kind: INTERACT_KIND_REVIVE, name: "" }).slice(1),
  });
  const release = await hero.take(1);
  assert.equal(release[0]![0], FIELD_OPCODE.requestRelease, "the release byte answers a revive too");
  const revived = readSetField(new PacketReader((await hero.take(1))[0]!, 1));
  assert.equal(revived.character.stats.hp, 50, "a revive restores HP to full");
  assert.equal(revived.character.stats.maxHp, 50, "and does not touch the maximum");
  assert.equal(revived.character.stats.mapId, 1010000, "the map is the one info/returnMap names");
  assert.ok(
    log.some((line) => line.includes('"Hero" revives - hp 50/50, map 1000000 -> 1010000')),
    log.join("\n"),
  );
  assert.deepEqual(
    (await witness.drainOpcodes()).filter(
      (opcode) => opcode === FIELD_OPCODE.userLeaveField || opcode === FIELD_OPCODE.userEnterField,
    ),
    [FIELD_OPCODE.userLeaveField],
    "the map they died in hears them leave",
  );

  // A character whose own record says 1010000 finds them there: the revive joined the new field, it
  // did not just send a packet.
  const latecomer = await FakeClient.connect(gameInfo.port);
  t.after(() => latecomer.close());
  latecomer.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({
      username: "admin",
      characterId: 9,
      characterName: "Other",
      character: hurt(9, "Other", 1010000),
    }),
  });
  await latecomer.takeOpcode(FIELD_OPCODE.setField);
  const sawHero = await latecomer.takeOpcode(FIELD_OPCODE.userEnterField);
  assert.equal(readUserEnterField(new PacketReader(sawHero[sawHero.length - 1]!, 1)).characterId, 7);

  // The second revive happens in the town, whose `returnMap` is a map this server cannot read: the
  // field is left and joined again, which everyone standing there sees.
  await hero.drain(); // the latecomer's own 0x1C is already in this queue
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.interact,
    body: encodeClientInteract({ kind: INTERACT_KIND_REVIVE, name: "" }).slice(1),
  });
  const releaseAgain = await hero.take(1);
  assert.equal(releaseAgain[0]![0], FIELD_OPCODE.requestRelease, "…and so does the second one");
  const again = readSetField(new PacketReader((await hero.take(1))[0]!, 1));
  assert.equal(again.character.stats.mapId, 1010000, "an unreadable return map re-enters the map they are in");
  assert.equal(again.character.stats.hp, 50);
  assert.ok(
    log.some((line) => line.includes('"Hero" revives - hp 50/50, map 1010000 -> 1010001')),
    log.join("\n"),
  );
  assert.ok(log.some((line) => line.includes("map 1010001 has no Map/Map/*.img")), log.join("\n"));
  assert.deepEqual(
    (await latecomer.drainOpcodes()).filter(
      (opcode) => opcode === FIELD_OPCODE.userLeaveField || opcode === FIELD_OPCODE.userEnterField,
    ),
    [FIELD_OPCODE.userLeaveField, FIELD_OPCODE.userEnterField],
    "the town sees them leave and arrive again",
  );
});

/**
 * The other half of the death slice: what a monster's hit *is* on the wire (FINDINGS 4.33, ADR-021).
 *
 * The 2003 client runs the monster AI and rolls the damage it takes locally (`sub_511C60` ->
 * `sub_4C8ED0` -> `sub_5114A0`), and it does **not** write its own record with it - the record's HP
 * is written by the server's `0x0D` (`sub_45E0D0`). So the damage only shows up if this server takes
 * the report (`0x1C`), applies it, and answers with the diff. The rules that are the server's own
 * are the three this test walks through: the `[0, max]` clamp, "a dead character does not
 * regenerate", and "a report that changes nothing costs no packet" - after which the revive path
 * (ADR-020) closes the loop by refilling HP.
 */
test("a monster's damage lands because the client reports it: c2s 0x1C in, 0x0D out", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) =>
      mapId === 1000000 ? STUB_MAP : mapId === 1010000 ? STUB_MAP_TOWN : undefined,
    handshake: { clientSendSeed: 0x0da0a0a0, clientRecvSeed: 0x0be1be1b },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const stats = zeroStats();
  stats.id = 41;
  stats.name = "PunchingBag";
  stats.level = 1;
  stats.hp = 50;
  stats.maxHp = 50;
  stats.mp = 5;
  stats.maxMp = 30;

  const client = await FakeClient.connect(gameInfo.port);
  t.after(() => client.close());
  client.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({
      username: "admin",
      characterId: 41,
      characterName: "PunchingBag",
      character: characterDataOf(stats, startingCharacterItems()),
    }),
  });

  // The entry burst (`0x16`, the mobs, the NPCs) first, so every drain below is about a report.
  const entering = await client.drain();
  assert.equal(entering[0]![0], FIELD_OPCODE.setField);

  /** What `sub_55B870` puts on the wire, minus the opcode byte the client adds: both fields, always. */
  const report = (hpDelta: number, mpDelta: number): void => {
    client.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.statReport,
      body: encodeClientStatReport({ hpDelta, mpDelta, flag: 0 }).slice(1),
    });
  };
  /**
   * The `0x0D`s among `packets`. A live field is never quiet - the mobs keep sending `0x33` - so the
   * claim this test can make is "exactly these stat diffs arrived", not "only one packet arrived".
   */
  const statDiffs = (packets: Uint8Array[]): Record<string, number>[] =>
    packets
      .filter((bytes) => bytes[0] === STAT_OPCODE)
      .map((bytes) => readStatUpdate(new PacketReader(bytes, 1)).diff);

  // A monster's hit: the client rolled it, the server only hears "-30".
  report(-30, 0);
  assert.deepEqual(statDiffs(await client.drain()), [{ hp: 20 }]);
  assert.ok(
    log.some((line) =>
      line.includes('"PunchingBag" 0x1c stat report: hpDelta=-30 mpDelta=0 flag=0 - hp 20/50'),
    ),
    log.join("\n"),
  );

  // One hit more than the HP that is left: it lands on 0 and never below it.
  report(-30, 0);
  assert.deepEqual(statDiffs(await client.drain()), [{ hp: 0 }]);

  // The map's own regeneration tick while dead (`sub_558950`): MP lands, HP does not - the revive
  // is what refills HP, so a corpse is not walked back up 10 HP at a time.
  report(10, 3);
  assert.deepEqual(statDiffs(await client.drain()), [{ mp: 8 }]);
  report(10, 0);
  assert.deepEqual(statDiffs(await client.drain()), [], "a report that changes nothing is not answered");

  // The revive (ADR-020) closes the loop: HP is full again, and MP is left where it was - the
  // original's death mechanic is HP, and nothing here invents an MP refill.
  client.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.interact,
    body: encodeClientInteract({ kind: INTERACT_KIND_REVIVE, name: "" }).slice(1),
  });
  const release = await client.take(1);
  assert.equal(release[0]![0], FIELD_OPCODE.requestRelease);
  const revived = readSetField(new PacketReader((await client.take(1))[0]!, 1));
  assert.equal(revived.character.stats.hp, 50, "the revive refills the HP that was reported away");
  assert.equal(revived.character.stats.mp, 8, "and leaves the MP alone");
  assert.equal(revived.character.stats.mapId, 1010000, "still the map info/returnMap names");
});

/**
 * Chat (FINDINGS 4.26): the client's `0x12` is relayed to the map as `0x1A` + sub-op `0x12` + the
 * speaker's name + the same bytes.
 *
 * The two things worth a test are the two that a "reasonable" implementation gets wrong:
 *
 *  - **the speaker is included**. `sub_470C70` only builds and sends the packet - there is no local
 *    echo anywhere in the chat input path - and the `"%s>> %s"` renderer lives on the receiving side
 *    (`sub_472910` case 0x12). Skipping the sender would leave players unable to read their own words.
 *  - **it does not leave the map**. Chat is the field's (`CField`'s own opcode 0x1A), so a player in
 *    another map is not a listener, and the text is passed through as bytes - the server never has to
 *    decode what it is relaying.
 */
test("chat reaches everyone in the map, the speaker included, and stays in it", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // A third player, in the *other* map: the same server, a different field.
  const guest = await FakeClient.connect(gameInfo.port);
  t.after(() => guest.close());
  const record = characterDataOf(
    { ...zeroStats(), id: 9, name: "Guest", mapId: 2000000, level: 1, hp: 50, maxHp: 50, mp: 50, maxMp: 50 },
    startingCharacterItems(),
  );
  guest.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 9, characterName: "Guest", character: record }),
  });
  await guest.takeOpcode(FIELD_OPCODE.setField);

  // Hero says hello, in the CP949 bytes the chat box produced.
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.chat,
    body: encodeClientChat({ text: encodeCp949("안녕") }).slice(1),
  });
  const altSaw = await alt.takeOpcode(FIELD_OPCODE.userMessage);
  const heard = readUserChat(new PacketReader(altSaw[altSaw.length - 1]!, 1));
  assert.deepEqual(
    [heard.name, toHex(heard.text)],
    ["Hero", "bec8b3e7"],
    "the other player hears the speaker's name and the bytes they typed",
  );
  const heroSaw = await hero.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(
    readUserChat(new PacketReader(heroSaw[heroSaw.length - 1]!, 1)),
    heard,
    "and so does the speaker - the client only ever renders what it receives",
  );

  // A second line from the other player: the name is the session's, so it changes with the speaker.
  alt.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.chat,
    body: encodeClientChat({ text: Uint8Array.from([0x68, 0x69]) }).slice(1),
  });
  const heroSawAlt = await hero.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(
    [
      readUserChat(new PacketReader(heroSawAlt[heroSawAlt.length - 1]!, 1)).name,
      toHex(readUserChat(new PacketReader(heroSawAlt[heroSawAlt.length - 1]!, 1)).text),
    ],
    ["Alt", "6869"],
    "the same opcode, the other speaker",
  );

  // The map 2000000 player: a field of their own, so the line is not theirs to hear.
  assert.equal(
    (await guest.drainOpcodes()).includes(FIELD_OPCODE.userMessage),
    false,
    "chat does not leave the map it was said in",
  );
  assert.equal(hero.headersOk && alt.headersOk && guest.headersOk, true, "every packet survives the cipher/header check");
  assert.ok(log.some((line) => line.includes('chat "Hero": 안녕 in map 1000000')), log.join("\n"));
  assert.ok(log.some((line) => line.includes('chat "Alt": hi in map 1000000')), log.join("\n"));
});

/**
 * A level-up is the field's news too (FINDINGS 4.27): `0x29` is `u32 characterId` + `u8 effect`, and
 * effect 0 is `Effect/BasicEff.img/LevelUp` played **over that user**.
 *
 * Which half each packet covers is the point of this test:
 *
 *  - the player who levelled gets the `0x0D` diff, and their own client plays the animation from the
 *    level it sees in it (`sub_55BEB0`'s tail) - so the field's effect goes to the **others**, and
 *    sending it back would play the same animation twice;
 *  - everybody else sees the hit, the death and then the effect, all inside one synchronous handler
 *    (nothing from the mob tick can slip in between).
 */
test("a level-up plays the effect for the other players (0x29), not for the one who levelled", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 20, speedPercent: 0, dieMs: 0 }),
    mobTickMs: 20,
    mobRespawnMs: 60_000,
    // No loot, so the only packets after the death are the effect and the attacker's own diff.
    dropPolicy: () => [],
    handshake: { clientSendSeed: 0x2b2b2b2b, clientRecvSeed: 0x3c3c3c3c },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const stats = zeroStats();
  stats.id = 7;
  stats.name = "Hero";
  stats.level = 1;
  stats.exp = 0;
  stats.hp = 20;
  stats.maxHp = 50;
  stats.mp = 5;
  stats.maxMp = 50;

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({
      username: "admin",
      characterId: 7,
      characterName: "Hero",
      character: characterDataOf(stats, startingCharacterItems()),
    }),
  });
  await hero.take(4); // 0x16 + the two mobs + the NPC

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  const altSaw = await alt.takeOpcode(FIELD_OPCODE.userEffect);
  assert.deepEqual(
    altSaw.map((bytes) => bytes[0]),
    [FIELD_OPCODE.userAttack, MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, FIELD_OPCODE.userEffect],
    "the field sees the swing, the hit, the death, and then the level-up effect",
  );
  assert.equal(readUserAttack(new PacketReader(altSaw[0]!, 1)).targets[0]!.mobId, 1);
  assert.deepEqual(readUserEffect(new PacketReader(altSaw[3]!, 1)), {
    characterId: 7,
    effect: USER_EFFECT_LEVEL_UP,
  });

  // The attacker: their own 0x0D (level 2, and the refill that comes with it), and no 0x29.
  const heroSaw = await hero.takeOpcode(STAT_OPCODE);
  assert.deepEqual(readStatUpdate(new PacketReader(heroSaw[heroSaw.length - 1]!, 1)), {
    ack: false,
    diff: { exp: 5, level: 2, hp: 50, mp: 50 },
  });
  const effectsForHero = (await hero.drain()).filter((bytes) => bytes[0] === FIELD_OPCODE.userEffect);
  assert.deepEqual(effectsForHero, [], "the effect is not echoed to the player who levelled");
  assert.ok(
    log.some((line) => line.includes('0x29 level-up effect for "Hero" sent to 1 other player(s)')),
    log.join("\n"),
  );
});

test("an emotion (0x13) reaches the rest of the field as 0x27 and is not echoed", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    // Nothing else may arrive: the claim is about the emotion and the quiet that follows it.
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x1a1a1a1a, clientRecvSeed: 0x2b2b2b2b },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  const heroStats = { ...zeroStats(), id: 61, name: "Hero", level: 1, hp: 50, maxHp: 50 };
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({
      username: "admin",
      characterId: 61,
      characterName: "Hero",
      character: characterDataOf(heroStats, startingCharacterItems()),
    }),
  });
  await hero.drain();

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 62, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // What `F3` sends: `[0x13][u32 3]` - and nothing else, because the client has already put the
  // face on itself (`CUser::SetFace` runs before the packet is built).
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.emotion,
    body: encodeClientEmotion({ emotion: 3 }).slice(1),
  });

  const seen = await alt.takeOpcode(FIELD_OPCODE.userEmotion);
  assert.equal(seen[seen.length - 1]![0], FIELD_OPCODE.userEmotion);
  assert.deepEqual(readUserEmotion(new PacketReader(seen[seen.length - 1]!, 1)), {
    characterId: 61,
    emotion: 3,
  });
  assert.deepEqual(await hero.drain(), [], "the sender gets nothing back: the face is already on");
  assert.ok(
    log.some((line) => line.includes("0x27 emotion 3 (troubled)") && line.includes("1 other player(s)")),
    log.join("\n"),
  );

  // Something that is not a face: the client's own setter refuses `n8 > 8` and the drawer clamps to
  // 0, so this cannot come from the client - it is dropped, and nobody hears about it.
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.emotion,
    body: Uint8Array.from([0x09, 0x00, 0x00, 0x00]),
  });
  assert.deepEqual(await alt.drainOpcodes(200), []);
  assert.deepEqual(await hero.drainOpcodes(200), []);
  assert.ok(log.some((line) => line.includes("0x13 emotion unreadable") && line.includes("not a face")), log.join("\n"));
});

/**
 * A session that ends writes the character back to the save.
 *
 * The point of a save is not the file: it is that what happened in a field is still there tomorrow.
 * Exp, level, hp and the items all change *in place* on the `CharacterData` the login server handed
 * over - the same object the account table holds - so "persist when the session ends" is the whole
 * save. This test walks the loop an operator would: a character enters, kills the mob, disconnects,
 * and what comes out of the store is the record the client was last told about in `0x0D`.
 */
test("a session that ends leaves the character's progress in the save", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const store = new MemorySaveStore();
  let saves = 0;
  // The table *is* the world: the record the game server is handed is the one in here, which is what
  // `LoginServerOptions.accounts` means and what the CLI's `persist` closure saves.
  const accounts = new Map<string, AccountRecord>([["admin", { password: "admin", characters: [] }]]);
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 20, speedPercent: 0, dieMs: 0 }),
    mobTickMs: 20,
    mobRespawnMs: 60_000,
    dropPolicy: () => [],
    handshake: { clientSendSeed: 0x0badc0de, clientRecvSeed: 0x0feedbac },
    persist: () => {
      saves += 1;
      store.save(accounts);
    },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const stats = zeroStats();
  stats.id = 21;
  stats.name = "Fighter";
  stats.level = 1;
  stats.exp = 10;
  stats.hp = 20;
  stats.maxHp = 50;
  stats.mp = 5;
  stats.maxMp = 30;
  stats.mesos = 500;
  const record = characterDataOf(stats, startingCharacterItems());
  accounts.get("admin")!.characters.push(record);

  const client = await FakeClient.connect(gameInfo.port);
  const characterId = handoffs.issue({
    username: "admin",
    characterId: 21,
    characterName: "Fighter",
    character: record,
  });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
  await client.take(4); // 0x16 + the two mobs + the NPC
  t.after(() => client.close());

  const attack = encodeClientAttack(
    {
      hits: 1,
      targetCount: 1,
      skillId: 1,
      facingLeft: false,
      action: 0,
      speed: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });
  await client.take(2); // the mob's stat + the corpse
  const stat = (await client.take(1))[0]!;
  const told = readStatUpdate(new PacketReader(stat, 1));
  assert.deepEqual(told.diff, { exp: 15, level: 2, hp: 50, mp: 30 }, "the 0x0D this test then persists");

  // The player leaves. That is the only moment this test has to wait for: the save happens on the
  // server's `close` event, which is not synchronous with the client's.
  assert.equal(saves, 0, "nothing is saved while the session is still open");
  client.close();
  const deadline = Date.now() + 2000;
  while (saves === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(saves, 1, `the session ending saved once; log:\n${log.join("\n")}`);

  // What the store holds is the character as they left: the level-up, the refill that came with it,
  // and the rest of the record untouched.
  const saved = loadAccounts(store, new Map()).get("admin")!.characters[0]!;
  assert.equal(saved.stats.name, "Fighter");
  assert.equal(saved.stats.id, 21);
  assert.equal(saved.stats.level, 2);
  assert.equal(saved.stats.exp, 15);
  assert.equal(saved.stats.hp, 50);
  assert.equal(saved.stats.mp, 30);
  assert.equal(saved.stats.mesos, 500);
  assert.equal(saved.items?.inventories.length, 4, "the bags came back too");
});

/**
 * The whole reason a save exists: the next run of the server is the same world.
 *
 * Two login servers in one test, one store: the first run creates a character over a real socket
 * (0x04 -> 0x01 -> 0x02 -> 0x06 -> 0x05), and the second one - a fresh `LoginServer` over the same
 * store, seeded with a *different* password for the same user - sees that character in the 0x02
 * character list. The seed losing is the point: the save file is the world, and `--account` is only
 * what a first run starts from.
 */
test("the world comes back after a restart: the save file is the accounts", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const store = new MemorySaveStore();
  const startLogin = async (accounts: Map<string, AccountRecord>) => {
    const server = new LoginServer({
      accounts,
      worlds: [{ name: "Scania", unknownId: 0 }],
      gameServer: { ip: "127.0.0.1", port: 8585 },
      handoffs: new HandoffRegistry(),
      persist: () => store.save(accounts),
      handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
      log: (line) => log.push(line),
    });
    const info = await server.listen(0);
    return { server, port: info.port };
  };

  // Run one: no save yet, so the --account seed is the world.
  const seed = new Map<string, AccountRecord>([["admin", { password: "admin", characters: [] }]]);
  const first = await startLogin(loadAccounts(store, seed, (line) => log.push(line)));
  t.after(async () => {
    await first.server.close();
  });

  const create = await FakeClient.connect(first.port);
  t.after(() => create.close());
  create.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  create.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  await create.take(1);
  create.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
  await create.take(1);
  create.send({ kind: "check-name", opcode: 0x06, name: "Hero", appearance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  await create.take(1);
  create.send({ kind: "create-character", opcode: 0x05, name: "Hero" });
  const createdReply = (await create.take(1))[0]!;
  const createdReader = new PacketReader(createdReply);
  createdReader.readByte();
  assert.equal(createdReader.readByte(), CREATE_CHARACTER_RESULT.created);
  const hero = readCharacterData(createdReader);
  assert.equal(hero.stats.name, "Hero");
  create.close();
  await first.server.close();

  // Run two: the same store, and a seed whose password is *wrong* on purpose. If the seed won, the
  // login below would be refused.
  const reloaded = loadAccounts(store, new Map([["admin", { password: "not-the-password", characters: [] }]]), (line) =>
    log.push(line),
  );
  assert.deepEqual([...reloaded.keys()], ["admin"]);
  assert.equal(reloaded.get("admin")!.characters.length, 1);
  const second = await startLogin(reloaded);
  t.after(async () => {
    await second.server.close();
  });

  const back = await FakeClient.connect(second.port);
  t.after(() => back.close());
  back.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  back.send({ kind: "login-request", opcode: 0x01, username: "admin", password: "admin" });
  const loginReply = parseLoginReply((await back.take(1))[0]!);
  assert.equal(loginReply.result, LOGIN_RESULT.ok, "the saved password is the one that works");
  back.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
  const worldReply = (await back.take(1))[0]!;
  const reader = new PacketReader(worldReply);
  assert.equal(reader.readByte(), LOGIN_OPCODE.worldSelect);
  assert.equal(reader.readByte(), LOGIN_RESULT.ok);
  assert.equal(reader.readByte(), 1, "the character survived the restart");
  const sameHero = readCharacterData(reader);
  assert.equal(sameHero.stats.name, "Hero");
  assert.equal(sameHero.stats.id, hero.stats.id, "and it is the same character, not a new one");
  assert.equal(sameHero.items?.inventories.length, 4);
  assert.equal(reader.exhausted, true);
  assert.ok(
    log.some((line) => line.includes("ignoring 1 --account entr(ies)")),
    `the seed losing is worth a line:\n${log.join("\n")}`,
  );
});

/**
 * Whisper and find (FINDINGS 4.31): the client's `0x23` names **one** user, and the answers are two
 * of `0x1A`'s four sub-ops.
 *
 * What makes this different from every other field packet is the target: it is looked up by *name*
 * (the packet has no character id), and the player found may be in another map - this is the first
 * packet in this server that leaves the field it was sent in. The receiver's line is the *chat*
 * packet (0x1A sub-op 0x12, same name + text), while the sender gets 0x1A sub-op 0x0A, which carries
 * the target's name and one flag and nothing else: their client prints "name<< text" from the text it
 * kept locally (`sub_4717D0` stores it at `CField+28`).
 */
test("whisper and find reach a player by name, across maps, and answer the asker", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // A third player in the *other* map: still reachable, because a whisper is about a character, not
  // about a field.
  const guest = await FakeClient.connect(gameInfo.port);
  t.after(() => guest.close());
  const record = characterDataOf(
    { ...zeroStats(), id: 9, name: "Guest", mapId: 2000000, level: 1, hp: 50, maxHp: 50, mp: 50, maxMp: 50 },
    startingCharacterItems(),
  );
  guest.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 9, characterName: "Guest", character: record }),
  });
  await guest.takeOpcode(FIELD_OPCODE.setField);

  // Hero whispers Guest, who is in the other map. The text is CP949 bytes, exactly as typed.
  const sendWhisper = (name: string, text: string) =>
    encodeClientUserRequest({ kind: USER_REQUEST_KIND.whisper, name, text: encodeCp949(text) }).slice(1);
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.userRequest,
    body: sendWhisper("guest", "안녕"),
  });
  const guestSaw = await guest.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(
    [
      readUserChat(new PacketReader(guestSaw[guestSaw.length - 1]!, 1)).name,
      toHex(readUserChat(new PacketReader(guestSaw[guestSaw.length - 1]!, 1)).text),
    ],
    ["Hero", toHex(encodeCp949("안녕"))],
    "the receiver's line is the chat packet, with the sender's own name in front of it",
  );
  const heroSaw = await hero.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(
    readUserWhisperAnswer(new PacketReader(heroSaw[heroSaw.length - 1]!, 1)),
    { name: "Guest", delivered: true },
    "and the asker gets the target's **stored** name - typed as \"guest\", answered as \"Guest\"",
  );
  assert.equal(
    (await alt.drainOpcodes()).filter((opcode) => opcode === FIELD_OPCODE.userMessage).length,
    0,
    "the player in the sender's own map hears nothing: this one is addressed",
  );

  // A name nobody is playing: the same field packet, flag 0 - the client prints "'name'님을 찾지
  // 못했습니다" for it, which is the only failure this answer has.
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.userRequest,
    body: encodeClientUserRequest({ kind: USER_REQUEST_KIND.whisper, name: "Nobody", text: Uint8Array.from([0x68]) }).slice(1),
  });
  const notFound = await hero.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(
    readUserWhisperAnswer(new PacketReader(notFound[notFound.length - 1]!, 1)),
    { name: "Nobody", delivered: false },
  );

  // A find is the other kind: no text, and the answer names the *map*, which the client turns into
  // "street:map" out of its own data. Alt is online, so the id is real...
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.userRequest,
    body: encodeClientUserRequest({ kind: USER_REQUEST_KIND.find, name: "Alt" }).slice(1),
  });
  const whereIsAlt = await hero.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(readUserFindAnswer(new PacketReader(whereIsAlt[whereIsAlt.length - 1]!, 1)), {
    name: "Alt",
    mapId: 1000000,
  });
  // ... and an offline name is `0xFFFFFFFF`, the id the client never loads.
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.userRequest,
    body: encodeClientUserRequest({ kind: USER_REQUEST_KIND.find, name: "Nobody" }).slice(1),
  });
  const nowhere = await hero.takeOpcode(FIELD_OPCODE.userMessage);
  assert.deepEqual(readUserFindAnswer(new PacketReader(nowhere[nowhere.length - 1]!, 1)), {
    name: "Nobody",
    mapId: -1,
  });

  // The client's balloon request (`0x20 | 2`) is read and logged, and answered with nothing: which
  // packet draws a balloon is not located (FINDINGS 4.31, §6).
  hero.send({
    kind: "unknown",
    opcode: CLIENT_FIELD_OPCODE.userRequest,
    body: encodeClientUserRequest({
      kind: USER_REQUEST_KIND.balloon,
      name: "Hero",
      text: Uint8Array.from([0x68, 0x69]),
    }).slice(1),
  });
  await eventually(() => log.some((line) => line.includes('0x23 balloon "Hero": hi')));
  assert.equal(
    (await hero.drainOpcodes()).filter((opcode) => opcode === FIELD_OPCODE.userMessage).length,
    0,
    "a balloon request is not answered",
  );

  assert.equal(hero.headersOk && alt.headersOk && guest.headersOk, true, "every packet survives the cipher/header check");
  assert.ok(log.some((line) => line.includes('whisper "Hero" -> "Guest": 안녕')), log.join("\n"));
  assert.ok(log.some((line) => line.includes('find "Alt" -> "Alt" in map 1000000')), log.join("\n"));
  assert.ok(log.some((line) => line.includes('whisper "Hero" -> "Nobody": no such player')), log.join("\n"));
});

test("using a USE-tab item: 0x18 restores and consumes it, 0x19 changes the map", { skip: archive === null, timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) =>
      mapId === 1000000 ? STUB_MAP : mapId === 1010000 ? STUB_MAP_TOWN : undefined,
    shops: shopKeeper(archive!),
    // What an item does is the client's own data: 빨간 포션 `spec/hp = 50`, 마을 귀환 주문서
    // `spec/moveTo = -1`. Nothing about the effects lives in the handler.
    consumeSpec: consumeSpecProvider(archive!),
    // No patrol packets in this test: the mobs are still, so every burst below is exactly the use's
    // own answer and the order stays readable.
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x55aa55aa, clientRecvSeed: 0xaa55aa55 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const stats = zeroStats();
  stats.id = 51;
  stats.name = "Drinker";
  stats.level = 1;
  stats.hp = 20;
  stats.maxHp = 50;
  stats.mp = 5;
  stats.maxMp = 30;
  stats.mesos = 200;

  const client = await FakeClient.connect(gameInfo.port);
  t.after(() => client.close());
  client.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({
      username: "admin",
      characterId: 51,
      characterName: "Drinker",
      character: characterDataOf(stats, startingCharacterItems()),
    }),
  });
  await client.drain();

  // The shop on STUB_MAP's NPC (로빈, 2003), priced out of the real archive.
  client.send({
    kind: "unknown",
    opcode: CLIENT_OBJECT_CLICK_OPCODE,
    body: encodeClientObjectClick({ objectId: 1 }).slice(1),
  });
  const opened = await client.take(2);
  assert.equal(opened[1]![0], SHOP_OPEN_OPCODE);
  assert.deepEqual(
    readShopOpen(new PacketReader(opened[1]!, 1)).items.map((line) => [line.itemId, line.price]),
    [
      [2000000, 25], // 빨간 포션, Item/Consume/0200.img/02000000/info/price
      [2000003, 100], // 파란 포션
      [2030000, 75], // 마을 귀환 주문서, Item/Consume/0203.img/02030000/info/price
    ],
  );

  const buy = async (row: number, itemId: number): Promise<number> => {
    client.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "buy", row, itemId, count: 1 }).slice(1),
    });
    const trade = await client.take(3);
    assert.deepEqual(
      trade.map((bytes) => bytes[0]),
      [SHOP_RESULT_OPCODE, INVENTORY_OPCODE, STAT_OPCODE],
      "the result, the inventory change and the mesos",
    );
    const change = readInventoryChange(new PacketReader(trade[1]!, 1)).changes[0]!;
    assert.equal(change.op, INVENTORY_OP.put);
    return change.slot;
  };
  const potionSlot = await buy(0, 2000000);
  assert.equal(await buy(0, 2000000), potionSlot, "the second potion stacks into the same slot");
  const scrollSlot = await buy(2, 2030000);
  assert.notEqual(scrollSlot, potionSlot);

  /** What `sub_55B2C0` / `sub_55B4B0` send: two fields, and the item id is what picked the opcode. */
  const use = (slot: number, itemId: number, opcode: number): void => {
    client.send({
      kind: "unknown",
      opcode,
      body: encodeClientUseItem({ slot, itemId }, opcode).slice(1),
    });
  };
  /** The client's own `0x1C` report: a monster hit, rolled locally (`sub_5114A0`). */
  const hit = (damage: number): void => {
    client.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.statReport,
      body: encodeClientStatReport({ hpDelta: -damage, mpDelta: 0, flag: 0 }).slice(1),
    });
  };

  // One potion: the slot keeps the second one, and the HP comes from the archive's own `spec/hp` -
  // 20 + 50 is clamped to the maximum, which is `game/vitals.ts`'s rule and not the file's.
  use(potionSlot, 2000000, CLIENT_FIELD_OPCODE.useItem);
  const drank = await client.take(2);
  assert.deepEqual(drank.map((bytes) => bytes[0]), [INVENTORY_OPCODE, STAT_OPCODE]);
  const left = readInventoryChange(new PacketReader(drank[0]!, 1)).changes[0]!;
  assert.equal(left.op, INVENTORY_OP.put, "one potion is left in the slot");
  assert.ok(
    left.op === INVENTORY_OP.put && left.item.kind === "nonequip" && left.item.quantity === 1,
    "the slot now holds one",
  );
  assert.deepEqual(readStatUpdate(new PacketReader(drank[1]!, 1)).diff, { hp: 50 });

  // The same use at a full bar: nothing would move, so the potion has to stay in the bag - and the
  // answer is still a packet (an *empty* 0x0B), because the client's use gate waits for one.
  use(potionSlot, 2000000, CLIENT_FIELD_OPCODE.useItem);
  const refused = await client.take(1);
  const refusal = readInventoryChange(new PacketReader(refused[0]!, 1));
  assert.equal(refusal.changes.length, 0, "an empty change list is the refusal");
  assert.equal(refusal.result, 1, "and its result byte still re-arms the client's gate");
  assert.equal((await client.drainOpcodes(120)).length, 0, "nothing else follows it");

  // A monster hit lands first (`0x1C` -> `0x0D`), because that is the state a potion is drunk in.
  hit(30);
  assert.deepEqual(readStatUpdate(new PacketReader((await client.take(1))[0]!, 1)).diff, { hp: 20 });

  // The last potion: the stack empties, so the change is a `clear`.
  use(potionSlot, 2000000, CLIENT_FIELD_OPCODE.useItem);
  const emptied = await client.take(2);
  assert.equal(readInventoryChange(new PacketReader(emptied[0]!, 1)).changes[0]!.op, INVENTORY_OP.clear);
  assert.deepEqual(readStatUpdate(new PacketReader(emptied[1]!, 1)).diff, { hp: 50 });

  // Now the slot is empty and the bar is not full: the packet claims an item the server's own
  // inventory does not have, and the server - not the packet - is what decides.
  hit(30);
  await client.take(1);
  use(potionSlot, 2000000, CLIENT_FIELD_OPCODE.useItem);
  assert.equal(readInventoryChange(new PacketReader((await client.take(1))[0]!, 1)).changes.length, 0);
  assert.ok(
    log.some((line) => line.includes(`slot ${potionSlot} of the USE tab does not hold item 2000000`)),
    log.join("\n"),
  );

  // The scroll: 마을 귀환 주문서's own `spec/moveTo = -1` is read with the map's `info/returnMap`
  // (STUB_MAP says 1010000), and the map change is the same `0x16` a portal sends.
  use(scrollSlot, 2030000, CLIENT_FIELD_OPCODE.useMapItem);
  const jumped = await client.take(2);
  assert.deepEqual(jumped.map((bytes) => bytes[0]), [INVENTORY_OPCODE, FIELD_OPCODE.setField]);
  assert.equal(
    readInventoryChange(new PacketReader(jumped[0]!, 1)).changes[0]!.op,
    INVENTORY_OP.clear,
    "a scroll is used up",
  );
  const entered = readSetField(new PacketReader(jumped[1]!, 1));
  assert.equal(entered.character.stats.mapId, 1010000, "the ground under the player changed");
  assert.ok(log.some((line) => line.includes("0x19 map item") && line.includes("map 1000000 -> 1010000 (moveTo -1)")), log.join("\n"));

  // The slot is empty again, and this time the item cannot even name a map: the refusal comes before
  // anything is taken (the town's own `returnMap` here is a map no provider knows).
  use(scrollSlot, 2030000, CLIENT_FIELD_OPCODE.useMapItem);
  assert.equal(readInventoryChange(new PacketReader((await client.take(1))[0]!, 1)).changes.length, 0);
  assert.deepEqual(await client.drainOpcodes(120), [], "no second 0x16");
});

/**
 * The inventory window's drag, over real sockets (FINDINGS 4.36, ADR-029).
 *
 * The client moves nothing itself (`sub_55ACB0` only builds the packet and arms a one-request gate), so
 * the window follows the server's `0x0B` and only that - which is why both halves matter here: the `put`
 * at the **negative slot** of the equip tab, which is what wears the cap, and the `0x28` the rest of the
 * map gets so that everybody's copy of this player's look changes. The wearer is not sent their own
 * `0x28`: their client draws them from the record it holds.
 */
test("equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    dropPolicy: () => [],
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x11223344, clientRecvSeed: 0x44332211 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  // A record the create dialog could have produced - face, hair and the four clothes it wears - plus one
  // more cap that is *not* worn: it sits in the equip tab's second slot, which is what gets dragged.
  const heroItems = withWorn(startingCharacterItems(), wornOfLook([20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 7]));
  heroItems.inventories[INVENTORY_TAB.equip - 1]!.items.set(2, equipSlot(1002000));
  const heroRecord = characterDataOf({ ...zeroStats(), id: 7, name: "Hero" }, heroItems);
  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero", character: heroRecord }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
  });
  const altBurst = await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  const aboutHero = readUserEnterField(new PacketReader(altBurst[altBurst.length - 1]!, 1));
  assert.equal(aboutHero.avatarItems?.includes(1002000), false, "the cap is in the bag, not on the head");
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // Double-clicking the cap: `sub_4636B0` sends tab 1, the bag slot, the part its caller read off the
  // item id (1002000 -> a hat -> part 1, written the way a worn slot is: negative) and -1 for "all of it".
  const equip = encodeClientChangeSlot({ tab: 1, fromSlot: 2, toSlot: -1, count: -1 });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: equip.slice(1) });

  const answer = await hero.takeOpcode(INVENTORY_OPCODE);
  const change = readInventoryChange(new PacketReader(answer[answer.length - 1]!, 1));
  assert.deepEqual(
    change.changes.map((entry) => [entry.op, entry.slot]),
    [
      [INVENTORY_OP.put, -1],
      [INVENTORY_OP.clear, 2],
    ],
    "the cap is put at the worn part and the bag slot is cleared",
  );
  assert.equal(
    change.changes[0]!.op === INVENTORY_OP.put ? change.changes[0]!.item.itemId : 0,
    1002000,
    "the put carries the item that moved",
  );
  assert.equal(change.result, 1, "the result byte is the client's own timing flag, not a status");

  // Everybody else: one `0x28` with the new list and no face (flags 0 means \"the head did not change\"),
  // and the wearer gets none - their client already drew it.
  const lookPacket = await alt.takeOpcode(FIELD_OPCODE.userLook);
  const look = readUserLook(new PacketReader(lookPacket[lookPacket.length - 1]!, 1));
  assert.deepEqual(
    [look.characterId, look.face, look.avatarItems],
    [7, undefined, [30000, 1040001, 1060001, 1071000, 1302000, 1002000]],
    "the list is the avatarItems a 0x1C would have carried",
  );
  assert.deepEqual(
    (await hero.drainOpcodes(200)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
    [],
    "the wearer is not echoed their own look",
  );

  // The record itself moved (this is the object the account table holds, ADR-017): the worn part is the
  // cap now, and the bag slot it came from is empty.
  assert.equal(heroRecord.items!.worn.get(1)?.itemId, 1002000);
  assert.equal(heroRecord.items!.inventories[INVENTORY_TAB.equip - 1]!.items.has(2), false);

  // The same drag again, now that slot 2 is empty: nothing moves, and the answer is still a `0x0B` -
  // an empty one. `sub_55ACB0` armed the client's one-request gate as it sent, and only a `0x0B` clears
  // it, so a refusal that stayed silent would freeze the whole window (FINDINGS 4.6).
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: equip.slice(1) });
  const refused = await hero.takeOpcode(INVENTORY_OPCODE);
  assert.deepEqual(readInventoryChange(new PacketReader(refused[refused.length - 1]!, 1)).changes, []);
  assert.ok(log.some((line) => line.includes("refused (emptySlot)")), log.join("\n"));
  assert.deepEqual(
    (await alt.drainOpcodes(150)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
    [],
    "and a refused drag tells the map nothing",
  );
});

/**
 * Throwing something away: the same `0x17` with `toSlot = 0` (`sub_463BE0`), and the field's own `0x43`.
 *
 * Two packets have to come back for one throw: the `0x0B` that takes the item out of the window (the
 * client never moved it itself) and the `0x43` that puts it on the ground - for the thrower as much as
 * for the rest of the map, because their own client has never drawn the item anywhere but the slot.
 * What picks it back up is walking onto it, and only after a move: the drop landed *after* this player
 * last moved, so standing on it is not enough (`DropField.reachable`, FINDINGS 4.18.6).
 */
test("a throw-away answers 0x0B and puts the item on the ground for the whole map", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTemplate: () => ({ templateId: 120100, name: "stub", level: 1, maxHP: 10, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 40 }),
    dropPolicy: () => [],
    // The field's own tick, which is what takes a drop a player is standing on.
    mobTickMs: 20,
    handshake: { clientSendSeed: 0x01020304, clientRecvSeed: 0x04030201 },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  // Ten potions in the USE tab: enough to throw some away and keep the rest.
  const heroItems = startingCharacterItems();
  heroItems.inventories[INVENTORY_TAB.consume - 1]!.items.set(4, nonEquipSlot(2000000, 10));
  const heroRecord = characterDataOf({ ...zeroStats(), id: 9, name: "Hero" }, heroItems);
  const hero = await FakeClient.connect(gameInfo.port);
  t.after(() => hero.close());
  hero.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 9, characterName: "Hero", character: heroRecord }),
  });
  await hero.take(4);

  const alt = await FakeClient.connect(gameInfo.port);
  t.after(() => alt.close());
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 10, characterName: "Alt" }),
  });
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);

  // Four of the ten, dragged onto the ground: the tab, the slot, `toSlot = 0` and the number the player
  // answered to the "how many" prompt.
  const throwAway = encodeClientChangeSlot({ tab: INVENTORY_TAB.consume, fromSlot: 4, toSlot: 0, count: 4 });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: throwAway.slice(1) });

  // The thrower's window first: the slot holds six now, and that is the whole `0x0B`.
  const answer = await hero.takeOpcode(INVENTORY_OPCODE);
  assert.deepEqual(readInventoryChange(new PacketReader(answer[answer.length - 1]!, 1)).changes, [
    {
      op: INVENTORY_OP.put,
      inventory: INVENTORY_TAB.consume,
      slot: 4,
      item: { kind: "nonequip", itemId: 2000000, cash: null, quantity: 6 },
    },
  ]);

  // Then the ground, to the thrower and to the map: `kind 2` is the only shape without a monster block.
  const heroDrop = await hero.takeOpcode(DROP_OPCODE.appear);
  const onGround = readDropAppear(new PacketReader(heroDrop[heroDrop.length - 1]!, 1));
  assert.equal(heroDrop[heroDrop.length - 1]!.length, 15, "kind 2 is opcode + 14 bytes (FINDINGS 4.18.2)");
  assert.deepEqual(
    [onGround.kind, onGround.money, onGround.value, onGround.mobId],
    [DROP_KIND.placed, false, 2000000, undefined],
    "the item, no mesos, and no monster",
  );
  const altDrop = await alt.takeOpcode(DROP_OPCODE.appear);
  assert.equal(readDropAppear(new PacketReader(altDrop[altDrop.length - 1]!, 1)).dropId, onGround.dropId);
  assert.ok(log.some((line) => line.includes("dropped item 2000000 x4")), log.join("\n"));

  /** Walks the character onto a spot: the first element of a CMovePath is where the server puts us. */
  const walkTo = (x: number, y: number): void => {
    const move = encodeClientUserMove({
      stageByte: 0,
      path: { originX: 0, originY: 0, elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }] },
    });
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.userMove, body: move.slice(1) });
  };

  // It is under the thrower's feet, and it stays there: the drop is younger than the last move, so not
  // even the tick that follows takes it (a throw-away must not come straight back).
  assert.deepEqual(
    (await hero.drainOpcodes(200)).filter((opcode) => opcode === DROP_OPCODE.remove),
    [],
    "standing on it is not a pickup",
  );
  // 80 px away is outside the 40 px reach; stepping back onto it is what takes it - with the count the
  // throw carried, which is only visible on the way back in.
  walkTo(onGround.x + 80, onGround.y);
  assert.deepEqual(
    (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.remove),
    [],
    "and neither is 80 px away",
  );
  walkTo(onGround.x, onGround.y);
  const taken = await hero.takeOpcode(DROP_OPCODE.remove);
  assert.deepEqual(readDropRemove(new PacketReader(taken[taken.length - 1]!, 1)), {
    dropId: onGround.dropId,
    kind: DROP_REMOVE_KIND.taken,
    characterId: 9,
  });
  const back = await hero.takeOpcode(INVENTORY_OPCODE);
  assert.deepEqual(readInventoryChange(new PacketReader(back[back.length - 1]!, 1)).changes, [
    {
      op: INVENTORY_OP.put,
      inventory: INVENTORY_TAB.consume,
      slot: 4,
      item: { kind: "nonequip", itemId: 2000000, cash: null, quantity: 10 },
    },
  ]);
  const notice = await hero.takeOpcode(LOOT_OPCODE);
  assert.deepEqual(readLootNotice(new PacketReader(notice[notice.length - 1]!, 1)), {
    kind: "item",
    itemId: 2000000,
    count: 4,
  });
  const altSaw = await alt.takeOpcode(DROP_OPCODE.remove);
  assert.equal(readDropRemove(new PacketReader(altSaw[altSaw.length - 1]!, 1)).characterId, 9);

  // A throw-away of zero is not something the client can send (`sub_463BE0` asks the stack size), and it
  // is refused the way every other impossible drag is: an empty `0x0B`, and nothing on the ground.
  const zero = encodeClientChangeSlot({ tab: INVENTORY_TAB.consume, fromSlot: 4, toSlot: 0, count: 0 });
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: zero.slice(1) });
  const nothing = await hero.takeOpcode(INVENTORY_OPCODE);
  assert.deepEqual(readInventoryChange(new PacketReader(nothing[nothing.length - 1]!, 1)).changes, []);
  assert.ok(log.some((line) => line.includes("refused (badCount)")), log.join("\n"));
  assert.deepEqual(
    (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.appear),
    [],
    "and the refused throw-away leaves the ground as it was",
  );
});
