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
import { readCharacterData } from "../src/protocol/chardata.ts";
import {
  CLIENT_FIELD_OPCODE,
  FIELD_OPCODE,
  encodeClientAttack,
  encodeClientUserMove,
  readSetField,
} from "../src/protocol/field.ts";
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
import { NPC_OPCODE, readNpcEnterField } from "../src/protocol/npc.ts";
import type { MapData } from "../src/game/map.ts";
import { LOGIN_OPCODE, LOGIN_RESULT } from "../src/protocol/replies.ts";
import { GameEntryServer, HandoffRegistry, LoginServer, type AccountRecord } from "../src/net/loginserver.ts";

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
  portals: [{ name: "sp", type: 0, x: 100, y: 200, toMapId: 0, toName: "" }],
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
  await new Promise((resolve) => setTimeout(resolve, 50));
  const rest = await client.take(0);
  assert.deepEqual(
    rest.map((bytes) => bytes[0]),
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

  // 0x34, 0x30, then the two drops.
  const burst = await client.take(4);
  assert.equal(burst[0]![0], MOB_OPCODE.stat);
  assert.equal(burst[1]![0], MOB_OPCODE.leaveDelayed);
  const mesos = readDropAppear(new PacketReader(burst[2]!, 1));
  const item = readDropAppear(new PacketReader(burst[3]!, 1));
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
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(await client.take(0), [], "no reply at all: there is no mob 99 to answer for");
  assert.ok(log.some((line) => line.includes("no such mob")), log.join("\n"));
});
