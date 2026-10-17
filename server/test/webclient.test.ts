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
import type { ItemCatalog } from "../src/game/iteminfo.ts";
import { grantItem } from "../src/game/rewards.ts";
import { artProviderOf } from "../src/game/art.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ShopDef, ShopKeeper } from "../src/game/shops.ts";

/** The shipped archive, when it is checked out: the art endpoints need real canvases. */
const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const ART_ARCHIVE: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;

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

/** The map `west00` leads to: one foothold, one door back, nothing alive. */
const TOWN_MAP: MapData = {
  id: 2000000,
  imagePath: "Map/Map/002000000.img",
  name: "stub-town",
  streetName: "stub",
  bgm: "",
  returnMapId: 1000000,
  mobs: [],
  npcs: [],
  portals: [
    { name: "sp", type: 0, x: 200, y: 300, toMapId: 0, toName: "" },
    { name: "east00", type: 2, x: 400, y: 300, toMapId: 1000000, toName: "west00" },
  ],
  footholds: 1,
  ladderRopes: 0,
  footholdSegments: new Map([[1, { id: 1, x1: 0, y1: 300, x2: 900, y2: 300, prev: 0, next: 0 }]]),
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

  /** Drops the connection the way a killed browser does: no close handshake at all. */
  destroy(): void {
    const raw = (this.socket as unknown as { _socket?: { destroy(): void } })._socket;
    raw?.destroy();
    this.socket.close();
  }
}

/**
 * Two items and a one-pixel PNG, standing in for `Data.wz`.
 *
 * The real lookup (`game/iteminfo.ts`) is covered by its own probe against the archive; what these
 * tests pin is the *bridge*: that `/api/item/<id>` answers what the catalogue says, that a missing
 * icon is a 404 rather than an empty image, and that `use` reaches `0x18` and comes back as an
 * inventory event.
 */
const STUB_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const STUB_CATALOG: ItemCatalog = {
  info: (itemId) =>
    itemId === 2000000
      ? { id: itemId, name: "빨간 포션", price: 25, desc: "HP를 약 50 회복시킨다." }
      : itemId === 2000001
        ? { id: itemId, name: "주황 포션", price: 80 }
        : undefined,
  icon: (itemId) => (itemId === 2000000 ? STUB_PNG : undefined),
};

/**
 * One shop and one talker, standing in for `game/shops.ts` + `game/dialogue.ts` over `Data.wz`.
 *
 * The server's own buy/sell (`shops.test.ts`) and its `info/speak` reader (`quest.test.ts`) are
 * pinned elsewhere; what these tests need is the *bridge*: a click becomes `0x33`, `0x4A` becomes a
 * `shop-open`, a buy becomes `0x16` and comes back as `0x4B` + `0x0B` + `0x0D`, and an `0x47` line
 * is walked with `0x15`.
 */
const STUB_SHOP_DEF: ShopDef = { shopId: 2003, npcTemplateId: 2003, items: [{ itemId: 2000000 }] };
const STUB_SHOP: ShopKeeper = {
  shopOfNpc: (templateId) => (templateId === 2003 ? STUB_SHOP_DEF : undefined),
  linesOf: () => [{ itemId: 2000000, price: 25, maxCount: 200 }],
  priceOf: (itemId) => (itemId === 2000000 ? 25 : undefined),
  sellPriceOf: (itemId) => (itemId === 2000000 ? 12 : undefined),
  buy: (items, wallet, _shop, itemId, count) => {
    if (itemId !== 2000000) return { kind: "failed", reason: "notInShop" };
    if (!Number.isInteger(count) || count <= 0 || count > 200) return { kind: "failed", reason: "badRequest" };
    const total = 25 * count;
    if (wallet.balance < total) return { kind: "failed", reason: "notEnoughMesos" };
    const granted = grantItem(items, itemId, count);
    if (granted === undefined) return { kind: "failed", reason: "notEnoughSlots" };
    wallet.spend(total);
    return {
      kind: "bought",
      itemId,
      count,
      unitPrice: 25,
      total,
      inventory: granted.inventory,
      slot: granted.slot,
      change: granted.change,
      mesos: wallet.balance,
    };
  },
  sell: () => ({ kind: "failed", reason: "notEnoughItems" }),
};

interface World {
  loginPort: number;
  gamePort: number;
  webPort: number;
}

/** What a test world may change about its characters; everything else is the shared fixture. */
interface WorldOptions {
  /** Gives NPC 2003 a shop - the click path that opens `0x4A`. */
  shop?: boolean;
  /** Gives NPC 2003 two lines of `info/speak` instead - the click path that opens `0x47`. */
  guide?: boolean;
  /**
   * Puts one 빨간 포션 at USE slot 1 and drops `admin`'s HP to 20 of 50, with the archive's own
   * `spec/hp = 50` behind it - the state a double-click on the potion is supposed to change.
   */
  damaged?: boolean;
}

/** A world with two accounts, one character each, and a browser bridge in front of it. */
async function startWorld(t: { after(fn: () => Promise<void>): void }, options: WorldOptions = {}): Promise<World> {
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
    stats.mesos = 100;
    const items = startingCharacterItems();
    if (options.damaged === true && user === "admin") {
      stats.hp = 20;
      items.inventories[1]!.items.set(1, { kind: "nonequip", itemId: 2000000, quantity: 3, cash: null });
    }
    accounts.get(user)!.characters.push(characterDataOf(stats, items));
  }

  const handoffs = new HandoffRegistry();
  const online = new OnlineAccounts();
  const mapProvider = (mapId: number) =>
    mapId === 1000000 ? STUB_MAP : mapId === 2000000 ? TOWN_MAP : undefined;
  const game = new GameEntryServer({
    handoffs,
    online,
    mapId: 1000000,
    mapProvider,
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    // The archive's `Item/Consume/0200.img/02000000/spec` in one line: a flat 50 HP.
    ...(options.damaged === true ? { consumeSpec: () => ({ hp: 50, unapplied: [] }) } : {}),
    ...(options.shop === true ? { shops: STUB_SHOP } : {}),
    ...(options.guide === true
      ? { npcDialogue: (templateId: number) => (templateId === 2003 ? { templateId, name: "로빈", lines: ["first line", "second line"] } : undefined) }
      : {}),
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
    itemCatalog: STUB_CATALOG,
    ...(ART_ARCHIVE !== null ? { art: artProviderOf(ART_ARCHIVE) } : {}),
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

const artTest = ART_ARCHIVE === null ? test.skip : test;
artTest("the map's art, its canvases and a composed avatar are served", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  // The stub maps are not in Data.wz, so the art endpoint answers for a real one instead - the
  // stub `mapProvider` still owns `/api/map/1000000`, which is what the page asks first.
  const art = await fetch(`http://127.0.0.1:${world.webPort}/api/map/100000000/art`);
  assert.equal(art.status, 200, "Henesys is in the archive every shipped session reads");
  const body = (await art.json()) as {
    backs: { path: string; ox: number; oy: number; type: number }[];
    sprites: { layer: number; z: number; frames: { path: string }[] }[];
    bounds: { left: number; right: number };
  };
  assert.ok(body.backs.length > 0);
  assert.ok(body.sprites.length > 0);
  assert.ok(body.sprites.every((sprite) => Number.isInteger(sprite.layer) && sprite.layer >= 0 && sprite.layer <= 7));
  assert.ok(body.bounds.right > body.bounds.left);

  const back = body.backs[0]!;
  const png = await fetch(`http://127.0.0.1:${world.webPort}/api/png/${encodeURIComponent(back.path)}`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await png.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // Only the art folders, and only real paths: `..` and a server file are refused.
  for (const path of [
    `/api/png/${encodeURIComponent("../Data.wz")}`,
    `/api/png/${encodeURIComponent("server/package.json")}`,
  ]) {
    const refused = await fetch(`http://127.0.0.1:${world.webPort}${path}`);
    assert.equal(refused.status, 404, `${path} must not be served`);
  }
  assert.equal((await fetch(`http://127.0.0.1:${world.webPort}/api/png/${encodeURIComponent("Map/Tile/nope.img/x/0")}`)).status, 404);

  const avatar = await fetch(
    `http://127.0.0.1:${world.webPort}/api/avatar.png?face=20000&hair=30000&items=1040001&stance=stand1&frame=0`,
  );
  assert.equal(avatar.status, 200);
  assert.equal(avatar.headers.get("content-type"), "image/png");
  // The offset of the picture relative to the character's feet is a header, because the pixels of a
  // PNG cannot carry it.
  assert.ok(Number(avatar.headers.get("x-frame-dx")) < 0);
  assert.ok(Number(avatar.headers.get("x-frame-dy")) < 0);

  const npc = await fetch(`http://127.0.0.1:${world.webPort}/api/npc/1010100`);
  assert.equal(npc.status, 200);
  const npcBody = (await npc.json()) as { actions: Record<string, { path: string; ox: number }[]> };
  assert.ok((npcBody.actions.stand ?? []).length > 0);

  const mob = await fetch(`http://127.0.0.1:${world.webPort}/api/mob/100100`);
  assert.equal(mob.status, 200);
  const mobBody = (await mob.json()) as { actions: Record<string, unknown[]> };
  assert.ok((mobBody.actions.move ?? []).length >= 2, "a snail's walk is an animation");
  const missingMob = await fetch(`http://127.0.0.1:${world.webPort}/api/mob/1234567`);
  assert.equal(missingMob.status, 404, "a template the archive does not have is a 404, not an empty list");
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

test("the inventory a 0x0B describes, and the archive facts a slot needs", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t, { damaged: true });
  const { browser } = await enterGame(world.webPort, "admin", "admin");

  // The `0x16` snapshot carries the items (`CharacterData` bit 0x02) and the bridge sends them as
  // their own event, because a `0x0B` updates them without a new field.
  const entered = await browser.nextKind("inventory");
  type Slot = { slot: number; itemId: number; quantity?: number; ruc?: number };
  const view = entered.inventory as { worn: Slot[]; wornCash: Slot[]; tabs: { tab: number; capacity: number; items: Slot[] }[] };
  assert.deepEqual(
    view.tabs.map((tab) => tab.tab),
    [1, 2, 3, 4],
  );
  assert.equal(view.tabs[0]!.capacity, 24);
  assert.deepEqual(view.tabs[1]!.items, [{ slot: 1, itemId: 2000000, quantity: 3 }]);
  assert.deepEqual(view.worn, []);

  // The name, the price and the description are not on the wire: they are the archive's, read by the
  // server from the same `Data.wz` the 2003 client loaded.
  const item = await fetch(`http://127.0.0.1:${world.webPort}/api/item/2000000`);
  assert.equal(item.status, 200);
  assert.deepEqual(await item.json(), { id: 2000000, name: "빨간 포션", price: 25, desc: "HP를 약 50 회복시킨다." });

  const icon = await fetch(`http://127.0.0.1:${world.webPort}/api/item/2000000/icon.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await icon.arrayBuffer()), STUB_PNG);

  // No canvas is a 404, so the page draws the slot without an icon instead of re-requesting a broken
  // image; an id the archive does not carry and a non-id are both "nothing here".
  assert.equal((await fetch(`http://127.0.0.1:${world.webPort}/api/item/2000001/icon.png`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${world.webPort}/api/item/999999`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${world.webPort}/api/item/abc`)).status, 404);

  // A double-click on the USE tab: `0x18 slot 1 item 2000000`. The answer is not a "use" reply - it
  // is the `0x0B` that takes one out of the slot and the `0x0D` that moves the vitals.
  browser.send({ t: "use", slot: 1, itemId: 2000000 });
  const drank = (await browser.nextKind("inventory")).inventory as { tabs: { tab: number; items: Slot[] }[] };
  assert.deepEqual(drank.tabs[1]!.items, [{ slot: 1, itemId: 2000000, quantity: 2 }]);
  const healed = (await browser.nextKind("self")).self as { hp: number; maxHp: number };
  assert.equal(healed.hp, 50);
  assert.equal(healed.maxHp, 50);

  // A slot the character does not have, and a pair the client made up, are page errors - the server
  // is never asked, because there is nothing it could answer that the page would draw.
  browser.send({ t: "use", slot: 0, itemId: 2000000 });
  assert.match(String((await browser.nextKind("error")).message), /use needs a USE-tab slot/);
  browser.send({ t: "use", slot: 1, itemId: 0 });
  assert.match(String((await browser.nextKind("error")).message), /use needs an item id/);

  browser.close();
});

test("clicking an NPC opens its shop, and a buy moves the item and the mesos", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t, { shop: true });
  const { browser } = await enterGame(world.webPort, "admin", "admin");
  // NPCs arrive as their own `0x39`, not inside the `0x16` snapshot.
  const npc = (await browser.nextKind("npc-enter")).npc as { npcId: number; templateId: number };
  assert.equal(npc.templateId, 2003);
  // The entry `0x16` is followed by the inventory it carries; take it now so the next one is the
  // buy's.
  await browser.nextKind("inventory");

  // The click is `0x33` with the *runtime* id (`0x39` gave it), and the answer is the shop window
  // the server priced from the archive - not a guess by the page.
  browser.send({ t: "click", objectId: npc.npcId });
  const shop = (await browser.nextKind("shop-open")).shop as {
    shopId: number;
    items: { itemId: number; price: number; maxCount: number }[];
  };
  assert.equal(shop.shopId, 2003);
  assert.deepEqual(shop.items, [{ itemId: 2000000, price: 25, maxCount: 200 }]);

  // Buy two: `0x16` in, `0x4B` (silent), `0x0B` (the slot) and `0x0D` (the mesos) back - the same
  // three packets a pickup or a trade uses.
  browser.send({ t: "shop", action: "buy", row: 0, itemId: 2000000, count: 2 });
  assert.equal((await browser.nextKind("shop-result")).code, 0);
  const after = (await browser.nextKind("inventory")).inventory as {
    tabs: { tab: number; items: { slot: number; itemId: number; quantity?: number }[] }[];
  };
  assert.deepEqual(after.tabs[1]!.items, [{ slot: 1, itemId: 2000000, quantity: 2 }]);
  assert.equal((((await browser.nextKind("self")).self) as { mesos: number }).mesos, 50);

  // A close is deliberately unanswered (the client's close does not arm its in-flight flag).
  browser.send({ t: "shop", action: "close" });
  const quiet = await browser.quiet(200);
  assert.deepEqual(quiet.filter((message) => message.t === "shop-result"), []);

  // Bad arguments never reach the server, so they come back as page errors instead of a packet.
  browser.send({ t: "shop", action: "buy", row: 0, itemId: 2000000, count: 0 });
  assert.match(String((await browser.nextKind("error")).message), /shop needs a count above 0/);
  browser.send({ t: "shop", action: "steal", itemId: 2000000, count: 1 });
  assert.match(String((await browser.nextKind("error")).message), /is not buy, sell, recharge or close/);

  browser.close();
});

test("clicking a talking NPC walks its lines, and 0x15 ends the conversation", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t, { guide: true });
  const { browser } = await enterGame(world.webPort, "admin", "admin");
  const npc = (await browser.nextKind("npc-enter")).npc as { npcId: number; templateId: number };

  browser.send({ t: "click", objectId: npc.npcId });
  const first = await browser.nextKind("npc-say");
  assert.equal(first.npcId, npc.npcId);
  assert.equal(first.message, "first line");

  // The primary button advances; the dialog is modal, so the server sends exactly one line per
  // answer and nothing at all after the last one.
  browser.send({ t: "talk", answer: 1 });
  assert.equal((await browser.nextKind("npc-say")).message, "second line");
  browser.send({ t: "talk", answer: 1 });
  const quiet = await browser.quiet(200);
  assert.deepEqual(quiet.filter((message) => message.t === "npc-say"), []);

  // A second click starts a new conversation from the first line; the secondary button ends it.
  browser.send({ t: "click", objectId: npc.npcId });
  assert.equal((await browser.nextKind("npc-say")).message, "first line");
  browser.send({ t: "talk", answer: 0 });
  browser.send({ t: "talk", answer: 7 });
  assert.match(String((await browser.nextKind("error")).message), /talk answer must be 0 or 1/);

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

test("clicking a portal asks 0x0D and the server answers with a 0x16 for the other map", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const { browser, field } = await enterGame(world.webPort, "admin", "admin");
  assert.equal(field.mapId, 1000000);

  // The page sends the map's own `pn`; the destination is the map file's `tm`, never the browser's.
  browser.send({ t: "portal", name: "west00" });
  const arrived = await browser.nextKind("field");
  assert.equal(arrived.mapId, 2000000);
  assert.equal((arrived.self as { mapId: number }).mapId, 2000000);

  // The map endpoint knows the new map too, which is what the page refetches to redraw the ground.
  const map = await fetch(`http://127.0.0.1:${world.webPort}/api/map/2000000`);
  assert.equal(map.status, 200);
  assert.equal(((await map.json()) as { name: string }).name, "stub-town");

  // And back: the door on the other side is the map's own data as well.
  browser.send({ t: "portal", name: "east00" });
  const home = await browser.nextKind("field");
  assert.equal(home.mapId, 1000000);

  // A name that is not a portal of this map is a log line on the server, not a teleport.
  browser.send({ t: "portal", name: "nowhere" });
  const quiet = await browser.quiet(300);
  assert.deepEqual(quiet.filter((message) => message.t === "field"), []);

  browser.send({ t: "portal", name: "" });
  const error = await browser.nextKind("error");
  assert.match(String(error.message), /portal needs a name/);
  browser.close();
});

test("a face goes to the others, and a whisper comes back as an answer", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const hero = await enterGame(world.webPort, "admin", "admin");
  const alt = await enterGame(world.webPort, "alt", "alt");
  const heroId = (hero.field.self as { characterId: number }).characterId;
  await hero.browser.nextKind("user-enter"); // Alt walked in

  // 0x13: the 2003 client wears the face before it sends, so the page gets its own echo and the
  // server's 0x27 goes to everybody else only.
  hero.browser.send({ t: "emotion", value: 2 });
  const own = await hero.browser.nextKind("user-emotion");
  assert.deepEqual([own.characterId, own.emotion], [heroId, 2]);
  const seen = await alt.browser.nextKind("user-emotion");
  assert.deepEqual([seen.characterId, seen.emotion], [heroId, 2]);

  // 0x13 with a value the client cannot produce: the codec refuses it, and the page gets a reason.
  hero.browser.send({ t: "emotion", value: 99 });
  const refused = await hero.browser.nextKind("error");
  assert.match(String(refused.message), /not a face/);

  // 0x23 kind 0x06: the receiver sees a plain chat line (0x1A 0x12 - the wire has no second shape
  // for a delivered whisper), and the sender's answer carries the name and the delivered flag.
  hero.browser.send({ t: "whisper", name: "Alt", text: "안녕" });
  const delivered = await hero.browser.nextKind("whisper-answer");
  assert.deepEqual([delivered.name, delivered.delivered], ["Alt", true]);
  const heard = await alt.browser.next((message) => message.t === "chat" && message.name === "Hero");
  assert.equal(heard.text, "안녕", "CP949 bytes must come back as the text that was typed");

  hero.browser.send({ t: "whisper", name: "Nobody", text: "hi" });
  const missing = await hero.browser.nextKind("whisper-answer");
  assert.deepEqual([missing.name, missing.delivered], ["Nobody", false]);

  // 0x23 kind 0x05: the find answer is a map id, or -1 for somebody who is not online.
  hero.browser.send({ t: "find", name: "Alt" });
  const found = await hero.browser.nextKind("find-answer");
  assert.deepEqual([found.name, found.mapId], ["Alt", 1000000]);
  hero.browser.send({ t: "find", name: "Nobody" });
  const nowhere = await hero.browser.nextKind("find-answer");
  assert.deepEqual([nowhere.name, nowhere.mapId], ["Nobody", -1]);

  // Field chat is the same CP949 path, so a Korean line survives it too.
  alt.browser.send({ t: "say", text: "안녕하세요" });
  const line = await hero.browser.next((message) => message.t === "chat" && message.name === "Alt");
  assert.equal(line.text, "안녕하세요");

  hero.browser.close();
  alt.browser.close();
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

test("a browser that disappears releases its account, so the next login is not refused", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t);
  const first = await enterGame(world.webPort, "admin", "admin");
  // The login chain hands the character to the game server; the account's seat is the game
  // session's now. Killing the page without a close frame must still give it back - a socket from
  // `http.Server`'s upgrade is half-open, so the server only sees `end`.
  first.browser.destroy();
  let second: Browser | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    second?.close();
    second = await Browser.open(world.webPort);
    second.send({ t: "login", user: "admin", password: "admin" });
    const answer = await second.nextKind("login");
    if (answer.result === 0) return; // released
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the account stayed online after the browser vanished");
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
