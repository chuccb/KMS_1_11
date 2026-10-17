#!/usr/bin/env python3
"""Pull a single function out of a Hex-Rays dump.

The dumps (`*.exe.c`, `*.dll.c`) are tens of thousands of lines, so reading one function at a
time is the only practical way to work. This finds a function definition by name and prints it,
optionally with the surrounding globals/types it references and the functions it calls.

Usage:
  python3 tools/hexfunc.py MapleStory.exe.c sub_43B400
  python3 tools/hexfunc.py MapleStory.exe.c sub_43B400 --calls     # follow one level of calls
  python3 tools/hexfunc.py MapleStory.exe.c --list sub_43B           # list matching functions
  python3 tools/hexfunc.py MapleStory.exe.c sub_43B400 --globals dword_5C212C

Evidence notes: the `*.c` file is decompiler output, which is a *hypothesis about intent*. The
`*.lst` disassembly next to it is what the CPU actually executes. Prefer the .lst when a line
matters, and record which one a claim came from (docs/protocol/FINDINGS.md).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# A function definition starts at column 0 with a return type and ends at a line that is exactly "}".
DEF_RE = re.compile(r"^(?:[A-Za-z_][\w \*]*?)\b([A-Za-z_]\w*)\s*\(")
CALL_RE = re.compile(r"\b(sub_[0-9A-Fa-f]+|[A-Za-z_]\w*)\s*\(")
IDENT_RE = re.compile(r"\b(sub_[0-9A-Fa-f]+|dword_[0-9A-Fa-f]+|byte_[0-9A-Fa-f]+|word_[0-9A-Fa-f]+|off_[0-9A-Fa-f]+|unk_[0-9A-Fa-f]+|loc_[0-9A-Fa-f]+)\b")


def strip_comment(line: str) -> str:
    """Drop a trailing // comment so `Type name(...); // idb` counts as a declaration."""
    idx = line.find("//")
    return line if idx < 0 else line[:idx]


def find_function(lines: list[str], name: str) -> tuple[int, int]:
    """Return the [start, end) line range of `name`'s definition (not its declaration)."""
    for i, line in enumerate(lines):
        if line.startswith("//") or strip_comment(line).rstrip().endswith(";"):
            continue  # the forward-declaration block at the top of the dump
        if DEF_RE.match(line) and re.search(rf"\b{re.escape(name)}\s*\(", line):
            for j in range(i, len(lines)):
                if j > i and lines[j] == "}":
                    return i, j + 1
            return i, min(len(lines), i + 200)
    raise SystemExit(f"function {name} not found")


def find_global(lines: list[str], name: str, limit: int = 6) -> list[tuple[int, str]]:
    hits = [(i + 1, line.rstrip()) for i, line in enumerate(lines) if name in line]
    return hits[:limit]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("name", nargs="?")
    parser.add_argument("--list", metavar="PREFIX", help="list function definitions starting with PREFIX")
    parser.add_argument("--calls", action="store_true", help="also print the functions it calls (one level)")
    parser.add_argument("--globals", nargs="+", default=[], help="print declaration lines mentioning these symbols")
    parser.add_argument("--with-comments", action="store_true", help="keep // comment lines inside the body")
    args = parser.parse_args(argv)

    lines = args.source.read_text(encoding="utf-8", errors="replace").splitlines()

    if args.list is not None:
        for i, line in enumerate(lines):
            if line.startswith("//") or not DEF_RE.match(line) or strip_comment(line).rstrip().endswith(";"):
                continue
            match = re.search(rf"\b{re.escape(args.list)}\w*\s*\(", line)
            if match:
                print(f"{i + 1:>8}  {line[:100]}")
        return 0

    if not args.name:
        parser.error("a function name is required (or use --list)")

    start, end = find_function(lines, args.name)
    body = [line for line in lines[start:end] if args.with_comments or not line.lstrip().startswith("//")]
    print(f"// {args.source.name} lines {start + 1}-{end}")
    print("\n".join(body))

    if args.calls:
        called: list[str] = []
        for line in body[1:]:
            for match in CALL_RE.finditer(line):
                name = match.group(1)
                if name not in called and name != args.name and not name.startswith(("if", "for", "while", "switch", "sizeof", "return")):
                    called.append(name)
        print(f"\n// calls ({len(called)}): {' '.join(called)}")

    for symbol in args.globals:
        print(f"\n// {symbol}")
        for line_no, line in find_global(lines, symbol):
            print(f"//   {line_no:>8}  {line[:120]}")

    symbols = sorted(set(IDENT_RE.findall("\n".join(body))))
    if symbols:
        print(f"\n// referenced data symbols ({len(symbols)}): {' '.join(symbols)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:  # piping into head is normal here
        sys.exit(0)
