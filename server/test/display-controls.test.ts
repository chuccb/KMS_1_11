import test from "node:test";
import assert from "node:assert/strict";
import {
  displayControls,
  displayMode,
  DISPLAY_STORAGE_KEY,
} from "../../client/display-controls.ts";
import { requireElement } from "../../client/dom.ts";
import { uiFixture, fixtureEvent } from "./helpers/ui-fixture.ts";

test("typed display owns validated independent preference, DPR-only refresh, unchanged backing and listener disposal", () => {
  const f = uiFixture();
  try {
    const viewport = Object.assign(new EventTarget(), {
      innerWidth: 1001,
      innerHeight: 801,
      devicePixelRatio: 1,
      localStorage: f.storage,
    });
    const canvas = requireElement("view", "canvas"),
      overlay = requireElement("game-ui", "div"),
      select = requireElement("view-scale", "select");
    let scales = 0;
    const controls = displayControls({
      canvas,
      context: f.ctx,
      overlay,
      select,
      viewport,
      onScale() {
        scales++;
      },
    });
    assert.equal(controls.mode(), "pixel");
    assert.equal(canvas.style.width, "800px");
    assert.equal(scales, 1);
    controls.refresh();
    assert.equal(scales, 1);
    viewport.devicePixelRatio = 1.25;
    controls.refresh();
    assert.equal(canvas.style.width, "640px");
    assert.equal(scales, 2);
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 600);
    select.value = "fit";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(f.storage.getItem(DISPLAY_STORAGE_KEY), "fit");
    assert.equal(controls.mode(), "fit");
    viewport.innerWidth = 1203;
    viewport.innerHeight = 903;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(canvas.style.width, "1203px");
    const before = scales;
    controls.dispose();
    controls.dispose();
    select.value = "native";
    select.dispatchEvent(fixtureEvent("change"));
    viewport.innerWidth = 1600;
    viewport.dispatchEvent(new Event("resize"));
    controls.refresh();
    controls.resize();
    assert.equal(scales, before);
    assert.equal(controls.mode(), "fit");
    assert.equal(f.storage.getItem(DISPLAY_STORAGE_KEY), "fit");
  } finally {
    f.restore();
  }
});

test("denied/corrupt display storage cannot block rendering; unknown mode values never become stored policy", () => {
  const f = uiFixture();
  try {
    const viewport = Object.assign(new EventTarget(), {
      innerWidth: 1001,
      innerHeight: 801,
      devicePixelRatio: 1,
      localStorage: {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("quota");
        },
      },
    });
    const select = requireElement("view-scale", "select");
    const controls = displayControls({
      canvas: requireElement("view", "canvas"),
      context: f.ctx,
      overlay: requireElement("game-ui", "div"),
      select,
      viewport,
      onScale() {},
    });
    assert.equal(controls.mode(), "pixel");
    select.value = "fit";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(controls.mode(), "fit");
    select.value = "invalid";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(controls.mode(), "pixel");
    assert.equal(select.value, "pixel");
    controls.dispose();
    for (const value of [undefined, null, {}, 1, "PIXEL", "__proto__"])
      assert.equal(displayMode(value), "pixel");
    for (const value of ["pixel", "native", "fit"] as const)
      assert.equal(displayMode(value), value);
  } finally {
    f.restore();
  }
});
