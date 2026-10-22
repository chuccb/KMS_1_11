import { ABILITY_REQUEST_OPCODE, encodeAbilityRequest } from "../src/protocol/ability.ts";
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
import {
  encodeSessionPacket,
  SessionDeframer,
  type SessionEvent,
} from "../src/protocol/session.ts";
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
  encodeClientScrollUpgrade,
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
  readUserBalloon,
  readUserWhisperRefused,
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
import {
  INVENTORY_OP,
  INVENTORY_OPCODE,
  INVENTORY_TAB,
  readInventoryChange,
} from "../src/protocol/inventory.ts";
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
  MINIROOM_KIND,
  MINIROOM_OPCODE,
  MINIROOM_REFUSAL,
  TRADE_FINISH,
  encodeClientMiniRoomRequest,
  readMiniRoomResult,
} from "../src/protocol/miniroom.ts";
import {
  MESSENGER_OPCODE,
  encodeClientMessengerRequest,
  readMessengerResult,
} from "../src/protocol/messenger.ts";
import { grantItem } from "../src/game/rewards.ts";
import { PARTY_OPCODE, encodeClientPartyRequest, readPartyResult } from "../src/protocol/party.ts";
import { FAME_OPCODE, encodeClientFameRequest, readFameResult } from "../src/protocol/fame.ts";
import {
  CLIENT_OBJECT_CLICK_OPCODE,
  CLIENT_SHOP_OPCODE,
  SHOP_OPEN_OPCODE,
  SHOP_RESULT,
  SHOP_RESULT_OPCODE,
  encodeClientObjectClick,
  encodeClientShopRequest,
  readShopOpen,
  readShopResult,
  shopRechargeUnitPrice,
} from "../src/protocol/shop.ts";
import { shopKeeper } from "../src/game/shops.ts";
import { PATROL_SPEED_PX_PER_SEC } from "../src/game/mobs.ts";
import { MESO_DROP_OPCODE, encodeMesoDrop } from "../src/protocol/mesodrop.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { consumeSpecProvider } from "../src/game/items.ts";
import { scrollSpecProvider } from "../src/game/scrolls.ts";
import { artProviderOf } from "../src/game/art.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { activeArt } from "../src/game/activeskills.ts";
import { activeMagicSpeed } from "../../client/active-skills.ts";
import { equipSlot, nonEquipSlot, type ItemSlotEquip } from "../src/protocol/itemslot.ts";
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
import {
  GameEntryServer,
  HandoffRegistry,
  LoginServer,
  type AccountRecord,
} from "../src/net/loginserver.ts";
import { MemorySaveStore, loadAccounts } from "../src/game/save.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
/**
 * The LIVE attack contract: cli.ts wires `art.attackProfile` as the game server's `basicAttack`
 * provider, and with a provider present an admitted swing resolves on the motion's release clock
 * (`queueActiveHits`) instead of the legacy immediate path a provider-less fixture falls back to.
 * The combat tests below validate against the same provider, so they exercise what a real client
 * of a real server hits: a swing is only admitted when it matches the worn weapon's own profile
 * (skillId 0, hits 1, one target, one integer damage 0..9999, an action of the weapon group's
 * melee table, and exactly the profile's speed tier).
 */
const combatArt = archive ? artProviderOf(archive) : null;

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
      for (const event of this.deframer.push(
        new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      )) {
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
      for (const body of taken)
        process.stderr.write(
          `[test] s2c ${[...body].map((b) => b.toString(16).padStart(2, "0")).join("")}\n`,
        );
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
  for (let i = 0; i < count; i++)
    worlds.push({ name: reader.readAsciiString(), unknownId: reader.readU32() });
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
  // clothes from). WZ newDlg labels plus the four draw coordinates prove STR/DEX/INT/LUK.
  client.send({
    kind: "check-name",
    opcode: 0x06,
    name: "Hero",
    appearance: [20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 10],
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
  assert.deepEqual(
    [created.stats.str, created.stats.dex, created.stats.int, created.stats.luk],
    [4, 5, 6, 10],
  );
  assert.equal(created.stats.level, 1);
  assert.ok(created.stats.id > 0);
  assert.equal(createReader.exhausted, true);

  // 6. The same name is now taken.
  client.send({
    kind: "check-name",
    opcode: 0x06,
    name: "Hero",
    appearance: [20000, 30030, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10],
  });
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
 * `--auto-register`: an unknown id is created instead of refused.
 *
 * The original has no such thing. An id the server does not know is answered with
 * `LOGIN_RESULT.notRegistered` (5), "등록되지 않은 아이디입니다.", and an account only ever came to
 * exist off-game - the closed-beta build says so itself: "베타당첨자의 경우에는 별도의 가입없이,
 * 베타신청시의 계정/비번을 이용하세요." So this is a development switch in the same category as
 * `--test-tools`, and these tests are mostly about the ways it must *not* fire: it is off unless it
 * is asked for, it will not make an account out of an empty name or password, and it never
 * overwrites an account that is already there.
 */
test("--auto-register: an unknown id is created, and the original's 5 is what changes", async (t) => {
  /** One login server on a free port, with or without the switch. */
  const serve = async (autoRegister: boolean) => {
    const log: string[] = [];
    const accounts = new Map<string, AccountRecord>();
    let persisted = 0;
    const server = new LoginServer({
      accounts,
      worlds: [{ name: "Scania", unknownId: 0 }],
      gameServer: { ip: "127.0.0.1", port: 8585 },
      handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
      pingMs: 0,
      ...(autoRegister ? { autoRegister: true } : {}),
      persist: () => {
        persisted++;
      },
      log: (line) => log.push(line),
    });
    const info = await server.listen(0);
    t.after(async () => {
      await server.close();
    });
    /** One login attempt on a fresh connection; returns the result byte. */
    const attempt = async (username: string, password: string): Promise<number> => {
      const client = await FakeClient.connect(info.port);
      client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
      client.send({ kind: "login-request", opcode: 0x01, username, password });
      const result = parseLoginReply((await client.take(1))[0]!).result;
      client.close();
      return result;
    };
    return { accounts, log, attempt, persisted: () => persisted };
  };

  // 1. Without the switch this is still the 2003 answer, and the table stays empty.
  const plain = await serve(false);
  assert.equal(await plain.attempt("newbie", "pw"), LOGIN_RESULT.notRegistered);
  assert.equal(await plain.attempt("newbie", "pw"), 5);
  assert.equal(plain.accounts.size, 0, "the original never registers anybody");
  assert.equal(plain.persisted(), 0);

  // 2. With it, the first attempt creates the account and logs straight in.
  const on = await serve(true);
  assert.equal(await on.attempt("newbie", "pw"), LOGIN_RESULT.ok);
  assert.deepEqual([...on.accounts.keys()], ["newbie"]);
  assert.equal(on.accounts.get("newbie")?.password, "pw", "registered with the password typed");
  assert.deepEqual(on.accounts.get("newbie")?.characters, [], "no characters until one is made");
  assert.equal(on.persisted(), 1, "registering is durable, so a restart cannot forget it");
  assert.ok(
    on.log.some((line) => line.includes('auto-register: created account "newbie"')),
    "and it says so, because an account appearing out of nowhere should never be silent",
  );

  // 3. The account is a real account now: the same id is no longer "unknown", so a wrong password
  //    gets 4 ("잘못된 패스워드입니다.") rather than silently creating a second one or overwriting.
  assert.equal(await on.attempt("newbie", "different"), LOGIN_RESULT.wrongPassword);
  assert.equal(await on.attempt("newbie", "different"), 4);
  assert.equal(on.accounts.get("newbie")?.password, "pw", "the password was not overwritten");
  assert.equal(on.accounts.size, 1);
  assert.equal(await on.attempt("newbie", "pw"), LOGIN_RESULT.ok, "the right one still works");
  assert.equal(on.accounts.size, 1, "logging in twice does not create anything");

  // 4. An empty name or password is never registered: an account anybody could open by typing
  //    nothing is worse than no account, and 5 is still literally true - nothing was created.
  assert.equal(await on.attempt("", "pw"), LOGIN_RESULT.notRegistered);
  assert.equal(await on.attempt("somebody", ""), LOGIN_RESULT.notRegistered);
  assert.equal(await on.attempt("", ""), LOGIN_RESULT.notRegistered);
  assert.equal(on.accounts.size, 1, "still only the one real account");
  assert.ok(!on.accounts.has(""), "no account named the empty string");
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
test(
  "a second login for an account that is already online is refused with 7",
  { timeout: 20000 },
  async (t) => {
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
    const openLogin = async (
      username: string,
      password: string,
    ): Promise<{ client: FakeClient; result: number }> => {
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
    assert.equal(
      (await inGame.take(1))[0]![0],
      FIELD_OPCODE.setField,
      "0x16: the character is in the map",
    );

    // 2. The login connection goes away - which is what the real client does once the 0x03 reply has
    // sent it to the game server. The seat must stay taken: the character is still standing in a map.
    hero.client.close();
    const loginSocketGone = Date.now() + 2000;
    while (
      online.sessionsOf("admin").some((session) => session.where === "login") &&
      Date.now() < loginSocketGone
    ) {
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
    assert.equal(
      retry.result,
      LOGIN_RESULT.ok,
      `the seat came back after the session ended; log:\n${log.join("\n")}`,
    );
    retry.client.close();
  },
);

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
test(
  "a character that is already in a field is not entered twice",
  { timeout: 20000 },
  async (t) => {
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
    const entry = {
      username: "admin",
      characterId: 21,
      characterName: "Hero",
      character: characterDataOf(stats),
    };

    const first = await FakeClient.connect(gameInfo.port);
    t.after(() => first.close());
    first.send({ kind: "handshake-reply", opcode: 0x04, value: handoffs.issue(entry) });
    assert.equal(
      (await first.take(1))[0]![0],
      FIELD_OPCODE.setField,
      "the first connection gets its 0x16",
    );

    const second = await FakeClient.connect(gameInfo.port);
    t.after(() => second.close());
    second.send({ kind: "handshake-reply", opcode: 0x04, value: handoffs.issue(entry) });
    const gone = new Promise<void>((resolve) => second.socketClose(() => resolve()));
    await gone;
    assert.equal(
      second.queueLength,
      0,
      "no 0x16, no snapshot: nothing is sent to a refused connection",
    );
    assert.ok(
      log.some((line) =>
        line.includes(
          'character 0x00000015 ("Hero") is already in map 1000000 - refusing the second connection',
        ),
      ),
      log.join("\n"),
    );

    // The player who was already there is untouched: chat still works, which means the field and the
    // session are both intact (drain the entry snapshot first, or `take` would hand back a mob).
    await first.drain();
    first.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.chat,
      body: encodeClientChat({ text: encodeCp949("still here") }).slice(1),
    });
    const chat = (await first.take(1))[0]!;
    assert.equal(
      chat[0],
      FIELD_OPCODE.userBalloon,
      `the first session still gets its chat back; log:\n${log.join("\n")}`,
    );
  },
);

/**
 * The heartbeat is what makes "already online" self-healing.
 *
 * A client that vanishes without closing its socket (a pulled cable, a crashed machine) would
 * otherwise hold its account for as long as the OS keeps the half-open connection - and the next
 * login would be told "you are already connected" about a player who is gone. `0x08` is the packet
 * the 2003 client always echoes (FINDINGS 4.2), so a session that does not answer three times is
 * dropped, and its seat goes with it.
 */
test(
  "a session that stops answering the 0x08 heartbeat loses its seat",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const accounts = new Map<string, AccountRecord>([
      ["admin", { password: "admin", characters: [] }],
    ]);
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
  },
);

/**
 * A third timeout-free proof of the seat: the login server that is closed releases its seats itself.
 *
 * `close()` is called by the CLI on SIGINT and by every test's cleanup, and the seats are shared
 * between the two halves - so "the sockets will close in a moment" is not good enough: a caller that
 * opens the next server right away would see "already online" about a server that is gone.
 */
test("closing a server gives its seats back before it returns", { timeout: 20000 }, async (t) => {
  const online = new OnlineAccounts();
  const accounts = new Map<string, AccountRecord>([
    ["admin", { password: "admin", characters: [] }],
  ]);
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

test(
  "the game server claims the character id the login server issued",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const accounts = new Map<string, AccountRecord>([
      ["admin", { password: "admin", characters: [] }],
    ]);
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
    client.send({
      kind: "check-name",
      opcode: 0x06,
      name: "Hero",
      appearance: [20000, 30030, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10],
    });
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
      log.some((line) =>
        line.includes(
          `character 0x${(issuedId >>> 0).toString(16).padStart(8, "0")} claimed -> "Hero"`,
        ),
      ),
      log.join("\n"),
    );

    // ... and the claim is followed by 0x16, the packet that actually puts the client into a map.
    const fieldEntry = (await gameClient.take(1))[0]!;
    assert.equal(
      fieldEntry[0],
      FIELD_OPCODE.setField,
      "the game server's first in-game packet is 0x16",
    );
    const field = readSetField(new PacketReader(fieldEntry, 1));
    assert.equal(field.full, true, "the full form carries the map id inside the CharacterData");
    assert.equal(
      field.character.stats.mapId,
      1000000,
      "DEFAULT_MAP_ID is a map that exists in Data.wz",
    );
    assert.equal(field.character.stats.id, issuedId, "the same character the handoff named");
    assert.equal(field.character.stats.name, "Hero");
    assert.notEqual(
      field.randomSeedA | field.randomSeedB | field.randomSeedC,
      0,
      "the field seeds are chosen, not zero",
    );
    gameClient.close();

    // A second client can ask for a different map, and no state leaks between connections.
    const other = await FakeClient.connect(gameInfo.port);
    const otherId = handoffs.issue({ username: "admin", characterId: 4242, characterName: "Alt" });
    other.send({ kind: "handshake-reply", opcode: 0x04, value: otherId });
    const otherField = readSetField(new PacketReader((await other.take(1))[0]!, 1));
    assert.equal(otherField.character.stats.mapId, 1000000);
    assert.equal(otherField.character.stats.id, 4242);
    other.close();
  },
);

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
    [32, { id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, prev: 0, next: 0 }],
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
  mobs: [
    { templateId: 120100, x: 700, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 1000, cy: 300 },
  ],
  npcs: [{ templateId: 2003, x: 650, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 0, cy: 300 }],
  portals: [{ name: "east00", type: 2, x: 600, y: 300, toMapId: 1000000, toName: "west00" }],
  footholds: 1,
  ladderRopes: 0,
  footholdSegments: new Map([
    [32, { id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, prev: 0, next: 0 }],
  ]),
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

test(
  "the game server spawns the map's monsters and NPCs right after 0x16",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 20,
        maxMP: 0,
        exp: 1,
        speedPercent: 100,
        dieMs: 0,
      }),
      mobTickMs: 20,
      handshake: { clientSendSeed: 0x55555555, clientRecvSeed: 0x66666666 },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const client = await FakeClient.connect(gameInfo.port);
    t.after(() => client.close());
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 7,
      characterName: "Hero",
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    // 0x16, then the map's two mobs, then its one NPC - all four in the same TCP stream. The socket
    // stays open: the walk phase below listens for the field's own `0x33` ticks on this same stream
    // (a `client.close()` that once sat here stranded that phase - the test could never hear a mob
    // walk, so it timed out on a dead socket instead of asserting anything).
    const packets = await client.take(4);

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
      {
        mobId: first.mobId,
        templateId: first.templateId,
        x: first.x,
        y: first.y,
        facing: first.facing,
      },
      { mobId: 1, templateId: 120100, x: 509, y: 300, facing: 0 },
      "the first life entry of the map, with a server-chosen pool id",
    );
    const second = readMobEnterField(new PacketReader(packets[2]!, 1));
    assert.deepEqual(
      {
        mobId: second.mobId,
        templateId: second.templateId,
        x: second.x,
        y: second.y,
        facing: second.facing,
      },
      { mobId: 2, templateId: 1210100, x: -5, y: 7, facing: 1 },
      "negative coordinates and the left-facing bit survive the wire",
    );
    assert.equal(second.channels, undefined, "no animation channel is claimed by the server yet");
    assert.equal(new PacketReader(packets[2]!, 1).remaining, 21, "a channel-less 0x2F is 22 bytes");
    assert.ok(
      log.some((line) => line.includes("spawned 2 mobs")),
      log.join("\n"),
    );

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
    assert.ok(
      element.x >= 0 && element.x <= 1000,
      `the leg ends inside the range, at ${element.x}`,
    );
    assert.equal(move.body.path.originX, 509, "and starts where the mob spawned");
    // The world's fields roam (world.ts's fixed policy) and a roam decision is `Math.random`'s
    // intent (`sub_53D980`): the first leg is either a stationary timed path (the mob stands at
    // its spawn for decisionMs, vx/vy 0) or a walk leg along this horizontal foothold, whose
    // elements carry planLeg's own mm/s - exactly ±PATROL_SPEED at speedPercent 100, because dx
    // is an integer and duration is |dx|·8 ms. Both are a legal first `0x33`, and this assertion
    // never ran before the stranded-close fix (ADR-102), so it now holds for both shapes instead
    // of betting on the random draw.
    assert.equal(element.vy, 0, "the foothold is horizontal: no leg may carry a vy");
    assert.ok(
      element.vx === 0 || Math.abs(element.vx) === PATROL_SPEED_PX_PER_SEC,
      `the first roam leg stands (vx 0) or walks at patrol speed, got vx ${element.vx}`,
    );
    assert.equal(client.headersOk, true, "the movement packets survive the cipher too");
  },
);

test(
  "legacy --npc-walk requests one controller after visibility; idle timers live on the client",
  { timeout: 20000 },
  async (t) => {
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
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 7,
      characterName: "Hero",
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    const packets = await client.take(5);
    client.close();

    // 0x16, the two mobs, NPC visibility and its controller designation - the flag belongs to a pool entry,
    // so it cannot come before the packet that makes one.
    assert.deepEqual(
      packets.map((packet) => packet[0]),
      [
        FIELD_OPCODE.setField,
        MOB_OPCODE.enterField,
        MOB_OPCODE.enterField,
        NPC_OPCODE.enterField,
        NPC_OPCODE.stateToggle,
      ],
    );
    assert.deepEqual(
      readNpcState(new PacketReader(packets[4]!, 1)),
      { npcId: 1, on: true },
      "the pool id the 0x39 handed out, not the template id the policy named",
    );
    assert.ok(
      log.some((line) => line.includes("1 NPCs (1 legacy controller requests)")),
      log.join("\n"),
    );
    assert.equal(client.headersOk, true);
  },
);

test(
  "a map the provider does not know still enters, it just has nothing to spawn",
  { timeout: 20000 },
  async (t) => {
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
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 8,
      characterName: "Solo",
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    const first = (await client.take(1))[0]!;
    assert.equal(first[0], FIELD_OPCODE.setField, "0x16 is sent even without map data");
    assert.deepEqual(
      await client.drainOpcodes(80),
      [],
      "and no 0x2F follows, rather than a mob at (0,0)",
    );
    assert.ok(
      log.some((line) => line.includes("has no Map/Map/*.img")),
      log.join("\n"),
    );
    client.close();
  },
);

/**
 * The whole mob loop over a real socket: a swing kills a monster, and the death comes back as the
 * three packets of FINDINGS 4.17 - `0x34` (the mob's stat/flash), `0x30` (the die animation starts
 * now) and, once that animation is over, `0x31 flag=0` (the corpse goes). A stub template is used so
 * the die animation is 40 ms instead of the real 720: the timing logic is the same code.
 *
 * The swing itself goes through the LIVE admission contract: the killer wears sword 1302000 (worn
 * slot 11, what the handler reads the weapon id from), the server validates against that weapon's
 * own archive profile, and the hit resolves on the motion's release clock (~393 ms for swingO1) -
 * so the packets below arrive after the swing, not inside it. The legacy `skillId:1` payload this
 * test used to send is silently refused by the attack-validation rewire (ADR-102 diagnosis).
 */
test(
  "a swing that kills a mob answers 0x34, 0x30, and then 0x31 when the corpse is over",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 11,
      characterName: "Fighter",
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    const spawn = await client.take(4);
    client.close(); // the spawn burst (0x16, two mobs, the NPC) is all this test needs

    const killer = await FakeClient.connect(gameInfo.port);
    t.after(() => killer.close());
    // The killer's own record: alive (hp 50 - the handler refuses dead attackers) and WEARING the
    // sword the profile is looked up by (worn slot 11). No record means no weapon, and a weaponless
    // swing has no profile to be admitted against.
    const killerStats = zeroStats();
    killerStats.id = 12;
    killerStats.name = "Fighter2";
    killerStats.hp = 50;
    killerStats.maxHp = 50;
    const killerItems = startingCharacterItems();
    killerItems.worn.set(11, equipSlot(1302000));
    const otherId = handoffs.issue({
      username: "admin",
      characterId: 12,
      characterName: "Fighter2",
      character: characterDataOf(killerStats, killerItems),
    });
    killer.send({ kind: "handshake-reply", opcode: 0x04, value: otherId });
    await killer.take(4);
    assert.equal(spawn[1]![0], MOB_OPCODE.enterField);
    assert.equal(
      spawn[3]![0],
      NPC_OPCODE.enterField,
      "the NPC spawn rides along with the mob burst",
    );

    // One swing, one target, 10 damage - exactly the mob's HP, so it dies. The action and speed
    // are the weapon profile's own (sword 1302000: group 1, speed tier 2, melee[0] = action 5
    // swingO1); anything else is refused without an answer, exactly as a mismatched real packet is.
    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swing = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swing.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    killer.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

    // The kill burst comes out of one synchronous resolve: `0x34` (the mob's stat/flash) with
    // `0x30` (the die animation starts now) right behind it. A roam decision may legally drop a
    // stand `0x33` into the stream BEFORE the burst (mobTickMs 20 and the intent is Math.random's,
    // so a stationary leg - which speedPercent 0 cannot suppress - arrives in ~1/3 of the runs),
    // so the burst is located by its first opcode instead of being assumed to start the stream.
    const toStat = await killer.takeOpcode(MOB_OPCODE.stat);
    assert.ok(
      toStat.slice(0, -1).every((bytes) => bytes[0] === MOB_OPCODE.move),
      `only the mob's own roam 0x33 may precede the kill burst, saw ` +
        toStat.map((bytes) => bytes[0]).join(","),
    );
    const flash = toStat[toStat.length - 1]!;
    assert.deepEqual(readMobStat(new PacketReader(flash, 1)), { mobId: 1, mp: 0 });
    const leave = (await killer.take(1))[0]!;
    assert.equal(leave[0], MOB_OPCODE.leaveDelayed, "0x30 rides right behind 0x34");
    assert.deepEqual(readMobLeaveDelayed(new PacketReader(leave, 1)), { mobId: 1, delayMs: 0 });
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
  },
);

/**
 * A kill pays experience, and the player's own numbers move for the first time: the packet is `0x0D`
 * (FINDINGS 4.21), and the diff is exactly "what changed" - `exp`, plus the level and the HP/MP
 * refill when the bar filled up.
 *
 * The character arrives with hp 20/50 and mp 5/30, and the stub monster is worth 20 exp at level 1
 * (the client's own table wants 15 for that level), so one swing has to produce
 * level 2 / exp 15 plus native HP/MP growth/refill - the client computes the level-up
 * message and the effect from the level it sees (sub_55BEB0).
 */
test(
  "a kill awards the monster's exp as a 0x0D stat diff",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 20,
        speedPercent: 0,
        dieMs: 0,
      }),
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
    // The swing only gets admitted with the LIVE contract: the record wears the sword (worn slot 11)
    // the profile is looked up by, and the packet carries that profile's own action/speed (ADR-103).
    const items = startingCharacterItems();
    items.worn.set(11, equipSlot(1302000));
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 21,
      characterName: "Fighter",
      character: characterDataOf(stats, items),
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    await client.take(4); // 0x16 + the two mobs + the NPC
    t.after(() => client.close());

    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swing = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swing.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

    // The kill burst resolves on the motion's release clock; a roam stand 0x33 may legally precede it
    // (see the swing-kill test), so locate 0x34 by opcode and take 0x30 as its synchronous neighbor.
    const toStat = await client.takeOpcode(MOB_OPCODE.stat);
    assert.ok(
      toStat.slice(0, -1).every((bytes) => bytes[0] === MOB_OPCODE.move),
      `only the mob's own roam 0x33 may precede the kill burst, saw ` +
        toStat.map((bytes) => bytes[0]).join(","),
    );
    const leave = (await client.take(1))[0]!;
    assert.equal(leave[0], MOB_OPCODE.leaveDelayed);
    const stat = (await client.take(1))[0]!;
    assert.equal(stat[0], STAT_OPCODE, "the kill pays out as 0x0D");
    const payout = readStatUpdate(new PacketReader(stat, 1));
    assert.equal(payout.ack, false);
    const diff = payout.diff!;
    assert.equal(diff.level, 2);
    assert.equal(diff.exp, 15);
    // Level-up growth is server-owned RNG (growth.ts reproduces rand()%width over the job's own row;
    // job 0 grows maxHp by 20..25 and maxMp by 10..12 - VITAL_GROWTH_ROWS row 0), and the serve path
    // deliberately exposes no injection seam, so the maxima are asserted inside the native range and
    // the refill exactly: hp/mp come back at whatever the maxima grew to.
    assert.ok(
      diff.maxHp! >= 50 + 20 && diff.maxHp! <= 50 + 25,
      `maxHp grew inside the beginner row's 20..25, got ${diff.maxHp}`,
    );
    assert.ok(
      diff.maxMp! >= 30 + 10 && diff.maxMp! <= 30 + 12,
      `maxMp grew inside the beginner row's 10..12, got ${diff.maxMp}`,
    );
    assert.equal(diff.hp, diff.maxHp, "the refill lands on the grown maximum");
    assert.equal(diff.mp, diff.maxMp);
    assert.deepEqual(
      Object.keys(diff).sort(),
      ["exp", "hp", "level", "maxHp", "maxMp", "mp"],
      "the diff is exactly what changed: the bar, the level, the grown maxima and the refill",
    );
    assert.ok(
      log.some(
        (line) => line.includes("+20 exp for killing stub") && line.includes("exp 15, level 2"),
      ),
      log.join("\n"),
    );
  },
);

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
test(
  "a drop is taken by walking onto it: 0x44 kind 2, the gain, and the notice",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    // The LIVE admission contract: the record wears the sword the profile is looked up by, and the
    // packet carries that profile's own action/speed (ADR-103; see the swing-kill test).
    const killerStats = zeroStats();
    killerStats.id = 11;
    killerStats.name = "Fighter";
    killerStats.hp = 50;
    killerStats.maxHp = 50;
    const killerItems = startingCharacterItems();
    killerItems.worn.set(11, equipSlot(1302000));
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 11,
      characterName: "Fighter",
      character: characterDataOf(killerStats, killerItems),
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    await client.take(4); // 0x16 + the two mobs + the NPC
    t.after(() => client.close());

    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swing = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swing.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

    // 0x34, 0x30, the kill's exp (0x0D), then the two drops - one synchronous batch, located by its
    // first opcode because a roam stand 0x33 may legally precede it (see the swing-kill test).
    const toStat = await client.takeOpcode(MOB_OPCODE.stat);
    assert.ok(
      toStat.slice(0, -1).every((bytes) => bytes[0] === MOB_OPCODE.move),
      `only the mob's own roam 0x33 may precede the kill burst, saw ` +
        toStat.map((bytes) => bytes[0]).join(","),
    );
    const burst = [toStat[toStat.length - 1]!, ...(await client.take(4))];
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
        path: {
          originX: 0,
          originY: 0,
          elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }],
        },
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
      throw new Error(
        `no 0x${opcode.toString(16)} in [${seen.map((packet) => packet[0]!.toString(16)).join(",")}]`,
      );
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
  },
);

/**
 * A swing at a mob this field does not have is logged, not invented: the server answers nothing and
 * the mob it does have stays up. (A 2003 client only sends ids it got from the server, so this is the
 * malformed case - and it must not desync the HP of a different mob.)
 *
 * The swing is a fully ADMISSIBLE one (worn sword, the profile's own action/speed - the LIVE
 * contract of the swing-kill test), so what is under test is the target lookup and nothing else:
 * an unknown mob id must fall out at the queue with a log line, past the release clock, without a
 * single kill-chain packet.
 */
test(
  "a swing at an unknown mob id answers nothing and leaves the field alone",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
      mobTickMs: 20,
      handshake: { clientSendSeed: 0xbbbbbbbb, clientRecvSeed: 0xcccccccc },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const client = await FakeClient.connect(gameInfo.port);
    t.after(() => client.close());
    const sloppyStats = zeroStats();
    sloppyStats.id = 13;
    sloppyStats.name = "Sloppy";
    sloppyStats.hp = 50;
    sloppyStats.maxHp = 50;
    const sloppyItems = startingCharacterItems();
    sloppyItems.worn.set(11, equipSlot(1302000));
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 13,
      characterName: "Sloppy",
      character: characterDataOf(sloppyStats, sloppyItems),
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    await client.take(4); // 0x16 + the two mobs + the NPC

    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swing = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swing.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 99, hitAnimation: 7, x: 0, y: 0, sequence: 1, damages: [9999] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });
    // Drain past the motion's release clock (~393 ms): if the unknown id were invented, its packets
    // would resolve there. A roam stand 0x33 is legal field noise; kill-chain packets are not.
    const answered = await client.drainOpcodes(600);
    assert.equal(
      answered.some((op) => op !== MOB_OPCODE.move),
      false,
      `nothing but the mob's own roam answers for a mob that is not there (saw [${answered.map((op) => op.toString(16)).join(",")}])`,
    );
    assert.ok(
      log.some((line) => line.includes("no such mob")),
      log.join("\n"),
    );
  },
);

test(
  "clicking an NPC opens its shop, and buying moves the item and the mesos",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 20,
        maxMP: 0,
        exp: 1,
        speedPercent: 100,
        dieMs: 0,
      }),
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
    // The wallet starts at 100 mesos, which is enough for two red potions (25 each) and nothing
    // else. hp/maxHp are set because a dead character cannot trade: `handleShopRequest` answers
    // every request with the error code at hp<=0 (ADR-100's gate map), and `zeroStats()` is a
    // corpse - the same fixture trap the cap tests hit.
    const stats = { ...zeroStats(), level: 1, hp: 50, maxHp: 50, mesos: 100 };
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
    assert.equal(
      opened[0]![0],
      FIELD_OPCODE.requestRelease,
      "0x19 comes first: a click arms the client's gate",
    );
    assert.equal(opened[1]![0], SHOP_OPEN_OPCODE);
    const shop = readShopOpen(new PacketReader(opened[1]!, 1));
    assert.equal(shop.shopId, 2003, "로빈's shop, keyed by the NPC template id");
    assert.deepEqual(
      shop.items.map((line) => [line.itemId, line.price]),
      [
        [2000000, 25], // 빨간 포션, straight out of Item/Consume/0200.img
        [2000003, 100], // 파란 포션
        [2030000, 75], // 마을 귀환 주문서, out of Item/Consume/0203.img
        // 4B3780: the eight rechargeable star rows ride along at price 0 in every WZ shop;
        // the client files them into its recharge list, and the buy rows below are indexed
        // against the price-nonzero filter of this very list.
        [2070000, 0],
        [2070001, 0],
        [2070002, 0],
        [2070003, 0],
        [2070004, 0],
        [2070005, 0],
        [2070006, 0],
        [2070007, 0],
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
    assert.deepEqual(
      diff,
      { ack: false, diff: { mesos: 75 } },
      "the 0x0D flag 0x40000 is the money field",
    );
    assert.ok(
      log.some((line) => line.includes("bought") && line.includes("mesos 75")),
      log.join("\n"),
    );

    // A purchase the wallet cannot pay for: the client gets code 2 and nothing moves.
    client.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "buy", row: 1, itemId: 2000003, count: 1 }).slice(1),
    });
    const refused = await client.take(1);
    assert.deepEqual(
      [refused[0]![0], refused[0]![1]],
      [SHOP_RESULT_OPCODE, SHOP_RESULT.notEnoughMesos],
    );

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
  },
);

test(
  "clicking an NPC with no shop opens its dialogue, and 0x15 walks it line by line",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const lines = ["one", "two", "three"];
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 20,
        maxMP: 0,
        exp: 1,
        speedPercent: 100,
        dieMs: 0,
      }),
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
    const characterId = handoffs.issue({
      username: "admin",
      characterId: 31,
      characterName: "Talker",
    });
    client.send({ kind: "handshake-reply", opcode: 0x04, value: characterId });
    await client.take(4); // 0x16 + the two mobs + the NPC

    // The click: release byte first, then the first line. The NPC pool gave it id 1.
    client.send({
      kind: "unknown",
      opcode: CLIENT_OBJECT_CLICK_OPCODE,
      body: encodeClientObjectClick({ objectId: 1 }).slice(1),
    });
    const opened = await client.take(2);
    assert.equal(
      opened[0]![0],
      FIELD_OPCODE.requestRelease,
      "0x19 comes first: a click arms the client's gate",
    );
    assert.equal(opened[1]![0], QUEST_TALK_OPCODE);
    const first = readQuestTalk(new PacketReader(opened[1]!, 1));
    assert.deepEqual(
      first,
      {
        unknownA: 0,
        npcId: 1,
        body: { kind: "say", message: "one", unknownA: 0, unknownB: 1 },
      },
      "the pool id the client clicked, not the template id",
    );
    assert.equal(client.headersOk, true);

    // A click while the dialog is up is refused: the client would throw on a second 0x47.
    client.send({
      kind: "unknown",
      opcode: CLIENT_OBJECT_CLICK_OPCODE,
      body: encodeClientObjectClick({ objectId: 1 }).slice(1),
    });
    const refused = await client.take(1);
    assert.deepEqual(
      [refused[0]![0]],
      [FIELD_OPCODE.requestRelease],
      "the release byte, and no second dialog",
    );
    assert.ok(
      log.some((line) => line.includes("still talking")),
      log.join("\n"),
    );

    // The primary answer advances; Prev goes back, header Close/ESC ends the conversation.
    client.send({
      kind: "unknown",
      opcode: QUEST_REPLY_OPCODE,
      body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1),
    });
    const second = await client.take(1);
    assert.equal(second[0]![0], QUEST_TALK_OPCODE);
    assert.equal(readQuestTalk(new PacketReader(second[0]!, 1)).body.message, "two");

    client.send({
      kind: "unknown",
      opcode: QUEST_REPLY_OPCODE,
      body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1),
    });
    const third = await client.take(1);
    assert.equal(readQuestTalk(new PacketReader(third[0]!, 1)).body.message, "three");

    client.send({
      kind: "unknown",
      opcode: QUEST_REPLY_OPCODE,
      body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1),
    });
    const answered = await client.drainOpcodes();
    assert.equal(
      answered.includes(QUEST_TALK_OPCODE),
      false,
      "the last line's answer ends the talk: nothing follows",
    );
    assert.ok(
      log.some((line) => line.includes("the last line was read")),
      log.join("\n"),
    );

    // A reply with no dialog open is dropped, and a new click starts a fresh conversation.
    client.send({
      kind: "unknown",
      opcode: QUEST_REPLY_OPCODE,
      body: encodeQuestReply({ kind: "say", answer: 1 }).slice(1),
    });
    assert.equal(
      (await client.drainOpcodes()).includes(QUEST_TALK_OPCODE),
      false,
      "an answer with no dialog is not answered",
    );
    assert.ok(
      log.some((line) => line.includes("without a dialog open")),
      log.join("\n"),
    );

    client.send({
      kind: "unknown",
      opcode: CLIENT_OBJECT_CLICK_OPCODE,
      body: encodeClientObjectClick({ objectId: 1 }).slice(1),
    });
    const again = await client.take(2);
    assert.equal(again[1]![0], QUEST_TALK_OPCODE);
    assert.equal(
      readQuestTalk(new PacketReader(again[1]!, 1)).body.message,
      "one",
      "a new talk starts at the first line",
    );

    // Header Close/ESC (answer FF) closes it without another packet.
    client.send({
      kind: "unknown",
      opcode: QUEST_REPLY_OPCODE,
      body: encodeQuestReply({ kind: "say", answer: 255 }).slice(1),
    });
    assert.equal(
      (await client.drainOpcodes()).includes(QUEST_TALK_OPCODE),
      false,
      "header Close ends the talk",
    );
    assert.ok(
      log.some((line) => line.includes("conversation ended")),
      log.join("\n"),
    );
    client.close();
  },
);

/**
 * The MMO half of ADR-012, over real sockets: two players in one map.
 *
 * The field is the server's, not the connection's (`game/world.ts`), so the second socket sees the
 * first player enter (`0x1C`), their walk (`0x22`), a monster dying under their swing, and their
 * departure (`0x1D`) - while the packets that belong to one player (the exp of that kill, in `0x0D`)
 * go to that player alone. `speedPercent: 0` keeps every WALK leg away; the only field noise left is
 * the roam decision's stationary `0x33` (~1/s per mobile mob, `Math.random`'s intent), which the
 * burst assertions filter out by opcode so the deep-equals stay exact about everything else.
 *
 * The swing goes through the LIVE admission contract (ADR-103): the hero wears sword 1302000 - the
 * server reads the weapon id from worn slot 11 - and the packet carries that profile's own
 * action/speed, so the kill resolves on the motion's release clock and the `0x23` the alt sees is
 * the real relay, not the legacy immediate path.
 */
test(
  "two players in one map see each other: 0x1C, 0x22, the same kill, and 0x1D",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    // The hero's own record: alive, and wearing the sword the swing's admission reads (worn slot
    // 11). The look stays the starter one - the record has no face/hair of its own, so the server
    // fills the starters in, and the sword rides along in the 0x1C's clothes list.
    const heroStats = zeroStats();
    heroStats.id = 7;
    heroStats.name = "Hero";
    heroStats.hp = 50;
    heroStats.maxHp = 50;
    const heroItems = startingCharacterItems();
    heroItems.worn.set(11, equipSlot(1302000));
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: characterDataOf(heroStats, heroItems),
      }),
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
      withWorn(
        startingCharacterItems(),
        wornOfLook([20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 10]),
      ),
    );
    alt.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 8,
        characterName: "Alt",
        character: altRecord,
      }),
    });
    // The roam decision's stationary 0x33 is the field's own noise (its intent is Math.random's,
    // ~1/s per mobile mob): every strict burst below filters it out and stays exact about the rest.
    const altBurst = (await alt.takeOpcode(FIELD_OPCODE.userEnterField)).filter(
      (bytes) => bytes[0] !== MOB_OPCODE.move,
    );
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
      { characterId: 7, name: "Hero", x: 100, y: 190, foothold: 32 },
      "sub_511820 initializes ten pixels above the spawn portal",
    );
    assert.deepEqual(
      [aboutHero.face, aboutHero.avatarItems],
      [DEFAULT_FACE_ID, [DEFAULT_HAIR_ID, 1302000]],
      "and with a face and hair - a hand-built record has no look of its own, so the server fills " +
        "the starter one in rather than sending a user with no face at all - while the sword the " +
        "swing's admission needs rides along in the clothes list like any other worn equip",
    );

    const heroSaw = (await hero.takeOpcode(FIELD_OPCODE.userEnterField)).filter(
      (bytes) => bytes[0] !== MOB_OPCODE.move,
    );
    assert.deepEqual(
      heroSaw.map((bytes) => bytes[0]),
      [FIELD_OPCODE.userEnterField],
      "and the one who was there gets the newcomer",
    );
    const aboutAlt = readUserEnterField(new PacketReader(heroSaw[0]!, 1));
    assert.deepEqual([aboutAlt.characterId, aboutAlt.name], [8, "Alt"]);
    assert.deepEqual(
      [aboutAlt.face, aboutAlt.avatarItems],
      [20000, [30000, 1040001, 1060001, 1071000, 1302000]],
      "the face and the worn equips of the record go out as the 0x1C's first u32 and its id list - " +
        "which is the whole reason the clothes are stored as worn equips (`sub_42E2C0`, 4.11.3c)",
    );
    assert.equal(
      hero.headersOk,
      true,
      "every packet of a shared field survives the cipher/header check",
    );

    // A walk: relayed as the other client's own path, with the id in front (0x0E carries none).
    const move = encodeClientUserMove({
      stageByte: 0,
      path: {
        originX: 0,
        originY: 0,
        elements: [
          { attr: 0, x: 300, y: 290, vx: 0, vy: 0, action: 0, foothold: 32, duration: 60 },
        ],
      },
    });
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.userMove, body: move.slice(1) });
    const altSawMove = await alt.takeOpcode(FIELD_OPCODE.userMove);
    const relayed = readUserMove(new PacketReader(altSawMove[altSawMove.length - 1]!, 1));
    assert.equal(relayed.characterId, 7);
    assert.deepEqual(
      relayed.path.elements.map((element) => [element.x, element.y]),
      [[300, 290]],
    );
    const echoedMoves = (await hero.drain()).filter((bytes) => bytes[0] === FIELD_OPCODE.userMove);
    assert.deepEqual(echoedMoves, [], "the mover is not told about their own walk");

    // One swing kills a monster: the death is the field's, the exp is the attacker's. The action and
    // speed are the worn sword's own profile values - the LIVE admission contract (ADR-103).
    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swingMotion = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swingMotion.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

    const altSawKill = (await alt.takeOpcode(DROP_OPCODE.appear)).filter(
      (bytes) => bytes[0] !== MOB_OPCODE.move,
    );
    assert.deepEqual(
      altSawKill.map((bytes) => bytes[0]),
      [FIELD_OPCODE.userAttack, MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed, DROP_OPCODE.appear],
      "the other player sees the swing first, then the hit, the death and the loot - and nothing of the reward",
    );
    // The swing itself: the attacker's own numbers and action, and only the mobs this field accepted.
    const swing = readUserAttack(new PacketReader(altSawKill[0]!, 1));
    assert.deepEqual(
      [swing.characterId, swing.facingLeft, swing.action, swing.hits, swing.speed, swing.targets],
      [
        7,
        false,
        swingMotion.action,
        1,
        swordProfile.speed,
        [{ mobId: 1, hitAnimation: 7, damages: [10] }],
      ],
      "0x23 carries the swing the attacker reported, under the attacker's own character id",
    );
    assert.deepEqual(
      [swing.afterimage, swing.skillLevel, swing.skillId, swing.projectileItemId],
      [0, 0, 0, 0],
      "the three fields with no source here go out as their neutral values, not as a guess (FINDINGS 4.11.7b)",
    );
    assert.equal(
      readDropAppear(new PacketReader(altSawKill[3]!, 1)).mobId,
      1,
      "the loot flies out of the monster that died",
    );

    const heroSawKill = (await hero.takeOpcode(DROP_OPCODE.appear)).filter(
      (bytes) => bytes[0] !== MOB_OPCODE.move,
    );
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
    assert.ok(
      log.some((line) => line.includes('"Alt" (8) entered map 1000000')),
      log.join("\n"),
    );
    assert.ok(
      log.some((line) => line.includes("(8) left map 1000000")),
      log.join("\n"),
    );
  },
);

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
 * A drag in the inventory window: c2s `0x17` (FINDINGS 4.36). The client moves nothing itself, so
 * the two things worth pinning are its two answers - the `0x0B` that moves the item in this player's
 * own window, and the `0x28` that puts it on everybody else's screen.
 */
test(
  "equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map (first pass)",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      // The trust-boundary admission (canEquipItem) reads the archive's own requirements: without a
      // catalog every wear is refused. The cap is the level-0, job-0, non-cash 위젯 무적 모자 (1002140),
      // which the bare fixture hero can wear - the shipped 1002000 is a cash Lv20 thief hat.
      itemCatalog: itemCatalogOf(archive!),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 500,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    const heroRecord = characterDataOf(
      // hp: a dead character's bags are closed to every 0x17/0x1A (the native HP > 0 sender gate).
      { ...zeroStats(), id: 7, name: "Hero", hp: 50, maxHp: 50 },
      startingCharacterItems(),
    );
    heroRecord.items!.inventories[INVENTORY_TAB.equip - 1]!.items.set(2, equipSlot(1002140));
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: heroRecord,
      }),
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
    assert.deepEqual(
      aboutHero.avatarItems,
      [DEFAULT_HAIR_ID],
      "nothing on the head yet - the cap is in the bag",
    );
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);

    // A double-click on the cap: the four fields of `sub_4636B0` - tab 1, slot 2, the part its caller
    // derived from the item id (1002140 -> cap -> 1, written the way a worn slot is written: negative).
    const doubleClick = encodeClientChangeSlot({
      tab: INVENTORY_TAB.equip,
      fromSlot: 2,
      toSlot: -1,
      count: -1,
    });
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.changeSlot,
      body: doubleClick.slice(1),
    });

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
      1002140,
      "the put carries the item that was moved",
    );
    assert.equal(
      change.result,
      1,
      "the result byte is the client's own timer flag, not a per-entry status",
    );

    // Everybody else: a `0x28` with the list a `0x1C` would have carried, and the face left alone
    // (flags bit 0 clear, so no face word is on the wire at all - FINDINGS 4.11.8).
    const altSaw = await alt.takeOpcode(FIELD_OPCODE.userLook);
    const look = readUserLook(new PacketReader(altSaw[altSaw.length - 1]!, 1));
    assert.deepEqual(
      [look.characterId, look.face, look.avatarItems],
      [7, undefined, [DEFAULT_HAIR_ID, 1002140]],
      "0x28 names the user, leaves the face and replaces the id list",
    );
    assert.ok(
      log.some(
        (line) => line.includes("tab 1 slot 2 -> worn 1 count=-1") && line.includes("look changed"),
      ),
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
    assert.equal(
      heroRecord.items!.worn.get(1)?.itemId,
      1002140,
      "part 1 of the worn group is the cap",
    );
    assert.equal(heroRecord.items!.inventories[INVENTORY_TAB.equip - 1]!.items.has(2), false);

    // The same drag again, now that slot 2 is empty: nothing moves, and the answer is still a `0x0B` -
    // an empty one. `sub_55ACB0` arms the client's one-request gate (FINDINGS 4.6) and only a `0x0B`
    // clears it, so a refusal that stayed silent would freeze the whole window.
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.changeSlot,
      body: doubleClick.slice(1),
    });
    const refused = await hero.takeOpcode(INVENTORY_OPCODE);
    const empty = readInventoryChange(new PacketReader(refused[refused.length - 1]!, 1));
    assert.deepEqual(
      [empty.result, empty.changes],
      [1, []],
      "an empty 0x0B is this server's refusal",
    );
    assert.ok(
      log.some((line) => line.includes("refused (emptySlot)")),
      log.join("\n"),
    );
    assert.deepEqual(
      (await alt.drainOpcodes(150)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
      [],
      "and a refused drag tells the map nothing",
    );
  },
);

test(
  "a stack dropped on its own kind answers 0x0B with the merged slot and the emptied source (0x17)",
  { timeout: 20000 },
  async (t) => {
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTickMs: 10_000,
      dropPolicy: () => [],
      handshake: { clientSendSeed: 0x22334455, clientRecvSeed: 0x66778899 },
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    // Two ten-stacks of one potion: the drag is the ordinary 0x17 the native client sends (whole
    // slot, count -1), and the merge is the server's own answer (ADR-029 choice 6). The hero needs
    // hp: a dead character's bags are closed to every 0x17 (the gate handleChangeSlot shares with
    // use-item).
    const heroRecord = characterDataOf(
      { ...zeroStats(), id: 7, name: "Hero", hp: 50, maxHp: 50 },
      startingCharacterItems(),
    );
    heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.set(
      2,
      nonEquipSlot(2000000, 10),
    );
    heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.set(
      5,
      nonEquipSlot(2000000, 10),
    );
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: heroRecord,
      }),
    });
    await hero.drain();

    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.changeSlot,
      body: encodeClientChangeSlot({
        tab: INVENTORY_TAB.consume,
        fromSlot: 2,
        toSlot: 5,
        count: -1,
      }).slice(1),
    });

    const saw = await hero.takeOpcode(INVENTORY_OPCODE);
    const change = readInventoryChange(new PacketReader(saw[saw.length - 1]!, 1));
    assert.deepEqual(
      change.changes.map((entry) => [entry.op, entry.inventory, entry.slot]),
      [
        [INVENTORY_OP.put, INVENTORY_TAB.consume, 5],
        [INVENTORY_OP.clear, INVENTORY_TAB.consume, 2],
      ],
      "the destination is put with the sum and the source is cleared",
    );
    const put = change.changes[0]!;
    const merged = put.op === INVENTORY_OP.put ? put.item : undefined;
    assert.ok(merged, "the first change carries the merged item");
    assert.equal("quantity" in merged ? merged.quantity : 0, 20);

    // The record itself merged: a relog reads back one stack of twenty and an empty slot 2.
    const consume = heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!;
    const recorded = consume.items.get(5);
    assert.equal(recorded && "quantity" in recorded ? recorded.quantity : 0, 20);
    assert.equal(consume.items.has(2), false);
  },
);

test(
  "a 204 scroll on a worn equip answers 0x0B with the upgraded item and the consumed scroll (c2s 0x1A)",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      // Standing monsters: this test counts packets by opcode, and a walking one would only add noise.
      mobTickMs: 10_000,
      dropPolicy: () => [],
      scrollSpec: scrollSpecProvider(archive!),
      // A deterministic roll that always lands under the scroll's success: this pass proves the win.
      scrollRandom: { next: () => 0, range: () => 0 },
      handshake: { clientSendSeed: 0x11223344, clientRecvSeed: 0x55667788 },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    // The hat is on the head (worn part 1), not in the bag: this is the browser's drag-onto-avatar
    // path, where the equip slot the client names is negative (FINDINGS 4.34.6).
    const heroRecord = characterDataOf(
      // hp: a dead character's bags are closed to every 0x17/0x1A (the native HP > 0 sender gate).
      { ...zeroStats(), id: 7, name: "Hero", hp: 50, maxHp: 50 },
      startingCharacterItems(),
    );
    heroRecord.items!.worn.set(1, equipSlot(1002000, { ruc: 3, pdd: 10, mdd: 5 }));
    // 02040001 is a 60% hat scroll (incPDD 2 + incMDD 1); 02043000 is a one-handed-sword scroll
    // (family 30) that must NOT fit a hat (family 0).
    heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.set(
      1,
      nonEquipSlot(2040001, 1),
    );
    heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.set(
      3,
      nonEquipSlot(2043000, 1),
    );

    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: heroRecord,
      }),
    });
    await hero.drain();

    // Apply the hat scroll (USE slot 1) to the worn hat (slot -1): c2s 0x1A [s16 scrollSlot][s16 equipSlot].
    const body = encodeClientScrollUpgrade({ scrollSlot: 1, equipSlot: -1 });
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.scrollUpgrade,
      body: body.slice(1),
    });

    // The answer is one 0x0B: the scroll leaves the USE tab and the upgraded hat is put back at -1.
    const saw = await hero.takeOpcode(INVENTORY_OPCODE);
    const change = readInventoryChange(new PacketReader(saw[saw.length - 1]!, 1));
    assert.deepEqual(
      change.changes.map((entry) => [entry.op, entry.inventory, entry.slot]),
      [
        [INVENTORY_OP.clear, INVENTORY_TAB.consume, 1],
        [INVENTORY_OP.put, INVENTORY_TAB.equip, -1],
      ],
      "the scroll is consumed (its single copy clears the slot) and the hat is put back worn",
    );
    const hatPut = change.changes[1]!;
    const hat = hatPut.op === INVENTORY_OP.put ? (hatPut.item as ItemSlotEquip) : undefined;
    assert.ok(hat, "the put carries the equip record");
    assert.equal(hat.itemId, 1002000);
    assert.equal(hat.ruc, 2, "one upgrade slot consumed");
    assert.equal(hat.cuc, 1, "one use recorded");
    assert.equal(hat.pdd, 12, "10 + incPDD 2 on a success");
    assert.equal(hat.mdd, 6, "5 + incMDD 1 on a success");
    assert.equal(hat.str, 0, "a field the scroll does not touch is untouched");

    // The record itself is upgraded, not a copy: a relog reads the scrolled hat back (ADR-017).
    const worn = heroRecord.items!.worn.get(1) as ItemSlotEquip;
    assert.equal(worn.pdd, 12);
    assert.equal(worn.ruc, 2);
    assert.equal(heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.has(1), false);
    assert.ok(
      log.some((line) => line.includes("0x1a scroll 2040001") && line.includes("success")),
      log.join("\n"),
    );

    // A sword scroll on the hat: the category gate refuses it with an empty 0x0B and the hat is whole.
    const mismatch = encodeClientScrollUpgrade({ scrollSlot: 3, equipSlot: -1 });
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.scrollUpgrade,
      body: mismatch.slice(1),
    });
    const refused = await hero.takeOpcode(INVENTORY_OPCODE);
    const empty = readInventoryChange(new PacketReader(refused[refused.length - 1]!, 1));
    assert.deepEqual(
      [empty.result, empty.changes],
      [1, []],
      "a category mismatch is an empty 0x0B",
    );
    assert.equal((heroRecord.items!.worn.get(1) as ItemSlotEquip).pdd, 12, "the hat is unchanged");
    assert.equal(
      heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.has(3),
      true,
      "the refused sword scroll is still in the bag",
    );
    assert.ok(
      log.some((line) => line.includes("0x1a scroll") && line.includes("does not fit")),
      log.join("\n"),
    );
  },
);

test(
  "a throw-away answers 0x0B and puts the item on the ground for the whole map (first pass)",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      // A monster with nothing to drop: the only thing that lands here is what the player throws.
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 500,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    // hp/maxHp are set because a dead character cannot discard: `handleChangeSlot` answers the
    // `0x17` with an empty refusal at hp<=0 (the gate f5d7924 introduced, ADR-100's map), and
    // `zeroStats()` is a corpse - the same fixture trap the cap and shop tests hit.
    const heroRecord = characterDataOf(
      { ...zeroStats(), id: 9, name: "Hero", hp: 50, maxHp: 50 },
      startingCharacterItems(),
    );
    heroRecord.items!.inventories[INVENTORY_TAB.consume - 1]!.items.set(
      4,
      nonEquipSlot(2000000, 10),
    );
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 9,
        characterName: "Hero",
        character: heroRecord,
      }),
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
      assert.equal(
        packet.length,
        15,
        "kind 2 is 15 bytes on the wire - no monster block (FINDINGS 4.18.2)",
      );
    };

    // Four of the ten go on the ground. The client's own sender is `sub_463BE0`: the tab and the slot
    // it was dragged from, `toSlot = 0`, and the number the player answered to "몇 개나 버리시겠습니까?".
    const throwAway = encodeClientChangeSlot({
      tab: INVENTORY_TAB.consume,
      fromSlot: 4,
      toSlot: 0,
      count: 4,
    });
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.changeSlot,
      body: throwAway.slice(1),
    });

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
    assert.equal(
      readDropAppear(new PacketReader(fromAlt[fromAlt.length - 1]!, 1)).dropId,
      drop.dropId,
    );
    assert.ok(
      log.some((line) => line.includes("dropped item 2000000 x4")),
      log.join("\n"),
    );

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
        path: {
          originX: 0,
          originY: 0,
          elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }],
        },
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
    const zero = encodeClientChangeSlot({
      tab: INVENTORY_TAB.consume,
      fromSlot: 4,
      toSlot: 0,
      count: 0,
    });
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: zero.slice(1) });
    const nothing = await hero.takeOpcode(INVENTORY_OPCODE);
    assert.deepEqual(
      readInventoryChange(new PacketReader(nothing[nothing.length - 1]!, 1)).changes,
      [],
    );
    assert.ok(
      log.some((line) => line.includes("refused (badCount)")),
      log.join("\n"),
    );
    assert.deepEqual(
      (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.appear),
      [],
      "a refused throw-away leaves the ground as it was",
    );
  },
);

test(
  "a shot goes out as 0x24 with the projectile id, and a cast as 0x25",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      // A monster with room for two hits, so both relays have a live target.
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 60,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
      dropPolicy: () => [],
      // Queued shot/cast hits settle on the field's own clock, so the tick stays fast; the roam
      // decision's stationary 0x33 that this brings along is legal field noise, and the bursts
      // below are asserted last-index (everything before the target packet must be noise).
      mobTickMs: 20,
      basicAttack: combatArt!.attackProfile,
      skills: skillCatalogOf(archive!),
      activeSkillArt: (id: number, level: number) => activeArt(combatArt!.reader!, id, level),
      handshake: { clientSendSeed: 0x11223344, clientRecvSeed: 0x55667788 },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    // The attacker owns a pile of arrows in consume slot 3 (which is what a shot's extra `u16`
    // names) and WEARS the bow the shot's admission looks the profile up by (worn slot 11 =
    // 1452000: group 3, speed tier 3, shoot action 22). hp/mp 50: the attack gate wants a living
    // character, and the cast phase's Energy Bolt (level 20) costs 14 mp.
    const heroItems = startingCharacterItems();
    heroItems.inventories[INVENTORY_TAB.consume - 1]!.items.set(3, nonEquipSlot(2060000, 100));
    heroItems.worn.set(11, equipSlot(1452000));
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Archer",
        character: characterDataOf(
          { ...zeroStats(), id: 7, name: "Archer", hp: 50, maxHp: 50, mp: 50, maxMp: 50 },
          heroItems,
        ),
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

    // The shot's selection geometry is a bounded server policy: the mob must sit inside the
    // weapon's own range (200 px with no archer skill learned) plus slop, and within 100 px
    // vertically of the shooter - so the hero first walks down onto the mob's own flat, from the
    // spawn's (100,190) to (400,300), instead of shooting across the map from the spawn.
    const approach = encodeClientUserMove({
      stageByte: 0,
      path: {
        originX: 0,
        originY: 0,
        elements: [
          { attr: 0, x: 400, y: 300, vx: 0, vy: 0, action: 0, foothold: 32, duration: 60 },
        ],
      },
    });
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.userMove, body: approach.slice(1) });

    // A shot: `0x10` carries the pile it used and 10 damage, facing right toward the mob, with the
    // bow profile's own action 22 and speed tier - the LIVE admission contract (ADR-103).
    const bowProfile = combatArt!.attackProfile!(1452000)!;
    const shotMotion = bowProfile.shoot[0]!;
    const shot = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: shotMotion.action,
        speed: bowProfile.speed,
        projectileSlot: 3,
        targets: [{ mobId: 1, hitAnimation: -1, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.shootAttack,
    );
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.shootAttack, body: shot.slice(1) });

    const altShot = await alt.takeOpcode(FIELD_OPCODE.userShootAttack);
    assert.ok(
      altShot
        .slice(0, -1)
        .every((bytes) => bytes[0] === MOB_OPCODE.move || bytes[0] === FIELD_OPCODE.userMove),
      "takeOpcode stops AT the first 0x24, so the observer sees the shot before the monster's " +
        `reaction and nothing of someone else's reward; only field noise may precede it, saw ` +
        `[${altShot.map((bytes) => bytes[0]).join(",")}]`,
    );
    const altSawHit = await alt.takeOpcode(MOB_OPCODE.stat);
    assert.equal(
      altSawHit[altSawHit.length - 1]![0],
      MOB_OPCODE.stat,
      "the monster's reaction follows the shot",
    );
    const relayedShot = readUserAttack(new PacketReader(altShot[altShot.length - 1]!, 1));
    assert.deepEqual(
      [
        relayedShot.characterId,
        relayedShot.facingLeft,
        relayedShot.action,
        relayedShot.hits,
        relayedShot.speed,
      ],
      [7, false, shotMotion.action, 1, bowProfile.speed],
      "0x24 is the shot the attacker reported: their id, their action, their speed (FINDINGS 4.11.7c)",
    );
    assert.equal(
      relayedShot.projectileItemId,
      2060000,
      "the slot the client named is relayed as the item id",
    );
    assert.deepEqual(relayedShot.targets, [{ mobId: 1, hitAnimation: -1, damages: [10] }]);
    // The attacker gets the world's reaction (and the `0x1C` about Alt joining, which was waiting), but
    // never its own shot back: its client drew that one as it built the packet.
    const heroSawShot = await hero.takeOpcode(MOB_OPCODE.stat);
    assert.equal(
      heroSawShot[heroSawShot.length - 1]![0],
      MOB_OPCODE.stat,
      "the attacker gets the monster's reaction",
    );
    assert.deepEqual(
      heroSawShot.filter(
        (bytes) =>
          bytes[0] === FIELD_OPCODE.userShootAttack || bytes[0] === FIELD_OPCODE.userAttack,
      ),
      [],
      "and nothing of its own attack back - it played that locally",
    );

    // The bow's own motion gates the next admitted attack for its duration (870 ms), so the cast
    // waits the gate out instead of being silently refused by it.
    await new Promise((resolve) => setTimeout(resolve, 950));

    // A cast: Energy Bolt (2001004) at level 20 - the magic path validates against the CASTER's
    // weapon profile (only groups 1/6 carry the magic actions 28/29 - the sword's), needs the
    // learned skill in the record's map32, exact hits (attackCount 1) and the profile's own magic
    // speed. The session mutates this very record object in place, so dressing the hero in the
    // sword and writing the learned skill into map32 is the test's equip/skill-up seam - what a
    // real player would reach through the inventory and SP windows. `0x11`'s header has no slot, so
    // the projectile field goes out as the neutral 0. The reported y is the IMPACT point at the
    // mob's body height (ground 300 - MAGIC_HEIGHT 25), not its foot root: a ray that ends exactly
    // on the foothold line clips the very ground the mob stands on (`clipMagicRay` fraction 1).
    heroItems.worn.set(11, equipSlot(1302000));
    heroItems.map32 = [{ key: 2001004, value: 20 }];
    const castProfile = combatArt!.attackProfile!(1302000)!;
    const castMotion = castProfile.magic!.find((motion) => motion.action === 28)!;
    const cast = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 2001004,
        facingLeft: false,
        action: castMotion.action,
        speed: activeMagicSpeed(castProfile),
        targets: [{ mobId: 1, hitAnimation: 3, x: 509, y: 275, sequence: 2, damages: [9] }],
      },
      CLIENT_FIELD_OPCODE.magicAttack,
    );
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.magicAttack, body: cast.slice(1) });

    const altCast = await alt.takeOpcode(FIELD_OPCODE.userMagicAttack);
    assert.ok(
      altCast.slice(0, -1).every((bytes) => bytes[0] === MOB_OPCODE.move),
      "takeOpcode stops AT the first 0x25 - a cast never goes out as the shot's opcode, and only " +
        `the field's own roam noise may precede it, saw [${altCast.map((bytes) => bytes[0]).join(",")}]`,
    );
    const relayedCast = readUserAttack(new PacketReader(altCast[altCast.length - 1]!, 1));
    assert.deepEqual(
      [
        relayedCast.characterId,
        relayedCast.action,
        relayedCast.speed,
        relayedCast.projectileItemId,
      ],
      [7, castMotion.action, activeMagicSpeed(castProfile), 0],
      "and its projectile field is the neutral 0: there is no slot in the packet to look up",
    );
    assert.deepEqual(relayedCast.targets, [{ mobId: 1, hitAnimation: 3, damages: [9] }]);
    assert.ok(
      log.some((line) => line.includes('0x24 attack of "Archer"') && line.includes("1 target(s)")),
      log.join("\n"),
    );
    assert.ok(
      log.some((line) => line.includes('0x25 attack of "Archer"')),
      log.join("\n"),
    );
  },
);

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
    client.send({
      kind: "check-name",
      opcode: 0x06,
      name,
      appearance: [20000, 30030, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10],
    });
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
test(
  "a portal moves a player to another map, and the map they left hears about it",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) =>
        mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : undefined,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    assert.equal(
      release[0]![0],
      FIELD_OPCODE.requestRelease,
      "the release byte answers every 0x0D",
    );
    const jumps = (await alt.drain()).filter((bytes) => bytes[0] === FIELD_OPCODE.setField);
    assert.deepEqual(jumps, [], "an unknown portal is not a teleport");
    assert.ok(
      log.some((line) => line.includes('"nowhere" is no portal of map 1000000')),
      log.join("\n"),
    );

    // The real one. `tm` of the map's own portal is where it leads, so the answer is a new field.
    alt.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.interact,
      body: encodeClientInteract({ kind: INTERACT_KIND_CURSOR, name: "west00" }).slice(1),
    });
    const moved = await alt.take(4);
    assert.deepEqual(
      moved.map((bytes) => bytes[0]),
      [
        FIELD_OPCODE.requestRelease,
        FIELD_OPCODE.setField,
        MOB_OPCODE.enterField,
        NPC_OPCODE.enterField,
      ],
      "release byte, then the destination map and its world",
    );
    const arrived = readSetField(new PacketReader(moved[1]!, 1));
    assert.equal(
      arrived.character.stats.mapId,
      2000000,
      "the record the client holds now names the new map",
    );
    assert.deepEqual([arrived.character.stats.id, arrived.character.stats.name], [8, "Alt"]);

    // The map the player left: one 0x1D, and nothing else - the two players are in two maps now.
    const left = await hero.takeOpcode(FIELD_OPCODE.userLeaveField);
    assert.equal(
      new PacketReader(left[left.length - 1]!, 1).readU32(),
      8,
      "exactly the character that walked through the portal",
    );
    const otherFieldNews = (await hero.drain()).filter(
      (bytes) =>
        bytes[0] === FIELD_OPCODE.userEnterField || bytes[0] === FIELD_OPCODE.userLeaveField,
    );
    assert.deepEqual(otherFieldNews, [], "a field does not report what another field is doing");

    // Where a player enters is their own record: this one names map 2000000, so that is the field the
    // new connection is put into - and the player who took the portal is in it.
    const guest = await FakeClient.connect(gameInfo.port);
    t.after(() => guest.close());
    const record = characterDataOf(
      {
        ...zeroStats(),
        id: 9,
        name: "Guest",
        mapId: 2000000,
        level: 1,
        hp: 50,
        maxHp: 50,
        mp: 50,
        maxMp: 50,
      },
      startingCharacterItems(),
    );
    guest.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 9,
        characterName: "Guest",
        character: record,
      }),
    });
    const guestBurst = await guest.takeOpcode(FIELD_OPCODE.userEnterField);
    assert.deepEqual(
      guestBurst.map((bytes) => bytes[0]),
      [
        FIELD_OPCODE.setField,
        MOB_OPCODE.enterField,
        NPC_OPCODE.enterField,
        FIELD_OPCODE.userEnterField,
      ],
      "the record\'s map, its world, then who is in it",
    );
    assert.equal(readSetField(new PacketReader(guestBurst[0]!, 1)).character.stats.mapId, 2000000);
    const aboutAlt = readUserEnterField(new PacketReader(guestBurst[3]!, 1));
    assert.deepEqual(
      [aboutAlt.characterId, aboutAlt.name, aboutAlt.x, aboutAlt.y, aboutAlt.foothold],
      [8, "Alt", 600, 290, 32],
      "the player who took the portal is at the destination\'s own portal, on its foothold",
    );

    // ... and the one who was there hears the newcomer, the same way as in any other map.
    const altSaw = await alt.takeOpcode(FIELD_OPCODE.userEnterField);
    assert.equal(
      readUserEnterField(new PacketReader(altSaw[altSaw.length - 1]!, 1)).characterId,
      9,
    );
    assert.ok(
      log.some((line) => line.includes('"Alt" uses portal "west00" of map 1000000 -> 2000000')),
      log.join("\n"),
    );
  },
);

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
test(
  "a revive restores HP and re-enters a field: the return map if it can be read, the same map otherwise",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) =>
        mapId === 1000000
          ? STUB_MAP
          : mapId === 2000000
            ? STUB_MAP_ALT
            : mapId === 1010000
              ? STUB_MAP_TOWN
              : undefined,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: hurt(7, "Hero", 1000000),
      }),
    });
    const wounded = readSetField(new PacketReader((await hero.take(1))[0]!, 1));
    assert.equal(
      wounded.character.stats.hp,
      1,
      "the record enters the field as it is - a hurt 1/50",
    );

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
    assert.equal(
      release[0]![0],
      FIELD_OPCODE.requestRelease,
      "the release byte answers a revive too",
    );
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
        (opcode) =>
          opcode === FIELD_OPCODE.userLeaveField || opcode === FIELD_OPCODE.userEnterField,
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
    assert.equal(
      readUserEnterField(new PacketReader(sawHero[sawHero.length - 1]!, 1)).characterId,
      7,
    );

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
    assert.equal(
      again.character.stats.mapId,
      1010000,
      "an unreadable return map re-enters the map they are in",
    );
    assert.equal(again.character.stats.hp, 50);
    assert.ok(
      log.some((line) => line.includes('"Hero" revives - hp 50/50, map 1010000 -> 1010001')),
      log.join("\n"),
    );
    assert.ok(
      log.some((line) => line.includes("map 1010001 has no Map/Map/*.img")),
      log.join("\n"),
    );
    assert.deepEqual(
      (await latecomer.drainOpcodes()).filter(
        (opcode) =>
          opcode === FIELD_OPCODE.userLeaveField || opcode === FIELD_OPCODE.userEnterField,
      ),
      [FIELD_OPCODE.userLeaveField, FIELD_OPCODE.userEnterField],
      "the town sees them leave and arrive again",
    );
  },
);

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
test(
  "a monster's damage lands because the client reports it: c2s 0x1C in, 0x0D out",
  { timeout: 20000 },
  async (t) => {
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
    assert.deepEqual(
      statDiffs(await client.drain()),
      [],
      "a report that changes nothing is not answered",
    );

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
    assert.equal(
      revived.character.stats.hp,
      50,
      "the revive refills the HP that was reported away",
    );
    assert.equal(revived.character.stats.mp, 8, "and leaves the MP alone");
    assert.equal(revived.character.stats.mapId, 1010000, "still the map info/returnMap names");
  },
);

/**
 * Chat (FINDINGS 4.26): the client's `0x12` is relayed to the map as `0x1A` + sub-op `0x12` + the
 * speaker's name + the same bytes.
 *
 * The two things worth a test are the two that a "reasonable" implementation gets wrong:
 *
 *  - **the speaker is included**. `sub_470C70` only builds and sends the packet - there is no local
 *    echo anywhere in the chat input path - and 50B320 appends the log on receipt of the 0x1F balloon packet. Skipping the sender would leave players unable to read their own words.
 *  - **it does not leave the map**. Chat is field-scoped (`CUserPool` opcode0x1F), so a player in
 *    another map is not a listener, and the text is passed through as bytes - the server never has to
 *    decode what it is relaying.
 */
test(
  "chat reaches everyone in the map, the speaker included, and stays in it",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) =>
        mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : undefined,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
      {
        ...zeroStats(),
        id: 9,
        name: "Guest",
        mapId: 2000000,
        level: 1,
        hp: 50,
        maxHp: 50,
        mp: 50,
        maxMp: 50,
      },
      startingCharacterItems(),
    );
    guest.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 9,
        characterName: "Guest",
        character: record,
      }),
    });
    await guest.takeOpcode(FIELD_OPCODE.setField);

    // Hero says hello, in the CP949 bytes the chat box produced.
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.chat,
      body: encodeClientChat({ text: encodeCp949("안녕") }).slice(1),
    });
    const altSaw = await alt.takeOpcode(FIELD_OPCODE.userBalloon);
    const heard = readUserBalloon(new PacketReader(altSaw[altSaw.length - 1]!, 1));
    assert.deepEqual(
      [heard.characterId, toHex(heard.text)],
      [7, "bec8b3e7"],
      "the other player hears the speaker's name and the bytes they typed",
    );
    const heroSaw = await hero.takeOpcode(FIELD_OPCODE.userBalloon);
    assert.deepEqual(
      readUserBalloon(new PacketReader(heroSaw[heroSaw.length - 1]!, 1)),
      heard,
      "and so does the speaker - the client only ever renders what it receives",
    );

    // A second line from the other player: the name is the session's, so it changes with the speaker.
    alt.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.chat,
      body: encodeClientChat({ text: Uint8Array.from([0x68, 0x69]) }).slice(1),
    });
    const heroSawAlt = await hero.takeOpcode(FIELD_OPCODE.userBalloon);
    assert.deepEqual(
      [
        readUserBalloon(new PacketReader(heroSawAlt[heroSawAlt.length - 1]!, 1)).characterId,
        toHex(readUserBalloon(new PacketReader(heroSawAlt[heroSawAlt.length - 1]!, 1)).text),
      ],
      [8, "6869"],
      "the same opcode, the other speaker",
    );

    // The map 2000000 player: a field of their own, so the line is not theirs to hear.
    assert.equal(
      (await guest.drainOpcodes()).includes(FIELD_OPCODE.userBalloon),
      false,
      "chat does not leave the map it was said in",
    );
    assert.equal(
      hero.headersOk && alt.headersOk && guest.headersOk,
      true,
      "every packet survives the cipher/header check",
    );
    assert.ok(
      log.some((line) => line.includes('chat "Hero": 안녕 in map 1000000')),
      log.join("\n"),
    );
    assert.ok(
      log.some((line) => line.includes('chat "Alt": hi in map 1000000')),
      log.join("\n"),
    );
  },
);

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
test(
  "a level-up plays the effect for the other players (0x29), not for the one who levelled",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 20,
        speedPercent: 0,
        dieMs: 0,
      }),
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
    // The LIVE admission contract: the record wears the sword the profile is looked up by.
    const heroItems = startingCharacterItems();
    heroItems.worn.set(11, equipSlot(1302000));
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: characterDataOf(stats, heroItems),
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

    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swing = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swing.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });

    // The relay, the kill burst and the effect are one synchronous answer to the swing; the only
    // packet that may legally sit between them is the roam decision's own stationary 0x33.
    const altSaw = (await alt.takeOpcode(FIELD_OPCODE.userEffect)).filter(
      (bytes) => bytes[0] !== MOB_OPCODE.move,
    );
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

    // The attacker: their own 0x0D (level 2, and the refill that comes with it), and no 0x29. The
    // level-up growth is server-owned RNG (job 0's row: maxHp +20..25, maxMp +10..12 - see the
    // kill-exp test), so the maxima are asserted inside the native range and the refill exactly.
    const heroSaw = await hero.takeOpcode(STAT_OPCODE);
    const payout = readStatUpdate(new PacketReader(heroSaw[heroSaw.length - 1]!, 1));
    assert.equal(payout.ack, false);
    const diff = payout.diff!;
    assert.equal(diff.level, 2);
    assert.equal(diff.exp, 5);
    assert.ok(
      diff.maxHp! >= 50 + 20 && diff.maxHp! <= 50 + 25,
      `maxHp grew inside the beginner row's 20..25, got ${diff.maxHp}`,
    );
    assert.ok(
      diff.maxMp! >= 50 + 10 && diff.maxMp! <= 50 + 12,
      `maxMp grew inside the beginner row's 10..12, got ${diff.maxMp}`,
    );
    assert.equal(diff.hp, diff.maxHp, "the refill lands on the grown maximum");
    assert.equal(diff.mp, diff.maxMp);
    assert.deepEqual(
      Object.keys(diff).sort(),
      ["exp", "hp", "level", "maxHp", "maxMp", "mp"],
      "the diff is exactly the bar, the level, the grown maxima and the refill",
    );
    const effectsForHero = (await hero.drain()).filter(
      (bytes) => bytes[0] === FIELD_OPCODE.userEffect,
    );
    assert.deepEqual(effectsForHero, [], "the effect is not echoed to the player who levelled");
    assert.ok(
      log.some((line) =>
        line.includes('0x29 level-up effect for "Hero" sent to 1 other player(s)'),
      ),
      log.join("\n"),
    );
  },
);

test(
  "an emotion (0x13) reaches the rest of the field as 0x27 and is not echoed",
  { timeout: 20000 },
  async (t) => {
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
    assert.deepEqual(
      await hero.drain(),
      [],
      "the sender gets nothing back: the face is already on",
    );
    assert.ok(
      log.some(
        (line) => line.includes("0x27 emotion 3 (troubled)") && line.includes("1 other player(s)"),
      ),
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
    assert.ok(
      log.some((line) => line.includes("0x13 emotion unreadable") && line.includes("not a face")),
      log.join("\n"),
    );
  },
);

/**
 * A session that ends writes the character back to the save.
 *
 * The point of a save is not the file: it is that what happened in a field is still there tomorrow.
 * Exp, level, hp and the items all change *in place* on the `CharacterData` the login server handed
 * over - the same object the account table holds - so "persist when the session ends" is the whole
 * save. This test walks the loop an operator would: a character enters, kills the mob, disconnects,
 * and what comes out of the store is the record the client was last told about in `0x0D`.
 */
test(
  "a session that ends leaves the character's progress in the save",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const store = new MemorySaveStore();
    let saves = 0;
    // The table *is* the world: the record the game server is handed is the one in here, which is what
    // `LoginServerOptions.accounts` means and what the CLI's `persist` closure saves.
    const accounts = new Map<string, AccountRecord>([
      ["admin", { password: "admin", characters: [] }],
    ]);
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      basicAttack: combatArt!.attackProfile,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 20,
        speedPercent: 0,
        dieMs: 0,
      }),
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
    // The LIVE admission contract: the saved record wears the sword the swing is validated against,
    // and the save round-trip below carries that worn equip like any other.
    const items = startingCharacterItems();
    items.worn.set(11, equipSlot(1302000));
    const record = characterDataOf(stats, items);
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

    const swordProfile = combatArt!.attackProfile!(1302000)!;
    const swing = swordProfile.melee[0]!;
    const attack = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: 0,
        facingLeft: false,
        action: swing.action,
        speed: swordProfile.speed,
        targets: [{ mobId: 1, hitAnimation: 7, x: 509, y: 300, sequence: 1, damages: [10] }],
      },
      CLIENT_FIELD_OPCODE.attack,
    );
    client.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.attack, body: attack.slice(1) });
    // The kill burst resolves on the motion's release clock and is one synchronous batch (the mob's
    // stat, the death, the payout); the roam decision's stationary 0x33 is the only legal noise in
    // front of it, so the payout is located by opcode and the burst is asserted inside what led up
    // to it. The corpse (dieMs 0) walks on the NEXT tick and cannot slip into the batch.
    const payout = await client.takeOpcode(STAT_OPCODE);
    assert.deepEqual(
      payout
        .slice(0, -1)
        .filter((bytes) => bytes[0] !== MOB_OPCODE.move)
        .map((bytes) => bytes[0]),
      [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed],
      "the mob's stat and the death ride right before the payout",
    );
    const stat = payout[payout.length - 1]!;
    const told = readStatUpdate(new PacketReader(stat, 1));
    // characterDataOf COPIES the stat block into the record, so the object the field mutates in
    // place is `record.stats` - the very one the account table holds and the save writes - not the
    // local literal the record was built from.
    assert.ok(record.stats.maxHp >= 70 && record.stats.maxHp <= 75);
    assert.ok(record.stats.maxMp >= 40 && record.stats.maxMp <= 42);
    assert.deepEqual(
      told.diff,
      {
        exp: 15,
        level: 2,
        hp: record.stats.maxHp,
        maxHp: record.stats.maxHp,
        mp: record.stats.maxMp,
        maxMp: record.stats.maxMp,
      },
      "the growth diff is persisted immediately",
    );

    // Kill rewards persist immediately; leaving still saves the same authoritative record.
    assert.ok(saves >= 1, "growth is durable while the session is open");
    const savesBeforeClose = saves;
    client.close();
    const deadline = Date.now() + 2000;
    while (saves === savesBeforeClose && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      saves,
      savesBeforeClose + 1,
      `the session ending saved once; log:\n${log.join("\n")}`,
    );

    // What the store holds is the character as they left: the level-up, the refill that came with it,
    // and the rest of the record untouched.
    const saved = loadAccounts(store, new Map()).get("admin")!.characters[0]!;
    assert.equal(saved.stats.name, "Fighter");
    assert.equal(saved.stats.id, 21);
    assert.equal(saved.stats.level, 2);
    assert.equal(saved.stats.exp, 15);
    assert.equal(saved.stats.hp, told.diff.maxHp);
    assert.equal(saved.stats.maxHp, told.diff.maxHp);
    assert.equal(saved.stats.mp, told.diff.maxMp);
    assert.equal(saved.stats.maxMp, told.diff.maxMp);
    assert.equal(saved.stats.ap, 0);
    assert.equal(saved.stats.mesos, 500);
    assert.equal(saved.items?.inventories.length, 4, "the bags came back too");
  },
);

/**
 * The whole reason a save exists: the next run of the server is the same world.
 *
 * Two login servers in one test, one store: the first run creates a character over a real socket
 * (0x04 -> 0x01 -> 0x02 -> 0x06 -> 0x05), and the second one - a fresh `LoginServer` over the same
 * store, seeded with a *different* password for the same user - sees that character in the 0x02
 * character list. The seed losing is the point: the save file is the world, and `--account` is only
 * what a first run starts from.
 */
test(
  "the world comes back after a restart: the save file is the accounts",
  { timeout: 20000 },
  async (t) => {
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
    create.send({
      kind: "check-name",
      opcode: 0x06,
      name: "Hero",
      appearance: [20000, 30030, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10],
    });
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
    const reloaded = loadAccounts(
      store,
      new Map([["admin", { password: "not-the-password", characters: [] }]]),
      (line) => log.push(line),
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
  },
);

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
test(
  "whisper and find reach a player by name, across maps, and answer the asker",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) =>
        mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? STUB_MAP_ALT : undefined,
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
      {
        ...zeroStats(),
        id: 9,
        name: "Guest",
        mapId: 2000000,
        level: 1,
        hp: 50,
        maxHp: 50,
        mp: 50,
        maxMp: 50,
      },
      startingCharacterItems(),
    );
    guest.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 9,
        characterName: "Guest",
        character: record,
      }),
    });
    await guest.takeOpcode(FIELD_OPCODE.setField);

    // Hero whispers Guest, who is in the other map. The text is CP949 bytes, exactly as typed.
    const sendWhisper = (name: string, text: string) =>
      encodeClientUserRequest({
        kind: USER_REQUEST_KIND.whisper,
        name,
        text: encodeCp949(text),
      }).slice(1);
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
      'and the asker gets the target\'s **stored** name - typed as "guest", answered as "Guest"',
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
      body: encodeClientUserRequest({
        kind: USER_REQUEST_KIND.whisper,
        name: "Nobody",
        text: Uint8Array.from([0x68]),
      }).slice(1),
    });
    const notFound = await hero.takeOpcode(FIELD_OPCODE.userMessage);
    assert.deepEqual(readUserWhisperAnswer(new PacketReader(notFound[notFound.length - 1]!, 1)), {
      name: "Nobody",
      delivered: false,
    });

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

    // SOURCE UPDATED for ADR-059: refresh the real delivery immediately before the 3s refusal window.
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.userRequest,
      body: encodeClientUserRequest({
        kind: USER_REQUEST_KIND.whisper,
        name: "Guest",
        text: encodeCp949("again"),
      }).slice(1),
    });
    await guest.takeOpcode(FIELD_OPCODE.userMessage);
    await hero.takeOpcode(FIELD_OPCODE.userMessage);
    guest.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.userRequest,
      body: encodeClientUserRequest({
        kind: USER_REQUEST_KIND.refuseWhisper,
        name: "Hero",
        text: encodeCp949("Guest"),
      }).slice(1),
    });
    const refused = await hero.takeOpcode(FIELD_OPCODE.userMessage);
    assert.deepEqual(readUserWhisperRefused(new PacketReader(refused.at(-1)!, 1)), {
      name: "Guest",
    });
    // A forged own-name or unsolicited refusal must not notify anybody.
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.userRequest,
      body: encodeClientUserRequest({
        kind: USER_REQUEST_KIND.refuseWhisper,
        name: "Alt",
        text: encodeCp949("Guest"),
      }).slice(1),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal((await alt.drainOpcodes()).includes(FIELD_OPCODE.userMessage), false);

    assert.equal(
      hero.headersOk && alt.headersOk && guest.headersOk,
      true,
      "every packet survives the cipher/header check",
    );
    assert.ok(
      log.some((line) => line.includes('whisper "Hero" -> "Guest": 안녕')),
      log.join("\n"),
    );
    assert.ok(
      log.some((line) => line.includes('find "Alt" -> "Alt" in map 1000000')),
      log.join("\n"),
    );
    assert.ok(
      log.some((line) => line.includes('whisper "Hero" -> "Nobody": no such player')),
      log.join("\n"),
    );
  },
);

test(
  "using a USE-tab item: 0x18 restores and consumes it, 0x19 changes the map",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
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
        // 4B3780: every WZ shop also carries the eight rechargeable star rows at price 0 - the
        // client files them into its recharge list, never into the buy list (the buy handler
        // below validates its row against the price-nonzero filter of the very same rows).
        [2070000, 0],
        [2070001, 0],
        [2070002, 0],
        [2070003, 0],
        [2070004, 0],
        [2070005, 0],
        [2070006, 0],
        [2070007, 0],
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

    // The use gate refuses while a shop is open ("never consume a stack that is being offered in
    // a trade" - the speed-potion round's server safety policy, same family as the drag/scroll
    // gates), and a close is deliberately unanswered - so drain, then drink: this is the player's
    // own flow, shopping first, closing the window, hotkeying the potion.
    client.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "close" }).slice(1),
    });
    assert.deepEqual(await client.drainOpcodes(120), [], "a close is not answered");

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
    assert.deepEqual(
      drank.map((bytes) => bytes[0]),
      [INVENTORY_OPCODE, STAT_OPCODE],
    );
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
    assert.deepEqual(readStatUpdate(new PacketReader((await client.take(1))[0]!, 1)).diff, {
      hp: 20,
    });

    // The last potion: the stack empties, so the change is a `clear`.
    use(potionSlot, 2000000, CLIENT_FIELD_OPCODE.useItem);
    const emptied = await client.take(2);
    assert.equal(
      readInventoryChange(new PacketReader(emptied[0]!, 1)).changes[0]!.op,
      INVENTORY_OP.clear,
    );
    assert.deepEqual(readStatUpdate(new PacketReader(emptied[1]!, 1)).diff, { hp: 50 });

    // Now the slot is empty and the bar is not full: the packet claims an item the server's own
    // inventory does not have, and the server - not the packet - is what decides.
    hit(30);
    await client.take(1);
    use(potionSlot, 2000000, CLIENT_FIELD_OPCODE.useItem);
    assert.equal(
      readInventoryChange(new PacketReader((await client.take(1))[0]!, 1)).changes.length,
      0,
    );
    assert.ok(
      log.some((line) =>
        line.includes(`slot ${potionSlot} of the USE tab does not hold item 2000000`),
      ),
      log.join("\n"),
    );

    // The scroll: 마을 귀환 주문서's own `spec/moveTo = -1` is read with the map's `info/returnMap`
    // (STUB_MAP says 1010000), and the map change is the same `0x16` a portal sends.
    use(scrollSlot, 2030000, CLIENT_FIELD_OPCODE.useMapItem);
    const jumped = await client.take(2);
    assert.deepEqual(
      jumped.map((bytes) => bytes[0]),
      [INVENTORY_OPCODE, FIELD_OPCODE.setField],
    );
    assert.equal(
      readInventoryChange(new PacketReader(jumped[0]!, 1)).changes[0]!.op,
      INVENTORY_OP.clear,
      "a scroll is used up",
    );
    const entered = readSetField(new PacketReader(jumped[1]!, 1));
    assert.equal(entered.character.stats.mapId, 1010000, "the ground under the player changed");
    assert.ok(
      log.some(
        (line) =>
          line.includes("0x19 map item") && line.includes("map 1000000 -> 1010000 (moveTo -1)"),
      ),
      log.join("\n"),
    );

    // The slot is empty again, and this time the item cannot even name a map: the refusal comes before
    // anything is taken (the town's own `returnMap` here is a map no provider knows).
    use(scrollSlot, 2030000, CLIENT_FIELD_OPCODE.useMapItem);
    assert.equal(
      readInventoryChange(new PacketReader((await client.take(1))[0]!, 1)).changes.length,
      0,
    );
    assert.deepEqual(await client.drainOpcodes(120), [], "no second 0x16");
  },
);

/**
 * The shop's recharge service over real sockets (`0x16` action 2 → `sub_4B7130`'s packet).
 *
 * A partial star set in the USE tab is what the page's 충전 button sends: the server re-reads the
 * real slot, charges ceil(missing × WZ unitPrice) and answers the way every successful trade does -
 * `0x4B` silent, `0x0B` put with the full set, `0x0D` for the wallet - then persists. A refusal is
 * exactly one `0x4B` and nothing else, which is what keeps the client's in-flight gate honest.
 */
test(
  "recharge over the wire: a partial star set fills to slotMax, and every ask gets its 0x4B",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      shops: shopKeeper(archive!),
      consumeSpec: consumeSpecProvider(archive!),
      mobTickMs: 10_000,
      handshake: { clientSendSeed: 0x55aa55aa, clientRecvSeed: 0xaa55aa55 },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const stats = zeroStats();
    stats.id = 52;
    stats.name = "Thrower";
    stats.level = 1;
    stats.hp = 50;
    stats.maxHp = 50;
    stats.mesos = 500;
    const items = startingCharacterItems();
    items.inventories[1]!.items.set(1, nonEquipSlot(2070000, 100)); // a partial 수비 표창 set

    const client = await FakeClient.connect(gameInfo.port);
    t.after(() => client.close());
    client.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 52,
        characterName: "Thrower",
        character: characterDataOf(stats, items),
      }),
    });
    await client.drain();

    // 로빈's shop (STUB_MAP objectId 1): the 0x4A rows carry the eight recharge rows, and the
    // 2070000 one carries its per-charge float in the 8 bytes where a cash serial would sit.
    client.send({
      kind: "unknown",
      opcode: CLIENT_OBJECT_CLICK_OPCODE,
      body: encodeClientObjectClick({ objectId: 1 }).slice(1),
    });
    const opened = await client.take(2);
    assert.equal(opened[1]![0], SHOP_OPEN_OPCODE);
    const starRow = readShopOpen(new PacketReader(opened[1]!, 1)).items.find(
      (line) => line.itemId === 2070000,
    )!;
    assert.equal(starRow.price, 0, "a price-0 row is recharge-only");
    assert.equal(starRow.maxCount, 500, "the WZ slotMax is the row's cap");
    assert.equal(
      shopRechargeUnitPrice(starRow),
      0.3,
      "the 8 extra bytes are the unit-price double",
    );

    // The recharge itself: slot 1 of the USE tab, 400 charges missing, ceil(400 × 0.3) = 120.
    client.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "recharge", slot: 1 }).slice(1),
    });
    const trade = await client.take(3);
    assert.deepEqual(
      trade.map((bytes) => bytes[0]),
      [SHOP_RESULT_OPCODE, INVENTORY_OPCODE, STAT_OPCODE],
      "the silent result, the full set, the wallet",
    );
    assert.equal(readShopResult(new PacketReader(trade[0]!, 1)), SHOP_RESULT.silent);
    const change = readInventoryChange(new PacketReader(trade[1]!, 1)).changes[0]!;
    assert.equal(change.op, INVENTORY_OP.put);
    assert.equal(change.inventory, 2, "the USE tab");
    assert.equal(change.slot, 1);
    assert.ok(
      change.op === INVENTORY_OP.put && change.item.kind === "nonequip",
      "the set is still a plain nonequip - no cash block was involved",
    );
    assert.equal(change.item.itemId, 2070000);
    assert.equal(change.item.quantity, 500);
    assert.deepEqual(readStatUpdate(new PacketReader(trade[2]!, 1)).diff, { mesos: 380 });
    assert.ok(
      log.some((line) => line.includes("shop 2003 recharged 2070000 x400 at 0.3 (total 120")),
      log.join("\n"),
    );

    // The set is full now: recharging again is badRequest, and the refusal is one 0x4B (the
    // client's default "오류가 발생해 거래를 하지 못했습니다") with no inventory or stat packet.
    client.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "recharge", slot: 1 }).slice(1),
    });
    const refused = await client.take(1);
    assert.equal(refused[0]![0], SHOP_RESULT_OPCODE);
    assert.equal(readShopResult(new PacketReader(refused[0]!, 1)), SHOP_RESULT.error);
    assert.equal((await client.drainOpcodes(120)).length, 0, "a refusal is a single packet");

    // A slot that holds nothing: notEnoughItems ("물품이 부족합니다"), also a single packet.
    client.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "recharge", slot: 7 }).slice(1),
    });
    const missing = await client.take(1);
    assert.equal(readShopResult(new PacketReader(missing[0]!, 1)), SHOP_RESULT.notEnoughItems);
    assert.equal((await client.drainOpcodes(120)).length, 0);
  },
);

/**
 * The inventory window's drag, over real sockets (FINDINGS 4.36, ADR-029).
 *
 * The client moves nothing itself (`sub_55ACB0` only builds the packet and arms a one-request gate), so
 * the window follows the server's `0x0B` and only that - which is why both halves matter here: the `put`
 * at the **negative slot** of the equip tab, which is what wears the cap, and the `0x28` the rest of the
 * map gets so that everybody's copy of this player's look changes. The wearer is not sent their own
 * `0x28`: their client draws them from the record it holds.
 */
test(
  "equipping a cap answers 0x0B for the wearer and 0x28 for the rest of the map (second pass, ADR-029 real sockets)",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      // The trust-boundary admission (canEquipItem) reads the archive's own requirements: without a
      // catalog every wear is refused. The cap is the level-0, job-0, non-cash 위젯 무적 모자 (1002140),
      // which the bare fixture hero can wear - the shipped 1002000 is a cash Lv20 thief hat.
      itemCatalog: itemCatalogOf(archive!),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    const heroItems = withWorn(
      startingCharacterItems(),
      wornOfLook([20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 10]),
    );
    heroItems.inventories[INVENTORY_TAB.equip - 1]!.items.set(2, equipSlot(1002140));
    const heroRecord = characterDataOf(
      // hp: a dead character's bags are closed to every 0x17 (the native HP > 0 sender gate).
      { ...zeroStats(), id: 7, name: "Hero", hp: 50, maxHp: 50 },
      heroItems,
    );
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 7,
        characterName: "Hero",
        character: heroRecord,
      }),
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
    assert.equal(
      aboutHero.avatarItems?.includes(1002140),
      false,
      "the cap is in the bag, not on the head",
    );
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);

    // Double-clicking the cap: `sub_4636B0` sends tab 1, the bag slot, the part its caller read off the
    // item id (1002140 -> a hat -> part 1, written the way a worn slot is: negative) and -1 for "all of it".
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
      1002140,
      "the put carries the item that moved",
    );
    assert.equal(change.result, 1, "the result byte is the client's own timing flag, not a status");

    // Everybody else: one `0x28` with the new list and no face (flags 0 means \"the head did not change\"),
    // and the wearer gets none - their client already drew it.
    const lookPacket = await alt.takeOpcode(FIELD_OPCODE.userLook);
    const look = readUserLook(new PacketReader(lookPacket[lookPacket.length - 1]!, 1));
    assert.deepEqual(
      [look.characterId, look.face, look.avatarItems],
      [7, undefined, [30000, 1040001, 1060001, 1071000, 1302000, 1002140]],
      "the list is the avatarItems a 0x1C would have carried",
    );
    assert.deepEqual(
      (await hero.drainOpcodes(200)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
      [],
      "the wearer is not echoed their own look",
    );

    // The record itself moved (this is the object the account table holds, ADR-017): the worn part is the
    // cap now, and the bag slot it came from is empty.
    assert.equal(heroRecord.items!.worn.get(1)?.itemId, 1002140);
    assert.equal(heroRecord.items!.inventories[INVENTORY_TAB.equip - 1]!.items.has(2), false);

    // The same drag again, now that slot 2 is empty: nothing moves, and the answer is still a `0x0B` -
    // an empty one. `sub_55ACB0` armed the client's one-request gate as it sent, and only a `0x0B` clears
    // it, so a refusal that stayed silent would freeze the whole window (FINDINGS 4.6).
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: equip.slice(1) });
    const refused = await hero.takeOpcode(INVENTORY_OPCODE);
    assert.deepEqual(
      readInventoryChange(new PacketReader(refused[refused.length - 1]!, 1)).changes,
      [],
    );
    assert.ok(
      log.some((line) => line.includes("refused (emptySlot)")),
      log.join("\n"),
    );
    assert.deepEqual(
      (await alt.drainOpcodes(150)).filter((opcode) => opcode === FIELD_OPCODE.userLook),
      [],
      "and a refused drag tells the map nothing",
    );
  },
);

/**
 * The coin button's wire chain (`0x1F`, `sub_55D5F0`; MESO_RECHARGE.md, ADR-101 follow-up).
 *
 * One LE u32 amount is the whole request, and every number in it is the server's: the native input
 * dialog's bounds (10‥50000, `sub_4DAF70`), the wallet, the 200ms sender-side rate, and the mutual
 * exclusion with an open shop, conversation or trade. A success is `0x0D ack1` with the wallet - the
 * ack1 is what releases the client's pending gate - plus the field's own `0x43` for the whole map,
 * because player money is a placed reward like any drop (real-fh landing is drop-landing's subject).
 * A refusal is the SAME `0x0D ack1` with an empty diff: a gate that never answers would lock the
 * button, and an unsolicited ack0 wallet update would not release it either.
 */
test(
  "meso drop over the wire (0x1F): ack1 wallet, a kind-2 0x43 for the whole map, one empty ack1 per gate",
  { skip: archive === null, timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 500,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
      npcTemplate: (templateId: number) => ({ templateId, name: "stub npc" }),
      shops: shopKeeper(archive!),
      dropPolicy: () => [],
      // The drops of this test are asserted while they lie on the ground: no field tick may walk one
      // back into anybody's pocket mid-test (taking a drop by tick is the throw-away test's subject).
      mobTickMs: 10_000,
      handshake: { clientSendSeed: 0x1f1f1f1f, clientRecvSeed: 0x2e2e2e2e },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const settle = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    // Alive and holding 1000: `zeroStats()` hp=0 would trip the death gate this test asserts *last*.
    const heroRecord = characterDataOf(
      { ...zeroStats(), id: 9, name: "Hero", hp: 50, maxHp: 50, mesos: 1000 },
      startingCharacterItems(),
    );
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 9,
        characterName: "Hero",
        character: heroRecord,
      }),
    });
    await hero.take(4); // 0x16 + the two mobs + the NPC

    const alt = await FakeClient.connect(gameInfo.port);
    t.after(() => alt.close());
    alt.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({ username: "admin", characterId: 10, characterName: "Alt" }),
    });
    await alt.takeOpcode(FIELD_OPCODE.userEnterField);
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);

    /** The `0x1F`: one LE u32 after the opcode byte - exactly what `sub_55D5F0` writes. */
    const drop = (amount: number): void => {
      hero.send({
        kind: "unknown",
        opcode: MESO_DROP_OPCODE,
        body: encodeMesoDrop(amount).slice(1),
      });
    };
    /** A raw amount the page's own encoder would refuse - the server's gate is its own. */
    const dropRaw = (le32: number[]): void => {
      hero.send({ kind: "unknown", opcode: MESO_DROP_OPCODE, body: new Uint8Array(le32) });
    };
    /** One refusal: a single `0x0D` ack1 with an EMPTY diff, and no `0x43` for anybody. */
    const refused = async (): Promise<void> => {
      const answer = await hero.take(1);
      assert.equal(answer[0]![0], STAT_OPCODE);
      assert.deepEqual(readStatUpdate(new PacketReader(answer[0]!, 1)), { ack: true, diff: {} });
      assert.deepEqual(
        (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.appear),
        [],
      );
      assert.deepEqual(
        (await alt.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.appear),
        [],
        "a refused drop puts nothing on the ground for anybody",
      );
    };
    /** One success: `0x0D` ack1 with the wallet, then the `0x43` the whole map sees. */
    const dropped = async (amount: number, mesosLeft: number): Promise<void> => {
      const answer = await hero.take(2);
      assert.deepEqual(
        answer.map((bytes) => bytes[0]),
        [STAT_OPCODE, DROP_OPCODE.appear],
      );
      assert.deepEqual(readStatUpdate(new PacketReader(answer[0]!, 1)), {
        ack: true,
        diff: { mesos: mesosLeft },
      });
      assert.equal(answer[1]!.length, 15, "kind 2 is 15 bytes on the wire - no monster block");
      const appear = readDropAppear(new PacketReader(answer[1]!, 1));
      assert.deepEqual(
        [appear.kind, appear.money, appear.value, appear.mobId],
        [DROP_KIND.placed, true, amount, undefined],
        "player money is a placed reward: the amount, no item id, no monster",
      );
      const fromAlt = await alt.takeOpcode(DROP_OPCODE.appear);
      assert.equal(
        readDropAppear(new PacketReader(fromAlt[fromAlt.length - 1]!, 1)).dropId,
        appear.dropId,
        "the same drop, one id, for the whole map",
      );
    };

    // 100 of the 1000 go on the ground - and the second ask is pipelined back-to-back so it lands
    // inside the server's 200ms no matter how loaded the suite is: one empty ack1, wallet intact.
    drop(100);
    drop(50);
    await dropped(100, 900);
    await refused();
    assert.ok(
      log.some((line) => line.includes("dropped 100 mesos in map 1000000")),
      log.join("\n"),
    );

    // Past the window the very same ask succeeds.
    await settle(260);
    drop(50);
    await dropped(50, 850);

    // The input dialog's bounds are the encoder's AND the server's: 9 and 50001 never reach the
    // ground even hand-crafted past the client-side check, and 851 is more than the wallet holds.
    dropRaw([9, 0, 0, 0]);
    await refused();
    dropRaw([0x51, 0xc3, 0, 0]); // 50001, LE
    await refused();
    drop(851);
    await refused();

    // An open shop window excludes the coin button (MESO_RECHARGE.md's mutual exclusion): the
    // refusal is the same empty ack1. The settles above keep the rate gate out of this phase.
    await settle(260);
    hero.send({
      kind: "unknown",
      opcode: CLIENT_OBJECT_CLICK_OPCODE,
      body: encodeClientObjectClick({ objectId: 1 }).slice(1),
    });
    const opened = await hero.take(2);
    assert.equal(opened[1]![0], SHOP_OPEN_OPCODE);
    drop(10);
    await refused();
    // Close (deliberately unanswered), and once the rate allows, the button works again.
    hero.send({
      kind: "unknown",
      opcode: CLIENT_SHOP_OPCODE,
      body: encodeClientShopRequest({ kind: "close" }).slice(1),
    });
    assert.deepEqual(await hero.drainOpcodes(150), [], "a close is not answered");
    await settle(260);
    drop(10);
    await dropped(10, 840);

    // A dead character cannot drop: the client reports the killing hit itself (`0x1C`), the bar
    // goes to 0, and the ask after it is one empty ack1 - wallet and ground untouched.
    await settle(260);
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.statReport,
      body: encodeClientStatReport({ hpDelta: -50, mpDelta: 0, flag: 0 }).slice(1),
    });
    const killed = await hero.take(1);
    assert.deepEqual(readStatUpdate(new PacketReader(killed[0]!, 1)).diff, { hp: 0 });
    drop(10);
    await refused();
  },
);

/**
 * Throwing something away: the same `0x17` with `toSlot = 0` (`sub_463BE0`), and the field's own `0x43`.
 *
 * Two packets have to come back for one throw: the `0x0B` that takes the item out of the window (the
 * client never moved it itself) and the `0x43` that puts it on the ground - for the thrower as much as
 * for the rest of the map, because their own client has never drawn the item anywhere but the slot.
 * What picks it back up is walking onto it, and only after a move: the drop landed *after* this player
 * last moved, so standing on it is not enough (`DropField.reachable`, FINDINGS 4.18.6).
 */
test(
  "a throw-away answers 0x0B and puts the item on the ground for the whole map (second pass, ADR-029 real sockets)",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTemplate: () => ({
        templateId: 120100,
        name: "stub",
        level: 1,
        maxHP: 10,
        maxMP: 0,
        exp: 1,
        speedPercent: 0,
        dieMs: 40,
      }),
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
    // Alive, like the first pass: `zeroStats()` hp=0 would trip the 0x17 death gate (ADR-100 map).
    const heroRecord = characterDataOf(
      { ...zeroStats(), id: 9, name: "Hero", hp: 50, maxHp: 50 },
      heroItems,
    );
    const hero = await FakeClient.connect(gameInfo.port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "admin",
        characterId: 9,
        characterName: "Hero",
        character: heroRecord,
      }),
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
    const throwAway = encodeClientChangeSlot({
      tab: INVENTORY_TAB.consume,
      fromSlot: 4,
      toSlot: 0,
      count: 4,
    });
    hero.send({
      kind: "unknown",
      opcode: CLIENT_FIELD_OPCODE.changeSlot,
      body: throwAway.slice(1),
    });

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
    assert.equal(
      heroDrop[heroDrop.length - 1]!.length,
      15,
      "kind 2 is opcode + 14 bytes (FINDINGS 4.18.2)",
    );
    assert.deepEqual(
      [onGround.kind, onGround.money, onGround.value, onGround.mobId],
      [DROP_KIND.placed, false, 2000000, undefined],
      "the item, no mesos, and no monster",
    );
    const altDrop = await alt.takeOpcode(DROP_OPCODE.appear);
    assert.equal(
      readDropAppear(new PacketReader(altDrop[altDrop.length - 1]!, 1)).dropId,
      onGround.dropId,
    );
    assert.ok(
      log.some((line) => line.includes("dropped item 2000000 x4")),
      log.join("\n"),
    );

    /** Walks the character onto a spot: the first element of a CMovePath is where the server puts us. */
    const walkTo = (x: number, y: number): void => {
      const move = encodeClientUserMove({
        stageByte: 0,
        path: {
          originX: 0,
          originY: 0,
          elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }],
        },
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
    const zero = encodeClientChangeSlot({
      tab: INVENTORY_TAB.consume,
      fromSlot: 4,
      toSlot: 0,
      count: 0,
    });
    hero.send({ kind: "unknown", opcode: CLIENT_FIELD_OPCODE.changeSlot, body: zero.slice(1) });
    const nothing = await hero.takeOpcode(INVENTORY_OPCODE);
    assert.deepEqual(
      readInventoryChange(new PacketReader(nothing[nothing.length - 1]!, 1)).changes,
      [],
    );
    assert.ok(
      log.some((line) => line.includes("refused (badCount)")),
      log.join("\n"),
    );
    assert.deepEqual(
      (await hero.drainOpcodes(150)).filter((opcode) => opcode === DROP_OPCODE.appear),
      [],
      "and the refused throw-away leaves the ground as it was",
    );
  },
);

/**
 * The party, over two real sockets: create, invite, accept, leave, and the leader's leave that ends it.
 *
 * `0x26` is a `CWvsApp`-level request (FINDINGS 4.37) but only the game server can answer it: the
 * roster is 6 x (u32 id + char name[13]) and the invitation is keyed by the *inviter's* id, so the
 * server has to remember who invited whom. This test is the same walk the probe does with the real
 * `Data.wz`; here the map is a stub, so nothing else is on the wire.
 */
test(
  "a party is created, joined, left, and ended by its leader (0x26/0x10)",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTickMs: 10_000,
      handshake: { clientSendSeed: 0x0a0a0a0a, clientRecvSeed: 0x0b0b0b0b },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const enter = async (id: number, name: string): Promise<FakeClient> => {
      const client = await FakeClient.connect(gameInfo.port);
      t.after(() => client.close());
      client.send({
        kind: "handshake-reply",
        opcode: 0x04,
        value: handoffs.issue({
          username: `user${id}`,
          characterId: id,
          characterName: name,
          character: characterDataOf(
            { ...zeroStats(), id, name, level: 1, hp: 50, maxHp: 50 },
            startingCharacterItems(),
          ),
        }),
      });
      await client.takeOpcode(FIELD_OPCODE.setField);
      return client;
    };
    const hero = await enter(61, "Hero");
    const alt = await enter(62, "Alt");
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);
    await alt.takeOpcode(FIELD_OPCODE.userEnterField);

    const party = (
      client: FakeClient,
      request: Parameters<typeof encodeClientPartyRequest>[0],
    ): void => {
      client.send({
        kind: "unknown",
        opcode: PARTY_OPCODE.request,
        body: encodeClientPartyRequest(request).slice(1),
      });
    };
    const result = async (client: FakeClient): Promise<ReturnType<typeof readPartyResult>> => {
      const packets = await client.takeOpcode(PARTY_OPCODE.result);
      return readPartyResult(new PacketReader(packets[packets.length - 1]!, 1));
    };

    party(hero, { kind: "create" });
    assert.deepEqual(await result(hero), { kind: "created", partyId: 1 });
    assert.deepEqual(await alt.drainOpcodes(100), [], "nobody else hears about the creation");

    party(hero, { kind: "invite", targetId: 62 });
    assert.deepEqual(await result(alt), { kind: "invite", inviterId: 61, inviterName: "Hero" });
    assert.deepEqual(
      await hero.drainOpcodes(100),
      [],
      "the inviter is not told about its own invite",
    );

    // The wire's displayed inviter is authoritative, not merely the latest stored target slot.
    party(alt, { kind: "accept", inviterId: 999 });
    assert.deepEqual(
      await result(alt),
      { kind: "unknown" },
      "mismatched native inviter cannot join or consume the real offer",
    );
    party(alt, { kind: "accept", inviterId: 61 });
    const joined = {
      kind: "joined",
      partyId: 1,
      name: "Alt",
      members: [
        { characterId: 61, name: "Hero" },
        { characterId: 62, name: "Alt" },
        ...Array.from({ length: 4 }, () => ({ characterId: 0, name: "" })),
      ],
    } as const;
    assert.deepEqual(await result(hero), joined);
    assert.deepEqual(await result(alt), joined, "the joiner hears it too, and prints its own name");

    // Alt leaves: `flag 1`, `kicked 0`, the roster already without Alt - and the leaver hears it,
    // because that packet (with its own id in it) is the only thing that clears its party id.
    party(alt, { kind: "leave", unknown: 0 });
    const left = {
      kind: "left",
      partyId: 1,
      characterId: 62,
      kicked: false,
      name: "Alt",
      members: [
        { characterId: 61, name: "Hero" },
        ...Array.from({ length: 5 }, () => ({ characterId: 0, name: "" })),
      ],
    } as const;
    assert.deepEqual(await result(alt), left);
    assert.deepEqual(await result(hero), left);

    // The last one out is the leader: `flag 0`, no roster - the party is gone.
    party(hero, { kind: "leave", unknown: 0 });
    assert.deepEqual(await result(hero), { kind: "ended", partyId: 1, leaderId: 61 });
    assert.deepEqual(
      await alt.drainOpcodes(100),
      [],
      "Alt left already: it is not told about the disband",
    );

    party(alt, { kind: "leave", unknown: 0 });
    assert.deepEqual(await result(alt), { kind: "notInParty" });
    assert.ok(
      log.some((line) => line.includes('party: "Hero" created party 1')),
      log.join("\n"),
    );
  },
);

/**
 * Fame (`0x20` -> `0x12`), which is the first social packet that changes *the other* player's record.
 *
 * The three receivers are the point: the giver is told what happened (`type 0`), the target is told
 * who did it (`type 5`, with its *own* name added by the client) plus a `0x0D` fame diff, and the
 * refusals are the same packet with no payload. The daily and monthly quotas are this server's own
 * rules (ADR-031), so the second attempt against the same target is the monthly one.
 */
test(
  "fame: 0x20 answers the giver (0), the target (5), and a 0x0D; the quotas refuse (3/4)",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTickMs: 10_000,
      handshake: { clientSendSeed: 0x0c0c0c0c, clientRecvSeed: 0x0d0d0d0d },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const enter = async (id: number, name: string, level: number): Promise<FakeClient> => {
      const client = await FakeClient.connect(gameInfo.port);
      t.after(() => client.close());
      client.send({
        kind: "handshake-reply",
        opcode: 0x04,
        value: handoffs.issue({
          username: `user${id}`,
          characterId: id,
          characterName: name,
          character: characterDataOf(
            { ...zeroStats(), id, name, level, hp: 50, maxHp: 50 },
            startingCharacterItems(),
          ),
        }),
      });
      await client.takeOpcode(FIELD_OPCODE.setField);
      return client;
    };
    const hero = await enter(71, "Hero", 30);
    // Alt is a beginner (level 14): old enough to be famed, too young to fame anybody.
    const alt = await enter(72, "Alt", 14);
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);
    await alt.takeOpcode(FIELD_OPCODE.userEnterField);

    const fame = (client: FakeClient, targetId: number, up: boolean): void => {
      client.send({
        kind: "unknown",
        opcode: FAME_OPCODE.request,
        body: encodeClientFameRequest({ targetId, up }).slice(1),
      });
    };
    const answer = async (client: FakeClient): Promise<ReturnType<typeof readFameResult>> => {
      const packets = await client.takeOpcode(FAME_OPCODE.result);
      return readFameResult(new PacketReader(packets[packets.length - 1]!, 1));
    };

    fame(hero, 72, true);
    assert.deepEqual(await answer(hero), { kind: "changed", name: "Alt", up: true });
    assert.deepEqual(await answer(alt), { kind: "received", name: "Hero", up: true });
    const stat = await alt.takeOpcode(STAT_OPCODE);
    assert.deepEqual(readStatUpdate(new PacketReader(stat[stat.length - 1]!, 1)), {
      ack: false,
      diff: { fame: 1 },
    });
    assert.deepEqual(await hero.drainOpcodes(150), [], "the giver's own record did not change");

    // Same target, same month: `type 4` (the more specific message, and the client's own words).
    fame(hero, 72, true);
    assert.deepEqual(await answer(hero), { kind: "alreadyThisMonth" });
    assert.deepEqual(await alt.drainOpcodes(100), [], "a refusal is not news for the target");

    // Alt is level 14, so it cannot give fame: `type 2`, and Hero hears nothing.
    fame(alt, 71, true);
    assert.deepEqual(await answer(alt), { kind: "beginner" });
    assert.deepEqual(await hero.drainOpcodes(100), []);

    // An id that is not in this field is `type 1`: nothing at all is printed.
    fame(hero, 999, true);
    assert.deepEqual(await answer(hero), { kind: "ignored" });
    assert.ok(
      log.some((line) => line.includes('fame: "Hero" -> "Alt" up (now 1)')),
      log.join("\n"),
    );
  },
);

/**
 * 交易（1:1 교환），兩個真 socket：邀請、接受、放道具、放錢、確認，然後東西真的換邊。
 *
 * 這個切片跟派對不同的地方在於**成交**：`0x50 type 8` 之前的那兩個 `0x0B`／`0x0D` 才是交易的效果，
 * 而 `settleTrade` 的原子性（東西不在了、對面放不下就整個不換）是伺服器自己的規則，client 只看到
 * `type 8` 的 `3` 或 `4`。
 */
test(
  "a trade: invite, accept, offer, confirm, and the swap lands in both inventories (0x25/0x50)",
  { timeout: 20000 },
  async (t) => {
    const log: string[] = [];
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTickMs: 10_000,
      handshake: { clientSendSeed: 0x0a0a0a0a, clientRecvSeed: 0x0b0b0b0b },
      log: (line) => log.push(line),
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });

    const heroItems = startingCharacterItems();
    const heroStack = grantItem(heroItems, 2_000_000, 10)!;
    const altItems = startingCharacterItems();
    const altStack = grantItem(altItems, 2_000_001, 3)!;
    const enter = async (
      id: number,
      name: string,
      items: ReturnType<typeof startingCharacterItems>,
      mesos: number,
    ): Promise<FakeClient> => {
      const client = await FakeClient.connect(gameInfo.port);
      t.after(() => client.close());
      client.send({
        kind: "handshake-reply",
        opcode: 0x04,
        value: handoffs.issue({
          username: `user${id}`,
          characterId: id,
          characterName: name,
          character: characterDataOf(
            { ...zeroStats(), id, name, level: 10, hp: 50, maxHp: 50, mesos },
            items,
          ),
        }),
      });
      await client.takeOpcode(FIELD_OPCODE.setField);
      return client;
    };
    const hero = await enter(61, "Hero", heroItems, 1_000);
    const alt = await enter(62, "Alt", altItems, 100);
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);
    await alt.takeOpcode(FIELD_OPCODE.userEnterField);

    const request = (
      client: FakeClient,
      body: Parameters<typeof encodeClientMiniRoomRequest>[0],
    ): void => {
      client.send({
        kind: "unknown",
        opcode: MINIROOM_OPCODE.request,
        body: encodeClientMiniRoomRequest(body).slice(1),
      });
    };
    const answer = async (client: FakeClient): Promise<ReturnType<typeof readMiniRoomResult>> => {
      const packets = await client.takeOpcode(MINIROOM_OPCODE.result);
      return readMiniRoomResult(new PacketReader(packets[packets.length - 1]!, 1));
    };

    // 1. `/교환 Alt`: Alt sees the invite, Hero gets the silent `code 0` acknowledgement.
    request(hero, { kind: "invite", roomKind: MINIROOM_KIND.trade, targetId: 62 });
    assert.deepEqual(await answer(alt), { kind: "invite", inviterId: 61, inviterName: "Hero" });
    assert.deepEqual(await answer(hero), { kind: "refused", code: MINIROOM_REFUSAL.ok });

    // 2. Alt says yes: both windows open, each with its own side marked.
    request(alt, { kind: "accept", inviterId: 61 });
    const heroEnter = await answer(hero);
    const altEnter = await answer(alt);
    assert.equal(heroEnter.kind, "enter");
    assert.equal(altEnter.kind, "enter");
    if (heroEnter.kind !== "enter" || altEnter.kind !== "enter") return;
    assert.equal(heroEnter.roomKind, 1);
    assert.equal(heroEnter.myIndex, 0);
    assert.equal(altEnter.myIndex, 1);
    assert.deepEqual(
      heroEnter.participants.map((p) => p.name),
      ["Hero", "Alt"],
    );
    assert.deepEqual(
      altEnter.participants.map((p) => p.name),
      ["Hero", "Alt"],
    );
    assert.equal(heroEnter.participants[0]!.level, 10);
    assert.equal(heroEnter.participants[0]!.face, DEFAULT_FACE_ID);

    // 3. Hero puts 5 potions in slot 2 and 300 mesos: both sides see both packets.
    request(hero, {
      kind: "offerItem",
      tab: heroStack.inventory,
      slot: heroStack.slot,
      count: 5,
      roomSlot: 2,
    });
    for (const client of [hero, alt]) {
      const seen = await client.takeOpcode(MINIROOM_OPCODE.result);
      const item = readMiniRoomResult(new PacketReader(seen[seen.length - 1]!, 1));
      assert.equal(item.kind, "item");
      if (item.kind !== "item") return;
      assert.equal(item.index, 0);
      assert.equal(item.roomSlot, 2);
      assert.equal(item.item.kind === "nonequip" ? item.item.quantity : 0, 5);
    }
    request(hero, { kind: "offerMesos", amount: 300 });
    for (const client of [hero, alt]) {
      const seen = await client.takeOpcode(MINIROOM_OPCODE.result);
      assert.deepEqual(readMiniRoomResult(new PacketReader(seen[seen.length - 1]!, 1)), {
        kind: "mesos",
        index: 0,
        amount: 300,
      });
    }

    // 4. Alt puts its 3 blue potions in slot 1 and 100 mesos.
    request(alt, {
      kind: "offerItem",
      tab: altStack.inventory,
      slot: altStack.slot,
      count: 3,
      roomSlot: 1,
    });
    await hero.takeOpcode(MINIROOM_OPCODE.result);
    await alt.takeOpcode(MINIROOM_OPCODE.result);
    request(alt, { kind: "offerMesos", amount: 100 });
    await hero.takeOpcode(MINIROOM_OPCODE.result);
    await alt.takeOpcode(MINIROOM_OPCODE.result);

    // 5. Both confirm: every confirmation immediately sends `13` to THE PEER (the "the other
    //    side locked" wash of `sub_4D3BB0`), then settlement prints `0x0B`/`0x0D` and `8` code 3.
    request(hero, { kind: "confirm" });
    assert.deepEqual(
      await hero.drainOpcodes(80),
      [],
      "my own confirmation sends nothing back to me",
    );
    const altLock = await alt.takeOpcode(MINIROOM_OPCODE.result);
    assert.deepEqual(readMiniRoomResult(new PacketReader(altLock[altLock.length - 1]!, 1)), {
      kind: "lock",
    });
    request(alt, { kind: "confirm" });
    const heroLock = await hero.takeOpcode(MINIROOM_OPCODE.result);
    assert.deepEqual(readMiniRoomResult(new PacketReader(heroLock[heroLock.length - 1]!, 1)), {
      kind: "lock",
    });

    const heroChanges = await hero.takeOpcode(INVENTORY_OPCODE);
    const heroInventory = readInventoryChange(
      new PacketReader(heroChanges[heroChanges.length - 1]!, 1),
    );
    const heroPut = heroInventory.changes.find((change) => change.op === INVENTORY_OP.put);
    assert.ok(heroPut !== undefined, JSON.stringify(heroInventory));
    assert.equal(heroPut!.inventory, heroStack.inventory);
    assert.equal(heroPut!.slot, heroStack.slot);
    assert.equal(
      heroPut!.op === INVENTORY_OP.put && heroPut!.item.kind === "nonequip"
        ? heroPut!.item.quantity
        : 0,
      5,
    );
    assert.ok(
      heroInventory.changes.some(
        (change) => change.op === INVENTORY_OP.put && change.item.itemId === 2_000_001,
      ),
      "Alt's stack arrives in Hero's bag",
    );

    const heroStat = await hero.takeOpcode(STAT_OPCODE);
    assert.deepEqual(readStatUpdate(new PacketReader(heroStat[heroStat.length - 1]!, 1)).diff, {
      mesos: 800,
    });
    const heroFinish = await hero.takeOpcode(MINIROOM_OPCODE.result);
    assert.deepEqual(readMiniRoomResult(new PacketReader(heroFinish[heroFinish.length - 1]!, 1)), {
      kind: "finish",
      code: TRADE_FINISH.done,
    });

    const altChanges = await alt.takeOpcode(INVENTORY_OPCODE);
    const altInventory = readInventoryChange(
      new PacketReader(altChanges[altChanges.length - 1]!, 1),
    );
    assert.ok(
      altInventory.changes.some(
        (change) => change.op === INVENTORY_OP.put && change.item.itemId === 2_000_000,
      ),
      "Hero's 5 potions arrive in Alt's bag",
    );
    const altStat = await alt.takeOpcode(STAT_OPCODE);
    assert.deepEqual(readStatUpdate(new PacketReader(altStat[altStat.length - 1]!, 1)).diff, {
      mesos: 300,
    });
    const altFinish = await alt.takeOpcode(MINIROOM_OPCODE.result);
    assert.deepEqual(readMiniRoomResult(new PacketReader(altFinish[altFinish.length - 1]!, 1)), {
      kind: "finish",
      code: TRADE_FINISH.done,
    });

    assert.ok(
      log.some((line) => line.includes('trade: 1 done - "Hero"')),
      log.join("\n"),
    );
  },
);

/**
 * 交易的另一半：關窗就是取消，而且**對面**才是要收到封包的人。
 *
 * 2003 的 client 沒有「拒絕邀請」的封包，所以邀請只會逾時；但房間已經開了以後，關窗會送 `0x25 type 7`
 * （`sub_4D31F0` 的參數 2），對面收到 `0x50 type 8` 的 `1`（상대방이 교환을 취소했습니다）。
 */
test(
  "a trade that is cancelled: the other side gets 0x50 type 8 code 1",
  { timeout: 20000 },
  async (t) => {
    const handoffs = new HandoffRegistry();
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
      mobTickMs: 10_000,
      handshake: { clientSendSeed: 0x0a0a0a0a, clientRecvSeed: 0x0b0b0b0b },
    });
    const gameInfo = await game.listen(0);
    t.after(async () => {
      await game.close();
    });
    const enter = async (id: number, name: string): Promise<FakeClient> => {
      const client = await FakeClient.connect(gameInfo.port);
      t.after(() => client.close());
      client.send({
        kind: "handshake-reply",
        opcode: 0x04,
        value: handoffs.issue({
          username: `user${id}`,
          characterId: id,
          characterName: name,
          character: characterDataOf(
            { ...zeroStats(), id, name, level: 10, hp: 50, maxHp: 50 },
            startingCharacterItems(),
          ),
        }),
      });
      await client.takeOpcode(FIELD_OPCODE.setField);
      return client;
    };
    const hero = await enter(71, "Hero");
    const alt = await enter(72, "Alt");
    await hero.takeOpcode(FIELD_OPCODE.userEnterField);
    await alt.takeOpcode(FIELD_OPCODE.userEnterField);
    const request = (
      client: FakeClient,
      body: Parameters<typeof encodeClientMiniRoomRequest>[0],
    ): void => {
      client.send({
        kind: "unknown",
        opcode: MINIROOM_OPCODE.request,
        body: encodeClientMiniRoomRequest(body).slice(1),
      });
    };
    const answer = async (client: FakeClient): Promise<ReturnType<typeof readMiniRoomResult>> => {
      const packets = await client.takeOpcode(MINIROOM_OPCODE.result);
      return readMiniRoomResult(new PacketReader(packets[packets.length - 1]!, 1));
    };

    // An id that is not in the map: `type 2 code 1` (캐릭터를 찾을 수 없습니다).
    request(hero, { kind: "invite", roomKind: MINIROOM_KIND.trade, targetId: 999 });
    assert.deepEqual(await answer(hero), { kind: "refused", code: MINIROOM_REFUSAL.notFound });

    request(hero, { kind: "invite", roomKind: MINIROOM_KIND.trade, targetId: 72 });
    await answer(alt);
    await answer(hero);
    request(alt, { kind: "accept", inviterId: 71 });
    await answer(hero);
    await answer(alt);

    request(alt, { kind: "leave" });
    assert.deepEqual(await answer(hero), { kind: "finish", code: TRADE_FINISH.cancelled });
    assert.deepEqual(
      await alt.drainOpcodes(80),
      [],
      "the one who closed the window hears nothing back",
    );

    // And the room is gone: a second invite works, so a character is not stuck in a dead room.
    request(hero, { kind: "invite", roomKind: MINIROOM_KIND.trade, targetId: 72 });
    assert.deepEqual(await answer(alt), { kind: "invite", inviterId: 71, inviterName: "Hero" });
  },
);

test("a messenger room: invite, join, chat, leave (0x24/0x4d)", { timeout: 20000 }, async (t) => {
  const log: string[] = [];
  const handoffs = new HandoffRegistry();
  const game = new GameEntryServer({
    handoffs,
    mapId: 1000000,
    mapProvider: (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined),
    mobTickMs: 10_000,
    handshake: { clientSendSeed: 0x0a0a0a0a, clientRecvSeed: 0x0b0b0b0b },
    log: (line) => log.push(line),
  });
  const gameInfo = await game.listen(0);
  t.after(async () => {
    await game.close();
  });

  const enter = async (id: number, name: string): Promise<FakeClient> => {
    const client = await FakeClient.connect(gameInfo.port);
    t.after(() => client.close());
    client.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: `user${id}`,
        characterId: id,
        characterName: name,
        character: characterDataOf({
          ...zeroStats(),
          id,
          name,
          level: 12,
          hp: 50,
          maxHp: 50,
          mesos: 0,
        }),
      }),
    });
    await client.takeOpcode(FIELD_OPCODE.setField);
    return client;
  };
  const hero = await enter(81, "Hero");
  const alt = await enter(82, "Alt");
  await hero.takeOpcode(FIELD_OPCODE.userEnterField);
  await alt.takeOpcode(FIELD_OPCODE.userEnterField);

  const request = (
    client: FakeClient,
    body: Parameters<typeof encodeClientMessengerRequest>[0],
  ): void => {
    client.send({
      kind: "unknown",
      opcode: MESSENGER_OPCODE.request,
      body: encodeClientMessengerRequest(body).slice(1),
    });
  };
  /** The next `count` `0x4d` packets, in arrival order. */
  const answers = async (
    client: FakeClient,
    count: number,
  ): Promise<ReturnType<typeof readMessengerResult>[]> => {
    const events: ReturnType<typeof readMessengerResult>[] = [];
    for (let i = 0; i < count; i++) {
      const packets = await client.takeOpcode(MESSENGER_OPCODE.result);
      events.push(readMessengerResult(new PacketReader(packets[packets.length - 1]!, 1)));
    }
    return events;
  };

  // 1. Opening a room: `roomId 0` means "a new one", and the window shows itself in slot 0.
  request(hero, { kind: "enter", roomId: 0 });
  const [opened] = await answers(hero, 1);
  assert.equal(opened?.kind, "participant");
  if (opened?.kind !== "participant") return;
  assert.equal(opened.participant.slot, 0);
  assert.equal(opened.participant.name, "Hero");
  assert.equal(opened.participant.face, DEFAULT_FACE_ID);
  assert.equal(
    opened.announce,
    true,
    "the window was just opened - the entry line belongs in the log",
  );

  // 2. `/초대 Alt`: Hero is told it was sent, Alt gets the modal carrying Hero's name and the room id.
  request(hero, { kind: "command", text: "/invite Alt" });
  const [sent] = await answers(hero, 1);
  assert.deepEqual(sent, { kind: "inviteResult", ok: 1, name: "Alt" });
  const [invite] = await answers(alt, 1);
  assert.equal(invite?.kind, "invite");
  if (invite?.kind !== "invite") return;
  assert.equal(invite.inviterName, "Hero");
  // The room id is the server's own counter, so a client only ever learns it from the invite.
  const roomId = invite.roomId;
  assert.ok(roomId > 0);

  // 3. Alt says yes: both windows end up with both people, and only Alt's own entry is announced.
  request(alt, { kind: "enter", roomId });
  const heroSaw = await answers(hero, 2);
  assert.deepEqual(
    heroSaw.map((event) =>
      event.kind === "participant"
        ? [event.participant.slot, event.participant.name, event.announce]
        : event,
    ),
    [
      [0, "Hero", false],
      [1, "Alt", true],
    ],
  );
  const altSaw = await answers(alt, 2);
  assert.deepEqual(
    altSaw.map((event) =>
      event.kind === "participant"
        ? [event.participant.slot, event.participant.name, event.announce]
        : event,
    ),
    [
      [0, "Hero", false],
      [1, "Alt", true],
    ],
  );

  // 4. Chat: one 0x4d type 5 line, already formatted, to everybody including the speaker.
  // The client has already printed the line locally, so only the *other* window receives it.
  request(hero, { kind: "chat", line: "Hero : hello" });
  const altLine = (await answers(alt, 1))[0];
  assert.deepEqual(altLine, { kind: "chat", line: "Hero : hello" });
  assert.deepEqual(await hero.drainOpcodes(120), [], "the speaker does not get its own line back");

  // 5. A name nobody is playing: the inviter is told, and no packet goes to the room.
  request(hero, { kind: "command", text: "/invite Nobody" });
  assert.deepEqual((await answers(hero, 1))[0], { kind: "inviteResult", ok: 0, name: "Nobody" });

  // 6. Alt leaves: Hero is told which slot emptied, and then the silent type-7 roster resync
  // follows - the client's own left handler (sub_4DF910) clears one slot WITHOUT compacting
  // while the registry splices, so the compacted row [Hero] arrives as fill/clear/clear.
  request(alt, { kind: "leave" });
  const [leftEvent, resync] = await answers(hero, 2);
  assert.deepEqual(leftEvent, { kind: "left", slot: 1 });
  assert.equal(resync?.kind, "roster");
  if (resync?.kind !== "roster") return;
  assert.deepEqual(
    resync.cells.map((cell) => cell.action),
    ["fill", "clear", "clear"],
  );
  const [heroCell] = resync.cells;
  if (heroCell?.action !== "fill") return;
  assert.equal(heroCell.name, "Hero");
  // The resynced cell carries exactly what slot 0's type-0 record carried at the opening.
  assert.equal(heroCell.level, opened.participant.level);
  assert.equal(heroCell.face, opened.participant.face);
  assert.deepEqual([...heroCell.look], [...opened.participant.look]);
  assert.deepEqual(
    await alt.drainOpcodes(120),
    [],
    "the leaving window is already closed - nothing to send it",
  );

  // 7. Talking with no room is dropped, and coming back needs a fresh invitation.
  request(alt, { kind: "chat", line: "Alt : still there?" });
  assert.deepEqual(await alt.drainOpcodes(120), []);
  assert.deepEqual(await hero.drainOpcodes(120), []);
  request(alt, { kind: "enter", roomId });
  assert.deepEqual((await answers(alt, 1))[0], { kind: "joinFailed", code: 1 });

  // 8. Hero's own window closing removes the room: the next invitation is a new room.
  request(hero, { kind: "leave" });
  request(hero, { kind: "enter", roomId: 0 });
  const [again] = await answers(hero, 1);
  assert.equal(again?.kind === "participant" ? again.participant.slot : -1, 0);
  assert.ok(
    log.some((line) => line.includes('messenger: room 2 opened by "Hero"')),
    JSON.stringify(log.filter((line) => line.includes("messenger"))),
  );
});

test("native create requires the exact successfully checked name and valid dice", async (t) => {
  const accounts = new Map<string, AccountRecord>([
    ["maker", { password: "maker", characters: [] }],
  ]);
  const server = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: 8585 },
  });
  const info = await server.listen(0),
    client = await FakeClient.connect(info.port);
  t.after(async () => {
    client.close();
    await server.close();
  });
  client.send({ kind: "handshake-reply", opcode: 0x04, value: 0 });
  client.send({ kind: "login-request", opcode: 0x01, username: "maker", password: "maker" });
  await client.take(1);
  client.send({ kind: "world-select", opcode: 0x02, worldId: 0 });
  await client.take(1);
  const create = async (name: string) => {
    client.send({ kind: "create-character", opcode: 0x05, name });
    return (await client.take(1))[0]!;
  };
  const appearance = [20000, 30030, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10];
  assert.equal((await create("NoCheck"))[1], 0);
  client.send({
    kind: "check-name",
    opcode: 0x06,
    name: "BadDice",
    appearance: [...appearance.slice(0, 6), 4, 5, 6, 7],
  });
  assert.equal((await client.take(1))[0]!.at(-1), 255, "signed -1 refuses invalid native dice");
  assert.equal((await create("BadDice"))[1], 0);
  client.send({ kind: "check-name", opcode: 0x06, name: "Checked", appearance });
  await client.take(1);
  assert.equal((await create("Different"))[1], 0, "cannot substitute a different name");
  assert.equal((await create("Checked"))[1], 1);
  assert.equal(accounts.get("maker")!.characters.length, 1);
  assert.equal((await create("Checked"))[1], 0, "a checked result is consumed exactly once");
});

test(
  "raw native AP packets acknowledge malformed/refused requests and immediately persist successful allocations",
  { timeout: 20000 },
  async (t) => {
    const stats = Object.assign(zeroStats(), {
      id: 91,
      name: "Ability",
      level: 1,
      str: 4,
      dex: 5,
      int: 6,
      luk: 7,
      hp: 50,
      maxHp: 50,
      ap: 2,
      mapId: 1000000,
    });
    const character = characterDataOf(stats, startingCharacterItems());
    const accounts = new Map<string, AccountRecord>([
      ["ap", { password: "ap", characters: [character] }],
    ]);
    const store = new MemorySaveStore();
    store.save(accounts);
    let saves = 0;
    const handoffs = new HandoffRegistry(),
      game = new GameEntryServer({
        handoffs,
        pingMs: 0,
        mapId: 1000000,
        mapProvider: (id) => (id === 1000000 ? STUB_MAP : undefined),
        persist: () => {
          saves++;
          store.save(accounts);
        },
      });
    const info = await game.listen(0);
    t.after(() => game.close());
    const client = await FakeClient.connect(info.port);
    t.after(() => client.close());
    client.send({
      kind: "handshake-reply",
      opcode: 0x04,
      value: handoffs.issue({
        username: "ap",
        characterId: 91,
        characterName: "Ability",
        character,
      }),
    });
    await client.take(4); // setField, two mobs, one NPC
    const request = async (body: Uint8Array) => {
      client.send({ kind: "unknown", opcode: ABILITY_REQUEST_OPCODE, body });
      const packet = (await client.takeOpcode(STAT_OPCODE)).at(-1)!;
      assert.equal(packet[0], STAT_OPCODE);
      const update = readStatUpdate(new PacketReader(packet, 1));
      assert.equal(update.ack, true);
      return update.diff;
    };
    for (const body of [new Uint8Array(0), new Uint8Array(3), new Uint8Array([0x40, 0, 0, 0, 1])]) {
      assert.deepEqual(await request(body), {});
      assert.equal(character.stats.ap, 2);
    }
    assert.deepEqual(await request(encodeAbilityRequest("str").slice(1)), { str: 5, ap: 1 });
    assert.equal(saves, 1);
    assert.equal(store.load()!.get("ap")!.characters[0]!.stats.str, 5);
    assert.equal(store.load()!.get("ap")!.characters[0]!.stats.ap, 1);
    assert.deepEqual(
      await request(encodeAbilityRequest("dex").slice(1)),
      {},
      "cooldown refusal still releases native pending",
    );
    await new Promise((resolve) => setTimeout(resolve, 510));
    assert.deepEqual(
      await request(new Uint8Array([0xc0, 0, 0, 0])),
      {},
      "combined masks aren't two AP operations",
    );
    assert.equal(saves, 1);
    assert.equal(character.stats.ap, 1);
    await new Promise((resolve) => setTimeout(resolve, 510));
    assert.deepEqual(await request(encodeAbilityRequest("dex").slice(1)), { dex: 6, ap: 0 });
    assert.equal(saves, 2);
    await new Promise((resolve) => setTimeout(resolve, 510));
    assert.deepEqual(await request(encodeAbilityRequest("int").slice(1)), {});
    assert.equal(character.stats.int, 6);
    assert.equal(character.stats.ap, 0);
    assert.equal(saves, 2);
    assert.equal(client.headersOk, true);
  },
);

test(
  "raw native 0x0D map-zero jump, tn index, remote coordinates and map-zero reconnect preserve the real map",
  { timeout: 20000 },
  async (t) => {
    const source = {
      ...STUB_MAP,
      mobs: [],
      npcs: [],
      portals: STUB_MAP.portals.map((p) => (p.name === "west00" ? { ...p, toMapId: 0 } : p)),
    };
    const destination = {
      ...STUB_MAP_ALT,
      id: 0,
      mobs: [],
      npcs: [],
      portals: [
        { name: "sp", type: 0, x: 100, y: 300, toMapId: 999999999, toName: "" },
        { name: "auto", type: 3, x: 200, y: 300, toMapId: 999999999, toName: "" },
        ...STUB_MAP_ALT.portals,
      ],
    };
    const handoffs = new HandoffRegistry();
    let saves = 0;
    const game = new GameEntryServer({
      handoffs,
      mapId: 1000000,
      mapProvider: (id) => (id === 0 ? destination : id === 1000000 ? source : undefined),
      allowMapCommand: (user) => user === "admin",
      persist: () => saves++,
    });
    const { port } = await game.listen(0);
    t.after(() => game.close());
    const hero = await FakeClient.connect(port);
    t.after(() => hero.close());
    hero.send({
      kind: "handshake-reply",
      opcode: 4,
      value: handoffs.issue({ username: "admin", characterId: 7, characterName: "Hero" }),
    });
    await hero.takeOpcode(FIELD_OPCODE.setField);
    const interact = (client: FakeClient, kind: number, name = "") =>
      client.send({
        kind: "unknown",
        opcode: CLIENT_FIELD_OPCODE.interact,
        body: encodeClientInteract({ kind, name }).slice(1),
      });
    interact(hero, INTERACT_KIND_CURSOR, "west00");
    const arrival = await hero.takeOpcode(FIELD_OPCODE.setField);
    assert.equal(arrival[0]![0], FIELD_OPCODE.requestRelease);
    const data = readSetField(new PacketReader(arrival.at(-1)!, 1)).character;
    assert.deepEqual(
      [data.stats.mapId, data.stats.unknown101],
      [0, 1],
      "portal to map zero resolves east00, excluding auto pool",
    );
    assert.equal(saves, 1);
    const guest = await FakeClient.connect(port);
    t.after(() => guest.close());
    const record = characterDataOf({
      ...zeroStats(),
      id: 9,
      name: "Guest",
      hp: 50,
      maxHp: 50,
      mapId: 0,
    });
    guest.send({
      kind: "handshake-reply",
      opcode: 4,
      value: handoffs.issue({
        username: "alt",
        characterId: 9,
        characterName: "Guest",
        character: record,
      }),
    });
    const burst = await guest.takeOpcode(FIELD_OPCODE.userEnterField);
    assert.equal(
      readSetField(new PacketReader(burst[0]!, 1)).character.stats.mapId,
      0,
      "real map-zero save is NOT default-map migration",
    );
    const about = readUserEnterField(new PacketReader(burst.at(-1)!, 1));
    assert.deepEqual([about.x, about.y, about.foothold], [600, 290, 32]);
    interact(hero, 1000000);
    await hero.takeOpcode(FIELD_OPCODE.setField);
    interact(hero, 0);
    const zero = await hero.takeOpcode(FIELD_OPCODE.setField);
    assert.deepEqual(
      [
        readSetField(new PacketReader(zero.at(-1)!, 1)).character.stats.mapId,
        readSetField(new PacketReader(zero.at(-1)!, 1)).character.stats.unknown101,
      ],
      [0, 0],
      "authorized alive kind=0 is the original GM map-zero command, not revive",
    );
    interact(guest, 1000000);
    const denied = await guest.takeOpcode(0x13);
    assert.ok(denied.some((p) => p[0] === FIELD_OPCODE.requestRelease));
    assert.ok(
      !denied.some((p) => p[0] === FIELD_OPCODE.setField),
      "forged native packets cannot bypass the account policy",
    );
  },
);
