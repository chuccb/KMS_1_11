import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Keep sources within the root erasableSyntaxOnly / ESNext module policy.
 * Bun can transpile additional syntax, but the project intentionally avoids it.
 */
const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  {
    pattern: /constructor\s*\([^)]*\b(private|public|protected|readonly)\b/s,
    what: "parameter property",
  },
  { pattern: /^\s*(export\s+)?enum\s/m, what: "enum" },
  { pattern: /^\s*(export\s+)?namespace\s/m, what: "namespace" },
  { pattern: /\bimport\s+\w+\s*=\s*require\(/, what: "import assignment" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("sources avoid TypeScript syntax that needs code generation", () => {
  const files = walk(new URL("../src", import.meta.url).pathname);
  assert.ok(files.length > 0, "expected source files");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(text)) assert.fail(`${file}: uses ${what}, which strip-only mode rejects`);
    }
  }
});
