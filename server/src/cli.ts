/**
 * kms111-rebuild CLI.
 *
 *   node server/src/cli.ts capture --port 8484 [--mode session|framed|raw] [--out trace.jsonl]
 *   node server/src/cli.ts decode trace.jsonl [--recv-seed <n>] [--send-seed <n>] [--json]
 *   node server/src/cli.ts serve --port 8484 [--account user:pass] [--game-port 8485]
 *
 * `capture` runs the harness from ADR-004: point the original client (or the rewritten
 * one) at this port and it writes a JSONL trace of everything received.
 * `decode` replays that trace through the session cipher so the packets are readable.
 * `serve` is the login server: it answers the decoded login chain (0x01/0x02/0x03/0x05/0x06),
 * so a client can log in, pick a world and see the character-select screen.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  CaptureServer,
  toJsonl,
  type CaptureMode,
  type CaptureRecord,
  type CaptureServerOptions,
} from "./net/capture.ts";
import { decodeTrace, formatDecoded, type TraceRecord } from "./net/decode.ts";
import { GameEntryServer, HandoffRegistry, LoginServer, type AccountRecord } from "./net/loginserver.ts";

const USAGE = `kms111-rebuild

usage:
  capture --port <n> [--mode session|framed|raw] [--handshake auto|off|<sendSeed>:<recvSeed>]
          [--handshake-body <hex>] [--host <addr>] [--out <file>] [--quiet]
  decode <trace.jsonl> [--c2s-seed <n>] [--s2c-seed <n>] [--json]
  serve [--port <n>] [--host <addr>] [--account <user:pass>[,<user:pass>...]]
        [--world <name>[,<name>...]] [--game-ip <addr>] [--game-port <n>]
        [--seed <n>] [--handshake-body <hex>] [--quiet]

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

  serve implements the login chain of docs/protocol/FINDINGS.md 4.7-4.9: it opens with the
  211-byte handshake, answers 0x01 with the world list, 0x02 with up to three character slots and
  0x03 with the game server address plus the character id; 0x06/0x04 handle name checks, 0x05 creates a
  character and 0x07 deletes one. Accounts and characters are in memory only (a restart forgets
  them) and created characters are stat-only, because the CharacterData item block is not decoded
  yet. With --game-port it also opens the game-server listener, which claims the handoff and then
  holds the connection: the in-game packets (0x15-0x52) are not decoded yet, so nothing is invented.
`;

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

  const options = { c2sSeed: parseSeed(args["c2s-seed"]), s2cSeed: parseSeed(args["s2c-seed"]) };
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
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`invalid --port: ${String(args.port)}\n`);
    return 1;
  }
  if (gamePort !== undefined && (!Number.isInteger(gamePort) || gamePort < 0 || gamePort > 65535)) {
    process.stderr.write(`invalid --game-port: ${String(args["game-port"])}\n`);
    return 1;
  }
  const host = typeof args.host === "string" ? args.host : "0.0.0.0";
  const quiet = args.quiet === true;
  const seed = parseSeed(args.seed);
  const accounts = parseAccounts(args.account);
  const worldNames = typeof args.world === "string" ? args.world.split(",") : ["Scania"];
  const worlds = worldNames.map((name, index) => ({ name, unknownId: index }));
  const gameIp = typeof args["game-ip"] === "string" ? args["game-ip"] : "127.0.0.1";
  const handshakeBody =
    typeof args["handshake-body"] === "string" ? fromHexArg(String(args["handshake-body"])) : undefined;

  const log = quiet ? undefined : (line: string) => process.stdout.write(`[serve] ${line}\n`);
  const handshake = seed === undefined ? { body: handshakeBody } : { clientSendSeed: seed, clientRecvSeed: seed ^ 0x5f3759df, body: handshakeBody };
  const handoffs = new HandoffRegistry();
  const login = new LoginServer({
    accounts,
    worlds,
    gameServer: { ip: gameIp, port: gamePort ?? 0 },
    handoffs,
    ...(handshake ? { handshake } : {}),
    ...(log ? { log } : {}),
  });
  let game: GameEntryServer | undefined;
  if (gamePort !== undefined) {
    game = new GameEntryServer({ handoffs, ...(handshake ? { handshake } : {}), ...(log ? { log } : {}) });
    const info = await game.listen(gamePort, host);
    log?.(`game entry (stub) listening on ${info.host}:${info.port}`);
  }
  const info = await login.listen(port, host);
  process.stdout.write(
    `login server listening on ${info.host}:${info.port}\n` +
      `  accounts: ${[...accounts.keys()].map((name) => `${name}:${accounts.get(name)?.password}`).join(", ")}\n` +
      `  worlds:   ${worlds.map((world) => world.name).join(", ")}\n` +
      (gamePort === undefined
        ? `  game:     no --game-port, so the 0x03 reply points at port 0 (the client will fail to connect)\n`
        : `  game:     ${gameIp}:${gamePort} (handoff only so far; in-game packets are decoded but not served)\n`) +
      `  handshake: ${handshake?.clientSendSeed !== undefined ? `pinned seed 0x${hex(handshake.clientSendSeed)}` : "random seeds per connection"}\n`,
  );
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
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
  if (command === "serve") return runServe(rest);
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
    typeof args["handshake-body"] === "string" ? fromHexArg(String(args["handshake-body"])) : undefined;
  if (typeof handshake === "object" && handshakeBody) handshake.body = handshakeBody;

  if (out) writeFileSync(out, "", { flag: "w" }); // start a fresh trace

  let printed = 0;
  const onRecord = (record: CaptureRecord) => {
    if (out) appendFileSync(out, toJsonl([record]));
    if (!quiet) {
      const opcode = record.opcode !== undefined ? ` op=0x${record.opcode.toString(16).padStart(2, "0")}` : "";
      const body = record.plainHex !== undefined && record.plainHex !== record.hex ? `\n    plain ${clamp(record.plainHex)}` : "";
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

  const server = new CaptureServer({ port, mode, out, onRecord, logLifecycle: true, handshake });
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
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
