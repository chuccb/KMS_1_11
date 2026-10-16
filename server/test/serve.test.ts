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
import { characterDataOf, readCharacterData, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import {
  CLIENT_FIELD_OPCODE,
  FIELD_OPCODE,
  INTERACT_KIND_CURSOR,
  USER_EFFECT_LEVEL_UP,
  encodeClientAttack,
  encodeClientChat,
  encodeClientInteract,
  encodeClientUserMove,
  readSetField,
  readUserChat,
  readUserEffect,
  readUserEnterField,
  readUserMove,
} from "../src/protocol/field.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { toHex } from "../src/protocol/frame.ts";
import {
  DROP_OPCODE,
  DROP_REMOVE_KIND,
  LOOT_OPCODE,
  readDropAppear,
  readDropRemove,
  readLootNotice,
} from "../src/protocol/drop.ts";
import { INVENTORY_OP, INVENTORY_OPCODE, readInventoryChange } from "../src/protocol/inventory.ts";
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
import { LOGIN_OPCODE, LOGIN_RESULT } from "../src/protocol/replies.ts";
import { GameEntryServer, HandoffRegistry, LoginServer, type AccountRecord } from "../src/net/loginserver.ts";

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
      clickedMobId: 1,
      facingLeft: false,
      action: 0,
      targetCap: 1,
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
      clickedMobId: 1,
      facingLeft: false,
      action: 0,
      targetCap: 1,
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
      clickedMobId: 1,
      facingLeft: false,
      action: 0,
      targetCap: 1,
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
      clickedMobId: 99,
      facingLeft: false,
      action: 0,
      targetCap: 1,
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
  alt.send({
    kind: "handshake-reply",
    opcode: 0x04,
    value: handoffs.issue({ username: "admin", characterId: 8, characterName: "Alt" }),
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

  const heroSaw = await hero.takeOpcode(FIELD_OPCODE.userEnterField);
  assert.deepEqual(heroSaw.map((bytes) => bytes[0]), [FIELD_OPCODE.userEnterField], "and the one who was there gets the newcomer");
  const aboutAlt = readUserEnterField(new PacketReader(heroSaw[0]!, 1));
  assert.deepEqual([aboutAlt.characterId, aboutAlt.name], [8, "Alt"]);
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
      clickedMobId: 1,
      facingLeft: false,
      action: 0,
      targetCap: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  const altSawKill = await alt.takeOpcode(DROP_OPCODE.appear);
  assert.deepEqual(
    altSawKill.map((bytes) => bytes[0]),
    [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, DROP_OPCODE.appear],
    "the other player sees the hit, the death and the loot, and nothing of the reward",
  );
  assert.equal(readDropAppear(new PacketReader(altSawKill[2]!, 1)).mobId, 1, "the loot flies out of the monster that died");

  const heroSawKill = await hero.takeOpcode(DROP_OPCODE.appear);
  assert.deepEqual(
    heroSawKill.map((bytes) => bytes[0]),
    [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, STAT_OPCODE, DROP_OPCODE.appear],
    "the attacker gets the same world packets plus their own exp",
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
      clickedMobId: 1,
      facingLeft: false,
      action: 0,
      targetCap: 1,
      targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
    },
    CLIENT_FIELD_OPCODE.attack,
  );
  hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

  const altSaw = await alt.takeOpcode(FIELD_OPCODE.userEffect);
  assert.deepEqual(
    altSaw.map((bytes) => bytes[0]),
    [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, FIELD_OPCODE.userEffect],
    "the field sees the hit, the death, and then the level-up effect",
  );
  assert.deepEqual(readUserEffect(new PacketReader(altSaw[2]!, 1)), {
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
