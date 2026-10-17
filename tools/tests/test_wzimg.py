"""Tests for the WZ v1 `.img` value codec (`tools/wzimg.py`).

Half of the suite is synthetic (it writes the byte streams by hand, so the
format rules are pinned independently of any file), the other half runs against
the real `Data.wz` in this repository and is skipped when it is absent.

Run:  python3 -m unittest discover -s tools/tests -v
"""
from __future__ import annotations

import collections
import hashlib
import os
import struct
import sys
import unittest
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

import wz1  # noqa: E402
import wzdata  # noqa: E402
import wzimg  # noqa: E402
from wzimg import ImageStream, ImgError  # noqa: E402

DATA_WZ = os.path.join(REPO, "Data.wz")


# --------------------------------------------------------------------------
# a minimal writer, mirroring the codec (synthetic fixtures)
# --------------------------------------------------------------------------
def ascii_string(text: str) -> bytes:
    raw = bytes(ord(c) ^ ((i - 86) & 0xFF) for i, c in enumerate(text))
    return bytes([256 - len(raw)]) + raw


def utf16_string(text: str) -> bytes:
    out = bytearray()
    for i, ch in enumerate(text.encode("utf-16le").decode("utf-16")):
        word = ord(ch) ^ ((i - 21846) & 0xFFFF)
        out += struct.pack("<H", word)
    return bytes([len(text)]) + bytes(out)


def compact(value: int) -> bytes:
    if -128 <= value <= 127:
        return bytes([value & 0xFF])
    return b"\x80" + struct.pack("<i", value)


def entry(name: str, type_byte: int, value: bytes) -> bytes:
    return b"\x00" + ascii_string(name) + bytes([type_byte]) + value


def prop_list(*entries: bytes, header: bytes = b"\x00\x00") -> bytes:
    return header + compact(len(entries)) + b"".join(entries)


def object_(cls: str, body: bytes) -> bytes:
    return b"\x73" + ascii_string(cls) + body


# --------------------------------------------------------------------------
# primitives
# --------------------------------------------------------------------------
class PrimitiveTest(unittest.TestCase):
    def test_compact_int_uses_one_byte_or_the_0x80_escape(self):
        stream = ImageStream(bytes([0x7F, 0x80]) + struct.pack("<i", 12345) + bytes([0xFF, 0x81]))
        self.assertEqual(stream.compact(), 127)
        self.assertEqual(stream.compact(), 12345)
        self.assertEqual(stream.compact(), -1)
        self.assertEqual(stream.compact(), -127)

    def test_int64_compact_escapes_to_eight_bytes(self):
        stream = ImageStream(bytes([0x05, 0x80]) + struct.pack("<q", -2**40))
        self.assertEqual(stream.i64_compact(), 5)
        self.assertEqual(stream.i64_compact(), -(2**40))

    def test_ascii_string_mask_starts_at_0xaa(self):
        self.assertEqual(ascii_string("Property"), bytes.fromhex("f8fad9c3ddcbddc4c8"))
        self.assertEqual(ImageStream(ascii_string("Property")).string(), "Property")

    def test_utf16_string_mask_starts_at_0xaaaa(self):
        blob = utf16_string("가나A")
        self.assertEqual(ImageStream(blob).string(), "가나A")

    def test_empty_string_is_a_single_zero(self):
        self.assertEqual(ImageStream(b"\x00").string(), "")


# --------------------------------------------------------------------------
# property lists
# --------------------------------------------------------------------------
class PropertyTest(unittest.TestCase):
    def test_scalar_types_have_the_sizes_pcom_dictates(self):
        blob = prop_list(
            entry("a", 2, struct.pack("<H", 300)),       # u16
            entry("b", 11, struct.pack("<H", 7)),        # u16
            entry("c", 3, compact(-5)),                  # compact int
            entry("d", 4, compact(70000)),               # compact int, i32 escape
            entry("e", 19, compact(1)),                  # compact int
            entry("f", 6, b"\x09"),                      # compact int64
            entry("g", 16, struct.pack("<H", 2)),        # u16
            entry("h", 17, struct.pack("<H", 2)),        # u16
            entry("i", 18, struct.pack("<H", 2)),        # u16
            entry("j", 5, struct.pack("<d", 1.5)),       # double
            entry("k", 7, struct.pack("<d", -0.25)),     # double
            entry("l", 0, b""),                          # null
        )
        stream = ImageStream(blob)
        props = stream.prop_list()
        self.assertEqual(stream.p, len(blob), "every entry must be consumed")
        self.assertEqual([n for n, _t, _v in props],
                         list("abcdefghijkl"))
        self.assertEqual([props[i][2] for i in range(3)], [300, 7, -5])
        self.assertEqual(props[3][2], 70000)
        self.assertEqual(props[9][2], 1.5)
        self.assertEqual(props[10][2], -0.25)
        self.assertIsNone(props[11][2])

    def test_string_entry_can_reference_a_name_by_offset(self):
        # A key is the offset of the string's own length byte, relative to the
        # start of the image (docs/WZ1_FORMAT.md §4.4).  The first string value
        # here sits at that offset, so the second entry can point back at it.
        first = entry("z", 8, b"\x00" + ascii_string("A"))
        key = len(b"\x00\x00\x02" + b"\x00" + ascii_string("z") + b"\x08\x00")
        second = b"\x00" + ascii_string("w") + b"\x08\x01" + struct.pack("<I", key)
        blob = prop_list(first, second)
        stream = ImageStream(blob)
        props = stream.prop_list()
        self.assertEqual(props[0][2], "A")
        self.assertEqual(props[1][2], "A", "flag + u32 reuses the cached string")
        self.assertEqual(stream.p, len(blob))

    def test_unknown_key_is_read_at_its_own_offset(self):
        # Defensive path (a key the reader has not seen yet): seek, read the
        # string there, carry on where the entry ended.  Data.wz never needs it.
        first = entry("z", 8, b"\x00" + ascii_string("A"))
        head = b"\x00\x00\x02" + first + b"\x00" + ascii_string("w") + b"\x08\x01"
        key = len(head) + 4                      # the trailing string, not inline
        blob = head + struct.pack("<I", key) + ascii_string("cached")
        stream = ImageStream(blob)
        props = stream.prop_list()
        self.assertEqual(props[1][2], "cached")
        self.assertEqual(stream.p, key, "the cursor stays where the entry ended")

    def test_entry_name_reference_tags(self):
        # Entry tag 1 carries the same kind of key; tag 0 spells the name out.
        first = entry("first", 3, compact(1))
        key = len(b"\x00\x00\x02") + 1           # "first" starts one byte in
        blob = prop_list(first, b"\x01" + struct.pack("<I", key) + b"\x03" + compact(9))
        props = ImageStream(blob).prop_list()
        self.assertEqual(props[0][0], "first")
        self.assertEqual(props[1][0], "first", "tag 1 reuses the cached name")
        self.assertEqual(props[1][2], 9)

    def test_nested_object_uses_the_declared_size(self):
        inner = object_("Property", prop_list(entry("k", 3, compact(4))))
        blob = prop_list(entry("outer", 9, struct.pack("<I", len(inner)) + inner))
        props = ImageStream(blob).prop_list()
        node = props[0][2]
        self.assertEqual(node.kind, "props")
        self.assertEqual(node.props[0], ("k", 3, 4))

    def test_object_size_mismatch_is_an_error(self):
        inner = object_("Property", prop_list(entry("k", 3, compact(4))))
        blob = prop_list(entry("outer", 9, struct.pack("<I", len(inner) + 3) + inner))
        with self.assertRaises(ImgError):
            ImageStream(blob).prop_list()


# --------------------------------------------------------------------------
# classes
# --------------------------------------------------------------------------
class ClassBodyTest(unittest.TestCase):
    def test_vector2d_is_two_compacts(self):
        body = compact(-3) + compact(9)
        node = ImageStream(body).body("Shape2D#Vector2D", len(body))
        self.assertEqual(node.kind, "vector")
        self.assertEqual(node.value, (-3, 9))

    def test_convex2d_holds_size_less_vectors(self):
        # The first item names the class (0x73 + string), the second points at
        # that name with 0x1B + the key of its length byte (here: offset 2,
        # right behind the item count).
        first = b"\x73" + ascii_string("Shape2D#Vector2D") + compact(1) + compact(2)
        second = b"\x1B" + struct.pack("<I", 2) + compact(3) + compact(4)
        body = compact(2) + first + second
        node = ImageStream(body).body("Shape2D#Convex2D", len(body))
        self.assertEqual(node.kind, "convex")
        self.assertEqual([v.value for v in node.value], [(1, 2), (3, 4)])

    def test_uol_kinds(self):
        # kind 0 spells the target path out (registering it in the name table);
        # kind 1 is an in-link that carries that path's key, so both forms
        # produce the target path.
        out_link = b"\x00\x00" + ascii_string("../../swingPF/0/body")
        key = 2                                          # the path's length byte
        in_link = b"\x00\x01" + struct.pack("<I", key)
        self.assertEqual(
            ImageStream(out_link).body("UOL", len(out_link)).value,
            "../../swingPF/0/body",
        )
        stream = ImageStream(out_link + in_link)
        stream.p = len(out_link)
        self.assertEqual(stream.body("UOL", len(in_link)).value, "../../swingPF/0/body")


# --------------------------------------------------------------------------
# canvas
# --------------------------------------------------------------------------
def canvas_bytes(width: int, height: int, fmt: int, pixels: bytes, props: bytes = b"",
                 pixel_override: bytes | None = None) -> bytes:
    body = b"\x00" + (b"\x01" if props else b"\x00")
    if props:
        body += props
    body += compact(width) + compact(height) + compact(fmt) + compact(0)
    body += b"".join(compact(0) for _ in range(4))
    block = b"\x00" + (pixel_override if pixel_override is not None else zlib.compress(pixels))
    body += struct.pack("<I", len(block)) + block
    return object_("Canvas", body)


class CanvasTest(unittest.TestCase):
    def test_layout_and_pixels(self):
        pixels = bytes(range(256)) * 4
        blob = prop_list(entry("icon", 9, struct.pack("<I", (c := len(canvas_bytes(16, 32, 1, pixels)))) + canvas_bytes(16, 32, 1, pixels)))
        props = ImageStream(blob).prop_list()
        canvas = props[0][2].value
        self.assertEqual((canvas.width, canvas.height, canvas.fmt), (16, 32, 1))
        self.assertEqual(canvas.bpp, 2)
        self.assertEqual(canvas.expected_bytes, 1024)
        self.assertEqual(canvas.pixel, pixels)
        self.assertFalse(canvas.partial)

    def test_truncated_stream_without_adler32_still_decodes(self):
        pixels = bytes([7, 0] * 64)
        full = zlib.compress(pixels)
        truncated = full[:-4]  # this archive's writers drop the adler32 trailer
        blob = canvas_bytes(8, 8, 1, pixels, pixel_override=truncated)
        body = blob[len(b"\x73" + ascii_string("Canvas")):]
        canvas = ImageStream(body).body("Canvas", len(body)).value
        self.assertEqual(canvas.pixel, pixels)

    def test_short_stream_is_reported_as_partial(self):
        pixels = bytes(8 * 8 * 2)
        stream = zlib.compressobj()
        head = stream.compress(pixels[:32]) + stream.flush(zlib.Z_SYNC_FLUSH)
        blob = canvas_bytes(8, 8, 1, pixels, pixel_override=head)
        body = blob[len(b"\x73" + ascii_string("Canvas")):]
        canvas = ImageStream(body).body("Canvas", len(body)).value
        self.assertEqual(len(canvas.pixel), 32)
        self.assertTrue(canvas.partial)

    def test_pixel_bpp_uses_the_low_byte_of_the_format(self):
        self.assertEqual(wzimg.pixel_bpp(1), 2)
        self.assertEqual(wzimg.pixel_bpp(2), 4)
        self.assertEqual(wzimg.pixel_bpp(513), 2)

    def test_non_zero_flag_yields_no_pixels(self):
        self.assertIsNone(wzimg.decode_pixels(b"\x01\x78\x9c", 4))


# --------------------------------------------------------------------------
# the real archive
# --------------------------------------------------------------------------
@unittest.skipUnless(os.path.exists(DATA_WZ), "Data.wz not present")
class RealArchiveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.wz = wzdata.DataWz(DATA_WZ)
        cls.resolved = cls.wz.resolve()

    def test_every_image_resolves_to_a_parsable_blob(self):
        self.assertEqual(len(self.resolved), 1056)
        self.assertEqual(sum(1 for r in self.resolved if r.offset is not None), 1056)
        sources = {r.source for r in self.resolved}
        self.assertLessEqual(sources, {"declared", "scanned"})
        for r in self.resolved:
            with self.subTest(path=r.path):
                self.assertTrue(self.wz.objects(r.path))

    def test_most_images_sit_at_their_declared_offset(self):
        declared = [r for r in self.resolved if r.source == "declared"]
        scanned = [r for r in self.resolved if r.source == "scanned"]
        self.assertEqual(len(declared), 1056)
        self.assertEqual(len(scanned), 0)
        self.assertEqual(self.resolved[0].offset, self.wz.tree_end)

    def test_an_opaque_blob_is_not_accepted_as_an_image(self):
        # Correct type-2 handling restores the actual declared offset; verify the slime identity.
        resolved = {r.path: r for r in self.resolved}["Mob/0210100.img"]
        self.assertEqual(resolved.source, "declared")
        root = self.wz.objects("Mob/0210100.img")[0]
        self.assertEqual(root.cls, "Property")
        info = root.get("info")
        self.assertEqual(info.get("name"), "슬라임")
        self.assertEqual(info.get("level"), 6)

    def test_unlisted_objects_are_the_offset_discrepancy(self):
        # All four referenced tile images are accounted for; there is no gap.
        unlisted = self.wz.unlisted_objects()
        self.assertEqual(len(unlisted), 0)
        self.assertEqual(sum(length for _o, length in unlisted), 0)

    def test_canvas_census(self):
        stats = self.wz.canvas_census()
        self.assertEqual(stats["canvases"], 55_446)
        self.assertEqual(stats["fmt 1"], 55_381)
        self.assertEqual(stats["fmt 513"], 65)
        self.assertEqual(stats["pixels exact"], 55_446)
        self.assertEqual(stats.get("pixels short (zero padded)", 0), 0)
        self.assertNotIn("pixels not decoded", stats)

    def test_every_name_reference_hits_the_table(self):
        # 697,218 keys, no misses: every reference form (0x1B, entry tag 1,
        # string flag 1, UOL kind 1) only ever addresses a string the stream
        # has already interned.
        hits = [0, 0]

        class Counting(wzimg.ImageStream):
            def at_key(self, key: int) -> str:
                hits[key in self.names] += 1
                return wzimg.ImageStream.at_key(self, key)

        for r in self.resolved:
            with self.subTest(path=r.path):
                Counting(self.wz.blob(r.path)).objects()
        self.assertEqual(hits[1], 697_218)
        self.assertEqual(hits[0], 0, "no key needed the seek fallback")

    def test_uol_links_always_resolve_to_a_path(self):
        # 8,091 out-links spell the path out, 46,207 in-links carry a key that
        # points at an already registered one; the codec yields the path either
        # way, never a bare offset.
        counts = collections.Counter()

        def walk(node) -> None:
            if isinstance(node, wzimg.Node):
                if node.kind == "uol":
                    counts["uol"] += 1
                    counts[type(node.value).__name__] += 1
                else:
                    walk(node.value)
            elif isinstance(node, wzimg.Object):
                walk(node.props)
            elif isinstance(node, (list, tuple)):
                for item in node:
                    walk(item[2] if isinstance(item, tuple) and len(item) == 3 else item)

        for r in self.resolved:
            for obj in self.wz.objects(r.path):
                walk(obj)
        self.assertEqual(counts["uol"], 54_298)
        self.assertEqual(set(counts) - {"uol"}, {"str"})

    def test_cap_icon_pixels_are_stable(self):
        canvases = []
        for obj in self.wz.objects("Character/Cap/01000000.img"):
            canvases += wzimg.walk_values(obj)
        self.assertEqual([(c.width, c.height) for c in canvases],
                         [(29, 30), (29, 28), (45, 47), (4, 13), (41, 33)])
        self.assertEqual(len(canvases[0].pixel), 29 * 30 * 2)
        self.assertEqual(
            hashlib.sha256(canvases[0].pixel).hexdigest()[:16],
            "acd38811c1f1f1a0",
        )

    def test_map_metadata_of_amherst_west_field(self):
        meta = self.wz.map_metadata(["001000000"])["001000000"]
        self.assertEqual(len(self.wz.map_metadata()), 100)
        self.assertEqual(meta["info"]["mapName"], "암허스트서쪽필드")
        self.assertEqual(meta["info"]["streetName"], "레인보우스트리트")
        self.assertEqual(meta["info"]["bgm"], "Bgm00/RestNPeace")
        self.assertEqual(meta["info"]["returnMap"], 1010000)
        self.assertEqual(meta["foothold"], 289)
        self.assertEqual(meta["ladderRope"], 8)
        self.assertEqual(meta["portal"][0]["pn"], "sp")
        self.assertEqual(len(meta["life"]), 45)
        self.assertEqual(meta["life"][0]["type"], "m")
        self.assertEqual(meta["life"][0]["id"], "0120100")


if __name__ == "__main__":
    unittest.main()
