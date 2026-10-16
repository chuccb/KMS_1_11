/**
 * kms111-rebuild CLI.
 *
 *   node server/src/cli.ts capture --port 8484 [--mode framed|raw] [--out trace.jsonl]
 *
 * `capture` runs the harness from ADR-004: point the original client (or the rewritten
 * one) at this port and it writes a JSONL trace of everything received.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { CaptureServer, toJsonl, type CaptureRecord } from "./net/capture.ts";

const USAGE = `kms111-rebuild

usage:
  capture --port <n> [--mode framed|raw] [--host <addr>] [--out <file>] [--quiet]

notes:
  framed (default) decodes the u16-LE length prefix recovered from the client
  (MapleStory.exe.c sub_43A410) and prints the first payload u16 as an opcode candidate.
  On a framing mismatch it stops framing and dumps raw bytes instead of dropping them.
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

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
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
  const mode = (args.mode === "raw" ? "raw" : "framed") as "framed" | "raw";
  const out = typeof args.out === "string" ? args.out : undefined;
  const quiet = args.quiet === true;

  if (out) writeFileSync(out, "", { flag: "w" }); // start a fresh trace

  let printed = 0;
  const onRecord = (record: CaptureRecord) => {
    if (out) appendFileSync(out, toJsonl([record]));
    if (!quiet) {
      const opcode = record.opcodeCandidate !== undefined ? ` op=0x${record.opcodeCandidate.toString(16)}` : "";
      process.stdout.write(
        `[${String(record.t).padStart(8)}ms] conn=${record.conn} ${record.kind.padEnd(14)} len=${String(record.len).padStart(5)}${opcode}` +
          (record.note ? `  // ${record.note}` : "") +
          (record.hex && record.hex.length <= 160 ? `\n    ${record.hex}` : record.hex ? `\n    ${record.hex.slice(0, 160)}...` : "") +
          "\n",
      );
      printed++;
    }
  };

  const server = new CaptureServer({ port, mode, out, onRecord, logLifecycle: true });
  const info = await server.start();
  if (!quiet) {
    process.stdout.write(`capture listening on ${info.host}:${info.port} (mode=${info.mode})\n`);
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
