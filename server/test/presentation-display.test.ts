import test from "node:test";
import assert from "node:assert/strict";
import { viewLayout } from "../../client/display.ts";
test("1000x800 defaults to 800x600 at DPR1, not uneven 1.25x CSS fit", () => {
  const l = viewLayout(1000, 800);
  assert.deepEqual([l.width, l.height, l.left, l.top, l.deviceScale], [800, 600, 100, 100, 1]);
});
test("device-pixel integer scaling includes OS/browser zoom, and keeps hit-test aspect ratio", () => {
  for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3])
    for (const [w, h] of [
      [1000, 800],
      [1920, 1080],
      [801, 601],
      [700, 500],
      [2560, 1440],
    ]) {
      const l = viewLayout(w, h, dpr);
      assert.ok(Math.abs(l.width / l.height - 4 / 3) < 1e-12);
      assert.ok(l.width <= w + 1e-8 && l.height <= h + 1e-8);
      if (!l.downsampled) assert.ok(Math.abs(l.deviceScale - Math.round(l.deviceScale)) < 1e-9);
      assert.ok(Math.abs(l.left * dpr - Math.round(l.left * dpr)) < 1e-8);
      assert.ok(Math.abs(l.top * dpr - Math.round(l.top * dpr)) < 1e-8);
      assert.ok(
        Math.abs((l.left + 400 * l.scale - l.left) / l.scale - 400) < 1e-8,
        "logical hit-test coordinates survive presentation",
      );
    }
});
test("native and fit are explicit options; small viewports do not overflow and remain 4:3", () => {
  const native = viewLayout(1920, 1080, 2, "native"),
    fit = viewLayout(1000, 800, 1, "fit");
  assert.equal(native.scale, 1);
  assert.equal(fit.scale, 1.25);
  const tiny = viewLayout(300, 200, 1);
  assert.equal(tiny.downsampled, true);
  assert.ok(tiny.width <= 300 && tiny.height <= 200);
  for (const values of [
    [NaN, 0, 0],
    [-1, Infinity, NaN],
  ] as const)
    assert.ok(Number.isFinite(viewLayout(values[0], values[1], values[2]).scale));
});
