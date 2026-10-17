import { NATIVE_JOB_NAMES } from "../../../client/jobs.mjs";
import { planTestTool, testToolKind, type TestCheckpoint, type TestToolResult } from "../game/testtools.ts";
import { SKILL_REQUEST_OPCODE, readSkillRequest, encodeSkillUpdate, type SkillChange } from "../protocol/skills.ts";
import { spendSkillPoint, type SkillCatalog } from "../game/skills.ts";
import { spendBasicAmmo, type BasicAttackProvider } from "../game/basicattack.ts";
import {
  MESO_DROP_OPCODE,
  MESO_DROP_MIN,
  MESO_DROP_MAX,
  MESO_DROP_INTERVAL_MS,
  readMesoDrop,
} from "../protocol/mesodrop.ts";
import {
  ABILITY_REQUEST_OPCODE,
  readAbilityRequest,
} from "../protocol/ability.ts";
import { spendAbility } from "../game/ability.ts";
import { characterGrowthContext, type GrowthSkillProvider } from "../game/growth.ts";
import { foldByteName } from "../protocol/cp949.ts";
import {
  validCreationDice,
  validCreationName,
  validateCreationLook,
  type CreationCatalog,
} from "../game/creation.ts";
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
import {
  FieldRegistry,
  type FieldInstance,
  type FieldMember,
} from "../game/world.ts";
import { MesoWallet, pickUpDrop, takeItem, grantItem } from "../game/rewards.ts";
import { applyChangeSlot } from "../game/inventory.ts";
import { reviveMapId, spawnPortalIndex, type MapData } from "../game/map.ts";
import { decodeClientPacket, describeClientPacket } from "../protocol/login.ts";
import {
  ATTACK_RELAY_OPCODE,
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
  encodeUserLook,
  readClientChangeSlot,
  describeClientChangeSlot,
  type ClientChangeSlot,
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
import {
  PARTY_OPCODE,
  describeClientPartyRequest,
  encodePartyResult,
  readClientPartyRequest,
  type ClientPartyRequest,
  type PartyMember,
} from "../protocol/party.ts";
import { PartyRegistry, type PartyLeave } from "../game/parties.ts";
import {
  FAME_OPCODE,
  describeClientFameRequest,
  encodeFameResult,
  readClientFameRequest,
  type ClientFameRequest,
} from "../protocol/fame.ts";
import { FameLedgers, applyFame, fameClock } from "../game/fame.ts";
import {
  MINIROOM_KIND,
  MINIROOM_OPCODE,
  MINIROOM_REFUSAL,
  TRADE_FINISH,
  describeClientMiniRoomRequest,
  encodeMiniRoomEnter,
  encodeMiniRoomFinish,
  encodeMiniRoomInvite,
  encodeMiniRoomItem,
  encodeMiniRoomLock,
  encodeMiniRoomMesos,
  encodeMiniRoomRefused,
  readClientMiniRoomRequest,
  type ClientMiniRoomRequest,
  type MiniRoomParticipant,
} from "../protocol/miniroom.ts";
import {
  TradeRegistry,
  isTradeSlot,
  settleTrade,
  tabOfItem,
} from "../game/trades.ts";
import {
  MESSENGER_INVITE_RESULT,
  MESSENGER_OPCODE,
  describeClientMessengerRequest,
  encodeMessengerChat,
  encodeMessengerInvite,
  encodeMessengerInviteResult,
  encodeMessengerJoinFailed,
  encodeMessengerLeft,
  encodeMessengerParticipant,
  readClientMessengerRequest,
  type ClientMessengerRequest,
  type MessengerParticipant,
} from "../protocol/messenger.ts";
import { MessengerRegistry, type MessengerRoom } from "../game/messenger.ts";
import { encodeLootNotice } from "../protocol/drop.ts";
import { INVENTORY_TAB, encodeInventoryChange } from "../protocol/inventory.ts";
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
import {
  shopResultCode,
  type ShopDef,
  type ShopKeeper,
} from "../game/shops.ts";
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
  CHAR_FLAG_INVENTORY_2,
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
  gender?: 0 | 1;
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
  creationCatalog?: CreationCatalog;
  /** Cipher seeds and handshake body. Defaults: random seeds, 199 zero bytes. */
  handshake?: {
    clientSendSeed?: number;
    clientRecvSeed?: number;
    body?: Uint8Array;
  };
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
  checkedName?: string;
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
    this.seats = new SeatKeeper({
      online: this.online,
      heartbeat: this.heartbeat,
      where: "login",
    });
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (error) =>
      this.log(`listen error: ${error.message}`),
    );
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
   * it rebuilds an avatar (`sub_42E2C0`). Words 7..10 are STR/DEX/INT/LUK: newDlg labels and
   * sub_430690 y293/313/333/353 establish the order. They total 25 (sub_430630).
   */
  createCharacter(
    id: number,
    name: string,
    appearance: number[],
    items?: CharacterItems,
    gender = 0,
  ): CharacterData {
    const look = lookOf({
      appearanceA: appearance[0] ?? 0,
      appearanceB: appearance[1] ?? 0,
    });
    // A character without slots could never be handed anything: the capacity byte is what makes the
    // client allocate an inventory at all (see `startingCharacterItems`), so bags are the default.
    const block = withWorn(
      items ?? startingCharacterItems(),
      wornOfLook(appearance),
    );
    const stats = zeroStats();
    stats.id = id;
    stats.name = name;
    stats.gender = gender;
    stats.appearanceA = look.face;
    stats.appearanceB = look.hair;
    stats.mapId = this.options.startMapId ?? DEFAULT_MAP_ID;
    stats.level = 1;
    const dice = validCreationDice(appearance.slice(6))
      ? appearance.slice(6)
      : [5, 5, 5, 10];
    [stats.str, stats.dex, stats.int, stats.luk] = dice as [
      number,
      number,
      number,
      number,
    ];
    stats.hp = 50;
    stats.maxHp = 50;
    stats.mp = 50;
    stats.maxMp = 50;
    stats.mesos = this.options.startMesos ?? 0;
    return characterDataOf(stats, block);
  }

  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    const clientSendSeed =
      this.options.handshake?.clientSendSeed ?? randomSeed();
    const clientRecvSeed =
      this.options.handshake?.clientRecvSeed ?? randomSeed();
    const body =
      this.options.handshake?.body ?? new Uint8Array(HANDSHAKE_BODY_BYTES);
    if (body.length !== HANDSHAKE_BODY_BYTES) {
      throw new RangeError(
        `handshake body must be ${HANDSHAKE_BODY_BYTES} bytes, got ${body.length}`,
      );
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
    this.log(
      `conn: handshake sent (clientSend=0x${hex(clientSendSeed)} clientRecv=0x${hex(clientRecvSeed)})`,
    );

    socket.on("data", (chunk) => {
      for (const event of deframer.push(new Uint8Array(chunk))) {
        if (event.kind !== "packet") continue;
        // Any packet at all is proof of life for the heartbeat: the client is talking to us.
        this.heartbeat.note(socket);
        if (!event.headerOk) {
          this.log(
            `conn: dropping packet with a bad header (0x${hex(event.header)})`,
          );
          continue;
        }
        try {
          this.onPacket(socket, state, sendState, event);
        } catch (error) {
          this.log(`conn: handler error: ${(error as Error).message}`);
        }
      }
      if (deframer.failure)
        this.log(`conn: session ended: ${deframer.failure}`);
    });
    socket.on("error", () => this.sockets.delete(socket));
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.seats.release(socket);
      this.log("conn: closed");
    });
  }

  private reply(
    socket: net.Socket,
    sendState: CipherState,
    body: Uint8Array,
  ): void {
    socket.write(encodeSessionPacket(body, sendState, "s2c"));
  }

  private onPacket(
    socket: net.Socket,
    state: ConnectionState,
    sendState: CipherState,
    event: Extract<SessionEvent, { kind: "packet" }>,
  ): void {
    const packet = decodeClientPacket(event.plain);
    this.log(
      `packet: op=0x${hex(packet.opcode)} ${describeClientPacket(event.plain) ?? "(unmapped)"}`,
    );

    switch (packet.kind) {
      case "handshake-reply":
        // The client sends this on every new connection; on the login server it is always 0
        // because only the 0x03 reply sets CWvsApp+0x14.
        this.log(
          `  note: handshake reply, characterId=0x${hex(packet.value)} (the game server claims it)`,
        );
        return;

      case "login-request": {
        if (state.stage !== "login") return;
        const account = this.options.accounts.get(packet.username);
        // Two different codes, because the client has two different messages: an unknown id is
        // "등록되지 않은 아이디입니다." (5) and a wrong password is "잘못된 패스워드입니다." (4,
        // `sub_4D0DB0`). Telling them apart is what the 2003 client was written for.
        if (!account) {
          this.log(`  login refused: no account named "${packet.username}"`);
          this.reply(
            socket,
            sendState,
            encodeLoginResult(LOGIN_RESULT.notRegistered),
          );
          return;
        }
        if (account.password !== packet.password) {
          this.log(`  login refused for "${packet.username}": wrong password`);
          this.reply(
            socket,
            sendState,
            encodeLoginResult(LOGIN_RESULT.wrongPassword),
          );
          return;
        }
        // One account, one live session: the client has a message for exactly this - "현재 접속중인
        // 아이디이거나, 현재 서버점검중입니다." (7) - and letting the second one in would give two
        // connections one character record to fight over (`net/online.ts`, ADR-018).
        const held = this.online.sessionsOf(packet.username);
        if (held.length > 0) {
          this.log(
            `  login refused: "${packet.username}" is already online (${describeSessions(held)})`,
          );
          this.reply(
            socket,
            sendState,
            encodeLoginResult(LOGIN_RESULT.alreadyConnected),
          );
          return;
        }
        state.stage = "world";
        state.username = packet.username;
        let pings = 0;
        this.seats.claim(socket, packet.username, () =>
          this.reply(socket, sendState, encodeEcho(++pings)),
        );
        this.reply(
          socket,
          sendState,
          encodeLoginResult(LOGIN_RESULT.ok, {
            account: {
              app4: account.characters.length,
              app8: account.gender ?? 0,
              app9: 0,
            },
            worlds: this.options.worlds,
          }),
        );
        this.log(
          `  logged in as "${packet.username}", ${this.options.worlds.length} world(s) offered`,
        );
        return;
      }

      case "world-select": {
        if (state.stage !== "world" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        if (!account || packet.worldId >= this.options.worlds.length) {
          this.log(
            `  world index ${packet.worldId} is out of range (${this.options.worlds.length} worlds)`,
          );
          this.reply(
            socket,
            sendState,
            encodeWorldSelectResult(LOGIN_RESULT.systemError),
          );
          return;
        }
        state.stage = "char";
        this.reply(
          socket,
          sendState,
          encodeWorldSelectResult(
            LOGIN_RESULT.ok,
            account.characters.slice(0, 3).map(withDefaultLook),
          ),
        );
        this.log(
          `  world ${packet.worldId} selected, ${Math.min(account.characters.length, 3)} character(s) sent`,
        );
        return;
      }

      case "select-character": {
        if (state.stage !== "char" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        const character = account?.characters.find(
          (entry) => entry.stats.id === packet.characterId,
        );
        if (!character) {
          this.log(`  character ${packet.characterId} does not exist`);
          this.reply(
            socket,
            sendState,
            encodeSelectCharacterResult(LOGIN_RESULT.systemError),
          );
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
        delete state.checkedName;
        delete state.appearanceHint;
        const taken = this.nameTaken(packet.name);
        let valid = validCreationName(
          packet.name,
          this.options.creationCatalog?.forbidden,
        );
        try {
          state.appearanceHint = validateCreationLook(
            packet.appearance,
            this.options.creationCatalog,
            this.options.accounts.get(state.username)?.gender ?? 0,
          );
        } catch {
          valid = false;
        }
        if (valid && !taken) state.checkedName = packet.name;
        this.reply(
          socket,
          sendState,
          encodeNameCheckResult(
            packet.name,
            !valid
              ? NAME_CHECK_RESULT.failed
              : taken
                ? NAME_CHECK_RESULT.taken
                : NAME_CHECK_RESULT.available,
          ),
        );
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
          this.log(
            `  create refused: "${state.username}" already has three characters`,
          );
          this.reply(socket, sendState, encodeCreateCharacterResult());
          return;
        }
        if (
          state.checkedName !== packet.name ||
          !validCreationName(
            packet.name,
            this.options.creationCatalog?.forbidden,
          ) ||
          !validCreationDice(state.appearanceHint?.slice(6) ?? []) ||
          this.nameTaken(packet.name)
        ) {
          this.log(`  create refused: the name "${packet.name}" is taken`);
          this.reply(socket, sendState, encodeCreateCharacterResult());
          return;
        }
        const created = this.createCharacter(
          nextCharacterId(this.options.accounts),
          packet.name,
          state.appearanceHint ?? [],
          undefined,
          account.gender ?? 0,
        );
        delete state.checkedName;
        account.characters.push(created);
        this.reply(
          socket,
          sendState,
          encodeCreateCharacterResult(withDefaultLook(created)),
        );
        this.log(
          `  created "${created.stats.name}" (id ${created.stats.id}) ${describeWorn(created)}`,
        );
        this.persist();
        return;
      }

      case "delete-character": {
        if (state.stage !== "char" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        if (!account) return;
        const index = account.characters.findIndex(
          (entry) => entry.stats.id === packet.characterId,
        );
        if (index < 0) {
          // The client throws CTerminateException when the id is not in its three slots, so
          // replying with the wrong id would kill the connection. Say nothing instead.
          this.log(
            `  delete ignored: character ${packet.characterId} is not in the account`,
          );
          return;
        }
        const [removed] = account.characters.splice(index, 1);
        this.reply(
          socket,
          sendState,
          encodeDeleteCharacterResult(packet.characterId, 1),
        );
        this.log(
          `  deleted "${removed?.stats.name ?? "?"}" (id ${packet.characterId})`,
        );
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
        this.log(
          `  note: unmapped opcode kept as ${packet.body.length} raw byte(s)`,
        );
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
      this.log(
        `persist failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private nameTaken(name: string): boolean {
    const wanted = foldByteName(name);
    for (const account of this.options.accounts.values()) {
      if (
        account.characters.some(
          (entry) => foldByteName(entry.stats.name) === wanted,
        )
      )
        return true;
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
/** Normal mob AI is clocked at 90ms: CVecCtrlMob::GetUpdateTime/sub_5407F0. */
const DEFAULT_MOB_TICK_MS = 90;

export const ATTACK_OPCODES: readonly number[] = [
  CLIENT_FIELD_OPCODE.attack,
  CLIENT_FIELD_OPCODE.shootAttack,
  CLIENT_FIELD_OPCODE.magicAttack,
];

export interface GameEntryServerOptions {
  /** Explicit operator policy for the original /헉맵 request. Absent denies all accounts. */
  allowMapCommand?(username: string): boolean;
  /** Development-only, separate opt-in policy. Never inferred from map-command rights. */
  allowTestTools?(username: string): boolean;
  handoffs: HandoffRegistry;
  handshake?: {
    clientSendSeed?: number;
    clientRecvSeed?: number;
    body?: Uint8Array;
  };
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
  /** Native 463BE0 rejects WZ cash items as well as a wire cash serial. Unknown facts refuse. */
  dropItemAllowed?: (itemId: number) => boolean;
  /** WZ basic action/speed facts; absent data refuses shots rather than inventing them. */
  basicAttack?: BasicAttackProvider;
  /** Actual learned HP/MP passive x/y values from Skill/100.img and Skill/200.img. */
  growthSkill?: GrowthSkillProvider;
  skills?: SkillCatalog;
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
   * Called after durable gameplay mutations and when a session ends.
   *
   * The CharacterData handed over by login is the account table's authoritative record: no second
   * copy to reconcile. Successful AP allocations, inventory/wallet operations and kill EXP/maxima
   * persist immediately (including delayed projectile kills). Ordinary movement does not rewrite
   * the save for every step; leaving still captures the latest map/session state.
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
  username: string;
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
  attackReadyAt?: number;
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
  private readonly testCheckpoints = new Map<string, TestCheckpoint>();
  /** Reconstructed server scheduling: native release + distance * 1.5ms, no saved ground state. */
  private pendingShots: {
    session: FieldSession;
    instance: FieldInstance<FieldSession>;
    attack: ClientAttack;
    dueAt: number;
    deaths: Map<number, number>;
  }[] = [];
  /**
   * 隊伍（FINDINGS 4.37）。世界層的狀態，跟 `sessionsByCharacter` 一樣不屬於任何一張場地：名冊裡
   * 只有角色 id 與名字，隊員分散在兩張圖是合法的（ADR-030）。
   */
  private readonly parties = new PartyRegistry();
  /**
   * 人氣的配額（FINDINGS 4.38）：一天給一次、同一個對象一個月一次。**不進存檔** —— 它不是角色
   * 狀態的一部分（`0x0D` 沒有它），重開伺服器就重新開始（ADR-031、§4.38 的 OPEN）。
   */
  private readonly fameLedgers = new FameLedgers();
  /**
   * 交易（1:1 교환）的房間與邀請（FINDINGS §4.40）。跟隊伍一樣是世界層的狀態：房間只認角色 id，
   * 但**邀請**照 client 的規則只找同一張圖的人（`sub_471A40` 用 `CUserPool` 找名字），所以
   * `handleTradeInvite` 會先看兩邊是不是同一個 `FieldInstance`。
   */
  private readonly trades = new TradeRegistry();
  /**
   * 三人聊天室（메신저）的房間與邀請（FINDINGS §4.41）。跟隊伍、交易一樣是世界層：房間只認角色
   * id，邀請卻可以跨地圖（聊天室本來就不在同一張圖上）。
   */
  private readonly messenger = new MessengerRegistry();
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
    this.seats = new SeatKeeper({
      online: this.online,
      heartbeat: this.heartbeat,
      where: "game",
    });
    this.fields = new FieldRegistry<FieldSession>({
      ...(options.mapProvider !== undefined
        ? { mapProvider: options.mapProvider }
        : {}),
      ...(options.mobTemplate !== undefined
        ? { mobTemplate: options.mobTemplate }
        : {}),
      ...(options.npcTemplate !== undefined
        ? { npcTemplate: options.npcTemplate }
        : {}),
      ...(options.npcWalk !== undefined ? { npcWalk: options.npcWalk } : {}),
      ...(options.mobSpeedPxPerSecond !== undefined
        ? { mobSpeedPxPerSecond: options.mobSpeedPxPerSecond }
        : {}),
      ...(options.mobRespawnMs !== undefined
        ? { mobRespawnMs: options.mobRespawnMs }
        : {}),
      ...(options.dropPolicy !== undefined
        ? { dropPolicy: options.dropPolicy }
        : {}),
      ...(options.dropLifetimeMs !== undefined
        ? { dropLifetimeMs: options.dropLifetimeMs }
        : {}),
      ...(options.pickupRangeX !== undefined
        ? { pickupRangeX: options.pickupRangeX }
        : {}),
      ...(options.pickupRangeY !== undefined
        ? { pickupRangeY: options.pickupRangeY }
        : {}),
      ...(options.dropSpreadPx !== undefined
        ? { dropSpreadPx: options.dropSpreadPx }
        : {}),
      log: (line) => this.options.log?.(`game: ${line}`),
    });
    this.server = net.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (error) =>
      this.options.log?.(`game listen error: ${error.message}`),
    );
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
    this.testCheckpoints.clear();
    this.pendingShots = [];
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
    this.timer = setInterval(
      () => this.tickFields(Date.now()),
      this.options.mobTickMs ?? DEFAULT_MOB_TICK_MS,
    );
  }

  /** One tick: due shots, field lifecycle/movement, then nearby pickups. */
  private tickFields(now: number): void {
    const ready = this.pendingShots;
    this.pendingShots = [];
    for (const shot of ready) {
      if (
        this.sessionsByCharacter.get(shot.session.characterId) !==
          shot.session ||
        shot.session.instance !== shot.instance
      )
        continue;
      if (now < shot.dueAt) {
        this.pendingShots.push(shot);
        continue;
      }
      const targets = shot.attack.targets.filter(
        (target) =>
          shot.instance.mobs.mob(target.mobId)?.deaths ===
          shot.deaths.get(target.mobId),
      );
      this.resolveAttackDamage(
        shot.session,
        CLIENT_FIELD_OPCODE.shootAttack,
        { ...shot.attack, targets, targetCount: targets.length },
        now,
        false,
      );
    }
    for (const instance of this.fields.instances()) {
      instance.tick(now);
      for (const session of instance.memberList) this.pickUp(session);
    }
  }

  /** Out-of-band, authenticated development API; deliberately NOT a made-up native opcode. */
  testTools(username: string, characterId: number, request: unknown): TestToolResult {
    const session=this.sessionsByCharacter.get(characterId);
    if(!session || session.username!==username) throw new Error("體驗工具只允許操作目前帳號已進場的角色。");
    const kind=testToolKind(request), key=JSON.stringify([username,characterId]);
    const enabled=this.options.allowTestTools?.(username)===true;
    if(!enabled && kind!=="state") throw new Error("此帳號未獲 --test-tools 授權。");
    const available=(id:number)=>id===0 || this.options.skills?.book(id)!==undefined;
    let message=enabled?"體驗工具已授權；第一次變更能力前會自動記住能力與技能。還原點不跨服務重啟。":"此帳號未獲 --test-tools 授權；未更動角色。";
    if(enabled && kind!=="state") {
      if(session.shop || session.talk || this.trades.roomOf(characterId) || this.pendingShots.some(s=>s.session===session)) throw new Error("請先結束商店、對話、交易或等待射擊結算。");
      if(kind==="speed-potions") {
        if((request as {confirmed?:unknown}).confirmed!==true) throw new Error("請勾選確認後再領取體驗道具。");
        const spec=this.options.consumeSpec?.(2002001);
        if(!spec || spec.unapplied.length || spec.speed===undefined || spec.time===undefined) throw new Error("原 WZ 的加速藥水效果不可用，未發放道具。");
        const items=structuredClone(session.character.items??emptyCharacterItems());
        const grant=grantItem(items,2002001,3);
        if(!grant) throw new Error("消耗欄沒有可放三瓶加速藥水的空間，未變更背包。");
        const packet=encodeInventoryChange([grant.change]);
        session.character.items=items;session.character.flags|=CHAR_FLAG_INVENTORY_2;
        session.send(packet);this.persist();
        message="已明確領取 3 瓶 속도향상의 물약（2002001）；這是非原版體驗發放，會存檔且能力還原點不會回收道具。開啟道具窗，選消耗欄並連點使用。";
      } else {
        const plan=planTestTool(session.character,request,this.testCheckpoints.get(key),available);
        const statPacket=encodeStatUpdate({ack:false,diff:plan.diff});
        const skillPacket=encodeSkillUpdate({ack:false,changes:plan.changes});
        const wasDead=session.character.stats.hp<=0;
        Object.assign(session.character.stats,plan.diff);
        if(plan.skills) {
          const items=session.character.items??emptyCharacterItems();items.map32=plan.skills;
          session.character.items=items;session.character.flags|=0x20;
        }
        this.testCheckpoints.set(key,plan.checkpoint);
        if(wasDead && session.character.stats.hp>0) this.enterMap(session,session.instance.mapId);
        else {session.send(statPacket);session.send(skillPacket);}
        this.persist(); message=plan.message;
      }
      this.options.log?.(`test-tools: ${username} character ${characterId} ${kind} (explicit development action)`);
    }
    const checkpoint=enabled?this.testCheckpoints.get(key):undefined;
    return {enabled,message,checkpoint:!!checkpoint,restoreAvailable:!!checkpoint&&checkpoint.level===session.character.stats.level,
      canMap:enabled&&this.options.allowMapCommand?.(username)===true,
      jobs:enabled?[...NATIVE_JOB_NAMES].filter(([id])=>available(id)).map(([id,name])=>({id,name})):[]};
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
  private enterField(
    socket: net.Socket,
    sendState: CipherState,
    entry: HandoffEntry,
  ): FieldSession | undefined {
    const character = withMapId(
      entry,
      this.mapId,
      this.options.mapProvider?.(0) !== undefined,
    );
    const send = (packet: Uint8Array): void =>
      void socket.write(encodeSessionPacket(packet, sendState, "s2c"));
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
      username: entry.username,
      characterId: entry.characterId,
      name: character.stats.name,
      face: lookOf(character.stats).face,
      avatarItems: avatarItemsOf(character),
      instance,
      character,
      wallet: new MesoWallet(character.stats),
      send,
    };
    session.at = instance.spawnAt(character.stats.unknown101);
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
  private enterMap(
    session: FieldSession,
    mapId: number,
    portalName = "sp",
  ): boolean {
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
    session.attackReadyAt = undefined;
    this.pendingShots = this.pendingShots.filter((shot) => shot.session !== session);
    session.character.stats.mapId = mapId;
    session.character.stats.unknown101 = spawnPortalIndex(
      target.map,
      portalName,
    );
    session.at = target.spawnAt(session.character.stats.unknown101);
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
   * `kind`; map jumps require the explicit allowMapCommand account policy (default deny).
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
    if (
      request.kind === INTERACT_KIND_REVIVE &&
      !(
        session.character.stats.hp > 0 &&
        this.options.allowMapCommand?.(session.username) &&
        request.name === ""
      )
    ) {
      this.revive(session);
      return;
    }
    if (request.kind >= 0) {
      const refuse = (message: string) =>
        session.send(
          encodeUserChat({
            name: "System",
            text: new TextEncoder().encode(message),
          }),
        );
      if (!this.options.allowMapCommand?.(session.username)) {
        refuse("Map command is disabled for this account.");
        return;
      }
      if (session.character.stats.hp <= 0) {
        refuse("Revive before using map commands.");
        return;
      }
      if (request.name !== "" || request.kind === 999999999) {
        refuse("Invalid map command.");
        return;
      }
      if (!this.enterMap(session, request.kind)) {
        refuse(`Map ${request.kind} does not exist in this archive.`);
        return;
      }
      this.persist();
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
      this.options.log?.(
        `game: 0x0D "${name}" is no portal of map ${session.instance.mapId}`,
      );
      return;
    }
    if (
      portal.type === 0 ||
      portal.toMapId < 0 ||
      portal.toMapId === 999999999
    ) {
      this.options.log?.(
        `game: portal "${name}" of map ${session.instance.mapId} is disabled (type 0 or invalid tm)`,
      );
      return;
    }
    this.options.log?.(
      `game: "${session.name}" uses portal "${name}" of map ${session.instance.mapId} -> ${portal.toMapId}` +
        (portal.toName === "" ? "" : ` (portal "${portal.toName}")`),
    );
    if (this.enterMap(session, portal.toMapId, portal.toName || "sp"))
      this.persist();
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

  private readonly abilityTimes = new WeakMap<FieldSession, number>();
  private readonly mesoDropAt = new WeakMap<FieldSession, number>();
  /** Native input bounds + a server-owned rate limit. A nonzero 0x0D ack releases the request
   * on success AND refusal, unlike an unsolicited ack0 wallet update. */
  private handleMesoDrop(session: FieldSession, plain: Uint8Array): void {
    const refuse = () =>
      session.send(encodeStatUpdate({ ack: true, diff: {} }));
    let amount: number;
    try {
      amount = readMesoDrop(new PacketReader(plain, 1));
    } catch {
      refuse();
      return;
    }
    const now = Date.now();
    if (
      !Number.isInteger(amount) ||
      amount < MESO_DROP_MIN ||
      amount > MESO_DROP_MAX ||
      session.character.stats.hp <= 0 ||
      session.shop !== undefined ||
      session.talk !== undefined ||
      this.trades.roomOf(session.characterId) !== undefined ||
      now < (this.mesoDropAt.get(session) ?? 0) + MESO_DROP_INTERVAL_MS ||
      session.wallet.balance < amount
    ) {
      refuse();
      return;
    }
    this.mesoDropAt.set(session, now);
    if (!session.wallet.spend(amount)) {
      refuse();
      return;
    }
    session.send(
      encodeStatUpdate({ ack: true, diff: { mesos: session.wallet.balance } }),
    );
    session.instance.dropMesos(session, amount, now);
    this.persist();
  }

  /** sub_55CF60 arms the shared request gate and enforces 500ms between AP requests. */
  private handleAbility(session: FieldSession, plain: Uint8Array): void {
    let diff = {};
    try {
      const mask = readAbilityRequest(new PacketReader(plain, 1));
      const now = performance.now(),
        last = this.abilityTimes.get(session);
      if (last === undefined || now - last >= 500) {
        this.abilityTimes.set(session, now);
        diff = spendAbility(
          session.character.stats,
          mask,
          characterGrowthContext(session.character, this.options.growthSkill),
        );
      }
    } catch (error) {
      this.options.log?.(`game: AP request refused: ${String(error)}`);
    }
    // Refusals must release the same native gate as success; no silent hang with zero AP.
    session.send(encodeStatUpdate({ ack: true, diff }));
    if (Object.keys(diff).length) this.persist();
  }

  /** 55D140 -> 55B6A0: one SP, authoritative req/max/book checks and a nonzero release on refusal. */
  private handleSkillUp(session: FieldSession, plain: Uint8Array): void {
    let change: SkillChange | undefined;
    try {
      const skillId = readSkillRequest(new PacketReader(plain, 1));
      const now = performance.now(), last = this.abilityTimes.get(session);
      if (last === undefined || now - last >= 500) {
        this.abilityTimes.set(session, now); // AP and SP share the native gate/rate window.
        change = spendSkillPoint(session.character, skillId, this.options.skills);
      }
    } catch (error) { this.options.log?.(`game: SP request refused: ${String(error)}`); }
    if (change) {
      this.persist();
      session.send(encodeStatUpdate({ ack: false, diff: { sp: session.character.stats.sp } }));
    }
    session.send(encodeSkillUpdate({ ack: true, changes: change ? [change] : [] }));
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
      if (Object.keys(diff).length > 0)
        session.send(encodeStatUpdate({ diff }));
      this.options.log?.(
        `game: "${session.name}" 0x1c stat report: ${describeClientStatReport(report)} - hp ` +
          `${stats.hp}/${stats.maxHp} mp ${stats.mp}/${stats.maxMp}` +
          (Object.keys(diff).length === 0 ? " (nothing changed)" : ""),
      );
    } catch (error) {
      this.options.log?.(
        `game: 0x1C stat report unreadable: ${(error as Error).message}`,
      );
    }
  }

  /**
   * A drag in the inventory window: `0x17`, `[u8 tab][s16 from][s16 to][s16 count]` (FINDINGS 4.36,
   * `game/inventory.ts`). Equipping, unequipping, moving a stack and throwing one away all arrive
   * here - which of the four it is, is the sign of the two slots and whether the destination is 0.
   *
   * The client moved nothing itself, so the window follows this answer and only this answer:
   *
   *   `0x0B`  the item's new slot. An equip travels as a `put` at the **negative** slot of the equip
   *           tab, which is the worn item itself - that is what puts it on the avatar. A throw-away
   *           leaves as a `clear` (the whole stack went) or as a `put` of what is left.
   *   `0x43`  when the ground was the destination: the item is on the ground where the player stands,
   *           and the field's own packet says so (`FieldInstance.dropItem`) - `kind 2`, no monster.
   *   `0x28`  when the worn set moved: everybody else's copy of this player's look, built from the
   *           record the same way `0x1C` is (`avatarItemsOf`). The user's own client needs nothing
   *           more than the `0x0B` - it draws itself from the record it holds.
   *
   * A refused drag is answered with an **empty** `0x0B` (`result = 1`, `count = 0`), the same refusal
   * the use-item path sends, and for the same reason: `sub_55ACB0` arms the client's one-request gate
   * right after it sends (`*(CWvsApp + 0x18) = 1`, `.text:0055AE70`) and only a `0x0B` whose `result`
   * is non-zero clears it (`sub_55BAB0`, `.text:0055BB0C`; FINDINGS 4.6). Silence would leave that gate
   * armed and the whole inventory window dead until something else sent a `0x0B`; an empty one is also
   * exactly true - the client's inventory only ever changes on `0x0B`, so nothing moving *is* the
   * refusal.
   */
  private handleChangeSlot(session: FieldSession, plain: Uint8Array): void {
    let request: ClientChangeSlot;
    try {
      request = readClientChangeSlot(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(
        `game: 0x17 change slot unreadable: ${(error as Error).message}`,
      );
      return;
    }
    const label = `0x17 ${describeClientChangeSlot(request)}`;
    // The record's item block is what the login server handed over, so a write here is a write to the
    // character (ADR-017). A character without one gets an empty block rather than a crash: the
    // session would have nothing to move anyway.
    if (session.character.items === undefined)
      session.character.items = emptyCharacterItems();
    if (session.character.stats.hp <= 0 || session.shop || session.talk) {
      session.send(encodeInventoryChange([]));
      return;
    }
    if (request.toSlot === 0 && this.options.dropItemAllowed) {
      const source =
        request.fromSlot < 0
          ? session.character.items.worn.get(-request.fromSlot)
          : session.character.items.inventories[request.tab - 1]?.items.get(
              request.fromSlot,
            );
      if (!source || !this.options.dropItemAllowed(source.itemId)) {
        session.send(encodeInventoryChange([]));
        this.options.log?.(`game: ${label} refused (cash or unknown WZ item)`);
        return;
      }
    }
    const outcome = applyChangeSlot(session.character.items, request);
    if (outcome.kind === "failed") {
      session.send(encodeInventoryChange([]));
      this.options.log?.(
        `game: ${label} by "${session.name}" refused (${outcome.reason})`,
      );
      return;
    }
    session.send(encodeInventoryChange(outcome.changes));
    // A throw-away leaves the bag here and lands in the field: the ground half belongs to
    // `game/drops.ts`, exactly like a monster's loot (`FieldInstance.dropItem`), and the whole map -
    // the thrower included - is told with the `0x43` that carries no monster (FINDINGS 4.36).
    let note = "";
    if (outcome.kind === "drop") {
      session.instance.dropItem(
        session,
        outcome.slot,
        outcome.count,
        Date.now(),
      );
      note = ` - dropped item ${outcome.slot.itemId} x${outcome.count} at the player's feet`;
    }
    if (outcome.changes.length) this.persist();
    if (!outcome.lookChanged) {
      this.options.log?.(`game: ${label} by "${session.name}"${note}`);
      return;
    }
    // The field's copy first: a player who enters *after* this has to be drawn with the new equip,
    // and `enterPacket` reads the member's array.
    session.avatarItems = avatarItemsOf(session.character);
    session.instance.broadcast(
      encodeUserLook({
        characterId: session.characterId,
        avatarItems: session.avatarItems,
      }),
      session.characterId,
    );
    this.options.log?.(
      `game: ${label} by "${session.name}"${note} - look changed, ${session.avatarItems.length} item(s) ` +
        `sent to the rest of map ${session.instance.mapId}`,
    );
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
  private handleUseItem(
    session: FieldSession,
    plain: Uint8Array,
    opcode: number,
  ): void {
    const label =
      opcode === CLIENT_FIELD_OPCODE.useMapItem ? "0x19 map item" : "0x18 item";
    let request: ClientUseItem;
    try {
      request = readClientUseItem(new PacketReader(plain, 1), opcode);
    } catch (error) {
      // Nothing can be answered: the slot is what the answer would name, and it did not parse.
      this.options.log?.(
        `game: ${label} unreadable: ${(error as Error).message}`,
      );
      return;
    }
    const refuse = (reason: string): void => {
      session.send(encodeInventoryChange([]));
      this.options.log?.(
        `game: ${label} slot ${request.slot} item ${request.itemId} by "${session.name}" refused (${reason})`,
      );
    };
    // Server safety policy: never consume a stack that is being offered in a trade.
    if (session.shop || session.talk || this.trades.roomOf(session.characterId)) {
      refuse("close the shop, conversation or trade before using an item");
      return;
    }
    const spec = this.options.consumeSpec?.(request.itemId);
    if (spec === undefined) {
      refuse(
        "the archive does not say what this item does (no Item/Consume spec)",
      );
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
    const temporary = spec.speed !== undefined && spec.time !== undefined
      ? { durationMs: spec.time, values: { speed: spec.speed }, sourceIsSkill: false, sourceId: request.itemId }
      : undefined;
    if (!healsVitals(spec) && !temporary) {
      refuse("no implemented vital or temporary effect in its spec");
      return;
    }
    // The rules are `game/vitals.ts`'s, and the copy is how "would anything move?" is asked without
    // applying twice: a potion used at full HP changes nothing, and nothing is what it should cost.
    const probe: CharacterStats = { ...stats };
    const diff = applyVitalReport(probe, consumeDeltas(spec, stats));
    if (stats.hp <= 0 || (Object.keys(diff).length === 0 && !temporary)) {
      refuse(
        `hp ${stats.hp}/${stats.maxHp} mp ${stats.mp}/${stats.maxMp}: dead or already restored`,
      );
      return;
    }
    // Validate/encode the entire effect before consuming even one item.
    const statPacket = encodeStatUpdate({ diff, temporary });
    const taken = takeItem(items, request.itemId, request.slot, 1);
    if (taken === undefined) {
      refuse(
        `slot ${request.slot} of the USE tab does not hold item ${request.itemId}`,
      );
      return;
    }
    stats.hp = probe.hp;
    stats.mp = probe.mp;
    session.send(encodeInventoryChange([taken.change]));
    session.send(statPacket);
    this.persist();
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
    const target =
      spec.moveTo < 0 ? reviveMapId(session.instance.map) : spec.moveTo;
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
      refuse(
        `slot ${request.slot} of the USE tab does not hold item ${request.itemId}`,
      );
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
      this.options.log?.(
        `game: 0x33 object click unreadable: ${(error as Error).message}`,
      );
      return;
    }
    session.send(encodeFieldRequestRelease());
    const npc = session.instance.npcs.byId(objectId);
    if (npc === undefined) {
      this.options.log?.(
        `game: object click ${objectId} is not an NPC of this field - released only`,
      );
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
  private talkTo(
    session: FieldSession,
    npcId: number,
    templateId: number,
  ): void {
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
      this.options.log?.(
        `game: 0x15 reply unreadable: ${(error as Error).message}`,
      );
      return;
    }
    const talk = session.talk;
    if (talk === undefined) {
      this.options.log?.(
        `game: ${describeQuestReply(reply)} without a dialog open - dropped`,
      );
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
    this.options.log?.(
      `game: NPC ${talk.npcId} says line ${talk.lineIndex + 1}/${talk.lineCount}`,
    );
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
      this.options.log?.(
        `game: 0x16 shop request unreadable: ${(error as Error).message}`,
      );
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
      this.options.log?.(
        `game: 0x16 shop request without an open shop - dropped (no 0x4B)`,
      );
      return;
    }
    if (session.character.stats.hp <= 0) {
      write(encodeShopResult(SHOP_RESULT.error));
      return;
    }
    if (request.kind === "buy") {
      const row = keeper.linesOf(shop).filter((line) => line.price !== 0)[
        request.row
      ];
      if (!row || row.itemId !== request.itemId) {
        write(encodeShopResult(SHOP_RESULT.error));
        return;
      }
    }
    const items = session.character.items ?? emptyCharacterItems();
    const before = { ...session.character.stats };
    const outcome =
      request.kind === "recharge"
        ? (keeper.recharge?.(items, session.wallet, shop, request.slot) ?? {
            kind: "failed" as const,
            reason: "notInShop" as const,
          })
        : request.kind === "buy"
          ? keeper.buy(
              items,
              session.wallet,
              shop,
              request.itemId,
              request.count,
            )
          : keeper.sell(
              items,
              session.wallet,
              request.slot,
              request.itemId,
              request.count,
            );
    if (outcome.kind === "failed") {
      write(encodeShopResult(shopResultCode(outcome.reason)));
      this.options.log?.(
        `game: shop ${shop.shopId} ${request.kind} refused (${outcome.reason})`,
      );
      return;
    }
    write(encodeShopResult(SHOP_RESULT.silent));
    write(encodeInventoryChange([outcome.change]));
    const diff = diffStats(before, session.character.stats);
    if (Object.keys(diff).length > 0) write(encodeStatUpdate({ diff }));
    this.persist();
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
    // Only a drop that was already there when this player last moved can be walked onto, which is
    // what keeps a throw-away from landing on the thrower's own feet and coming straight back
    // (`DropField.reachable`). A session with no stamp at all is treated as just having arrived.
    const drop = instance.drops.reachable(
      at.x,
      at.y,
      session.lastMoveAt ?? Date.now(),
    );
    if (drop === undefined) return;
    const items = session.character.items ?? emptyCharacterItems();
    const before = { ...session.character.stats };
    const outcome = pickUpDrop(drop, items, session.wallet);
    if (outcome.kind === "no-room") {
      this.options.log?.(
        `game: drop ${drop.dropId} (item ${drop.itemId}) is under ${session.characterId} but the ` +
          `inventory/wallet has no room - it stays on the ground`,
      );
      return;
    }
    instance.drops.take(drop);
    // The field tells *everyone*, including the taker: that packet is what flies the icon to them.
    instance.broadcastDropTaken(drop.dropId, session.characterId);
    if (outcome.kind === "item") {
      session.send(encodeInventoryChange([outcome.change]));
      session.send(encodeLootNotice(outcome.notice));
      this.persist();
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
    this.persist();
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
   * `0x23` for the others (see `relayAttack`), then the mob packets the hits owe - another player
   * standing next to the attacker sees the same mob flash and die (`game/world.ts`) - and then the
   * reward, which is the attacker's alone (the exp goes to the connection that reported the hit,
   * see `awardKillExp`).
   */
  private applyAttack(session: FieldSession, plain: Uint8Array): void {
    const opcode = plain[0] ?? 0;
    let attack: ClientAttack;
    try {
      const reader = new PacketReader(plain, 1);
      attack = readClientAttack(reader, opcode);
      if (opcode === CLIENT_FIELD_OPCODE.shootAttack && reader.remaining !== 0)
        throw new RangeError("trailing shot bytes");
    } catch (error) {
      this.options.log?.(
        `game: 0x${hex(opcode)} attack unreadable: ${(error as Error).message}`,
      );
      return;
    }
    if (
      session.character.stats.hp <= 0 ||
      session.shop ||
      session.talk ||
      this.trades.roomOf(session.characterId)
    )
      return;
    const now = Date.now();
    if (now + 30 < (session.attackReadyAt ?? 0)) return; // Transport tolerance is server policy.
    const weaponId = session.character.items?.worn.get(11)?.itemId ?? 0;
    const profile = this.options.basicAttack?.(weaponId);
    if (opcode === CLIENT_FIELD_OPCODE.shootAttack) {
      // This path is a basic one-round attack, not an accidental free skill/multi-shot service.
      const motion = profile?.shoot.find(
        (entry) => entry.action === attack.action,
      );
      if (
        attack.skillId !== 0 ||
        attack.hits !== 1 ||
        attack.targets.length > 1 ||
        !motion ||
        attack.speed !== profile?.speed ||
        attack.projectileSlot === undefined ||
        !session.at
      )
        return;
      const duration = motion.delays.reduce((sum, delay) => sum + delay, 0);
      const release = duration - (motion.delays.at(-1) ?? 0);
      const direction = attack.facingLeft ? -1 : 1;
      // Selection geometry remains a bounded server policy until the native mob shape pool is ported.
      const targets = attack.targets.filter((target) => {
        const mob = session.instance.mobs.mob(target.mobId);
        const dx = mob === undefined ? -1 : (mob.x - session.at!.x) * direction;
        return (
          mob?.alive &&
          dx >= 0 &&
          dx <= 265 &&
          Math.abs(mob.y - session.at!.y) <= 100
        );
      });
      const items = session.character.items;
      const spent =
        items === undefined
          ? undefined
          : spendBasicAmmo(items, attack.projectileSlot);
      if (!spent) return;
      session.attackReadyAt = now + duration;
      session.send(encodeInventoryChange([spent.change], 0)); // A shot must not release a slot-move pending gate.
      this.persist();
      const accepted = { ...attack, targets, targetCount: targets.length };
      this.relayAttack(
        session,
        opcode,
        accepted,
        targets.map((target) => ({
          mobId: target.mobId,
          hitAnimation: target.hitAnimation,
          damages: target.damages,
        })),
        spent.itemId,
      );
      if (targets.length > 0) {
        const mob = session.instance.mobs.mob(targets[0]!.mobId)!;
        const bounds = profile?.melee[0]?.bounds;
        const near = bounds
          ? -Math.min(Math.max(bounds.left, -65), bounds.right - 1)
          : 65;
        const travel = Math.trunc(
          Math.hypot(
            mob.x - (session.at.x + direction * near),
            mob.y - 20 - (session.at.y - 25),
          ) * 1.5,
        );
        this.pendingShots.push({
          session,
          instance: session.instance,
          attack: accepted,
          dueAt: now + release + travel,
          deaths: new Map([[mob.mobId, mob.deaths]]),
        });
      }
      return;
    }
    const motion = profile?.melee.find(
      (entry) => entry.action === attack.action,
    );
    if (motion)
      session.attackReadyAt =
        now + motion.delays.reduce((sum, delay) => sum + delay, 0);
    this.resolveAttackDamage(session, opcode, attack, now, true);
  }

  private resolveAttackDamage(
    session: FieldSession,
    opcode: number,
    attack: ClientAttack,
    now: number,
    relay: boolean,
  ): void {
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
      relayed.push({
        mobId: hit.mobId,
        hitAnimation: target.hitAnimation,
        damages: target.damages,
      });
      this.options.log?.(
        hit.killed
          ? `game: mob ${hit.mobId} (template ${hit.templateId}) killed by ${damage} ` +
              `- die animation ${hit.dieMs}ms, corpse goes at +${hit.dieMs}ms, respawn at +${hit.dieMs + hit.respawnMs}ms`
          : `game: mob ${hit.mobId} hit for ${damage} - hp ${hit.hp}/${hit.maxHp}`,
      );
      if (hit.killed)
        kills.push({ mobId: hit.mobId, templateId: hit.templateId });
    }
    if (relay) this.relayAttack(session, opcode, attack, relayed);
    session.instance.broadcastAll(mobPackets);
    // The reward first, the loot after: the exp is the kill's own payout (a stat diff plus, on a
    // level-up, the client's own effect), while a drop has to fly out of the corpse.
    for (const kill of kills) {
      this.awardKillExp(session, kill.templateId);
      this.spawnDrops(session, kill.mobId, now);
    }
  }

  /**
   * Everybody else's half of an attack: the `0x23`/`0x24`/`0x25` the client opcode mirrors
   * (FINDINGS 4.11.7b/4.11.7c).
   *
   * The attacker does not need it back - its own client ran the same effect routine while it built
   * its packet (for a swing that is `sub_50DAA0`, `sub_50D7F0` and `sub_4882F0`, all *before* the
   * packet is written; for a shot and a cast, `sub_41B630`/`sub_41B850`) - so the copy goes to the
   * others, exactly like `0x27` and `0x29`.
   *
   * Three of the receiver's fields have no source on this side, and they are sent as the value that
   * is not a guess:
   *
   *   `skillLevel`/`skillId`  0 - "no skill node". The pair is read, never watched on a wire, and a
   *                           plain melee swing has no skill behind it.
   *   `afterimage`            0 - the first child of `Character/Afterimage/<the weapon's
   *                           info/afterImage>`, which every one of those images has. Which child the
   *                           attacker used comes from `sub_4BE270` on its own client.
   *   the trailing `u32`      0 for `0x0F`/`0x11`. For a `0x10` it is what the `0x24` handler reads
   *                           it as - the projectile's item id, used to offset a throwing star's
   *                           effect (`bottom / 10000 == 207`). Basic shots now validate/consume the
   *                           selected USE slot first and pass its PRE-debit item id here. Thus the
   *                           last arrow still has a projectile after its inventory slot clears.
   *                           Invalid shots are refused, not relayed as projectile id 0.
   *
   * `encodeUserAttack` writes the s2c opcode the client opcode mirrors, and an opcode outside the
   * table (`ATTACK_RELAY_OPCODE`) has no relay at all.
   */
  private relayAttack(
    session: FieldSession,
    opcode: number,
    attack: ClientAttack,
    targets: UserAttackTarget[],
    spentProjectileItemId?: number,
  ): void {
    const relayOpcode = ATTACK_RELAY_OPCODE[opcode];
    if (relayOpcode === undefined) return;
    if (session.instance.memberCount <= 1) return;
    const projectileItemId = spentProjectileItemId ?? 0;
    const packet = encodeUserAttack(
      {
        characterId: session.characterId,
        hits: attack.hits,
        skillLevel: 0,
        skillId: 0,
        facingLeft: attack.facingLeft,
        action: attack.action,
        speed: attack.speed,
        afterimage: 0,
        projectileItemId,
        targets,
      },
      relayOpcode,
    );
    session.instance.broadcast(packet, session.characterId);
    this.options.log?.(
      `game: 0x${relayOpcode.toString(16).padStart(2, "0")} attack of "${session.name}" ` +
        `(${attack.facingLeft ? "left" : "right"} action=${attack.action} hits=${attack.hits} ` +
        `speed=${attack.speed}${projectileItemId === 0 ? "" : ` projectile=${projectileItemId}`} ` +
        `${targets.length} target(s)) sent to ${session.instance.memberCount - 1} other player(s)`,
    );
  }

  /**
   * The player killed a monster: put its `info.exp` on the character's account and tell the client
   * with `0x0D` (FINDINGS 4.21).
   *
   * The amount is the monster's own data and the level thresholds are the client's own table
   * (`game/exp.ts`); the packet is the *difference* between the record before and after, so a plain
   * gain carries one field (`exp`) and a level-up carries maxima plus the HP/MP refill the
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
      this.options.log?.(
        `game: mob template ${templateId} carries no exp, nothing awarded`,
      );
      return;
    }
    const before = { ...session.character.stats };
    const gain = awardExp(
      session.character.stats,
      amount,
      undefined,
      characterGrowthContext(session.character, this.options.growthSkill),
    );
    if (!gain.changed) return;
    const stats = session.character.stats;
    session.send(encodeStatUpdate({ diff: diffStats(before, stats) }));
    this.persist(); // Persist EXP/maxima now, including delayed projectile kills.
    if (gain.levels > 0) {
      // The field's other half of a level-up: `0x29` plays over the levelling user the same effect
      // their own client plays from the `0x0D` above, and the receiving pool resolves the id (an id
      // it does not know is dropped) - so this is exactly "everybody else sees the effect".
      session.instance.broadcast(
        encodeUserEffect({
          characterId: session.characterId,
          effect: USER_EFFECT_LEVEL_UP,
        }),
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
    if (spawned.length === 0)
      this.options.log?.(`game: mob ${mobId} died and left nothing`);
  }

  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    const clientSendSeed =
      this.options.handshake?.clientSendSeed ?? randomSeed();
    const clientRecvSeed =
      this.options.handshake?.clientRecvSeed ?? randomSeed();
    const body =
      this.options.handshake?.body ?? new Uint8Array(HANDSHAKE_BODY_BYTES);
    const deframer = new SessionDeframer({
      recvState: new CipherState(clientSendSeed),
      expectHandshake: false,
      expectedMagic: CLIENT_SEND_MAGIC,
    });
    socket.write(encodeHandshake(body, clientSendSeed, clientRecvSeed));
    this.options.log?.(
      "game: handshake sent, waiting for the 0x04 character id",
    );

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
          if (session !== undefined)
            this.sessionsByCharacter.set(entry.characterId, session);
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
        if (session !== undefined && opcode === MESO_DROP_OPCODE) {
          this.handleMesoDrop(session, event.plain);
          continue;
        }
        if (session !== undefined && opcode === SKILL_REQUEST_OPCODE) {
          this.handleSkillUp(session, event.plain);
          continue;
        }
        if (session !== undefined && opcode === ABILITY_REQUEST_OPCODE) {
          this.handleAbility(session, event.plain);
          continue;
        }
        if (
          session !== undefined &&
          opcode === CLIENT_FIELD_OPCODE.statReport
        ) {
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
        // A drag in the inventory window: an equip, an unequip, or a move between slots. The window
        // follows the `0x0B` this answers with, and the field hears a `0x28` when the worn set moved.
        if (
          session !== undefined &&
          opcode === CLIENT_FIELD_OPCODE.changeSlot
        ) {
          this.handleChangeSlot(session, event.plain);
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
        if (
          session !== undefined &&
          opcode === CLIENT_FIELD_OPCODE.questReply
        ) {
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
        if (
          session !== undefined &&
          opcode === CLIENT_FIELD_OPCODE.userRequest
        ) {
          this.handleUserRequest(session, event.plain);
          continue;
        }
        // 隊伍的請求（`/파티만들기`…`/파티강퇴`、邀請的「是」）。世界層的狀態，不走場地廣播：
        // 隊員可能在地圖的另一端（see `handlePartyRequest`）。
        if (session !== undefined && opcode === PARTY_OPCODE.request) {
          this.handlePartyRequest(session, event.plain);
          continue;
        }
        // 人氣（角色右鍵選單的「인기도 +／-」）。跟著場地：client 只找得到同一張圖的人。
        if (session !== undefined && opcode === FAME_OPCODE.request) {
          this.handleFameRequest(session, event.plain);
          continue;
        }
        // 交易（`/교환`、邀請的「是」、放道具／放錢／確認／關窗）。`0x25` 是所有小房間共用的
        // 請求 opcode，房間種類在第一個 payload byte（FINDINGS §4.39）。
        if (session !== undefined && opcode === MINIROOM_OPCODE.request) {
          this.handleMiniRoomRequest(session, event.plain);
          continue;
        }
        // 메신저（三人聊天室，`0x24`）。跟交易共用「開著的視窗」這個概念，但是另一個 opcode：
        // 開房／進房、離開、`/초대`、聊天（FINDINGS §4.41）。
        if (session !== undefined && opcode === MESSENGER_OPCODE.request) {
          this.handleMessengerRequest(session, event.plain);
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
      if (session !== undefined) {
        // Out of the roster *before* the party is told: the leaving session is gone, and a packet
        // written to a closed socket is nothing anyone needs. Leaving the party is the same rule as
        // the seat (ADR-030): the 2003 party has no offline members.
        this.sessionsByCharacter.delete(session.characterId);
        this.pendingShots = this.pendingShots.filter((shot) => shot.session !== session);
        this.leaveParty(session.characterId, "disconnected");
        this.leaveTrade(session.characterId, "disconnected");
        this.leaveMessenger(session.characterId);
      }
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
      this.options.log?.(
        `game: persist failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      this.options.log?.(
        `game: 0x12 chat unreadable: ${(error as Error).message}`,
      );
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
      this.options.log?.(
        `game: 0x13 emotion unreadable: ${(error as Error).message}`,
      );
      return;
    }
    session.instance.broadcast(
      encodeUserEmotion({
        characterId: session.characterId,
        emotion: emotion.emotion,
      }),
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
      this.options.log?.(
        `game: find "${request.name}" -> "${target.name}" in map ${target.instance.mapId}`,
      );
      session.send(
        encodeUserFindAnswer({
          name: target.name,
          mapId: target.instance.mapId,
        }),
      );
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
      this.options.log?.(
        `game: whisper "${session.name}" -> "${request.name}": no such player`,
      );
      session.send(
        encodeUserWhisperAnswer({ name: request.name, delivered: false }),
      );
      return;
    }
    this.options.log?.(
      `game: whisper "${session.name}" -> "${target.name}": ${decodeCp949(text)}`,
    );
    // The receiver's client renders the same `%s>> %s` line as chat - the packet *is* the chat one -
    // so a delivered whisper arrives with the sender's name in front of it. The sender's own echo
    // (`0x0A`) carries no text: their client kept what it sent and prints "name<< text" from it.
    target.send(encodeUserChat({ name: session.name, text }));
    session.send(
      encodeUserWhisperAnswer({ name: target.name, delivered: true }),
    );
  }

  /**
   * 隊伍的請求（c2s `0x26`，FINDINGS 4.37／ADR-030）。
   *
   * 五個 type 各自對應 client 的一個指令（`/파티만들기`、`/파티탈퇴`、`/파티초대`、`/파티강퇴`、邀請的
   * 「是」），而每個請求都一定有一個 `0x10` 回答——包括拒絕。原因跟 `0x0B`／`0x18` 一樣：client 的
   * 邀請是**模態**對話框，它等的是伺服器的下一句話，不是自己的畫面。
   *
   * **隊伍在世界層**：名冊裡沒有地圖，所以隊員可以在不同的圖上；這裡用 `sessionsByCharacter` 找人，
   * 不經 `FieldInstance`。**隊長退隊＝解散**（client 的 `0x10` type 10 `flag = 0` 只有這個意思，封包
   * 裡也沒有「換隊長」的欄位），**下線＝退隊**——2003 的隊伍沒有離線隊員。
   *
   * 兩個「client 已經自己做過」的檢查仍然留在這裡：`sub_471CD0` 先看自己有沒有隊伍、
   * `sub_472050`／`sub_4722E0` 先看自己是不是隊長，所以一個守規矩的 client 不會送出會被拒絕的
   * 請求；伺服器仍然自己判斷，因為封包是別人可以偽造的。
   */
  private handlePartyRequest(session: FieldSession, plain: Uint8Array): void {
    let request: ClientPartyRequest;
    try {
      request = readClientPartyRequest(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(`game: 0x26 unreadable: ${(error as Error).message}`);
      return;
    }
    this.options.log?.(`game: ${describeClientPartyRequest(request)}`);
    switch (request.kind) {
      case "create": {
        if (this.parties.partyOf(session.characterId) !== undefined) {
          session.send(encodePartyResult({ kind: "alreadyInParty" }));
          return;
        }
        const party = this.parties.create(partyMemberOf(session));
        session.send(encodePartyResult({ kind: "created", partyId: party.id }));
        this.options.log?.(
          `game: party: "${session.name}" created party ${party.id}`,
        );
        return;
      }
      case "leave": {
        const leave = this.parties.leave(session.characterId);
        if (leave === undefined) {
          session.send(encodePartyResult({ kind: "notInParty" }));
          return;
        }
        // The leaver is still connected here, and it is one of `leave.members`: the client clears its
        // own party id only when it receives this packet with its own id in it (FINDINGS 4.37).
        this.broadcastPartyLeave(leave, false, "left");
        return;
      }
      case "accept": {
        if (this.parties.partyOf(session.characterId) !== undefined) {
          session.send(encodePartyResult({ kind: "alreadyInParty" }));
          return;
        }
        const invite = this.parties.inviteOf(session.characterId);
        const party =
          invite === undefined
            ? undefined
            : this.parties.partyOf(invite.inviterId);
        if (
          invite === undefined ||
          party === undefined ||
          party.id !== invite.partyId
        ) {
          this.options.log?.(
            `game: party: "${session.name}" accepted an invite from ${request.inviterId} that is no longer valid`,
          );
          session.send(encodePartyResult({ kind: "unknown" }));
          return;
        }
        const members = this.parties.join(party, partyMemberOf(session));
        if (members === undefined) {
          session.send(encodePartyResult({ kind: "full" }));
          return;
        }
        // `type 13` carries the joiner's name *and* the whole roster: the joiner prints
        // "파티에 가입되었습니다." because the name is its own, everyone else prints
        // "'name'님이 파티에 가입하셨습니다", and every client replaces its table with the new one.
        const joined = encodePartyResult({
          kind: "joined",
          partyId: party.id,
          name: session.name,
          members,
        });
        for (const member of members)
          this.sessionsByCharacter.get(member.characterId)?.send(joined);
        this.options.log?.(
          `game: party: "${session.name}" joined ${party.id} [${members.map((member) => member.name).join(", ")}]`,
        );
        return;
      }
      case "invite": {
        const party = this.parties.partyOf(session.characterId);
        if (party === undefined) {
          session.send(encodePartyResult({ kind: "notInParty" }));
          return;
        }
        if (party.leaderId !== session.characterId) {
          session.send(encodePartyResult({ kind: "unknown" }));
          return;
        }
        const target = this.sessionsByCharacter.get(request.targetId);
        if (target === undefined) {
          this.options.log?.(
            `game: party: "${session.name}" invited ${request.targetId}, who is not online`,
          );
          session.send(encodePartyResult({ kind: "unknown" }));
          return;
        }
        if (this.parties.partyOf(target.characterId) !== undefined) {
          session.send(encodePartyResult({ kind: "alreadyInParty" }));
          return;
        }
        this.parties.invite(party.id, session.characterId, target.characterId);
        target.send(
          encodePartyResult({
            kind: "invite",
            inviterId: session.characterId,
            inviterName: session.name,
          }),
        );
        this.options.log?.(
          `game: party: "${session.name}" invited "${target.name}" to ${party.id} (waiting for the answer)`,
        );
        return;
      }
      case "kick": {
        const party = this.parties.partyOf(session.characterId);
        if (party === undefined) {
          session.send(encodePartyResult({ kind: "notInParty" }));
          return;
        }
        if (
          party.leaderId !== session.characterId ||
          request.targetId === session.characterId
        ) {
          session.send(encodePartyResult({ kind: "unknown" }));
          return;
        }
        if (
          !party.members.some(
            (member) => member.characterId === request.targetId,
          )
        ) {
          session.send(encodePartyResult({ kind: "unknown" }));
          return;
        }
        const leave = this.parties.leave(request.targetId);
        if (leave === undefined) {
          session.send(encodePartyResult({ kind: "unknown" }));
          return;
        }
        this.broadcastPartyLeave(leave, true, "kicked");
        return;
      }
    }
  }

  /**
   * 一次「給人氣」（`0x20` → `0x12`，FINDINGS §4.38、ADR-031）。
   *
   * 目標用**場地**找（`session.instance.member`）：client 的選單只看得到同一張圖的人
   * （`sub_55D7B0` 在 `CUserPool` 裡找），所以封包裡的角色 id 一定是同場地的；找不到就是過期的 id，
   * 回 `type 1`（client 什麼都不顯示）而不是編一個訊息。
   *
   * 成功的三個收件者：**給的人**收到 `type 0`（顯示「'name'님의 인기도를 …」）、**被給的人**收到
   * `type 5`（「'name'님께서 …」）＋ 一個 `0x0D`（`fame` 的 bit `0x20000`）讓他的能力視窗跟著動。
   * 給的人**不會**收到 `0x0D` —— 自己的人氣沒變。
   */
  private handleFameRequest(session: FieldSession, plain: Uint8Array): void {
    let request: ClientFameRequest;
    try {
      request = readClientFameRequest(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(
        `game: 0x20 fame unreadable: ${(error as Error).message}`,
      );
      return;
    }
    this.options.log?.(`game: ${describeClientFameRequest(request)}`);
    const target = session.instance.member(request.targetId);
    if (target === undefined) {
      session.send(encodeFameResult({ kind: "ignored" }));
      this.options.log?.(
        `game: fame: "${session.name}" named ${request.targetId}, who is not in map ${session.character.stats.mapId}`,
      );
      return;
    }
    const outcome = applyFame({
      giverId: session.characterId,
      giverLevel: session.character.stats.level,
      targetId: target.characterId,
      up: request.up,
      targetFame: target.character.stats.fame,
      ledger: this.fameLedgers.ledgerOf(session.characterId),
      clock: fameClock(Date.now()),
    });
    if (outcome.kind === "refused") {
      switch (outcome.reason) {
        case "self":
          session.send(encodeFameResult({ kind: "ignored" }));
          break;
        case "beginner":
          session.send(encodeFameResult({ kind: "beginner" }));
          break;
        case "alreadyToday":
          session.send(encodeFameResult({ kind: "alreadyToday" }));
          break;
        case "alreadyThisMonth":
          session.send(encodeFameResult({ kind: "alreadyThisMonth" }));
          break;
      }
      this.options.log?.(
        `game: fame: "${session.name}" -> "${target.name}" refused (${outcome.reason})`,
      );
      return;
    }
    this.fameLedgers.remember(session.characterId, outcome.ledger);
    const before = { ...target.character.stats };
    target.character.stats.fame = outcome.fame;
    target.send(
      encodeFameResult({
        kind: "received",
        name: session.name,
        up: request.up,
      }),
    );
    const diff = diffStats(before, target.character.stats);
    if (Object.keys(diff).length > 0) target.send(encodeStatUpdate({ diff }));
    session.send(
      encodeFameResult({ kind: "changed", name: target.name, up: request.up }),
    );
    this.options.log?.(
      `game: fame: "${session.name}" -> "${target.name}" ${request.up ? "up" : "down"} (now ${outcome.fame})`,
    );
  }

  /**
   * 交易（1:1 교환）的請求（c2s `0x25`，FINDINGS §4.39／§4.40）。
   *
   * `0x25` 是**所有小房間共用**的請求 opcode（七個送出點裡四個在 `CTradingRoomDlg`），type 才是
   * 語意。交易的規則在 `game/trades.ts`：房間狀態、成交時的原子交換。這裡只做「把封包變成動作」
   * 與「把動作變成 `0x50`」。
   *
   * 幾個 2003 client 自己就有的閘門，伺服器仍然重做一次（封包是別人可以偽造的）：
   * 邀請只找**同一張圖**的人、一次只能開一個房間、確認之後不能再改內容。
   */
  private handleMiniRoomRequest(
    session: FieldSession,
    plain: Uint8Array,
  ): void {
    let request: ClientMiniRoomRequest;
    try {
      request = readClientMiniRoomRequest(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(
        `game: 0x25 miniroom unreadable: ${(error as Error).message}`,
      );
      return;
    }
    this.options.log?.(`game: ${describeClientMiniRoomRequest(request)}`);
    switch (request.kind) {
      case "invite":
        this.inviteToTrade(
          session,
          this.sessionsByCharacter.get(request.targetId),
        );
        return;
      case "inviteByName": {
        const target = this.sessionNamed(request.name);
        if (target === undefined || target.instance !== session.instance) {
          session.send(
            encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.notFound }),
          );
          return;
        }
        this.inviteToTrade(session, target);
        return;
      }
      case "accept":
        this.acceptTrade(session, request.inviterId);
        return;
      case "leave":
        this.leaveTrade(session.characterId, "requested");
        return;
      case "offerItem":
        this.offerTradeItem(session, request);
        return;
      case "offerMesos":
        this.offerTradeMesos(session, request.amount);
        return;
      case "confirm":
        this.confirmTrade(session);
        return;
    }
  }

  /** 一個玩家在交易房間裡的樣子。 */
  private tradeParticipant(
    session: FieldSession,
    index: number,
  ): MiniRoomParticipant {
    return {
      index,
      name: session.name,
      face: session.face,
      look: session.avatarItems,
      level: session.character.stats.level,
    };
  }

  /**
   * `/교환`（c2s `type 0`）：把邀請送到對方，並用 `0x50 type 2` 回報結果。
   *
   * `type 2` 的 `code 0` 什麼都不顯示——它是「請求收到了」的意思，不是「對方答應了」。對方答應時
   * 兩邊都會收到 `type 4`（進房間）。
   */
  private inviteToTrade(
    session: FieldSession,
    target: FieldSession | undefined,
  ): void {
    if (
      target === undefined ||
      target === session ||
      target.instance !== session.instance
    ) {
      session.send(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.notFound }));
      this.options.log?.(
        `game: trade: "${session.name}" tried to invite someone who is not in this map`,
      );
      return;
    }
    const busy =
      this.trades.roomOf(session.characterId) !== undefined ||
      this.trades.roomOf(target.characterId) !== undefined;
    if (busy) {
      session.send(
        encodeMiniRoomRefused({
          code: MINIROOM_REFUSAL.busy,
          name: target.name,
        }),
      );
      return;
    }
    this.trades.invite(session.characterId, target.characterId, Date.now());
    session.send(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.ok }));
    target.send(
      encodeMiniRoomInvite({
        inviterId: session.characterId,
        inviterName: session.name,
      }),
    );
    this.options.log?.(
      `game: trade: "${session.name}" invited "${target.name}" (waiting for the answer)`,
    );
  }

  /** 邀請的「是」（c2s `type 3`）：開房間，兩邊都收到 `0x50 type 4`。 */
  private acceptTrade(session: FieldSession, inviterId: number): void {
    const invite = this.trades.inviteOf(session.characterId, Date.now());
    if (invite === undefined) {
      session.send(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.notFound }));
      this.options.log?.(
        `game: trade: "${session.name}" accepted an invite that is no longer valid`,
      );
      return;
    }
    if (invite.inviterId !== inviterId) {
      this.options.log?.(
        `game: trade: "${session.name}" echoed ${inviterId}, but the pending invite is from ${invite.inviterId}`,
      );
    }
    const inviter = this.sessionsByCharacter.get(invite.inviterId);
    if (inviter === undefined) {
      this.trades.clearInvite(session.characterId);
      session.send(encodeMiniRoomRefused({ code: MINIROOM_REFUSAL.notFound }));
      return;
    }
    if (this.trades.roomOf(session.characterId) !== undefined) {
      this.trades.clearInvite(session.characterId);
      session.send(
        encodeMiniRoomRefused({
          code: MINIROOM_REFUSAL.busy,
          name: inviter.name,
        }),
      );
      return;
    }
    const room = this.trades.open(inviter, session);
    const participants = [
      this.tradeParticipant(inviter, 0),
      this.tradeParticipant(session, 1),
    ];
    inviter.send(
      encodeMiniRoomEnter({
        roomKind: MINIROOM_KIND.trade,
        myIndex: 0,
        participants,
      }),
    );
    session.send(
      encodeMiniRoomEnter({
        roomKind: MINIROOM_KIND.trade,
        myIndex: 1,
        participants,
      }),
    );
    this.options.log?.(
      `game: trade: ${room.id} opened - "${inviter.name}" and "${session.name}" are trading`,
    );
  }

  /** 放一格道具（c2s `type 11`）。道具本體不在封包裡，所以庫存是唯一的事實來源。 */
  private offerTradeItem(
    session: FieldSession,
    request: Extract<ClientMiniRoomRequest, { kind: "offerItem" }>,
  ): void {
    const room = this.trades.roomOf(session.characterId);
    if (room === undefined) return;
    const side = this.trades.sideOf(room, session.characterId);
    if (side === undefined || side.confirmed) return;
    if (!isTradeSlot(request.roomSlot)) {
      this.options.log?.(
        `game: trade: room slot ${request.roomSlot} is outside 1..8`,
      );
      return;
    }
    const inventory = session.character.items?.inventories[request.tab - 1];
    const item = inventory?.items.get(request.slot);
    if (item === undefined || tabOfItem(item.itemId) !== request.tab) {
      this.options.log?.(
        `game: trade: "${session.name}" offered tab ${request.tab} slot ${request.slot}, which holds nothing of that kind`,
      );
      return;
    }
    const count = request.count ?? 1;
    if (
      !Number.isInteger(count) ||
      (item.kind === "equip"
        ? count !== 1
        : Math.floor(item.itemId / 10000) === 207
          ? count !== item.quantity
          : count < 1 || item.quantity < count)
    ) {
      this.options.log?.(
        `game: trade: "${session.name}" offered ${count} of ${item.itemId}, which it does not have`,
      );
      return;
    }
    if (
      Math.floor(item.itemId / 10000) === 207 &&
      [...side.offers.values()].some(
        (offer) =>
          offer.tab === request.tab &&
          offer.slot === request.slot &&
          offer.roomSlot !== request.roomSlot,
      )
    )
      return;
    const shown = item.kind === "equip" ? item : { ...item, quantity: count };
    side.offers.set(request.roomSlot, {
      roomSlot: request.roomSlot,
      tab: request.tab,
      slot: request.slot,
      count,
      item: shown,
    });
    const index = room.sides.indexOf(side);
    const packet = encodeMiniRoomItem({
      index,
      roomSlot: request.roomSlot,
      item: shown,
    });
    for (const member of room.sides)
      this.sessionsByCharacter.get(member.characterId)?.send(packet);
    this.options.log?.(
      `game: trade: ${room.id} "${session.name}" put item ${item.itemId} x${count} in slot ${request.roomSlot}`,
    );
  }

  /** 放錢（c2s `type 12`）。超過自己身上的錢就忽略——伺服器不替玩家墊。 */
  private offerTradeMesos(session: FieldSession, amount: number): void {
    const room = this.trades.roomOf(session.characterId);
    if (room === undefined) return;
    const side = this.trades.sideOf(room, session.characterId);
    if (side === undefined || side.confirmed) return;
    if (amount > session.wallet.balance) {
      this.options.log?.(
        `game: trade: "${session.name}" offered ${amount} mesos but only has ${session.wallet.balance}`,
      );
      return;
    }
    side.mesos = amount;
    const packet = encodeMiniRoomMesos({
      index: room.sides.indexOf(side),
      amount,
    });
    for (const member of room.sides)
      this.sessionsByCharacter.get(member.characterId)?.send(packet);
  }

  /**
   * 確認（c2s `type 13`）。**兩邊都確認**才成交：先送 `type 13`（鎖定），再交換，最後 `type 8`。
   *
   * 成交的失敗（東西不在了、對面放不下）回 `type 8` 的 `4`（교환에 실패하였습니다），房間照樣關掉：
   * client 收到 1／3／4 都會把視窗關起來（`sub_4D3D70`）。
   */
  private confirmTrade(session: FieldSession): void {
    const room = this.trades.roomOf(session.characterId);
    if (room === undefined) return;
    const side = this.trades.sideOf(room, session.characterId);
    if (side === undefined) return;
    side.confirmed = true;
    const other = this.trades.otherSide(room, session.characterId);
    if (other === undefined || !other.confirmed) {
      this.options.log?.(
        `game: trade: ${room.id} "${session.name}" confirmed, waiting for the other side`,
      );
      return;
    }
    const sides = room.sides;
    const sessions = sides.map((member) =>
      this.sessionsByCharacter.get(member.characterId),
    );
    const [left, right] = sessions;
    if (left === undefined || right === undefined) {
      this.trades.close(room);
      return;
    }
    left.send(encodeMiniRoomLock());
    right.send(encodeMiniRoomLock());
    const before = [{ ...left.character.stats }, { ...right.character.stats }];
    const settlement = settleTrade(
      {
        offers: [...sides[0].offers.values()],
        mesos: sides[0].mesos,
        items: left.character.items ?? emptyCharacterItems(),
        wallet: left.wallet,
      },
      {
        offers: [...sides[1].offers.values()],
        mesos: sides[1].mesos,
        items: right.character.items ?? emptyCharacterItems(),
        wallet: right.wallet,
      },
    );
    this.trades.close(room);
    if (!settlement.ok) {
      this.options.log?.(
        `game: trade: ${room.id} failed - ${settlement.reason}`,
      );
      left.send(encodeMiniRoomFinish(TRADE_FINISH.failed));
      right.send(encodeMiniRoomFinish(TRADE_FINISH.failed));
      return;
    }
    left.character.items = settlement.items[0];
    right.character.items = settlement.items[1];
    const pair: Array<[FieldSession, number]> = [
      [left, 0],
      [right, 1],
    ];
    for (const [player, index] of pair) {
      const changes = settlement.changes[index];
      if (changes.length > 0) player.send(encodeInventoryChange(changes));
      const diff = diffStats(before[index]!, player.character.stats);
      if (Object.keys(diff).length > 0) player.send(encodeStatUpdate({ diff }));
      player.send(encodeMiniRoomFinish(TRADE_FINISH.done));
    }
    this.options.log?.(
      `game: trade: ${room.id} done - "${sides[0].name}" (${sides[0].offers.size} items, ${sides[0].mesos} mesos) ` +
        `<-> "${sides[1].name}" (${sides[1].offers.size} items, ${sides[1].mesos} mesos)`,
    );
  }

  /** 關窗／취소（c2s `type 7`）與下線：對面收到 `type 8` 的 `1`（상대방이 교환을 취소했습니다）。 */
  private leaveTrade(characterId: number, why: string): void {
    this.trades.clearInvite(characterId);
    const room = this.trades.roomOf(characterId);
    if (room === undefined) return;
    const other = this.trades.otherSide(room, characterId);
    this.trades.close(room);
    if (other === undefined) return;
    this.sessionsByCharacter
      .get(other.characterId)
      ?.send(encodeMiniRoomFinish(TRADE_FINISH.cancelled));
    this.options.log?.(`game: trade: ${room.id} cancelled (${why})`);
  }

  /**
   * 메신저（三人聊天室）：`0x24` → `0x4D`（FINDINGS §4.41）。
   *
   * 跟交易一樣是「開著的視窗」：進房之後才有意義。但**邀請可以跨地圖**——聊天室不在場地上，
   * 2003 的 client 也沒有「只邀同圖」的限制（`sub_4E1BB0` 直接跳模態，不像 `/교환` 要先用
   * `CUserPool` 找名字）。
   */
  private handleMessengerRequest(
    session: FieldSession,
    plain: Uint8Array,
  ): void {
    let request: ClientMessengerRequest;
    try {
      request = readClientMessengerRequest(new PacketReader(plain, 1));
    } catch (error) {
      this.options.log?.(
        `game: 0x24 messenger unreadable: ${(error as Error).message}`,
      );
      return;
    }
    this.options.log?.(`game: ${describeClientMessengerRequest(request)}`);
    switch (request.kind) {
      case "enter":
        this.enterMessenger(session, request.roomId);
        return;
      case "leave":
        this.leaveMessenger(session.characterId);
        return;
      case "command":
        this.inviteToMessenger(session, request.text);
        return;
      case "chat":
        this.sayInMessenger(session, request.line);
        return;
    }
  }

  /**
   * `0x24 type 0`：`roomId == 0` 是「開一間新房」，其他值是「進那一間」。
   *
   * 進別人的房間一定要有邀請：編號是伺服器給的 `u32`，沒有邀請就只是猜中號碼。進不去時回
   * `0x4D type 1`，client 印「- 초청 받은 대화방에 참가하지 못했습니다」。
   */
  private enterMessenger(session: FieldSession, roomId: number): void {
    if (this.messenger.roomOf(session.characterId) !== undefined) {
      // 已經在房間裡：client 自己不會送第二個 type 0，送了就是壞掉的狀態。
      this.options.log?.(
        `game: messenger: "${session.name}" is already in a room`,
      );
      return;
    }
    const member = { characterId: session.characterId, name: session.name };
    const room =
      roomId === 0
        ? this.messenger.create(member)
        : this.joinMessengerRoom(roomId, member);
    if (room === undefined) {
      session.send(encodeMessengerJoinFailed());
      this.options.log?.(
        `game: messenger: "${session.name}" could not enter room ${roomId}`,
      );
      return;
    }
    // 新進來的人要讓其他人（與自己）看到。`announce` 只有「剛進來」的那一格是 1：
    // `sub_4DF3E0` 用它決定要不要印「- '%s'님이 입장하셨습니다」——所以每個人（含剛進來的那個）
    // 都會在房間的訊息區看到那一行，跟自己開一間房時看到的一樣。
    const slot = room.members.findIndex(
      (entry) => entry.characterId === session.characterId,
    );
    const packets = this.messengerPackets(room, slot);
    for (const entry of room.members) {
      const recipient = this.sessionsByCharacter.get(entry.characterId);
      if (recipient === undefined) continue;
      for (const packet of packets) recipient.send(packet);
    }
    this.options.log?.(
      room.members.length === 1
        ? `game: messenger: room ${room.id} opened by "${session.name}"`
        : `game: messenger: "${session.name}" joined room ${room.id} (${room.members.length} member(s))`,
    );
  }

  /** 「進房間」的那一半：先查邀請，再交給 registry（房間存在、沒滿、這個人不在別的房間）。 */
  private joinMessengerRoom(
    roomId: number,
    member: { characterId: number; name: string },
  ): MessengerRoom | undefined {
    const invite = this.messenger.inviteOf(member.characterId, Date.now());
    if (invite === undefined || invite.roomId !== roomId) return undefined;
    return this.messenger.join(roomId, member);
  }

  /**
   * `0x24 type 3`：`/` 開頭的文字。`/q` 是 client 自己吃掉的，所以會到伺服器的只有別的指令。
   *
   * 這裡只認 `/초대 <名字>`（FINDINGS §4.41 的唯一指令）。🟡 client 送的是**整串文字**還是
   * **指令後面的名字**沒有直接證據（`sub_4E24B0` 把字串原樣塞進封包，但 `/q` 的比對是在
   * client 裡做的），所以兩種都收：有前綴就剝掉，沒有就當名字。
   */
  private inviteToMessenger(session: FieldSession, text: string): void {
    const room = this.messenger.roomOf(session.characterId);
    if (room === undefined) {
      this.options.log?.(
        `game: messenger: "${session.name}" has no room to invite into`,
      );
      return;
    }
    const name = messengerInviteTarget(text);
    if (name === "") {
      this.options.log?.(
        `game: messenger: "${session.name}" sent an incomplete invite "${text}"`,
      );
      return;
    }
    const target = this.sessionNamed(name);
    if (target === undefined) {
      session.send(
        encodeMessengerInviteResult({
          ok: MESSENGER_INVITE_RESULT.notFound,
          name,
        }),
      );
      this.options.log?.(
        `game: messenger: "${session.name}" invited "${name}": no such player`,
      );
      return;
    }
    session.send(
      encodeMessengerInviteResult({
        ok: MESSENGER_INVITE_RESULT.sent,
        name: target.name,
      }),
    );
    target.send(
      encodeMessengerInvite({ inviterName: session.name, roomId: room.id }),
    );
    this.messenger.invite(
      target.characterId,
      { roomId: room.id, inviterName: session.name },
      Date.now(),
    );
    this.options.log?.(
      `game: messenger: "${session.name}" invited "${target.name}" to room ${room.id}`,
    );
  }

  /**
   * `0x24 type 5`：一行聊天。
   *
   * **client 自己組好整行**：`sub_4DE490` 先用 `sub_418610(自己的名字)` ＋ `" : "` ＋ 輸入的文字
   * 組成一個字串，**先印在自己的訊息區**（`sub_4DEE50`）才送包。所以：
   *
   * 1. 伺服器收到的是 `"名字 : 內容"`，不是純文字；
   * 2. **不能回送給說話的人**——他已經在自己的畫面上看到了，再送一次會變成兩行。
   *
   * 名字的部分仍然以**伺服器認識的**那個名字為準：前綴被換掉，內容原樣保留（封包可以偽造）。
   */
  private sayInMessenger(session: FieldSession, line: string): void {
    const room = this.messenger.roomOf(session.characterId);
    if (room === undefined) {
      this.options.log?.(
        `game: messenger: "${session.name}" said "${line}" outside a room`,
      );
      return;
    }
    const separator = line.indexOf(" : ");
    const text = separator < 0 ? line : line.slice(separator + 3);
    const composed = `${session.name} : ${text}`;
    const packet = encodeMessengerChat(composed);
    for (const entry of room.members) {
      if (entry.characterId === session.characterId) continue;
      this.sessionsByCharacter.get(entry.characterId)?.send(packet);
    }
    this.options.log?.(`game: messenger: room ${room.id} "${composed}"`);
  }

  /**
   * 離開房間（`0x24 type 2`、視窗關掉、或斷線）。其他人收到 `0x4D type 2` + 那一格。
   *
   * 這裡**不送給離開的人**：他的視窗已經關了，而且 client 收到 type 2 只會把那一格清掉
   * （那一格是別人的名字）。房間因此空掉時 registry 直接把房間刪掉。
   */
  private leaveMessenger(characterId: number): void {
    const left = this.messenger.leave(characterId);
    if (left === undefined) return;
    const packet = encodeMessengerLeft(left.slot);
    for (const entry of left.room.members)
      this.sessionsByCharacter.get(entry.characterId)?.send(packet);
    this.options.log?.(
      `game: messenger: "${left.member.name}" left room ${left.room.id} (${left.room.members.length} left)`,
    );
  }

  /** 一間房的成員包（`0x4D type 0`）：每一格一個封包，**只有 `announceSlot` 那一格帶 announce**。 */
  private messengerPackets(
    room: MessengerRoom,
    announceSlot: number,
  ): Uint8Array[] {
    return room.members.map((entry, slot) =>
      encodeMessengerParticipant(
        this.messengerParticipant(entry.characterId, entry.name, slot),
        slot === announceSlot,
      ),
    );
  }

  /** 把一個 session 變成 `0x4D type 0` 的紀錄。 */
  private messengerParticipant(
    characterId: number,
    name: string,
    slot: number,
  ): MessengerParticipant {
    const target = this.sessionsByCharacter.get(characterId);
    return {
      slot,
      name,
      level: target?.character.stats.level ?? 1,
      face: target?.face ?? 0,
      look: target?.avatarItems ?? [],
    };
  }

  /**
   * 把一次離開（退隊或被踢）變成 `0x10`，送給還連著的人。
   *
   * 兩種封包：隊長走了是 `flag = 0`（`partyId` + 隊長 id，client 自己把隊伍歸零），其他人走是
   * `flag = 1` + `kicked` + 名字 + **更新後的名冊**。兩者都送給 `leave.members`（離開**之前**的
   * 名冊）——退隊的人也要收到，否則它的 client 不會清掉自己的 `partyId`；下線的人不在
   * `sessionsByCharacter` 裡，`?.send` 自然跳過。
   */
  private broadcastPartyLeave(
    leave: PartyLeave,
    kicked: boolean,
    why: string,
  ): void {
    if (leave.leaderLeft) {
      const ended = encodePartyResult({
        kind: "ended",
        partyId: leave.party.id,
        leaderId: leave.member.characterId,
      });
      for (const member of leave.members)
        this.sessionsByCharacter.get(member.characterId)?.send(ended);
      this.options.log?.(
        `game: party: ${leave.party.id} ended - "${leave.member.name}" was the leader (${why})`,
      );
      return;
    }
    const left = encodePartyResult({
      kind: "left",
      partyId: leave.party.id,
      characterId: leave.member.characterId,
      kicked,
      name: leave.member.name,
      members: leave.remaining,
    });
    for (const member of leave.members)
      this.sessionsByCharacter.get(member.characterId)?.send(left);
    this.options.log?.(
      `game: party: "${leave.member.name}" ${kicked ? "was kicked from" : "left"} ${leave.party.id} ` +
        `[${leave.remaining.map((member) => member.name).join(", ")}] (${why})`,
    );
  }

  /** 下線的路徑：先把邀請丟掉（沒有離線的邀請），再走跟 `/파티탈퇴` 一樣的離開。 */
  private leaveParty(characterId: number, why: string): void {
    this.parties.dropInvite(characterId);
    const leave = this.parties.leave(characterId);
    if (leave === undefined) return;
    this.broadcastPartyLeave(leave, false, why);
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
    const wanted = foldByteName(name);
    for (const session of this.sessionsByCharacter.values()) {
      if (foldByteName(session.name) === wanted) return session;
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
      this.options.log?.(
        `game: 0x0E move unreadable: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * The character record to send back in `0x16`: the login server's own record with the map id
 * replaced. A handoff issued without a record (tests, tooling) gets a minimal but complete one.
 */
function withMapId(
  entry: HandoffEntry,
  fallbackMapId: number,
  hasMapZero = false,
): CharacterData {
  if (entry.character) {
    // A character's own `mapId` is where they were when they left: the record is the truth for the
    // map the same way it is for level and mesos, and it is the only field `sub_4C2780` reads to pick
    // the map (FINDINGS 4.11.2b). Zero is a REAL map in Data.wz. Only retain the old
    // map-zero fallback for archive-free/tooling providers which cannot load that map.
    //
    // The record is used **as it is**, not copied: this is the same object the account table holds
    // (`LoginServerOptions.accounts`), the field then mutates it in place (exp, hp, items, mesos,
    // `mapId` when a portal moves them), and `persist` saves that one object when the session ends.
    // A copy would mean two records with one name, and only one of them would ever be saved.
    const character = entry.character;
    if (character.stats.mapId === 0 && !hasMapZero)
      character.stats.mapId = fallbackMapId;
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
/**
 * `/초대 <名字>` → 名字。
 *
 * 🟡 `sub_4E24B0` 把 `/` 開頭的文字原樣塞進 `0x24 type 3`，但 `/q` 的比對是在 client 自己身上做的，
 * 所以「client 有沒有先剝掉指令」看不出來。兩種都收：有指令前綴就剝掉，沒有就當名字；
 * 只有指令、沒有名字時回空字串（呼叫端記一行，不回封包）。
 */
function messengerInviteTarget(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return trimmed;
  const rest = trimmed.slice(1).trim();
  const space = rest.search(/\s/);
  return space < 0 ? "" : rest.slice(space).trim();
}

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
 * WZ newDlg labels and sub_430690 establish STR/DEX/INT/LUK; these words are also applied at create.
 */
function describeLookWords(appearance: readonly number[]): string {
  const word = (index: number): number => appearance[index] ?? 0;
  const clothes = [
    LOOK_WORD.clothes,
    LOOK_WORD.pants,
    LOOK_WORD.shoes,
    LOOK_WORD.weapon,
  ].map(word);
  const dice: number[] = [];
  for (let index = LOOK_WORD.dice; index < LOOK_WORDS; index++)
    dice.push(word(index));
  return (
    `face ${word(LOOK_WORD.face)}, hair ${word(LOOK_WORD.hair)} ` +
    `clothes ${clothes.join("/")}, dice ${dice.join("/")}`
  );
}

/** What of the look words reached the record: the worn group the client draws the avatar from. */
function describeWorn(character: CharacterData): string {
  const entries =
    character.items === undefined ? [] : [...character.items.worn];
  const worn = entries
    .sort((a, b) => a[0] - b[0])
    .map(([slot, item]) => `${slot}:${item.itemId}`);
  return worn.length > 0 ? `wearing ${worn.join(" ")}` : "wearing nothing";
}

/** The two facts a party roster stores about a player (FINDINGS 4.37). */
function partyMemberOf(session: FieldSession): PartyMember {
  return { characterId: session.characterId, name: session.name };
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
