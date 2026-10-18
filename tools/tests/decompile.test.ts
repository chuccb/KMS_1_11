import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCp949 } from "../../server/src/protocol/cp949.ts";
import { functionBodies, inlineLiterals, referencedSymbols } from "../decompile.ts";
import { hexfunc } from "../hexfunc.ts";
import { kstr } from "../kstr.ts";

const fixture = Buffer.concat([
  Buffer.from(
    '// evidence fixture\nint __thiscall sub_500010(void *self); // idb\nint __thiscall sub_500010(void *self)\n{\n  sub_470E10(self, "',
  ),
  Buffer.from(encodeCp949("귓속말")),
  Buffer.from(
    '");\n  return dword_5C212C;\n}\nint __cdecl sub_500020(int value)\n{\n  return value;\n}\n',
  ),
]);

test("raw-byte splitter ignores forward declarations and retains CP949 literals and source lines", () => {
  const bodies = functionBodies(fixture);
  expect([...bodies.keys()]).toEqual(["sub_500010", "sub_500020"]);
  const first = bodies.get("sub_500010")!;
  expect(first.start).toBe(3);
  expect(inlineLiterals(first)).toEqual(["귓속말"]);
  expect(referencedSymbols(first)).toContain("sub_470E10");
  expect(referencedSymbols(first)).toContain("dword_5C212C");
  expect(inlineLiterals(bodies.get("sub_500020")!)).toEqual([]);
});

test("Bun analysis CLIs preserve list, calls, symbols, Korean and missing-function failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "kms-decompile-"));
  try {
    const path = join(dir, "fixture.c");
    writeFileSync(
      path,
      Buffer.concat([fixture, Buffer.from("int __cdecl WinMain(void)\n{\n  return 0;\n}\n")]),
    );
    expect(hexfunc([path, "WinMain"])).toContain("WinMain(void)");
    expect(hexfunc([path, "--list", "Win"])).toContain("WinMain(void)");
    expect(hexfunc([path, "sub_500010", "--globals", "dword_5C212C", "sub_470E10"])).toContain(
      "// sub_470E10",
    );
    expect(() => hexfunc([path, "sub_500010", "--globals"])).toThrow("at least one");
    expect(kstr([path, "sub_500010"])).toBe("귓속말");
    expect(kstr([path, "--list"])).toContain("sub_500010");
    expect(kstr([path, "--list"])).not.toContain("sub_500020");
    expect(kstr([path, "sub_500020"])).toContain("no inline literals");
    expect(kstr([path, "sub_500010", "--names"])).toContain("dword_5C212C");
    const result = hexfunc([path, "sub_500010", "--calls", "--globals", "dword_5C212C"]);
    expect(result).toContain("lines 3-7");
    expect(result).toContain("귓속말");
    expect(result).toContain("calls (1): sub_470E10");
    expect(hexfunc([path, "--list", "sub_5000"])).toContain("sub_500020");
    expect(() => kstr([path, "sub_FFFFFF"])).toThrow("Unknown function");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
