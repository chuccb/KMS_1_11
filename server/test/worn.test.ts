/**
 * Which slot a piece of clothing lands in, and what a `0x06` request's clothes do to a new
 * character.
 *
 * One numbering covers all three places a slot number appears, which is why the numbers can be
 * derived instead of guessed (`sub_45F340`, `sub_45F610`, `sub_42E2C0` - see `AVATAR_SLOT`): the
 * client derives a slot from an item's part code, writes that number as the worn group's slot byte,
 * and rebuilds the drawn avatar from `worn[k] -> look[k]` with the same k. A server that knows the
 * part codes therefore knows where a top goes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AVATAR_SLOT,
  LOOK_WORD,
  LOOK_WORDS,
  WORN_SLOT_LIMIT,
  avatarSlotOfItem,
  startingCharacterItems,
  withWorn,
  wornOfLook,
  wornSlotOfItem,
} from "../src/protocol/chardata.ts";

/** The six words a real `0x06` carries, with ids that exist in the shipped `Data.wz`. */
const LOOK = [20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 7];

test("the part code is what picks the slot - sub_45F340's switch, code by code", () => {
  assert.equal(avatarSlotOfItem(1000000), AVATAR_SLOT.cap, "100xxxx");
  assert.equal(avatarSlotOfItem(1010000), AVATAR_SLOT.faceAccessory, "101xxxx");
  assert.equal(avatarSlotOfItem(1020000), AVATAR_SLOT.eyeAccessory, "102xxxx");
  assert.equal(avatarSlotOfItem(1030000), AVATAR_SLOT.earring, "103xxxx");
  assert.equal(avatarSlotOfItem(1060001), AVATAR_SLOT.pants, "106xxxx");
  assert.equal(avatarSlotOfItem(1071000), AVATAR_SLOT.shoes, "107xxxx");
  assert.equal(avatarSlotOfItem(1080000), AVATAR_SLOT.gloves, "108xxxx");
  assert.equal(avatarSlotOfItem(1100000), AVATAR_SLOT.cape, "110xxxx is 9, 109xxxx is 10");
  assert.equal(avatarSlotOfItem(1090000), AVATAR_SLOT.shield);
});

test("104xxxx and 105xxxx share one slot, weapons land on 11 by their group", () => {
  assert.equal(avatarSlotOfItem(1040001), AVATAR_SLOT.clothes);
  assert.equal(avatarSlotOfItem(1050000), AVATAR_SLOT.clothes, "an overall dresses the same cell");
  assert.equal(avatarSlotOfItem(1302000), AVATAR_SLOT.weapon, "13xxxxx");
  assert.equal(avatarSlotOfItem(1400000), AVATAR_SLOT.weapon, "14xxxxx");
});

test("ids that name no body part have no slot: face, hair, consumables, 0", () => {
  assert.equal(avatarSlotOfItem(30000), AVATAR_SLOT.hair, "3xxxx is the hair's own slot 0");
  assert.equal(avatarSlotOfItem(20000), null, "a face id is not a part code");
  assert.equal(avatarSlotOfItem(2000000), null, "a consumable");
  assert.equal(avatarSlotOfItem(5000000), null, "cash is not a part code either");
  assert.equal(avatarSlotOfItem(1110000), null, "111xxxx is the one code inside the range that is empty");
  assert.equal(avatarSlotOfItem(0), null);
});

test("only 1..14 can be worn - the hair's slot 0 and the empty codes are not", () => {
  assert.equal(wornSlotOfItem(1040001), 5);
  assert.equal(wornSlotOfItem(1302000), 11);
  assert.equal(wornSlotOfItem(30000), null, "the hair goes to appearanceB, never to the worn group");
  assert.equal(wornSlotOfItem(1110000), null);
  assert.equal(WORN_SLOT_LIMIT, 14);
});

test("a 0x06 look becomes the worn group: one equip per body part the dialog picked", () => {
  const worn = wornOfLook(LOOK);
  assert.deepEqual([...worn.keys()], [5, 6, 7, 11], "top, pants, shoes, weapon - in word order");
  assert.equal(worn.get(5)?.itemId, 1040001);
  assert.equal(worn.get(6)?.itemId, 1060001);
  assert.equal(worn.get(7)?.itemId, 1071000);
  assert.equal(worn.get(11)?.itemId, 1302000);
  for (const slot of worn.values()) {
    assert.equal(slot.kind, "equip", "clothes are equips, not the stackable kind");
    assert.equal(slot.cash, null);
  }
  assert.equal(worn.size, 4, "the face, the hair and the four dice are not worn items");
});

test("the look words are where they were located: the dice start at 6, the parts at 0..5", () => {
  assert.equal(LOOK_WORDS, 10);
  assert.equal(LOOK_WORD.face, 0);
  assert.equal(LOOK_WORD.hair, 1);
  assert.equal(LOOK_WORD.clothes, 2);
  assert.equal(LOOK_WORD.pants, 3);
  assert.equal(LOOK_WORD.shoes, 4);
  assert.equal(LOOK_WORD.weapon, 5);
  assert.equal(LOOK_WORD.dice, 6);
});

test("words a character cannot wear are skipped, not stored somewhere they would stop showing", () => {
  const zeroes = wornOfLook([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(zeroes.size, 0, "a client that picked nothing dresses nobody");

  // A hair id in the clothes word, a face id in the weapon word: the client itself would ignore
  // them (no part code -> no cell), and so does the server.
  const odd = wornOfLook([20000, 30000, 30001, 1060001, 20005, 1040001]);
  assert.deepEqual([...odd.keys()], [6, 5], "1060001 is pants; the top in the weapon word is still a top");

  // A shorter array than the client's ten words is not an error either - it is what a save written
  // before the words were known holds.
  assert.deepEqual([...wornOfLook([20000, 30000]).keys()], []);
});

test("withWorn copies the block: the template another character uses is never touched", () => {
  const empty = startingCharacterItems();
  const worn = wornOfLook(LOOK);
  const dressed = withWorn(empty, worn);
  assert.notEqual(dressed, empty);
  assert.equal(empty.worn.size, 0, "the input block is left alone");
  assert.equal(dressed.worn.size, 4);
  assert.equal(dressed.inventories.length, empty.inventories.length);
  assert.equal(withWorn(empty, new Map()), empty, "nothing to add is handed back as it is");
});
