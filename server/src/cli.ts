import { activeArt } from "./game/activeskills.ts";
import { skillCatalogOf, type SkillCatalog } from "./game/skills.ts";
import { creationCatalogOf } from "./game/creation.ts";
/**
 * kms111-rebuild CLI.
 *
 *   bun server/src/cli.ts capture --port 8484 [--mode session|framed|raw] [--out trace.jsonl]
 *   bun server/src/cli.ts decode trace.jsonl [--recv-seed <n>] [--send-seed <n>] [--json]
 *   bun server/src/cli.ts serve --port 8484 [--account user:pass] [--game-port 8485]
 *
 * `capture` runs the harness from ADR-004: point the original client (or the rewritten
 * one) at this port and it writes a JSONL trace of everything received.
 * `decode` replays that trace through the session cipher so the packets are readable.
 * `serve` is the login server: it answers the decoded login chain (0x01/0x02/0x03/0x05/0x06),
 * so a client can log in, pick a world and see the character-select screen.
 */
import { schemaJson, schemaText } from "./protocol/schema.ts";
import { runWzCommand } from "./wz/cli.ts";
import { WzArchive } from "./wz/archive.ts";
import { mapDataProvider, mapCatalogOf, type MapDestination, type MapData } from "./game/map.ts";
import { mobTemplateProvider } from "./game/mobs.ts";
import { npcTemplateProvider, npcWalkPolicy } from "./game/npcs.ts";
import { DEFAULT_PING_MS } from "./net/heartbeat.ts";
import { OnlineAccounts } from "./net/online.ts";
import { npcDialogueProvider } from "./game/dialogue.ts";
import { starterEquipmentIds } from "./game/equipment.ts";
import { FileSaveStore, loadAccounts } from "./game/save.ts";
import { startWebClient } from "./net/webclient.ts";
import { SHOPS, shopKeeper, unpricedShopItems, type ShopKeeper } from "./game/shops.ts";
import { consumeSpecProvider } from "./game/items.ts";
import { growthSkillProvider, type GrowthSkillProvider } from "./game/growth.ts";
import { itemCatalogOf, type ItemCatalog } from "./game/iteminfo.ts";
import { audioProviderOf, type AudioProvider } from "./game/audio.ts";
import { artProviderOf } from "./game/art.ts";
import type { ArtProvider } from "./net/webclient.ts";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CaptureServer,
  toJsonl,
  type CaptureMode,
  type CaptureRecord,
  type CaptureServerOptions,
} from "./net/capture.ts";
import { decodeTrace, formatDecoded, type TraceRecord } from "./net/decode.ts";
import {
  DEFAULT_MAP_ID,
  GameEntryServer,
  HandoffRegistry,
  LoginServer,
  type AccountRecord,
} from "./net/loginserver.ts";

const USAGE = `kms111-rebuild

usage:
  capture --port <n> [--mode session|framed|raw] [--handshake auto|off|<sendSeed>:<recvSeed>]
          [--handshake-body <hex>] [--host <addr>] [--out <file>] [--quiet]
  decode <trace.jsonl> [--c2s-seed <n>] [--s2c-seed <n>] [--json]
  schema [--json]                 the protocol catalogue: every packet we can decode, with the
                                  function that proves it (src/protocol/schema.ts)
  serve [--port <n>] [--host <addr>] [--account <user:pass>[,<user:pass>...]]
        [--world <name>[,<name>...]] [--game-ip <addr>] [--game-port <n>] [--map <id>]
        [--start-mesos <n>] [--map-command <off|all|user,user,...>]
        [--data <Data.wz|off>] [--mob-speed <px/s>] [--mob-respawn <ms>]
        [--npc-walk <none|all|id,id,...>] [--save <path|off>] [--ping <ms|off>] [--seed <n>]
        [--web-port <n>] [--handshake-body <hex>]
        [--test-tools off|all|<accounts>] [--quiet]
  wz <command> [options]          Data.wz, for the asset and map pipelines: images, census,
                                  maps, dump, png (src/wz/cli.ts; "wz help" lists them)

notes:
  capture --mode session (default) is the real client model: a 211-byte handshake opens the
  session and carries the two cipher seeds, then each packet is "u16 header + u16 bodyLength +
  encrypted body" and the header is verified against 0xD3 ^ HIWORD(state) (sub_43A410, sub_4A1940).
  --mode framed is the same framing without the handshake; --mode raw logs recv() chunks.
  A chunk that cannot be decoded is flagged once and from then on dumped as raw bytes, so an
  untrusted probe (or the sandbox preview proxy's HTTP GET) can never corrupt the trace.
  The client speaks second, so session mode sends the 211-byte handshake itself (--handshake
  auto, seeds chosen here and recorded in the trace) and then decrypts the client's replies.
  --handshake off waits for a client-sent handshake instead; --handshake 0xS:0xR pins the seeds
  for a reproducible experiment, and --handshake-body sets the 199 body bytes (still unknown;
  the trace shows what the client does with whatever you send).

  decode replays a trace through the session cipher: the header is MAGIC ^ HIWORD(state) and each
  body byte is key ^ swapNibbles(byte). MAGIC is 0xD3 client->server and 0xFF2C server->client
  (measured in both places; a server that echoes 0xD3 is disconnected by the client). If a 211-byte handshake is present its two u32 seeds are
  adopted automatically; otherwise pass --c2s-seed/--s2c-seed (the client's send/receive states).
  Seeds accept decimal or 0x hex.
  A header mismatch is reported per packet instead of being silently accepted.

  serve --game-port also spawns the map's monsters once the character is in, and then walks them:
  Data.wz is read for Map/Map/<mapId>.img (default: ./Data.wz when it exists, --data to point
  elsewhere, --data off to skip), one 0x2F is sent per "life" entry of type "m" (FINDINGS 4.15), and
  each mob that has a foothold gets one 0x33 per leg of its patrol (FINDINGS 4.16). --mob-speed sets
  the walking speed at 100% (default 60 px/s; the WZ's own info.speed scales it per mob).

  A swing (0x0F/0x10/0x11) is applied to those mobs: the damage is the client's own number, the mob
  loses it, and the answer is 0x34 (its MP, which is also what puts the mob into the flash state its
  hit animation needs) or, when the HP runs out, 0x30 - the die animation starts now - followed by
  0x31 flag=0 once that animation is over and 0x31 flag=1 when it respawns (FINDINGS 4.17).
  --mob-respawn sets the respawn delay (default 5000 ms); the die animation's length is read from
  Mob/<id>.img (the sum of its die frames' delay, the client's own sub_486180).

  Stationary archive-backed NPCs now have one designated controller for idle actions/speech.
  --npc-walk is a LEGACY name for explicit extra controller requests (none|all|template ids),
  notably movable NPCs. It is NOT a walk command: 0x3B designates a controller, 0x2F requests and
  0x3D acknowledges. The browser does not yet generate CVecCtrlNpc walking paths. Server ownership
  and transparent index relay are reconstruction policies; see docs/NATIVE_NPC_BEHAVIOR.md.
  A bare --npc-walk means "all"; absent/none leaves movable NPCs unassigned.

  --test-tools explicitly enables the DEVELOPMENT-ONLY browser panel for all or an account list.
  Default off; separate from --map-command. No native opcode is invented. Changes are explicit and
  saved to the current character. Ability/skill checkpoints are memory-only and level-guarded.

  --map-command explicitly allows the original /헉맵 map-jump packet (c2s 0x0D). Default: off.
  Use all only in a private development world, or a comma-separated account allowlist (e.g. admin).
  This is operator policy, not an invented original GM-rank check. Browser /map, /warp and /go use
  that packet; /maps [text] lists the real archive maps and /where reports the current position.

  --ping sets the heartbeat: every <ms> of silence this server asks a session "are you still there?"
  with 0x08 (the one packet the 2003 client always echoes, FINDINGS 4.2/4.30), and a session that has
  said nothing for three intervals is dropped - which frees the account and the character it was
  holding. The default is 30000 ms; --ping off disables the mechanism (then a client that vanished
  without closing its socket keeps its account refused as "already online" until the OS notices).
  --save keeps the accounts (and every character in them) between two runs of serve: accounts,
  characters, their items, exp, mesos and the map they are standing in (game/save.ts, ADR-017). The
  default is ./kms111-save.json; --save off keeps everything in memory, which is what the server did
  before it could save. The file wins over --account on startup (the seed is only what a *first* run
  starts from), and a file this build cannot read is refused - the server prints why and exits instead
  of overwriting it. Saves happen after a character is created or deleted and when a session leaves
  the field (the one place a character's play ends), written atomically: a crash never truncates it.

  --web-port serves the browser client in client/ (a page plus a WebSocket) on another port and
  bridges every browser connection to this server over real TCP: the 2003 packets, the cipher and
  the handshake are all still there, the browser just cannot open a socket itself (net/webclient.ts,
  ADR-034). The page logs in, picks a world and a character, then draws the map's footholds from
  /api/map/<id> and the players, monsters and NPCs it is told about; arrow keys send 0x0E and the
  chat box sends 0x12. It needs --game-port, because a browser tab cannot use the address in 0x03.

  wz png <image path> --out <dir> is the way to look at decoded pixels: it writes one PNG per
  canvas, so a wrong pixel format or a broken inflate is visible immediately instead of only
  showing up as a failing assertion (docs/WZ1_FORMAT.md 4.6).

  serve implements the login chain of docs/protocol/FINDINGS.md 4.7-4.9: it opens with the
  211-byte handshake, answers 0x01 with the world list, 0x02 with up to three character slots and
  0x03 with the game server address plus the character id; 0x06/0x04 handle name checks, 0x05 creates a
  character and 0x07 deletes one. Accounts and characters are in memory only (a restart forgets
  them) and created characters are stat-only; with --game-port it also opens the game-server
  listener, which claims the handoff and then sends 0x16, moving the client into --map (default
  1000000, a map that exists in Data.wz). The map id travels inside the CharacterData of 0x16
  (FINDINGS 4.11.2b), which is why the server can pick a map at all. Nothing else is served yet:
  mobs, skills and drops are still unknown (FINDINGS 6).
`;

/**
 * Where the accounts live when `--save` is not given.
 *
 * Next to the server, like `--data`'s default of `./Data.wz`: a save file that is not somewhere
 * obvious is a save file that gets lost. `.gitignore` keeps it out of a commit.
 */
const DEFAULT_SAVE_PATH = "kms111-save.json";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** Parses a seed as decimal or 0x-prefixed hex; returns undefined when absent or invalid. */
function parseSeed(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = /^0x/i.test(value) ? Number.parseInt(value.slice(2), 16) : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed >>> 0;
}

/** `auto` | `off` | `<sendSeed>:<recvSeed>` (each decimal or 0x hex). */
function parseHandshake(value: string | boolean | undefined): CaptureServerOptions["handshake"] {
  if (value === undefined || value === "auto") return "auto";
  if (value === "off") return "off";
  if (typeof value !== "string") return "auto";
  const [send, recv] = value.split(":");
  const sendSeed = parseSeed(send);
  const recvSeed = parseSeed(recv);
  if (sendSeed === undefined || recvSeed === undefined) {
    process.stderr.write(`invalid --handshake: expected auto, off, or <sendSeed>:<recvSeed>\n`);
    process.exit(1);
  }
  return { clientSendSeed: sendSeed, clientRecvSeed: recvSeed };
}

function runDecode(rest: string[]): number {
  const args = parseArgs(rest);
  const file = rest.find(
    (arg) => !arg.startsWith("--") && arg !== args["c2s-seed"] && arg !== args["s2c-seed"],
  );
  if (!file) {
    process.stderr.write(`decode needs a trace file\n\n${USAGE}`);
    return 1;
  }
  const records: TraceRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as TraceRecord);
    } catch {
      process.stderr.write(`skipping unparsable line: ${line.slice(0, 80)}\n`);
    }
  }

  const options = {
    c2sSeed: parseSeed(args["c2s-seed"]),
    s2cSeed: parseSeed(args["s2c-seed"]),
  };
  const result = decodeTrace(records, options);
  if (args.json === true) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  const mismatches = result.packets.filter((p) => !p.headerOk).length;
  process.stdout.write(
    `${records.length} records, ${result.packets.length} packets decoded, ${mismatches} header mismatches\n` +
      (result.handshake
        ? `handshake: clientSendSeed=0x${hex(result.handshake.clientSendSeed)} ` +
          `clientRecvSeed=0x${hex(result.handshake.clientRecvSeed)}\n`
        : "") +
      formatDecoded(result.packets),
  );
  return mismatches > 0 ? 2 : 0;
}

/** Hex string -> bytes, tolerating spaces and a 0x prefix. */
function fromHexArg(text: string): Uint8Array {
  const clean = text.replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    process.stderr.write(`invalid hex: ${text.slice(0, 40)}\n`);
    process.exit(1);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function clamp(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/** Parses `--account user:pass,user2:pass2` into the in-memory account table. */
function parseAccounts(value: string | boolean | undefined): Map<string, AccountRecord> {
  const accounts = new Map<string, AccountRecord>();
  if (typeof value !== "string") {
    accounts.set("admin", { password: "admin", characters: [] });
    return accounts;
  }
  for (const entry of value.split(",")) {
    const [user, pass] = entry.split(":");
    if (!user || !pass) {
      process.stderr.write(`invalid --account entry "${entry}" (expected user:pass)\n`);
      process.exit(1);
    }
    accounts.set(user, { password: pass, characters: [] });
  }
  return accounts;
}

async function runServe(rest: string[]): Promise<number> {
  const args = parseArgs(rest);
  const port = Number(args.port ?? 8484);
  const gamePort = args["game-port"] === undefined ? undefined : Number(args["game-port"]);
  const mapId = args.map === undefined ? DEFAULT_MAP_ID : Number(args.map);
  const webPort = args["web-port"] === undefined ? undefined : Number(args["web-port"]);
  const startMesos = args["start-mesos"] === undefined ? 0 : Number(args["start-mesos"]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`invalid --port: ${String(args.port)}\n`);
    return 1;
  }
  if (gamePort !== undefined && (!Number.isInteger(gamePort) || gamePort < 0 || gamePort > 65535)) {
    process.stderr.write(`invalid --game-port: ${String(args["game-port"])}\n`);
    return 1;
  }
  if (webPort !== undefined && (!Number.isInteger(webPort) || webPort < 0 || webPort > 65535)) {
    process.stderr.write(`invalid --web-port: ${String(args["web-port"])}\n`);
    return 1;
  }
  if (webPort !== undefined && gamePort === undefined) {
    process.stderr.write(
      "--web-port needs --game-port: the browser cannot connect to a TCP address in 0x03\n",
    );
    return 1;
  }
  if (!Number.isInteger(mapId) || mapId < 0) {
    process.stderr.write(
      `invalid --map: ${String(args.map)} (a map id from Data.wz, e.g. 1000000)\n`,
    );
    return 1;
  }
  if (!Number.isInteger(startMesos) || startMesos < 0 || startMesos > 0xffffffff) {
    process.stderr.write(
      `invalid --start-mesos: ${String(args["start-mesos"])} (0 = what the 2003 game gave)\n`,
    );
    return 1;
  }
  const mapCommandArg = args["map-command"];
  if (mapCommandArg !== undefined && (typeof mapCommandArg !== "string" || !mapCommandArg.trim())) {
    process.stderr.write("--map-command needs off, all, or a comma-separated account list\n");
    return 1;
  }
  const mapCommandPolicy = typeof mapCommandArg === "string" ? mapCommandArg.trim() : "off";
  const mapCommandUsers = new Set(
    mapCommandPolicy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const testArg = args["test-tools"];
  if (testArg !== undefined && (typeof testArg !== "string" || !testArg.trim())) {
    process.stderr.write("--test-tools needs off, all, or a comma-separated account list\n");
    return 1;
  }
  const testPolicy = typeof testArg === "string" ? testArg.trim() : "off";
  const testUsers = new Set(
    testPolicy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const host = typeof args.host === "string" ? args.host : "0.0.0.0";
  const quiet = args.quiet === true;
  const seed = parseSeed(args.seed);
  const seedAccounts = parseAccounts(args.account);
  const worldNames = typeof args.world === "string" ? args.world.split(",") : ["Scania"];
  const worlds = worldNames.map((name, index) => ({ name, unknownId: index }));
  const gameIp = typeof args["game-ip"] === "string" ? args["game-ip"] : "127.0.0.1";
  const handshakeBody =
    typeof args["handshake-body"] === "string"
      ? fromHexArg(String(args["handshake-body"]))
      : undefined;

  // Mobs come from the same Data.wz the client reads. `--data off` keeps the server archive-free
  // (useful for protocol work), and without the flag an existing ./Data.wz is picked up.
  const dataArg =
    args.data === true ? "Data.wz" : typeof args.data === "string" ? args.data : undefined;
  const dataPath =
    dataArg === "off" ? undefined : (dataArg ?? (existsSync("Data.wz") ? "Data.wz" : undefined));
  let mapProvider: ((mapId: number) => MapData | undefined) | undefined;
  let mapCatalog: (() => MapDestination[]) | undefined;
  let mobTemplate: ReturnType<typeof mobTemplateProvider> | undefined;
  let npcTemplate: ReturnType<typeof npcTemplateProvider> | undefined;
  let npcDialogue: ReturnType<typeof npcDialogueProvider> | undefined;
  let shops: ShopKeeper | undefined;
  let consumeSpec: ReturnType<typeof consumeSpecProvider> | undefined;
  let itemCatalog: ItemCatalog | undefined;
  let growthSkill: GrowthSkillProvider | undefined;
  let skills: SkillCatalog | undefined;
  let art: ArtProvider | undefined;
  let audio: AudioProvider | undefined;
  const shopWarnings: string[] = [];
  if (dataPath !== undefined) {
    try {
      const archive = WzArchive.open(dataPath);
      mapProvider = mapDataProvider(archive);
      mapCatalog = mapCatalogOf(archive, mapProvider);
      mobTemplate = mobTemplateProvider(archive);
      npcTemplate = npcTemplateProvider(archive);
      npcDialogue = npcDialogueProvider(archive);
      shops = shopKeeper(archive);
      consumeSpec = consumeSpecProvider(archive);
      growthSkill = growthSkillProvider(archive);
      skills = skillCatalogOf(archive);
      itemCatalog = itemCatalogOf(archive);
      art = artProviderOf(archive);
      audio = audioProviderOf(archive);
      // A shop row without a price cannot be sent (the client prints it), so it is collected here
      // and reported once the logger exists.
      for (const shop of SHOPS) {
        const unpriced = unpricedShopItems(shop, shops.priceOf);
        if (unpriced.length > 0) {
          shopWarnings.push(
            `shop ${shop.shopId}: no info/price for ${unpriced.join(", ")} - those rows are skipped`,
          );
        }
      }
    } catch (error) {
      process.stderr.write(
        `--data ${dataPath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }
  const mobSpeed = args["mob-speed"] === undefined ? undefined : Number(args["mob-speed"]);
  if (mobSpeed !== undefined && (!Number.isFinite(mobSpeed) || mobSpeed < 0)) {
    process.stderr.write(`invalid --mob-speed: ${String(args["mob-speed"])} (px/s at 100%)\n`);
    return 1;
  }
  const mobRespawn = args["mob-respawn"] === undefined ? undefined : Number(args["mob-respawn"]);
  if (mobRespawn !== undefined && (!Number.isFinite(mobRespawn) || mobRespawn < 0)) {
    process.stderr.write(`invalid --mob-respawn: ${String(args["mob-respawn"])} (ms)\n`);
    return 1;
  }

  let npcWalk: ((templateId: number) => boolean) | undefined;
  if (args["npc-walk"] !== undefined) {
    const spec = typeof args["npc-walk"] === "string" ? args["npc-walk"] : "all";
    try {
      npcWalk = npcWalkPolicy(spec);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  const log = quiet ? undefined : (line: string) => process.stdout.write(`[serve] ${line}\n`);
  // The heartbeat (net/heartbeat.ts): `off` means "no timers, trust TCP". A number is the interval;
  // a dropped session frees its account and character, so this is what makes "already online"
  // self-healing rather than a lockout (ADR-018).
  const pingArg = args.ping;
  let pingMs = DEFAULT_PING_MS;
  if (pingArg === "off") pingMs = 0;
  else if (typeof pingArg === "string") {
    pingMs = Number(pingArg);
    if (!Number.isInteger(pingMs) || pingMs < 0) {
      process.stderr.write(`invalid --ping: ${pingArg} (ms, or off)\n`);
      return 1;
    }
  }
  if (pingArg === true) {
    process.stderr.write(`invalid --ping: needs a value (ms, or off)\n`);
    return 1;
  }

  // Where the accounts live between two runs of this process (game/save.ts, ADR-017). `off` is what
  // this server did before it could save: accounts and characters in memory only. A save file this
  // build cannot read stops the start instead of being overwritten - the operator decides.
  const saveArg = args.save;
  const savePath =
    saveArg === "off" ? undefined : typeof saveArg === "string" ? saveArg : DEFAULT_SAVE_PATH;
  const saveStore =
    savePath === undefined
      ? undefined
      : new FileSaveStore({ path: savePath, ...(log ? { log } : {}) });
  let accounts: Map<string, AccountRecord>;
  try {
    accounts = loadAccounts(saveStore, seedAccounts, log);
  } catch (error) {
    process.stderr.write(
      `${savePath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const persist = saveStore === undefined ? undefined : () => saveStore.save(accounts);
  for (const warning of shopWarnings) log?.(warning);
  const handshake =
    seed === undefined
      ? { body: handshakeBody }
      : {
          clientSendSeed: seed,
          clientRecvSeed: seed ^ 0x5f3759df,
          body: handshakeBody,
        };
  const handoffs = new HandoffRegistry();
  // One table for both halves: an account that is logged in is refused at 0x01, and a session in a
  // field keeps its account taken even after the login connection is gone (net/online.ts).
  const online = new OnlineAccounts();
  const creationCatalog = art ? creationCatalogOf(art.reader) : undefined;
  const login = new LoginServer({
    accounts,
    worlds,
    gameServer: { ip: gameIp, port: gamePort ?? 0 },
    ...(creationCatalog ? { creationCatalog } : {}),
    ...(itemCatalog ? { itemCatalog } : {}),
    startMapId: mapId,
    startMesos,
    handoffs,
    online,
    pingMs,
    ...(handshake ? { handshake } : {}),
    ...(persist ? { persist } : {}),
    ...(log ? { log } : {}),
  });
  let game: GameEntryServer | undefined;
  let boundGamePort = gamePort ?? 0;
  let map: MapData | undefined;
  if (gamePort !== undefined) {
    game = new GameEntryServer({
      handoffs,
      online,
      pingMs,
      mapId,
      starterEquipmentIds: starterEquipmentIds(creationCatalog),
      allowTestTools: (username) =>
        testPolicy !== "off" && (testPolicy === "all" || testUsers.has(username)),
      allowMapCommand: (username) =>
        mapCommandPolicy !== "off" && (mapCommandPolicy === "all" || mapCommandUsers.has(username)),
      ...(mapProvider !== undefined ? { mapProvider } : {}),
      ...(mobTemplate !== undefined ? { mobTemplate } : {}),
      ...(npcTemplate !== undefined ? { npcTemplate } : {}),
      ...(npcDialogue !== undefined ? { npcDialogue } : {}),
      ...(npcWalk !== undefined ? { npcWalk } : {}),
      ...(shops !== undefined ? { shops } : {}),
      ...(consumeSpec !== undefined ? { consumeSpec } : {}),
      ...(growthSkill !== undefined ? { growthSkill } : {}),
      ...(skills !== undefined ? { skills } : {}),
      ...(itemCatalog !== undefined ? { itemCatalog } : {}),
      ...(art?.attackProfile !== undefined ? { basicAttack: art.attackProfile } : {}),
      ...(art?.reader
        ? { activeSkillArt: (id: number, level: number) => activeArt(art!.reader!, id, level) }
        : {}),
      ...(itemCatalog !== undefined
        ? {
            dropItemAllowed: (id: number) => itemCatalog?.info(id)?.cash === false,
          }
        : {}),
      ...(mobSpeed !== undefined ? { mobSpeedPxPerSecond: mobSpeed } : {}),
      ...(mobRespawn !== undefined ? { mobRespawnMs: mobRespawn } : {}),
      ...(handshake ? { handshake } : {}),
      ...(persist ? { persist } : {}),
      ...(log ? { log } : {}),
    });
    const info = await game.listen(gamePort, host);
    boundGamePort = info.port;
    log?.(
      `game entry listening on ${info.host}:${info.port} (claims the handoff, then 0x16 into the character's map, new characters in ${mapId})`,
    );
    map = mapProvider?.(mapId);
    if (mapProvider !== undefined && map === undefined) {
      log?.(
        `map ${mapId} is not in ${dataPath} - the client will still be sent into it, without mobs`,
      );
    }
  }
  const info = await login.listen(port, host);
  // The browser client (ADR-034). It dials this process over TCP, so it must come up after the two
  // listeners: `--web-port` with `--game-port` is checked above, and the login port is the one that
  // was just bound (port 0 becomes a real number here).
  let web: Awaited<ReturnType<typeof startWebClient>> | undefined;
  if (webPort !== undefined) {
    try {
      web = await startWebClient({
        partyInviteIdentity: game !== undefined,
        port: webPort,
        host,
        loginPort: info.port,
        gamePort: boundGamePort,
        gameHost: "127.0.0.1",
        ...(mapProvider !== undefined ? { mapProvider } : {}),
        ...(mapCatalog !== undefined ? { mapCatalog } : {}),
        ...(itemCatalog !== undefined ? { itemCatalog } : {}),
        ...(skills !== undefined ? { skills } : {}),
        ...(mobTemplate !== undefined ? { mobTemplate } : {}),
        ...(game
          ? {
              mobPresentation: (username: string, id: number, mobId: number) =>
                game!.mobPresentation(username, id, mobId),
              testTools: (username: string, id: number, request: unknown) =>
                game!.testTools(username, id, request),
            }
          : {}),
        ...(art !== undefined ? { art } : {}),
        ...(audio !== undefined ? { audio } : {}),
        ...(log ? { log } : {}),
      });
    } catch (error) {
      // The two listeners are already up; close them before reporting, or the operator's next run
      // hits the same ports and the message is about the wrong problem.
      process.stderr.write(
        `--web-port ${webPort}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      await login.close();
      await game?.close();
      return 1;
    }
  }
  process.stdout.write(
    `login server listening on ${info.host}:${info.port}\n` +
      `  accounts: ${[...accounts.keys()].map((name) => `${name}:${accounts.get(name)?.password}`).join(", ")}\n` +
      `  worlds:   ${worlds.map((world) => world.name).join(", ")}\n` +
      (gamePort === undefined
        ? `  game:     no --game-port, so the 0x03 reply points at port 0 (the client will fail to connect)\n`
        : `  game:     ${gameIp}:${boundGamePort} (handoff + 0x16 into the character's map; ` +
          `${map === undefined ? "no mobs" : `${map.mobs.length} mobs from ${map.imagePath}`})\n`) +
      `  handshake: ${handshake?.clientSendSeed !== undefined ? `pinned seed 0x${hex(handshake.clientSendSeed)}` : "random seeds per connection"}\n` +
      `  npc control: ${npcWalk === undefined ? "stationary idle; movable off (--npc-walk all|id,id,...)" : String(args["npc-walk"])}\n` +
      `  save:      ${savePath === undefined ? "memory only (--save <path> to keep it)" : savePath}\n` +
      `  test tools: ${testPolicy} (--test-tools; development only, default off)\n` +
      `  map commands: ${mapCommandPolicy} (--map-command; default off)\n` +
      `  heartbeat: ${pingMs === 0 ? "off (--ping <ms>)" : `0x08 every ${pingMs} ms, drop after ${pingMs * 3} ms`}\n` +
      `  browser:   ${web === undefined ? "off (--web-port <n> with --game-port)" : `http://${web.host === "0.0.0.0" ? "127.0.0.1" : web.host}:${web.port}/`}\n`,
  );
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await web?.close();
  await login.close();
  await game?.close();
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }
  if (command === "decode") return runDecode(rest);
  if (command === "wz") return runWzCommand(rest);
  if (command === "serve") return runServe(rest);
  if (command === "schema") {
    process.stdout.write(rest.includes("--json") ? schemaJson() : schemaText());
    return 0;
  }
  if (command !== "capture") {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }

  const args = parseArgs(rest);
  const port = Number(args.port ?? 8484);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`invalid --port: ${String(args.port)}\n`);
    return 1;
  }
  const mode: CaptureMode = args.mode === "framed" || args.mode === "raw" ? args.mode : "session";
  const out = typeof args.out === "string" ? args.out : undefined;
  const quiet = args.quiet === true;
  const handshake = parseHandshake(args.handshake);
  const handshakeBody =
    typeof args["handshake-body"] === "string"
      ? fromHexArg(String(args["handshake-body"]))
      : undefined;
  if (typeof handshake === "object" && handshakeBody) handshake.body = handshakeBody;

  if (out) writeFileSync(out, "", { flag: "w" }); // start a fresh trace

  let printed = 0;
  const onRecord = (record: CaptureRecord) => {
    if (out) appendFileSync(out, toJsonl([record]));
    if (!quiet) {
      const opcode =
        record.opcode !== undefined ? ` op=0x${record.opcode.toString(16).padStart(2, "0")}` : "";
      const body =
        record.plainHex !== undefined && record.plainHex !== record.hex
          ? `\n    plain ${clamp(record.plainHex)}`
          : "";
      process.stdout.write(
        `[${String(record.t).padStart(8)}ms] conn=${record.conn} ${record.kind.padEnd(14)} len=${String(record.len).padStart(5)}${opcode}` +
          (record.headerOk === false ? "  !! header mismatch" : "") +
          (record.note ? `  // ${record.note}` : "") +
          (record.hex ? `\n    ${clamp(record.hex)}` : "") +
          body +
          "\n",
      );
      printed++;
    }
  };

  const server = new CaptureServer({
    port,
    mode,
    out,
    onRecord,
    logLifecycle: true,
    handshake,
  });
  const info = await server.start();
  if (!quiet) {
    process.stdout.write(`capture listening on ${info.host}:${info.port} (mode=${info.mode})\n`);
    if (info.mode === "session") {
      process.stdout.write(
        handshake === "off"
          ? "waiting for the client's 211-byte handshake to adopt the cipher seeds\n"
          : "sending the 211-byte handshake on connect, then decrypting the client's packets\n",
      );
    }
    if (out) process.stdout.write(`writing trace to ${out}\n`);
    process.stdout.write("point the client at this port; Ctrl-C to stop\n");
  }

  const shutdown = async () => {
    await server.stop();
    process.stdout.write(`\nstopped after ${server.recordCount} records\n`);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return new Promise<number>(() => {
    /* run until a signal arrives */
    void printed;
  });
}

main(process.argv.slice(2))
  .then((code) => {
    if (typeof code === "number" && code !== 0) process.exit(code);
  })
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
