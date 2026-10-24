import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RESOLUTION,
  RESOLUTION_OPTIONS,
  originGrid,
  resolutionId,
  resolutionLayout,
} from "../../client/display.ts";

test("the fixed 4:3 menu has the required native-pixel presets and defaults to 800×600", () => {
  assert.equal(DEFAULT_RESOLUTION, "800x600");
  assert.deepEqual(
    RESOLUTION_OPTIONS.map(({ id, width, height }) => [id, width, height]),
    [
      ["800x600", 800, 600],
      ["1024x768", 1024, 768],
      ["1280x960", 1280, 960],
      ["1600x1200", 1600, 1200],
    ],
  );
  assert.equal(resolutionId("not-a-resolution"), DEFAULT_RESOLUTION);
});

test("selected backing dimensions are exact, 4:3 and independent of viewport/DPR", () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3])
    for (const option of RESOLUTION_OPTIONS) {
      const l = resolutionLayout(1000, 800, dpr, option.id);
      assert.deepEqual([l.backingWidth, l.backingHeight], [option.width, option.height]);
      assert.deepEqual([l.resolutionWidth, l.resolutionHeight], [option.width, option.height]);
      assert.equal(l.deviceScale, 1, "resolution never scales source sprites");
      assert.ok(Math.abs(l.width - option.width / dpr) < 1e-10);
      assert.ok(Math.abs(l.height - option.height / dpr) < 1e-10);
      assert.ok(Math.abs(l.width / l.height - 4 / 3) < 1e-12);
      assert.ok(Math.abs(l.left * dpr - Math.round(l.left * dpr)) < 1e-8);
      assert.ok(Math.abs(l.top * dpr - Math.round(l.top * dpr)) < 1e-8);
      assert.ok(l.contentWidth >= l.left + l.width - 1e-8);
      assert.ok(l.contentHeight >= l.top + l.height - 1e-8);
    }
});

test("larger resolutions scroll without resampling, while 800×600 remains centered when it fits", () => {
  const base = resolutionLayout(1000, 800, 1, "800x600");
  assert.deepEqual([base.width, base.height, base.left, base.top], [800, 600, 100, 100]);
  for (const id of ["1024x768", "1280x960", "1600x1200"] as const) {
    const l = resolutionLayout(900, 700, 1, id);
    assert.equal(l.overflowing, true);
    assert.equal(l.left, 0);
    assert.equal(l.top, 0);
    assert.ok(l.contentWidth >= l.backingWidth);
    assert.ok(l.contentHeight >= l.backingHeight);
  }
  const tiny = resolutionLayout(300, 200, 1, "800x600");
  assert.deepEqual([tiny.backingWidth, tiny.backingHeight, tiny.overflowing], [800, 600, true]);
});

test("fixed header reserves rows and scroll tails stay aligned to CSS/device origins", () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 3]) {
    const plain = resolutionLayout(1700, 1300, dpr, "800x600"),
      withHeader = resolutionLayout(1700, 1300, dpr, "800x600", 43),
      grid = originGrid(dpr);
    assert.ok(withHeader.top >= 43);
    assert.ok(withHeader.top > plain.top);
    for (const layout of [plain, withHeader]) {
      assert.ok(
        Math.abs(
          (layout.contentWidth - 1700) / grid - Math.round((layout.contentWidth - 1700) / grid),
        ) < 1e-8,
      );
      assert.ok(
        Math.abs(
          (layout.contentHeight - 1300) / grid - Math.round((layout.contentHeight - 1300) / grid),
        ) < 1e-8,
      );
    }
  }
  const invalid = resolutionLayout(NaN, Infinity, 0, "bogus");
  assert.deepEqual([invalid.backingWidth, invalid.backingHeight, invalid.dpr], [800, 600, 1]);
});
