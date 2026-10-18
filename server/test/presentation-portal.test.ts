import type { PortalTarget, PortalBody } from "../../client/portals.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { movementPortal, arrivalPortal } from "../../client/portals.ts";
const p = (type = 2, extra: Partial<PortalTarget> = {}) => ({
  name: "door",
  type,
  x: 100,
  y: 200,
  toMapId: 10000,
  ...extra,
});
const b = (extra: Partial<PortalBody> = {}) => ({ x: 100, y: 200, grounded: true, ...extra });
test("manual type 1/2 require grounded Up; type 0 cannot activate", () => {
  for (const type of [1, 2]) {
    const door = p(type);
    assert.equal(movementPortal([door], b(), false), undefined);
    assert.equal(movementPortal([door], b(), true), door);
    assert.equal(movementPortal([door], b({ grounded: false }), true), undefined);
    assert.equal(movementPortal([door], b({ ladder: {} }), true), undefined);
  }
  assert.equal(movementPortal([p(0)], b(), true), undefined);
});
test("native manual RECT is left/top inclusive, right/bottom exclusive", () => {
  const door = p();
  for (const [dx, dy, valid] of [
    [-20, -50, true],
    [19.99, 49.99, true],
    [20, 0, false],
    [0, 50, false],
    [-20.01, 0, false],
    [0, -50.01, false],
  ] as const)
    assert.equal(
      movementPortal([door], b({ x: 100 + dx, y: 200 + dy }), true),
      valid ? door : undefined,
    );
});
test("type 3 auto is independent of Up and grounded state, within its own 100x100 RECT", () => {
  const door = p(3);
  assert.equal(movementPortal([door], b({ grounded: false })), door);
  assert.equal(movementPortal([door], b({ x: 50, y: 150 })), door);
  assert.equal(movementPortal([door], b({ x: 150 })), undefined);
  assert.equal(movementPortal([door], b({ y: 250 })), undefined);
});
test("reverse load order, auto pool priority, disabled targets and real map zero", () => {
  const a = p(1, { name: "a" }),
    z = p(2, { name: "z" }),
    auto = p(3);
  assert.equal(movementPortal([a, z], b(), true), z);
  assert.equal(movementPortal([auto, z], b(), true), auto);
  for (const toMapId of [999999999, -1, undefined])
    assert.equal(movementPortal([p(2, { toMapId })], b(), true), undefined);
  const zero = p(2, { toMapId: 0 });
  assert.equal(movementPortal([zero], b(), true), zero);
});
test("spawn byte indexes non-type-3 array including sp; out-of-range falls back safely", () => {
  const sp = p(0, { name: "sp" }),
    auto = p(3),
    door = p(1);
  const map = { portals: [sp, auto, door] };
  assert.equal(arrivalPortal(map, 1), door);
  assert.equal(arrivalPortal(map, 0), sp);
  assert.equal(arrivalPortal(map, 255), sp);
});
