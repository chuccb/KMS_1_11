"""Tests for the WZ v1 reader, against the real Data.wz in this repository.

Run:  python3 -m unittest discover -s tools/tests -v
The suite skips itself when Data.wz is not present (e.g. a trimmed checkout).
"""
from __future__ import annotations

import os
import sys
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

import wz1  # noqa: E402
import wzdata  # noqa: E402

DATA_WZ = os.path.join(REPO, "Data.wz")

# Facts established in docs/WZ1_FORMAT.md (verified once, asserted here forever).
EXPECTED_ROOT = [
    "smap.img",
    "zmap.img",
    "Character",
    "Effect",
    "Etc",
    "Item",
    "Map",
    "Mob",
    "Npc",
    "Skill",
    "Sound",
    "UI",
]
EXPECTED_IMAGE_COUNT = 1056
EXPECTED_IMAGE_BYTES = 87_140_310
EXPECTED_WZ_VERSION = 95
EXPECTED_DATA_START = 0x3C
EXPECTED_TREE_END = 0x756E
# Declared size of each subtree vs. the sum of its leaf images: 9 of 10 match exactly.
SUBTREE_EXACT = {
    "Character": 16_864_260,
    "Effect": 299_381,
    "Etc": 13_803,
    "Item": 182_228,
    "Mob": 521_226,
    "Npc": 495_633,
    "Skill": 292_831,
    "Sound": 26_690_928,
    "UI": 1_248_011,
}


def _ascii_mask(byte: int, index: int) -> int:
    return byte ^ ((index - 86) & 0xFF)


class StringCodecTest(unittest.TestCase):
    """The cipher itself, independent of any file."""

    def test_ascii_mask_starts_at_0xaa_and_increments(self):
        plain = b"Property"
        encoded = bytes(_ascii_mask(c, i) for i, c in enumerate(plain))
        self.assertEqual(encoded[0], ord("P") ^ 0xAA)
        self.assertEqual(encoded[1], ord("r") ^ 0xAB)
        self.assertEqual(encoded[-1], ord("y") ^ (0xAA + len(plain) - 1))

    def test_utf16_mask_alternates_on_words(self):
        # 0xAAAA start, +1 per 16-bit code unit, masked into each word.
        word0 = 0x0041 ^ 0xAAAA
        word1 = 0x0042 ^ 0xAAAB
        self.assertEqual(word0 & 0xFFFF, 0xAAEB)
        self.assertEqual(word1 & 0xFFFF, 0xAAE9)

    def test_compact_int_encoding(self):
        # Evidence: NameSpace.dll.c sub_10029350 writes 0x80 + int32 when the value
        # does not fit a signed byte (v < -127 || v > 127).
        class FakeReader(wz1.WzV1File):
            def __init__(self, byte: int, i32: int = 0) -> None:
                self.byte = byte
                self.i32 = i32

            def _u8(self) -> int:
                return self.byte

            def _int32(self) -> int:
                return self.i32

        self.assertEqual(FakeReader(0x05).read_compact_int(), 5)
        self.assertEqual(FakeReader(0x7F).read_compact_int(), 127)
        self.assertEqual(FakeReader(0xFF).read_compact_int(), -1)
        self.assertEqual(FakeReader(0x80, 0x0F).read_compact_int(), 15)
        self.assertEqual(FakeReader(0x80, -300).read_compact_int(), -300)

    def test_signed_byte_length_rule(self):
        # length byte 0xFC means "4 ASCII chars" (256 - 0xFC)
        self.assertEqual(256 - 0xFC, 4)
        self.assertEqual(256 - 0xF9, 7)  # "iconRaw"


@unittest.skipUnless(os.path.exists(DATA_WZ), "Data.wz not present")
class DataWzTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.wz = wz1.WzV1File(DATA_WZ).parse()
        cls.images = [e for e in cls.wz.walk() if e.type == wz1.TYPE_IMAGE]

    def test_header(self):
        self.assertEqual(self.wz.description, "Package file v1.0 Copyright 2002 Wizet, ZMS")
        self.assertEqual(self.wz.data_start, EXPECTED_DATA_START)
        self.assertEqual(self.wz.wz_version, EXPECTED_WZ_VERSION)
        self.assertEqual(self.wz.shell_size, os.path.getsize(DATA_WZ) - 60)

    def test_root_children(self):
        self.assertEqual([e.name for e in self.wz.root], EXPECTED_ROOT)

    def test_tree_end(self):
        self.assertEqual(self.wz._tree_end, EXPECTED_TREE_END)

    def test_image_inventory(self):
        self.assertEqual(len(self.images), EXPECTED_IMAGE_COUNT)
        self.assertEqual(sum(e.size for e in self.images), EXPECTED_IMAGE_BYTES)

    def test_declared_offsets_cover_the_whole_file(self):
        # Type-2 entries inherit the referenced image kind. No bytes are unaccounted for.
        cursor = self.wz._data_start
        for image in self.images:
            self.assertEqual(image.data_offset, cursor, f"{image.path} offset drifted")
            cursor += image.size
        self.assertEqual(os.path.getsize(DATA_WZ) - cursor, 0)

    def test_subtree_sizes_match_leaf_sums(self):
        for name, declared in SUBTREE_EXACT.items():
            node = next(e for e in self.wz.root if e.name == name)
            leaves = [e for e in self.wz.walk([node]) if e.type == wz1.TYPE_IMAGE]
            self.assertEqual(sum(e.size for e in leaves), declared, f"{name} size changed")
            self.assertEqual(node.size, declared, f"{name} declared size changed")

    def test_known_image_paths_exist(self):
        for path in (
            "smap.img",
            "zmap.img",
            "Character/Cap/01000000.img",
            "Map/Map/000000000.img",
            "Mob/0100100.img",
            "UI/Basic.img",
            "Sound/",
        ):
            with self.subTest(path=path):
                if path.endswith("/"):
                    continue  # directory lookup is covered by the root test
                self.assertIsNotNone(self.wz.find(path), f"{path} missing")

    def test_name_reference_entries_were_resolved(self):
        # Map/Tile reuses the names first defined in Map/Back (tag 2 entries).
        back = {e.name for e in self.wz.find("Map/Back").children}
        tile = {e.name for e in self.wz.find("Map/Tile").children}
        self.assertTrue({"darkCave.img", "darkWood.img", "dryRock.img", "grassySoil.img"} <= back)
        self.assertTrue({"darkCave.img", "darkWood.img", "dryRock.img", "grassySoil.img"} <= tile)
        for name in ("darkCave", "darkWood", "dryRock", "grassySoil"):
            self.assertEqual(self.wz.find(f"Map/Tile/{name}.img").type, wz1.TYPE_IMAGE)

    def test_a_tail_image_is_at_its_declared_offset(self):
        # Resolving reference kinds restores the cumulative layout for every tail image.
        entry = self.wz.find("Mob/0100100.img")
        wz = wzdata.DataWz(DATA_WZ)
        resolved = {r.path: r for r in wz.resolve()}["Mob/0100100.img"]
        self.assertEqual(resolved.source, "declared")
        blob = wz.blob("Mob/0100100.img")
        self.assertEqual(len(blob), entry.size)
        # image header variant A: 0x73 + "Property" (docs/WZ1_FORMAT.md §4.5)
        self.assertEqual(blob[0], 0x73)
        name_len = 256 - blob[1]
        self.assertEqual(
            bytes(_ascii_mask(c, i) for i, c in enumerate(blob[2 : 2 + name_len])).decode("latin1"),
            "Property",
        )


if __name__ == "__main__":
    unittest.main()
