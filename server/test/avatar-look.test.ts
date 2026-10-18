import test from "node:test";
import assert from "node:assert/strict";
import { lookOf } from "../../client/avatar-look.ts";

test("local explicit hair retains every worn item and source ownership without mutation", () => {
  const items = Object.freeze([1302000, 1002008]);
  const source = Object.freeze({ face: 20001, hair: 30001, avatarItems: items });
  assert.deepEqual(lookOf(source), { face: 20001, hair: 30001, items });
  assert.equal(lookOf(source).items, items);
});
test("remote native 0x1C hair prefix is consumed once, never rendered as an equip", () => {
  const items = Object.freeze([30001, 1302000, 1002008]);
  assert.deepEqual(lookOf({ face: 20001, avatarItems: items }), {
    face: 20001,
    hair: 30001,
    items: [1302000, 1002008],
  });
  assert.deepEqual(lookOf({ hair: 0, avatarItems: items }), {
    face: 20000,
    hair: 30001,
    items: [1302000, 1002008],
  });
  assert.deepEqual(items, [30001, 1302000, 1002008]);
});
test("absent/empty preview and zero face/hair keep previous defaults without inventing worn equipment", () => {
  for (const source of [undefined, null, {}, { face: 0, hair: 0 }, { avatarItems: [] }])
    assert.deepEqual(lookOf(source), { face: 20000, hair: 30000, items: [] });
  assert.deepEqual(lookOf({ hair: 30001 }), { face: 20000, hair: 30001, items: [] });
});
