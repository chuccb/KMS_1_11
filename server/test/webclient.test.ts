/**
 * The browser bridge, driven the way a browser drives it.
 *
 * Node 22 has a global `WebSocket` that behaves like the browser's (masked frames, the same
 * handshake), so this test is the browser's half without a browser: it opens the page's socket,
 * sends the JSON of `net/webclient.ts`, and checks the events that come back - over the real
 * `LoginServer`/`GameEntryServer`, over real TCP, with the real cipher.
 *
 * What this proves and what it does not: the wire format is exercised on the server side of the
 * bridge (a regression there fails here), and the JSON contract the page depends on is pinned. The
 * page's own drawing is not covered - that needs eyes, and `docs/CLIENT.md` says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { HandoffRegistry } from "../src/net/loginserver.ts";
import { LoginServer, type AccountRecord } from "../src/net/loginserver.ts";
import { GameEntryServer } from "../src/net/loginserver.ts";
import { OnlineAccounts } from "../src/net/online.ts";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import type { MapData } from "../src/game/map.ts";
import { startWebClient } from "../src/net/webclient.ts";

const STUB_MAP: MapData = {
  id: 1000000,
  imagePath: "Map/Map/001000000.img",
  name: "stub-field",
  streetName: "stub",
  bgm: "",
  returnMapId: 1010000,
  mobs: [{ templateId: 120100, x: 509, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 1000, cy: 300 }],
  npcs: [{ templateId: 2003, x: 69, y: 275, foothold: 28, facing: 0, rx0: 0, rx1: 0, cy: 275 }],
  portals: [
    { name: "sp", type: 0, x: 100, y: 200, toMapId: 0, toName: "" },
    { name: "west00", type: 2, x: 130, y: 300, toMapId: 2000000, toName: "east00" },
  ],
  footholds: 1,
  ladderRopes: 0,
  footholdSegments: new Map([[32, { id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, prev: 0, next: 0 }]]),
};

/** A GET with the path sent byte for byte (no client-side normalisation). */
function rawStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
  });
}

/** One page: a WebSocket with the messages it has received so far. */
class Browser {
  private readonly socket: WebSocket;
  private readonly queue: Record<string, unknown>[] = [];
  private waiter: (() => void) | undefined;
  private closed: string | undefined;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.queue.push(JSON.parse(String(event.data)) as Record<string, unknown>);
      this.waiter?.();
    });
    socket.addEventListener("close", (event) => {
      this.closed = `closed (${event.code})`;
      this.waiter?.();
    });
  }

  static async open(port: number): Promise<Browser> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("the browser socket could not open")), { once: true });
    });
    return new Browser(socket);
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Waits for the next message `match` accepts, keeping the ones that arrived before it. */
  async next(match: (message: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex(match);
      if (index >= 0) return this.queue.splice(index, 1)[0]!;
      if (this.closed !== undefined) throw new Error(`the socket ${this.closed} while waiting`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no matching message within ${timeoutMs} ms; had ${JSON.stringify(this.queue)}`);
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        setTimeout(resolve, Math.min(20, left));
      });
    }
  }

  nextKind(kind: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return this.next((message) => message.t === kind, timeoutMs);
  }

  /** Collects everything that arrives for `ms` - the cheapest "and nothing else happened" check. */
  async quiet(ms = 200): Promise<Record<string, unknown>[]> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return this.queue.splice(0, this.queue.length);
  }

  close(): void {
    this.socket.close();
  }
}

interface World {
  loginPort: number;
  gamePort: number;
  webPort: number;
}

/** A world with two accounts, one character each, and a browser bridge in front of it. */
async function startWorld(t: { after(fn: () => Promise<void>): void }): Promise<World> {
  const accounts = new Map<string, AccountRecord>([
    ["admin", { password: "admin", characters: [] }],
    ["alt", { password: "alt", characters: [] }],
    // Empty on purpose: a fresh account is what the page's create row exists for.
    ["newbie", { password: "newbie", characters: [] }],
  ]);
  for (const [user, id, name] of [
    ["admin", 21, "Hero"],
    ["alt", 22, "Alt"],
  ] as const) {
    const stats = zeroStats();
    stats.id = id;
    stats.name = name;
    stats.level = 12;
    stats.hp = 50;
    stats.maxHp = 50;
    stats.mp = 30;
    stats.maxMp = 30;
    stats.mapId = 1000000;
    accounts.get(user)!.characters.push(characterDataOf(stats, startingCharacterItems()));
  }

  const handoffs = new HandoffRegistry();
  const online = new OnlineAccounts();
  const mapProvider = (mapId: number) => (mapId === 1000000 ? STUB_MAP : undefined);
  const game = new GameEntryServer({
    handoffs,
    online,
    mapId: 1000000,
    mapProvider,
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
  });
  const gameInfo = await game.listen(0);
  const login = new LoginServer({
    accounts,
    worlds: [{ name: "Scania", unknownId: 0 }],
    gameServer: { ip: "127.0.0.1", port: gameInfo.port },
    handoffs,
    online,
    handshake: { clientSendSeed: 0x33333333, clientRecvSeed: 0x44444444 },
  });
  const loginInfo = await login.listen(0);
  const web = await startWebClient({
    port: 0,
    host: "127.0.0.1",
    loginPort: loginInfo.port,
    gamePort: gameInfo.port,
    gameHost: "127.0.0.1",
    mapProvider,
  });
  t.after(async () => {
    await web.close();
    await login.close();
    await game.close();
  });
  return { loginPort: loginInfo.port, gamePort: gameInfo.port, webPort: web.port };
}

/** Logs in, picks the world and the character, and returns the browser plus the field event. */
async function enterGame(port: number, user: string, password: string): Promise<{ browser: Browser; field: Record<string, unknown> }> {
  const browser = await Browser.open(port);
  browser.send({ t: "login", user, password });
  const login = await browser.nextKind("login");
  assert.equal(login.result, 0);
  browser.send({ t: "world", index: 0 });
  const characters = await browser.nextKind("characters");
  assert.equal(characters.result, 0);
  const character = (characters.characters as { id: number }[])[0]!;
  browser.send({ t: "character", id: character.id });
  const field = await browser.nextKind("field");
  return { browser, field };
}

test("the page, the map endpoint and the traversal guard are all served", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);

  const page = await fetch(`http://127.0.0.1:${world.webPort}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.match(html, /<canvas id="view"/);
  assert.match(html, /main\.js/);

  const script = await fetch(`http://127.0.0.1:${world.webPort}/main.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);

  const map = await fetch(`http://127.0.0.1:${world.webPort}/api/map/1000000`);
  assert.equal(map.status, 200);
  const body = (await map.json()) as { id: number; name: string; footholds: unknown[]; portals: unknown[] };
  assert.equal(body.id, 1000000);
  assert.equal(body.name, "stub-field");
  assert.equal(body.footholds.length, 1);
  assert.equal(body.portals.length, 2);

  const unknown = await fetch(`http://127.0.0.1:${world.webPort}/api/map/999`);
  assert.equal(unknown.status, 404);

  // `..` must not walk out of client/ and hand out Data.wz or a source file. `fetch` normalises a
  // literal `/../` away before sending it, so the traversal is written the way a hostile client
  // would: with the slash encoded (`..%2f`), which reaches the handler intact.
  for (const path of ["/..%2fserver%2fpackage.json", "/..%2fData.wz"]) {
    const status = await rawStatus(world.webPort, path);
    assert.equal(status, 403, `${path} must be refused`);
  }
  const health = await fetch(`http://127.0.0.1:${world.webPort}/healthz`);
  assert.equal(health.status, 200);
});

test("a browser logs in, enters the field, talks and walks", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const { browser, field } = await enterGame(world.webPort, "admin", "admin");

  const self = field.self as { name: string; level: number; hp: number; characterId: number };
  assert.equal(field.mapId, 1000000);
  assert.equal(self.name, "Hero");
  assert.equal(self.level, 12);
  assert.equal(self.hp, 50);
  // The field event is the 0x16 snapshot: the local character is known, nobody else is here yet.
  assert.deepEqual(field.users, []);

  browser.send({ t: "say", text: "hello" });
  const chat = await browser.nextKind("chat");
  assert.equal(chat.name, "Hero");
  assert.equal(chat.text, "hello");

  browser.send({ t: "move", x: 140, y: 250, foothold: 0 });
  const move = await browser.nextKind("user-move");
  assert.equal(move.characterId, self.characterId);
  assert.equal(move.x, 140);
  assert.equal(move.y, 250);

  browser.close();
});

test("a fresh account creates its first character, then plays it", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const browser = await Browser.open(world.webPort);
  browser.send({ t: "login", user: "newbie", password: "newbie" });
  assert.equal((await browser.nextKind("login")).result, 0);

  browser.send({ t: "world", index: 0 });
  const empty = await browser.nextKind("characters");
  assert.equal(empty.result, 0);
  assert.deepEqual(empty.characters, []);

  // The page sends `create`; the bridge answers with the refreshed list (so the new button can be
  // drawn) and then the `created` line the page prints.
  browser.send({ t: "create", name: "Rookie" });
  const listed = await browser.nextKind("characters");
  const characters = listed.characters as { id: number; name: string }[];
  assert.equal(characters.length, 1);
  assert.equal(characters[0]!.name, "Rookie");
  const created = await browser.nextKind("created");
  assert.equal(created.ok, true);
  assert.equal(created.name, "Rookie");

  // A second one with the same name is refused by the name check, and the list does not grow.
  browser.send({ t: "create", name: "Rookie" });
  const refused = await browser.nextKind("created");
  assert.equal(refused.ok, false);
  assert.match(String(refused.reason), /name check 1/);

  browser.send({ t: "character", id: characters[0]!.id });
  const field = await browser.nextKind("field");
  assert.equal((field.self as { name: string }).name, "Rookie");
  browser.close();
});

test("two browsers in one map see each other: enter, move and chat", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const hero = await enterGame(world.webPort, "admin", "admin");
  const alt = await enterGame(world.webPort, "alt", "alt");

  const entered = await hero.browser.nextKind("user-enter");
  const altView = entered.user as { name: string; characterId: number };
  assert.equal(altView.name, "Alt");

  hero.browser.send({ t: "move", x: 250, y: 260, foothold: 0 });
  const move = await alt.browser.next((message) => message.t === "user-move" && message.characterId === (hero.field.self as { characterId: number }).characterId);
  assert.equal(move.x, 250);
  assert.equal(move.y, 260);

  alt.browser.send({ t: "say", text: "hi there" });
  const heard = await hero.browser.next((message) => message.t === "chat" && message.text === "hi there");
  assert.equal(heard.name, "Alt");

  hero.browser.close();
  const left = await alt.browser.next((message) => message.t === "user-leave");
  assert.equal(left.characterId, (hero.field.self as { characterId: number }).characterId);

  alt.browser.close();
});

test("a wrong password is answered with a result, not a socket error", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const browser = await Browser.open(world.webPort);
  browser.send({ t: "login", user: "admin", password: "wrong" });
  const login = await browser.nextKind("login");
  assert.notEqual(login.result, 0);
  assert.deepEqual(login.worlds, []);
  assert.deepEqual(await browser.quiet(150), []);
  browser.close();
});
