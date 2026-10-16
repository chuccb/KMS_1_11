/**
 * The login server: the part of the MMO a 2003 client can actually complete today.
 *
 * It implements the four stages decoded in docs/protocol/FINDINGS.md 4.7-4.9 -
 * CTitle (0x01) -> CWorldSelect (0x02) -> CCharSelect (0x03-0x07) -> handoff - over a real
 * encrypted session, so the original client (or a rewritten one) can be pointed at it and walked
 * to the character-select screen. Everything the client needs for that path is sent; anything not
 * yet decoded is *not* invented (see `GameEntryServer` at the bottom).
 *
 * What is deliberately missing:
 *   - the in-game stage (CField, opcodes 0x15-0x52): 0x16 to 0x52 is implemented, the rest is not;
 *   - the CharacterData item block (30 equip slots + 4 inventories), so created characters are
 *     stat-only - the client accepts that (`flags = 1`, FINDINGS 4.9).
 *
 * Persistence is **not** here: both servers take a `persist` callback and call it after a mutation
 * (a character created or deleted here, a session that leaves the field at the bottom of this file),
 * and `game/save.ts` is what turns that call into a file. Keeping the file out of this module is what
 * lets a test run a whole login + gameplay flow without touching a disk.
 */
import net from "node:net";
import { CipherState } from "../protocol/cipher.ts";
import {
  CLIENT_SEND_MAGIC,
  HANDSHAKE_BODY_BYTES,
  SessionDeframer,
  encodeHandshake,
  encodeSessionPacket,
  type SessionEvent,
} from "../protocol/session.ts";
import type { MobTemplate } from "../game/mobs.ts";
import type { DropPolicy } from "../game/drops.ts";
import type { NpcTemplate } from "../game/npcs.ts";
import { FieldRegistry, type FieldInstance, type FieldMember } from "../game/world.ts";
import { MesoWallet, pickUpDrop, takeItem } from "../game/rewards.ts";
import { reviveMapId, type MapData } from "../game/map.ts";
import { decodeClientPacket, describeClientPacket } from "../protocol/login.ts";
import {
  CLIENT_FIELD_OPCODE,
  describeClientFieldPacket,
  describeClientStatReport,
  describeClientUserRequest,
  describeUserChat,
  encodeUserChat,
  encodeUserFindAnswer,
  encodeUserWhisperAnswer,
  INTERACT_KIND_CURSOR,
  INTERACT_KIND_REVIVE,
  encodeFieldRequestRelease,
  encodeSetField,
  encodeUserAttack,
  encodeUserEffect,
  encodeUserEmotion,
  readClientEmotion,
  describeClientEmotion,
  type ClientEmotion,
  readClientAttack,
  readClientChat,
  readClientInteract,
  readClientStatReport,
  readClientUseItem,
  readClientUserMove,
  readClientUserRequest,
  USE_ITEM_OPCODES,
  USER_EFFECT_LEVEL_UP,
  USER_REQUEST_KIND,
  type ClientAttack,
  type ClientInteract,
  type UserAttackTarget,
  type ClientUseItem,
  type ClientUserRequest,
  type SetField,
} from "../protocol/field.ts";
import { decodeCp949 } from "../protocol/cp949.ts";
import { encodeLootNotice } from "../protocol/drop.ts";
import { encodeInventoryChange } from "../protocol/inventory.ts";
import { diffStats, encodeStatUpdate } from "../protocol/stat.ts";
import {
  CLIENT_OBJECT_CLICK_OPCODE,
  CLIENT_SHOP_OPCODE,
  SHOP_RESULT,
  encodeShopOpen,
  encodeShopResult,
  readClientObjectClick,
  readClientShopRequest,
} from "../protocol/shop.ts";
import { shopResultCode, type ShopDef, type ShopKeeper } from "../game/shops.ts";
import { NpcTalk, type NpcDialogue } from "../game/dialogue.ts";
import {
  QUEST_ANSWER,
  describeQuestReply,
  readQuestReply,
  type QuestReply,
} from "../protocol/quest.ts";
import { awardExp } from "../game/exp.ts";
import { applyVitalReport } from "../game/vitals.ts";
import { consumeDeltas, healsVitals, type ConsumeSpec } from "../game/items.ts";
import { DEFAULT_PING_MS, Heartbeat } from "./heartbeat.ts";
import { OnlineAccounts, SeatKeeper, describeSessions } from "./online.ts";
import { PacketReader } from "../protocol/packet.ts";
import {
  LOGIN_RESULT,
  NAME_CHECK_RESULT,
  encodeCreateCharacterResult,
  encodeEcho,
  encodeDeleteCharacterResult,
  encodeLoginResult,
  encodeNameCheckResult,
  encodeSelectCharacterResult,
  encodeWorldSelectResult,
  type WorldEntry,
} from "../protocol/replies.ts";
import {
  LOOK_WORD,
  LOOK_WORDS,
  characterDataOf,
  emptyCharacterItems,
  lookOf,
  startingCharacterItems,
  withDefaultLook,
  withWorn,
  wornOfLook,
  zeroStats,
  type CharacterData,
  type CharacterItems,
  type CharacterStats,
} from "../protocol/chardata.ts";

export interface AccountRecord {
  password: string;
  characters: CharacterData[];
}

/** A character that has been handed over to the game server, waiting to say hello. */
export interface HandoffEntry {
  username: string;
  characterId: number;
  characterName: string;
  /**
   * The character record the login server sent to the client, so the game server can hand the same
   * one back in the `0x16` field-entry packet (`sub_4C2780` reads the map out of it, FINDINGS
   * 4.11.2b). Optional: a handoff issued by hand has no record yet.
   */
  character?: CharacterData;
}

/**
 * The handoff the 0x03 reply performs.
 *
 * The client stores the u32 in `CWvsApp+0x14` and sends it as `[0x04][value]` right after the game
 * server's handshake (FINDINGS 4.8/§2), so the game server learns which character just arrived.
 * That value is the **character id**: the client compares it against the id of every user that
 * enters the field to recognise itself (`sub_51CFE0`, FINDINGS 4.11.3), so a random value here
 * would make the client deny its own character. The registry is therefore keyed by character id,
 * and the game server must keep using that id for the session.
 */
export class HandoffRegistry {
  private readonly byCharacterId = new Map<number, HandoffEntry>();

  /** Registers a character that may arrive on the game port, and returns the id to send back. */
  issue(entry: HandoffEntry): number {
    if (this.byCharacterId.size > 4096) this.byCharacterId.clear(); // a stub, not a session store
    this.byCharacterId.set(entry.characterId, entry);
    return entry.characterId >>> 0;
  }

  /** Consumes a handoff (single use) and returns what it stood for. */
  claim(characterId: number): HandoffEntry | undefined {
    const entry = this.byCharacterId.get(characterId);
    if (entry) this.byCharacterId.delete(characterId);
    return entry;
  }

  get pending(): number {
    return this.byCharacterId.size;
  }
}

export interface LoginServerOptions {
  accounts: Map<string, AccountRecord>;
  worlds: WorldEntry[];
  /** Address handed to the client by the 0x03 reply (the game server's listener). */
  gameServer: { ip: string; port: number };
  /** Handoff registry shared with the game server. Created here when omitted. */
  handoffs?: HandoffRegistry;
  /**
   * Who is online (`net/online.ts`). Created here when omitted - but a server that only has its own
   * table cannot see the other half's sessions, so a caller that runs both (the CLI) passes **one**
   * instance to both.
   */
  online?: OnlineAccounts;
  /**
   * How often a quiet session is asked "are you still there?" (`0x08`; `net/heartbeat.ts`).
   * `0` turns the heartbeat off, which means a session that vanished silently keeps its account
   * occupied until the OS notices - only honest for a test that wants no timers. Defaults to
   * `DEFAULT_PING_MS` (30 s).
   */
  pingMs?: number;
  /**
   * Map id stored in the `CharacterData` of a newly created character. It is the same field the
   * `0x16` packet uses to enter a map (FINDINGS 4.11.2b), so keeping the two equal means the
   * record the client holds matches the map it is about to enter. Defaults to `DEFAULT_MAP_ID`.
   */
  startMapId?: number;
  /**
   * Mesos a newly created character starts with (`--start-mesos`). Defaults to **0**, which is what
   * a 2003 character had: nothing in the binary gives one money, and the way to get some is to kill
   * something and pick the mesos up (`game/drops.ts`).
   *
   * The knob exists because a fresh character otherwise cannot use a single shop - and *which*
   * number a server starts its players with is a server's own decision, like the drop rates
   * (ADR-007) or the starting inventory (`startingCharacterItems`). It only ever affects records
   * created after it is set; a save that already has characters is untouched.
   */
  startMesos?: number;
  /** Cipher seeds and handshake body. Defaults: random seeds, 199 zero bytes. */
  handshake?: { clientSendSeed?: number; clientRecvSeed?: number; body?: Uint8Array };
  /**
   * Called after a mutation this server is responsible for: a character created (`0x05`) or deleted
   * (`0x07`). `game/save.ts` is the implementation that writes a file; a test can pass nothing.
   *
   * A throw from here is caught and logged, not propagated: a save that fails must not kill the
   * connection that triggered it (the login flow already answered the client by then).
   */
  persist?(): void;
  /** One line per event; defaults to nothing. Pass a printer for an operator-facing log. */
  log?(line: string): void;
}

interface ConnectionState {
  stage: "login" | "world" | "char";
  username?: string;
  /** The appearance words the last 0x06 request asked for, kept for the next 0x05. */
  appearanceHint?: number[];
}

/** The login half of a session: handshake out, stage-aware replies back. */
export class LoginServer {
  readonly handoffs: HandoffRegistry;
  /** The seats this server takes: one account, one live session (ADR-018). */
  readonly online: OnlineAccounts;
  private readonly options: LoginServerOptions;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly heartbeat: Heartbeat;
  private readonly seats: SeatKeeper;
  private listenPort = 0;

  constructor(options: LoginServerOptions) {
    this.options = options;
    this.handoffs = options.handoffs ?? new HandoffRegistry();
    this.online = options.online ?? new OnlineAccounts();
    this.heartbeat = new Heartbeat({
      intervalMs: options.pingMs ?? DEFAULT_PING_MS,
      ...(options.log !== undefined ? { log: options.log } : {}),
    });
    this.seats = new SeatKeeper({ online: this.online, heartbeat: this.heartbeat, where: "login" });
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (error) => this.log(`listen error: ${error.message}`));
  }

  get port(): number {
    return this.listenPort;
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  listen(port = 0, host = "0.0.0.0"): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        const address = this.server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("unexpected listen address"));
          return;
        }
        this.listenPort = address.port;
        resolve({ host, port: address.port });
      });
    });
  }

  close(): Promise<void> {
    // The seats first: a caller that closes this server and immediately opens another one on the same
    // `OnlineAccounts` (a test, a restart) must not wait for the sockets' `close` events to land.
    this.seats.releaseAll();
    this.heartbeat.close();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /**
   * Builds a character. Only the fields this server can honestly fill are set.
   *
   * `items` is what makes the character look dressed: the client draws the avatar from the worn
   * equips in `CharacterData` (`flags & 0x02`), so a caller that has an item model should pass one.
   * With no items the record stays a flags byte + the 69-byte stat block, which the client accepts.
   *
   * `appearance` is the ten u32 of `0x06` (FINDINGS 4.8.1a): words 1..2 are the face and the hair
   * the record's `appearanceA`/`appearanceB` hold (a 0 in either would draw a faceless character,
   * hence `lookOf`), and words 3..6 are the top, pants, shoes and weapon the dialog picked - they
   * become *worn equips* (`wornOfLook`), which is the only place the client reads clothes from when
   * it rebuilds an avatar (`sub_42E2C0`). Words 7..10 are the dice the dialog rolled; which die is
   * STR/DEX/INT/LUK is still unknown, so they are logged by the caller and otherwise dropped.
   */
  createCharacter(
    id: number,
    name: string,
    appearance: number[],
    template?: CharacterStats,
    items?: CharacterItems,
  ): CharacterData {
    const look = lookOf({ appearanceA: appearance[0] ?? 0, appearanceB: appearance[1] ?? 0 });
    // A character without slots could never be handed anything: the capacity byte is what makes the
    // client allocate an inventory at all (see `startingCharacterItems`), so bags are the default.
    const block = withWorn(items ?? startingCharacterItems(), wornOfLook(appearance));
    if (template) {
      const stats: CharacterStats = {
        ...template,
        id,
        name,
        appearanceA: look.face,
        appearanceB: look.hair,
        hp: template.maxHp,
        mp: template.maxMp,
      };
      return characterDataOf(stats, block);
    }
    const stats = zeroStats();
    stats.id = id;
    stats.name = name;
    stats.appearanceA = look.face;
    stats.appearanceB = look.hair;
    stats.mapId = this.options.startMapId ?? DEFAULT_MAP_ID;
    stats.level = 1;
    stats.str = 5;
    stats.dex = 5;
    stats.int = 5;
    stats.luk = 5;
    stats.hp = 50;
    stats.maxHp = 50;
    stats.mp = 50;
    stats.maxMp = 50;
    stats.mesos = this.options.startMesos ?? 0;
    return characterDataOf(stats, block);
  }

  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    const clientSendSeed = this.options.handshake?.clientSendSeed ?? randomSeed();
    const clientRecvSeed = this.options.handshake?.clientRecvSeed ?? randomSeed();
    const body = this.options.handshake?.body ?? new Uint8Array(HANDSHAKE_BODY_BYTES);
    if (body.length !== HANDSHAKE_BODY_BYTES) {
      throw new RangeError(`handshake body must be ${HANDSHAKE_BODY_BYTES} bytes, got ${body.length}`);
    }

    // The server speaks first (FINDINGS 2). The handshake seeds the client's send state with
    // `clientSendSeed` and its receive state with `clientRecvSeed`; our send state therefore
    // starts from `clientRecvSeed` and our deframer from `clientSendSeed`.
    const sendState = new CipherState(clientRecvSeed);
    const deframer = new SessionDeframer({
      recvState: new CipherState(clientSendSeed),
      expectHandshake: false,
      expectedMagic: CLIENT_SEND_MAGIC,
    });
    const state: ConnectionState = { stage: "login" };
    socket.write(encodeHandshake(body, clientSendSeed, clientRecvSeed));
    this.log(`conn: handshake sent (clientSend=0x${hex(clientSendSeed)} clientRecv=0x${hex(clientRecvSeed)})`);

    socket.on("data", (chunk) => {
      for (const event of deframer.push(new Uint8Array(chunk))) {
        if (event.kind !== "packet") continue;
        // Any packet at all is proof of life for the heartbeat: the client is talking to us.
        this.heartbeat.note(socket);
        if (!event.headerOk) {
          this.log(`conn: dropping packet with a bad header (0x${hex(event.header)})`);
          continue;
        }
        try {
          this.onPacket(socket, state, sendState, event);
        } catch (error) {
          this.log(`conn: handler error: ${(error as Error).message}`);
        }
      }
      if (deframer.failure) this.log(`conn: session ended: ${deframer.failure}`);
    });
    socket.on("error", () => this.sockets.delete(socket));
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.seats.release(socket);
      this.log("conn: closed");
    });
  }

  private reply(socket: net.Socket, sendState: CipherState, body: Uint8Array): void {
    socket.write(encodeSessionPacket(body, sendState, "s2c"));
  }

  private onPacket(
    socket: net.Socket,
    state: ConnectionState,
    sendState: CipherState,
    event: Extract<SessionEvent, { kind: "packet" }>,
  ): void {
    const packet = decodeClientPacket(event.plain);
    this.log(`packet: op=0x${hex(packet.opcode)} ${describeClientPacket(event.plain) ?? "(unmapped)"}`);

    switch (packet.kind) {
      case "handshake-reply":
        // The client sends this on every new connection; on the login server it is always 0
        // because only the 0x03 reply sets CWvsApp+0x14.
        this.log(`  note: handshake reply, characterId=0x${hex(packet.value)} (the game server claims it)`);
        return;

      case "login-request": {
        if (state.stage !== "login") return;
        const account = this.options.accounts.get(packet.username);
        // Two different codes, because the client has two different messages: an unknown id is
        // "등록되지 않은 아이디입니다." (5) and a wrong password is "잘못된 패스워드입니다." (4,
        // `sub_4D0DB0`). Telling them apart is what the 2003 client was written for.
        if (!account) {
          this.log(`  login refused: no account named "${packet.username}"`);
          this.reply(socket, sendState, encodeLoginResult(LOGIN_RESULT.notRegistered));
          return;
        }
        if (account.password !== packet.password) {
          this.log(`  login refused for "${packet.username}": wrong password`);
          this.reply(socket, sendState, encodeLoginResult(LOGIN_RESULT.wrongPassword));
          return;
        }
        // One account, one live session: the client has a message for exactly this - "현재 접속중인
        // 아이디이거나, 현재 서버점검중입니다." (7) - and letting the second one in would give two
        // connections one character record to fight over (`net/online.ts`, ADR-018).
        const held = this.online.sessionsOf(packet.username);
        if (held.length > 0) {
          this.log(`  login refused: "${packet.username}" is already online (${describeSessions(held)})`);
          this.reply(socket, sendState, encodeLoginResult(LOGIN_RESULT.alreadyConnected));
          return;
        }
        state.stage = "world";
        state.username = packet.username;
        let pings = 0;
        this.seats.claim(socket, packet.username, () => this.reply(socket, sendState, encodeEcho(++pings)));
        this.reply(
          socket,
          sendState,
          encodeLoginResult(LOGIN_RESULT.ok, {
            account: { app4: account.characters.length, app8: 1, app9: 1 },
            worlds: this.options.worlds,
          }),
        );
        this.log(`  logged in as "${packet.username}", ${this.options.worlds.length} world(s) offered`);
        return;
      }

      case "world-select": {
        if (state.stage !== "world" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        if (!account || packet.worldId >= this.options.worlds.length) {
          this.log(`  world index ${packet.worldId} is out of range (${this.options.worlds.length} worlds)`);
          this.reply(socket, sendState, encodeWorldSelectResult(LOGIN_RESULT.systemError));
          return;
        }
        state.stage = "char";
        this.reply(
          socket,
          sendState,
          encodeWorldSelectResult(LOGIN_RESULT.ok, account.characters.slice(0, 3).map(withDefaultLook)),
        );
        this.log(`  world ${packet.worldId} selected, ${Math.min(account.characters.length, 3)} character(s) sent`);
        return;
      }

      case "select-character": {
        if (state.stage !== "char" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        const character = account?.characters.find((entry) => entry.stats.id === packet.characterId);
        if (!character) {
          this.log(`  character ${packet.characterId} does not exist`);
          this.reply(socket, sendState, encodeSelectCharacterResult(LOGIN_RESULT.systemError));
          return;
        }
        const characterId = this.handoffs.issue({
          username: state.username,
          characterId: packet.characterId,
          characterName: character.stats.name,
          character,
        });
        this.reply(
          socket,
          sendState,
          encodeSelectCharacterResult(LOGIN_RESULT.ok, {
            ip: this.options.gameServer.ip,
            port: this.options.gameServer.port,
            characterId,
          }),
        );
        this.log(
          `  "${character.stats.name}" handed to ${this.options.gameServer.ip}:${this.options.gameServer.port} ` +
            `as character 0x${hex(characterId)}`,
        );
        return;
      }

      case "check-name": {
        if (state.stage !== "char" || state.username === undefined) return;
        state.appearanceHint = packet.appearance;
        const taken = this.nameTaken(packet.name);
        this.reply(socket, sendState, encodeNameCheckResult(packet.name, taken ? NAME_CHECK_RESULT.taken : NAME_CHECK_RESULT.available));
        this.log(
          `  name "${packet.name}" is ${taken ? "taken" : "free"} ` +
            `(look: ${describeLookWords(packet.appearance)})`,
        );
        return;
      }

      case "create-character": {
        if (state.stage !== "char" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        if (!account) return;
        // A refusal is the bare reply with result 0 - the client prints "캐릭터 생성에 실패했습니다"
        // for every failure (the *why* is this log), and 0 is the one value it never decodes a record
        // from (`sub_4329A0`; see `encodeCreateCharacterResult`).
        if (account.characters.length >= 3) {
          this.log(`  create refused: "${state.username}" already has three characters`);
          this.reply(socket, sendState, encodeCreateCharacterResult());
          return;
        }
        if (this.nameTaken(packet.name)) {
          this.log(`  create refused: the name "${packet.name}" is taken`);
          this.reply(socket, sendState, encodeCreateCharacterResult());
          return;
        }
        const template = account.characters[0]?.stats;
        const created = this.createCharacter(nextCharacterId(this.options.accounts), packet.name, state.appearanceHint ?? [], template);
        account.characters.push(created);
        this.reply(socket, sendState, encodeCreateCharacterResult(withDefaultLook(created)));
        this.log(`  created "${created.stats.name}" (id ${created.stats.id}) ${describeWorn(created)}`);
        this.persist();
        return;
      }

      case "delete-character": {
        if (state.stage !== "char" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        if (!account) return;
        const index = account.characters.findIndex((entry) => entry.stats.id === packet.characterId);
        if (index < 0) {
          // The client throws CTerminateException when the id is not in its three slots, so
          // replying with the wrong id would kill the connection. Say nothing instead.
          this.log(`  delete ignored: character ${packet.characterId} is not in the account`);
          return;
        }
        const [removed] = account.characters.splice(index, 1);
        this.reply(socket, sendState, encodeDeleteCharacterResult(packet.characterId, 1));
        this.log(`  deleted "${removed?.stats.name ?? "?"}" (id ${packet.characterId})`);
        this.persist();
        return;
      }

      case "echo":
        // The client's answer to our `0x08` heartbeat. The data handler already counted it as proof
        // of life, and there is nothing to answer and nothing to log: a line per heartbeat per
        // session would be the loudest thing in this file. (The client only ever sends `0x08` as an
        // echo - `sub_43B280` is both its handler and its only sender - so there is no request here
        // to serve.)
        return;

      case "unknown":
        this.log(`  note: unmapped opcode kept as ${packet.body.length} raw byte(s)`);
        return;
    }
  }

  /**
   * Hands the accounts to the caller's store, if there is one.
   *
   * The accounts table is the same object the caller keeps (`LoginServerOptions.accounts`), and the
   * character records inside it are the objects the game server mutates, so "persist now" needs no
   * argument: the truth is already in one place.
   */
  private persist(): void {
    try {
      this.options.persist?.();
    } catch (error) {
      this.log(`persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private nameTaken(name: string): boolean {
    const wanted = name.toLowerCase();
    for (const account of this.options.accounts.values()) {
      if (account.characters.some((entry) => entry.stats.name.toLowerCase() === wanted)) return true;
    }
    return false;
  }
}

/**
 * The map a character enters when the game server has nothing better to say.
 *
 * `1000000` is a real map of the shipped client: `Map/Map/001000000.img` (83,463 bytes) is in
 * `analysis/data_wz_manifest.txt`. Nothing is invented here - the server may tell the client any
 * map id that exists in `Data.wz`, and this is the one the stub picks.
 */
export const DEFAULT_MAP_ID = 1000000;

/**
 * The game-server side of the handoff: handshake, then `[0x04][characterId]`, then the field.
 *
 * The order is the one FINDINGS 2 / 4.8 / 4.11.2b describe: the game server opens with the 211-byte
 * handshake, the client answers `[0x04][characterId]` (the id the login server issued), and the
 * server then sends `0x16` - `u8 mode, u8 full, [three u32 seed parts, CharacterData]` - which is
 * what puts the client into a map. The map id is a field *inside* that `CharacterData`, so the
 * server decides the map by rewriting one word (see `CharacterData.mapId`).
 *
 * Then the field (`game/world.ts`, ADR-012) takes over: the map's monsters, NPCs and loot live in one
 * object per map id, shared by every connection in it, and this class is what wires a socket to it -
 * `0x2F`/`0x39`/`0x43` to the joining player, `0x1C` to the players already there, the client's own
 * moves (`0x0E`) relayed as `0x22`, and the world's clock in one server-wide timer.
 */
/**
 * The client -> server opcodes that carry a swing. All three share one target record (`field.ts`),
 * so one handler covers them: what the server does with a swing does not depend on how it was made.
 */
/** The field's tick when `mobTickMs` is not given: 4 legs a second is what a 2003 client looks smooth at. */
const DEFAULT_MOB_TICK_MS = 250;

export const ATTACK_OPCODES: readonly number[] = [
  CLIENT_FIELD_OPCODE.attack,
  CLIENT_FIELD_OPCODE.magicAttack,
  CLIENT_FIELD_OPCODE.skillAttack,
];

export interface GameEntryServerOptions {
  handoffs: HandoffRegistry;
  handshake?: { clientSendSeed?: number; clientRecvSeed?: number; body?: Uint8Array };
  /**
   * Where a character enters when their **record has no map of its own** (`stats.mapId == 0`).
   * Defaults to `DEFAULT_MAP_ID`.
   *
   * Every character the login server creates carries its own map (`startMapId` there), so this is the
   * fallback: a hand-built handoff, or a record from before this server had more than one map. A
   * character whose record *does* name a map enters that one - a player logs back in where they left
   * (`net/loginserver.ts`'s `withMapId`, FINDINGS 4.11.2b).
   */
  mapId?: number;
  /**
   * Where the map's monsters come from. `mapDataProvider(WzArchive)` is the real one; tests pass a
   * stub. Without it the connection still enters its map, it just has nothing to spawn.
   */
  mapProvider?: (mapId: number) => MapData | undefined;
  /**
   * The NPC shops (which NPC sells what, and at which price). `shopKeeper(WzArchive)` is the real
   * one; without it an NPC click is answered with the empty `0x19` and nothing else.
   */
  shops?: ShopKeeper;
  /** Mob stats (`Mob/<id>.img -> info`); `mobTemplateProvider(WzArchive)` is the real one. */
  mobTemplate?: (templateId: number) => MobTemplate | undefined;
  /**
   * NPC templates (`Npc/<id>.img`). `npcTemplateProvider(WzArchive)` is the real one.
   *
   * With it, a `life` entry whose image is not in the archive is **skipped** (the client would look
   * up a file that is not there) and the rest carry their `info/name` into the logs. Without it every
   * entry is spawned unnamed: the packet itself does not depend on the template, because the client
   * loads the image on its own.
   */
  npcTemplate?: (templateId: number) => NpcTemplate | undefined;
  /**
   * What an NPC says (`Npc/<id>.img -> info/speak`). `npcDialogueProvider(WzArchive)` is the real
   * one.
   *
   * With it, clicking an NPC this server keeps no shop for opens a `0x47` dialog with the NPC's own
   * first line, and the client's `0x15` answer walks to the next one (`game/dialogue.ts`). Without
   * it - or for an NPC whose image has no `speak` list - a click is answered with the release byte
   * alone, which is what an NPC with nothing to say deserves.
   */
  npcDialogue?: (templateId: number) => NpcDialogue | undefined;
  /**
   * What a USE-tab item does when it is used (`Item/Consume/0XXX.img -> spec`).
   * `consumeSpecProvider(WzArchive)` is the real one.
   *
   * With it, `0x18` restores HP/MP and `0x19` changes the map; without it (or for an item the
   * archive has no `spec` for) every use is refused - with an empty `0x0B`, never with silence
   * (`handleUseItem`).
   */
  consumeSpec?: (itemId: number) => ConsumeSpec | undefined;
  /**
   * Which NPCs the **client** walks (`0x3B` flag 1, FINDINGS 4.28). `npcWalkPolicy` turns
   * `--npc-walk` into this; absent means no NPC walks, which is the honest default - the mechanism is
   * the client's, but *which* NPCs the 2003 server walked is not located.
   */
  npcWalk?: (templateId: number) => boolean;
  /** Walking speed of a mob at 100%, in px/s. Defaults to `PATROL_SPEED_PX_PER_SEC`. */
  mobSpeedPxPerSecond?: number;
  /** How often the field hands out mob movement legs, in ms. Defaults to 250. */
  mobTickMs?: number;
  /** How long a killed mob stays away before it is spawned again, in ms. Defaults to `MOB_RESPAWN_MS`. */
  mobRespawnMs?: number;
  /**
   * What a killed monster leaves behind. `defaultDropPolicy` (the shipped table: mesos, the mob's
   * own junk item, a potion) is the default; a test passes a fixed one.
   */
  dropPolicy?: DropPolicy;
  /** How long a drop lies on the ground, in ms. Defaults to `DROP_LIFETIME_MS`. */
  dropLifetimeMs?: number;
  /** Horizontal/vertical reach of a pickup, in px. Server choices (`game/drops.ts`). */
  pickupRangeX?: number;
  pickupRangeY?: number;
  /** How far from the monster a drop may land, in px. Defaults to `DROP_SPREAD_PX`. */
  dropSpreadPx?: number;
  /** Who is online. See `LoginServerOptions.online`: one instance for both halves. */
  online?: OnlineAccounts;
  /** Heartbeat interval for a quiet field session; see `LoginServerOptions.pingMs`. */
  pingMs?: number;
  /**
   * Called when a **session ends** - the one point where a character's play leaves this process.
   *
   * Everything a player changes in a field (exp, level, items, mesos, `mapId` from a portal) is
   * written into the `CharacterData` the login server handed over, so "persist now" is the whole
   * save: there is no second copy to reconcile. Saving only here is a choice: a server that is killed
   * mid-session loses that session, and a save per packet would rewrite the file for every step of a
   * walk.
   */
  persist?(): void;
  log?(line: string): void;
}

/**
 * One connection inside a map.
 *
 * The world itself - the monsters, the NPCs, the loot and the other players - belongs to the field
 * (`game/world.ts`, ADR-012); what is left here is what is *this* connection's: the character record,
 * the wallet, and the shop or dialogue window only it has open. It implements `FieldMember`, which is
 * everything the field asks of a player: an id, a name, an avatar list, and a way to write.
 */
interface FieldSession extends FieldMember {
  /**
   * The field this session is in. A `FieldSession` only exists when one does - `enterField` refuses to
   * build one for a map this server cannot read - so this is never a "maybe".
   */
  instance: FieldInstance<FieldSession>;
  /** The record the client was sent (`0x16`); the inventories here are what a pickup fills. */
  character: CharacterData;
  /** The wallet over `character.stats` - one number, two views (FINDINGS 4.22.5). */
  wallet: MesoWallet;
  /**
   * Writes one packet to this player's client, encrypted for this connection.
   *
   * It is captured once, at field entry, because the cipher state moves with every packet; the field
   * fans its packets out through this same function (`FieldMember.send`), which is why it is the only
   * way out of a session.
   */
  send(packet: Uint8Array): void;
  /**
   * The shop this session has open, if any (`0x4A` was sent and no close came back).
   *
   * It is what a `0x16` request is validated against: the client sends an item id and a slot, never
   * the shop, so the server has to remember which window it opened. A second `0x4A` while one is
   * open would make the client throw (`sub_4B73A0` case 74), so this is also the guard for that.
   */
  shop?: ShopDef;
  /**
   * The NPC conversation this session is in the middle of, if any (`0x47` was sent and no answer
   * has come back for the last line).
   *
   * Like `shop`, it is both the state a reply is validated against and the guard that keeps the
   * server from sending a second `0x47` while the client's dialog is up - `CQuestMan+4` throws a
   * `CDisconnectException` for that, the same way the shop dialog refuses a second `0x4A`.
   */
  talk?: NpcTalk;
}

export class GameEntryServer {
  readonly online: OnlineAccounts;
  private readonly options: GameEntryServerOptions;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  /** The maps this server simulates: one field per map id, shared by every session standing in it. */
  private readonly fields: FieldRegistry<FieldSession>;
  /** One character, one session: the second connection for an id is refused (see `onConnection`). */
  private readonly sessionsByCharacter = new Map<number, FieldSession>();
  private readonly heartbeat: Heartbeat;
  private readonly seats: SeatKeeper;
  private listenPort = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: GameEntryServerOptions) {
    this.options = options;
    this.online = options.online ?? new OnlineAccounts();
    this.heartbeat = new Heartbeat({
      intervalMs: options.pingMs ?? DEFAULT_PING_MS,
      ...(options.log !== undefined ? { log: options.log } : {}),
    });
    this.seats = new SeatKeeper({ online: this.online, heartbeat: this.heartbeat, where: "game" });
    this.fields = new FieldRegistry<FieldSession>({
      ...(options.mapProvider !== undefined ? { mapProvider: options.mapProvider } : {}),
      ...(options.mobTemplate !== undefined ? { mobTemplate: options.mobTemplate } : {}),
      ...(options.npcTemplate !== undefined ? { npcTemplate: options.npcTemplate } : {}),
      ...(options.npcWalk !== undefined ? { npcWalk: options.npcWalk } : {}),
      ...(options.mobSpeedPxPerSecond !== undefined
        ? { mobSpeedPxPerSecond: options.mobSpeedPxPerSecond }
        : {}),
      ...(options.mobRespawnMs !== undefined ? { mobRespawnMs: options.mobRespawnMs } : {}),
      ...(options.dropPolicy !== undefined ? { dropPolicy: options.dropPolicy } : {}),
      ...(options.dropLifetimeMs !== undefined ? { dropLifetimeMs: options.dropLifetimeMs } : {}),
      ...(options.pickupRangeX !== undefined ? { pickupRangeX: options.pickupRangeX } : {}),
      ...(options.pickupRangeY !== undefined ? { pickupRangeY: options.pickupRangeY } : {}),
      ...(options.dropSpreadPx !== undefined ? { dropSpreadPx: options.dropSpreadPx } : {}),
      log: (line) => this.options.log?.(`game: ${line}`),
    });
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (error) => this.options.log?.(`game listen error: ${error.message}`));
  }

  get port(): number {
    return this.listenPort;
  }

  listen(port = 0, host = "0.0.0.0"): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        const address = this.server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("unexpected listen address"));
          return;
        }
        this.listenPort = address.port;
        resolve({ host, port: address.port });
      });
    });
  }

  close(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.seats.releaseAll();
    this.heartbeat.close();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.sessionsByCharacter.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /**
   * The world's clock: one interval for the whole server, not one per connection.
   *
   * A field's monsters, corpses and drops keep their own time whether or not anybody is looking
   * (`FieldInstance.tick`), and with several players in one map the walking legs and the respawns have
   * to be planned *once* - a timer per connection would hand every player their own copy of every leg
   * and their own respawn of every corpse. `mobTickMs` is therefore the field's tick, and the numbers
   * inside it (a leg's duration, a respawn delay) are what it is measured in.
   *
   * It starts with the first field, not with the listener: a server nobody has entered has nothing to
   * simulate, and the first player of a map then gets their first leg one tick after they arrive -
   * which is also the order the mob packets have always been sent in (`0x2F` on entry, `0x33` after).
   */
  private startClock(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.tickFields(Date.now()), this.options.mobTickMs ?? DEFAULT_MOB_TICK_MS);
  }

  /** One tick: every field, then the pickup of every player standing on something. */
  private tickFields(now: number): void {
    for (const instance of this.fields.instances()) {
      instance.tick(now);
      for (const session of instance.memberList) this.pickUp(session);
    }
  }

  /** The map this server puts claimers into (`0x16`). */
  private get mapId(): number {
    return this.options.mapId ?? DEFAULT_MAP_ID;
  }

  /**
   * Puts a connection into a map: `0x16` for the client, and a field for the server.
   *
   * The `full` form is used (three seed parts + a whole `CharacterData`) because that is the form that
   * carries the map id; the seeds are the server's choice, and they decide every "random" number the
   * client will roll afterwards (FINDINGS 4.11.2).
   *
   * The order matters in both directions. The client has to have its field before anything about the
   * map arrives, so `0x16` goes first. The *server* needs the field before it can build a session
   * around it, so the map is asked for (and simulated, if this is the first entry - `FieldRegistry`
   * keeps it) right after, and `join` then sends what is in it: the monsters (`0x2F`), the NPCs
   * (`0x39`), the loot already on the ground (`0x43`), and the players already there (`0x1C`).
   *
   * A map this server cannot read - no `Map/Map/*.img` in `Data.wz` - still gets the `0x16`, and then
   * nothing: there is no field to put the connection in, so there is no session either.
   */
  private enterField(socket: net.Socket, sendState: CipherState, entry: HandoffEntry): FieldSession | undefined {
    const character = withMapId(entry, this.mapId);
    const send = (packet: Uint8Array): void => void socket.write(encodeSessionPacket(packet, sendState, "s2c"));
    // The account's seat is taken here rather than at the handshake: this is the moment the character
    // is *in* the world, and the seat must stay taken until this socket ends even if the login
    // connection that handed the character over is already gone (`net/online.ts`). Taken before the
    // map lookup, because a map this server cannot simulate is still a player sitting in the game -
    // their next login has to be refused all the same.
    let pings = 0;
    this.seats.claim(socket, entry.username, () => send(encodeEcho(++pings)));
    const instance = this.fields.of(character.stats.mapId);
    if (instance === undefined) {
      // A map this server cannot read - no `Map/Map/*.img` in `Data.wz` for that id - still gets the
      // `0x16` (the map id lives in the record, and the client would otherwise sit waiting), and then
      // nothing: there is no field to put the connection in, so there is no session either.
      send(encodeSetField(this.setFieldOf(character)));
      this.options.log?.(
        `game: map ${character.stats.mapId} has no Map/Map/*.img in Data.wz, nothing to spawn`,
      );
      return undefined;
    }
    const session: FieldSession = {
      characterId: entry.characterId,
      name: character.stats.name,
      face: lookOf(character.stats).face,
      avatarItems: avatarItemsOf(character),
      instance,
      character,
      wallet: new MesoWallet(character.stats),
      send,
    };
    session.at = instance.spawnAt();
    send(encodeSetField(this.setFieldOf(character)));
    this.logSetField(session);
    instance.join(session);
    this.startClock();
    return session;
  }

  /**
   * Moves a session to another map: out of the field it is in, `0x16` for the new one, into the new
   * field (whose `join` hands it the snapshot - the monsters, the NPCs, the loot, the players there).
   *
   * The order is the one the client forces, and it is also the one the pool keys force:
   *
   *   1. the destination has to exist *first*: `false` - a map with no `Map/Map/*.img` - leaves the
   *      player where they are, which is the only answer that never strands them in a map nobody
   *      simulates;
   *   2. then out of the old field (`0x1D` to everyone still there) - before the new one is
   *      announced, because the client keys users by character id and a player who is "in" two fields
   *      at once would be two users with one id;
   *   3. then `0x16`, because the client has no field object to put the destination's packets in
   *      until it arrives;
   *   4. then the join, which is where the snapshot goes.
   *
   * The shop and the dialog are dropped with the map: the windows belong to NPCs of the map the
   * player just left, and the client tears its own down when the new field is built.
   */
  private enterMap(session: FieldSession, mapId: number): boolean {
    const target = this.fields.of(mapId);
    if (target === undefined) {
      this.options.log?.(
        `game: map ${mapId} has no Map/Map/*.img in Data.wz - "${session.name}" stays in map ` +
          `${session.instance.mapId}`,
      );
      return false;
    }
    session.instance.leave(session.characterId);
    session.instance = target;
    session.character.stats.mapId = mapId;
    session.at = target.spawnAt();
    session.shop = undefined;
    session.talk = undefined;
    session.send(encodeSetField(this.setFieldOf(session.character)));
    this.logSetField(session);
    target.join(session);
    return true;
  }

  /**
   * The `0x16` body for one character: the map comes from `character.stats.mapId`, and `mode` stays
   * `0` because what the client does with other values is not located (FINDINGS 4.11.2b) - so a
   * portal change lands the player where a first entry lands them, at the map's own spawn point
   * (`FieldInstance.spawnAt`).
   */
  /**
   * The `0x16` body for one character.
   *
   * The record is the one the client builds the whole field avatar from, so it is also the one place
   * a look is *required*: `withDefaultLook` fills the starter face and hair into a record that has
   * none (an older save, or a hand-built handoff), because a 0 there is a body part no WZ archive
   * has and the player would stand there without a face.
   */
  private setFieldOf(character: CharacterData): SetField {
    return {
      mode: 0,
      full: true,
      randomSeedA: randomSeed(),
      randomSeedB: randomSeed(),
      randomSeedC: randomSeed(),
      character: withDefaultLook(character),
    };
  }

  /** The one line every field entry logs, first one and map change alike. */
  private logSetField(session: FieldSession): void {
    this.options.log?.(
      `game: sent 0x16 - "${session.name}" enters map ${session.character.stats.mapId}`,
    );
  }

  /**
   * `0x0D` - the one field request that carries a `kind` (`s32 kind` + `string name`, FINDINGS
   * 4.11.6/4.32): a click on the object under the cursor (`INTERACT_KIND_CURSOR`) or the revive
   * dialog's OK (`INTERACT_KIND_REVIVE`). The GM map command builds the same packet with a map id in
   * `kind`; this server has no GM commands, so that one is a log line instead of a teleport.
   *
   * The release byte is owed before anything else, and before the packet is even read: `sub_472590`
   * arms the client's interact gate when it sends `0x0D` and nothing clears it but an empty `0x19`,
   * so a request this server does not understand still has to be answered or the player could never
   * click anything again.
   */
  private handleInteract(session: FieldSession, plain: Uint8Array): void {
    session.send(encodeFieldRequestRelease());
    let request: ClientInteract;
    try {
      request = readClientInteract(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(`game: 0x0D unreadable: ${(error as Error).message}`);
      return;
    }
    if (request.kind === INTERACT_KIND_CURSOR) {
      this.usePortal(session, request.name);
      return;
    }
    if (request.kind === INTERACT_KIND_REVIVE) {
      this.revive(session);
      return;
    }
    this.options.log?.(
      `game: 0x0D kind ${request.kind} is neither a portal click (${INTERACT_KIND_CURSOR}) ` +
        `nor a revive (${INTERACT_KIND_REVIVE}), ignored`,
    );
  }

  /**
   * A cursor click on the map's own portal.
   *
   * `name` is what the client read out of the map file for the thing under the cursor; **where it
   * leads comes from the same map data** (`portal.tm`), never from the packet - a name that is not
   * this map's portal is a log line, not a teleport.
   *
   * A portal that leads to the map the player is already in is handled like any other: the field is
   * left and joined again, which is what a client does when it walks through one (it rebuilds the
   * field) - there is no special case here to get wrong.
   */
  private usePortal(session: FieldSession, name: string): void {
    const portal = session.instance.portal(name);
    if (portal === undefined) {
      this.options.log?.(`game: 0x0D "${name}" is no portal of map ${session.instance.mapId}`);
      return;
    }
    if (portal.toMapId === 0) {
      this.options.log?.(`game: portal "${name}" of map ${session.instance.mapId} leads nowhere (tm = 0)`);
      return;
    }
    this.options.log?.(
      `game: "${session.name}" uses portal "${name}" of map ${session.instance.mapId} -> ${portal.toMapId}` +
        (portal.toName === "" ? "" : ` (portal "${portal.toName}")`),
    );
    this.enterMap(session, portal.toMapId);
  }

  /**
   * The revive dialog's OK (`0x0D` `kind = 0`, `sub_4E9E70`, FINDINGS 4.32): the player's HP goes back
   * to full and they are moved to the map `info/returnMap` names - the client's own promise is "you
   * will be moved to a safe town", and it asks the server to do both, because the client never reads
   * `returnMap` itself.
   *
   * The `0x16` is what actually revives them, not just a move: it rebuilds the client's field and the
   * local user with it (`sub_4C2780` -> `sub_51CBF0` -> `sub_511030`), so the dead state and the
   * tombstone belong to the field that is being replaced. That is also why the HP is restored *before*
   * the map is entered: the same `0x16` carries the whole `CharacterData`, and the record inside it is
   * the one the client's HP bar draws (FINDINGS 4.21) - there is no second packet to send.
   *
   * A `returnMap` this server cannot read (it names a map with no `Map/Map/*.img`) falls back to the
   * map the player is already in, which is a field that exists by definition - the alternative would
   * be leaving them dead. The same fallback covers the case the shipped data makes common: a **town**
   * carries `returnMap = RETURN_MAP_NONE` (암허스트 does, `test/map.test.ts`), so dying in a town
   * re-enters the town.
   */
  private revive(session: FieldSession): void {
    const stats = session.character.stats;
    stats.hp = stats.maxHp;
    const here = session.instance.mapId;
    const target = reviveMapId(session.instance.map);
    this.options.log?.(
      `game: "${session.name}" revives - hp ${stats.hp}/${stats.maxHp}, map ${here} -> ${target}`,
    );
    if (target !== here && this.enterMap(session, target)) return;
    this.enterMap(session, here);
  }

  /**
   * The player's own HP/MP change (`0x1C`, FINDINGS 4.33) - the packet that makes "a monster hit me"
   * visible, because the damage itself never travels:
   *
   *   `[0x1C][u32 flags][s16 hp delta][s16 mp delta][u8 flag]`
   *
   * The 2003 client runs the monster AI and rolls the damage it takes locally (`sub_511C60` ->
   * `sub_4C8ED0` -> `sub_5114A0`), then reports the signed delta here - and its own character record
   * is **not** written on that path: the record's HP is written by this server's `0x0D`
   * (`sub_45E0D0`). So the answer to this packet *is* what moves the HP bar: apply, clamp, and send
   * the diff back. The map's own regeneration rides the same packet with positive deltas
   * (`sub_558950`).
   *
   * The value is a delta, so no absolute number has to be trusted - but the amount is still the
   * client's arithmetic, and there is no server-side damage model to check it against (ADR-021).
   * The rules that *are* the server's - the `[0, max]` clamp and "a dead character does not
   * regenerate" - live in `game/vitals.ts`; the diff it returns is only sent when a field moved.
   */
  private handleStatReport(session: FieldSession, plain: Uint8Array): void {
    try {
      const report = readClientStatReport(new PacketReader(plain, 1));
      const stats = session.character.stats;
      const diff = applyVitalReport(stats, report);
      if (Object.keys(diff).length > 0) session.send(encodeStatUpdate({ diff }));
      this.options.log?.(
        `game: "${session.name}" 0x1c stat report: ${describeClientStatReport(report)} - hp ` +
          `${stats.hp}/${stats.maxHp} mp ${stats.mp}/${stats.maxMp}` +
          (Object.keys(diff).length === 0 ? " (nothing changed)" : ""),
      );
    } catch (error) {
      this.options.log?.(`game: 0x1C stat report unreadable: ${(error as Error).message}`);
    }
  }

  /**
   * The player used an item out of the USE tab: `0x18` for the 200/201/202 families (potions and
   * food) and `0x19` for 203 (the 귀환 주문서 line, `spec/moveTo`). FINDINGS 4.34, `game/items.ts`.
   *
   * Both are two fields - `slot`, `itemId` - and both are **the client asking the server to do it**:
   * the client's own character record is not written on this path (only `0x0D` writes it), so the
   * heal or the teleport only happens because of what this sends back:
   *
   *   `0x0B`  the item left the slot (a `put` with what remains, or a `clear` when the stack ran
   *           out) - the only packet that changes an inventory.
   *   `0x0D`  for a potion: the vitals that moved, with the same `[0, max]` clamp every other HP
   *           change goes through (`game/vitals.ts`).
   *   `0x16`  for a return scroll: the map its own `spec/moveTo` names, through the same `enterMap`
   *           a portal uses - `-1` (마을 귀환 주문서, "the nearest town") is read with the map's
   *           `info/returnMap`, the one `reviveMapId` already answers with.
   *
   * A use that cannot happen is **still answered**, with an empty `0x0B`: the senders arm the same
   * one-request-at-a-time gate an object click does (`*(this + 6)`, cleared by a non-zero `0x0B`
   * result or `0x0D` ack), so silence would leave the player unable to use anything at all - and
   * since the client's inventory only changes on `0x0B`, an empty one *is* the refusal.
   */
  private handleUseItem(session: FieldSession, plain: Uint8Array, opcode: number): void {
    const label = opcode === CLIENT_FIELD_OPCODE.useMapItem ? "0x19 map item" : "0x18 item";
    let request: ClientUseItem;
    try {
      request = readClientUseItem(new PacketReader(plain, 1), opcode);
    } catch (error) {
      // Nothing can be answered: the slot is what the answer would name, and it did not parse.
      this.options.log?.(`game: ${label} unreadable: ${(error as Error).message}`);
      return;
    }
    const refuse = (reason: string): void => {
      session.send(encodeInventoryChange([]));
      this.options.log?.(
        `game: ${label} slot ${request.slot} item ${request.itemId} by "${session.name}" refused (${reason})`,
      );
    };
    const spec = this.options.consumeSpec?.(request.itemId);
    if (spec === undefined) {
      refuse("the archive does not say what this item does (no Item/Consume spec)");
      return;
    }
    if (spec.unapplied.length > 0) {
      // A buff item: applying half of it would burn the item for the fields that *are* located.
      refuse(`spec field(s) ${spec.unapplied.join(", ")} are not applied yet`);
      return;
    }
    const items = session.character.items ?? emptyCharacterItems();
    const stats = session.character.stats;
    if (opcode === CLIENT_FIELD_OPCODE.useMapItem) {
      this.useMapItem(session, request, spec, refuse);
      return;
    }
    if (!healsVitals(spec)) {
      refuse("no hp/mp effect located in its spec");
      return;
    }
    // The rules are `game/vitals.ts`'s, and the copy is how "would anything move?" is asked without
    // applying twice: a potion used at full HP changes nothing, and nothing is what it should cost.
    const probe: CharacterStats = { ...stats };
    const diff = applyVitalReport(probe, consumeDeltas(spec, stats));
    if (Object.keys(diff).length === 0) {
      refuse(`hp ${stats.hp}/${stats.maxHp} mp ${stats.mp}/${stats.maxMp} is already what it restores`);
      return;
    }
    const taken = takeItem(items, request.itemId, request.slot, 1);
    if (taken === undefined) {
      refuse(`slot ${request.slot} of the USE tab does not hold item ${request.itemId}`);
      return;
    }
    stats.hp = probe.hp;
    stats.mp = probe.mp;
    session.send(encodeInventoryChange([taken.change]));
    session.send(encodeStatUpdate({ diff }));
    this.options.log?.(
      `game: ${label} slot ${request.slot} item ${request.itemId} by "${session.name}" -> ` +
        `hp ${stats.hp}/${stats.maxHp} mp ${stats.mp}/${stats.maxMp}, ${taken.remaining} left in the slot`,
    );
  }

  /**
   * The `0x19` half: a 203-family item changes the map the item itself names (`spec/moveTo`), through
   * the same `enterMap` a portal or a revive uses.
   *
   * The destination is resolved **before** the item is taken: a map this server cannot read (or an
   * item with no `moveTo` at all) refuses the use, so a scroll never disappears into nothing. `-1`
   * is 마을 귀환 주문서 - "현재 위치에서 가장 가까운 마을" in its own `info/desc` - and the nearest
   * town the data has an answer for is the map's `info/returnMap` (`reviveMapId`), which is the same
   * field the revive dialog's town comes from. A town carries `RETURN_MAP_NONE` there, so the scroll
   * re-enters the town it was used in - a real `0x16`, landing on the map's own spawn point.
   */
  private useMapItem(
    session: FieldSession,
    request: ClientUseItem,
    spec: ConsumeSpec,
    refuse: (reason: string) => void,
  ): void {
    if (spec.moveTo === undefined) {
      refuse("no spec/moveTo: this item does not name a map");
      return;
    }
    const target = spec.moveTo < 0 ? reviveMapId(session.instance.map) : spec.moveTo;
    if (target <= 0) {
      refuse(`spec/moveTo ${spec.moveTo} is not a map id`);
      return;
    }
    // `of` is what a portal is checked with, and it refuses (without caching) a map the archive has
    // no `Map/Map/*.img` for - the same answer `enterMap` would give, but asked before the item goes.
    if (this.fields.of(target) === undefined) {
      refuse(`map ${target} has no Map/Map/*.img in Data.wz`);
      return;
    }
    const items = session.character.items ?? emptyCharacterItems();
    const taken = takeItem(items, request.itemId, request.slot, 1);
    if (taken === undefined) {
      refuse(`slot ${request.slot} of the USE tab does not hold item ${request.itemId}`);
      return;
    }
    session.send(encodeInventoryChange([taken.change]));
    this.options.log?.(
      `game: 0x19 map item slot ${request.slot} item ${request.itemId} by "${session.name}" -> ` +
        `map ${session.instance.mapId} -> ${target} (moveTo ${spec.moveTo})`,
    );
    this.enterMap(session, target);
  }

  /**
   * The player clicked a field object (`0x33`) - for an NPC, the click that opens its shop or starts
   * a conversation.
   *
   * The release byte comes first, always:
   *
   *   `0x19`  an empty packet that clears the client's "a field request is pending" gate. Every
   *           click arms it (`sub_55AF20`), and the client sends nothing else until it is cleared -
   *           so this is owed even when the answer is "nothing here".
   *
   * Then one of three things, or nothing:
   *
   *   `0x4A`  the object is an NPC this server keeps a shop for: the window and its rows, priced
   *           from the item's own `info/price` (`game/shops.ts`), never a guess.
   *   `0x47`  the object is an NPC with no shop but with something to say: the first line of its
   *           `info/speak` list as a `say` dialog (`game/dialogue.ts`), which the client answers
   *           with `0x15` and this session then walks line by line.
   *   nothing an object id the field does not have, an NPC with neither a shop nor lines, or a
   *           click while another dialog is already open - a second `0x4A`/`0x47` makes the client
   *           throw, so that click is answered with the release byte and a log line instead.
   */
  private handleObjectClick(session: FieldSession, plain: Uint8Array): void {
    let objectId: number;
    try {
      objectId = readClientObjectClick(new PacketReader(plain, 1)).objectId;
    } catch (error) {
      this.options.log?.(`game: 0x33 object click unreadable: ${(error as Error).message}`);
      return;
    }
    session.send(encodeFieldRequestRelease());
    const npc = session.instance.npcs.byId(objectId);
    if (npc === undefined) {
      this.options.log?.(`game: object click ${objectId} is not an NPC of this field - released only`);
      return;
    }
    // A second 0x4A or 0x47 while a dialog is up is a `CDisconnectException` on the client, so a
    // click that arrives anyway is answered with the release byte and nothing else.
    if (session.shop !== undefined) {
      this.options.log?.(
        `game: NPC ${objectId} clicked while shop ${session.shop.shopId} is open - nothing else sent`,
      );
      return;
    }
    if (session.talk !== undefined) {
      this.options.log?.(
        `game: NPC ${objectId} clicked while NPC ${session.talk.npcId} is still talking - nothing else sent`,
      );
      return;
    }
    const shop = this.options.shops?.shopOfNpc(npc.templateId);
    if (shop !== undefined) {
      const items = this.options.shops?.linesOf(shop) ?? [];
      session.shop = shop;
      session.send(encodeShopOpen({ shopId: shop.shopId, items }));
      this.options.log?.(
        `game: opened shop ${shop.shopId} for NPC ${objectId} (template ${npc.templateId}) with ${items.length} row(s)`,
      );
      return;
    }
    this.talkTo(session, objectId, npc.templateId);
  }

  /**
   * Start a conversation with an NPC that keeps no shop: `0x47` with the first of its own lines.
   *
   * The words are the archive's (`Npc/<id>.img -> info/speak`); this server contributes nothing but
   * the walking order. An NPC whose image has no `speak` list - `메이플운수 중형택시` is one in the
   * shipped data - simply has nothing to say, and a click on it stays at the release byte.
   */
  private talkTo(session: FieldSession, npcId: number, templateId: number): void {
    const dialogue = this.options.npcDialogue?.(templateId);
    if (dialogue === undefined) {
      this.options.log?.(
        `game: NPC ${npcId} (template ${templateId}) has no template to talk from - released only`,
      );
      return;
    }
    if (dialogue.lines.length === 0) {
      this.options.log?.(
        `game: NPC ${npcId} (template ${templateId}, "${dialogue.name}") has no info/speak lines - released only`,
      );
      return;
    }
    const talk = new NpcTalk(npcId, templateId, dialogue.lines);
    session.talk = talk;
    session.send(talk.packet());
    this.options.log?.(
      `game: NPC ${npcId} ("${dialogue.name}") says line 1/${talk.lineCount}: "${dialogue.lines[0]}"`,
    );
  }

  /**
   * One answer from the NPC dialog (`0x15`) - the other half of `talkTo`.
   *
   * The client runs its dialog modally inside the `0x47` handler, so a conversation is strict
   * turn-taking: the primary answer walks to the next line, anything else (the second button, ESC,
   * a closed window) ends it and the server says nothing more. The last line's primary answer ends
   * it too - there is no line after it, which is exactly the client's own "the dialog is gone".
   *
   * A reply for a dialog this server never opened is logged and dropped: only the `say` shape is
   * sent (sub-op 0), so a text/number answer here would mean the client's state and ours disagree.
   */
  private handleQuestReply(session: FieldSession, plain: Uint8Array): void {
    let reply: QuestReply;
    try {
      reply = readQuestReply(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(`game: 0x15 reply unreadable: ${(error as Error).message}`);
      return;
    }
    const talk = session.talk;
    if (talk === undefined) {
      this.options.log?.(`game: ${describeQuestReply(reply)} without a dialog open - dropped`);
      return;
    }
    const stopped = `game: NPC ${talk.npcId} (template ${talk.templateId}) conversation ended (${describeQuestReply(reply)})`;
    if (reply.kind !== "say") {
      session.talk = undefined;
      this.options.log?.(`${stopped}: this server only opens say dialogs`);
      return;
    }
    if (reply.answer !== QUEST_ANSWER.primary) {
      session.talk = undefined;
      this.options.log?.(stopped);
      return;
    }
    const next = talk.advance();
    if (next === undefined) {
      session.talk = undefined;
      this.options.log?.(`${stopped}: the last line was read`);
      return;
    }
    session.send(next);
    this.options.log?.(`game: NPC ${talk.npcId} says line ${talk.lineIndex + 1}/${talk.lineCount}`);
  }

  /**
   * One shop button (`0x16`): buy, sell, recharge or close.
   *
   * The reply is `0x4B` **only for the three requests that arm the client's in-flight flag**
   * (`sub_4B6B40`/`sub_4B6E90`/`sub_4B7130`); its handler clears that flag and throws a
   * `CDisconnectException` when it finds it unset, so a `0x4B` that answers nothing would kick the
   * client. `close` (`sub_4B3C80`) does not arm it and is therefore answered with nothing.
   *
   * A trade that happened is told in three packets, the same three a pickup uses: `0x4B` silent (the
   * client's window is free again), `0x0B` for the slot whose contents changed, and `0x0D` for the
   * mesos - whose own flag `0x40000` is what moves the number in the status bar (FINDINGS 4.22).
   */
  private handleShopRequest(session: FieldSession, plain: Uint8Array): void {
    let request;
    try {
      request = readClientShopRequest(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(`game: 0x16 shop request unreadable: ${(error as Error).message}`);
      return;
    }
    const write = session.send;
    if (request.kind === "close") {
      this.options.log?.(`game: shop ${session.shop?.shopId ?? "-"} closed`);
      session.shop = undefined;
      return; // deliberately unanswered: the client's close does not arm the in-flight flag
    }
    const keeper = this.options.shops;
    const shop = session.shop;
    if (keeper === undefined || shop === undefined) {
      this.options.log?.(`game: 0x16 shop request without an open shop - dropped (no 0x4B)`);
      return;
    }
    if (request.kind === "recharge") {
      // No row of any shop this server opens is a rechargeable (the 207 family), so there is
      // nothing to charge: the client gets the "not enough items" line and its window is freed.
      write(encodeShopResult(SHOP_RESULT.notEnoughItems));
      this.options.log?.(`game: shop ${shop.shopId} recharge of slot ${request.slot} refused (not stocked)`);
      return;
    }
    const items = session.character.items ?? emptyCharacterItems();
    const before = { ...session.character.stats };
    const outcome =
      request.kind === "buy"
        ? keeper.buy(items, session.wallet, shop, request.itemId, request.count)
        : keeper.sell(items, session.wallet, request.slot, request.itemId, request.count);
    if (outcome.kind === "failed") {
      write(encodeShopResult(shopResultCode(outcome.reason)));
      this.options.log?.(
        `game: shop ${shop.shopId} ${request.kind} of ${request.itemId} x${request.count} refused (${outcome.reason})`,
      );
      return;
    }
    write(encodeShopResult(SHOP_RESULT.silent));
    write(encodeInventoryChange([outcome.change]));
    const diff = diffStats(before, session.character.stats);
    if (Object.keys(diff).length > 0) write(encodeStatUpdate({ diff }));
    this.options.log?.(
      `game: shop ${shop.shopId} ${outcome.kind} ${outcome.itemId} x${outcome.count} at ${outcome.unitPrice} ` +
        `(total ${outcome.total}, tab ${outcome.inventory} slot ${outcome.slot}, mesos ${outcome.mesos})`,
    );
  }

  /**
   * Hand the player the drop under them, if there is one and it fits.
   *
   * The client cannot ask for this: a v1.11 client has no pickup request at all (every send site in
   * the binary passes a literal opcode, the largest is `0x33` - FINDINGS 4.13.2), so "standing on it"
   * is the whole trigger. No key, no request, and the server decides - the player's position comes
   * from their own move packets (`0x0E`), so nothing is taken before they move once, and a drop is not
   * can be taken before the field tick that follows its `0x43` (so a player already standing there
   * waits one tick), which is what lets the client show it flying out of the monster first.
   *
   * The three packets a pickup owes are exactly the three the client has for it:
   *
   *   `0x44` kind 2   the drop is gone and *this* character took it. That id is what makes the
   *                   taker's own client play "PickUpItem" and every client fly the icon to them.
   *                   It goes to the whole field, because the drop was everybody's to see.
   *   `0x0B` op 0     the item is now in slot N of tab T - the only packet that changes an inventory.
   *   `0x0D`          for mesos: the wallet is part of the character record (FINDINGS 4.22.5).
   *   `0x11`          the chat line: "You got <item>" / "You got mesos (+N)".
   *
   * A meso drop goes to the wallet, an item to the character record the connection was built from -
   * the same object the login server keeps, so the item is still there on the next login. A drop that
   * does not fit (a full tab) stays on the ground, silently: the client's third `0x11` shape ("no more
   * items") exists, but printing it every tick for a player who is standing on a drop with a full bag
   * would be noise, and a refused pickup has no request to answer yet.
   */
  private pickUp(session: FieldSession): void {
    const at = session.at;
    if (at === undefined) return;
    const instance = session.instance;
    const drop = instance.drops.reachable(at.x, at.y);
    if (drop === undefined) return;
    const items = session.character.items ?? emptyCharacterItems();
    const before = { ...session.character.stats };
    const outcome = pickUpDrop(drop, items, session.wallet);
    if (outcome.kind === "no-room") {
      this.options.log?.(
        `game: drop ${drop.dropId} (item ${drop.itemId}) is under ${session.characterId} but the ` +
          `inventory has no room - it stays on the ground`,
      );
      return;
    }
    instance.drops.take(drop);
    // The field tells *everyone*, including the taker: that packet is what flies the icon to them.
    instance.broadcastDropTaken(drop.dropId, session.characterId);
    if (outcome.kind === "item") {
      session.send(encodeInventoryChange([outcome.change]));
      session.send(encodeLootNotice(outcome.notice));
      this.options.log?.(
        `game: ${session.characterId} took item ${outcome.itemId} x${outcome.count} ` +
          `(drop ${drop.dropId}, tab ${outcome.inventory} slot ${outcome.slot})`,
      );
      return;
    }
    // Mesos live in the character record (`CharacterData` field 22), so what actually moves the
    // number in the status bar is a 0x0D diff - the same packet a shop trade uses; the `0x11` line is
    // only the chat notice (FINDINGS 4.22.5).
    const diff = diffStats(before, session.character.stats);
    if (Object.keys(diff).length > 0) session.send(encodeStatUpdate({ diff }));
    session.send(encodeLootNotice(outcome.notice));
    this.options.log?.(
      `game: ${session.characterId} took ${outcome.amount} mesos (drop ${drop.dropId}, wallet ${outcome.total})`,
    );
  }

  /**
   * One swing from the client (`0x0F`/`0x10`/`0x11`): the mobs it says it hit and the damage it
   * rolled. Each target record is applied to the field (`MobField.applyDamage`), and the field
   * answers with what that did - the damage numbers themselves need no packet, the attacker's own
   * client already drew them (FINDINGS 4.13.1).
   *
   * The damage is the client's number: this server does not re-roll it (it has no evidence for the
   * formula, and the client would disagree). What the server does own is which mobs exist and how
   * much HP they have, so a hit on a mob this field does not have is logged, not invented.
   *
   * What goes out, and in which order, is the world's answer to the swing: the swing itself as
   * `0x23` for the others (see `relaySwing`), then the mob packets the hits owe - another player
   * standing next to the attacker sees the same mob flash and die (`game/world.ts`) - and then the
   * reward, which is the attacker's alone (the exp goes to the connection that reported the hit,
   * see `awardKillExp`).
   */
  private applyAttack(session: FieldSession, plain: Uint8Array): void {
    const opcode = plain[0] ?? 0;
    let attack: ClientAttack;
    try {
      attack = readClientAttack(new PacketReader(plain, 1), opcode);
    } catch (error) {
      this.options.log?.(`game: 0x${hex(opcode)} attack unreadable: ${(error as Error).message}`);
      return;
    }
    const now = Date.now();
    // The swing has to arrive before the mobs react, so the mob packets wait here for it.
    const mobPackets: Uint8Array[] = [];
    const kills: { mobId: number; templateId: number }[] = [];
    const relayed: UserAttackTarget[] = [];
    for (const target of attack.targets) {
      // One target record carries `hits` numbers; the mob loses their sum, as the client drew it.
      const damage = target.damages.reduce((total, value) => total + value, 0);
      const hit = session.instance.mobs.applyDamage(target.mobId, damage, now);
      if (hit === undefined) {
        this.options.log?.(
          `game: 0x${hex(opcode)} hit mob ${target.mobId} for ${damage}, but this field has no such ` +
            `mob - or it is dying, or its Mob/<id>.img is missing and it has no HP to take`,
        );
        continue;
      }
      mobPackets.push(...hit.packets);
      // Only a mob this field accepted is worth drawing numbers over: the receiver's client drops
      // records it cannot resolve in its own mob pool anyway (FINDINGS 4.11.7b).
      relayed.push({ mobId: hit.mobId, hitAnimation: target.hitAnimation, damages: target.damages });
      this.options.log?.(
        hit.killed
          ? `game: mob ${hit.mobId} (template ${hit.templateId}) killed by ${damage} ` +
              `- die animation ${hit.dieMs}ms, corpse goes at +${hit.dieMs}ms, respawn at +${hit.dieMs + hit.respawnMs}ms`
          : `game: mob ${hit.mobId} hit for ${damage} - hp ${hit.hp}/${hit.maxHp}`,
      );
      if (hit.killed) kills.push({ mobId: hit.mobId, templateId: hit.templateId });
    }
    this.relaySwing(session, opcode, attack, relayed);
    session.instance.broadcastAll(mobPackets);
    // The reward first, the loot after: the exp is the kill's own payout (a stat diff plus, on a
    // level-up, the client's own effect), while a drop has to fly out of the corpse.
    for (const kill of kills) {
      this.awardKillExp(session, kill.templateId);
      this.spawnDrops(session, kill.mobId, now);
    }
  }

  /**
   * Everybody else's half of a swing: `0x23` (FINDINGS 4.11.7b).
   *
   * The attacker does not need it back - its own client ran the same effect routine while it built
   * the `0x0F` (`sub_50DAA0`, `sub_50D7F0`, `sub_4882F0` all run *before* the packet is written) -
   * so the copy goes to the others, exactly like `0x27` and `0x29`.
   *
   * Three of the receiver's fields have no source on this side, and they are sent as the value that
   * is not a guess:
   *
   *   `skillLevel`/`skillId`  0 - "no skill node". The pair is read, never watched on a wire, and a
   *                           plain melee swing has no skill behind it.
   *   `afterimage`            0 - the first child of `Character/Afterimage/<the weapon's
   *                           info/afterImage>`, which every one of those images has. Which child the
   *                           attacker used comes from `sub_4BE270` on its own client.
   *   the trailing `u32`      0 - only the `0x24` handler receives it.
   *
   * Only `0x0F` is relayed: a magic or skill swing would have to go out as `0x24`/`0x25`, whose
   * handlers (`sub_521400`/`sub_521AD0`) are not read yet.
   */
  private relaySwing(
    session: FieldSession,
    opcode: number,
    attack: ClientAttack,
    targets: UserAttackTarget[],
  ): void {
    if (opcode !== CLIENT_FIELD_OPCODE.attack) return;
    if (session.instance.memberCount <= 1) return;
    const packet = encodeUserAttack({
      characterId: session.characterId,
      hits: attack.hits,
      skillLevel: 0,
      skillId: 0,
      facingLeft: attack.facingLeft,
      action: attack.action,
      speed: attack.speed,
      afterimage: 0,
      unknownU32: 0,
      targets,
    });
    session.instance.broadcast(packet, session.characterId);
    this.options.log?.(
      `game: 0x23 swing of "${session.name}" (${attack.facingLeft ? "left" : "right"} ` +
        `action=${attack.action} hits=${attack.hits} speed=${attack.speed} ${targets.length} target(s)) ` +
        `sent to ${session.instance.memberCount - 1} other player(s)`,
    );
  }

  /**
   * The player killed a monster: put its `info.exp` on the character's account and tell the client
   * with `0x0D` (FINDINGS 4.21).
   *
   * The amount is the monster's own data and the level thresholds are the client's own table
   * (`game/exp.ts`); the packet is the *difference* between the record before and after, so a plain
   * gain carries one field (`exp`) and a level-up carries the level plus the HP/MP refill the
   * client's own routine performs. The client plays the level-up effect itself when it sees the level
   * grow (`sub_55BEB0`'s tail, FINDINGS 4.21) - which is why the effect packet below goes to the
   * **others** and not back to the player who levelled: for them the same animation is `0x29`.
   *
   * A monster with no template (no `Mob/<id>.img`, so no `info.exp`) awards nothing, like a drop.
   */
  private awardKillExp(session: FieldSession, templateId: number): void {
    const template = this.options.mobTemplate?.(templateId);
    const amount = template?.exp ?? 0;
    if (amount <= 0) {
      this.options.log?.(`game: mob template ${templateId} carries no exp, nothing awarded`);
      return;
    }
    const before = { ...session.character.stats };
    const gain = awardExp(session.character.stats, amount);
    if (!gain.changed) return;
    const stats = session.character.stats;
    session.send(encodeStatUpdate({ diff: diffStats(before, stats) }));
    if (gain.levels > 0) {
      // The field's other half of a level-up: `0x29` plays over the levelling user the same effect
      // their own client plays from the `0x0D` above, and the receiving pool resolves the id (an id
      // it does not know is dropped) - so this is exactly "everybody else sees the effect".
      session.instance.broadcast(
        encodeUserEffect({ characterId: session.characterId, effect: USER_EFFECT_LEVEL_UP }),
        session.characterId,
      );
      this.options.log?.(
        `game: 0x29 level-up effect for "${session.name}" sent to ` +
          `${session.instance.memberCount - 1} other player(s)`,
      );
    }
    this.options.log?.(
      `game: +${gain.gained} exp for killing ${template?.name ?? templateId} ` +
        `(template ${templateId}) - exp ${stats.exp}, level ${stats.level}` +
        (gain.levels > 0
          ? ` (+${gain.levels} level${gain.levels === 1 ? "" : "s"}, hp ${stats.hp}/${stats.maxHp})`
          : ""),
    );
  }

  /**
   * A monster died: roll its loot and put it on the ground (`0x43`).
   *
   * The drop's position is the monster's own, so it falls out of the corpse the client is already
   * animating; the packet carries the monster's id, which is what makes the client fly the item from
   * the monster to where it lands (FINDINGS 4.18). The loot itself is the policy's decision - see
   * `game/drops.ts` for what is evidence and what is a named, tunable choice.
   *
   * A monster whose template is unknown (no `Mob/<id>.img`, so no level and no name) drops nothing:
   * the policy has nothing to work with, and inventing a table entry would be a guess.
   */
  private spawnDrops(session: FieldSession, mobId: number, now: number): void {
    const instance = session.instance;
    const mob = instance.mobs.mob(mobId);
    if (mob === undefined || mob.template === undefined) return;
    const spawned = instance.drops.spawnFromDeath(
      {
        mobId,
        templateId: mob.templateId,
        name: mob.template.name,
        level: mob.template.level,
        x: mob.x,
        y: mob.y,
        foothold: mob.foothold,
      },
      now,
    );
    for (const drop of spawned) {
      // Everyone standing there sees the loot fall out of the corpse, so this is the field's packet.
      instance.broadcast(instance.drops.appearPacket(drop));
      this.options.log?.(
        `game: mob ${mobId} (${mob.template.name}) left drop ${drop.dropId}: ` +
          `${drop.money ? `${drop.amount} mesos` : `item ${drop.itemId} x${drop.count}`} at (${drop.x},${drop.y})`,
      );
    }
    if (spawned.length === 0) this.options.log?.(`game: mob ${mobId} died and left nothing`);
  }

  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    const clientSendSeed = this.options.handshake?.clientSendSeed ?? randomSeed();
    const clientRecvSeed = this.options.handshake?.clientRecvSeed ?? randomSeed();
    const body = this.options.handshake?.body ?? new Uint8Array(HANDSHAKE_BODY_BYTES);
    const deframer = new SessionDeframer({
      recvState: new CipherState(clientSendSeed),
      expectHandshake: false,
      expectedMagic: CLIENT_SEND_MAGIC,
    });
    socket.write(encodeHandshake(body, clientSendSeed, clientRecvSeed));
    this.options.log?.("game: handshake sent, waiting for the 0x04 character id");

    const sendState = new CipherState(clientRecvSeed);
    let entered = false;
    let session: FieldSession | undefined;
    socket.on("data", (chunk) => {
      for (const event of deframer.push(new Uint8Array(chunk))) {
        if (event.kind !== "packet") continue;
        // Any packet at all is proof of life for the heartbeat: the client is talking to us.
        this.heartbeat.note(socket);
        const packet = decodeClientPacket(event.plain);
        if (packet.kind === "handshake-reply" && !entered) {
          const entry = this.options.handoffs.claim(packet.value);
          this.options.log?.(
            entry
              ? `game: character 0x${hex(packet.value)} claimed -> "${entry.characterName}" (${entry.username})`
              : `game: character 0x${hex(packet.value)} is unknown or already claimed`,
          );
          if (!entry) {
            socket.destroy();
            return;
          }
          // One character, one session. The check has to be here and not in `FieldInstance.join`:
          // the field *does* handle a duplicate id (it drops the older member), but the older
          // connection would stay open - a player nobody can see who still walks, chats and hits
          // monsters - and both connections would write the same `CharacterData`, which is the
          // account table's own object (ADR-017). Refused the same way an unclaimable handoff is:
          // the socket goes, and the client's own disconnect path takes over.
          const taken = this.sessionsByCharacter.get(entry.characterId);
          if (taken !== undefined) {
            this.options.log?.(
              `game: character 0x${hex(entry.characterId)} ("${entry.characterName}") is already in map ` +
                `${taken.instance.mapId} - refusing the second connection`,
            );
            socket.destroy();
            return;
          }
          entered = true;
          session = this.enterField(socket, sendState, entry);
          if (session !== undefined) this.sessionsByCharacter.set(entry.characterId, session);
          continue;
        }
        const opcode = event.plain[0] ?? -1;
        // A walk is the server's only source of where a player is: the field keeps it (a pickup needs
        // it) and relays it to the rest of the map as 0x22.
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.userMove) {
          this.handleUserMove(session, event.plain);
          continue;
        }
        // The player's own HP/MP, changing: a monster's hit or the map's regeneration, both rolled by
        // the client and answered with the `0x0D` that moves the bar (see `handleStatReport`).
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.statReport) {
          this.handleStatReport(session, event.plain);
          continue;
        }
        // Using an item out of the USE tab: `0x18` restores a vital, `0x19` changes the map. Both are
        // answered even when the use is refused, or the client's use gate would never clear.
        if (session !== undefined && USE_ITEM_OPCODES.includes(opcode)) {
          this.handleUseItem(session, event.plain, opcode);
          continue;
        }
        // A swing is the other packet this server acts on: it is what moves a mob's HP here.
        if (session !== undefined && ATTACK_OPCODES.includes(opcode)) {
          this.applyAttack(session, event.plain);
          continue;
        }
        // Using a portal: `0x0D` with the name of the portal under the cursor, answered with the
        // release byte and a `0x16` for wherever that portal leads.
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.interact) {
          this.handleInteract(session, event.plain);
          continue;
        }
        // Clicking an NPC: the server answers with the release byte, and with a shop if it has one.
        if (session !== undefined && opcode === CLIENT_OBJECT_CLICK_OPCODE) {
          this.handleObjectClick(session, event.plain);
          continue;
        }
        // The shop window's buttons.
        if (session !== undefined && opcode === CLIENT_SHOP_OPCODE) {
          this.handleShopRequest(session, event.plain);
          continue;
        }
        // The NPC dialog's answer: the other half of the 0x47 the click sent.
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.questReply) {
          this.handleQuestReply(session, event.plain);
          continue;
        }
        // An emotion: `0x13` names a face the client already put on itself, so this is a broadcast
        // to the rest of the field with no answer to the sender.
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.emotion) {
          this.handleEmotion(session, event.plain);
          continue;
        }
        // Chat: the one field packet whose meaning is entirely social, and the only one that goes
        // back to the player who sent it (see `handleChat`).
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.chat) {
          this.handleChat(session, event.plain);
          continue;
        }
        // A message about **one** user, sent by name: a whisper, or a find (`/헉추적`). The only
        // packet in the field stage that reaches a player on another map (see `handleUserRequest`).
        if (session !== undefined && opcode === CLIENT_FIELD_OPCODE.userRequest) {
          this.handleUserRequest(session, event.plain);
          continue;
        }
        this.options.log?.(
          `game: ${describeClientFieldPacket(event.plain) ?? `op=0x${hex(packet.opcode)} (unmapped)`}`,
        );
      }
    });
    socket.on("error", () => {
      this.sockets.delete(socket);
    });
    socket.on("close", () => {
      // The field has to hear about it: the others get an `0x1D`, and the mobs keep walking.
      session?.instance.leave(session.characterId);
      // The seat and the character's place in the world go with the socket; both are idempotent, so a
      // connection that was refused before it ever entered is just released (nothing to release).
      this.seats.release(socket);
      if (session !== undefined) this.sessionsByCharacter.delete(session.characterId);
      // And the character's record has to leave the process - this is the only place a session ends.
      if (session !== undefined) this.persist();
      this.sockets.delete(socket);
    });
  }

  /** Hands the (mutated) character records to the caller's store; a throw is logged, not propagated. */
  private persist(): void {
    try {
      this.options.persist?.();
    } catch (error) {
      this.options.log?.(`game: persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * A line of chat (`0x12`, one string - `sub_470C70`), relayed to the map as `0x1A` + sub-op `0x12`
   * + the speaker's name + the same bytes.
   *
   * **The speaker gets it too**, and that is not a convenience: the client's chat input only *sends*
   * (`sub_470C70` builds the packet and returns - no local echo), and the `"%s>> %s"` renderer lives
   * on the receiving side (`sub_472910` case 0x12). A server that skipped the sender would make
   * players unable to see what they just said.
   *
   * The text is passed through as **bytes**: the server relays it and never reads it, so there is no
   * reason to risk a decode/encode round trip. The name is the server's own fact about the session,
   * because the packet has nowhere to put a character id (the receiving client only needs a name to
   * look the speaker up by).
   */
  private handleChat(session: FieldSession, plain: Uint8Array): void {
    let text: Uint8Array;
    try {
      text = readClientChat(new PacketReader(plain, 1)).text;
    } catch (error) {
      this.options.log?.(`game: 0x12 chat unreadable: ${(error as Error).message}`);
      return;
    }
    this.options.log?.(
      `game: ${describeUserChat({ name: session.name, text })} in map ${session.instance.mapId}`,
    );
    session.instance.broadcast(encodeUserChat({ name: session.name, text }));
  }

  /**
   * The player's own emotion - `0x13` (`sub_511E20` case 10, FINDINGS 4.35): the face they are
   * making, as `u32` in `0..8` (`EMOTION_NAMES`), coming from the F-keys (`F1`..`F7` send `1`..`7`).
   *
   * There is nothing to answer: unlike a click or an item use, the client arms no pending-request
   * gate here, and it has **already applied the face to itself** - `CUser::SetFace` runs one
   * instruction before the packet is built (`.text:00511FD8` vs `00511FDF`) - so the whole job is to
   * tell the rest of the field. The `0x27` broadcast therefore excludes the sender, the same rule
   * `0x22` (their own move path) and `0x29` (their own level-up) already follow.
   *
   * A value outside `0..8` is refused by the codec rather than forwarded: the client's own setter
   * tests `n8 <= 8` and its drawer clamps to 0, so nothing in the client can ever send one - a
   * packet that does is not a client this server understands.
   */
  private handleEmotion(session: FieldSession, plain: Uint8Array): void {
    let emotion: ClientEmotion;
    try {
      emotion = readClientEmotion(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(`game: 0x13 emotion unreadable: ${(error as Error).message}`);
      return;
    }
    session.instance.broadcast(
      encodeUserEmotion({ characterId: session.characterId, emotion: emotion.emotion }),
      session.characterId,
    );
    this.options.log?.(
      `game: 0x27 ${describeClientEmotion(emotion)} by "${session.name}" sent to ` +
        `${session.instance.memberCount - 1} other player(s)`,
    );
  }

  /**
   * A request about one user by name - `0x23` (`sub_4717D0`): a whisper (`0x06`), a find
   * (`0x05`), or the client's own balloon request (`0x22`, which nothing here answers).
   *
   * This is the **first** packet in this server that reaches a player who is not in the sender's
   * map, so it is also the first one whose target is looked up by name: the client has no character
   * ids to offer beyond its own, and the send function takes the name as typed. `sessionNamed` is
   * that lookup, and it is a scan over the live sessions rather than a second index - the sessions
   * map is already the one truth about who is online, and a name index would be one more thing to
   * keep in step with it (FINDINGS 4.31, ADR-019).
   *
   *   find     -> `0x1A sub-op 0x09` (`string name` + `u32 mapId`, `0xFFFFFFFF` = not found)
   *   whisper  -> `0x1A sub-op 0x0A` to the sender (`string name` + `u8`), and a `0x1A sub-op 0x12`
   *               with the sender's name and the text to the receiver
   *
   * "Online" is the whole of the answer: a character with no session has no map to name and no
   * client to deliver to, and the client's own messages for that case - "'name'님을 찾지 못했습니다"
   * for both a find and a whisper - are exactly what those two answers render (ADR-019).
   *
   * The text is passed through as **bytes**, like chat: the server never reads it.
   */
  private handleUserRequest(session: FieldSession, plain: Uint8Array): void {
    let request: ClientUserRequest;
    try {
      request = readClientUserRequest(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(`game: 0x23 unreadable: ${(error as Error).message}`);
      return;
    }
    if (request.kind === USER_REQUEST_KIND.find) {
      const target = this.sessionNamed(request.name);
      if (target === undefined) {
        this.options.log?.(`game: find "${request.name}": no such player`);
        session.send(encodeUserFindAnswer({ name: request.name, mapId: -1 }));
        return;
      }
      this.options.log?.(`game: find "${request.name}" -> "${target.name}" in map ${target.instance.mapId}`);
      session.send(encodeUserFindAnswer({ name: target.name, mapId: target.instance.mapId }));
      return;
    }
    if (request.kind === USER_REQUEST_KIND.balloon) {
      // `USER_REQUEST_KIND.balloon`: the client could not print a line it received and asked the
      // server to show it as a balloon. Which packet draws one is not located, so this is logged, not
      // guessed - and the sender is told nothing, because a client that gets no answer here is
      // exactly where it was before it asked (FINDINGS 4.31).
      this.options.log?.(
        `game: ${describeClientUserRequest(request)} - balloon requests are not implemented yet`,
      );
      return;
    }
    const text = request.text ?? new Uint8Array(0);
    const target = this.sessionNamed(request.name);
    if (target === undefined) {
      this.options.log?.(`game: whisper "${session.name}" -> "${request.name}": no such player`);
      session.send(encodeUserWhisperAnswer({ name: request.name, delivered: false }));
      return;
    }
    this.options.log?.(
      `game: whisper "${session.name}" -> "${target.name}": ${decodeCp949(text)}`,
    );
    // The receiver's client renders the same `%s>> %s` line as chat - the packet *is* the chat one -
    // so a delivered whisper arrives with the sender's name in front of it. The sender's own echo
    // (`0x0A`) carries no text: their client kept what it sent and prints "name<< text" from it.
    target.send(encodeUserChat({ name: session.name, text }));
    session.send(encodeUserWhisperAnswer({ name: target.name, delivered: true }));
  }

  /**
   * The live session of the character with that name, if anyone is playing them.
   *
   * Names are unique server-wide and checked case-insensitively when a character is created
   * (`nameTaken`), so a case-insensitive comparison here cannot pick the wrong player - and it is
   * what lets a player whisper "hero" to "Hero" as the login server would have allowed them to
   * create it. The answer always names the **stored** spelling, never the typed one, so what the
   * other side sees is the character's real name.
   */
  private sessionNamed(name: string): FieldSession | undefined {
    const wanted = name.toLowerCase();
    for (const session of this.sessionsByCharacter.values()) {
      if (session.name.toLowerCase() === wanted) return session;
    }
    return undefined;
  }

  /**
   * The player's own `0x0E` (`CVecCtrlUser::SendMove`): where they are, and where everybody else sees
   * them go.
   *
   * The relay is the client's own path, re-framed with the character id (`0x22` carries the id, `0x0E`
   * does not - the sender's client knows who it is). The *position* the server keeps comes from the
   * first element only: the client's move path is a whole walk (`CMovePath`) and its first element is
   * the position the vecctrl was moved to - the one place in that packet the server can trust
   * (FINDINGS 4.11.5). Everything the pickup needs is a position, so the rest of the path is left for
   * the day the server has to validate movement.
   */
  private handleUserMove(session: FieldSession, plain: Uint8Array): void {
    try {
      const move = readClientUserMove(new PacketReader(plain, 1));
      session.instance.reportMove(session.characterId, move.path);
    } catch (error) {
      this.options.log?.(`game: 0x0E move unreadable: ${(error as Error).message}`);
    }
  }
}

/**
 * The character record to send back in `0x16`: the login server's own record with the map id
 * replaced. A handoff issued without a record (tests, tooling) gets a minimal but complete one.
 */
function withMapId(entry: HandoffEntry, fallbackMapId: number): CharacterData {
  if (entry.character) {
    // A character's own `mapId` is where they were when they left: the record is the truth for the
    // map the same way it is for level and mesos, and it is the only field `sub_4C2780` reads to pick
    // the map (FINDINGS 4.11.2b). `0` means "no map of its own" - a record built by hand, or one
    // from before this server had more than one map - and that is what the server's option is for.
    //
    // The record is used **as it is**, not copied: this is the same object the account table holds
    // (`LoginServerOptions.accounts`), the field then mutates it in place (exp, hp, items, mesos,
    // `mapId` when a portal moves them), and `persist` saves that one object when the session ends.
    // A copy would mean two records with one name, and only one of them would ever be saved.
    const character = entry.character;
    if (character.stats.mapId === 0) character.stats.mapId = fallbackMapId;
    return character;
  }
  const stats = zeroStats();
  stats.id = entry.characterId;
  stats.name = entry.characterName;
  stats.level = 1;
  stats.hp = 50;
  stats.maxHp = 50;
  stats.mp = 50;
  stats.maxMp = 50;
  stats.mapId = fallbackMapId;
  // A hand-built handoff has no login server behind it, so it gets the bags `createCharacter` would
  // have given it: the capacity byte is what makes the client allocate an inventory at all, and a
  // character with no slots could never be handed a drop (`startingCharacterItems`). Its look comes
  // from the handoff's own record; `setFieldOf` fills the starter face and hair in when it has none.
  return characterDataOf(stats, startingCharacterItems());
}

/**
 * The item ids a client needs to draw a character's avatar (`0x1C`'s list).
 *
 * Two sources: the **hair** first - it is not a worn equip but the record's `appearanceB`
 * (`sub_42E2C0` puts it straight into body-part slot 0, the slot `sub_45F340` files a `3xxxx` id
 * into) - and then the worn equips of the record the player was sent (`CharacterData`'s two worn
 * arrays are `GW_ItemSlot`s, so each carries its item id). `sub_45F340` sorts every id into its
 * body-part slot by the id's own prefix, so the order inside the list carries no meaning; what does
 * matter is that it never contains a 0, because the client stops reading at the first one. A bare
 * character therefore still gets its hair, or it would be drawn bald.
 */
function avatarItemsOf(character: CharacterData): number[] {
  const ids: number[] = [lookOf(character.stats).hair];
  const items = character.items;
  if (items === undefined) return ids;
  for (const slot of [...items.worn.values(), ...items.wornCash.values()]) {
    if (slot.itemId !== 0) ids.push(slot.itemId);
  }
  return ids;
}

/**
 * The ten `0x06` words as one log line: the six body parts by name, and the dice as they came.
 *
 * The dice are the half of `0x06` this server cannot use yet - nothing in the binary says which die
 * is STR/DEX/INT/LUK (FINDINGS 4.8.1a) - so they are printed rather than turned into stats.
 */
function describeLookWords(appearance: readonly number[]): string {
  const word = (index: number): number => appearance[index] ?? 0;
  const clothes = [LOOK_WORD.clothes, LOOK_WORD.pants, LOOK_WORD.shoes, LOOK_WORD.weapon].map(word);
  const dice: number[] = [];
  for (let index = LOOK_WORD.dice; index < LOOK_WORDS; index++) dice.push(word(index));
  return (
    `face ${word(LOOK_WORD.face)}, hair ${word(LOOK_WORD.hair)} ` +
    `clothes ${clothes.join("/")}, dice ${dice.join("/")}`
  );
}

/** What of the look words reached the record: the worn group the client draws the avatar from. */
function describeWorn(character: CharacterData): string {
  const entries = character.items === undefined ? [] : [...character.items.worn];
  const worn = entries.sort((a, b) => a[0] - b[0]).map(([slot, item]) => `${slot}:${item.itemId}`);
  return worn.length > 0 ? `wearing ${worn.join(" ")}` : "wearing nothing";
}

/** A non-zero u32 for the handshake seeds. */
function randomSeed(): number {
  return ((Math.random() * 0xffffffff) >>> 0) | 1;
}

/**
 * The next character id, unique across the whole server - not just inside one account.
 *
 * It has to be: the id is what the client's `CUserPool` keys the players of a field by
 * (`sub_51CFE0`) and what the handoff registry hands the game server, so two accounts that both
 * started at 1 would collide the moment they stood in the same map (ADR-012). The real game gets
 * this from its database; a stub with no database takes the maximum over every account and adds 1.
 */
function nextCharacterId(accounts: Map<string, AccountRecord>): number {
  let max = 0;
  for (const account of accounts.values()) {
    for (const entry of account.characters) max = Math.max(max, entry.stats.id);
  }
  return max + 1;
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
