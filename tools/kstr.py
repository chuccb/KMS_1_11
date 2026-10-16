#!/usr/bin/env python3
"""Print the string literals a decompiled function references, with the Korean decoded.

`MapleStory.exe.c` is a CP949 (EUC-KR) file: reading it as UTF-8 turns every Korean message into
replacement characters, which is how the *only* semantic label many of these functions have gets
lost (the 2003 client has no debug symbols; a handler is usually identified by the message it
prints).  This tool reads the raw bytes, finds the function body the way the other tools do, and
decodes each literal as CP949, so:

    python3 tools/kstr.py MapleStory.exe.c sub_512F90

prints e.g. `인기도를 올릴 수 없습니다`, which is enough to name the packet.

Two kinds of literals appear in the Hex-Rays output:
  * `"..."`      - a normal literal, printed as-is (CP949 decoded)
  * `byte_XXXX` / `asc_XXXX` - IDA could not inline it; the *name* is still printed, and the bytes
    can be read with tools/hexfunc.py or from the .lst (the string is stored in .rdata)
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

FUNC_HEAD = re.compile(
    rb"^(?:[A-Za-z_][\w:<>,*& ]*\s+)?(__thiscall |__stdcall |__cdecl |__fastcall )?(sub_[0-9A-Fa-f]{6})\("
)
LITERAL = re.compile(rb'"([^"\\\n]{2,120})"')
NAME_REFS = re.compile(rb"\b((?:byte|asc|a|unk|off|dword|sub)_[0-9A-F]{5,8})\b")


def function_bodies(path: pathlib.Path | str) -> dict[bytes, list[bytes]]:
    """Splits the decompile into {function name: body lines}, on raw bytes (CP949 safe)."""
    path = pathlib.Path(path)
    bodies: dict[bytes, list[bytes]] = {}
    current: bytes | None = None
    buf: list[bytes] = []
    with path.open("rb") as handle:
        for line in handle:
            match = FUNC_HEAD.match(line)
            if match:
                # A forward declaration (`... sub_X(...);`) is not a body start: keep it with the
                # previous function so the line numbers stay honest.
                if b";" not in line.rstrip() or b"{" in line:
                    if current is not None:
                        bodies[current] = buf
                    current = match.group(2)
                    buf = []
            if current is not None:
                buf.append(line.rstrip(b"\r\n"))
    if current is not None:
        bodies[current] = buf
    return bodies


def decode(raw: bytes) -> str:
    for encoding in ("cp949", "utf-8"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("cp949", errors="replace")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("decompile", help="path to MapleStory.exe.c")
    parser.add_argument("function", nargs="?", help="function name, e.g. sub_512F90")
    parser.add_argument("--list", action="store_true", help="list the functions that contain literals")
    parser.add_argument("--names", action="store_true", help="also print byte_/asc_ symbol names")
    args = parser.parse_args(argv)
    if args.function is None and not args.list:
        parser.error("either give a function name or pass --list")

    path = pathlib.Path(args.decompile)
    bodies = function_bodies(path)
    if args.list:
        for name, lines in bodies.items():
            count = sum(len(LITERAL.findall(line)) for line in lines)
            if count:
                print(f"{decode(name):>12}  {count:3d} literal(s)")
        return 0

    want = args.function.encode()
    body = bodies.get(want)
    if body is None:
        print(f"unknown function {args.function}", file=sys.stderr)
        return 1

    seen: list[str] = []
    for line in body:
        for literal in LITERAL.findall(line):
            text = decode(literal)
            if text not in seen:
                seen.append(text)
    for text in seen:
        print(text)
    if args.names:
        names: list[str] = []
        for line in body:
            for name in NAME_REFS.findall(line):
                decoded = decode(name)
                if decoded not in names:
                    names.append(decoded)
        if names:
            print("-- symbol names referenced --")
            for name in names:
                print(name)
    if not seen and not args.names:
        print(f"{args.function}: no inline literals (they may live in .rdata as byte_/asc_ refs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
