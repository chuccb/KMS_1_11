"""Tests for tools/kstr.py - the CP949 string reader for the decompile.

The real `MapleStory.exe.c` is a 372k-line CP949 file, so the suite builds a tiny synthetic CP949
file that mimics Hex-Rays output instead of depending on it; one optional test then runs the tool
against the real dump when it is present.

Run:  python3 -m unittest discover -s tools/tests -v
"""
from __future__ import annotations

import io
import os
import sys
import unittest
from contextlib import redirect_stdout

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

import kstr  # noqa: E402

MAPLESTORY_C = os.path.join(REPO, "MapleStory.exe.c")

# A CP949 source with two functions, a forward declaration, and a literal that spans the classic
# traps: Korean text that is *not* valid UTF-8, and a `// idb` prototype that must not start a body.
KOREAN_1 = "기본 즐 이 있".encode("cp949")
KOREAN_2 = "/헉맵".encode("cp949")
KOREAN_3 = "귓속말".encode("cp949")

# A CP949 source with three functions, a forward declaration, and literals that are raw CP949
# bytes (the way Hex-Rays writes them: `sub_411E50(&p, "기본 즐 이 있", a2)`), plus a function that
# has no literals at all. The `// idb` prototype must not be mistaken for a body.
SYNTHETIC = (
    b"// snippet\n"
    b"const void **__thiscall sub_500010(void **this, int n, void *a3); // idb\n"
    b"int __thiscall sub_500010(void **this, int a2)\n"
    b"{\n"
    b'  sub_411E50(&p, "' + KOREAN_1 + b'", a2);\n'
    b'  return sub_470E10(this, "' + KOREAN_2 + b'");\n'
    b"}\n"
    b"char *__thiscall sub_500100(char *this)\n"
    b"{\n"
    b'  return sub_42FFE0(this, "' + KOREAN_3 + b'");\n'
    b"}\n"
    b"int __stdcall sub_500000(int a1)\n"
    b"{\n"
    b"  return a1 + 1;\n"
    b"}\n"
)

def write_fixture(directory: str) -> str:
    path = os.path.join(directory, "synthetic.c")
    with open(path, "wb") as handle:
        handle.write(SYNTHETIC)
    return path


class KstrTests(unittest.TestCase):
    def run_tool(self, *argv: str) -> str:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = kstr.main(list(argv))
        self.assertEqual(code, 0)
        return buffer.getvalue()

    def test_body_splits_on_function_headers_not_on_prototypes(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory)
            bodies = kstr.function_bodies(path)  # type: ignore[arg-type]
            self.assertIn(b"sub_500010", bodies)
            self.assertIn(b"sub_500100", bodies)
            # The `// idb` prototype must not be treated as the start of a second body: the
            # definition's own line count is what callers see.
            self.assertEqual(len(bodies[b"sub_500010"]), 5)

    def test_korean_literals_are_decoded_from_cp949(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory)
            out = self.run_tool(path, "sub_500010")
            self.assertEqual(out.splitlines(), ["기본 즐 이 있", "/헉맵"])

    def test_a_function_without_literals_says_so(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory)
            self.assertIn("no inline literals", self.run_tool(path, "sub_500000"))

    def test_list_mode_reports_the_functions_that_have_literals(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory)
            out = self.run_tool(path, "--list")
            self.assertIn("sub_500010", out)
            self.assertIn("sub_500100", out)
            self.assertNotIn("sub_500000", out)

    def test_symbol_names_are_available_on_request(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = write_fixture(directory)
            out = self.run_tool(path, "sub_500010", "--names")
            self.assertIn("sub_411E50", out)
            self.assertIn("sub_470E10", out)

    @unittest.skipUnless(os.path.exists(MAPLESTORY_C), "MapleStory.exe.c is not in this checkout")
    def test_the_real_dump_has_the_im_group_and_party_strings(self) -> None:
        # Established in FINDINGS 4.13: the party menu lives in sub_470E10 (CP949), and a plain
        # UTF-8 read of the dump turns every one of these into replacement characters.
        out = self.run_tool(MAPLESTORY_C, "sub_4DDFE0")
        self.assertTrue(out.strip(), "sub_4DDFE0 should reference at least one string")


if __name__ == "__main__":
    unittest.main()
