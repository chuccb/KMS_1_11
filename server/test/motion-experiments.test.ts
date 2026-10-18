import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PHYSICS_STEPS, physicsStep, presentationMode } from "../../client/motion-tuning.ts";
import {
  advancePlayer,
  collisionWorld,
  createPlayer,
  movementSnapshot,
  drainPlayerPath,
  queueKnockback,
} from "../../client/motion.ts";
import { samplePlayerPosition } from "../../client/player-presentation.ts";
import { CAMERA_MODES, createCamera, updateCamera } from "../../client/camera.ts";
import {
  motionControls,
  MOTION_STEP_STORAGE_KEY,
  MOTION_PRESENTATION_STORAGE_KEY,
} from "../../client/motion-controls.ts";
import { readBrowserMovePath } from "../src/net/browsermove.ts";
import { encodeClientUserMove, readClientUserMove } from "../src/protocol/field.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { requireElement } from "../../client/dom.ts";
import { uiFixture, fixtureEvent } from "./helpers/ui-fixture.ts";

const world = collisionWorld({
  footholds: [{ id: 1, x1: -10000, y1: 100, x2: 10000, y2: 100, prev: 0, next: 0 }],
});
const close = (actual: number, expected: number, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

for (const ms of PHYSICS_STEPS) {
  test(`experimental ${ms}ms: real integration, unchanged time units, bounded wire path and RAF independence`, () => {
    for (const jump of [false, true]) {
      const states = [30, 60, 120, 144].map((hz) => {
        const body = createPlayer(0, 100, world);
        for (let i = 0; i < hz; i++)
          advancePlayer(body, { horizontal: 1, jump }, world, 1000 / hz, ms);
        const path = drainPlayerPath(body);
        assert.deepEqual(readBrowserMovePath(path), path);
        const encoded = encodeClientUserMove({ stageByte: 0, path });
        assert.deepEqual(readClientUserMove(new PacketReader(encoded, 1)).path, path);
        assert.equal(body.simulationStepMs, ms);
        close(body.accumulator, 1000 % ms);
        assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y));
        return { state: movementSnapshot(body), path, point: samplePlayerPosition(body) };
      });
      for (const state of states.slice(1)) assert.deepEqual(state, states[0]);
    }
    const body = createPlayer(0, 100, world);
    let integrated = 0;
    for (let frame = 1; frame <= 24; frame++) {
      advancePlayer(body, { horizontal: 1 }, world, 15, ms);
      if (frame % 6 === 0) {
        const path = readBrowserMovePath(drainPlayerPath(body));
        integrated += path.elements.reduce((sum, e) => sum + e.duration, 0);
      }
    }
    assert.equal(integrated, 360);
    assert.equal(body.accumulator, 0);
    assert.equal(body.vx, 125, "smaller dt must not multiply walking speed");
  });
}

test("live step switching preserves pending elapsed milliseconds and packet durations, not accumulator fraction", () => {
  const body = createPlayer(0, 100, world);
  advancePlayer(body, { horizontal: 1 }, world, 29);
  assert.equal(body.accumulator, 29);
  assert.equal(body.x, 0);
  advancePlayer(body, { horizontal: 1 }, world, 0, 5);
  assert.equal(body.accumulator, 4);
  assert.equal(
    drainPlayerPath(body).elements.reduce((sum, e) => sum + e.duration, 0),
    25,
  );
  const before = movementSnapshot(body);
  advancePlayer(body, { horizontal: 1 }, world, 0, 60);
  assert.deepEqual(movementSnapshot(body), before);
  assert.equal(body.accumulator, 4);
  advancePlayer(body, { horizontal: 1 }, world, 56, 60);
  assert.equal(body.accumulator, 0);
  assert.equal(
    drainPlayerPath(body).elements.reduce((sum, e) => sum + e.duration, 0),
    60,
  );
});

test("selected interval drives interpolation; direct sampling changes only presentation, never physics or pending input", () => {
  for (const ms of PHYSICS_STEPS) {
    const body = {
      x: 100,
      y: 200,
      accumulator: ms / 2,
      simulationStepMs: ms,
      renderPrevious: { x: 0, y: 0 },
    };
    const before = structuredClone(body);
    assert.deepEqual(samplePlayerPosition(body), { x: 50, y: 100 });
    assert.deepEqual(samplePlayerPosition(body, "direct"), { x: 100, y: 200 });
    assert.deepEqual(body, before);
  }
  for (const value of [0, 1, -1, NaN, Infinity, 7, 8.333, "5", {}, null, undefined])
    assert.equal(physicsStep(value), 30);
  for (const value of [null, {}, "predict", 1])
    assert.equal(presentationMode(value), "interpolate");
});

test("all selected steps keep climb speed in px/second, consume a jump once and retain KB transition markers", () => {
  const rope = collisionWorld({ footholds: [], ladders: [{ id: 1, x: 0, y1: -1000, y2: 1000 }] });
  for (const ms of PHYSICS_STEPS) {
    const body = createPlayer(0, 0, rope, 0, false);
    body.ladder = rope.ladders[0];
    for (let i = 0; i < 24; i++) advancePlayer(body, { vertical: -1 }, rope, 15, ms);
    close(body.y, -36);
    assert.equal(body.vy, -100);
    const jumping = createPlayer(0, 100, world);
    advancePlayer(jumping, { jump: true }, world, 60, ms);
    assert.equal(jumping.groundJumps, 1);
    queueKnockback(jumping, 100, -100);
    advancePlayer(jumping, {}, world, 60, ms);
    assert.equal(jumping.knockback, undefined);
    const path = drainPlayerPath(jumping);
    assert.equal(path.elements.filter((e) => e.attr === 2).length, 1);
    assert.deepEqual(readBrowserMovePath(path), path);
  }
});

test("typed motion preferences own DOM/storage/reset/Escape and dispose without game transport", () => {
  const f = uiFixture();
  try {
    f.storage.setItem(MOTION_STEP_STORAGE_KEY, "8");
    f.storage.setItem(MOTION_PRESENTATION_STORAGE_KEY, "direct");
    f.storage.setItem("kms111.cameraMode", "spring");
    const step = requireElement("physics-step", "select"),
      presentation = requireElement("presentation-mode", "select");
    const panel = requireElement("motion-lab", "details"),
      reset = requireElement("motion-reset", "button");
    let interactions = 0,
      closed = 0;
    const controls = motionControls({
      step,
      presentation,
      panel,
      reset,
      status: requireElement("motion-status", "p"),
      storage: f.storage,
      onInteract() {
        interactions++;
      },
      onClose() {
        closed++;
      },
    });
    assert.equal(controls.stepMs(), 8);
    assert.equal(controls.presentation(), "direct");
    assert.equal(step.children.length, PHYSICS_STEPS.length);
    for (const ms of PHYSICS_STEPS) {
      step.value = String(ms);
      step.dispatchEvent(fixtureEvent("change"));
      assert.equal(controls.stepMs(), ms);
      assert.equal(f.storage.getItem(MOTION_STEP_STORAGE_KEY), String(ms));
    }
    reset.click();
    assert.equal(controls.stepMs(), 30);
    assert.equal(controls.presentation(), "interpolate");
    assert.equal(f.storage.getItem("kms111.cameraMode"), "spring");
    panel.open = true;
    assert.equal(controls.open, true);
    const event = fixtureEvent("keydown", { key: "Escape" });
    panel.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(controls.open, false);
    assert.equal(closed, 1);
    panel.open = true;
    controls.dismiss(); // Stage changes close a hidden popup without stealing login input focus.
    assert.equal(controls.open, false);
    assert.equal(closed, 1);
    controls.dispose();
    const before = interactions;
    step.value = "5";
    step.dispatchEvent(fixtureEvent("change"));
    reset.click();
    assert.equal(interactions, before);
    assert.equal(controls.stepMs(), 30);
  } finally {
    f.restore();
  }
});

test("denied preference reads/writes stay independent, default to native step and never write on startup", () => {
  const f = uiFixture();
  try {
    let writes = 0;
    const step = requireElement("physics-step", "select"),
      presentation = requireElement("presentation-mode", "select");
    const controls = motionControls({
      panel: requireElement("motion-lab", "details"),
      step,
      presentation,
      reset: requireElement("motion-reset", "button"),
      status: requireElement("motion-status", "p"),
      onInteract() {},
      onClose() {},
      storage: {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          writes++;
          throw new Error("quota");
        },
      },
    });
    assert.equal(writes, 0);
    assert.equal(controls.stepMs(), 30);
    step.value = "10";
    presentation.value = "direct";
    step.dispatchEvent(fixtureEvent("change"));
    assert.equal(writes, 2);
    assert.equal(controls.stepMs(), 10);
    assert.equal(controls.presentation(), "direct");
    step.value = "0";
    presentation.value = "bad";
    presentation.dispatchEvent(fixtureEvent("change"));
    assert.equal(controls.stepMs(), 30);
    assert.equal(controls.presentation(), "interpolate");
    controls.dispose();
  } finally {
    f.restore();
  }
});

for (const mode of ["spring", "cinema"] as const) {
  test(`${mode} analytic damping is stable and static-target response is identical across render rates`, () => {
    const cameras = [30, 60, 120, 144].map((hz) => {
      const camera = createCamera();
      updateCamera(camera, { x: 400, y: 300 }, mode, 0, 800, 600);
      for (let i = 0; i < hz; i++)
        updateCamera(camera, { x: 600, y: 400 }, mode, 1000 / hz, 800, 600);
      return camera;
    });
    for (const camera of cameras.slice(1)) {
      close(camera.trackingX, cameras[0]!.trackingX);
      close(camera.trackingY, cameras[0]!.trackingY);
      close(camera.velocityX, cameras[0]!.velocityX);
      close(camera.velocityY, cameras[0]!.velocityY);
    }
  });
}

test("new framing modes are distinct: velocity lead, elastic overshoot, cinema bias, jump hold, soft zone and facing shoulder", () => {
  const results = new Map<string, { x: number; y: number }>();
  for (const { id } of CAMERA_MODES) {
    const camera = createCamera();
    updateCamera(camera, { x: 400, y: 300 }, id, 0, 800, 600);
    for (let i = 0; i < 20; i++)
      updateCamera(camera, { x: 600, y: 220 }, id, 16, 800, 600, undefined, {
        vx: 125,
        vy: -100,
        grounded: false,
        facing: 0,
      });
    results.set(id, { x: camera.trackingX, y: camera.trackingY });
  }
  assert.equal(
    new Set([...results.values()].map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size,
    CAMERA_MODES.length,
  );
  assert.ok(results.get("lead")!.x > 200);
  assert.ok(results.get("spring")!.x > 200, "elastic mode intentionally overshoots");
  assert.equal(results.get("platform")!.y, 0, "small jumps do not pump the vertical camera");
  assert.ok(results.get("soft-zone")!.x < results.get("zone")!.x);
  assert.ok(results.get("shoulder")!.x > results.get("lead")!.x);
});

test("every camera clamps at VR boundaries, clears momentum on recenter/map changes and never mutates its subject", () => {
  const bounds = { left: 0, top: 0, right: 2000, bottom: 1200 };
  const subject = { x: 1000, y: 600 };
  const motion = { vx: 500, vy: 500, grounded: false, facing: 1 };
  for (const { id } of CAMERA_MODES) {
    const camera = createCamera();
    updateCamera(camera, subject, id, 0, 800, 600, bounds, motion);
    for (let i = 0; i < 200; i++)
      updateCamera(camera, { x: 5000, y: 5000 }, id, 16, 800, 600, bounds, motion);
    assert.ok(camera.x >= 0 && camera.x <= 1200 && camera.y >= 0 && camera.y <= 600);
    assert.ok(Number.isFinite(camera.velocityX) && Number.isFinite(camera.velocityY));
    camera.ready = false;
    updateCamera(camera, subject, id, 16, 800, 600, bounds, motion);
    assert.equal(camera.x, 600);
    assert.equal(camera.y, 300);
    assert.equal(camera.velocityX, 0);
    assert.equal(camera.velocityY, 0);
    assert.equal(camera.leadX, 0);
    updateCamera(camera, subject, "fixed", 16, 800, 600, bounds, motion);
    assert.equal(camera.velocityX, 0);
    assert.equal(camera.velocityY, 0);
  }
  assert.deepEqual(subject, { x: 1000, y: 600 });
  assert.deepEqual(motion, { vx: 500, vy: 500, grounded: false, facing: 1 });
});

test("main retains native ITEM and I inventory entry, removes only duplicate header, and wires tuning through physics/presentation/camera", () => {
  const main = readFileSync(new URL("../../client/main.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../../client/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /inv-toggle/);
  assert.doesNotMatch(main, /inv-toggle/);
  assert.match(main, /if \(button.action === "inventory"\) \{\s*toggleInventory\(\)/);
  assert.match(main, /event.key.toLowerCase\(\) === "i"[\s\S]*?toggleInventory\(\)/);
  assert.match(main, /advancePlayer\([\s\S]*?terrain,\s*elapsed,\s*motionSettings.stepMs\(\)/);
  assert.match(main, /samplePlayerPosition\(playerBody, motionSettings.presentation\(\)\)/);
  assert.match(
    main,
    /updateCamera\(\s*camera,\s*displaySelf[\s\S]*?mapArt\?\.bounds,\s*playerBody/,
  );
  assert.match(main, /testToolsPanel.open \|\| motionSettings.open/);
});
