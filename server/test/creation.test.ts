import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  creationCatalogOf,
  validateCreationLook,
  validCreationDice,
  validCreationName,
} from "../src/game/creation.ts";
import { encodeCp949, foldByteName } from "../src/protocol/cp949.ts";
import { readSave, saveJson } from "../src/game/save.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { WzArchive } from "../src/wz/archive.ts";
import type { AccountRecord } from "../src/net/loginserver.ts";
const wire = (text: string) => String.fromCharCode(...encodeCp949(text));
const look = [20000, 30030, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10];

test("creation names use native KS Hangul / ASCII byte rules, not JS character counts", () => {
  for (const name of ["Hero", "Hero12345678", "AbIl", "용사", "한글이름"])
    assert.equal(validCreationName(wire(name)), true, name);
  for (const name of [
    "",
    "Abc",
    "Hero123456789",
    "한",
    "한글이름아야어",
    "Hero Name",
    "test_name",
    "IIlI",
    "llll",
    "測試",
  ])
    assert.equal(validCreationName(wire(name)), false, name);
  assert.equal(validCreationName("한글이름"), false, "the core takes bytes, never raw Unicode");
  assert.equal(validCreationName("\xb0"), false, "truncated Hangul pair");
  assert.equal(validCreationName(wire("운영자1"), ["운영"]), false);
  assert.equal(
    foldByteName("Hero\xc0\xd0"),
    "hero\xc0\xd0",
    "ASCII folding must never alter Hangul bytes",
  );
  assert.equal(
    validCreationName("GameMaster", ["master"]),
    false,
    "forbidden substring is case-insensitive",
  );
});
test("native dice are four 4s plus nine increments; total 25 and maximum 13", () => {
  for (const dice of [
    [4, 4, 4, 13],
    [13, 4, 4, 4],
    [7, 6, 6, 6],
    [4, 5, 6, 10],
  ])
    assert.ok(validCreationDice(dice));
  for (const dice of [
    [4, 5, 6, 7],
    [3, 6, 6, 10],
    [4, 4, 3, 14],
    [5.5, 5.5, 7, 7],
    [4, 4, 17],
    [4, 4, 4, 13, 0],
  ])
    assert.equal(validCreationDice(dice), false);
  for (const invalid of [
    null,
    [],
    look.slice(0, 9),
    [...look, 0],
    [...look.slice(0, 6), 4, 5, 6, 7],
    [NaN, ...look.slice(1)],
  ])
    assert.throws(() => validateCreationLook(invalid));
});
test("optional account gender persists symmetrically without changing legacy saves", () => {
  const accounts = new Map<string, AccountRecord>([
    ["legacy", { password: "p", characters: [] }],
    ["male", { password: "p", gender: 0, characters: [] }],
    ["female", { password: "p", gender: 1, characters: [] }],
  ]);
  const reloaded = readSave(saveJson(accounts));
  assert.deepEqual(reloaded, accounts);
  assert.equal(Object.hasOwn(reloaded.get("legacy")!, "gender"), false);
});
const path = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "MakeCharInfo preserves original gender, option order and Korean info/name",
  { skip: !existsSync(path) },
  () => {
    const reader = artReaderOf(WzArchive.open(path)),
      catalog = creationCatalogOf(reader)!;
    assert.equal(creationCatalogOf(reader), catalog);
    assert.deepEqual(
      catalog.male.map((g) => g.map((o) => o.id)),
      [
        [20000, 20001, 20002],
        [30030, 30020, 30000],
        [1040002, 1040006, 1040010],
        [1060002, 1060006],
        [1072001, 1072005],
        [1302000, 1322005, 1312004],
      ],
    );
    assert.deepEqual(
      catalog.female.map((g) => g.map((o) => o.id)),
      [
        [21000, 21001, 21002],
        [31000, 31040, 31054],
        [1041002, 1041006, 1041010, 1041011],
        [1061002, 1061008],
        [1072001, 1072005],
        [1302000, 1322005, 1312004],
      ],
    );
    assert.equal(catalog.male[0]![0]!.name, "남자얼굴1");
    assert.equal(catalog.male[1]![0]!.name, "회색 빡빡 머리");
    assert.equal(catalog.male[2]![0]!.name, "하얀 반팔 면티");
    assert.equal(validCreationName(wire("운영자1"), catalog.forbidden), false);
    assert.deepEqual(validateCreationLook(look, catalog, 0), look);
    assert.throws(() => validateCreationLook(look, catalog, 1));
    assert.throws(() =>
      validateCreationLook([20000, 30030, 1040001, ...look.slice(3)], catalog, 0),
    );
    const female = [...catalog.female.map((g) => g.at(-1)!.id), 13, 4, 4, 4];
    assert.deepEqual(validateCreationLook(female, catalog, 1), female);
    assert.throws(() => validateCreationLook(female, catalog, 0));
  },
);
