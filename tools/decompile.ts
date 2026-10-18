/** Raw-byte Hex-Rays helpers. Never decode CP949 as UTF-8 before locating functions. */
import { readFileSync } from "node:fs";

export interface DecompiledFunction {
  name: string;
  /** One-based source lines, inclusive. */
  start: number;
  end: number;
  lines: Buffer[];
}

export function decodeLiteral(bytes: Uint8Array): string {
  for (const encoding of ["euc-kr", "utf-8"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      // Match the original tool's CP949-first, UTF-8-second interpretation.
    }
  }
  return new TextDecoder("euc-kr").decode(bytes);
}

export function sourceLines(bytes: Uint8Array): Buffer[] {
  return Buffer.from(bytes)
    .toString("latin1")
    .split(/\r?\n/)
    .map((line) => Buffer.from(line, "latin1"));
}

export function stripComment(line: string): string {
  const at = line.indexOf("//");
  return at < 0 ? line : line.slice(0, at);
}

/** Definitions only: a prototype with a trailing // idb comment is not a new body. */
export function functionBodies(
  bytes: Uint8Array,
  namedFunctions = false,
): Map<string, DecompiledFunction> {
  const lines = sourceLines(bytes);
  const result = new Map<string, DecompiledFunction>();
  const head =
    /^(?:[A-Za-z_][\w:<>,*& ]*\s+)?(?:(?:__thiscall|__stdcall|__cdecl|__fastcall)\s+)?([A-Za-z_]\w*)\s*\(/;
  let current: DecompiledFunction | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const text = line.toString("latin1");
    const match = head.exec(text);
    if (
      match &&
      (namedFunctions || /^sub_[\dA-Fa-f]{6}$/.test(match[1])) &&
      !stripComment(text).trimEnd().endsWith(";")
    ) {
      current = { name: match[1], start: index + 1, end: index + 1, lines: [] };
      result.set(current.name, current);
    }
    if (current) {
      current.lines.push(line);
      current.end = index + 1;
    }
  }
  return result;
}

export function inlineLiterals(body: DecompiledFunction): string[] {
  const literals = new Set<string>();
  for (const line of body.lines) {
    for (const match of line.toString("latin1").matchAll(/"([^"\\\n]{2,120})"/g)) {
      literals.add(decodeLiteral(Buffer.from(match[1], "latin1")));
    }
  }
  return [...literals];
}

export function referencedSymbols(body: DecompiledFunction): string[] {
  return [
    ...new Set(
      body.lines.flatMap((line) =>
        [
          ...line
            .toString("latin1")
            .matchAll(/\b((?:byte|asc|a|unk|off|dword|word|loc|sub)_[\dA-F]{5,8})\b/g),
        ].map((match) => match[1]),
      ),
    ),
  ];
}

export function readFunctions(path: string): Map<string, DecompiledFunction> {
  return functionBodies(readFileSync(path));
}
