import test from "node:test";
import assert from "node:assert/strict";
import { DISPLAY_MODES, viewLayout, displayMode, originGrid } from "../../client/display.ts";
test("1000x800 defaults to 800x600 at DPR1, never fractional CSS fit", () => {
  const l = viewLayout(1000, 800);
  assert.deepEqual([l.width, l.height, l.left, l.top, l.deviceScale], [800, 600, 100, 100, 1]);
});
test("all sizes/DPRs preserve 4:3, uniform integer device pixels and logical hit-test coordinates", () => {
  for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3])
    for (const [w, h] of [
      [1000, 800],
      [1920, 1080],
      [801, 601],
      [700, 500],
      [2560, 1440],
    ])
      for (const mode of DISPLAY_MODES) {
        const l = viewLayout(w, h, dpr, mode);
        assert.ok(Math.abs(l.width / l.height - 4 / 3) < 1e-12);
        assert.ok(Number.isInteger(l.deviceScale) && l.deviceScale >= 1 && l.deviceScale <= 4);
        assert.equal(l.backingWidth, 800 * l.deviceScale);
        assert.equal(l.backingHeight, 600 * l.deviceScale);
        assert.ok(Math.abs(l.left * dpr - Math.round(l.left * dpr)) < 1e-8);
        assert.ok(Math.abs(l.top * dpr - Math.round(l.top * dpr)) < 1e-8);
        assert.ok(l.contentWidth >= l.width && l.contentHeight >= l.height);
        assert.ok(Math.abs((l.left + 400 * l.scale - l.left) / l.scale - 400) < 1e-8);
      }
});
test("tiny viewports scroll instead of downsampling; legacy fit/native migrate, invalid values stay bounded", () => {
  const tiny = viewLayout(300, 200, 1);
  assert.equal(tiny.deviceScale, 1);
  assert.equal(tiny.overflowing, true);
  assert.deepEqual([tiny.width, tiny.height], [800, 600]);
  assert.equal(viewLayout(1000, 800, 1, "fit").scale, 1);
  assert.equal(displayMode("native"), "pixel-1");
  for (const values of [
    [NaN, 0, 0],
    [-1, Infinity, NaN],
  ] as const)
    assert.ok(Number.isFinite(viewLayout(values[0], values[1], values[2]).scale));
});
test("multiple clear choices remain distinct, and arbitrarily large windows cannot exceed the 4x memory budget", () => {
  assert.equal(DISPLAY_MODES.length, 6);
  assert.deepEqual(
    DISPLAY_MODES.slice(2).map((mode) => viewLayout(10000, 10000, 2, mode).deviceScale),
    [1, 2, 3, 4],
  );
  assert.equal(viewLayout(1e9, 1e9, 10).deviceScale, 4);
});

test("scroll tails are padded to the common origin grid, including the clamped maximum", () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 3])
    for (const mode of DISPLAY_MODES) {
      const v = viewLayout(401, 301, dpr, mode),
        grid = originGrid(dpr);
      assert.ok(
        Math.abs((v.contentWidth - 401) / grid - Math.round((v.contentWidth - 401) / grid)) < 1e-8,
      );
      assert.ok(
        Math.abs((v.contentHeight - 301) / grid - Math.round((v.contentHeight - 301) / grid)) <
          1e-8,
      );
      assert.ok(v.contentWidth >= v.width && v.contentHeight >= v.height);
    }
});

test("a fixed header reserves its rows: the surface is centred below it, never behind it", () => {
  // `viewLayout` used to centre in the whole viewport while the header is a fixed overlay, so a
  // window that was only just tall enough slid the top of the game underneath it. The header
  // measures 0 while the title screen hides it, which is why "reserves nothing" is the default.
  for (const dpr of [1, 1.25, 1.5, 2, 3])
    for (const bar of [0, 43]) {
      const l = viewLayout(1300, 600, dpr, "pixel", bar);
      assert.ok(l.top >= bar, `top ${l.top} must clear the ${bar}px header (dpr ${dpr})`);
      // The whole surface stays inside the rows the header leaves, or it is reported as scrolling.
      assert.ok(l.overflowing || l.top + l.height <= 600);
      assert.ok(Math.abs(l.top * dpr - Math.round(l.top * dpr)) < 1e-8);
      assert.ok(l.contentHeight >= bar + l.height);
    }
  // The same window, before the fix: it claimed 1x fit while hiding the top 43 rows.
  const without = viewLayout(1300, 600, 1, "pixel", 0),
    withBar = viewLayout(1300, 600, 1, "pixel", 43);
  assert.equal(without.top, 0);
  assert.equal(withBar.top, 43);
  // A header taller than the whole viewport still yields a usable, finite layout.
  for (const bar of [600, 5000])
    assert.ok(Number.isFinite(viewLayout(1300, 600, 1, "pixel", bar).top));
});

test("the auto mode holds its scale across a boundary wobble instead of flipping the surface", () => {
  // `floor(fit)` is a step function, so at a boundary a wobble of ONE pixel used to flip the scale
  // 2 <-> 1: the surface alternated between 1600x1200 and 800x600, the whole game doubling and
  // halving. A resizing iframe or a scrollbar appearing is enough to start it, and no single
  // screenshot shows it because either size looks fine on its own.
  for (const dpr of [1, 1.5, 2]) {
    // 2000 wide keeps the width off the limit, so the height alone decides: 2x first fits at 1200/dpr.
    const boundary = 1200 / dpr,
      wobble = [boundary, boundary - 1, boundary, boundary - 1, boundary, boundary - 1];
    const flipping: number[] = [];
    for (const height of wobble) flipping.push(viewLayout(2000, height, dpr, "pixel").deviceScale);
    assert.ok(
      new Set(flipping).size > 1,
      `without a held scale the raw boundary does flip (dpr ${dpr}: ${flipping.join(",")})`,
    );

    const seen = new Set<number>();
    let current: number | undefined = 2;
    for (const height of wobble) {
      const l = viewLayout(2000, height, dpr, "pixel", 0, current);
      seen.add(l.deviceScale);
      current = l.deviceScale;
    }
    assert.deepEqual([...seen], [2], `held scale must not flip at dpr ${dpr}`);
  }
  // Changing mode must take effect at once. Holding the old scale across a mode change would pin
  // `pixel-original` to whatever plain `pixel` was using - never reaching its floor at all.
  assert.equal(
    viewLayout(1203, 903, 1.25, "pixel-original", 0, 1).deviceScale,
    2,
    "a mode change is not a wobble: the new mode's own choice wins immediately",
  );
  // A real change of size still moves it, in both directions.
  assert.equal(viewLayout(2000, 1000, 1, "pixel", 0, 2).deviceScale, 1, "far enough below -> 1x");
  assert.equal(viewLayout(3000, 2000, 1, "pixel", 0, 2).deviceScale, 3, "enough room -> 3x");
  // Manual sizes ignore the held scale entirely: that number is the one thing the user chose.
  assert.equal(viewLayout(3000, 2000, 1, "pixel-1", 0, 3).deviceScale, 1);
});

test("pixel-original never shows the game smaller than the original 800x600 window", () => {
  // CSS size is 800*deviceScale/dpr, so reaching 800x600 needs deviceScale >= dpr, and the next
  // integer up is the only crisp way to get there. On a fractionally scaled display plain `pixel`
  // therefore renders *smaller than the original* - crisp, but shrunk.
  for (const dpr of [1, 1.25, 1.5, 2, 3])
    for (const [w, h] of [
      [2560, 1300],
      [1536, 760],
      [1280, 620],
      [900, 500],
      [4000, 3000],
    ]) {
      const l = viewLayout(w, h, dpr, "pixel-original");
      assert.ok(Number.isInteger(l.deviceScale) && l.deviceScale >= 1 && l.deviceScale <= 4);
      assert.ok(
        (800 * l.deviceScale) / dpr >= 800 - 1e-9 && (600 * l.deviceScale) / dpr >= 600 - 1e-9,
        `dpr ${dpr} at ${w}x${h} shows ${(800 * l.deviceScale) / dpr}x${(600 * l.deviceScale) / dpr}` +
          ", below the original 800x600",
      );
      // It is the auto choice with a floor, never a smaller one.
      const auto = viewLayout(w, h, dpr, "pixel");
      assert.ok(l.deviceScale >= auto.deviceScale);
    }
  // Where plain auto would shrink, this one holds the original size and says so.
  const shrunk = viewLayout(1536, 760, 1.25, "pixel"),
    held = viewLayout(1536, 760, 1.25, "pixel-original");
  assert.equal(shrunk.deviceScale, 1);
  assert.equal(
    (800 * shrunk.deviceScale) / 1.25,
    640,
    "plain auto shrinks to 640x480 on a 125% display",
  );
  assert.equal(held.deviceScale, 2);
  assert.equal(
    held.overflowing,
    true,
    "holding the original size means scrolling in a short window",
  );
});
