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
  assert.equal(DISPLAY_MODES.length, 5);
  assert.deepEqual(
    DISPLAY_MODES.slice(1).map((mode) => viewLayout(10000, 10000, 2, mode).deviceScale),
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
