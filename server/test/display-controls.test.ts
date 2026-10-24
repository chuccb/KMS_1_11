import test from "node:test";
import assert from "node:assert/strict";
import {
  displayControls,
  resolutionId,
  RESOLUTION_STORAGE_KEY,
} from "../../client/display-controls.ts";
import { requireElement } from "../../client/dom.ts";
import { RESOLUTION_OPTIONS } from "../../client/display.ts";
import { uiFixture, fixtureEvent } from "./helpers/ui-fixture.ts";

test("fixed-resolution control defaults to 800×600 and keeps backing, overlay, DPR and preference aligned", () => {
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
      stage: requireElement("game-stage", "div"),
      scroll: requireElement("game-viewport", "div"),
      select,
      viewport,
      onScale() {
        scales++;
      },
    });
    assert.equal(controls.mode(), "800x600");
    assert.equal(canvas.style.width, "800px");
    assert.equal(canvas.style.height, "600px");
    assert.equal(overlay.style.width, "800px");
    assert.equal(overlay.style.height, "600px");
    assert.equal(scales, 1);
    controls.refresh();
    assert.equal(scales, 1);
    viewport.devicePixelRatio = 1.25;
    controls.refresh();
    assert.equal(canvas.style.width, "800px");
    assert.equal(canvas.style.height, "600px");
    assert.equal(canvas.style.transform, "scale(0.8)");
    assert.equal(canvas.style.transformOrigin, "0 0");
    assert.equal(overlay.style.transform, "scale(0.8)");
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 600);
    assert.equal(scales, 2);
    select.value = "1024x768";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(f.storage.getItem(RESOLUTION_STORAGE_KEY), "1024x768");
    assert.equal(controls.mode(), "1024x768");
    assert.equal(canvas.width, 1024);
    assert.equal(canvas.height, 768);
    assert.equal(canvas.style.width, "1024px");
    assert.equal(canvas.style.height, "768px");
    assert.equal(overlay.style.width, "1024px");
    assert.equal(overlay.style.height, "768px");
    assert.equal(canvas.style.transform, "scale(0.8)");
    assert.equal(
      select.children.length,
      RESOLUTION_OPTIONS.length,
      "one option per fixed resolution",
    );
    viewport.innerWidth = 1203;
    viewport.innerHeight = 903;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(canvas.width, 1024, "window size never changes the selected game resolution");
    assert.equal(canvas.height, 768);
    assert.equal(canvas.style.transform, "scale(0.8)");
    const before = scales;
    controls.dispose();
    controls.dispose();
    select.value = "1600x1200";
    select.dispatchEvent(fixtureEvent("change"));
    viewport.innerWidth = 1600;
    viewport.dispatchEvent(new Event("resize"));
    controls.refresh();
    controls.resize();
    assert.equal(scales, before);
    assert.equal(controls.mode(), "1024x768");
    assert.equal(f.storage.getItem(RESOLUTION_STORAGE_KEY), "1024x768");
  } finally {
    f.restore();
  }
});

test("denied/corrupt preference storage cannot block rendering; invalid ids reset to 800×600", () => {
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
      stage: requireElement("game-stage", "div"),
      scroll: requireElement("game-viewport", "div"),
      select,
      viewport,
      onScale() {},
    });
    assert.equal(controls.mode(), "800x600");
    select.value = "1024x768";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(controls.mode(), "1024x768");
    select.value = "invalid";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(controls.mode(), "800x600");
    assert.equal(select.value, "800x600");
    controls.dispose();
    for (const value of [undefined, null, {}, 1, "800X600", "__proto__"])
      assert.equal(resolutionId(value), "800x600");
    for (const value of ["800x600", "1024x768", "1280x960", "1600x1200"] as const)
      assert.equal(resolutionId(value), value);
  } finally {
    f.restore();
  }
});
