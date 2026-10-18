import test from "node:test";
import assert from "node:assert/strict";
import { loginSelection, readLoginCharacters, readLoginWorlds } from "../../client/login-data.ts";
import { characterSlot, worldPopulation, worldGaugeClip } from "../../client/selection.ts";

const character = (id = 1) => ({
  id,
  name: `Fixture${id}`,
  job: 0,
  level: 1,
  str: 4,
  dex: 4,
  int: 4,
  luk: 13,
  face: 20000,
  hair: 30000,
  items: [1040002, 1060002, 1072001, 1302000],
});
const worlds = Array.from({ length: 10 }, (_, index) => ({
  name: `World${index}`,
  unknownId: index === 1 ? 0xffffffff : index * 100,
}));

test("login lists project and copy only consumed wire fields, never imported clocks or foreign state", () => {
  const input = character();
  const result = readLoginCharacters([
    { ...input, animation: { stance: "injected" }, faceClock: { next: Infinity }, ignored: true },
  ]);
  assert.deepEqual(result, [input]);
  input.items.push(999);
  assert.equal(result[0]!.items.includes(999), false);
  const source = worlds.map((world) => ({ ...world }));
  const parsed = readLoginWorlds(source);
  source[0]!.name = "changed";
  assert.equal(parsed[0]!.name, "World0");
});
test("world count remains a validated wire u32 and native signed LONG, not an invented server id", () => {
  const parsed = readLoginWorlds([
    { name: "Unavailable", unknownId: 0xffffffff },
    { name: "Empty", unknownId: 0 },
  ]);
  assert.deepEqual(parsed.map(worldPopulation), [-1, 0]);
  for (const unknownId of [undefined, null, -1, NaN, Infinity, 0x100000000, 1.5, "3000"])
    assert.throws(() => readLoginWorlds([{ name: "Bad", unknownId }]));
  for (const value of [null, {}, "[]", [null], [{ name: 2, unknownId: 0 }]])
    assert.throws(() => readLoginWorlds(value));
});
test("character lists reject missing/wrong/nonfinite fields and duplicate target identities", () => {
  const source = character();
  for (const key of Object.keys(source)) {
    const entry: Record<string, unknown> = { ...source };
    delete entry[key];
    assert.throws(() => readLoginCharacters([entry]), key);
  }
  for (const key of ["id", "job", "level", "str", "dex", "int", "luk", "face", "hair"])
    for (const value of [NaN, Infinity, -1, 0.25, "1", null])
      assert.throws(() => readLoginCharacters([{ ...source, [key]: value }]), `${key}=${value}`);
  for (const items of [null, {}, ["1302000"], [Infinity], [-1], [0x100000000]])
    assert.throws(() => readLoginCharacters([{ ...source, items }]));
  assert.throws(() => readLoginCharacters([source, source]), /index 1/);
  assert.throws(() => readLoginCharacters(null));
});
test("wire-width bounds are enforced without inventing job/level/balance policy", () => {
  assert.equal(
    readLoginCharacters([
      {
        ...character(0xffffffff),
        job: 0xffff,
        level: 0xff,
        str: 0xffff,
        face: 0xffffffff,
        hair: 0xffffffff,
      },
    ]).length,
    1,
  );
  for (const [key, value] of [
    ["id", 0x100000000],
    ["job", 0x10000],
    ["level", 0x100],
    ["str", 0x10000],
    ["hair", 0x100000000],
  ] as const)
    assert.throws(() => readLoginCharacters([{ ...character(), [key]: value }]));
});
test("all rows are validated before native three-slot truncation, with no partial publication", () => {
  assert.deepEqual(
    readLoginCharacters([1, 2, 3, 4].map(character)).map((entry) => entry.id),
    [1, 2, 3],
  );
  assert.throws(
    () => readLoginCharacters([character(1), character(2), character(3), null]),
    /index 3/,
  );
});
test("empty lists and invalid indices never invent a selectable world or character", () => {
  const selection = loginSelection();
  for (const delta of [-1, 1] as const) {
    assert.equal(selection.moveWorld(delta), false);
    assert.equal(selection.moveCharacter(delta), false);
  }
  assert.equal(selection.worldIndex, -1);
  assert.equal(selection.characterIndex, -1);
  assert.equal(selection.connectWorld(), undefined);
  assert.equal(selection.enterCharacter(), undefined);
  selection.replaceWorlds(worlds);
  selection.replaceCharacters([character()]);
  for (const index of [-1, 0.5, NaN, Infinity, 100]) {
    assert.equal(selection.selectWorld(index), false);
    assert.equal(selection.selectCharacter(index), false);
  }
  assert.equal(selection.worldIndex, -1);
  assert.equal(selection.characterIndex, 0);
});
test("highlight, population availability and pending acknowledgement are separate gates", () => {
  const selection = loginSelection();
  selection.replaceWorlds(worlds);
  assert.equal(selection.canConnect, false);
  selection.selectWorld(1);
  assert.equal(selection.canConnect, false);
  assert.equal(selection.connectWorld(), undefined);
  selection.selectWorld(2);
  assert.deepEqual(selection.connectWorld(), { t: "world", index: 2 });
  assert.equal(selection.pending, true);
  assert.equal(selection.connectWorld(), undefined);
  assert.equal(selection.selectWorld(3), false);
  assert.equal(selection.moveWorld(1), false);
  assert.equal(selection.scrollWorlds(10), false);
  selection.setPending(false);
  assert.equal(selection.canConnect, true);
});
test("world keyboard scrolling keeps the selected native row visible in six rows", () => {
  const selection = loginSelection();
  selection.replaceWorlds(worlds);
  for (let index = 0; index < 15; index++) {
    selection.moveWorld(1);
    assert.equal(selection.worldIndex, Math.min(index, 9));
    assert.ok(
      selection.worldIndex >= selection.scroll && selection.worldIndex < selection.scroll + 6,
    );
  }
  assert.equal(selection.scroll, 4);
  for (let index = 0; index < 15; index++) selection.moveWorld(-1);
  assert.equal(selection.worldIndex, 0);
  assert.equal(selection.scroll, 0);
});
test("wheel steps are bounded and do not change the selected world", () => {
  const selection = loginSelection();
  selection.replaceWorlds(worlds);
  selection.selectWorld(2);
  for (let index = 0; index < 20; index++) selection.scrollWorlds(100);
  assert.equal(selection.scroll, 4);
  assert.equal(selection.worldIndex, 2);
  for (let index = 0; index < 20; index++) selection.scrollWorlds(-100);
  assert.equal(selection.scroll, 0);
  assert.equal(selection.scrollWorlds(Infinity), false);
});
test("successful list refresh retains character id across reordering, otherwise clamps or clears", () => {
  const selection = loginSelection();
  selection.replaceCharacters([1, 2, 3].map(character));
  selection.selectCharacter(2);
  selection.replaceCharacters([character(3), character(1)]);
  assert.equal(selection.selected?.id, 3);
  assert.equal(selection.characterIndex, 0);
  selection.selectCharacter(1);
  selection.replaceCharacters([character(4)]);
  assert.equal(selection.selected?.id, 4);
  assert.equal(selection.characterIndex, 0);
  selection.replaceCharacters([]);
  assert.equal(selection.selected, undefined);
  assert.equal(selection.characterIndex, -1);
});
test("failed reply validation preserves the complete prior selection and pending state atomically", () => {
  const selection = loginSelection();
  selection.replaceWorlds(worlds);
  selection.selectWorld(7);
  selection.moveWorld(1);
  selection.connectWorld();
  const before = {
    worlds: selection.worlds,
    index: selection.worldIndex,
    scroll: selection.scroll,
    pending: selection.pending,
  };
  assert.throws(() => selection.replaceWorlds([worlds[0], null]));
  assert.deepEqual(
    {
      worlds: selection.worlds,
      index: selection.worldIndex,
      scroll: selection.scroll,
      pending: selection.pending,
    },
    before,
  );
  selection.replaceCharacters([character(3)]);
  selection.enterCharacter();
  assert.throws(() => selection.replaceCharacters([character(9), null]));
  assert.equal(selection.selected?.id, 3);
  assert.equal(selection.pending, true);
});
test("character controls never send twice while pending, and creation capacity is the native three slots", () => {
  const selection = loginSelection();
  selection.replaceCharacters([character(7)]);
  assert.equal(selection.canCreate, true);
  assert.deepEqual(selection.enterCharacter(), { t: "character", id: 7 });
  assert.equal(selection.canCreate, false);
  assert.equal(selection.enterCharacter(), undefined);
  assert.equal(selection.moveCharacter(1), false);
  selection.replaceCharacters([1, 2, 3].map(character));
  assert.equal(selection.canCreate, false);
  selection.replaceCharacters([]);
  assert.equal(selection.canCreate, true);
  assert.equal(selection.canEnter, false);
});
test("native character slots reject noninteger/nonfinite indices rather than leaking NaN drawing coordinates", () => {
  for (const index of [-1, 3, NaN, Infinity, 0.5]) assert.equal(characterSlot(index), undefined);
});

test("native world gauge clips twenty visual steps without changing world availability", () => {
  for (const unknownId of [0, 1, 149, 150, 299, 0xffffffff])
    assert.deepEqual(worldGaugeClip({ unknownId }), { x: 95, width: 6, height: 7 });
  assert.deepEqual(worldGaugeClip({ unknownId: 300 }), { x: 90, width: 11, height: 7 });
  for (const unknownId of [3000, 9000])
    assert.deepEqual(worldGaugeClip({ unknownId }), { x: 0, width: 101, height: 7 });
  const selection = loginSelection();
  selection.replaceWorlds([{ name: "Not capacity-limited by gauge", unknownId: 9000 }]);
  selection.selectWorld(0);
  assert.equal(selection.canConnect, true);
});

test("a rejected list blocks stale commands even when a generic error clears pending, until a valid reply", () => {
  const selection = loginSelection();
  selection.replaceWorlds(worlds);
  selection.selectWorld(0);
  selection.replaceCharacters([character()]);
  selection.block();
  selection.setPending(false);
  assert.equal(selection.canConnect, false);
  assert.equal(selection.canEnter, false);
  assert.equal(selection.canCreate, false);
  assert.equal(selection.connectWorld(), undefined);
  assert.equal(selection.enterCharacter(), undefined);
  assert.equal(selection.selectCharacter(0), false);
  assert.equal(selection.selected?.id, 1);
  selection.replaceCharacters([character(2)]);
  assert.equal(selection.canEnter, true);
  assert.deepEqual(selection.enterCharacter(), { t: "character", id: 2 });
});
