import test from "node:test";
import assert from "node:assert/strict";
import { DropLandingIndex } from "../src/game/drop-landing.ts";
import { DropField, type DropSource } from "../src/game/drops.ts";
import { nonEquipSlot, equipSlot } from "../src/protocol/itemslot.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { readDropAppear } from "../src/protocol/drop.ts";
import type { FootholdSegment } from "../src/wz/archive.ts";

// Synthetic geometry is confined to unit tests. Original-WZ audit/browser tests are separate.
function f(
  id: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  prev = 0,
  next = 0,
): FootholdSegment {
  return { id, x1, y1, x2, y2, prev, next };
}
function index(...floors: FootholdSegment[]) {
  return new DropLandingIndex(new Map(floors.map((floor) => [floor.id, floor])));
}
const source: DropSource = {
  mobId: 1,
  templateId: 100100,
  name: "fixture",
  level: 1,
  x: 95,
  y: 100,
  foothold: 1,
};

test("airborne drops hit the first floor BELOW the release, never a closer overhead platform", () => {
  const floors = index(f(1, 0, 90, 100, 90), f(2, 0, 200, 100, 200), f(3, 0, 300, 100, 300));
  assert.deepEqual(floors.resolve({ x: 50, y: 100 }), { x: 50, y: 200, foothold: 2 });
  assert.deepEqual(floors.resolve({ x: 50, y: 250 }), { x: 50, y: 300, foothold: 3 });
});
test("walls and reverse-directed ceilings cannot support a reward", () => {
  const floors = index(f(1, 50, 0, 50, 400), f(2, 100, 90, 0, 90), f(3, 0, 300, 100, 300));
  assert.deepEqual(floors.resolve({ x: 50, y: 0 }), { x: 50, y: 300, foothold: 3 });
});
test("grounded slope spread follows the source floor even when its uphill endpoint is above release", () => {
  const floors = index(f(1, 0, 200, 100, 100));
  assert.deepEqual(floors.resolve({ x: 50, y: 150, foothold: 1 }, 90), {
    x: 90,
    y: 110,
    foothold: 1,
  });
});
test("linked sloped floors preserve the platform, quantize x before deriving native packet y", () => {
  const floors = index(f(1, -100, 0, 0, 100, 0, 2), f(2, 0, 100, 100, 151, 1, 0));
  assert.deepEqual(floors.resolve({ x: -5, y: 95, foothold: 1 }, 11.9), {
    x: 11,
    y: 106,
    foothold: 2,
  });
  assert.deepEqual(floors.resolve({ x: 5, y: 103, foothold: 2 }, -11.9), {
    x: -11,
    y: 89,
    foothold: 1,
  });
});
test("an airborne stale fh hint cannot skip an intermediate landing platform", () => {
  const floors = index(f(1, 0, 300, 100, 300), f(2, 0, 150, 100, 150));
  assert.deepEqual(floors.resolve({ x: 50, y: 100, foothold: 1 }), { x: 50, y: 150, foothold: 2 });
});
test("spread across a platform edge falls onto lower, unlinked real ground", () => {
  const floors = index(f(1, 0, 100, 100, 100), f(2, 100, 250, 200, 250));
  assert.deepEqual(floors.resolve(source, 119), { x: 119, y: 250, foothold: 2 });
});
test("spread over a void projects back to the source platform edge, never death height", () => {
  const floors = index(f(1, 0, 100, 100, 100));
  assert.deepEqual(floors.resolve(source, 119), { x: 100, y: 100, foothold: 1 });
  assert.deepEqual(floors.resolve({ x: 0, y: 100, foothold: 1 }, -24), {
    x: 0,
    y: 100,
    foothold: 1,
  });
});
test("air throws beyond all map floors still end on an actual floor endpoint", () => {
  const floors = index(f(1, -100, 300, 100, 400));
  assert.deepEqual(floors.resolve({ x: 200, y: 10 }), { x: 100, y: 400, foothold: 1 });
  assert.deepEqual(floors.resolve({ x: -200, y: 10 }), { x: -100, y: 300, foothold: 1 });
});
test("walls and broken spatial links stop platform traversal", () => {
  const floors = index(
    f(1, 0, 100, 100, 100, 0, 2),
    f(2, 100, 100, 100, 0, 1, 3),
    f(3, 100, 0, 200, 0, 2, 0),
    f(4, 100, 250, 200, 250),
  );
  assert.deepEqual(floors.resolve(source, 119), { x: 119, y: 250, foothold: 4 });
  const broken = index(
    f(1, 0, 100, 100, 100, 0, 3),
    f(3, 100, 0, 200, 0),
    f(4, 100, 250, 200, 250),
  );
  assert.deepEqual(broken.resolve(source, 119), { x: 119, y: 250, foothold: 4 });
});
test("overlapping floors tie deterministically independent of map insertion order", () => {
  const a = f(1, 0, 100, 100, 100),
    b = f(2, 0, 100, 100, 100);
  assert.deepEqual(index(b, a).resolve({ x: 50, y: 0 }), index(a, b).resolve({ x: 50, y: 0 }));
});
test("negative sloped coordinates survive signed packet serialization within half a pixel", () => {
  const field = new DropField({
    footholds: new Map([[1, f(1, -100, -200, 100, -99)]]),
    spreadPx: 0,
    policy: () => [{ itemId: 4000019 }],
  });
  const entry = field.spawnFromDeath({ ...source, x: -11.9, y: -300, foothold: 0 }, 0)[0]!;
  const decoded = readDropAppear(new PacketReader(field.appearPacket(entry), 1));
  assert.equal(decoded.x, -11);
  assert.equal(decoded.y, entry.y);
  assert.ok(Math.abs(decoded.y - (-200 + ((decoded.x + 100) * 101) / 200)) <= 0.5);
});
test("floorless/data-off geometry is explicitly unresolved (fh0), never fabricated from VR or images", () => {
  for (const floors of [
    new DropLandingIndex(undefined),
    index(),
    index(f(1, 0, 0, 0, 100), f(2, 100, 0, 0, 0)),
  ]) {
    assert.deepEqual(floors.resolve({ x: -5, y: 42 }), { x: -5, y: 42, foothold: 0 });
  }
});
test("nonfinite origins cannot poison reward placement", () => {
  const floors = index(f(1, 0, 100, 100, 100));
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => floors.resolve({ x: value, y: 0 }));
    assert.throws(() => floors.resolve({ x: 0, y: value }));
    assert.throws(() => floors.resolve({ x: 0, y: 0 }, value));
  }
});
test("monster money and item rolls share the same resolved FH and preserve the airborne source block", () => {
  const field = new DropField({
    footholds: new Map([
      [1, f(1, 0, 100, 100, 100)],
      [2, f(2, 100, 250, 200, 250)],
    ]),
    random: { next: () => 0, range: () => 24 },
    policy: () => [{ money: 70 }, { itemId: 4000019 }],
  });
  const airborne = { ...source, y: 20 };
  for (const entry of field.spawnFromDeath(airborne, 10)) {
    assert.deepEqual([entry.x, entry.y, entry.foothold], [119, 250, 2]);
    const decoded = readDropAppear(new PacketReader(field.appearPacket(entry), 1));
    assert.deepEqual([decoded.x, decoded.y, decoded.mobX, decoded.mobY], [119, 250, 95, 20]);
    assert.equal(field.reachable(119, 250, 11)?.dropId, 1);
    assert.equal(field.reachable(119, 20, 11), undefined);
  }
});
test("player item and meso throws from the air share authority, instance preservation and kind2 wire shape", () => {
  const field = new DropField({ footholds: new Map([[1, f(1, 0, 300, 100, 400)]]) });
  const slot = nonEquipSlot(4000019, 5),
    origin = { x: 50, y: 20, foothold: 0 };
  const item = field.dropFromPlayer({ ...origin, slot, count: 2 }, 10),
    mesos = field.dropMesosFromPlayer({ ...origin, amount: 99 }, 10);
  for (const entry of [item, mesos]) {
    assert.deepEqual([entry.x, entry.y, entry.foothold], [50, 350, 1]);
    const packet = field.appearPacket(entry),
      decoded = readDropAppear(new PacketReader(packet, 1));
    assert.equal(packet.length, 15);
    assert.equal(decoded.kind, 2);
    assert.equal(decoded.mobId, undefined);
    assert.deepEqual([decoded.x, decoded.y], [50, 350]);
  }
  assert.equal(slot.quantity, 5);
  assert.equal(item.count, 2);
  assert.deepEqual(item.slot, slot);
  assert.notEqual(item.slot, slot);
  const equip = equipSlot(1302000);
  equip.cuc = 3;
  equip.pad = 19;
  const weapon = field.dropFromPlayer({ ...origin, slot: equip, count: 1 }, 10);
  assert.deepEqual(weapon.slot, equip);
});
