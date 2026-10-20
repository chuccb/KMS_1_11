/**
 * `0x17`'s rules: which drags move what, and which ones leave the bags alone.
 *
 * The module under test is pure (`game/inventory.ts`), so every case here is a `CharacterItems`
 * built by hand plus one request - no sockets, no field, no archive. What is pinned is the *shape*
 * of the answer (`0x0B` entries and whether the look moved) and the negative-slot convention the
 * client's own `0x0B` reader uses for the worn items (FINDINGS 4.34.1 / 4.10).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyChangeSlot,
  type ChangeSlotFailure,
  type ChangeSlotOutcome,
} from "../src/game/inventory.ts";
import { INVENTORY_OP, INVENTORY_TAB } from "../src/protocol/inventory.ts";
import {
  startingCharacterItems,
  type CharacterItems,
  type Inventory,
} from "../src/protocol/chardata.ts";
import { equipSlot, nonEquipSlot, type ItemSlot } from "../src/protocol/itemslot.ts";
import { MAX_ITEM_STACK } from "../src/game/rewards.ts";

const CAP = 1002000; // part code 100 -> body part 1
const TOP = 1040001; // part code 104 -> body part 5
const SWORD = 1302000; // part code 130 -> body part 11
const POTION = 2000000;

/** A character whose equip tab holds `equips` and whose consume tab holds `consume`. */
function items(
  equips: Array<[number, number]> = [],
  consume: Array<[number, number]> = [],
): CharacterItems {
  const block = startingCharacterItems();
  for (const [slot, itemId] of equips) block.inventories[0]!.items.set(slot, equipSlot(itemId));
  for (const [slot, itemId] of consume)
    block.inventories[1]!.items.set(slot, nonEquipSlot(itemId, 10));
  return block;
}

function tab(block: CharacterItems, index: number): Inventory {
  return block.inventories[index - 1]!;
}

function itemIdAt(block: CharacterItems, slot: number): number | undefined {
  const item: ItemSlot | undefined =
    slot < 0 ? block.worn.get(-slot) : tab(block, 1).items.get(slot);
  return item?.itemId;
}

/** The `(op, slot, itemId)` triples an answer carries - what the client's `0x0B` would apply. */
function shape(outcome: ChangeSlotOutcome): Array<[number, number, number]> {
  if (outcome.kind === "failed") assert.fail(`expected an accepted outcome, got ${outcome.reason}`);
  return outcome.changes.map((change) => [
    change.op,
    change.slot,
    change.op === INVENTORY_OP.put ? change.item.itemId : 0,
  ]);
}

/** Every slot's item id of the two places a `0x17` can touch, so a refusal can be shown to write none. */
function snapshot(block: CharacterItems): string {
  const ids = (map: Map<number, ItemSlot>) =>
    [...map.entries()].map(([slot, item]) => `${slot}:${item.itemId}`);
  return JSON.stringify({ worn: ids(block.worn), equip: ids(tab(block, 1).items) });
}

function refusal(
  block: CharacterItems,
  request: Parameters<typeof applyChangeSlot>[1],
): ChangeSlotFailure {
  const before = snapshot(block);
  const outcome = applyChangeSlot(block, request);
  assert.equal(outcome.kind, "failed", `expected a refusal, got ${JSON.stringify(outcome)}`);
  assert.equal(snapshot(block), before, "a refusal writes nothing at all");
  return outcome.kind === "failed" ? outcome.reason : "emptySlot";
}

const equip = (fromSlot: number, toSlot: number, count = -1) => ({
  tab: INVENTORY_TAB.equip,
  fromSlot,
  toSlot,
  count,
});

test("equipping a cap: the tab slot empties and the worn part gets the item", () => {
  const block = items([[2, CAP]]);
  const outcome = applyChangeSlot(block, equip(2, -1));
  assert.deepEqual(shape(outcome), [
    [INVENTORY_OP.put, -1, CAP],
    [INVENTORY_OP.clear, 2, 0],
  ]);
  assert.equal(itemIdAt(block, -1), CAP, "worn part 1 is the cap slot");
  assert.equal(itemIdAt(block, 2), undefined);
  assert.equal(
    outcome.kind === "done" && outcome.lookChanged,
    true,
    "a worn slot moved, so others need 0x28",
  );
});

test("unequipping puts it back in the slot it is dragged to, and the worn part goes empty", () => {
  const block = items([[3, CAP]]);
  applyChangeSlot(block, equip(3, -1));
  const outcome = applyChangeSlot(block, equip(-1, 4));
  assert.deepEqual(shape(outcome), [
    [INVENTORY_OP.put, 4, CAP],
    [INVENTORY_OP.clear, -1, 0],
  ]);
  assert.equal(itemIdAt(block, 4), CAP);
  assert.equal(block.worn.has(1), false);
  assert.equal(outcome.kind === "done" && outcome.lookChanged, true);
});

test("a move inside the tab changes no look", () => {
  const block = items([[1, CAP]]);
  const outcome = applyChangeSlot(block, equip(1, 5));
  assert.deepEqual(shape(outcome), [
    [INVENTORY_OP.put, 5, CAP],
    [INVENTORY_OP.clear, 1, 0],
  ]);
  assert.equal(outcome.kind === "done" && outcome.lookChanged, false);
});

test("two occupied slots swap, in both directions", () => {
  const block = items([
    [1, CAP],
    [2, TOP],
  ]);
  assert.deepEqual(shape(applyChangeSlot(block, equip(1, 2))), [
    [INVENTORY_OP.put, 2, CAP],
    [INVENTORY_OP.put, 1, TOP],
  ]);
  assert.deepEqual([itemIdAt(block, 1), itemIdAt(block, 2)], [TOP, CAP]);

  // And the same thing across the worn border: a new cap over the worn one puts the old one back in
  // the tab slot the new one came from - which is what "wearing" means here.
  const dressed = items([[9, CAP]]);
  dressed.worn.set(1, equipSlot(1002001));
  assert.deepEqual(shape(applyChangeSlot(dressed, equip(9, -1))), [
    [INVENTORY_OP.put, -1, CAP],
    [INVENTORY_OP.put, 9, 1002001],
  ]);
  assert.deepEqual([itemIdAt(dressed, -1), itemIdAt(dressed, 9)], [CAP, 1002001]);
});

test("a non-equip tab moves stacks the same way, with no look at all", () => {
  const block = items([], [[2, POTION]]);
  const outcome = applyChangeSlot(block, {
    tab: INVENTORY_TAB.consume,
    fromSlot: 2,
    toSlot: 7,
    count: -1,
  });
  assert.deepEqual(shape(outcome), [
    [INVENTORY_OP.put, 7, POTION],
    [INVENTORY_OP.clear, 2, 0],
  ]);
  assert.equal(outcome.kind === "done" && outcome.lookChanged, false);
});

test("a stack dropped on its own kind merges: the sum lands in the destination, the source empties", () => {
  const block = items(
    [],
    [
      [2, POTION],
      [5, POTION],
    ],
  ); // two stacks of ten (the helper's quantity)
  const outcome = applyChangeSlot(block, {
    tab: INVENTORY_TAB.consume,
    fromSlot: 2,
    toSlot: 5,
    count: -1,
  });
  assert.deepEqual(shape(outcome), [
    [INVENTORY_OP.put, 5, POTION],
    [INVENTORY_OP.clear, 2, 0],
  ]);
  assert.equal(
    outcome.kind === "done" && outcome.lookChanged,
    false,
    "a bag merge changes no look",
  );
  const consume = tab(block, INVENTORY_TAB.consume);
  const dest = consume.items.get(5);
  assert.equal(dest && "quantity" in dest ? dest.quantity : 0, 20, "the record holds the sum");
  assert.equal(consume.items.has(2), false, "the source slot is gone, not zero");
});

test("a merge past the ceiling fills the destination and leaves the rest in the source", () => {
  const block = items([], [[2, POTION]]);
  const consume = tab(block, INVENTORY_TAB.consume);
  consume.items.set(2, nonEquipSlot(POTION, 150));
  consume.items.set(5, nonEquipSlot(POTION, 100));
  const outcome = applyChangeSlot(block, {
    tab: INVENTORY_TAB.consume,
    fromSlot: 2,
    toSlot: 5,
    count: -1,
  });
  // Two puts: nothing is destroyed, and the wire total is the record total.
  assert.deepEqual(shape(outcome), [
    [INVENTORY_OP.put, 5, POTION],
    [INVENTORY_OP.put, 2, POTION],
  ]);
  const quantityAt = (slot: number): number => {
    const item = consume.items.get(slot);
    return item && "quantity" in item ? item.quantity : 0;
  };
  assert.equal(quantityAt(5), MAX_ITEM_STACK, "the destination fills to grantItem's own ceiling");
  assert.equal(quantityAt(2), 250 - MAX_ITEM_STACK, "the source keeps the rest");
});

test("different stacks still swap, identical equips still swap, cash serials still swap", () => {
  // Two different potions: a swap, exactly like before the merge branch existed.
  const blue = 2000003;
  const mixed = items(
    [],
    [
      [2, POTION],
      [5, blue],
    ],
  );
  assert.deepEqual(
    shape(
      applyChangeSlot(mixed, {
        tab: INVENTORY_TAB.consume,
        fromSlot: 2,
        toSlot: 5,
        count: -1,
      }),
    ),
    [
      [INVENTORY_OP.put, 5, POTION],
      [INVENTORY_OP.put, 2, blue],
    ],
  );

  // Two caps with the *same* id: equips never stack, so this is a swap of two distinct objects.
  const twins = items([
    [1, CAP],
    [2, CAP],
  ]);
  assert.deepEqual(shape(applyChangeSlot(twins, equip(1, 2))), [
    [INVENTORY_OP.put, 2, CAP],
    [INVENTORY_OP.put, 1, CAP],
  ]);
  assert.deepEqual([itemIdAt(twins, 1), itemIdAt(twins, 2)], [CAP, CAP], "both caps still exist");

  // Two cash stacks of one id: each carries its own serial, and a merge would lose one - so they
  // swap, serials riding along with their slots.
  const CASH = 5000000; // family 5 -> the cash tab
  const wallet = startingCharacterItems();
  const serial = (sn: number) => ({ sn: BigInt(sn), unknown18: 0, unknown1A: 0n });
  tab(wallet, INVENTORY_TAB.cash).items.set(1, nonEquipSlot(CASH, 10, { cash: serial(111) }));
  tab(wallet, INVENTORY_TAB.cash).items.set(2, nonEquipSlot(CASH, 10, { cash: serial(222) }));
  assert.deepEqual(
    shape(
      applyChangeSlot(wallet, {
        tab: INVENTORY_TAB.cash,
        fromSlot: 1,
        toSlot: 2,
        count: -1,
      }),
    ),
    [
      [INVENTORY_OP.put, 2, CASH],
      [INVENTORY_OP.put, 1, CASH],
    ],
  );
  const cash = tab(wallet, INVENTORY_TAB.cash);
  assert.equal(cash.items.get(2)!.cash?.sn, 111n, "the moved stack keeps its serial");
  assert.equal(cash.items.get(1)!.cash?.sn, 222n, "and so does the displaced one");
});

test("a worn part the item does not belong to is refused, not guessed", () => {
  // A cap's own part is 1, so part 5 - the clothes slot - is not an answer for it.
  assert.equal(refusal(items([[1, CAP]]), equip(1, -5)), "wrongPart");
  // And a weapon cannot be worn as a cap.
  assert.equal(refusal(items([[1, SWORD]]), equip(1, -1)), "wrongPart");
  // A weapon goes to part 11 and nowhere else.
  const ok = items([[1, SWORD]]);
  assert.equal(applyChangeSlot(ok, equip(1, -11)).kind, "done");
  assert.equal(itemIdAt(ok, -11), SWORD);
});

test("the destination has to be able to hold what is being displaced", () => {
  // Unequipping the sword into a slot that holds a cap: the cap would have to go to the sword's worn
  // part (11), which no cap can be worn at.
  const block = items([[5, CAP]]);
  block.worn.set(11, equipSlot(SWORD));
  assert.equal(refusal(block, equip(-11, 5)), "displacedItemDoesNotFit");
  // And a worn part with nothing in it is not a source either.
  assert.equal(refusal(items([[5, CAP]]), equip(-1, 5)), "emptySlot");
});

test("the requests the client never sends are refused too", () => {
  // A throw-away always carries the number the player answered to "몇 개나 버리시겠습니까?" - `sub_463BE0`
  // passes what `sub_4643F0` returned, and 1 for an equip - so the three `-1` senders cannot ask for one.
  assert.equal(refusal(items([[1, CAP]]), equip(1, 0)), "badCount");
  assert.equal(refusal(items([[1, CAP]]), equip(0, -1)), "slotOutOfRange");
  assert.equal(refusal(items([[1, CAP]]), equip(1, -1, 3)), "badCount");
  assert.equal(
    refusal(items([[1, CAP]]), { tab: 5, fromSlot: 1, toSlot: 2, count: -1 }),
    "unknownTab",
  );
  assert.equal(
    refusal(items([[1, CAP]]), { tab: INVENTORY_TAB.consume, fromSlot: -1, toSlot: 2, count: -1 }),
    "slotOutOfRange",
    "a negative slot is a worn item, and only the equip tab has one",
  );
  assert.equal(refusal(items([[1, CAP]]), equip(9, 2)), "emptySlot");
  assert.equal(refusal(items([[1, CAP]]), equip(1, 99)), "slotOutOfRange");
  // A cap at worn part 1 can never be the source or the target of another part: the *slot* is checked
  // first, so this is a bad request rather than a move into a slot that would not draw it.
  assert.equal(refusal(items([[1, CAP]]), equip(1, -14)), "wrongPart");
  assert.equal(refusal(items([[1, CAP]]), equip(1, -15)), "slotOutOfRange");
  // A potion sits in the USE tab, so one "found" in the equip tab is the packet lying about what a
  // slot holds - the item's own tab is what it has to agree with.
  assert.equal(refusal(items([[1, POTION]]), equip(1, -1)), "itemNotInTab");
  assert.equal(refusal(items([[1, POTION]]), equip(1, 2)), "itemNotInTab");
});

test("a throw-away takes the items out of the slot and leaves the ground to the caller", () => {
  // Some of a stack: the slot keeps the rest and the answer is one `put` of what is left.
  const block = items([], [[3, POTION]]);
  const partial = applyChangeSlot(block, {
    tab: INVENTORY_TAB.consume,
    fromSlot: 3,
    toSlot: 0,
    count: 3,
  });
  assert.equal(partial.kind, "drop");
  if (partial.kind !== "drop") return;
  assert.deepEqual([partial.slot.itemId, partial.count, partial.lookChanged], [POTION, 3, false]);
  // The item itself travels with the answer, at the count that left: the ground keeps the object.
  assert.equal(partial.slot.kind === "nonequip" && partial.slot.quantity, 3);
  assert.deepEqual(shape(partial), [[INVENTORY_OP.put, 3, POTION]]);
  const left = tab(block, INVENTORY_TAB.consume).items.get(3);
  assert.equal(
    left !== undefined && "quantity" in left ? left.quantity : 0,
    7,
    "seven of the ten stay",
  );

  // All of it (the client asks the stack size when there is more than one): the slot is cleared.
  const all = applyChangeSlot(block, {
    tab: INVENTORY_TAB.consume,
    fromSlot: 3,
    toSlot: 0,
    count: 7,
  });
  assert.equal(all.kind === "drop" && all.count, 7);
  assert.deepEqual(shape(all), [[INVENTORY_OP.clear, 3, 0]]);
  assert.equal(tab(block, INVENTORY_TAB.consume).items.has(3), false);

  // A worn cap: `count` is always 1 there (`sub_463BE0` skips the question for the equip tab), and the
  // look moved - the caller's `0x28`.
  const dressed = items();
  dressed.worn.set(1, equipSlot(CAP));
  const worn = applyChangeSlot(dressed, equip(-1, 0, 1));
  assert.equal(worn.kind === "drop" && worn.lookChanged, true);
  assert.deepEqual(shape(worn), [[INVENTORY_OP.clear, -1, 0]]);
  assert.equal(dressed.worn.has(1), false);

  // What cannot be thrown away, and what cannot be dropped at all: nothing is written either way.
  assert.equal(
    refusal(items([], [[3, POTION]]), {
      tab: INVENTORY_TAB.consume,
      fromSlot: 3,
      toSlot: 0,
      count: 11,
    }),
    "badCount",
  );
  assert.equal(
    refusal(items([], [[3, POTION]]), {
      tab: INVENTORY_TAB.consume,
      fromSlot: 3,
      toSlot: 0,
      count: 0,
    }),
    "badCount",
  );
  assert.equal(
    refusal(items([], [[3, POTION]]), {
      tab: INVENTORY_TAB.consume,
      fromSlot: 3,
      toSlot: 0,
      count: 1.5,
    }),
    "badCount",
  );
  assert.equal(refusal(items([[1, CAP]]), equip(1, 0, 2)), "badCount", "an equip is never a stack");
  assert.equal(
    refusal(items([], [[3, POTION]]), {
      tab: INVENTORY_TAB.consume,
      fromSlot: 4,
      toSlot: 0,
      count: 1,
    }),
    "emptySlot",
  );
  // A cash item carries a serial number a drop cannot: the client refuses to send one itself
  // (`sub_47A420` reads `info/cash`, `sub_463BE0` checks the item's own serial).
  const cash = items([], [[3, POTION]]);
  tab(cash, INVENTORY_TAB.consume).items.set(
    3,
    nonEquipSlot(POTION, 2, { cash: { sn: 7n, unknown18: 0, unknown1A: 0n } }),
  );
  assert.equal(
    refusal(cash, { tab: INVENTORY_TAB.consume, fromSlot: 3, toSlot: 0, count: 1 }),
    "cashItem",
  );
});

test("a drag that lands back on its own slot is an answered no-op", () => {
  const block = items([[1, CAP]]);
  const outcome = applyChangeSlot(block, equip(1, 1));
  assert.deepEqual(shape(outcome), []);
  assert.equal(itemIdAt(block, 1), CAP, "the item never left");
});

test("native two-hand/shield and overall/pants conflicts move atomically into the bag", () => {
  for (const [incoming, conflict, conflictPart, part] of [
    [1402000, 1092000, 10, 11],
    [1092000, 1402000, 11, 10],
    [1050000, 1060000, 6, 5],
    [1060000, 1050000, 5, 6],
  ]) {
    const block = items([[1, incoming!]]);
    block.worn.set(conflictPart!, equipSlot(conflict!));
    const outcome = applyChangeSlot(block, equip(1, -part!));
    assert.equal(outcome.kind, "done");
    assert.equal(itemIdAt(block, -part!), incoming);
    assert.equal(itemIdAt(block, -conflictPart!), undefined);
    assert.equal(itemIdAt(block, 1), conflict);
  }
});
test("occupied target plus conflict needs one spare bag slot, or refuses without partial writes", () => {
  const block = items([[1, 1402000]]);
  tab(block, 1).capacity = 1;
  block.worn.set(11, equipSlot(1302000));
  block.worn.set(10, equipSlot(1092000));
  assert.equal(refusal(block, equip(1, -11)), "notEnoughSlots");
  tab(block, 1).capacity = 2;
  assert.equal(applyChangeSlot(block, equip(1, -11)).kind, "done");
  assert.deepEqual(
    [itemIdAt(block, 1), itemIdAt(block, 2), itemIdAt(block, -11), itemIdAt(block, -10)],
    [1302000, 1092000, 1402000, undefined],
  );
});
