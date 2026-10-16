"""WZ v1 `.img` value codec.

Reverse engineered from the binaries in this repository and verified
byte-for-byte against every one of the 1,052 images in ``Data.wz``:

* ``PCOM.dll`` ``sub_10018800`` -- the property type dispatcher (both
  directions).  It fixes the wire size of every type; in particular types
  ``2/11/16/17/18`` are **u16** and only ``3/4/19`` are the 1-byte "compact"
  integer, which is what the old notes in ``docs/WZ1_FORMAT.md`` (and the
  earlier reader) got wrong.
* ``PCOM.dll`` ``sub_1000D510`` / ``sub_1000C9A0`` -- string codec: the
  length byte doubles as a flag, byte strings carry the rolling XOR key
  ``(i - 86) & 0xFF``, UTF-16 strings ``(i - 21846) & 0xFFFF`` (strict UTF-16,
  so none of them may be a surrogate).
* ``Canvas.dll`` ``sub_1001D560`` (Canvas load/save) and ``sub_1001DE50``
  (pixel block) -- the Canvas layout and the ``Shape2D#Vector2D`` /
  ``Shape2D#Convex2D`` shapes.
* ``ZLZ.dll`` -- zlib 1.1.3 (``inflateInit2_``/``deflateInit_``).

Vocabulary
----------
An ``.img`` blob is a stream of *objects*::

    0x73 <string>                    new class name (cached at its offset)
    0x1B <u32 offset> [<string>]     reference to a cached class name
    0x23                             '#' list marker
    0x41                             end of an object sequence

Class bodies (``Property`` and every class not listed below):

    ``u16 0``, compact ``count``, ``count`` entries::

        <entry tag> <name> <u8 type> <value>

    Entry tags: ``0`` the name string follows, ``1`` the entry carries a
    ``u32`` key into the name table (see below).  ``PCOM.dll`` reads both
    through one helper, ``sub_1000D020``, and writes them through
    ``sub_1000C9A0``, which takes the two markers as a pair (``0`` inline /
    ``1`` reference for entry names, ``0x73`` / ``0x1B`` for class names).

The name table
    Strings are interned per image.  Reading a string inline registers it at
    the offset of its own length byte, **relative to the start of the image**
    (not to the archive), and the three reference forms below all carry that
    offset as a ``u32``:

    * ``0x1B`` object marker -- the class name
    * entry tag ``1`` -- the property name
    * value type ``8`` with a non-zero flag -- a string value

    On a cache hit the reference is 4 bytes and nothing else follows, which is
    why the parser has to key the table the same way the writer did.  A key
    that is not in the table yet is read at its own offset (the reader seeks,
    reads, and comes back); ``Data.wz`` never needs that fallback: all 696,774
    references in the archive hit (650,567 markers/tags/values + 46,207 UOL
    in-links).

    types: ``0`` null; ``3,4,19`` compact int (``0x80`` escape = int32);
    ``2,11,16,17,18`` u16; ``6`` compact int64 (``0x80`` escape = int64);
    ``5,7`` f64; ``8`` string (``u8`` flag, ``u32`` name offset when the flag
    is non-zero, the string when that offset is new); ``9,13`` object
    (``u32 size`` + body).

``Shape2D#Vector2D``
    compact x, compact y.

``Shape2D#Convex2D``
    compact count, then ``count`` size-less objects.

``UOL``
    ``u8 flag``, ``u8 kind``.  kind ``0`` writes the link target as a path
    string (``"../../swingPF/0/body"``) and registers it in the name table;
    kind ``1`` is an in-link: the same ``u32`` name key, i.e. "the same target
    as the UOL whose path string sits at that offset".  Both yield the target
    path, so :class:`Node` carries a ``str`` either way.  Measured over
    ``Data.wz``: 8,091 out-links and 46,207 in-links, every in-link key
    resolving to a previously registered path.

``Canvas``
    ``u8 flag`` (``0`` on load, anything else raises ``ZException(1392)``),
    ``u8 hasProps`` + property list, compact ``width``, compact ``height``,
    compact ``format`` (1, 2 or 513), compact ``pad``, four compact zero
    words, ``u32 pixelLen``, then ``pixelLen`` bytes of pixel block.

Canvas pixel block (``ZLZ.dll`` filter = zlib 1.1.3): ``u8 flag`` + a zlib
stream that inflates to exactly ``width * height * bpp`` bytes.  This build of
the client leaves off the final 4-byte adler32, so one-shot
``zlib.decompress`` refuses the stream while the client's incremental inflate
(which stops once the pixel buffer is full) is happy.  See
:func:`decode_pixels`.
"""
from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

TYPE_NULL = 0
TYPE_STRING = 8
COMPACT_TYPES = (3, 4, 19)
U16_TYPES = (2, 11, 16, 17, 18)
INT64_TYPES = (6,)
DOUBLE_TYPES = (5, 7)
OBJECT_TYPES = (9, 13)
FLOAT_TYPES = DOUBLE_TYPES

MARK_CLASS = 0x73
MARK_NAME_REF = 0x1B
MARK_LIST = 0x23
MARK_END = 0x41
MARKERS = (MARK_CLASS, MARK_NAME_REF, MARK_LIST)

#: classes that may appear where a property list is expected
PROPERTY_CLASSES = ("Property", "#", "")


class ImgError(Exception):
    """The blob does not follow the WZ v1 image grammar."""


@dataclass
class Canvas:
    """Pixel buffer of a ``Canvas`` object."""

    width: int
    height: int
    fmt: int
    pad: int
    zeros: list
    flag: int
    props: list
    pixel_raw: bytes
    pixel: bytes | None
    offset: int = 0
    end: int = 0

    @property
    def pixel_len(self) -> int:
        """`u32` that precedes the pixel block (``flag`` byte included)."""
        return len(self.pixel_raw)

    @property
    def bpp(self) -> int:
        """Bytes per pixel implied by the pixel format code."""
        return pixel_bpp(self.fmt)

    @property
    def expected_bytes(self) -> int:
        return self.width * self.height * self.bpp

    @property
    def partial(self) -> bool:
        """True when the pixel block decoded to less than ``expected_bytes``."""
        return self.pixel is not None and len(self.pixel) != self.expected_bytes

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (f"Canvas({self.width}x{self.height}, fmt={self.fmt}, "
                f"raw={len(self.pixel_raw)}B, decoded={len(self.pixel) if self.pixel else None}B)")


@dataclass
class Node:
    """A size-carrying object of the image stream."""

    kind: str                 # canvas | props | vector | convex | raw | uol
    value: object             # Canvas | list | tuple | list[Node] | bytes

    @property
    def props(self) -> list:
        return self.value if self.kind == "props" else []

    def get(self, name: str):
        """Value of the property ``name`` inside a ``props`` node, else None."""
        for entry_name, _t, value in self.props:
            if entry_name == name:
                return value
        return None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Node({self.kind}, {self.value!r})"


@dataclass
class Object:
    """One top-level object of an image stream."""

    cls: str
    props: list = field(default_factory=list)
    offset: int = 0
    end: int = 0

    def get(self, name: str):
        for nm, _t, val in self.props:
            if nm == name:
                return val
        return None

    def entry(self, name: str):
        for nm, t, val in self.props:
            if nm == name:
                return t, val
        return None


class ImageStream:
    """Value-level reader for one image blob (a stream of objects).

    ``base`` is the offset of ``blob[0]`` inside the owning archive; it is
    used for the reported offsets and error messages only.  The name table is
    keyed by offsets **relative to the blob**, because that is what the writer
    of an ``.img`` sub-file interned them at (the sub-file was written
    standalone and then copied into the archive).
    """

    def __init__(self, blob: bytes, base: int = 0) -> None:
        self.b = blob
        self.base = base
        self.p = 0
        self.names: dict[int, str] = {}

    # -- primitives --------------------------------------------------------
    def u8(self) -> int:
        v = self.b[self.p]
        self.p += 1
        return v

    def u16(self) -> int:
        v = struct.unpack_from("<H", self.b, self.p)[0]
        self.p += 2
        return v

    def u32(self) -> int:
        v = struct.unpack_from("<I", self.b, self.p)[0]
        self.p += 4
        return v

    def i32(self) -> int:
        v = struct.unpack_from("<i", self.b, self.p)[0]
        self.p += 4
        return v

    def f64(self) -> float:
        v = struct.unpack_from("<d", self.b, self.p)[0]
        self.p += 8
        return v

    def compact(self) -> int:
        """1-byte integer; ``0x80`` escapes to a little-endian int32."""
        v = self.u8()
        return self.i32() if v == 0x80 else (v - 256 if v >= 128 else v)

    def i64_compact(self) -> int:
        v = self.u8()
        if v == 0x80:
            value = struct.unpack_from("<q", self.b, self.p)[0]
            self.p += 8
            return value
        return v - 256 if v >= 128 else v

    def string(self) -> str:
        """Cached WZ string (see ``PCOM.dll`` ``sub_1000D510``)."""
        start = self.p
        n = self.b[self.p]
        self.p += 1
        if n == 0:
            text = ""
        elif n & 0x80:
            ln = self.i32() if n == 0x80 else 256 - n
            raw = self.b[self.p : self.p + ln]
            self.p += ln
            text = bytes(c ^ ((i - 86) & 0xFF) for i, c in enumerate(raw)).decode("latin1")
        else:
            ln = self.i32() if n == 0x7F else n
            raw = self.b[self.p : self.p + 2 * ln]
            self.p += 2 * ln
            out = bytearray(2 * ln)
            for i in range(ln):
                w = (raw[2 * i] | (raw[2 * i + 1] << 8)) ^ ((i - 21846) & 0xFFFF)
                out[2 * i] = w & 0xFF
                out[2 * i + 1] = w >> 8
            text = out.decode("utf-16le")
        self.names[start] = text
        return text

    def at_key(self, key: int) -> str:
        """Look a string up by name-table key (a blob-relative offset).

        The three reference forms (``0x1B``, entry tag ``1``, string flag
        ``1``, and ``UOL`` kind ``1``) all carry one.  Every reference in
        ``Data.wz`` hits; the fallback is the reader's own behaviour -- seek
        to the offset, read the string there, carry on where we were.
        """
        if key in self.names:
            return self.names[key]
        here = self.p
        self.p = key
        try:
            name = self.string()
        finally:
            self.p = here
        return name

    # -- objects -----------------------------------------------------------
    def class_name(self) -> str:
        mark = self.u8()
        if mark == MARK_CLASS:
            return self.string()
        if mark == MARK_NAME_REF:
            return self.at_key(self.u32())
        if mark == MARK_LIST:
            return "#"
        raise ImgError(f"bad object marker {mark:#x} at {self.base + self.p - 1}")

    def object(self, size: int, depth: int = 0) -> Node:
        """Object whose declared size is ``size`` (types 9/13)."""
        start = self.p
        cls = self.class_name()
        node = self.body(cls, start + size, depth)
        if self.p != start + size:
            raise ImgError(
                f"object {cls!r}: consumed {self.p - start} of {size} bytes "
                f"at {self.base + start}"
            )
        return node

    def inline_object(self, depth: int = 0) -> Node:
        """Size-less object (an item of a ``Shape2D#Convex2D``)."""
        return self.body(self.class_name(), len(self.b), depth)

    def body(self, cls: str, limit: int, depth: int = 0) -> Node:
        if cls == "Canvas":
            return Node("canvas", self.canvas(limit))
        if cls == "Shape2D#Vector2D":
            return Node("vector", (self.compact(), self.compact()))
        if cls == "Shape2D#Convex2D":
            count = self.compact()
            if count < 0 or count > 0x1000:
                raise ImgError(f"implausible Convex2D count {count} at {self.p - 1}")
            return Node("convex", [self.inline_object(depth + 1) for _ in range(count)])
        if cls == "UOL":
            # Link target: u8 flag, u8 kind.  kind 0 spells the target path
            # out ("../../swingPF/0/body"); kind 1 points at the path string
            # another UOL already wrote, so both forms yield that path.
            self.u8()
            kind = self.u8()
            return Node("uol", self.string() if kind == 0 else self.at_key(self.u32()))
        if cls in PROPERTY_CLASSES or cls.startswith("Shape2D"):
            return Node("props", self.prop_list(depth + 1))
        raw = self.b[self.p : limit]
        self.p = limit
        return Node("raw", raw)

    def canvas(self, limit: int) -> Canvas:
        start = self.p
        flag = self.u8()
        props = self.prop_list(1) if self.u8() else []
        width = self.compact()
        height = self.compact()
        fmt = self.compact()
        pad = self.compact()
        zeros = [self.compact() for _ in range(4)]
        pixel_len = self.u32()
        raw = self.b[self.p : self.p + pixel_len]
        self.p += pixel_len
        expected = width * height * pixel_bpp(fmt)
        return Canvas(width, height, fmt, pad, zeros, flag, props, raw,
                      decode_pixels(raw, expected),
                      offset=self.base + start, end=self.base + self.p)

    def prop_list(self, depth: int = 0) -> list:
        if depth > 100:
            raise ImgError("property nesting too deep")
        self.p += 2  # u16 0
        count = self.compact()
        if count < 0 or count > 0x10000:
            raise ImgError(f"implausible property count {count} at {self.p - 1}")
        out = []
        for _ in range(count):
            out.append(self.entry(depth))
        return out

    def entry(self, depth: int = 0):
        name = self.entry_name()
        t = self.u8()
        return name, t, self.value(t, depth)

    def entry_name(self) -> str:
        tag = self.u8()
        if tag == 0:
            return self.string()
        if tag in (1, 2):
            return self.at_key(self.u32())
        raise ImgError(f"bad entry tag {tag:#x} at {self.base + self.p - 1}")

    def value(self, t: int, depth: int = 0):
        if t == TYPE_NULL:
            return None
        if t in COMPACT_TYPES:
            return self.compact()
        if t in U16_TYPES:
            return self.u16()
        if t in INT64_TYPES:
            return self.i64_compact()
        if t in DOUBLE_TYPES:
            return self.f64()
        if t == TYPE_STRING:
            flag = self.u8()
            return self.string() if flag == 0 else self.at_key(self.u32())
        if t in OBJECT_TYPES:
            size = self.u32()
            if self.b[self.p] in MARKERS:
                return self.object(size, depth + 1)
            raw = self.b[self.p : self.p + size]
            self.p += size
            return Node("raw", raw)
        raise ImgError(f"unknown property type {t} at {self.base + self.p - 1}")

    # -- whole blob --------------------------------------------------------
    def one(self) -> Object:
        """Parse one top-level object at the cursor."""
        start = self.p
        cls = self.class_name()
        if cls == "Canvas":
            raise ImgError(f"size-less Canvas at {self.base + start}")
        props = self.prop_list(1) if cls in PROPERTY_CLASSES or cls.startswith("Shape2D") else []
        if not props and cls not in PROPERTY_CLASSES:
            self.body(cls, len(self.b), 1)
            props = []
        return Object(cls=cls, props=props, offset=self.base + start, end=self.base + self.p)

    def objects(self) -> list[Object]:
        """Every top-level object of the blob, in file order."""
        out = []
        while self.p < len(self.b):
            if self.b[self.p] == MARK_END:
                self.p += 1
                break
            if self.b[self.p] not in MARKERS:
                raise ImgError(f"not an object marker {self.b[self.p]:#x} at {self.p}")
            out.append(self.one())
        return out


def pixel_bpp(fmt: int) -> int:
    """Bytes per pixel for a canvas format code.

    The low byte is the depth (``1`` = 16 bpp, ``2`` = 32 bpp); ``0x200`` is an
    extra flag the client sets on a few canvases (``513 = 0x201``) and does not
    change the layout.
    """
    return 4 if (fmt & 0xFF) == 2 else 2


def decode_pixels(raw: bytes, expected: int | None = None) -> bytes | None:
    """Decode a canvas pixel block.

    The block is ``u8 flag`` + a zlib stream (``Canvas.dll`` reads the flag and
    raises ``ZException(1392)`` when it is non-zero).  The streams written by
    this build of the client are almost always missing their 4-byte adler32
    trailer, so ``zlib.decompress`` (one shot) rejects them; a decompressor
    object returns the full pixel buffer anyway, which is what the client does
    too (it inflates straight into a ``width * height * bpp`` buffer).

    ``expected`` is that buffer size.  When the block is not a usable zlib
    stream and its remaining bytes are at least ``expected`` long, they are
    returned verbatim (a few canvases are stored uncompressed).
    """
    if not raw or raw[0] != 0:
        return None
    body = raw[1:]
    if expected:
        # The client inflates straight into a pre-zeroed width*height*bpp
        # buffer, so stop there: the streams in this archive are missing their
        # adler32 trailer and are followed by the next canvas' bytes.  Two
        # canvases stop short (their buffer is simply left mostly black), which
        # ``Canvas.partial`` reports.
        d = zlib.decompressobj()
        try:
            out = d.decompress(body, expected)
        except zlib.error:
            out = b""
        if out:
            return out
    elif body[:1] == b"\x78":
        try:
            return zlib.decompressobj().decompress(body) or None
        except zlib.error:
            return None
    if expected is not None and len(body) >= expected:
        return body[:expected]
    return None


def parse_image(blob: bytes, base: int = 0) -> list[Object]:
    return ImageStream(blob, base=base).objects()


def walk_values(node, out: list | None = None) -> list:
    """Every ``Canvas`` inside an object / property tree, depth first."""
    out = [] if out is None else out
    if isinstance(node, Canvas):
        out.append(node)
    elif isinstance(node, Node):
        walk_values(node.value, out)
    elif isinstance(node, Object):
        walk_values(node.props, out)
    elif isinstance(node, (list, tuple)):
        for item in node:
            if isinstance(item, tuple) and len(item) == 3:
                walk_values(item[2], out)
            else:
                walk_values(item, out)
    return out


def find_objects(data: bytes, cls_marker: bytes = b"\x73\xf8\xfa\xd9\xc3\xdd\xcb\xdd\xc4\xc8") -> list[tuple[int, int, str]]:
    """Every object in ``data`` that starts with the plain ``Property`` marker.

    Returns ``(offset, length, class)`` for each object that parses cleanly to
    its natural end.  Used to locate image blobs whose directory offset went
    stale (see ``docs/WZ1_FORMAT.md`` §4.6).
    """
    out = []
    start = data.find(cls_marker)
    while start >= 0:
        stream = ImageStream(data[start:])
        try:
            obj = stream.one()
        except (ImgError, UnicodeDecodeError, struct.error):
            pass
        else:
            out.append((start, stream.p, obj.cls))
        start = data.find(cls_marker, start + 1)
    return out
