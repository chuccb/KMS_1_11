import test from "node:test";
import assert from "node:assert/strict";
import {
  type LensMode,
  cameraLens,
  lensMode,
  lensTransition,
  lensViewport,
  LENS_MODES,
} from "../../client/camera-lens.ts";
import { sceneViewport, screenToWorld, worldToScreen } from "../../client/scene-surface.ts";
import {
  type CameraMode,
  CAMERA_MODES,
  createCamera,
  updateCamera,
  reframeCamera,
  clampCamera,
} from "../../client/camera.ts";
import {
  advancePlayer,
  collisionWorld,
  createPlayer,
  drainPlayerPath,
  movementSnapshot,
} from "../../client/motion.ts";

test("every lens/display combination uses integer physical world pixels, fixed UI scale and bounded buffers", () => {
  for (let ui = 1; ui <= 4; ui++)
    for (const { id } of LENS_MODES) {
      const v = lensViewport(id, ui);
      assert.equal(v.uiScale, ui);
      assert.ok(Number.isInteger(v.pixelScale) && v.pixelScale >= 1 && v.pixelScale <= 12);
      assert.ok(v.width <= 3200 && v.height <= 2400);
      assert.ok(Math.abs(v.width / v.height - 4 / 3) < 1e-10);
      assert.equal(v.width * v.pixelScale, 800 * ui);
      assert.equal(v.height * v.pixelScale, 600 * ui);
    }
  assert.equal(lensViewport("wide", 1).zoom, 1);
  assert.equal(lensViewport("wide", 4).zoom, 0.25);
  assert.equal(lensViewport("near", 3).zoom, 2);
  assert.equal(lensViewport("detail", 2).zoom, 3);
});
test("invalid saved modes/scales cannot become geometry, smoothing or unbounded allocation", () => {
  for (const value of [null, {}, "fit", "__proto__", 1]) {
    assert.equal(lensMode(value), "normal");
    assert.equal(lensTransition(value), "cut");
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, 13]) assert.throws(() => sceneViewport(1, value));
  for (const value of [0, -1, 1.5, NaN, Infinity, 5]) assert.throws(() => sceneViewport(value));
});
test("screen/world inverse covers negative cameras and each zoom without altering original UI coordinates", () => {
  for (let ui = 1; ui <= 4; ui++)
    for (const { id } of LENS_MODES)
      for (const point of [
        { x: 0, y: 0 },
        { x: 321.5, y: 599 },
        { x: 800, y: 600 },
      ]) {
        const camera = { x: -233, y: 177 },
          v = lensViewport(id, ui),
          world = screenToWorld(point, camera, v),
          back = worldToScreen(world, camera, v);
        assert.ok(Math.abs(back.x - point.x) < 1e-9 && Math.abs(back.y - point.y) < 1e-9);
      }
});
test("fade switches geometry ONLY at full black, not at fractional intermediate zoom", () => {
  const lens = cameraLens();
  lens.request("detail", 100, "fade");
  assert.equal(lens.sample(100).cover, 0);
  assert.equal(lens.sample(190).mode, "normal");
  assert.equal(lens.sample(190).cover, 0.5);
  assert.deepEqual(lens.sample(280), { mode: "detail", cover: 1, style: "fade" });
  assert.equal(lens.sample(400).cover, 0.5);
  assert.equal(lens.sample(520).cover, 0);
});
test("direct lens changes are immediate and do not retain an old fade", () => {
  const lens = cameraLens();
  lens.request("detail", 0, "fade");
  lens.request("wide", 100, "cut");
  assert.deepEqual(lens.sample(100), { mode: "wide", cover: 0, style: "fade" });
  assert.equal(lens.sample(9999).cover, 0);
});
test("rapid changes during fade-out/in preserve current opacity, latest target wins", () => {
  const lens = cameraLens();
  lens.request("near", 0, "fade");
  const before = lens.sample(90);
  lens.request("wide", 90, "shutter");
  assert.equal(lens.sample(90).cover, before.cover);
  assert.equal(lens.sample(180).mode, "wide");
  const mid = lens.sample(240);
  lens.request("detail", 240, "fade");
  assert.equal(lens.sample(240).cover, mid.cover);
  assert.equal(lens.sample(1000).mode, "detail");
  assert.equal(lens.sample(1000).cover, 0);
});
test("manual replay may fade unchanged lens, no repeated animation on an ordinary unchanged preference", () => {
  const lens = cameraLens();
  lens.request("normal", 0, "fade");
  assert.equal(lens.sample(90).cover, 0);
  lens.request("normal", 100, "fade", true);
  assert.equal(lens.sample(190).cover, 0.5);
});
test("field re-entry/disconnect cancels previous transition; no stale black frame or zoom on return", () => {
  const lens = cameraLens();
  lens.request("detail", 0, "shutter");
  lens.reveal(50, "fade");
  assert.equal(lens.sample(50).mode, "detail");
  assert.equal(lens.sample(50).cover, 1);
  assert.equal(lens.sample(290).cover, 0);
  lens.request("wide", 300, "fade");
  lens.clear();
  assert.equal(lens.sample(1000).cover, 0);
  assert.equal(lens.sample(1000).mode, "wide");
});
test("absolute monotonic time is RAF-independent and suspension cannot produce lingering black", () => {
  const a = cameraLens(),
    b = cameraLens();
  a.request("near", 0, "fade");
  b.request("near", 0, "fade");
  for (let now = 0; now < 350; now += 1000 / 144) a.sample(now);
  assert.deepEqual(a.sample(350), b.sample(350));
  assert.equal(a.sample(1e8).cover, 0);
  const before = a.sample(1e8);
  assert.deepEqual(a.sample(NaN), before);
  assert.deepEqual(a.sample(-1), before);
});
test("changing FOV preserves fixed camera world centre, then each tracking mode clamps its actual viewport", () => {
  for (const { id } of CAMERA_MODES) {
    const camera = createCamera(),
      before = sceneViewport(2),
      after = lensViewport("wide", 2);
    updateCamera(camera, { x: 700, y: 500 }, id, 0, before.width, before.height);
    const center = {
      x: camera.trackingX + before.width / 2,
      y: camera.trackingY + before.height / 2,
    };
    reframeCamera(camera, before, after);
    assert.deepEqual(
      { x: camera.trackingX + after.width / 2, y: camera.trackingY + after.height / 2 },
      center,
    );
    const bounds = { left: -100, top: -100, right: 100, bottom: 100 };
    updateCamera(camera, { x: 999, y: 999 }, id, 16, after.width, after.height, bounds);
    assert.deepEqual(
      { x: camera.x, y: camera.y },
      clampCamera({ x: 0, y: 0 }, after.width, after.height, bounds),
    );
  }
});
test("all lens/tracking combinations leave simulation, collision and native movement journal unchanged", () => {
  const world = collisionWorld({
    footholds: [{ id: 1, x1: -5000, y1: 100, x2: 5000, y2: 100, prev: 0, next: 0 }],
  });
  function run(lens?: LensMode, tracking: CameraMode = "smooth") {
    const body = createPlayer(0, 100, world),
      camera = createCamera();
    let previous = sceneViewport(1);
    for (let i = 0; i < 120; i++) {
      advancePlayer(body, { horizontal: i < 80 ? 1 : -1, jump: i === 20 }, world, 16);
      if (lens) {
        const v = lensViewport(lens, 2);
        reframeCamera(camera, previous, v);
        updateCamera(camera, body, tracking, 16, v.width, v.height, undefined, body);
        previous = v;
      }
    }
    return { state: movementSnapshot(body), path: drainPlayerPath(body) };
  }
  const baseline = run();
  for (const { id: lens } of LENS_MODES)
    for (const { id: tracking } of CAMERA_MODES) assert.deepEqual(run(lens, tracking), baseline);
});
