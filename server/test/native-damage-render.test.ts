/** Unexecuted regression source, not a browser/visual validation. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DAMAGE_NUMBER_STACK_PX,
  NATIVE_DAMAGE,
  damageGlyphLayout,
  damageNumberAnchor,
  type DamageGlyph,
} from "../../client/damage-render.ts";
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
  assert.equal(damageGlyphLayout(0, glyphs, [], "NoViolet")[0]!.path, "violet-miss");
  glyphs.delete("NoViolet0/Miss");
  assert.deepEqual(damageGlyphLayout(0, glyphs, [], "NoViolet"), []);
});

test("sub_487A30: each further hit of one swing stacks its number 30px higher, above the body", () => {
  // `v16 = *(this + 91) - 30 * a6 - sub_485C20(this)` - mob y, less 30 per hit, less the body rise.
  assert.equal(DAMAGE_NUMBER_STACK_PX, 30);
  assert.deepEqual(damageNumberAnchor({ x: 100, y: 200 }, 0, 0), { x: 100, y: 200 });
  assert.deepEqual(damageNumberAnchor({ x: 100, y: 200 }, 0, 1), { x: 100, y: 170 });
  assert.deepEqual(damageNumberAnchor({ x: 100, y: 200 }, 0, 5), { x: 100, y: 50 });
  // The body's own rise comes off first, and a frame with no oy is simply no rise.
  assert.deepEqual(damageNumberAnchor({ x: 100, y: 200 }, 40, 0), { x: 100, y: 160 });
  assert.deepEqual(damageNumberAnchor({ x: 100, y: 200 }, 40, 2), { x: 100, y: 100 });
  // sub_485C20 can only lift the number: a negative origin must not push it down into the mob.
  assert.deepEqual(damageNumberAnchor({ x: 100, y: 200 }, -12, 1), { x: 100, y: 170 });
  // x is the mob's own x - 487A30 passes *(this + 90) straight through.
  assert.equal(damageNumberAnchor({ x: -250, y: 200 }, 0, 0).x, -250);
});

test("sub_4C8ED0 floors a real hit at 1 and caps it at 9999; 0 is the touch that missed", () => {
  // `.c:208415-208423`: `v <= 1 -> 1`, then `v >= 9999 -> 9999`. The server's own rolls end with
  // `trunc(clamp(damage, 1, 9999))`; the 999 ceiling on the *stat* terms is a different figure.
  assert.deepEqual(NATIVE_DAMAGE, { min: 1, max: 9999 });
  assert.notEqual(NATIVE_DAMAGE.max, 999, "999 is the stat clamp, not the damage one");
  // What the page accepts from a touch-result: 0 is a miss, anything above the cap is not a hit.
  const accepted = (damage: number) =>
    Number.isInteger(damage) && damage >= 0 && damage <= NATIVE_DAMAGE.max;
  assert.equal(accepted(0), true, "a miss still has to print");
  assert.equal(accepted(1), true, "the native floor");
  assert.equal(accepted(9999), true, "the native cap");
  assert.equal(accepted(10000), false);
  assert.equal(accepted(-1), false);
  // And 0 prints the MISS bitmap rather than a zero - the two are not the same thing.
  const miss: DamageGlyph = { path: "miss", width: 20, height: 8, ox: 0, oy: 0 };
  assert.deepEqual(
    damageGlyphLayout(0, new Map([["NoRed0/Miss", miss]])).map((g) => g.path),
    ["miss"],
  );
  assert.deepEqual(damageGlyphLayout(1, new Map()), [], "no metadata is not an invented glyph");
});
