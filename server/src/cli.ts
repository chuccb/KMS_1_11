/**
 * kms111-rebuild CLI.
 *
 *   node server/src/cli.ts capture --port 8484 [--mode session|framed|raw] [--out trace.jsonl]
 *   node server/src/cli.ts decode trace.jsonl [--recv-seed <n>] [--send-seed <n>] [--json]
 *
 * `capture` runs the harness from ADR-004: point the original client (or the rewritten
 * one) at this port and it writes a JSONL trace of everything received.
 * `decode` replays that trace through the session cipher so the packets are readable.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { CaptureServer, toJsonl, type CaptureMode, type CaptureRecord } from "./net/capture.ts";
import { decodeTrace, formatDecoded, type TraceRecord } from "./net/decode.ts";

const USAGE = `kms111-rebuild

usage:
  capture --port <n> [--mode session|framed|raw] [--host <addr>] [--out <file>] [--quiet]
  decode <trace.jsonl> [--recv-seed <n>] [--send-seed <n>] [--json]

notes:
  capture --mode session (default) is the real client model: a 211-byte handshake opens the
  session and carries the two cipher seeds, then each packet is "u16 header + u16 bodyLength +
  encrypted body" and the header is verified against 0xD3 ^ HIWORD(state) (sub_43A410, sub_4A1940).
  --mode framed is the same framing without the handshake; --mode raw logs recv() chunks.
  A chunk that cannot be decoded is flagged once and from then on dumped as raw bytes, so an
  untrusted probe (or the sandbox preview proxy's HTTP GET) can never corrupt the trace.

  decode replays a trace through the session cipher: the header is 0xD3 ^ HIWORD(state) and each
  body byte is key ^ swapNibbles(byte). If a 211-byte handshake is present its two u32 seeds are
  adopted automatically; otherwise pass --recv-seed/--send-seed. Seeds accept decimal or 0x hex.
  A header mismatch is reported per packet instead of being silently accepted.
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

function runDecode(rest: string[]): number {
  const args = parseArgs(rest);
  const file = rest.find((arg) => !arg.startsWith("--") && arg !== args.recvSeed && arg !== args.sendSeed);
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

  const options = { recvSeed: parseSeed(args.recvSeed), sendSeed: parseSeed(args.sendSeed) };
  const result = decodeTrace(records, options);
  if (args.json === true) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  const mismatches = result.packets.filter((p) => !p.headerOk).length;
  process.stdout.write(
    `${records.length} records, ${result.packets.length} packets decoded, ${mismatches} header mismatches\n` +
      (result.handshake
        ? `handshake seeds: sendSeed=0x${result.handshake.sendSeed.toString(16)} recvSeed=0x${result.handshake.recvSeed.toString(16)}\n`
        : "") +
      formatDecoded(result.packets),
  );
  return mismatches > 0 ? 2 : 0;
}

function clamp(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }
  if (command === "decode") return runDecode(rest);
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

  const server = new CaptureServer({ port, mode, out, onRecord, logLifecycle: true });
  const info = await server.start();
  if (!quiet) {
    process.stdout.write(`capture listening on ${info.host}:${info.port} (mode=${info.mode})\n`);
    if (info.mode === "session") {
      process.stdout.write("waiting for the client's 211-byte handshake to adopt the cipher seeds\n");
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
