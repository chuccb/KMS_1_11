import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIP_SLOTS,
  EQUIP_WINDOW,
  equipSlotAt,
  bodyPart,
  equipConflict,
  canWear,
  firstBagSlot,
} from "../../client/equipment.mjs";
const self = {
  gender: 0,
  hp: 50,
  level: 12,
  job: 0,
  str: 12,
  dex: 5,
  int: 4,
  luk: 4,
};
const facts = {
  requirements: { level: 1, job: 0, str: 0, dex: 0, int: 0, luk: 0 },
};
const inv = { worn: [], tabs: [{ tab: 1, capacity: 2, items: [] }] };
test("PE fourteen original equip coordinates, strict hit edges, CConfig defaults", () => {
  assert.deepEqual(EQUIP_WINDOW.home, { x: 48, y: 48 });
  assert.equal(EQUIP_SLOTS.length, 14);
  for (const [i, [x, y]] of EQUIP_SLOTS.entries()) {
    assert.equal(equipSlotAt(x + 16, y + 16), i + 1);
    assert.equal(equipSlotAt(x, y), 0);
  }
  assert.equal(equipSlotAt(0, 0), 0);
});
test("body parts are original switch, shield10/cape9, overall5 and two-hand11, no cash rings", () => {
  for (const [id, part] of [
    [1002000, 1],
    [1040001, 5],
    [1050001, 5],
    [1060001, 6],
    [1092000, 10],
    [1102000, 9],
    [1302000, 11],
    [1402000, 11],
    [1112000, 0],
    [2000000, 0],
  ])
    assert.equal(bodyPart(id), part);
});
test("native gender/level/job/base requirements, mage weapon exclusions, absent facts block", () => {
  const item = { itemId: 1002000 };
  assert.equal(canWear(item, facts, self, inv), undefined);
  assert.match(canWear(item, null, self, inv), /讀取/);
  assert.match(canWear(item, facts, { ...self, hp: 0 }, inv), /死亡/);
  assert.match(canWear({ itemId: 1001000 }, facts, self, inv), /性別/);
  assert.match(
    canWear(
      item,
      { requirements: { ...facts.requirements, level: 13 } },
      self,
      inv,
    ),
    /能力/,
  );
  assert.match(
    canWear(
      item,
      { requirements: { ...facts.requirements, job: 1 } },
      self,
      inv,
    ),
    /職業/,
  );
  assert.equal(
    canWear(
      item,
      { requirements: { ...facts.requirements, job: 1 } },
      { ...self, job: 100 },
      inv,
    ),
    undefined,
  );
  assert.match(
    canWear({ itemId: 1402000 }, facts, { ...self, job: 200 }, inv),
    /武器/,
  );
  assert.equal(
    canWear({ itemId: 1372000 }, facts, { ...self, job: 200 }, inv),
    undefined,
  );
  assert.match(canWear(item, { ...facts, cash: true }, self, inv), /現金/);
  assert.match(canWear(item, facts, self, inv, 7), /部位/);
});
test("requirements use instance stats, excluding replaced/conflicting gear and never the new item bonus", () => {
  const item = { itemId: 1002000, stats: { str: 99 } },
    req = { requirements: { ...facts.requirements, str: 20 } };
  assert.match(canWear(item, req, self, inv), /能力/);
  assert.equal(
    canWear(item, req, self, {
      ...inv,
      worn: [{ slot: 5, itemId: 1040001, stats: { str: 8 } }],
    }),
    undefined,
  );
  assert.match(
    canWear(item, req, self, {
      ...inv,
      worn: [{ slot: 1, itemId: 1002001, stats: { str: 8 } }],
    }),
    /能力/,
  );
  const sword = { itemId: 1402000 };
  assert.match(
    canWear(sword, req, self, {
      ...inv,
      worn: [{ slot: 10, itemId: 1092000, stats: { str: 8 } }],
    }),
    /能力/,
  );
});
test("native conflict detection and capacity with occupied destination", () => {
  const worn = [
    { slot: 10, itemId: 1092000 },
    { slot: 11, itemId: 1402000 },
    { slot: 5, itemId: 1050000 },
    { slot: 6, itemId: 1060000 },
  ];
  for (const [id, p] of [
    [1402000, 10],
    [1092000, 11],
    [1050000, 6],
    [1060000, 5],
  ])
    assert.equal(equipConflict(id, worn), p);
  assert.equal(
    firstBagSlot(
      { ...inv, tabs: [{ tab: 1, capacity: 2, items: [{ slot: 1 }] }] },
      1,
    ),
    2,
  );
  const full = {
    worn,
    tabs: [{ tab: 1, capacity: 1, items: [{ slot: 1, itemId: 1402000 }] }],
  };
  assert.match(canWear({ itemId: 1402000 }, facts, self, full), /空位/);
});
