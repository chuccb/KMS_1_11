import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIP_SLOTS,
  EQUIP_WINDOW,
  equipSlotAt,
  bodyPart,
  partFitsItem,
  equipConflict,
  canWear,
  firstBagSlot,
} from "../../client/equipment.ts";
const self = {
  gender: 0,
  hp: 50,
  maxHp: 50,
  maxMp: 5,
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
test("body parts are sub_463490's switch: shield10/cape9, overall5, two-hand11; rings name no single part", () => {
  for (const [id, part] of [
    [1002000, 1],
    [1040001, 5],
    [1050001, 5],
    [1060001, 6],
    [1092000, 10],
    [1102000, 9],
    [1302000, 11],
    [1402000, 11],
    [1112000, 0], // case 'o': the CLICKED cell (12 or 13) decides - the id alone names neither
    [1122000, 0], // the switch's default refuses pendants outright
    [2000000, 0],
  ])
    assert.equal(bodyPart(id), part);
  // partFitsItem is the switch's own test: rings into 12/13 only, everything else by bodyPart.
  assert.equal(partFitsItem(12, 1112000), true);
  assert.equal(partFitsItem(13, 1112000), true);
  assert.equal(partFitsItem(11, 1112000), false);
  assert.equal(partFitsItem(1, 1112000), false);
  assert.equal(partFitsItem(12, 1002000), false);
  assert.equal(partFitsItem(1, 1002000), true);
  assert.equal(partFitsItem(11, 1302000), true);
  assert.equal(partFitsItem(14, 1122000), false, "cell 14: no id in the switch maps to it");
  assert.equal(partFitsItem(0, 1002000), false);
  assert.equal(partFitsItem(15, 1112000), false);
});
test("native gender/level/job/base requirements, mage weapon exclusions, absent facts block", () => {
  const item = { itemId: 1002000 };
  assert.equal(canWear(item, facts, self, inv), undefined);
  assertDenial(canWear(item, null, self, inv), /讀取/);
  assertDenial(canWear(item, facts, { ...self, hp: 0 }, inv), /死亡/);
  assertDenial(canWear({ itemId: 1001000 }, facts, self, inv), /性別/);
  assertDenial(
    canWear(item, { requirements: { ...facts.requirements, level: 13 } }, self, inv),
    /需要 Lv13，目前 Lv12/,
  );
  assertDenial(
    canWear(item, { requirements: { ...facts.requirements, job: 1 } }, self, inv),
    /職業/,
  );
  assert.equal(
    canWear(item, { requirements: { ...facts.requirements, job: 1 } }, { ...self, job: 100 }, inv),
    undefined,
  );
  assertDenial(canWear({ itemId: 1402000 }, facts, { ...self, job: 200 }, inv), /武器/);
  assert.equal(canWear({ itemId: 1372000 }, facts, { ...self, job: 200 }, inv), undefined);
  // ADR-105: the wear path has NO cash gate - sub_47A420's three call sites are the throw-away,
  // the trade/move refusal and a list builder. A WZ cash flag or a record serial rides through.
  assert.equal(canWear(item, { ...facts, cash: true }, self, inv), undefined);
  assert.equal(canWear({ itemId: 1002000, cash: 99n }, facts, self, inv), undefined);
  assertDenial(canWear(item, facts, self, inv, 7), /部位/);
  // Rings: the clicked cell 12 or 13 admits them (sub_463490 case 'o'), any other part refuses;
  // a pendant 112xxxx refuses every cell (the switch's default branch).
  assert.equal(canWear({ itemId: 1112000 }, facts, self, inv, 12), undefined);
  assert.equal(canWear({ itemId: 1112000 }, facts, self, inv, 13), undefined);
  assertDenial(canWear({ itemId: 1112000 }, facts, self, inv, 11), /部位/);
  // No default part for a ring: bodyPart is 0, so canWear without an explicit cell refuses.
  assertDenial(canWear({ itemId: 1112000 }, facts, self, inv), /部位/);
  assertDenial(canWear({ itemId: 1122000 }, facts, self, inv, 14), /部位/);
});
test("requirements use instance stats, excluding replaced/conflicting gear and never the new item bonus", () => {
  const item = { itemId: 1002000, stats: { str: 99 } },
    req = { requirements: { ...facts.requirements, str: 20 } };
  assertDenial(canWear(item, req, self, inv), /STR 12\/20/);
  assert.equal(
    canWear(item, req, self, {
      ...inv,
      worn: [{ slot: 5, itemId: 1040001, stats: { str: 8 }, requirements: facts.requirements }],
    }),
    undefined,
  );
  assertDenial(
    canWear(item, req, self, {
      ...inv,
      worn: [{ slot: 1, itemId: 1002001, stats: { str: 8 }, requirements: facts.requirements }],
    }),
    /STR 12\/20/,
  );
  const sword = { itemId: 1402000 };
  assertDenial(
    canWear(sword, req, self, {
      ...inv,
      worn: [{ slot: 10, itemId: 1092000, stats: { str: 8 }, requirements: facts.requirements }],
    }),
    /STR 12\/20/,
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
    firstBagSlot({ ...inv, tabs: [{ tab: 1, capacity: 2, items: [{ slot: 1 }] }] }, 1),
    2,
  );
  const full = {
    worn,
    tabs: [{ tab: 1, capacity: 1, items: [{ slot: 1, itemId: 1402000 }] }],
  };
  assertDenial(canWear({ itemId: 1402000 }, facts, self, full), /空位/);
});

function assertDenial(reason: string | undefined, expected: RegExp): void {
  assert.ok(reason, "Expected an equipment admission rejection");
  assert.match(reason, expected);
}
