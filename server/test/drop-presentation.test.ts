import test from "node:test";
import assert from "node:assert/strict";
import {
  beginDropPickup,
  createDropRecord,
  dropPosition,
  parseDrop,
  parseDropRemoval,
  DROP_HOP_MS,
  DROP_PICKUP_MS,
} from "../../client/drop-presentation.ts";
import { dropIconPath, mesoTier, mesoFramePath } from "../../client/drop-renderer.ts";
import { DROP_KIND } from "../src/protocol/drop.ts";
const drop = {
  kind: DROP_KIND.fromMob,
  dropId: 1,
  money: false,
  value: 4000019,
  x: 100,
  y: 300,
  mobId: 7,
  mobX: 20,
  mobY: 100,
  animationStartOffset: 0,
};
function record(kind: number = DROP_KIND.fromMob) {
  const result = createDropRecord({ ...drop, kind }, 1000);
  assert.ok(result);
  return result;
}

test("reward JSON boundary validates native ranges, monster block and signed offset without coercion", () => {
  assert.deepEqual(parseDrop(drop), drop);
  assert.equal(parseDrop({ ...drop, animationStartOffset: -32768 })?.animationStartOffset, -32768);
  assert.equal(parseDrop({ ...drop, animationStartOffset: 32767 })?.animationStartOffset, 32767);
  for (const value of [
    null,
    [],
    {},
    { ...drop, kind: 3 },
    { ...drop, kind: -1 },
    { ...drop, x: 1.5 },
    { ...drop, x: 32768 },
    { ...drop, y: -32769 },
    { ...drop, money: 1 },
    { ...drop, value: "4000019" },
    { ...drop, value: NaN },
    { ...drop, value: -1 },
    { ...drop, dropId: 0x100000000 },
    { ...drop, mobId: undefined },
    { ...drop, mobX: undefined },
    { ...drop, mobY: Infinity },
    { ...drop, animationStartOffset: 32768 },
    { ...drop, animationStartOffset: "0" },
  ])
    assert.equal(parseDrop(value), undefined);
  assert.deepEqual(parseDrop({ ...drop, kind: 2, mobId: "ignored" }), {
    kind: 2,
    dropId: 1,
    money: false,
    value: 4000019,
    x: 100,
    y: 300,
  });
});
test("live monster source wins, removed monster uses packet fallback, placed ignores monster data", () => {
  assert.equal(createDropRecord(drop, 0, () => ({ x: 42, y: 84 }))?.fromX, 42);
  assert.equal(createDropRecord(drop, 0, () => undefined)?.fromX, 20);
  assert.equal(createDropRecord({ ...drop, kind: 2 }, 0, () => ({ x: 42, y: 84 }))?.fromX, 100);
});
test("hop reaches the exact authoritative ground point without the old 16px rest discontinuity", () => {
  const entry = record();
  assert.deepEqual(dropPosition(entry, 1000), { x: 20, y: 100, t: 0, phase: "hop" });
  const middle = dropPosition(entry, 1210)!;
  assert.equal(middle.x, 60);
  assert.equal(middle.y, 172);
  const before = dropPosition(entry, 1000 + DROP_HOP_MS - 0.00001)!;
  const end = dropPosition(entry, 1000 + DROP_HOP_MS)!;
  assert.ok(Math.abs(before.y - end.y) < 0.001);
  assert.deepEqual(end, { x: 100, y: 300, t: 1, phase: "rest" });
  assert.deepEqual(dropPosition(entry, 999), dropPosition(entry, 1000));
  assert.deepEqual(dropPosition(entry, 100000), end);
});
test("kind 0 cleans up locally, kind 1 persists after flight, and kind 2 starts placed", () => {
  const transient = record(DROP_KIND.transientFromMob);
  assert.equal(dropPosition(transient, 1000)?.phase, "hop");
  assert.equal(dropPosition(transient, 1000 + DROP_HOP_MS), undefined, "state 3 removes kind 0");
  assert.equal(dropPosition(transient, 1000 + 3001), undefined, "native 3000 ms guard is retained");
  assert.deepEqual(dropPosition(record(DROP_KIND.fromMob), 1000 + DROP_HOP_MS), {
    x: 100,
    y: 300,
    t: 1,
    phase: "rest",
  });
  assert.deepEqual(dropPosition(record(DROP_KIND.placed), 1000), {
    x: 100,
    y: 300,
    t: 1,
    phase: "rest",
  });
});

test("signed animation offset delays or advances the hop relative to packet receipt", () => {
  const delayed = record(DROP_KIND.fromMob);
  delayed.drop.animationStartOffset = 100;
  assert.deepEqual(dropPosition(delayed, 1100), { x: 20, y: 100, t: 0, phase: "hop" });
  assert.ok(dropPosition(delayed, 1101)!.t > 0);

  const advanced = record(DROP_KIND.fromMob);
  advanced.drop.animationStartOffset = -100;
  assert.equal(dropPosition(advanced, 1000)!.t, 100 / DROP_HOP_MS);
});
test("pickup during a hop starts at the displayed position, not a teleport to final FH", () => {
  const entry = record(),
    before = dropPosition(entry, 1100)!;
  beginDropPickup(entry, 1100, 9);
  const after = dropPosition(entry, 1100, { x: 400, y: 300 })!;
  assert.deepEqual([after.x, after.y], [before.x, before.y]);
  const mid = dropPosition(entry, 1100 + DROP_PICKUP_MS / 2, { x: 400, y: 300 })!;
  assert.deepEqual([mid.x, mid.y], [(before.x + 400) / 2, (before.y + 270) / 2]);
  assert.equal(dropPosition(entry, 1100 + DROP_PICKUP_MS, { x: 400, y: 300 }), undefined);
});
test("pickup without a visible taker holds its actual start and expires, duplicate remove cannot rewind", () => {
  const entry = record();
  beginDropPickup(entry, 1100, 9);
  const first = dropPosition(entry, 1100)!;
  beginDropPickup(entry, 1200, 10);
  const next = dropPosition(entry, 1200)!;
  assert.equal(entry.takenAt, 1100);
  assert.equal(entry.takenBy, 9);
  assert.deepEqual([next.x, next.y], [first.x, first.y]);
  assert.equal(dropPosition(entry, 1360), undefined);
});
test("native money amount tiers and fixed four-frame cadence do not depend on metadata arrival order", () => {
  assert.deepEqual(
    [0, 49, 50, 99, 100, 999, 1000, 0xffffffff].map(mesoTier),
    [0, 0, 1, 1, 2, 2, 3, 3],
  );
  for (let tier = 0; tier < 4; tier++)
    for (let frame = 0; frame < 8; frame++) {
      const amount = [1, 50, 100, 1000][tier]!;
      assert.equal(
        mesoFramePath(amount, frame * 140),
        `Item/Special/0900.img/0900000${tier}/iconRaw/${frame % 4}`,
      );
    }
});
test("item icon JSON is narrowed rather than treating unknown WZ inventory origins as ground anchors", () => {
  const icon = { path: "Item/real/iconRaw", width: 27, height: 27, ox: -100, oy: 999 };
  assert.equal(dropIconPath({ iconRaw: icon }), icon.path);
  for (const value of [
    null,
    {},
    { iconRaw: { ...icon, width: 0 } },
    { iconRaw: { ...icon, width: 1.5 } },
    { iconRaw: { ...icon, path: "" } },
    { iconRaw: { ...icon, height: -1 } },
    { iconRaw: { ...icon, ox: "0" } },
    { iconRaw: { ...icon, path: 42 } },
  ])
    assert.equal(dropIconPath(value), undefined);
});

test("removal JSON validates pool and taker uint32 IDs before deleting/animating rewards", () => {
  assert.deepEqual(parseDropRemoval({ dropId: 1, reason: "gone" }), { dropId: 1, reason: "gone" });
  assert.deepEqual(parseDropRemoval({ dropId: 2, reason: "vanished" }), {
    dropId: 2,
    reason: "vanished",
  });
  assert.deepEqual(parseDropRemoval({ dropId: 3, reason: "taken", characterId: 9 }), {
    dropId: 3,
    reason: "taken",
    characterId: 9,
  });
  for (const value of [
    null,
    {},
    { dropId: "1", reason: "gone" },
    { dropId: 1, reason: "unknown" },
    { dropId: 1, reason: "taken" },
    { dropId: 1, reason: "taken", characterId: -1 },
    { dropId: 1, reason: "taken", characterId: "9" },
    { dropId: 1.5, reason: "gone" },
  ])
    assert.equal(parseDropRemoval(value), undefined);
});
