"""WZ v1 image (`.img`) property reader  --  STATUS: PARTIAL / experimental.

Only the *structural* layer is reliable today (property names, nesting, object sizes).
The exact value encoding for numeric/string types is still being pinned down; see
docs/WZ1_FORMAT.md section 4.6 "仍未解" for the precise remaining deltas.
Do not use this module as a source of truth for values yet.

Second layer on top of `wz1.py`.  Everything here is derived from the binaries in
this repo plus byte-level verification against `Data.wz`; see docs/WZ1_FORMAT.md.

Verified facts used below
-------------------------
* strings            : see wz1.WzV1File.read_string  (ASCII mask = i - 86, UTF-16 mask = i - 21846)
* `.img` header      : `0x73` + string "Property" + u16 0 + property list
                       (also seen: a `00 00 00` variant; `0x1B` marks other payloads)
* property entry     : u8 0x00 + string name + u8 type + value
* "Canvas" object    : `0x73` + string "Canvas" + canvas header, pixels LZ-compressed
                       (decoding of the pixel data requires ZLZ.dll inflate - NOT implemented yet)
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

CHECK_BYTE_PROPERTY = 0x73
CHECK_BYTE_OTHER = 0x1B

# type -> value kind.  Sizes cross-checked against measured entry gaps in
# Character/Cap/01000000.img (docs/WZ1_FORMAT.md 4.3): type 3 measured as 2 bytes.
INT16_TYPES = (2, 3, 11, 16, 17, 18)
INT32_TYPES = (4, 19)
FLOAT64_TYPES = (5, 6, 7)
STRING_TYPE = 8
OBJECT_TYPES = (9, 13)
NULL_TYPE = 0


class Blob:
    """Cursor over a byte string with the WZ v1 primitive codecs."""

    def __init__(self, data: bytes, origin: int = 0, base: int = 0) -> None:
        self.d = data
        self.p = 0
        self.origin = origin  # absolute file offset of d[0], for diagnostics
        self.base = base  # value subtracted from absolute offsets in name references

    # --- primitives ----------------------------------------------------
    def u8(self) -> int:
        v = self.d[self.p]
        self.p += 1
        return v

    def u16(self) -> int:
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
        return v

    def i32(self) -> int:
        v = struct.unpack_from("<i", self.d, self.p)[0]
        self.p += 4
        return v

    def u32(self) -> int:
        v = struct.unpack_from("<I", self.d, self.p)[0]
        self.p += 4
        return v

    def f64(self) -> float:
        v = struct.unpack_from("<d", self.d, self.p)[0]
        self.p += 8
        return v

    def compact_int(self) -> int:
        b = self.u8()
        if b == 0x80:
            return self.i32()
        return b - 256 if b >= 128 else b

    def string(self) -> str:
        length = self.u8()
        if length == 0:
            return ""
        if length & 0x80:
            n = self.i32() if length == 0x80 else 256 - length
            raw = self.d[self.p : self.p + n]
            self.p += n
            return bytes(b ^ ((i - 86) & 0xFF) for i, b in enumerate(raw)).decode("latin1")
        n = self.i32() if length == 0x7F else length
        raw = self.d[self.p : self.p + 2 * n]
        self.p += 2 * n
        out = bytearray(2 * n)
        for i in range(n):
            w = (raw[2 * i] | (raw[2 * i + 1] << 8)) ^ ((i - 21846) & 0xFFFF)
            out[2 * i] = w & 0xFF
            out[2 * i + 1] = w >> 8
        return out.decode("utf-16le")


@dataclass
class Node:
    name: str = ""
    type: int = 0
    value: object = None
    children: list["Node"] = field(default_factory=list)
    kind: str = "value"  # value | list | canvas | raw

    def walk(self, prefix: str = ""):
        path = f"{prefix}/{self.name}" if prefix else self.name
        yield path, self
        for c in self.children:
            yield from c.walk(path)


@dataclass
class Canvas:
    width: int
    height: int
    fmt: int
    mag: int
    data_size: int
    data_offset: int  # absolute-ish offset within the image blob
    body_offset: int = 0


class ImgError(Exception):
    pass


def parse_property_list(b: Blob, depth: int = 0, max_depth: int = 8) -> list[Node]:
    """Parse a property list: compact-int count, then count x [0x00][name][type][value]."""
    count = b.compact_int()
    if not (0 <= count <= 5000):
        raise ImgError(f"bad property count {count} at {b.p - 1}")
    nodes: list[Node] = []
    for _ in range(count):
        lead = b.u8()
        if lead != 0x00:
            raise ImgError(f"bad entry lead {lead:#x} at {b.p - 1}")
        node = Node()
        node.name = b.string()
        node.type = b.u8()
        t = node.type
        if t == NULL_TYPE:
            pass
        elif t in INT16_TYPES:
            node.value = struct.unpack_from("<h", b.d, b.p)[0]
            b.p += 2
        elif t in INT32_TYPES:
            node.value = b.i32()
        elif t in FLOAT64_TYPES:
            node.value = b.f64()
        elif t == STRING_TYPE:
            n = b.compact_int()
            node.value = b.string() if False else _read_raw_string(b, n)
        elif t in OBJECT_TYPES:
            size = b.u32()
            end = b.p + size
            if size < 0 or end > len(b.d):
                raise ImgError(f"object overrun: size={size} at {b.p - 4}")
            body = b.d[b.p : end]
            node.children, node.kind = _parse_object(body, depth + 1, max_depth, b.origin + b.p)
            b.p = end
        else:
            raise ImgError(f"unknown property type {t} for {node.name!r} at {b.p - 1}")
        nodes.append(node)
    return nodes


def _read_raw_string(b: Blob, n: int) -> str:
    raw = b.d[b.p : b.p + n]
    b.p += n
    return bytes(x ^ ((i - 86) & 0xFF) for i, x in enumerate(raw)).decode("latin1", "replace")


def _parse_object(body: bytes, depth: int, max_depth: int, origin: int):
    """An object value is either a nested property list (0x73 "Property" ...),
    a canvas (0x73 "Canvas" ...), or an opaque blob (0x1B ...)."""
    if not body:
        return [], "raw"
    b = Blob(body, origin=origin)
    mark = b.u8()
    try:
        if mark == CHECK_BYTE_PROPERTY:
            tag = b.string()
            if tag == "Property":
                b.u16()
                return parse_property_list(b, depth, max_depth), "list"
            if tag == "Canvas":
                return [Node(name="__canvas__", type=-1, value=_read_canvas(b, origin))], "canvas"
            return [], "raw"
        return [], "raw"
    except (ImgError, IndexError, struct.error, UnicodeDecodeError):
        return [], "raw"


def _read_canvas(b: Blob, origin: int):
    """Canvas header following the string "Canvas".

    Layout inferred from byte inspection of Character/Cap/01000000.img payloads:
        u16 0 | u16 mag? | i32 width? ... - only width/height are best-effort here.
    """
    saved = b.p
    fields: list = []
    for _ in range(4):
        fields.append(b.u16())
    width = fields[2]
    height = b.u16() if False else struct.unpack_from("<h", b.d, b.p)[0]
    return Canvas(width=width, height=height, fmt=fields[3], mag=fields[1], data_size=0, data_offset=origin + saved)


def parse_image(blob: bytes, origin: int = 0) -> tuple[list[Node], str]:
    """Return (nodes, header_kind)."""
    if len(blob) < 4:
        raise ImgError("too small")
    b = Blob(blob, origin=origin)
    if blob[0] == CHECK_BYTE_PROPERTY:
        b.u8()
        tag = b.string()
        if tag != "Property":
            raise ImgError(f"unexpected tag {tag!r}")
        b.u16()
        return parse_property_list(b), "Property"
    # `00 00 00` variant (most Character images): count follows immediately
    if blob[0:3] == b"\x00\x00\x00":
        b.p = 3
        return parse_property_list(b), "000"
    raise ImgError(f"unknown image header {blob[:6].hex(' ')}")
