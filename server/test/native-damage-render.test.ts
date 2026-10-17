/** Unexecuted regression source, not a browser/visual validation. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  damageGlyphLayout,
  type DamageGlyph,
} from "../../client/damage-render.mjs";
test("native first-digit bank, origin-aware 3/5 overlap, jitter and MISS bitmap", () => {
  const glyphs = new Map<string, DamageGlyph>([
    ["NoRed1/1", { path: "first", width: 10, height: 12, ox: 0, oy: 0 }],
    ["NoRed0/2", { path: "second", width: 8, height: 10, ox: 0, oy: 0 }],
    ["NoRed0/Miss", { path: "miss", width: 20, height: 8, ox: 999, oy: 999 }],
  ]);
  const digits = damageGlyphLayout(12, glyphs, [0, 1]);
  assert.deepEqual(
    digits.map((g) => [g.path, g.x, g.y]),
    [
      ["first", -6, -6],
      ["second", -2, -2],
    ],
  );
  assert.deepEqual(
    damageGlyphLayout(0, glyphs).map((g) => [g.path, g.x, g.y]),
    [["miss", -10, -8]],
    "MISS centers the raw canvas, not its origin",
  );
  assert.deepEqual(
    damageGlyphLayout(13, glyphs),
    [],
    "missing metadata must not invent a font or extent",
  );
});

test("palette 2 uses native violet banks/MISS, never the outgoing red glyph as fallback", () => {
  const glyph = (path: string): DamageGlyph => ({
    path,
    width: 10,
    height: 12,
    ox: 0,
    oy: 0,
  });
  const glyphs = new Map([
    ["NoViolet1/1", glyph("violet-first")],
    ["NoViolet0/2", glyph("violet-second")],
    ["NoViolet0/Miss", glyph("violet-miss")],
    ["NoRed0/Miss", glyph("red-miss")],
  ]);
  assert.deepEqual(
    damageGlyphLayout(12, glyphs, [], "NoViolet").map((g) => g.path),
    ["violet-first", "violet-second"],
  );
  assert.equal(
    damageGlyphLayout(0, glyphs, [], "NoViolet")[0]!.path,
    "violet-miss",
  );
  glyphs.delete("NoViolet0/Miss");
  assert.deepEqual(damageGlyphLayout(0, glyphs, [], "NoViolet"), []);
});
