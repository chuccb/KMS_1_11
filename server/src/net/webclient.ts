import type { BaseAbility } from "../protocol/ability.ts";
import {
  creationCatalogOf,
  validateCreationLook,
  validCreationName,
} from "../game/creation.ts";
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
import { encodeCp949, decodeCp949 } from "../protocol/cp949.ts";
import type { ItemCatalog } from "../game/iteminfo.ts";
import type { CharacterData } from "../protocol/chardata.ts";
import { damageRangeFor, rollDamage } from "../game/combat.ts";
import type { AudioProvider } from "../game/audio.ts";
import type { MapData, MapDestination } from "../game/map.ts";
import type { MapArt } from "../game/mapart.ts";
import type { AvatarFrame } from "../game/avatar.ts";
import type { MobArt, NpcArt } from "../game/sprites.ts";
import type { ArtReader } from "../game/wzart.ts";
import { WebSocket, upgradeResponse } from "./websocket.ts";

/** Where `client/` lives when no root is given: the repository root, one level above `server/`. */
const DEFAULT_CLIENT_ROOT = fileURLToPath(
  new URL("../../../client", import.meta.url),
);

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
  mapCatalog?(): MapDestination[];
  /**
   * Names, prices and icons for the inventory (`game/iteminfo.ts`). Absent (or `--data off`) means
   * `/api/item/<id>` answers 404 - the page then shows an id and no icon, which is what the wire
   * really carried.
   */
  itemCatalog?: ItemCatalog;
  /**
   * The map's pictures (`game/mapart.ts`), the avatar compositor (`game/avatar.ts`) and the NPC/mob
   * frames (`game/sprites.ts`). Without them the page still draws the geometry, in flat colours -
   * `--data off` is a protocol session, not a screenshot.
   */
  art?: ArtProvider;
  audio?: AudioProvider;
  log?(line: string): void;
}

/**
 * Everything the page's renderer asks the server for, in one object.
 *
 * One provider per process, because all three parts share one `ArtReader` and that reader's cache is
 * what keeps the first field of a session from decoding every tile twice. `reader` is also what
 * `/api/png/...` decodes through, so a canvas the page already has costs nothing the second time.
 */
export interface ArtProvider {
  /** `Map/Map/%09d.img` as a flat sprite list, or `undefined` when the map is not in the archive. */
  mapArt(mapId: number): MapArt | undefined;
  npc(templateId: number): NpcArt | undefined;
  mob(templateId: number): MobArt | undefined;
  avatar(
    look: { face: number; hair: number; items: number[] },
    options: {
      stance?: string;
      frame?: number;
      emotion?: string;
      flip?: boolean;
    },
  ): AvatarFrame | undefined;
  /** The canvas at a `Map/Tile/...` style archive path, as `CanvasArt`. */
  reader: ArtReader | undefined;
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
  str: number;
  dex: number;
  int: number;
  luk: number;
  /** Worn item ids, so a character can be drawn before it enters the field. */
  items: number[];
}

function summaryOf(character: CharacterData): CharacterSummary {
  const stats = character.stats;
  const items =
    character.items === undefined
      ? []
      : [...character.items.worn.values()].map((slot) => slot.itemId);
  return {
    id: stats.id,
    name: decodeCp949(Uint8Array.from(stats.name, (c) => c.charCodeAt(0))),
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
    str: stats.str,
    dex: stats.dex,
    int: stats.int,
    luk: stats.luk,
    items: items.filter((itemId) => itemId !== 0),
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
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
  const segments: {
    layer?: number;
    group?: number;
    id: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    next: number;
    prev: number;
  }[] = [];
  for (const segment of map.footholdSegments?.values() ?? []) {
    segments.push({
      id: segment.id,
      layer: segment.layer,
      group: segment.group,
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
    bgm: map.bgm,
    portals: map.portals.map((portal) => ({
      name: portal.name,
      type: portal.type,
      x: portal.x,
      y: portal.y,
      toMapId: portal.toMapId,
      toName: portal.toName,
    })),
    footholds: segments,
    ladders: map.climbables ?? [],
    mobs: map.mobs.map((mob) => ({
      templateId: mob.templateId,
      x: mob.x,
      y: mob.y,
      foothold: mob.foothold,
    })),
    npcs: map.npcs.map((npc) => ({
      templateId: npc.templateId,
      x: npc.x,
      y: npc.y,
      foothold: npc.foothold,
    })),
  };
}

/** `/api/map/<id>/art`: the background stack, the tiles/objects and the camera's own bounds. */
function artJson(art: MapArt): unknown {
  return {
    miniMap: art.miniMap,
    portalFrames: art.portalFrames,
    missingTiles: art.missingTiles,
    missingTileSets: art.missingTileSets,
    backs: art.backs.map((back) => ({
      path: back.path,
      ox: back.ox,
      oy: back.oy,
      x: back.x,
      y: back.y,
      rx: back.rx,
      ry: back.ry,
      type: back.type,
      cx: back.cx,
      cy: back.cy,
      a: back.a,
      front: back.front,
      flip: back.flip,
    })),
    sprites: art.sprites.map((sprite) => ({
      kind: sprite.kind,
      layer: sprite.layer,
      x: sprite.x,
      y: sprite.y,
      z: sprite.z,
      flip: sprite.flip,
      frames: sprite.frames,
    })),
    bounds: art.bounds,
  };
}

/**
 * `/api/png/<archive path>`: one canvas, exactly as `Data.wz` stores it.
 *
 * The page draws tiles, objects and backgrounds by URL, so the browser's own image cache does the
 * memoising; this side keeps the decoded canvas in the `ArtReader` cache. Only the folders a field
 * can reference are served - an arbitrary path would turn the endpoint into an archive browser.
 */
const ART_ROOTS = [
  "Map/",
  "Character/",
  "Mob/",
  "Npc/",
  "Effect/",
  "Item/",
  "UI/",
];

/** Decodes and vets the `<archive path>` segment both canvas endpoints take; `undefined` = refused. */
function artPathOf(rest: string, response: ServerResponse): string | undefined {
  // The path is percent-encoded as one segment; `decodeURIComponent` turns it back into slashes.
  let path: string;
  try {
    path = decodeURIComponent(rest);
  } catch {
    sendJson(response, 400, {
      error: "the path is not valid percent-encoding",
    });
    return undefined;
  }
  if (
    path.includes("..") ||
    !ART_ROOTS.some((root) => path.startsWith(root)) ||
    !path.includes(".img")
  ) {
    sendJson(response, 404, {
      error: `"${path}" is not inside the art folders`,
    });
    return undefined;
  }
  return path;
}

function servePng(
  art: ArtProvider | undefined,
  rest: string,
  response: ServerResponse,
): void {
  if (art?.reader === undefined) {
    sendJson(response, 404, {
      error: "this server was started without Data.wz (--data off)",
    });
    return;
  }
  const path = artPathOf(rest, response);
  if (path === undefined) return;
  const canvas = art.reader.at(path);
  if (canvas === undefined) {
    sendJson(response, 404, { error: `no canvas at ${path}` });
    return;
  }
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": canvas.png.length,
    // The archive does not change under a running server, so the browser may keep every tile.
    "cache-control": "public, max-age=86400",
  });
  response.end(Buffer.from(canvas.png));
}

/**
 * `/api/canvas/<archive path>`: the same picture's size and origin.
 *
 * `/api/png` alone is enough for anything whose frame table already carries the origin (the map art
 * does, and so do `/api/mob` and `/api/npc`). It is not enough for a picture the page looks up from
 * data alone - a ground drop, whose path is built from the packet (`Item/Special/0900.img/0900000X`)
 * or from an item id - so this answers the metadata that a PNG cannot.
 */
function serveCanvasMeta(
  art: ArtProvider | undefined,
  rest: string,
  response: ServerResponse,
): void {
  if (art?.reader === undefined) {
    sendJson(response, 404, {
      error: "this server was started without Data.wz (--data off)",
    });
    return;
  }
  const path = artPathOf(rest, response);
  if (path === undefined) return;
  const canvas = art.reader.at(path);
  if (canvas === undefined) {
    sendJson(response, 404, { error: `no canvas at ${path}` });
    return;
  }
  sendJson(response, 200, {
    path,
    width: canvas.width,
    height: canvas.height,
    ox: canvas.ox,
    oy: canvas.oy,
  });
}

/** `/api/avatar.png?face=&hair=&items=&stance=&frame=&flip=&emotion=`: one composed frame. */
function serveAvatar(
  art: ArtProvider,
  url: URL,
  response: ServerResponse,
): void {
  const number = (name: string, fallback: number): number => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const look = {
    face: number("face", 20000),
    hair: number("hair", 30000),
    items: (url.searchParams.get("items") ?? "")
      .split(",")
      .map((piece) => Number(piece))
      .filter((id) => Number.isFinite(id) && id > 0),
  };
  const frame = art.avatar(look, {
    stance: url.searchParams.get("stance") ?? "stand1",
    frame: number("frame", 0),
    flip: url.searchParams.get("flip") === "1",
    ...(url.searchParams.get("emotion") !== null
      ? { emotion: String(url.searchParams.get("emotion")) }
      : {}),
  });
  if (frame === undefined) {
    sendJson(response, 404, { error: "the archive cannot compose this look" });
    return;
  }
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": frame.png.length,
    // Where the picture goes, relative to the character's feet.
    "x-frame-dx": String(frame.dx),
    "x-frame-dy": String(frame.dy),
    "access-control-expose-headers": "x-frame-dx, x-frame-dy",
    "cache-control": "public, max-age=3600",
  });
  response.end(Buffer.from(frame.png));
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
      if (binary)
        return this.send({
          t: "error",
          message: "binary frames are not part of this protocol",
        });
      void this.handle(data);
    };
    socket.onClose = () => this.close();
  }

  private send(message: unknown): void {
    this.socket.sendText(JSON.stringify(message));
  }

  private fail(error: unknown): void {
    this.send({
      t: "error",
      message: error instanceof Error ? error.message : String(error),
    });
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
          return await this.serialLogin(() =>
            this.login(
              String(message.user ?? ""),
              String(message.password ?? ""),
            ),
          );
        case "world":
          return await this.serialLogin(() =>
            this.selectWorld(Number(message.index ?? 0)),
          );
        case "character":
          return await this.serialLogin(() =>
            this.selectCharacter(Number(message.id ?? 0)),
          );
        case "create":
          return await this.serialLogin(() =>
            this.createCharacter(
              String(message.name ?? ""),
              message.appearance,
            ),
          );
        case "check-name":
          return await this.serialLogin(() =>
            this.checkName(String(message.name ?? ""), message.appearance),
          );
        case "delete-character":
          return await this.serialLogin(() =>
            this.deleteCharacter(
              Number(message.id),
              message.confirmed === true,
            ),
          );
        case "say":
          return await this.say(String(message.text ?? ""));
        case "move":
          return await this.move(
            Number(message.x ?? 0),
            Number(message.y ?? 0),
            Number(message.foothold ?? 0),
            Number(message.action ?? 0),
            Number(message.vx ?? 0),
            Number(message.vy ?? 0),
          );
        case "attack":
          return await this.attack(
            Number(message.mobId ?? 0),
            message.facingLeft === true,
          );
        case "warp-map":
          return await this.require().warpTo(Number(message.mapId));
        case "portal":
          return await this.usePortal(String(message.name ?? ""));
        case "ability-up": {
          const field = String(message.field);
          if (!["str", "dex", "int", "luk"].includes(field))
            throw new Error("unsupported base ability");
          return await this.require().increaseAbility(field as BaseAbility);
        }
        case "emotion":
          return await this.emotion(Number(message.value ?? 0));
        case "whisper":
          return await this.whisper(
            String(message.name ?? ""),
            String(message.text ?? ""),
          );
        case "find":
          return await this.find(String(message.name ?? ""));
        case "change-slot":
          return await this.require().changeSlot({
            tab: Number(message.tab),
            fromSlot: Number(message.fromSlot),
            toSlot: Number(message.toSlot),
            count: Number(message.count),
          });
        case "use":
          return await this.useItem(
            Number(message.slot ?? 0),
            Number(message.itemId ?? 0),
          );
        case "click":
          return await this.clickObject(Number(message.objectId ?? 0));
        case "shop":
          return await this.shopRequest(message);
        case "talk":
          return await this.talk(Number(message.answer ?? 0));
        default:
          return this.send({
            t: "error",
            message: `unknown message ${String(message.t)}`,
          });
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * `{t:"attack", mobId}`: the page's Ctrl swing. The page names the monster and the direction; the
   * numbers are the client's own, rolled here because the browser has no archive to read the
   * weapon's `incPAD` from (`game/combat.ts` says why that is the honest place for the formula).
   *
   * The field is told with `0x0F`, exactly like a 2003 client would tell it, and the page gets the
   * number back so it can draw the damage it just dealt (`{t:"hit"}`) - the wire has no such
   * packet: the attacker's own client drew the number while it built the packet.
   */
  private async attack(mobId: number, facingLeft: boolean): Promise<void> {
    const session = this.require();
    const mob = session.mob(mobId);
    if (mob === undefined) {
      return this.send({
        t: "error",
        message: `there is no mob ${mobId} in this field`,
      });
    }
    const character = session.character;
    if (character === undefined) return;
    const worn = [...(character.items?.worn.values() ?? [])].map(
      (slot) => slot.itemId,
    );
    const range = damageRangeFor(
      character.stats,
      worn,
      this.options.itemCatalog,
    );
    const damage = rollDamage(range);
    await session.attack([{ mobId, x: mob.x, y: mob.y, damage }], facingLeft);
    this.send({ t: "hit", mobId, damage });
  }

  private newSession(): ClientSession {
    this.unsubscribe?.();
    this.session?.close();
    const session = new ClientSession({
      loginPort: this.options.loginPort,
      ...(this.options.gamePort !== undefined
        ? { gamePort: this.options.gamePort }
        : {}),
      ...(this.options.gameHost !== undefined
        ? { gameHost: this.options.gameHost }
        : {}),
      ...(this.options.log !== undefined ? { log: this.options.log } : {}),
    });
    this.unsubscribe = session.onEvent((event) =>
      this.send(this.eventJson(event)),
    );
    this.session = session;
    return session;
  }

  private async login(user: string, password: string): Promise<void> {
    const session = this.newSession();
    const reply = await session.login(user, password);
    this.gender = reply.gender ?? 0;
    this.characterStage = false;
    this.lastCharacters = [];
    this.send({
      t: "login",
      result: reply.result,
      worlds: reply.worlds,
      gender: this.gender,
    });
  }

  private async selectWorld(index: number): Promise<void> {
    const session = this.require();
    const reply = await session.selectWorld(index);
    this.lastCharacters = reply.characters;
    this.characterStage = reply.result === 0;
    this.send({
      t: "characters",
      result: reply.result,
      characters: reply.characters.map((character) => summaryOf(character)),
    });
  }

  private async selectCharacter(id: number): Promise<void> {
    const session = this.requireCharacterStage();
    if (!this.lastCharacters.some((c) => c.stats.id === id))
      throw new Error("character is not in this account");
    const reply = await session.selectCharacter(id);
    if (reply.result !== 0) {
      this.send({ t: "characters", result: reply.result, characters: [] });
      return;
    }
    const character = this.lastCharacters.find(
      (candidate) => candidate.stats.id === id,
    );
    if (character !== undefined) session.remember(character);
    this.characterStage = false;
    await session.enterGame(reply);
  }

  /**
   * The one thing a fresh account cannot do without a 2003 client: make its first character.
   *
   * The reply is two messages, in this order: the refreshed list (so the page can show the new
   * button without another round trip) and a `created` line the page prints as-is. A refusal is not
   * an error - a taken name is the ordinary outcome of a typo - so it does not use the `error` type.
   */
  private loginQueue: Promise<unknown> = Promise.resolve();
  private characterStage = false;
  private gender = 0;
  private serialLogin<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.loginQueue.then(operation);
    this.loginQueue = next.catch(() => undefined);
    return next;
  }
  private requireCharacterStage(): ClientSession {
    if (!this.characterStage)
      throw new Error("character selection is not active");
    return this.require();
  }
  private creationArguments(
    name: string,
    value: unknown,
  ): { name: string; appearance: number[] } {
    const catalog = creationCatalogOf(this.options.art?.reader);
    const wire = String.fromCharCode(...encodeCp949(name));
    if (!validCreationName(wire, catalog?.forbidden))
      throw new Error(
        "角色名稱須為 4–12 個 CP949 bytes 的英數／韓文，且不可含禁用名稱或四個以上 I/l",
      );
    const groups = this.gender === 1 ? catalog?.female : catalog?.male;
    const defaults = [
      ...(groups?.map((g) => g[0]!.id) ?? [
        20000, 30000, 1040002, 1060002, 1072001, 1302000,
      ]),
      4,
      5,
      6,
      10,
    ];
    return {
      name: wire,
      appearance: validateCreationLook(value ?? defaults, catalog, this.gender),
    };
  }
  private async checkName(name: string, value: unknown): Promise<void> {
    const session = this.requireCharacterStage();
    const args = this.creationArguments(name, value);
    const result = await session.checkName(args.name, args.appearance);
    this.send({ t: "name-checked", name, result });
  }
  private async createCharacter(name: string, value: unknown): Promise<void> {
    const session = this.requireCharacterStage();
    const args = this.creationArguments(name, value);
    const reply = await session.createCharacter(args.name, args.appearance);
    if (reply.character !== undefined)
      this.lastCharacters.push(reply.character);
    this.send({
      t: "characters",
      result: 0,
      characters: this.lastCharacters.map(summaryOf),
    });
    if (reply.character !== undefined) {
      this.send({
        t: "created",
        ok: true,
        name: summaryOf(reply.character).name,
        id: reply.character.stats.id,
      });
    } else {
      this.send({
        t: "created",
        ok: false,
        name,
        reason:
          reply.nameCheck !== 0
            ? `name check ${reply.nameCheck}`
            : "the server refused the create",
      });
    }
  }
  private async deleteCharacter(id: number, confirmed: boolean): Promise<void> {
    const session = this.requireCharacterStage();
    if (!confirmed) throw new Error("delete requires explicit confirmation");
    if (
      !Number.isInteger(id) ||
      !this.lastCharacters.some((c) => c.stats.id === id)
    )
      throw new Error("character is not in this account");
    const ok = await session.deleteCharacter(id);
    if (ok)
      this.lastCharacters = this.lastCharacters.filter(
        (c) => c.stats.id !== id,
      );
    this.send({
      t: "characters",
      result: 0,
      characters: this.lastCharacters.map(summaryOf),
    });
    this.send({ t: "deleted", id, ok });
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

  private async move(
    x: number,
    y: number,
    foothold: number,
    action: number,
    vx: number,
    vy: number,
  ): Promise<void> {
    if (![x, y, foothold, action, vx, vy].every(Number.isFinite))
      throw new Error("non-finite movement");
    await this.require().moveTo(x, y, foothold, 100, action, vx, vy);
  }

  /**
   * A click on a portal. The name is the map's own `pn`, which is what the page draws and what the
   * 2003 client would have sent; the destination never comes from the browser. The arrival shows up
   * as the `field` event the server's `0x16` produces.
   */
  private async usePortal(name: string): Promise<void> {
    if (name === "")
      return this.send({ t: "error", message: "portal needs a name" });
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
    if (target === "")
      return this.send({ t: "error", message: "whisper needs a target name" });
    if (text === "")
      return this.send({ t: "error", message: "whisper needs a message" });
    await this.require().whisper(
      String.fromCharCode(...encodeCp949(target)),
      encodeCp949(text),
    );
  }

  /** `/헉추적`: `0x23` kind 0x05, answered by `find-answer` (`0x1A` 0x09). */
  private async find(name: string): Promise<void> {
    const target = name.trim();
    if (target === "")
      return this.send({ t: "error", message: "find needs a name" });
    await this.require().find(String.fromCharCode(...encodeCp949(target)));
  }

  /**
   * One USE-tab slot. The page sends both numbers because the wire carries both (`0x18`/`0x19`):
   * the slot is where the client clicked and the id is what it believes is there, and the server
   * refuses a pair that disagrees. The result is not a direct answer: the `0x0B`/`0x0D` the server
   * sends arrive as an `inventory` and a `self` event.
   */
  /**
   * A click on a field object: an NPC (`0x33`). The page hit-tests its own drawing, and the server
   * only accepts the runtime id it gave that NPC - a made-up id is a log line and the release byte.
   */
  private async clickObject(objectId: number): Promise<void> {
    if (!Number.isInteger(objectId) || objectId <= 0)
      return this.send({ t: "error", message: "click needs an object id" });
    await this.require().clickObject(objectId);
  }

  /**
   * One shop button - `{action:"buy", row, itemId, count}`, `{action:"sell", slot, itemId, count}`,
   * `{action:"recharge", slot}` or `{action:"close"}`.
   *
   * The page sends buy/sell quantities from the native-style input dialog, rechargeable requests,
   * and close. ClientSession validates wire ranges and owns the pending gate; the game server
   * validates the row, inventory, wallet and transaction.
   */
  private async shopRequest(message: Record<string, unknown>): Promise<void> {
    const action = String(message.action ?? "");
    if (action === "close") {
      await this.require().shop({ kind: "close" });
      return;
    }
    if (action === "recharge") {
      const slot = Number(message.slot ?? 0);
      if (!Number.isInteger(slot) || slot <= 0)
        return this.send({ t: "error", message: "shop recharge needs a slot" });
      await this.require().shop({ kind: "recharge", slot });
      return;
    }
    if (action !== "buy" && action !== "sell") {
      return this.send({
        t: "error",
        message: `shop action ${action || "(none)"} is not buy, sell, recharge or close`,
      });
    }
    const itemId = Number(message.itemId ?? 0);
    const count = Number(message.count ?? 0);
    if (!Number.isInteger(itemId) || itemId <= 0)
      return this.send({ t: "error", message: "shop needs an item id" });
    if (!Number.isInteger(count) || count <= 0)
      return this.send({ t: "error", message: "shop needs a count above 0" });
    if (action === "buy") {
      const row = Number(message.row ?? 0);
      if (!Number.isInteger(row) || row < 0)
        return this.send({ t: "error", message: "shop buy needs a row" });
      await this.require().shop({ kind: "buy", row, itemId, count });
      return;
    }
    const slot = Number(message.slot ?? 0);
    if (!Number.isInteger(slot) || slot <= 0)
      return this.send({ t: "error", message: "shop sell needs a slot" });
    await this.require().shop({ kind: "sell", slot, itemId, count });
  }

  /** One answer to an NPC's dialog: `1` is the primary button, `0` the secondary (which ends it). */
  private async talk(answer: number): Promise<void> {
    if (answer !== 0 && answer !== 1)
      return this.send({ t: "error", message: "talk answer must be 0 or 1" });
    await this.require().talk(answer);
  }

  private async useItem(slot: number, itemId: number): Promise<void> {
    if (!Number.isInteger(slot) || slot <= 0)
      return this.send({ t: "error", message: "use needs a USE-tab slot" });
    if (!Number.isInteger(itemId) || itemId <= 0)
      return this.send({ t: "error", message: "use needs an item id" });
    await this.require().useItem(slot, itemId);
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

/**
 * `/api/item/<id>` (the catalogue facts) and `/api/item/<id>/icon.png` (the archive's own pixels).
 *
 * These are **not** wire data: `0x0B` carries an id and a count, and everything a person reads about
 * an item - its name, its price, its icon - comes from `Data.wz`, which is what the 2003 client does
 * with the archive it loaded. Keeping the lookup on the server is also what lets the page be a
 * static file: the browser never parses WZ.
 *
 * Icons are cached by the browser for an hour (`immutable` would lie - `--data` can change) and by
 * the catalogue forever.
 */
function serveItem(
  catalog: ItemCatalog | undefined,
  rest: string,
  response: ServerResponse,
): void {
  const match = /^(\d{1,8})(\/icon\.png)?$/.exec(rest);
  if (match === null) {
    sendJson(response, 404, { error: `"${rest}" is not an item id` });
    return;
  }
  const id = Number(match[1]);
  if (catalog === undefined) {
    sendJson(response, 404, {
      error: "this server was started without Data.wz (--data off)",
    });
    return;
  }
  if (match[2] !== undefined) {
    const png = catalog.icon(id);
    if (png === undefined) {
      sendJson(response, 404, { error: `item ${id} has no icon in Data.wz` });
      return;
    }
    response.writeHead(200, {
      "content-type": "image/png",
      "content-length": png.length,
      "cache-control": "public, max-age=3600",
    });
    response.end(Buffer.from(png));
    return;
  }
  const info = catalog.info(id);
  if (info === undefined) {
    sendJson(response, 404, { error: `Data.wz has no item ${id}` });
    return;
  }
  sendJson(response, 200, info);
}

/** Serves one file out of `root`, or answers 404. */
function serveStatic(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
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
    "content-type":
      CONTENT_TYPES[extname(target).toLowerCase()] ??
      "application/octet-stream",
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
export function startWebClient(
  options: WebClientOptions,
): Promise<WebClientServer> {
  const root = options.root ?? DEFAULT_CLIENT_ROOT;
  const sockets = new Set<WebSocket>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/audio/")) {
      let path: string;
      try {
        path = decodeURIComponent(url.pathname.slice("/api/audio/".length));
      } catch {
        sendJson(response, 400, { error: "invalid audio path" });
        return;
      }
      let asset;
      try {
        asset = options.audio?.(path);
      } catch {
        sendJson(response, 422, { error: "invalid archive sound" });
        return;
      }
      if (!asset) {
        sendJson(response, 404, { error: "sound not found" });
        return;
      }
      const bytes = asset.data;
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Cache-Control", "public, max-age=3600");
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("X-Audio-Duration-Ms", asset.durationMs);
      response.setHeader("X-Audio-Sample-Rate", asset.sampleRate);
      response.setHeader("X-Audio-Channels", asset.channels);
      let start = 0,
        end = bytes.length - 1;
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, {
            "Content-Range": `bytes */${bytes.length}`,
          });
          response.end();
          return;
        }
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
        } else start = Math.max(0, bytes.length - Number(match[2]));
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= bytes.length
        ) {
          response.writeHead(416, {
            "Content-Range": `bytes */${bytes.length}`,
          });
          response.end();
          return;
        }
        end = Math.min(end, bytes.length - 1);
        response.statusCode = 206;
        response.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${bytes.length}`,
        );
      }
      response.setHeader("Content-Length", end - start + 1);
      response.end(
        request.method === "HEAD" ? undefined : bytes.subarray(start, end + 1),
      );
      return;
    }
    if (url.pathname === "/api/maps") {
      sendJson(response, 200, options.mapCatalog?.() ?? []);
      return;
    }
    if (url.pathname === "/api/creation") {
      const catalog = creationCatalogOf(options.art?.reader);
      sendJson(
        response,
        catalog ? 200 : 404,
        catalog ?? { error: "MakeCharInfo requires Data.wz" },
      );
      return;
    }
    if (url.pathname.startsWith("/api/map/")) {
      const rest = url.pathname.slice("/api/map/".length);
      const artSuffix = rest.endsWith("/art") ? "/art" : "";
      const id = Number(
        artSuffix === "" ? rest : rest.slice(0, -artSuffix.length),
      );
      if (!Number.isFinite(id)) {
        sendJson(response, 404, { error: `map ${rest} is not a map id` });
        return;
      }
      if (artSuffix === "/art") {
        // The art is the archive's answer, not the running game's: a session that is standing in a
        // stub map (the tests) can still ask for the pictures of a real one.
        const art = options.art?.mapArt(id);
        if (art === undefined) {
          sendJson(response, 404, {
            error: `map ${id} has no art in this archive`,
          });
          return;
        }
        sendJson(response, 200, artJson(art));
        return;
      }
      const map = options.mapProvider?.(id);
      if (map === undefined) {
        sendJson(response, 404, { error: `map ${rest} is not known` });
        return;
      }
      sendJson(response, 200, mapJson(map));
      return;
    }
    if (url.pathname.startsWith("/api/png/")) {
      servePng(options.art, url.pathname.slice("/api/png/".length), response);
      return;
    }
    if (url.pathname.startsWith("/api/canvas/")) {
      serveCanvasMeta(
        options.art,
        url.pathname.slice("/api/canvas/".length),
        response,
      );
      return;
    }
    if (url.pathname === "/api/avatar.png") {
      if (options.art === undefined) {
        sendJson(response, 404, {
          error: "this server was started without Data.wz (--data off)",
        });
        return;
      }
      serveAvatar(options.art, url, response);
      return;
    }
    if (url.pathname.startsWith("/api/npc/")) {
      const id = Number(url.pathname.slice("/api/npc/".length));
      const npc = Number.isFinite(id) ? options.art?.npc(id) : undefined;
      if (npc === undefined) {
        sendJson(response, 404, { error: `Npc/${id} is not in this archive` });
        return;
      }
      sendJson(response, 200, {
        templateId: npc.templateId,
        actions: npc.actions,
      });
      return;
    }
    if (url.pathname.startsWith("/api/mob/")) {
      const id = Number(url.pathname.slice("/api/mob/".length));
      const mob = Number.isFinite(id) ? options.art?.mob(id) : undefined;
      if (mob === undefined) {
        sendJson(response, 404, { error: `Mob/${id} is not in this archive` });
        return;
      }
      sendJson(response, 200, {
        templateId: mob.templateId,
        actions: mob.actions,
      });
      return;
    }
    if (url.pathname.startsWith("/api/item/")) {
      serveItem(
        options.itemCatalog,
        url.pathname.slice("/api/item/".length),
        response,
      );
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
      socket.end(
        `HTTP/1.1 ${upgrade.status} ${upgrade.reason}\r\nconnection: close\r\n\r\n`,
      );
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
      const port =
        typeof address === "object" && address !== null
          ? address.port
          : options.port;
      resolvePromise({
        port,
        host:
          typeof address === "object" && address !== null
            ? address.address
            : (options.host ?? "0.0.0.0"),
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
