import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advancePlayer,
  collisionWorld,
  createPlayer,
  drainPlayerPath,
  movementSnapshot,
  queueKnockback,
} from "../../client/motion.ts";
import { samplePlayerPosition, resetPlayerPresentation } from "../../client/player-presentation.ts";
import {
  CAMERA_MODES,
  cameraMode,
  clampCamera,
  createCamera,
  updateCamera,
} from "../../client/camera.ts";
import { cameraControls, CAMERA_STORAGE_KEY } from "../../client/camera-controls.ts";
import { isEditingControl, requireElement } from "../../client/dom.ts";
import { collisionRound } from "../../client/native-terrain.ts";
import { uiFixture, fixtureEvent } from "./helpers/ui-fixture.ts";

// Isolated numeric geometry, not fabricated production WZ data or a live character.
const world = collisionWorld({
  footholds: [{ id: 1, x1: -10000, y1: 100, x2: 10000, y2: 100, prev: 0, next: 0 }],
});
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("537520/53C2B0: spawn/settling initializes both endpoints, then interpolation samples only the last complete tick", () => {
  const body = createPlayer(0, 90, world);
  assert.equal(body.y, 100);
  assert.deepEqual(body.renderPrevious, { x: 0, y: 100 });
  assert.deepEqual(samplePlayerPosition(body), { x: 0, y: 100 });
  advancePlayer(body, { horizontal: 1, jump: true }, world, 75);
  assert.equal(body.accumulator, 15);
  const previous = body.renderPrevious!;
  assert.notEqual(previous.x, 0, "two completed ticks must not retain the spawn endpoint");
  assert.ok(previous.y < 100);
  assert.deepEqual(samplePlayerPosition(body), {
    x: collisionRound((previous.x + body.x) / 2),
    y: collisionRound((previous.y + body.y) / 2),
  });
  const before = structuredClone(body);
  for (let i = 0; i < 100; i++) samplePlayerPosition(body);
  assert.deepEqual(
    body,
    before,
    "sampling must not integrate another tick or mutate input/wire state",
  );
});

test("53C2B0: signed native raster rounding, endpoint clamp, invalid remainder and legacy-body fallback", () => {
  const body = { x: 10, y: -10, accumulator: 15, renderPrevious: { x: 0, y: 0 } };
  assert.deepEqual(samplePlayerPosition(body), { x: 5, y: -5 });
  for (const accumulator of [-100, Number.NaN, Number.POSITIVE_INFINITY])
    assert.deepEqual(samplePlayerPosition({ ...body, accumulator }), { x: 0, y: 0 });
  assert.deepEqual(samplePlayerPosition({ ...body, accumulator: 100 }), { x: 10, y: -10 });
  assert.deepEqual(samplePlayerPosition({ x: -1.5, y: 1.5, accumulator: 15 }), {
    x: collisionRound(-1.5),
    y: collisionRound(1.5),
  });
});

for (const jump of [false, true]) {
  test(`walking${jump ? " jump" : ""}: 30/60/120/144Hz RAF yields identical physics, wire and display at common times`, () => {
    const results = [30, 60, 120, 144].map((hz) => {
      const body = createPlayer(-80, 100, world);
      drainPlayerPath(body);
      for (let frame = 0; frame < hz; frame++) {
        advancePlayer(body, { horizontal: 1, jump }, world, 1000 / hz);
        const before = structuredClone(body);
        samplePlayerPosition(body);
        assert.deepEqual(body, before);
      }
      const path = drainPlayerPath(body);
      return { state: movementSnapshot(body), path, point: samplePlayerPosition(body) };
    });
    for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
  });
}

test("walking and vertical movement have intermediate render positions instead of holding every 30ms endpoint", () => {
  for (const jump of [false, true]) {
    const body = createPlayer(0, 100, world);
    advancePlayer(body, { horizontal: 1, jump }, world, 120);
    const endpoint = movementSnapshot(body);
    const points = [samplePlayerPosition(body)];
    for (let i = 0; i < 3; i++) {
      advancePlayer(body, { horizontal: 1, jump }, world, 8);
      assert.deepEqual(movementSnapshot(body), endpoint);
      points.push(samplePlayerPosition(body));
    }
    assert.ok(
      new Set(points.map((p) => p.x)).size > 1,
      "walking must advance visually between ticks",
    );
    if (jump)
      assert.ok(
        new Set(points.map((p) => p.y)).size > 1,
        "jumping must also advance visually between ticks",
      );
    assert.ok(
      points.every((p) => p.x <= collisionRound(body.x)),
      "do not extrapolate into untested terrain",
    );
  }
});

test("ladder/knockback use the same presentation vector without changing impulses, jump latch or path", () => {
  const ropeWorld = collisionWorld({
    footholds: [],
    ladders: [{ id: 2, x: 0, y1: -200, y2: 200 }],
  });
  const body = createPlayer(0, 0, ropeWorld, 0, false);
  body.ladder = ropeWorld.ladders[0];
  advancePlayer(body, { vertical: -1 }, ropeWorld, 45);
  assert.equal(body.y, -3);
  assert.equal(samplePlayerPosition(body).y, collisionRound(-1.5));
  const knocked = createPlayer(0, 100, world);
  queueKnockback(knocked, -125, -200);
  advancePlayer(knocked, {}, world, 45);
  assert.ok(knocked.y < 100);
  const previous = structuredClone(knocked);
  samplePlayerPosition(knocked);
  assert.deepEqual(knocked, previous);
});

test("suspension/correction resets endpoints only; no blending across portals and no phantom movement journal", () => {
  const body = createPlayer(0, 100, world);
  advancePlayer(body, { horizontal: 1 }, world, 75);
  const { renderPrevious: _old, ...authoritative } = structuredClone(body);
  resetPlayerPresentation(body);
  const { renderPrevious: _new, ...after } = body;
  assert.deepEqual(after, authoritative);
  assert.deepEqual(samplePlayerPosition(body), {
    x: collisionRound(body.x),
    y: collisionRound(body.y),
  });
  const corrected = createPlayer(300, -80, world, 0, false);
  assert.deepEqual(samplePlayerPosition(corrected), { x: 300, y: -80 });
  advancePlayer(corrected, {}, world, 250);
  const previous = corrected.renderPrevious!;
  assert.ok(previous.y < corrected.y);
  close(corrected.accumulator, 10);
  assert.deepEqual(samplePlayerPosition(corrected), {
    x: collisionRound(previous.x + (corrected.x - previous.x) / 3),
    y: collisionRound(previous.y + (corrected.y - previous.y) / 3),
  });
});

const bounds = { left: -1000, top: -800, right: 2000, bottom: 1200 };
test("470340 camera limits: all four edges, fractional/negative coordinates and small-map midpoint", () => {
  assert.deepEqual(clampCamera({ x: -5000, y: 5000 }, 800, 600, bounds), { x: -1000, y: 600 });
  assert.deepEqual(clampCamera({ x: 5000, y: -5000 }, 800, 600, bounds), { x: 1200, y: -800 });
  assert.deepEqual(clampCamera({ x: -1.25, y: -2.5 }, 800, 600), { x: -1.25, y: -2.5 });
  assert.deepEqual(
    clampCamera({ x: 999, y: 999 }, 800, 600, { left: -104, right: 101, top: -54, bottom: 51 }),
    { x: -401, y: -301 },
    "47077F/4707A6: signed integer midpoint before viewport subtraction, not raster rounding of a half pixel",
  );
  const small = { left: -100, right: 101, top: -50, bottom: 50 };
  for (const { id } of CAMERA_MODES) {
    const camera = createCamera();
    updateCamera(camera, { x: 500, y: 500 }, id, 16, 800, 600, small);
    assert.equal(camera.trackingX, -400);
    assert.equal(camera.trackingY, -300);
    assert.equal(camera.x, -400);
    assert.equal(camera.y, -300);
  }
});

test("camera initial/recenter/map reset overwrites both float tracking and raster origin, including fixed mode", () => {
  for (const { id } of CAMERA_MODES) {
    const camera = createCamera();
    updateCamera(camera, { x: 0, y: 0 }, id, 16, 800, 600);
    assert.deepEqual({ x: camera.x, y: camera.y }, { x: -400, y: -300 });
    camera.ready = false;
    updateCamera(camera, { x: 900, y: 800 }, id, 0, 800, 600, bounds);
    assert.equal(camera.x, 500);
    assert.equal(camera.y, 500);
    assert.equal(camera.trackingX, 500);
    assert.equal(camera.trackingY, 500);
  }
});

test("center is immediate; fixed preserves current origin; zone moves only beyond its explicit margins", () => {
  const camera = createCamera();
  updateCamera(camera, { x: 400, y: 300 }, "center", 0, 800, 600);
  updateCamera(camera, { x: 450, y: 370 }, "zone", 16, 800, 600);
  assert.equal(camera.x, 0);
  assert.equal(camera.y, 0);
  updateCamera(camera, { x: 550, y: 450 }, "zone", 16, 800, 600);
  assert.equal(camera.x, 50);
  assert.equal(camera.y, 50);
  updateCamera(camera, { x: 0, y: 0 }, "fixed", 100, 800, 600);
  assert.equal(camera.x, 50);
  assert.equal(camera.y, 50);
  updateCamera(camera, { x: 0, y: 0 }, "center", 0, 800, 600);
  assert.equal(camera.x, -400);
  assert.equal(camera.y, -300);
  updateCamera(camera, { x: 700, y: 700 }, "zone", 16, 800, 600);
  updateCamera(camera, { x: -900, y: -700 }, "zone", 16, 800, 600);
  assert.equal(camera.x, -1200);
  assert.equal(camera.y, -900);
});

test("smooth follows a continuous float, not a repeatedly rounded origin; static-target response is frame-rate independent", () => {
  const results = [30, 60, 120, 144].map((hz) => {
    const camera = createCamera();
    updateCamera(camera, { x: 400, y: 300 }, "smooth", 0, 800, 600);
    for (let i = 0; i < hz; i++)
      updateCamera(camera, { x: 500, y: 400 }, "smooth", 1000 / hz, 800, 600);
    return camera;
  });
  for (const result of results) {
    close(result.trackingX, 100 * (1 - 0.82 ** 60));
    close(result.trackingY, result.trackingX);
    assert.equal(result.x, 100);
    assert.equal(result.y, 100);
  }
  const camera = createCamera();
  updateCamera(camera, { x: 400, y: 300 }, "smooth", 0, 800, 600);
  for (let i = 0; i < 300; i++)
    updateCamera(camera, { x: 401, y: 301 }, "smooth", 1000 / 144, 800, 600);
  assert.equal(camera.x, 1, "small movements must not get stuck by throwing away float residuals");
  const before = { ...camera };
  for (const elapsed of [-10, Number.NaN, Number.POSITIVE_INFINITY]) {
    updateCamera(camera, { x: 800, y: 600 }, "smooth", elapsed, 800, 600);
    assert.deepEqual(camera, before);
  }
});

test("late map bounds clamp even a fixed camera; mode decoding rejects untrusted preferences", () => {
  const camera = createCamera();
  updateCamera(camera, { x: 9000, y: 9000 }, "fixed", 0, 800, 600);
  updateCamera(camera, { x: 9000, y: 9000 }, "fixed", 16, 800, 600, bounds);
  assert.equal(camera.x, 1200);
  assert.equal(camera.y, 600);
  for (const invalid of [undefined, null, {}, "CENTER", "native", 1, "__proto__"])
    assert.equal(cameraMode(invalid), "smooth");
  for (const { id } of CAMERA_MODES) assert.equal(cameraMode(id), id);
});

test("typed camera controls populate real HTML schema, persist independently and recenter without a game transport", () => {
  const f = uiFixture();
  try {
    f.storage.setItem(CAMERA_STORAGE_KEY, "zone");
    f.storage.setItem("kms111.soundSettings", "untouched");
    let recentered = 0;
    const select = requireElement("camera-mode", "select");
    const button = requireElement("camera-recenter", "button");
    const controls = cameraControls(select, button, () => recentered++, f.storage);
    assert.equal(controls.mode(), "zone");
    assert.equal(select.children.length, CAMERA_MODES.length);
    assert.match(select.title, /晃動/);
    for (const { id } of CAMERA_MODES) {
      select.value = id;
      select.dispatchEvent(fixtureEvent("change"));
      assert.equal(controls.mode(), id);
      assert.equal(f.storage.getItem(CAMERA_STORAGE_KEY), id);
    }
    for (const key of [" ", "Enter", "ArrowLeft"]) {
      let stopped = false;
      const observe = (event: Event) => {
        stopped = event.cancelBubble;
      };
      button.addEventListener("keydown", observe);
      button.dispatchEvent(fixtureEvent("keydown", { key }));
      assert.equal(stopped, key !== "ArrowLeft");
      button.removeEventListener("keydown", observe);
    }
    button.click();
    assert.equal(recentered, 1);
    assert.equal(f.storage.getItem("kms111.soundSettings"), "untouched");
    assert.equal(isEditingControl(select), true);
    assert.equal(isEditingControl(document.createElement("textarea")), true);
    assert.equal(isEditingControl(document.createElement("input")), true);
    assert.equal(isEditingControl(button), false);
    assert.equal(isEditingControl(null), false);
  } finally {
    f.restore();
  }
});

test("denied preference storage does not break selection/recenter; corrupt preferences fall back without writing on startup", () => {
  const f = uiFixture();
  try {
    const select = requireElement("camera-mode", "select"),
      button = requireElement("camera-recenter", "button");
    let writes = 0;
    const controls = cameraControls(select, button, () => {}, {
      getItem() {
        throw new Error("blocked read");
      },
      setItem() {
        writes++;
        throw new Error("quota/security");
      },
    });
    assert.equal(controls.mode(), "smooth");
    assert.equal(writes, 0);
    select.value = "fixed";
    select.dispatchEvent(fixtureEvent("change"));
    assert.equal(controls.mode(), "fixed");
    assert.equal(writes, 1);
    f.storage.setItem(CAMERA_STORAGE_KEY, "invalid-json-or-mode");
    assert.equal(cameraControls(select, button, () => {}, f.storage).mode(), "smooth");
    assert.equal(f.storage.getItem(CAMERA_STORAGE_KEY), "invalid-json-or-mode");
  } finally {
    f.restore();
  }
});

test("main wires one displayed point to camera/avatar/attached effects and retains authoritative contact/attack/movement sources", () => {
  const source = readFileSync(new URL("../../client/main.js", import.meta.url), "utf8");
  assert.ok(source.includes("const displaySelf = selfDisplayPosition();"));
  assert.match(source, /updateCamera\(\s*camera,\s*displaySelf/);
  assert.ok(source.includes("self: displaySelf"));
  assert.ok(source.includes("? actor.self.x - cameraX"));
  assert.ok(source.includes("facingFlip(selfView.facing), actor.self)"));
  assert.ok(source.includes("const position=id===selfView?.characterId?displaySelf:entity;"));
  assert.ok(source.includes("position:entity===selfView?displaySelf:entity"));
  assert.ok(source.includes("getSelf: selfDisplayPosition"));
  assert.ok(source.includes("selfView.hp <= 0, displaySelf, now"));
  assert.ok(source.includes("self.x = playerBody.x;"));
  assert.ok(
    source.includes("x:self.x,y:self.y,facing:selfView.facing,previous:previousContactPlayer"),
  );
  assert.ok(source.includes("const source={x:Math.trunc(self.x),y:Math.trunc(self.y)};"));
  assert.ok(source.includes("drainPlayerPath(playerBody)"));
  assert.ok(!source.includes("CAMERA_EASE"));
  assert.ok(!source.includes("cameraTarget("));
  assert.ok(!source.includes("instanceof HTMLInputElement"));
});
