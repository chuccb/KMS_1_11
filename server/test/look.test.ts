/**
 * The two things a client draws a character's head from: the face (`appearanceA`) and the hair
 * (`appearanceB`).
 *
 * The client has no defaults of its own - it hands both straight to the avatar builder
 * (`sub_42E2C0` -> `sub_424590`/`sub_424410`) and a 0 is a body part no WZ archive has - so the
 * starter look is this server's choice, made once in `lookOf` and applied where a record leaves the
 * server (`withDefaultLook`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FACE_ID,
  DEFAULT_HAIR_ID,
  characterDataOf,
  lookOf,
  startingCharacterItems,
  withDefaultLook,
  zeroStats,
} from "../src/protocol/chardata.ts";

test("the starter look is the first face and hair image in the archive", () => {
  assert.deepEqual(lookOf({ appearanceA: 0, appearanceB: 0 }), {
    face: DEFAULT_FACE_ID,
    hair: DEFAULT_HAIR_ID,
  });
  assert.equal(DEFAULT_FACE_ID, 20000, "Character/Face/00020000.img");
  assert.equal(DEFAULT_HAIR_ID, 30000, "Character/Hair/00030000.img");
});

test("a character that picked a face and hair keeps them", () => {
  assert.deepEqual(lookOf({ appearanceA: 21004, appearanceB: 30035 }), {
    face: 21004,
    hair: 30035,
  });
});

test("each half falls back on its own: a save can have one of the two", () => {
  assert.deepEqual(lookOf({ appearanceA: 20005, appearanceB: 0 }), {
    face: 20005,
    hair: DEFAULT_HAIR_ID,
  });
  assert.deepEqual(lookOf({ appearanceA: 0, appearanceB: 30030 }), {
    face: DEFAULT_FACE_ID,
    hair: 30030,
  });
});

test("withDefaultLook only fills what is missing and leaves everything else alone", () => {
  const stats = zeroStats();
  stats.id = 7;
  stats.name = "Hero";
  stats.mapId = 1000000;
  const record = characterDataOf(stats, startingCharacterItems());
  const dressed = withDefaultLook(record);
  assert.notEqual(dressed, record, "a record with no look is a new record");
  assert.equal(dressed.stats.appearanceA, DEFAULT_FACE_ID);
  assert.equal(dressed.stats.appearanceB, DEFAULT_HAIR_ID);
  assert.equal(dressed.stats.mapId, 1000000, "nothing else moves");
  assert.equal(dressed.flags, record.flags);
  assert.equal(
    record.stats.appearanceA,
    0,
    "the stored record is not touched: 'never set' stays legible",
  );

  const already = { ...record, stats: { ...record.stats, appearanceA: 20001, appearanceB: 30012 } };
  assert.equal(
    withDefaultLook(already),
    already,
    "a record that has a look is handed back as it is",
  );
});
