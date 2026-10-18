import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { decodeLiteral, functionBodies, referencedSymbols, sourceLines } from "./decompile.ts";

const USAGE =
  "Usage: bun tools/hexfunc.ts <decompile.c> <function> [--calls] [--globals SYMBOL ...] [--with-comments] | <decompile.c> --list PREFIX";
export function hexfunc(args: string[]): string {
  if (args.includes("--help") || args.includes("-h")) return USAGE;
  // argparse's old --globals accepted one or more names, including repeated flags.
  const globals: string[] = [],
    options: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--globals=")) {
      globals.push(args[i].slice(10));
      continue;
    }
    if (args[i] !== "--globals") {
      options.push(args[i]);
      continue;
    }
    const start = globals.length;
    while (i + 1 < args.length && !args[i + 1].startsWith("--")) globals.push(args[++i]);
    if (globals.length === start) throw new Error("--globals requires at least one symbol");
  }
  const { values, positionals } = parseArgs({
    args: options,
    allowPositionals: true,
    options: {
      list: { type: "string" },
      calls: { type: "boolean" },
      "with-comments": { type: "boolean" },
    },
  });
  const [path, name] = positionals;
  if (!path || (!name && values.list === undefined)) {
    throw new Error(USAGE);
  }
  const bytes = readFileSync(path);
  const bodies = functionBodies(bytes, true);
  if (values.list !== undefined)
    return [...bodies.values()]
      .filter((body) => body.name.startsWith(values.list!))
      .map(
        (body) =>
          `${String(body.start).padStart(8)}  ${decodeLiteral(body.lines[0]).slice(0, 100)}`,
      )
      .join("\n");
  const body = bodies.get(name!);
  if (!body) throw new Error(`Function ${name} not found`);
  // The splitter includes inter-function comments; print only through the closing brace.
  const closing = body.lines.findIndex(
    (line, index) => index > 0 && line.toString("latin1") === "}",
  );
  const lines = body.lines.slice(0, closing < 0 ? 200 : closing + 1);
  const shown = lines.filter(
    (line) => values["with-comments"] || !line.toString("latin1").trimStart().startsWith("//"),
  );
  const out = [
    `// ${basename(path)} lines ${body.start}-${body.start + lines.length - 1}`,
    ...shown.map(decodeLiteral),
  ];
  if (values.calls) {
    const calls = new Set<string>();
    for (const line of lines.slice(1))
      for (const match of line.toString("latin1").matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
        if (match[1] !== name && !/^(if|for|while|switch|sizeof|return)$/.test(match[1]))
          calls.add(match[1]);
      }
    out.push(`\n// calls (${calls.size}): ${[...calls].join(" ")}`);
  }
  for (const symbol of globals) {
    out.push(`\n// ${symbol}`);
    const hits = sourceLines(bytes)
      .flatMap((line, index) =>
        line.includes(Buffer.from(symbol)) ? [[index + 1, decodeLiteral(line)] as const] : [],
      )
      .slice(0, 6);
    out.push(
      ...hits.map(([line, text]) => `//   ${String(line).padStart(8)}  ${text.slice(0, 120)}`),
    );
  }
  const symbols = referencedSymbols({ ...body, lines }).sort();
  if (symbols.length)
    out.push(`\n// referenced data symbols (${symbols.length}): ${symbols.join(" ")}`);
  return out.join("\n");
}

if (import.meta.main) {
  try {
    console.log(hexfunc(Bun.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
