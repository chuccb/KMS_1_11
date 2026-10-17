/**
 * The browser bridge: an HTTP server that serves `client/` and turns a WebSocket into a 2003
 * session.
 *
 * WHY A BRIDGE, AND WHY IT IS THE HONEST SHAPE
 * --------------------------------------------
 * A browser has no TCP socket and no way to open one, so "the game in a browser" cannot mean "the
 * browser speaks the 2003 protocol". Something on the server side must hold the socket. This module
 * is that something: every WebSocket connection gets its own `ClientSession` (see
 * `src/client/session.ts`), which logs in, selects a world and a character, claims the handoff and
 * streams the field - over real TCP, against the real `LoginServer`/`GameEntryServer`.
 *
 * The JSON that crosses the WebSocket is **our design**, not the 2003 protocol's; the parts that
 * are evidence live on the TCP side. Keeping the browser on this side of the line has three
 * consequences worth stating:
 *
 *   - the browser never needs the cipher, so a wrong key schedule cannot be "fixed" on the client;
 *   - the view can be tested without a browser (`test/webclient.test.ts` drives this JSON protocol
 *     with a real WebSocket client, which Node has as a global);
 *   - anything the 2003 client does locally (damage rolls, mob AI, the look table) is *not* here,
 *     which is why this is a viewer and a chat box, not a replacement client.
 *
 * The map endpoint exists for the same reason: the 2003 client reads `Map/Map/%09d.img` itself, and
 * the browser cannot. `/api/map/<id>` hands it the geometry it needs to draw the ground, from the
 * same WZ the server already reads.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClientSession, type ClientEvent } from "../client/session.ts";
import { encodeCp949 } from "../protocol/cp949.ts";
import type { CharacterData } from "../protocol/chardata.ts";
import type { MapData } from "../game/map.ts";
import { WebSocket, upgradeResponse } from "./websocket.ts";

/** Where `client/` lives when no root is given: the repository root, one level above `server/`. */
const DEFAULT_CLIENT_ROOT = fileURLToPath(new URL("../../../client", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export interface WebClientOptions {
  /** Port of the HTTP + WebSocket listener. */
  port: number;
  host?: string;
  /** The login server the bridge dials for every browser connection. */
  loginPort: number;
  /** The game server. When absent, `0x03`'s own address is used (which only works on this host). */
  gamePort?: number;
  /** Overrides the IP the `0x03` reply names; the bridge always dials from here. */
  gameHost?: string;
  /** Directory holding `index.html`; defaults to `<repo>/client`. */
  root?: string;
  /** The same provider the game server uses, for `/api/map/<id>`. */
  mapProvider?(mapId: number): MapData | undefined;
  log?(line: string): void;
}

export interface WebClientServer {
  port: number;
  host: string;
  close(): Promise<void>;
}

/** One character in the list the browser shows. */
interface CharacterSummary {
  id: number;
  name: string;
  level: number;
  job: number;
  face: number;
  hair: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  exp: number;
  mesos: number;
  mapId: number;
  /** Worn item ids, so a character can be drawn before it enters the field. */
  items: number[];
}

function summaryOf(character: CharacterData): CharacterSummary {
  const stats = character.stats;
  const items = character.items === undefined ? [] : [...character.items.worn.values()].map((slot) => slot.itemId);
  return {
    id: stats.id,
    name: stats.name,
    level: stats.level,
    job: stats.job,
    face: stats.appearanceA,
    hair: stats.appearanceB,
    hp: stats.hp,
    maxHp: stats.maxHp,
    mp: stats.mp,
    maxMp: stats.maxMp,
    exp: stats.exp,
    mesos: stats.mesos,
    mapId: stats.mapId,
    items: items.filter((itemId) => itemId !== 0),
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** The map geometry the browser needs: everything a 2D view draws the ground from. */
function mapJson(map: MapData): unknown {
  const segments: { id: number; x1: number; y1: number; x2: number; y2: number; next: number; prev: number }[] = [];
  for (const segment of map.footholdSegments?.values() ?? []) {
    segments.push({
      id: segment.id,
      x1: segment.x1,
      y1: segment.y1,
      x2: segment.x2,
      y2: segment.y2,
      next: segment.next,
      prev: segment.prev,
    });
  }
  return {
    id: map.id,
    name: map.name,
    streetName: map.streetName,
    portals: map.portals.map((portal) => ({
      name: portal.name,
      type: portal.type,
      x: portal.x,
      y: portal.y,
      toMapId: portal.toMapId,
    })),
    footholds: segments,
    mobs: map.mobs.map((mob) => ({ templateId: mob.templateId, x: mob.x, y: mob.y, foothold: mob.foothold })),
    npcs: map.npcs.map((npc) => ({ templateId: npc.templateId, x: npc.x, y: npc.y, foothold: npc.foothold })),
  };
}

/**
 * One browser tab. It owns a `ClientSession`, and the two directions are translated here:
 * JSON in (`login`, `world`, `character`, `say`, `move`), `ClientEvent`s out.
 */
class BrowserSession {
  private readonly socket: WebSocket;
  private readonly options: WebClientOptions;
  private session: ClientSession | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(socket: WebSocket, options: WebClientOptions) {
    this.socket = socket;
    this.options = options;
    socket.onMessage = (data, binary) => {
      if (binary) return this.send({ t: "error", message: "binary frames are not part of this protocol" });
      void this.handle(data);
    };
    socket.onClose = () => this.close();
  }

  private send(message: unknown): void {
    this.socket.sendText(JSON.stringify(message));
  }

  private fail(error: unknown): void {
    this.send({ t: "error", message: error instanceof Error ? error.message : String(error) });
  }

  private async handle(data: Uint8Array): Promise<void> {
    let message: { t?: unknown; [key: string]: unknown };
    try {
      message = JSON.parse(new TextDecoder().decode(data)) as { t?: unknown };
    } catch {
      return this.send({ t: "error", message: "the message is not JSON" });
    }
    try {
      switch (message.t) {
        case "login":
          return await this.login(String(message.user ?? ""), String(message.password ?? ""));
        case "world":
          return await this.selectWorld(Number(message.index ?? 0));
        case "character":
          return await this.selectCharacter(Number(message.id ?? 0));
        case "create":
          return await this.createCharacter(String(message.name ?? ""));
        case "say":
          return await this.say(String(message.text ?? ""));
        case "move":
          return await this.move(Number(message.x ?? 0), Number(message.y ?? 0), Number(message.foothold ?? 0));
        case "portal":
          return await this.usePortal(String(message.name ?? ""));
        case "emotion":
          return await this.emotion(Number(message.value ?? 0));
        case "whisper":
          return await this.whisper(String(message.name ?? ""), String(message.text ?? ""));
        case "find":
          return await this.find(String(message.name ?? ""));
        default:
          return this.send({ t: "error", message: `unknown message ${String(message.t)}` });
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private newSession(): ClientSession {
    this.unsubscribe?.();
    this.session?.close();
    const session = new ClientSession({
      loginPort: this.options.loginPort,
      ...(this.options.gamePort !== undefined ? { gamePort: this.options.gamePort } : {}),
      ...(this.options.gameHost !== undefined ? { gameHost: this.options.gameHost } : {}),
      ...(this.options.log !== undefined ? { log: this.options.log } : {}),
    });
    this.unsubscribe = session.onEvent((event) => this.send(this.eventJson(event)));
    this.session = session;
    return session;
  }

  private async login(user: string, password: string): Promise<void> {
    const session = this.newSession();
    const reply = await session.login(user, password);
    this.send({ t: "login", result: reply.result, worlds: reply.worlds });
  }

  private async selectWorld(index: number): Promise<void> {
    const session = this.require();
    const reply = await session.selectWorld(index);
    this.lastCharacters = reply.characters;
    this.send({
      t: "characters",
      result: reply.result,
      characters: reply.characters.map((character) => summaryOf(character)),
    });
  }

  private async selectCharacter(id: number): Promise<void> {
    const session = this.require();
    const reply = await session.selectCharacter(id);
    if (reply.result !== 0) {
      this.send({ t: "characters", result: reply.result, characters: [] });
      return;
    }
    const character = this.lastCharacters.find((candidate) => candidate.stats.id === id);
    if (character !== undefined) session.remember(character);
    await session.enterGame(reply);
  }

  /**
   * The one thing a fresh account cannot do without a 2003 client: make its first character.
   *
   * The reply is two messages, in this order: the refreshed list (so the page can show the new
   * button without another round trip) and a `created` line the page prints as-is. A refusal is not
   * an error - a taken name is the ordinary outcome of a typo - so it does not use the `error` type.
   */
  private async createCharacter(name: string): Promise<void> {
    const session = this.require();
    const trimmed = name.trim();
    if (trimmed === "") {
      this.send({ t: "created", ok: false, name: trimmed, reason: "empty name" });
      return;
    }
    const reply = await session.createCharacter(trimmed);
    if (reply.character !== undefined) this.lastCharacters.push(reply.character);
    this.send({
      t: "characters",
      result: 0,
      characters: this.lastCharacters.map((character) => summaryOf(character)),
    });
    if (reply.character !== undefined) {
      this.send({ t: "created", ok: true, name: reply.character.stats.name, id: reply.character.stats.id });
    } else if (reply.nameCheck !== 0) {
      this.send({ t: "created", ok: false, name: trimmed, reason: `name check ${reply.nameCheck}` });
    } else {
      this.send({ t: "created", ok: false, name: trimmed, reason: "the server refused the create" });
    }
  }

  /** The records the character list handed out; `remember` needs the full stats, not the summary. */
  private lastCharacters: CharacterData[] = [];

  private require(): ClientSession {
    if (this.session === undefined) throw new Error("login first");
    return this.session;
  }

  private async say(text: string): Promise<void> {
    await this.require().say(encodeCp949(text));
  }

  private async move(x: number, y: number, foothold: number): Promise<void> {
    await this.require().moveTo(x, y, foothold);
  }

  /**
   * A click on a portal. The name is the map's own `pn`, which is what the page draws and what the
   * 2003 client would have sent; the destination never comes from the browser. The arrival shows up
   * as the `field` event the server's `0x16` produces.
   */
  private async usePortal(name: string): Promise<void> {
    if (name === "") return this.send({ t: "error", message: "portal needs a name" });
    await this.require().usePortal(name);
  }

  /**
   * One of the nine faces (`EMOTION_NAMES`, 0..8). The value is checked by the codec, whose message
   * names the range - the page shows it as-is rather than this adapter inventing a second wording.
   */
  private async emotion(value: number): Promise<void> {
    await this.require().emotion(value);
  }

  /**
   * A whisper to one player: `0x23` kind 0x06. The receiver sees a normal `chat` (`0x1A` 0x12 - the
   * same packet chat uses, so the two are indistinguishable on the wire) and the sender gets
   * `whisper-answer`. The text is CP949 on the wire, like every string a human reads.
   */
  private async whisper(name: string, text: string): Promise<void> {
    const target = name.trim();
    if (target === "") return this.send({ t: "error", message: "whisper needs a target name" });
    if (text === "") return this.send({ t: "error", message: "whisper needs a message" });
    await this.require().whisper(target, encodeCp949(text));
  }

  /** `/헉추적`: `0x23` kind 0x05, answered by `find-answer` (`0x1A` 0x09). */
  private async find(name: string): Promise<void> {
    const target = name.trim();
    if (target === "") return this.send({ t: "error", message: "find needs a name" });
    await this.require().find(target);
  }

  private eventJson(event: ClientEvent): unknown {
    const { kind, ...rest } = event;
    return { t: kind, ...rest };
  }

  close(): void {
    this.unsubscribe?.();
    this.session?.close();
    this.session = undefined;
  }
}

/** Serves one file out of `root`, or answers 404. */
function serveStatic(root: string, request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  // Refuse a traversal outright instead of quietly re-rooting it: `normalize` would already turn
  // `/../server/package.json` into `server/package.json` *inside* the root, but a request that tried
  // to leave is a request the operator should see in the log line, not a 404 that hides it.
  if (pathname.split("/").includes("..")) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("outside the client directory\n");
    return;
  }
  // `normalize` collapses `..`; the prefix check then keeps the result inside `root` no matter what
  // the request looked like (`/%2e%2e/Data.wz` must not be a WZ leak).
  const target = resolve(join(root, normalize(pathname)));
  if (!target.startsWith(resolve(root))) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("outside the client directory\n");
    return;
  }
  let body: Buffer;
  try {
    body = readFileSync(target);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found\n");
    return;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
    "content-length": body.length,
    // The client is developed and reloaded while the server runs; a cached page hides that.
    "cache-control": "no-store",
  });
  response.end(body);
}

/**
 * Starts the listener. The WebSocket lives on the same origin as the page, so the browser needs no
 * CORS and no second port: `/ws` is the game, `/api/map/<id>` is the terrain, everything else is a
 * file.
 */
export function startWebClient(options: WebClientOptions): Promise<WebClientServer> {
  const root = options.root ?? DEFAULT_CLIENT_ROOT;
  const sockets = new Set<WebSocket>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/map/")) {
      const id = Number(url.pathname.slice("/api/map/".length));
      const map = Number.isFinite(id) ? options.mapProvider?.(id) : undefined;
      if (map === undefined) {
        sendJson(response, 404, { error: `map ${url.pathname.slice("/api/map/".length)} is not known` });
        return;
      }
      sendJson(response, 200, mapJson(map));
      return;
    }
    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }
    serveStatic(root, request, response);
  });

  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
      return;
    }
    const upgrade = upgradeResponse(request);
    if (!upgrade.ok) {
      options.log?.(`web: refusing upgrade: ${upgrade.reason}`);
      socket.end(`HTTP/1.1 ${upgrade.status} ${upgrade.reason}\r\nconnection: close\r\n\r\n`);
      return;
    }
    socket.write(`${upgrade.headers.join("\r\n")}\r\n\r\n`);
    const ws = new WebSocket(socket, {});
    sockets.add(ws);
    const browser = new BrowserSession(ws, options);
    ws.onClose = (reason) => {
      browser.close();
      sockets.delete(ws);
      options.log?.(`web: browser session closed (${reason})`);
    };
    if (head.length > 0) socket.emit("data", head);
  });

  return new Promise<WebClientServer>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolvePromise({
        port,
        host: typeof address === "object" && address !== null ? address.address : (options.host ?? "0.0.0.0"),
        close: () =>
          new Promise<void>((done) => {
            for (const ws of sockets) ws.close();
            sockets.clear();
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}
