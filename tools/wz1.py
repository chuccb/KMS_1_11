"""WZ v1 (Data.wz, MapleStory 2003 "Package file v1.0") reader.

Format reconstructed from the original client binaries in this repo:
  - header     : "PKG1" + u64 shellSize + u32 dataOffset + null-terminated description
  - at dataOffset: u16 wzVersion, then the WzDirectory tree (blocks, prefix order)
  - block      : compact-int childCount, then childCount entries
  - entry      : u8 type (3=directory, 4=image), string name,
                 compact-int size, compact-int checksum, u32 cacheKey
  - string     : u8 len byte
                   len == 0x00            -> empty
                   len & 0x80 (== 0x80)   -> ASCII: 0x80 then int32 length
                   len & 0x80 (!= 0x80)   -> ASCII: length = -signed(len)
                   else (== 0x7F)         -> UTF-16: 0x7F then int32 length
                   else                   -> UTF-16: length = len
                 ASCII payload: len bytes, plaintext[i] = byte[i] ^ ((i - 86) & 0xFF)
                 UTF-16 payload: 2*len bytes, word[i] ^= (i - 21846) & 0xFFFF
  - image data : the blobs start right after the directory tree (``tree_end``)
                 and follow each other in tree order; the entry has **no offset
                 field**, so ``data_offset`` is the cumulative sum the client
                 derives the same way.  This archive carries unlisted objects
                 between blobs, so treat ``data_offset`` as a hint and verify it
                 (tools/wzdata.py DataWz.resolve does, and falls back to scanning
                 the file for Property objects and matching by size).
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from typing import BinaryIO, Iterator

ASCII_KEY_BASE = 86  # plaintext[i] = enc[i] ^ ((i - 86) & 0xFF)  -> mask starts 0xAA, +1 each byte
UTF16_KEY_BASE = 21846  # 0x5556 -> mask starts 0xAAAA, +1 each code unit

TYPE_DIRECTORY = 3
TYPE_IMAGE = 4
TYPE_NAME_REFERENCE = 2  # name is a 4-byte back-reference into the archive string cache


@dataclass
class WzEntry:
    type: int
    name: str
    size: int
    checksum: int
    cache_key: int
    path: str = ""
    data_offset: int | None = None
    children: list["WzEntry"] = field(default_factory=list)

    @property
    def is_directory(self) -> bool:
        return self.type == TYPE_DIRECTORY


class WzV1File:
    def __init__(self, path: str) -> None:
        self.path = path
        self.f: BinaryIO = open(path, "rb")
        raw = self.f.read(4)
        if raw != b"PKG1":
            raise ValueError(f"not a WZ v1 package: {raw!r}")
        self.shell_size = struct.unpack("<Q", self.f.read(8))[0]
        self.data_start = struct.unpack("<I", self.f.read(4))[0]
        self.description = self._read_c_string()
        self.f.seek(self.data_start)
        self.wz_version = struct.unpack("<H", self.f.read(2))[0]
        self.root: list[WzEntry] = []
        self._tree_end = 0

    # ---- primitives ----------------------------------------------------
    def _read_c_string(self) -> str:
        out = bytearray()
        while (b := self.f.read(1)) and b != b"\x00":
            out += b
        return out.decode("latin1")

    def _u8(self) -> int:
        return self.f.read(1)[0]

    def _int32(self) -> int:
        return struct.unpack("<i", self.f.read(4))[0]

    def read_compact_int(self) -> int:
        b = self._u8()
        if b == 0x80:
            return self._int32()
        return b - 256 if b >= 128 else b

    def read_string(self) -> str:
        length = self._u8()
        if length == 0:
            return ""
        if length & 0x80:
            if length == 0x80:
                length = self._int32()
            else:
                length = 256 - length  # ASCII length stored as -(signed byte)
            raw = self.f.read(length)
            return bytes(
                b ^ ((i - ASCII_KEY_BASE) & 0xFF) for i, b in enumerate(raw)
            ).decode("latin1")
        if length == 0x7F:
            length = self._int32()
        raw = self.f.read(2 * length)
        out = bytearray(2 * length)
        for i in range(length):
            word = (raw[2 * i] | (raw[2 * i + 1] << 8)) ^ ((i - UTF16_KEY_BASE) & 0xFFFF)
            out[2 * i] = word & 0xFF
            out[2 * i + 1] = word >> 8
        return out.decode("utf-16le")

    # ---- structure -----------------------------------------------------
    def parse(self) -> "WzV1File":
        self._string_cache: dict[int, str] = {}
        self.root = self._parse_block("")
        self._tree_end = self.f.tell()
        self._assign_offsets()
        return self

    def _parse_block(self, prefix: str) -> list[WzEntry]:
        count = self.read_compact_int()
        entries: list[WzEntry] = []
        for _ in range(count):
            tag_offset = self.f.tell()
            etype = self._u8()
            if etype == TYPE_NAME_REFERENCE:
                ref = struct.unpack("<I", self.f.read(4))[0]
                name = self._string_cache.get(ref)
                if name is None:
                    raise ValueError(f"unresolved name reference {ref:#x} at {tag_offset:#x}")
            else:
                name = self.read_string()
                self._string_cache[tag_offset - self.data_start] = name
            size = self.read_compact_int()
            checksum = self.read_compact_int()
            cache_key = struct.unpack("<I", self.f.read(4))[0]
            path = f"{prefix}/{name}" if prefix else name
            entry = WzEntry(etype, name, size, checksum, cache_key, path=path)
            entries.append(entry)
        for entry in entries:  # child blocks follow, prefix order
            if entry.is_directory:
                entry.children = self._parse_block(entry.path)
        return entries

    def _assign_offsets(self) -> None:
        """Image blobs start at ``tree_end`` and follow each other in tree order.

        The entry carries no offset, so this is the layout the client derives as
        well.  It is only exact while nothing sits between the blobs; this repo's
        ``Data.wz`` has 172,999 bytes of unlisted objects in there, hence the
        verification in ``tools/wzdata.py`` (which resolves the remaining images
        by scanning the file for Property objects and matching sizes).
        """
        cursor = self._tree_end
        for img in self.walk():
            if img.type != TYPE_IMAGE:
                continue
            img.data_offset = cursor
            cursor += img.size
        self._data_start = self._tree_end

    @property
    def tree_end(self) -> int:
        """Offset of the first image blob (end of the directory tree)."""
        return self._tree_end

    # ---- helpers -------------------------------------------------------
    def walk(self, entries: list[WzEntry] | None = None) -> Iterator[WzEntry]:
        for entry in entries if entries is not None else self.root:
            yield entry
            if entry.is_directory:
                yield from self.walk(entry.children)

    def find(self, path: str) -> WzEntry | None:
        node: WzEntry | None = None
        stack = list(reversed(self.root))
        while stack:
            cur = stack.pop()
            if cur.path == path:
                return cur
            if cur.is_directory:
                stack.extend(reversed(cur.children))
        return node

    def read_image_blob(self, entry: WzEntry) -> bytes:
        assert entry.data_offset is not None
        self.f.seek(entry.data_offset)
        return self.f.read(entry.size)

    def manifest(self) -> dict:
        import os

        images = [e for e in self.walk() if e.type == TYPE_IMAGE]
        return {
            "file": os.path.basename(self.path),
            "shell_size": self.shell_size,
            "wz_version": self.wz_version,
            "description": self.description,
            "tree_end": self._tree_end,
            "data_start": self._data_start,
            "image_count": len(images),
            "image_bytes": sum(e.size for e in images),
            "images": [
                {
                    "path": e.path,
                    "size": e.size,
                    "checksum": e.checksum,
                    "offset": e.data_offset,
                }
                for e in images
            ],
        }


if __name__ == "__main__":
    import sys

    wz = WzV1File(sys.argv[1] if len(sys.argv) > 1 else "Data.wz").parse()
    print(
        f"{wz.path}: v{wz.wz_version} shell={wz.shell_size:,} "
        f"treeEnd={wz._tree_end:#x} dataStart={wz._data_start:#x}"
    )
    print(f"root children: {[e.name for e in wz.root]}")
    imgs = [e for e in wz.walk() if e.type == TYPE_IMAGE]
    print(f"images: {len(imgs)}   data: {sum(e.size for e in imgs):,} bytes")
    for e in imgs[:5]:
        blob = wz.read_image_blob(e)
        print(f"   {e.path:40s} size={e.size:>9,} off={e.data_offset:#x} check={blob[0]:#04x}")
