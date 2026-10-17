/**
 * The client half of the 2003 protocol, running in Node.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 3 ("a client") needs something that speaks the wire format. The 2003 binary cannot run here
 * (Windows, 2003, DirectX 8), and a browser cannot open a raw TCP socket, so anything playable in a
 * browser needs a process in the middle that owns the connection: this module is that process's
 * client half. It is exactly the sequence `test/loginflow.test.ts` walks by hand, turned into an
 * object:
 *
 *   connect -> 211-byte handshake (the seeds are inside it) -> 0x01 login
 *           -> 0x02 world select -> 0x03 character select -> a second connection -> 0x04 handoff
 *           -> 0x16 set field -> the field stream
 *
 * It knows nothing about HTTP or browsers; `net/webclient.ts` is the transport adapter that turns
 * its events into JSON for `client/`. Keeping every protocol detail on this side is what makes the
 * browser client testable without a browser: `test/clientsession.test.ts` drives two of these
 * against the real `LoginServer`/`GameEntryServer` over real sockets.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not the 2003 client. It does not draw, roll damage, run the mob AI, or own an inventory -
 * the 2003 client does those itself (FINDINGS 4.20). It reads only the packets a view needs and
 * reports the rest as `unknown`, so a packet this build does not understand shows up in the
 * browser's log instead of disappearing.
 *
 * ONE DELIBERATE OMISSION: the `0x03` reply carries the game server's address (`sub_432FB0` builds a
 * `sockaddr` out of it), and a browser could never use that address. The adapter is therefore given
 * the real game port up front and connects there; which character to claim still comes from the
 * reply, because that id is what the game server looks the handoff up by.
 */
import net from "node:net";
import { CipherState, SERVER_SEND_MAGIC } from "../protocol/cipher.ts";
import { encodeSessionPacket, SessionDeframer } from "../protocol/session.ts";
import { encodeClientPacket } from "../protocol/login.ts";
import { PacketReader } from "../protocol/packet.ts";
import { LOGIN_OPCODE, LOGIN_RESULT, type WorldEntry } from "../protocol/replies.ts";
import { readCharacterData, type CharacterData } from "../protocol/chardata.ts";
import {
  FIELD_OPCODE,
  encodeClientChat,
  encodeClientUserMove,
  readSetField,
  readUserChat,
  readUserEffect,
  readUserEmotion,
  readUserEnterField,
  readUserMove,
  USER_MESSAGE_CHAT,
} from "../protocol/field.ts";
import {
  MOB_OPCODE,
  readMobEnterField,
  readMobLeaveDelayed,
  readMobMove,
  readMobPresence,
} from "../protocol/mob.ts";
import { NPC_OPCODE, readNpcEnterField, readNpcId } from "../protocol/npc.ts";
import { STAT_OPCODE, readStatUpdate, type StatDiff } from "../protocol/stat.ts";
import type { MovePath } from "../protocol/movepath.ts";

/** What a view needs to know about the character the connection belongs to. */
export interface SelfView {
  characterId: number;
  name: string;
  level: number;
  job: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  exp: number;
  mesos: number;
  mapId: number;
  face: number;
  hair: number;
  avatarItems: number[];
}

/** Another player in the field. */
export interface UserView {
  characterId: number;
  name: string;
  face: number;
  avatarItems: number[];
  x: number;
  y: number;
  action: number;
  foothold: number;
}

export interface MobView {
  mobId: number;
  templateId: number;
  x: number;
  y: number;
  facing: number;
}

export interface NpcView {
  npcId: number;
  templateId: number;
  x: number;
  y: number;
  facing: number;
}

/**
 * Everything the field stream can mean to a view. The `unknown` case carries the opcode and the
 * body, so an unimplemented packet is a log line rather than a mystery.
 */
export type ClientEvent =
  | {
      kind: "field";
      mapId: number;
      self: SelfView;
      users: UserView[];
      mobs: MobView[];
      npcs: NpcView[];
    }
  | { kind: "self"; self: SelfView }
  | { kind: "user-enter"; user: UserView }
  | { kind: "user-leave"; characterId: number }
  | { kind: "user-move"; characterId: number; x: number; y: number; action: number; foothold: number }
  | { kind: "user-emotion"; characterId: number; emotion: number }
  | { kind: "chat"; name: string; text: string }
  | { kind: "level-up"; characterId: number }
  | { kind: "mob-enter"; mob: MobView }
  | { kind: "mob-move"; mobId: number; x: number; y: number }
  | { kind: "mob-leave"; mobId: number }
  | { kind: "npc-enter"; npc: NpcView }
  | { kind: "npc-leave"; npcId: number }
  | { kind: "unknown"; opcode: number; bytes: number }
  | { kind: "disconnect"; reason: string };

/** The three replies of the login chain, in the order they arrive. */
export interface LoginReply {
  result: number;
  /** Present only when `result` is `ok`; the client stores all three (FINDINGS 4.8). */
  worlds: WorldEntry[];
}

export interface CharacterListReply {
  result: number;
  characters: CharacterData[];
}

export interface CharacterSelectReply {
  result: number;
  ip: string;
  port: number;
  characterId: number;
}

export interface ClientSessionOptions {
  host?: string;
  loginPort: number;
  /**
   * Where the game server is. The `0x03` reply also names one, and that is the value the 2003
   * client uses; an adapter that cannot reach it (a browser origin, or a server started with
   * `--game-ip 0.0.0.0`) overrides it here.
   */
  gameHost?: string;
  gamePort?: number;
  /** One line per connection-level event; defaults to nothing. */
  log?(line: string): void;
  /** How long a login reply may take. Field packets have no timeout. */
  replyTimeoutMs?: number;
}

/** A reply that never came, or one that came with an unexpected opcode. */
export class ClientTimeoutError extends Error {}

/**
 * One TCP connection with the session framing on top: `u16 header + u16 length + encrypted body`
 * (FINDINGS 3). The 211-byte handshake arrives first and seeds the cipher, so nothing may be sent
 * before it has been read - `send` waits for that.
 */
class Link {
  private readonly socket: net.Socket;
  private readonly deframer = new SessionDeframer({ expectedMagic: SERVER_SEND_MAGIC });
  private sendState = new CipherState(0);
  private readonly queue: Uint8Array[] = [];
  private waiter: (() => void) | undefined;
  private closeReason: string | undefined;
  private readonly onPacket: (plain: Uint8Array) => void;
  private readonly onClose: (reason: string) => void;
  readonly handshakeDone: Promise<void>;
  private markHandshake!: () => void;

  constructor(port: number, host: string, onPacket: (plain: Uint8Array) => void, onClose: (reason: string) => void) {
    this.onPacket = onPacket;
    this.onClose = onClose;
    this.handshakeDone = new Promise<void>((resolve) => {
      this.markHandshake = resolve;
    });
    this.socket = net.connect(port, host);
    this.socket.on("data", (chunk) => this.receive(new Uint8Array(chunk)));
    this.socket.on("error", (error) => this.fail((error as Error).message));
    this.socket.on("close", () => this.fail(this.closeReason ?? "the connection closed"));
  }

  private receive(chunk: Uint8Array): void {
    for (const event of this.deframer.push(chunk)) {
      if (event.kind === "handshake") {
        // The client's send state is seeded by the handshake's first seed (sub_43A410).
        this.sendState = new CipherState(event.handshake.sendSeed);
        this.markHandshake();
        continue;
      }
      // A field connection streams: hand the packet over immediately. The login stage is strictly
      // request/reply, so its packets wait in the queue instead.
      if (this.streams) this.onPacket(event.plain);
      else {
        this.queue.push(event.plain);
        this.waiter?.();
      }
    }
  }

  /** Set once the field has been entered; see `receive`. */
  streams = false;

  private fail(reason: string): void {
    if (this.closeReason === reason) return;
    this.closeReason = reason;
    this.markHandshake();
    this.waiter?.();
    this.onClose(reason);
  }

  error(): string | undefined {
    return this.closeReason;
  }

  async send(packet: Uint8Array): Promise<void> {
    await this.handshakeDone;
    if (this.closeReason !== undefined) throw new Error(this.closeReason);
    // A client writes the `0xD3` magic, not the server's `0xFF2C` (session.ts, `magicFor`).
    this.socket.write(encodeSessionPacket(packet, this.sendState, "c2s"));
  }

  /** Waits for the next packet with `opcode`, dropping the ones that do not match. */
  async take(opcode: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex((plain) => plain[0] === opcode);
      if (index >= 0) return this.queue.splice(index, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new ClientTimeoutError(
          `no 0x${opcode.toString(16)} within ${timeoutMs} ms` +
            (this.closeReason === undefined ? "" : ` (${this.closeReason})`),
        );
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        setTimeout(resolve, Math.min(20, left));
      });
    }
  }

  /** Empties the login-stage queue; see `enterGame`. */
  drainQueue(): Uint8Array[] {
    return this.queue.splice(0, this.queue.length);
  }

  close(): void {
    this.socket.destroy();
  }
}

/**
 * Reads the `0x03` reply's address. It is stored as a u32 in **network** order because the client
 * copies the four bytes into `sockaddr_in.sin_addr` (see `ipv4WireValue`).
 */
function readRedirectIp(reader: PacketReader): string {
  const value = reader.readU32();
  return `${value & 0xff}.${(value >>> 8) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 24) & 0xff}`;
}

/**
 * The item ids the character is wearing, which is what the `0x1C` look list carries for everybody
 * else (`sub_45F340` files them by id). The local character's list is built the same way so the view
 * can draw both from one shape; a slot the record does not have simply contributes nothing.
 */
function wornItemIds(character: CharacterData): number[] {
  const worn = character.items?.worn;
  if (worn === undefined) return [];
  return [...worn.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => slot.itemId)
    .filter((itemId) => itemId !== 0);
}

function selfOf(character: CharacterData): SelfView {
  const stats = character.stats;
  return {
    characterId: stats.id,
    name: stats.name,
    level: stats.level,
    job: stats.job,
    hp: stats.hp,
    maxHp: stats.maxHp,
    mp: stats.mp,
    maxMp: stats.maxMp,
    exp: stats.exp,
    mesos: stats.mesos,
    mapId: stats.mapId,
    face: stats.appearanceA,
    hair: stats.appearanceB,
    avatarItems: wornItemIds(character),
  };
}

/**
 * The state machine the adapter drives.
 *
 * The login half is request/reply and throws on anything that is not the expected answer; the field
 * half is a stream and never throws - a packet the view cannot use becomes an `unknown` event or a
 * log line, because one malformed monster must not end the session.
 */
export class ClientSession {
  private readonly options: ClientSessionOptions;
  private readonly host: string;
  private link: Link | undefined;
  private gameLink: Link | undefined;
  private readonly listeners: ((event: ClientEvent) => void)[] = [];
  private readonly timeoutMs: number;
  private self: SelfView | undefined;
  private mapId = 0;
  private readonly users = new Map<number, UserView>();
  private readonly mobs = new Map<number, MobView>();
  private readonly npcs = new Map<number, NpcView>();
  private latest: CharacterData | undefined;

  constructor(options: ClientSessionOptions) {
    this.options = options;
    this.host = options.host ?? "127.0.0.1";
    this.timeoutMs = options.replyTimeoutMs ?? 5000;
  }

  /** Subscribes to field events. Returns an unsubscribe function. */
  onEvent(listener: (event: ClientEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  private emit(event: ClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  /** The world list the `0x01` reply carried (empty before a successful login). */
  async login(username: string, password: string): Promise<LoginReply> {
    this.link = new Link(this.options.loginPort, this.host, () => undefined, (reason) =>
      this.log(`login link closed: ${reason}`),
    );
    await this.link.handshakeDone;
    await this.link.send(encodeClientPacket({ kind: "login-request", opcode: LOGIN_OPCODE.login, username, password }));
    const reply = await this.link.take(LOGIN_OPCODE.login, this.timeoutMs);
    const reader = new PacketReader(reply, 1);
    const result = reader.readByte();
    if (result !== LOGIN_RESULT.ok) return { result, worlds: [] };
    reader.readU32(); // app4 (the client keeps it at CWvsApp+4; no use here)
    reader.readByte(); // app8
    reader.readByte(); // app9, the account's gender bit
    const count = reader.readByte();
    const worlds: WorldEntry[] = [];
    for (let i = 0; i < count; i++) {
      worlds.push({ name: reader.readAsciiString(), unknownId: reader.readU32() });
    }
    return { result, worlds };
  }

  /** `0x02`. Returns the (at most three) characters the account has in that world. */
  async selectWorld(worldId: number): Promise<CharacterListReply> {
    const link = this.requireLink();
    await link.send(encodeClientPacket({ kind: "world-select", opcode: LOGIN_OPCODE.worldSelect, worldId }));
    const reply = await link.take(LOGIN_OPCODE.worldSelect, this.timeoutMs);
    const reader = new PacketReader(reply, 1);
    const result = reader.readByte();
    if (result !== LOGIN_RESULT.ok) return { result, characters: [] };
    const count = reader.readByte();
    const characters: CharacterData[] = [];
    for (let i = 0; i < count; i++) characters.push(readCharacterData(reader));
    return { result, characters };
  }

  /** `0x03`: asks to enter the game with that character. */
  async selectCharacter(characterId: number): Promise<CharacterSelectReply> {
    const link = this.requireLink();
    await link.send(
      encodeClientPacket({ kind: "select-character", opcode: LOGIN_OPCODE.selectCharacter, characterId }),
    );
    const reply = await link.take(LOGIN_OPCODE.selectCharacter, this.timeoutMs);
    const reader = new PacketReader(reply, 1);
    const result = reader.readByte();
    if (result !== LOGIN_RESULT.ok) return { result, ip: "", port: 0, characterId: 0 };
    const ip = readRedirectIp(reader);
    const port = reader.readU16();
    const id = reader.readU32();
    return { result, ip, port, characterId: id };
  }

  /**
   * Opens the game connection and claims the handoff: `0x04` carries the character id the login
   * server put in its `0x03` reply (`CWvsApp+0x14`, FINDINGS 4.9).
   *
   * Resolves once the `0x16` that moves the client into a field has been read - i.e. once the
   * session is really in the game - and emits `field` with the snapshot that came with it.
   */
  async enterGame(redirect: CharacterSelectReply): Promise<void> {
    const port = this.options.gamePort ?? redirect.port;
    const host = this.options.gameHost ?? redirect.ip;
    this.link?.close();
    this.link = undefined;
    const link = new Link(
      port,
      host,
      (plain) => this.handleFieldPacket(plain),
      (reason) => this.emit({ kind: "disconnect", reason }),
    );
    this.gameLink = link;
    await link.handshakeDone;
    await link.send(
      encodeClientPacket({ kind: "handshake-reply", opcode: 0x04, value: redirect.characterId }),
    );
    const first = await link.take(FIELD_OPCODE.setField, this.timeoutMs);
    link.streams = true;
    // Anything that arrived between the 0x16 and this line is still in the queue (the login stage's
    // `take` only removes what it matches); the field's own packets must not be stranded there.
    for (const pending of link.drainQueue()) this.handleFieldPacket(pending);
    this.handleFieldPacket(first);
  }

  private requireLink(): Link {
    if (this.link === undefined) throw new Error("login() must succeed before this call");
    return this.link;
  }

  /** The character list entry the client picked, for the adapter's own bookkeeping. */
  remember(character: CharacterData): void {
    this.latest = character;
  }

  /** The last snapshot itself, for callers that want more than the view. */
  get character(): CharacterData | undefined {
    return this.latest;
  }

  /** Sends a field chat line. The 2003 client writes CP949; the adapter pre-encodes. */
  async say(text: Uint8Array): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("say() needs a session in a field");
    await link.send(encodeClientChat({ text }));
  }

  /**
   * Walks to `(x, y)`. One `CMovePath` element: the server trusts the first element's position
   * (`FieldInstance.reportMove`), and the browser view does not animate, so a one-leg path is the
   * honest minimum. `action` 0 = stand; the real client's stance table is client-side data.
   */
  async moveTo(x: number, y: number, foothold = 0, duration = 100): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("moveTo() needs a session in a field");
    const path: MovePath = {
      originX: x,
      originY: y,
      elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold, duration }],
    };
    await link.send(encodeClientUserMove({ stageByte: 0, path }));
    const self = this.self;
    if (self !== undefined) {
      // The server does not echo a move back to the mover, so the local view moves itself - the same
      // thing the 2003 client does before it sends (`CVecCtrlUser::OnMove` applied it locally).
      this.emit({ kind: "user-move", characterId: self.characterId, x, y, action: 0, foothold });
    }
  }

  close(): void {
    this.gameLink?.close();
    this.link?.close();
    this.gameLink = undefined;
    this.link = undefined;
  }

  private handleFieldPacket(plain: Uint8Array): void {
    if (plain.length === 0) return;
    const opcode = plain[0]!;
    try {
      switch (opcode) {
        case FIELD_OPCODE.setField: {
          const field = readSetField(new PacketReader(plain, 1));
          this.latest = field.character;
          this.self = selfOf(field.character);
          this.mapId = field.character.stats.mapId;
          this.users.clear();
          this.mobs.clear();
          this.npcs.clear();
          this.emit({
            kind: "field",
            mapId: this.mapId,
            self: this.self,
            users: [],
            mobs: [],
            npcs: [],
          });
          return;
        }
        case FIELD_OPCODE.userEnterField: {
          const enter = readUserEnterField(new PacketReader(plain, 1));
          const user: UserView = {
            characterId: enter.characterId,
            name: enter.name,
            face: enter.face,
            avatarItems: enter.avatarItems,
            x: enter.x,
            y: enter.y,
            action: enter.action,
            foothold: enter.foothold,
          };
          this.users.set(user.characterId, user);
          this.emit({ kind: "user-enter", user });
          return;
        }
        case FIELD_OPCODE.userLeaveField: {
          const characterId = new PacketReader(plain, 1).readU32();
          this.users.delete(characterId);
          this.emit({ kind: "user-leave", characterId });
          return;
        }
        case FIELD_OPCODE.userMove: {
          const move = readUserMove(new PacketReader(plain, 1));
          const first = move.path.elements[0];
          if (first === undefined) return;
          const user = this.users.get(move.characterId);
          if (user !== undefined) Object.assign(user, { x: first.x, y: first.y, action: first.action, foothold: first.foothold });
          this.emit({
            kind: "user-move",
            characterId: move.characterId,
            x: first.x,
            y: first.y,
            action: first.action,
            foothold: first.foothold,
          });
          return;
        }
        case FIELD_OPCODE.userEmotion: {
          const emotion = readUserEmotion(new PacketReader(plain, 1));
          this.emit({ kind: "user-emotion", characterId: emotion.characterId, emotion: emotion.emotion });
          return;
        }
        case FIELD_OPCODE.userEffect: {
          const effect = readUserEffect(new PacketReader(plain, 1));
          this.emit({ kind: "level-up", characterId: effect.characterId });
          return;
        }
        case FIELD_OPCODE.userMessage: {
          const subOp = plain[1];
          if (subOp !== USER_MESSAGE_CHAT) {
            this.emit({ kind: "unknown", opcode, bytes: plain.length });
            return;
          }
          const chat = readUserChat(new PacketReader(plain, 1));
          this.emit({ kind: "chat", name: chat.name, text: decodeChatText(chat.text) });
          return;
        }
        case STAT_OPCODE: {
          const update = readStatUpdate(new PacketReader(plain, 1));
          this.applyStats(update.diff);
          return;
        }
        case MOB_OPCODE.enterField: {
          const mob = readMobEnterField(new PacketReader(plain, 1));
          const view: MobView = {
            mobId: mob.mobId,
            templateId: mob.templateId,
            x: mob.x,
            y: mob.y,
            facing: mob.facing,
          };
          this.mobs.set(view.mobId, view);
          this.emit({ kind: "mob-enter", mob: view });
          return;
        }
        case MOB_OPCODE.move: {
          const move = readMobMove(new PacketReader(plain, 1));
          const last = move.body.path.elements.at(-1);
          if (last === undefined) return;
          const mob = this.mobs.get(move.mobId);
          if (mob !== undefined) Object.assign(mob, { x: last.x, y: last.y });
          this.emit({ kind: "mob-move", mobId: move.mobId, x: last.x, y: last.y });
          return;
        }
        case MOB_OPCODE.leaveDelayed: {
          // 0x30 starts the die animation; 0x31 removes the mob. The view just drops it when the
          // pool does, but a 0x30 with no 0x31 (a mob that is already dying) is still a removal.
          const leave = readMobLeaveDelayed(new PacketReader(plain, 1));
          if (leave.delayMs < 0) this.removeMob(leave.mobId);
          return;
        }
        case MOB_OPCODE.presence: {
          const presence = readMobPresence(new PacketReader(plain, 1));
          if (presence.flag === 0) this.removeMob(presence.mobId);
          return;
        }
        case NPC_OPCODE.enterField: {
          // The client itself decides which form it is by whether the pool already has the id
          // (`sub_49F6C0`); the reader takes that answer instead of guessing from the bytes.
          const npcId = new PacketReader(plain, 1).readU32();
          const npc = readNpcEnterField(new PacketReader(plain, 1), this.npcs.has(npcId));
          if (npc.templateId === undefined) return; // a refresh of one the view already has
          const view: NpcView = {
            npcId: npc.npcId,
            templateId: npc.templateId,
            x: npc.x,
            y: npc.y,
            facing: npc.facing,
          };
          this.npcs.set(view.npcId, view);
          this.emit({ kind: "npc-enter", npc: view });
          return;
        }
        case NPC_OPCODE.leaveField: {
          const npcId = readNpcId(new PacketReader(plain, 1));
          this.npcs.delete(npcId);
          this.emit({ kind: "npc-leave", npcId });
          return;
        }
        default:
          this.emit({ kind: "unknown", opcode, bytes: plain.length });
          return;
      }
    } catch (error) {
      this.log(`0x${opcode.toString(16)}: ${(error as Error).message}`);
    }
  }

  private removeMob(mobId: number): void {
    if (!this.mobs.delete(mobId)) return;
    this.emit({ kind: "mob-leave", mobId });
  }

  private applyStats(diff: StatDiff): void {
    const self = this.self;
    if (self === undefined) return;
    for (const [name, value] of Object.entries(diff)) {
      if (value === undefined) continue;
      if (name in self && typeof value === "number") (self as unknown as Record<string, number>)[name] = value;
    }
    this.emit({ kind: "self", self });
  }
}

/** `0x1A` chat text is raw CP949; our lines are ASCII and UTF-8 is a superset for the rest. */
function decodeChatText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** The events the adapter forwards, as a stable list (the JSON protocol's `t` values). */
export const CLIENT_EVENT_KINDS = [
  "field",
  "self",
  "user-enter",
  "user-leave",
  "user-move",
  "user-emotion",
  "chat",
  "level-up",
  "mob-enter",
  "mob-move",
  "mob-leave",
  "npc-enter",
  "npc-leave",
  "unknown",
  "disconnect",
] as const satisfies readonly ClientEvent["kind"][];
