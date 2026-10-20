/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { canWear, equipConflict } from "../../client/equip-rules.ts";
import { effectiveWorn } from "../../client/characterstats.ts";
import { equipAdmission } from "../src/game/equipadmission.ts";
import { characterDataOf, zeroStats, startingCharacterItems } from "../src/protocol/chardata.ts";
import { equipSlot } from "../src/protocol/itemslot.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
const requirements = { level: 1, job: 0, str: 0, dex: 0, int: 0, luk: 0 };
const person = {
  ...zeroStats(),
  level: 1,
  job: 100,
  gender: 0,
  str: 10,
  dex: 4,
  int: 4,
  luk: 4,
  hp: 50,
  maxHp: 50,
  maxMp: 50,
};
test("4636B0 filters effective worn ONCE then removes replaced slots, not refiltering dependents", () => {
  const worn = [
    { slot: 1, itemId: 1002000, stats: { str: 5 }, requirements: { ...requirements, str: 20 } },
    { slot: 11, itemId: 1302000, stats: { str: 10 }, requirements },
  ];
  const inventory = { worn, tabs: [{ tab: 1, capacity: 24, items: [] }] };
  assert.equal(effectiveWorn(person, worn).length, 2);
  assert.equal(effectiveWorn(person, worn, [11]).length, 0);
  assert.equal(
    canWear(
      { itemId: 1302001 },
      { cash: false, requirements: { ...requirements, str: 15 } },
      person,
      inventory,
      11,
      worn,
    ),
    undefined,
  );
});
test("level and individual primary shortfalls are explicit, candidate cannot qualify itself", () => {
  const inventory = { worn: [], tabs: [{ tab: 1, capacity: 24, items: [] }] };
  assert.match(
    canWear(
      { itemId: 1452002 },
      { cash: false, requirements: { ...requirements, level: 10 } },
      person,
      inventory,
    )!,
    /Lv10.*Lv1/,
  );
  assert.match(
    canWear(
      { itemId: 1302001 },
      { cash: false, requirements: { ...requirements, str: 11 } },
      person,
      inventory,
    )!,
    /STR 10\/11/,
  );
  assert.match(
    canWear(
      { itemId: 1452002 },
      { cash: false, requirements: { ...requirements, job: 4 } },
      person,
      inventory,
    )!,
    /職業/,
  );
});
test("two-hand/shield and overall/pants conflict uses exact original slots", () => {
  assert.equal(equipConflict(1452002, [{ slot: 10, itemId: 1092000 }]), 10);
  assert.equal(equipConflict(1092000, [{ slot: 11, itemId: 1452002 }]), 11);
  assert.equal(equipConflict(1052000, [{ slot: 6, itemId: 1062000 }]), 6);
  assert.equal(equipConflict(1062000, [{ slot: 5, itemId: 1052000 }]), 5);
});
test("server rechecks bag->worn AND reverse swaps without modifying any instance", () => {
  const catalog = itemCatalogOf(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
  const c = characterDataOf({ ...person, job: 300 }, startingCharacterItems());
  c.items!.worn.set(11, equipSlot(1302000));
  c.items!.inventories[0]!.items.set(1, equipSlot(1452002));
  const before = structuredClone(c);
  assert.match(
    equipAdmission(c, { tab: 1, fromSlot: 1, toSlot: -11, count: -1 }, catalog)!,
    /Lv10/,
  );
  assert.match(
    equipAdmission(c, { tab: 1, fromSlot: -11, toSlot: 1, count: -1 }, catalog)!,
    /Lv10/,
  );
  assert.deepEqual(c, before);
  c.stats.level = 10;
  assert.equal(
    equipAdmission(c, { tab: 1, fromSlot: 1, toSlot: -11, count: -1 }, catalog),
    undefined,
  );
  assert.equal(
    equipAdmission(c, { tab: 1, fromSlot: -11, toSlot: 2, count: -1 }, undefined),
    undefined,
    "no requirements for unequip to empty bag",
  );
  assert.match(
    equipAdmission(c, { tab: 1, fromSlot: 1, toSlot: -11, count: -1 }, undefined)!,
    /原WZ/,
  );
});
test("ADR-105: the real cash cap 1002000 is admitted like any equip, on its own requirements", () => {
  const catalog = itemCatalogOf(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
  assert.equal(catalog!.info(1002000)!.cash, true, "the fixture really is the WZ cash flag");
  // Lv20 / job mask 8 = the magician line; the wearer qualifies and no cash gate stops it.
  const mage = characterDataOf(
    { ...person, job: 400, level: 20, str: 100, dex: 100, int: 100, luk: 100 },
    startingCharacterItems(),
  );
  mage.items!.inventories[0]!.items.set(1, equipSlot(1002000));
  assert.equal(
    equipAdmission(mage, { tab: 1, fromSlot: 1, toSlot: -1, count: -1 }, catalog),
    undefined,
  );
  // A beginner fails on the cap's own job mask - the refusal is a requirement, not "cash".
  const beginner = characterDataOf({ ...person, level: 20 }, startingCharacterItems());
  beginner.items!.inventories[0]!.items.set(1, equipSlot(1002000));
  assert.match(
    equipAdmission(beginner, { tab: 1, fromSlot: 1, toSlot: -1, count: -1 }, catalog)!,
    /職業/,
  );
  // Rings: this Data.wz has no 111xxxx entry, so admission stays honest at the requirements gate
  // (the structural cells 12/13 are inventory.test.ts's business); unequipping needs none.
  const ring = characterDataOf(person, startingCharacterItems());
  ring.items!.inventories[0]!.items.set(1, equipSlot(1112000));
  assert.match(
    equipAdmission(ring, { tab: 1, fromSlot: 1, toSlot: -12, count: -1 }, catalog)!,
    /讀取|原WZ/,
  );
  ring.items!.worn.set(12, equipSlot(1112000));
  assert.equal(
    equipAdmission(ring, { tab: 1, fromSlot: -12, toSlot: 2, count: -1 }, catalog),
    undefined,
    "taking the ring off goes to an empty bag slot with no requirements",
  );
});
