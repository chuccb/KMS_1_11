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
 *   - persistence: accounts and characters live in memory, so a restart forgets them;
 *   - the in-game stage (CField, opcodes 0x15-0x52): not decoded yet;
 *   - the CharacterData item block (30 equip slots + 4 inventories), so created characters are
 *     stat-only - the client accepts that (`flags = 1`, FINDINGS 4.9).
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
import { encodeMobEnterField } from "../protocol/mob.ts";
import type { MapData } from "../game/map.ts";
import { decodeClientPacket, describeClientPacket, CLIENT_OPCODE } from "../protocol/login.ts";
import { describeClientFieldPacket, encodeSetField, type SetField } from "../protocol/field.ts";
import {
  LOGIN_RESULT,
  NAME_CHECK_RESULT,
  encodeCreateCharacterResult,
  encodeDeleteCharacterResult,
  encodeLoginResult,
  encodeNameCheckResult,
  encodeSelectCharacterResult,
  encodeWorldSelectResult,
  type WorldEntry,
} from "../protocol/replies.ts";
import {
  characterDataOf,
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
   * Map id stored in the `CharacterData` of a newly created character. It is the same field the
   * `0x16` packet uses to enter a map (FINDINGS 4.11.2b), so keeping the two equal means the
   * record the client holds matches the map it is about to enter. Defaults to `DEFAULT_MAP_ID`.
   */
  startMapId?: number;
  /** Cipher seeds and handshake body. Defaults: random seeds, 199 zero bytes. */
  handshake?: { clientSendSeed?: number; clientRecvSeed?: number; body?: Uint8Array };
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
  private readonly options: LoginServerOptions;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private listenPort = 0;

  constructor(options: LoginServerOptions) {
    this.options = options;
    this.handoffs = options.handoffs ?? new HandoffRegistry();
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
   */
  createCharacter(
    id: number,
    name: string,
    appearance: number[],
    template?: CharacterStats,
    items?: CharacterItems,
  ): CharacterData {
    void appearance; // the 10 words of 0x06 are logged; their stat mapping is not proven yet
    if (template) {
      const stats: CharacterStats = {
        ...template,
        id,
        name,
        hp: template.maxHp,
        mp: template.maxMp,
      };
      return characterDataOf(stats, items);
    }
    const stats = zeroStats();
    stats.id = id;
    stats.name = name;
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
    return characterDataOf(stats, items);
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
        if (!account || account.password !== packet.password) {
          this.log(`  login refused for "${packet.username}"`);
          this.reply(socket, sendState, encodeLoginResult(LOGIN_RESULT.wrongCredentials));
          return;
        }
        state.stage = "world";
        state.username = packet.username;
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
        this.reply(socket, sendState, encodeWorldSelectResult(LOGIN_RESULT.ok, account.characters.slice(0, 3)));
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
            `(appearance hint: ${packet.appearance.join(",")})`,
        );
        return;
      }

      case "create-character": {
        if (state.stage !== "char" || state.username === undefined) return;
        const account = this.options.accounts.get(state.username);
        if (!account) return;
        if (account.characters.length >= 3) {
          this.log(`  create refused: "${state.username}" already has three characters`);
          this.reply(socket, sendState, encodeCreateCharacterResult(LOGIN_RESULT.cannotConnect));
          return;
        }
        if (this.nameTaken(packet.name)) {
          this.log(`  create refused: the name "${packet.name}" is taken`);
          this.reply(socket, sendState, encodeCreateCharacterResult(LOGIN_RESULT.wrongCredentials));
          return;
        }
        const template = account.characters[0]?.stats;
        const created = this.createCharacter(nextCharacterId(account.characters), packet.name, state.appearanceHint ?? [], template);
        account.characters.push(created);
        this.reply(socket, sendState, encodeCreateCharacterResult(LOGIN_RESULT.ok, created));
        this.log(`  created "${created.stats.name}" (id ${created.stats.id})`);
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
        return;
      }

      case "echo":
        this.log("  note: echo reply (the client's answer to a server-side 0x08 heartbeat)");
        return;

      case "unknown":
        this.log(`  note: unmapped opcode kept as ${packet.body.length} raw byte(s)`);
        return;
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
 * Mobs, skills and drops are still unknown (FINDINGS 6), so the connection says nothing else.
 */
export interface GameEntryServerOptions {
  handoffs: HandoffRegistry;
  handshake?: { clientSendSeed?: number; clientRecvSeed?: number; body?: Uint8Array };
  /** Map the claimer is moved into (`0x16`). Defaults to `DEFAULT_MAP_ID`. */
  mapId?: number;
  /**
   * Where the map's monsters come from. `mapDataProvider(WzArchive)` is the real one; tests pass a
   * stub. Without it the connection still enters its map, it just has nothing to spawn.
   */
  mapProvider?: (mapId: number) => MapData | undefined;
  log?(line: string): void;
}

export class GameEntryServer {
  private readonly options: GameEntryServerOptions;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private listenPort = 0;

  constructor(options: GameEntryServerOptions) {
    this.options = options;
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
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** The map this server puts claimers into (`0x16`). */
  private get mapId(): number {
    return this.options.mapId ?? DEFAULT_MAP_ID;
  }

  /**
   * Sends `0x16` so the client enters a map.
   *
   * The `full` form is used (three seed parts + a whole `CharacterData`) because that is the form
   * that carries the map id; the seeds are the server's choice, and they decide every "random"
   * number the client will roll afterwards (FINDINGS 4.11.2).
   */
  private enterField(socket: net.Socket, sendState: CipherState, entry: HandoffEntry): void {
    const character = withMapId(entry, this.mapId);
    const field: SetField = {
      mode: 0,
      full: true,
      randomSeedA: randomSeed(),
      randomSeedB: randomSeed(),
      randomSeedC: randomSeed(),
      character,
    };
    socket.write(encodeSessionPacket(encodeSetField(field), sendState, "s2c"));
    this.options.log?.(
      `game: sent 0x16 - "${entry.characterName}" enters map ${this.mapId} ` +
        `(seeds 0x${hex(field.randomSeedA)} 0x${hex(field.randomSeedB)} 0x${hex(field.randomSeedC)})`,
    );
    this.spawnMobs(socket, sendState);
  }

  /**
   * Puts the map's monsters on screen: one `0x2F` per `life` entry of the map (FINDINGS 4.15).
   *
   * The object ids are this server's choice - the client only needs them unique inside the field
   * (`sub_492C00` is a pool lookup by that id) - so they are handed out from 1 per connection.
   * Nothing was found that makes them collide with player ids: players are keyed in `CUserPool`,
   * mobs in `CMobPool`.
   *
   * The packets are written right after `0x16` and in the same TCP stream, which assumes the client
   * finishes building the field before it reads the next packet (the 0x16 handler loads
   * `Map/Map/%09d.img` synchronously, so it should). Whether that holds for a real client is one of
   * the things the oracle run (ADR-004) has to confirm.
   *
   * Because there is no shared world yet (ADR-001 is still ahead), each connection gets its *own*
   * copy of the map's mobs and its own id sequence: two players in one field would each see a full
   * set of monsters and would not see each other's. A per-field registry that owns the ids (and the
   * hit points) is the Phase 2 step that turns this into one world.
   */
  private spawnMobs(socket: net.Socket, sendState: CipherState): void {
    const map = this.options.mapProvider?.(this.mapId);
    if (map === undefined) {
      if (this.options.mapProvider !== undefined) {
        this.options.log?.(`game: map ${this.mapId} has no Map/Map/*.img in Data.wz, nothing to spawn`);
      }
      return;
    }
    let mobId = 1;
    for (const spawn of map.mobs) {
      const body = {
        mobId: mobId++,
        templateId: spawn.templateId,
        x: spawn.x,
        y: spawn.y,
        facing: spawn.facing,
      };
      socket.write(encodeSessionPacket(encodeMobEnterField(body), sendState, "s2c"));
    }
    this.options.log?.(
      `game: spawned ${map.mobs.length} mobs (${map.name || map.imagePath}); ` +
        `${map.npcs.length} NPCs are known but not spawned yet`,
    );
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
    socket.on("data", (chunk) => {
      for (const event of deframer.push(new Uint8Array(chunk))) {
        if (event.kind !== "packet") continue;
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
          entered = true;
          this.enterField(socket, sendState, entry);
          continue;
        }
        this.options.log?.(
          `game: ${describeClientFieldPacket(event.plain) ?? `op=0x${hex(packet.opcode)} (unmapped)`}`,
        );
      }
    });
    socket.on("error", () => this.sockets.delete(socket));
    socket.on("close", () => this.sockets.delete(socket));
  }
}

/**
 * The character record to send back in `0x16`: the login server's own record with the map id
 * replaced. A handoff issued without a record (tests, tooling) gets a minimal but complete one.
 */
function withMapId(entry: HandoffEntry, mapId: number): CharacterData {
  if (entry.character) return { ...entry.character, stats: { ...entry.character.stats, mapId } };
  const stats = zeroStats();
  stats.id = entry.characterId;
  stats.name = entry.characterName;
  stats.level = 1;
  stats.hp = 50;
  stats.maxHp = 50;
  stats.mp = 50;
  stats.maxMp = 50;
  stats.mapId = mapId;
  return characterDataOf(stats);
}

/** A non-zero u32 for the handshake seeds. */
function randomSeed(): number {
  return ((Math.random() * 0xffffffff) >>> 0) | 1;
}

/** Character ids are local to an account in this stub (there is no database yet). */
function nextCharacterId(characters: CharacterData[]): number {
  let max = 0;
  for (const entry of characters) max = Math.max(max, entry.stats.id);
  return max + 1;
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
