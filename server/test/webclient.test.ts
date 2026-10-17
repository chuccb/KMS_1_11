import { ClientSession } from "../src/client/session.ts";
import { creationCatalogOf } from "../src/game/creation.ts";
import { MemorySaveStore, readSave } from "../src/game/save.ts";
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
import { equipSlot } from "../src/protocol/itemslot.ts";
import type { MapData } from "../src/game/map.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { mobLeaveEvent } from "../src/client/session.ts";
import type { ItemCatalog } from "../src/game/iteminfo.ts";
import { grantItem } from "../src/game/rewards.ts";
import { audioProviderOf } from "../src/game/audio.ts";
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
    {name:"auto",type:3,x:0,y:0,toMapId:999999999,toName:""},
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

  /** Whether a message matching `match` is already in hand, without waiting for one. */
  saw(match: (message: Record<string, unknown>) => boolean): boolean {
    return this.queue.some(match);
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
      : itemId === 1302000
        ? { id: itemId, name: "검", incPAD: 17 }
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
  accounts: Map<string, AccountRecord>;
  store: MemorySaveStore;
  loginPort: number;
  gamePort: number;
  webPort: number;
}

/** What a test world may change about its characters; everything else is the shared fixture. */
interface WorldOptions {
  mapCommands?: boolean;
  ability?: boolean;
  /** Gives NPC 2003 a shop - the click path that opens `0x4A`. */
  shop?: boolean;
  /** Gives NPC 2003 two lines of `info/speak` instead - the click path that opens `0x47`. */
  guide?: boolean;
  /**
   * Puts one 빨간 포션 at USE slot 1 and drops `admin`'s HP to 20 of 50, with the archive's own
   * `spec/hp = 50` behind it - the state a double-click on the potion is supposed to change.
   */
  damaged?: boolean;
  /**
   * A stub monster with 10 HP and a 40 ms corpse, plus one guaranteed meso drop per kill - the
   * shortest path from a swing to a drop on the ground.
   */
  combat?: boolean;
}

/** A world with two accounts, one character each, and a browser bridge in front of it. */
async function startWorld(t: { after(fn: () => Promise<void>): void }, options: WorldOptions = {}): Promise<World> {
  const accounts = new Map<string, AccountRecord>([
    ["admin", { password: "admin", characters: [] }],
    ["alt", { password: "alt", characters: [] }],
    // Empty on purpose: a fresh account is what the page's create row exists for.
    ["newbie", { password: "newbie", characters: [] }],
    ["female", { password: "female", gender: 1, characters: [] }],
  ]);
  for (const [user, id, name] of [
    ["admin", 21, "Hero"],
    ["alt", 22, "Alt"],
  ] as const) {
    const stats = zeroStats();
    stats.id = id;
    stats.name = name;
    stats.level = 12;
    // A beginner's own numbers, so a swing has something to roll with (`game/combat.ts`).
    stats.str = 12;
    stats.dex = 5;
    stats.hp = 50;
    stats.maxHp = 50;
    stats.mp = 30;
    stats.maxMp = 30;
    if (options.ability) Object.assign(stats, {ap: user === "admin" ? 3 : 2, int: 4, luk: 4});
    stats.mapId = 1000000;
    stats.mesos = 100;
    const items = startingCharacterItems();
    if (options.combat === true && user === "admin") items.worn.set(1, equipSlot(1302000));
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
  const store = new MemorySaveStore();
  const game = new GameEntryServer({
    persist:()=>store.save(accounts),
    handoffs,
    online,
    mapId: 1000000,
    mapProvider,
    ...(options.mapCommands ? {allowMapCommand:(username:string)=>username === "admin"} : {}),
    handshake: { clientSendSeed: 0x11111111, clientRecvSeed: 0x22222222 },
    // The archive's `Item/Consume/0200.img/02000000/spec` in one line: a flat 50 HP.
    ...(options.damaged === true ? { consumeSpec: () => ({ hp: 50, unapplied: [] }) } : {}),
    ...(options.combat === true
      ? {
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
          dropPolicy: () => [{ money: 25 }],
        }
      : {}),
    ...(options.shop === true ? { shops: STUB_SHOP } : {}),
    ...(options.guide === true
      ? { npcDialogue: (templateId: number) => (templateId === 2003 ? { templateId, name: "로빈", lines: ["first line", "second line"] } : undefined) }
      : {}),
  });
  const gameInfo = await game.listen(0);
  const login = new LoginServer({
    accounts,
    persist: () => store.save(accounts),
    ...(ART_ARCHIVE ? { creationCatalog: creationCatalogOf(artProviderOf(ART_ARCHIVE).reader)! } : {}),
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
    mapCatalog:()=>[STUB_MAP,TOWN_MAP].map(({id,name,streetName})=>({id,name,streetName})),
    itemCatalog: STUB_CATALOG,
    ...(ART_ARCHIVE !== null ? { art: artProviderOf(ART_ARCHIVE), audio: audioProviderOf(ART_ARCHIVE) } : {}),
  });
  t.after(async () => {
    await web.close();
    await login.close();
    await game.close();
  });
  return { accounts, store, loginPort: loginInfo.port, gamePort: gameInfo.port, webPort: web.port };
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

test("a browser's Ctrl swing kills a mob: the hit, the death and the drop", { timeout: 25000 }, async (t) => {
  const world = await startWorld(t, { combat: true });
  const { browser } = await enterGame(world.webPort, "admin", "admin");
  // The field's own spawn burst puts the stub monster on the ground; `mob-enter` is its id.
  const mob = (await browser.nextKind("mob-enter")).mob as { mobId: number };

  // The stub monster has 10 HP and the beginner's range is 1..9, so this may take a few swings -
  // which is the point: every swing is a real 0x1B, and the field answers each one.
  let damage = 0;
  for (let swing = 0; swing < 20; swing++) {
    browser.send({ t: "attack", mobId: mob.mobId, facingLeft: false });
    const hit = await browser.next((message) => message.t === "hit" && message.mobId === mob.mobId);
    damage = Number(hit.damage);
    assert.ok(damage >= 1, "a swing always hurts");
    if (browser.saw((message) => message.t === "mob-die")) break;
  }
  const die = await browser.next((message) => message.t === "mob-die" && message.mobId === mob.mobId);
  assert.equal(die.mobId, mob.mobId);

  // The kill's loot: one meso pile, flying out of the monster that dropped it.
  const drop = await browser.next((message) => message.t === "drop-enter");
  const body = drop.drop as { money: boolean; value: number; x: number; y: number; mobId?: number };
  assert.equal(body.money, true);
  assert.equal(body.value, 25);
  assert.equal(body.mobId, mob.mobId, "a mobile drop names the monster it came from");

  // Nothing is in reach of a character standing on the spawn portal, so the pile stays on the
  // ground; asking to hit a monster the field does not have is an answer, not a crash.
  browser.send({ t: "attack", mobId: 999999, facingLeft: false });
  const refusal = await browser.next((message) => message.t === "error");
  assert.match(String(refusal.message), /999999/);

  browser.close();
});

test("0x30 is a death animation while the corpse is still there, and a removal only at delay < 0", () => {
  // The positive form is what a kill sends (FINDINGS 4.17): 0x31 is still to come, so the monster
  // has to stay in the page's own pool and play `die1` - losing it here would make the corpse pop.
  assert.deepEqual(mobLeaveEvent({ mobId: 7, delayMs: 720 }, true), { kind: "mob-die", mobId: 7 });
  // The "already gone" form really is the removal.
  assert.deepEqual(mobLeaveEvent({ mobId: 7, delayMs: -1 }, true), { kind: "mob-leave", mobId: 7 });
  // A 0x30 for a monster the pool never had says nothing: no phantom corpse, no double leave.
  assert.equal(mobLeaveEvent({ mobId: 8, delayMs: 720 }, false), undefined);
  assert.equal(mobLeaveEvent({ mobId: 8, delayMs: -1 }, false), undefined);
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

test("original audio HTTP supports MP3, PCM, HEAD, byte ranges and missing assets", { skip: !ART_ARCHIVE }, async (t) => {
  const world = await startWorld(t);
  const url = `http://127.0.0.1:${world.webPort}/api/audio/${encodeURIComponent('Sound/Game.img/Jump')}`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.equal(full.headers.get('x-audio-duration-ms'), '65');
  const data = new Uint8Array(await full.arrayBuffer());
  assert.equal(data.length, 390);
  const partial = await fetch(url, { headers: { Range: 'bytes=10-29' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 10-29/390');
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), data.slice(10, 30));
  const suffix = await fetch(url, { headers: { Range: 'bytes=-20' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), data.slice(-20));
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '390');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const invalid = await fetch(url, { headers: { Range: 'bytes=999-1000' } });
  assert.equal(invalid.status, 416);
  const missing = await fetch(url.replace('Jump', 'NoSuchSound'));
  assert.equal(missing.status, 404);
  const pcm = await fetch(`http://127.0.0.1:${world.webPort}/api/audio/${encodeURIComponent('Sound/BgmUI.img/NxLogo')}`);
  assert.equal(pcm.status, 200);
  assert.equal(pcm.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await pcm.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
});


test("native creation checks/creates fresh rolled stats and confirmed deletion persists", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t), browser = await Browser.open(world.webPort);
  t.after(async () => browser.close());
  browser.send({ t: "login", user: "admin", password: "admin" });
  assert.equal((await browser.nextKind("login")).gender, 0);
  browser.send({ t: "check-name", name: "TooEarly" });
  assert.match(String((await browser.nextKind("error")).message), /selection is not active/);
  browser.send({ t: "world", index: 0 }); await browser.nextKind("characters");
  const appearance = [20002,30020,1040010,1060006,1072005,1312004,13,4,4,4];
  // Two checks sent without waiting must retain matching replies, despite sharing opcode 0x04.
  browser.send({ t: "check-name", name: "CheckOne", appearance });
  browser.send({ t: "check-name", name: "CheckTwo", appearance });
  assert.deepEqual(await browser.nextKind("name-checked"), { t: "name-checked", name: "CheckOne", result: 0 });
  assert.deepEqual(await browser.nextKind("name-checked"), { t: "name-checked", name: "CheckTwo", result: 0 });
  assert.equal(world.accounts.get("admin")!.characters.length, 1, "checks never create");
  for (const name of ["abc", "Too Long", "IIII", "測試", "운영자1"]) {
    browser.send({ t: "check-name", name, appearance });
    assert.match(String((await browser.nextKind("error")).message), /角色名稱/);
  }
  browser.send({ t: "create", name: "FreshHero", appearance: [...appearance.slice(0,6),4,5,6,7] });
  assert.match(String((await browser.nextKind("error")).message), /dice/);
  browser.send({ t: "create", name: "FreshHero", appearance });
  await browser.nextKind("characters"); const created = await browser.nextKind("created"); assert.equal(created.ok, true);
  const record = world.accounts.get("admin")!.characters.find((c) => c.stats.id === created.id)!;
  assert.equal(record.stats.level, 1, "does not clone the existing level-12 character");
  assert.equal(record.stats.exp, 0); assert.equal(record.stats.job, 0);
  assert.deepEqual([record.stats.str,record.stats.dex,record.stats.int,record.stats.luk], [13,4,4,4]);
  assert.deepEqual([...record.items!.worn!.values()].map((i) => i.itemId), appearance.slice(2,6));
  assert.equal(readSave(world.store.saved!).get("admin")!.characters.length, 2);
  browser.send({ t: "delete-character", id: created.id });
  assert.match(String((await browser.nextKind("error")).message), /confirmation/);
  browser.send({ t: "delete-character", id: 22, confirmed: true });
  assert.match(String((await browser.nextKind("error")).message), /not in this account/);
  assert.equal(world.accounts.get("admin")!.characters.length, 2);
  browser.send({ t: "delete-character", id: created.id, confirmed: true });
  assert.equal(((await browser.nextKind("characters")).characters as unknown[]).length, 1);
  assert.deepEqual(await browser.nextKind("deleted"), { t: "deleted", id: created.id, ok: true });
  assert.equal(readSave(world.store.saved!).get("admin")!.characters.length, 1);
  assert.equal(world.accounts.get("alt")!.characters[0]!.stats.id, 22, "another account is untouched");
});

test("female MakeCharInfo and Korean names round-trip through CP949 and save", { timeout: 20000, skip: ART_ARCHIVE === null }, async (t) => {
  const world = await startWorld(t), browser = await Browser.open(world.webPort);
  t.after(async () => browser.close());
  browser.send({ t: "login", user: "female", password: "female" });
  assert.equal((await browser.nextKind("login")).gender, 1);
  browser.send({ t: "world", index: 0 }); await browser.nextKind("characters");
  const catalog = creationCatalogOf(artProviderOf(ART_ARCHIVE!).reader)!;
  const api = await (await fetch(`http://127.0.0.1:${world.webPort}/api/creation`)).json() as typeof catalog;
  assert.deepEqual(api, catalog);
  browser.send({ t: "create", name: "한글용사", appearance: [...catalog.male.map((g) => g[0]!.id),4,5,6,10] });
  assert.match(String((await browser.nextKind("error")).message), /MakeCharInfo/);
  const appearance = [...catalog.female.map((g) => g.at(-1)!.id),4,5,6,10];
  browser.send({ t: "check-name", name: "한글용사", appearance });
  assert.equal((await browser.nextKind("name-checked")).result, 0);
  browser.send({ t: "create", name: "한글용사", appearance });
  const characters = (await browser.nextKind("characters")).characters as { id: number; name: string; face: number; hair: number }[];
  const created = await browser.nextKind("created");
  assert.equal(created.ok, true); assert.equal(created.name, "한글용사");
  assert.equal(characters[0]!.name, "한글용사"); assert.equal(characters[0]!.hair, 31054);
  assert.equal(world.accounts.get("female")!.characters[0]!.stats.gender, 1);
  const saved = readSave(world.store.saved!); assert.equal(saved.get("female")!.gender, 1);
  browser.send({ t: "delete-character", id: created.id, confirmed: true });
  await browser.nextKind("characters"); assert.equal((await browser.nextKind("deleted")).ok, true);
  assert.equal(readSave(world.store.saved!).get("female")!.characters.length, 0);
});


test("Korean character names survive field entry, other-player views, whispers and find", { timeout: 20000 }, async (t) => {
  const world = await startWorld(t), admin = (await enterGame(world.webPort,"admin","admin")).browser;
  const female = await Browser.open(world.webPort); t.after(async () => { admin.close(); female.close(); });
  female.send({t:"login",user:"female",password:"female"}); await female.nextKind("login");
  female.send({t:"world",index:0}); await female.nextKind("characters");
  female.send({t:"create",name:"한글용사", appearance:[21000,31000,1041002,1061002,1072001,1302000,4,5,6,10]});
  await female.nextKind("characters"); const created = await female.nextKind("created"); assert.equal(created.ok,true);
  female.send({t:"character",id:created.id}); const field=await female.nextKind("field");
  assert.equal((field.self as {name:string}).name,"한글용사");
  const enter=await admin.nextKind("user-enter"); assert.equal((enter.user as {name:string}).name,"한글용사");
  admin.send({t:"whisper",name:"한글용사",text:"안녕하세요"});
  assert.deepEqual(await admin.nextKind("whisper-answer"),{t:"whisper-answer",name:"한글용사",delivered:true});
  assert.deepEqual(await female.nextKind("chat"),{t:"chat",name:"Hero",text:"안녕하세요"});
  female.send({t:"whisper",name:"Hero",text:"반갑습니다"});
  assert.deepEqual(await admin.nextKind("chat"),{t:"chat",name:"한글용사",text:"반갑습니다"});
  admin.send({t:"find",name:"한글용사"});
  assert.equal((await admin.nextKind("find-answer")).name,"한글용사");
  female.send({t:"delete-character",id:created.id,confirmed:true});
  assert.match(String((await female.nextKind("error")).message),/selection is not active/);
  assert.equal(world.accounts.get("female")!.characters.length,1);
});

test("queued duplicate creates and a fourth character cannot overfill the three slots", {timeout:20000}, async(t)=>{
  const world=await startWorld(t),browser=await Browser.open(world.webPort);t.after(async()=>browser.close());
  browser.send({t:"login",user:"newbie",password:"newbie"});await browser.nextKind("login");
  browser.send({t:"world",index:0});await browser.nextKind("characters");
  browser.send({t:"create",name:"DupeHero"}); browser.send({t:"create",name:"DupeHero"});
  assert.equal((await browser.nextKind("created")).ok,true);
  assert.equal((await browser.nextKind("created")).ok,false);
  for(const name of ["SecondHero","ThirdHero"]){browser.send({t:"create",name});assert.equal((await browser.nextKind("created")).ok,true);}
  browser.send({t:"create",name:"FourthHero"});assert.equal((await browser.nextKind("created")).ok,false);
  assert.equal(world.accounts.get("newbie")!.characters.length,3);
  assert.equal(readSave(world.store.saved!).get("newbie")!.characters.length,3);
});

test("AP bridge uses authoritative stats, a native cooldown/ack and isolates other players", {timeout:20000}, async t => {
  const world=await startWorld(t,{ability:true});
  const {browser:admin,field}=await enterGame(world.webPort,"admin","admin");t.after(()=>admin.close());
  const {browser:alt}=await enterGame(world.webPort,"alt","alt");t.after(()=>alt.close());
  const self=field.self as Record<string,number>;
  assert.deepEqual([self.str,self.dex,self.int,self.luk,self.ap,self.sp,self.fame],[12,5,4,4,3,0,0]);
  admin.send({t:"ability-up",field:"str"});
  let update=(await admin.nextKind("self")).self as Record<string,number>;
  assert.deepEqual([update.str,update.ap],[13,2]);assert.equal((await admin.nextKind("ability-result")).changed,true);
  const hero=world.accounts.get("admin")!.characters[0]!.stats;
  assert.deepEqual([hero.str,hero.ap],[13,2]);assert.equal(world.accounts.get("alt")!.characters[0]!.stats.ap,2);
  admin.send({t:"ability-up",field:"dex"});
  update=(await admin.nextKind("self")).self as Record<string,number>;
  assert.deepEqual([update.dex,update.ap],[5,2],"server rejects even a bridge request within the native 500ms gate");
  assert.equal((await admin.nextKind("ability-result")).changed,false,"refusal releases pending rather than hanging");
  admin.send({t:"ability-up",field:"maxHp"});assert.match(String((await admin.nextKind("error")).message),/unsupported/);assert.equal(hero.ap,2);
  await new Promise(resolve=>setTimeout(resolve,510));
  admin.send({t:"ability-up",field:"dex"});update=(await admin.nextKind("self")).self as Record<string,number>;
  assert.deepEqual([update.dex,update.ap],[6,1]);assert.equal((await admin.nextKind("ability-result")).changed,true);
  await new Promise(resolve=>setTimeout(resolve,510));
  admin.send({t:"ability-up",field:"int"});update=(await admin.nextKind("self")).self as Record<string,number>;
  assert.deepEqual([update.int,update.ap],[5,0]);await admin.nextKind("ability-result");
  await new Promise(resolve=>setTimeout(resolve,510));
  admin.send({t:"ability-up",field:"luk"});update=(await admin.nextKind("self")).self as Record<string,number>;
  assert.deepEqual([update.luk,update.ap],[4,0]);assert.equal((await admin.nextKind("ability-result")).changed,false);
  // Re-enter through a new TCP/WS session: the record, not just the visible number, changed.
  await admin.close();
  const {browser:again,field:reentered}=await enterGame(world.webPort,"admin","admin");t.after(()=>again.close());
  const saved=reentered.self as Record<string,number>;assert.deepEqual([saved.str,saved.dex,saved.int,saved.luk,saved.ap],[13,6,5,4,0]);
});

test("AP messages cannot be used before field entry or with a forged field name", {timeout:20000}, async t => {
 const world=await startWorld(t,{ability:true}),browser=await Browser.open(world.webPort);t.after(()=>browser.close());
 browser.send({t:"ability-up",field:"str"});await browser.nextKind("error");
 browser.send({t:"ability-up",field:"ap"});assert.match(String((await browser.nextKind("error")).message),/unsupported/);
 assert.equal(world.accounts.get("admin")!.characters[0]!.stats.ap,3);
});

test("ClientSession keeps the combat CharacterData snapshot in sync and prevents duplicate pending AP requests", {timeout:20000}, async t=>{
 const world=await startWorld(t,{ability:true}),session=new ClientSession({loginPort:world.loginPort,gamePort:world.gamePort});t.after(()=>session.close());
 await session.login("admin","admin");const list=await session.selectWorld(0);const redirect=await session.selectCharacter(list.characters[0]!.stats.id);await session.enterGame(redirect);
 assert.equal(session.character!.stats.str,12);
 const done=new Promise<void>(resolve=>session.onEvent(event=>{if(event.kind==="ability-result"){assert.equal(event.changed,true);resolve();}}));
 const first=session.increaseAbility("str");await assert.rejects(session.increaseAbility("dex"),/pending/);await first;await done;
 assert.deepEqual([session.character!.stats.str,session.character!.stats.ap],[13,2],"attack damage must read the updated record, not the old login snapshot");
});

test("portal destination tn is carried as native spawn byte through real TCP and WebSocket", {timeout:20000}, async t => {
  const world=await startWorld(t),{browser,field}=await enterGame(world.webPort,"admin","admin");t.after(()=>browser.close());
  assert.equal((field.self as {spawnPortal:number}).spawnPortal,0);
  browser.send({t:"portal",name:"west00"});await browser.nextKind("request-release");
  const arrival=await browser.nextKind("field");assert.equal(arrival.mapId,2000000);
  assert.equal((arrival.self as {spawnPortal:number}).spawnPortal,1,"tn east00 is not sp");
  browser.send({t:"portal",name:"east00"});await browser.nextKind("request-release");
  const back=await browser.nextKind("field");assert.equal(back.mapId,1000000);assert.equal((back.self as {spawnPortal:number}).spawnPortal,1);
});
test("native map command denies by default, validates IDs, preserves field on missing maps and allows only authorized account", {timeout:20000}, async t => {
  const world=await startWorld(t,{mapCommands:true});
  const {browser:admin}=await enterGame(world.webPort,"admin","admin"),{browser:alt}=await enterGame(world.webPort,"alt","alt");t.after(()=>{admin.close();alt.close();});
  const list=await(await fetch(`http://127.0.0.1:${world.webPort}/api/maps`)).json() as {id:number}[];assert.deepEqual(list.map(m=>m.id),[1000000,2000000]);
  alt.send({t:"warp-map",mapId:2000000});await alt.nextKind("request-release");assert.match(String((await alt.nextKind("chat")).text),/disabled/);
  admin.send({t:"warp-map",mapId:2000000});await admin.nextKind("request-release");const moved=await admin.nextKind("field");assert.equal(moved.mapId,2000000);assert.equal((moved.self as {spawnPortal:number}).spawnPortal,0);
  admin.send({t:"warp-map",mapId:123456789});await admin.nextKind("request-release");assert.match(String((await admin.nextKind("chat")).text),/does not exist/);
  for(const mapId of [-1,1.5,999999999,2147483648]){admin.send({t:"warp-map",mapId});assert.match(String((await admin.nextKind("error")).message),/invalid map id/);}
  admin.send({t:"warp-map",mapId:1000000});await admin.nextKind("request-release");assert.equal((await admin.nextKind("field")).mapId,1000000,"invalid requests never strand the sender");
});
test("map command is disabled when no operator policy is configured", {timeout:20000}, async t => {
 const world=await startWorld(t),{browser}=await enterGame(world.webPort,"admin","admin");t.after(()=>browser.close());browser.send({t:"warp-map",mapId:2000000});await browser.nextKind("request-release");assert.match(String((await browser.nextKind("chat")).text),/disabled/);
});

test("browser slot requests cross native TCP: swap, wear, self/remote look, ack, refusal and save",{timeout:20000},async t=>{
 const world=await startWorld(t);const character=world.accounts.get("admin")!.characters[0]!;
 const cap=equipSlot(1002000);cap.str=3;cap.pad=7;cap.cuc=2;cap.ruc=4;character.items!.inventories[0]!.items.set(1,cap);
 character.items!.inventories[0]!.items.set(2,equipSlot(1002001));
 const {browser:observer}=await enterGame(world.webPort,"alt","alt"),{browser}=await enterGame(world.webPort,"admin","admin");t.after(()=>{browser.close();observer.close();});
 await browser.nextKind("inventory");await observer.quiet(20);
 const request=(fromSlot:number,toSlot:number)=>browser.send({t:"change-slot",tab:1,fromSlot,toSlot,count:-1});
 request(1,2);const swapped=await browser.nextKind("inventory");assert.equal(swapped.ack,true);assert.equal(character.items!.inventories[0]!.items.get(2),cap);
 request(2,-1);assert.match(String((await browser.nextKind("error")).message),/500ms/);
 await new Promise(r=>setTimeout(r,510));request(2,-1);
 const worn=await browser.nextKind("inventory"),own=await browser.nextKind("self");
 assert.equal((worn.inventory as {worn:{itemId:number;stats:{str:number};cuc:number}[]}).worn.find(x=>x.itemId===1002000)!.stats.str,3);
 assert.equal((own.self as {avatarItems:number[]}).avatarItems.includes(1002000),true);
 const look=await observer.nextKind("user-look");
 assert.equal((look.user as {avatarItems:number[]}|undefined)?.avatarItems.includes(1002000)??(look.avatarItems as number[]|undefined)?.includes(1002000),true);
 await new Promise(r=>setTimeout(r,510));request(20,3);assert.equal((await browser.nextKind("inventory")).ack,true,"empty refusal still unlocks");
 await new Promise(r=>setTimeout(r,510));request(-1,3);await browser.nextKind("inventory");await browser.nextKind("self");
 assert.equal(character.items!.inventories[0]!.items.get(3)!.itemId,1002000);assert.equal(character.items!.worn.has(1),false);
 const saved=world.store.load()!;assert.equal(saved.get("admin")!.characters[0]!.items!.inventories[0]!.items.get(3)!.itemId,1002000);
 for(const bad of [{tab:0,fromSlot:1,toSlot:2,count:-1},{tab:1,fromSlot:32768,toSlot:2,count:-1},{tab:2,fromSlot:-1,toSlot:2,count:-1},{tab:1,fromSlot:1.5,toSlot:2,count:-1}]){browser.send({t:"change-slot",...bad});await browser.nextKind("error");}
});
