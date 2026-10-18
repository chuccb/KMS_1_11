import { parseArgs } from "node:util";
import { inlineLiterals, readFunctions, referencedSymbols } from "./decompile.ts";

const USAGE =
  "Usage: bun tools/kstr.ts <decompile.c> <sub_XXXXXX> [--names] | <decompile.c> --list";
export function kstr(args: string[]): string {
  if (args.includes("--help") || args.includes("-h")) return USAGE;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { list: { type: "boolean" }, names: { type: "boolean" } },
  });
  const [path, name] = positionals;
  if (!path || (!name && !values.list)) {
    throw new Error(USAGE);
  }
  const bodies = readFunctions(path);
  if (values.list)
    return [...bodies]
      .flatMap(([key, body]) => {
        const count = inlineLiterals(body).length;
        return count ? [`${key.padStart(12)}  ${String(count).padStart(3)} literal(s)`] : [];
      })
      .join("\n");
  const body = bodies.get(name!);
  if (!body) throw new Error(`Unknown function ${name}`);
  const result = inlineLiterals(body);
  if (values.names) {
    const names = referencedSymbols(body);
    if (names.length) result.push("-- symbol names referenced --", ...names);
  } else if (!result.length) {
    result.push(`${name}: no inline literals (they may live in .rdata as byte_/asc_ refs)`);
  }
  return result.join("\n");
}

if (import.meta.main) {
  try {
    console.log(kstr(Bun.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
