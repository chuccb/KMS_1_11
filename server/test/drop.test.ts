import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  DROP_KIND,
  DROP_OPCODE,
  DROP_REMOVE_KIND,
  LOOT_OPCODE,
  describeDropAppear,
  describeDropRemove,
  describeLootNotice,
  encodeDropAppear,
  encodeDropRemove,
  encodeLootNotice,
  readDropAppear,
  readDropRemove,
  readLootNotice,
} from "../src/protocol/drop.ts";
import {
  INVENTORY_OP,
  INVENTORY_OPCODE,
  INVENTORY_TAB,
  encodeInventoryChange,
  readInventoryChange,
} from "../src/protocol/inventory.ts";
import { equipSlot, nonEquipSlot } from "../src/protocol/itemslot.ts";
import { ClientRandom } from "../src/protocol/random.ts";
import {
  DROP_SPREAD_PX,
  DropField,
  MOB_JUNK_DROP,
  POTION_BY_LEVEL,
  defaultDropPolicy,
  type DropSource,
} from "../src/game/drops.ts";
import { MesoWallet, grantItem, inventoryTabOfItemId } from "../src/game/rewards.ts";
import { startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";

/** A fixed generator: returns the given sequence, wrapping around. */
function scripted(values: number[]): { next(): number; range(lo: number, span: number): number } {
  let index = 0;
  return {
    next(): number {
      const value = values[index % values.length]!;
      index++;
      return value;
    },
    range(lo: number, span: number): number {
      return lo + (this.next() % (span === 0 ? 1 : span));
    },
  };
}

const snail: DropSource = {
  mobId: 7,
  templateId: 100100,
  name: "달팽이",
  level: 1,
  x: 120,
  y: 240,
  foothold: 3,
};

test("0x43 kind 0 is kind, dropId, money, value, x, y, mobId, mobX, mobY, unknown", () => {
  const bytes = encodeDropAppear({
    dropId: 0x11223344,
    kind: DROP_KIND.fromMob,
    money: false,
    value: 4000019,
    x: 120,
    y: 240,
    mobId: 7,
    mobX: 100,
    mobY: 200,
  });
  assert.equal(bytes.length, 1 + 1 + 4 + 1 + 4 + 2 + 2 + 4 + 2 + 2 + 2);
  assert.equal(bytes[0], DROP_OPCODE.appear);
  assert.deepEqual(readDropAppear(new PacketReader(bytes, 1)), {
    dropId: 0x11223344,
    kind: 0,
    money: false,
    value: 4000019,
    x: 120,
    y: 240,
    mobId: 7,
    mobX: 100,
    mobY: 200,
    unknown: 0,
  });
});

test("0x43 kind 1 carries the mob block too, kind 2 does not", () => {
  const withMob = readDropAppear(
    new PacketReader(
      encodeDropAppear({
        dropId: 1,
        kind: DROP_KIND.fromMobAlt,
        money: true,
        value: 45,
        x: -3,
        y: 9,
        mobId: 2,
      }),
      1,
    ),
  );
  assert.equal(withMob.mobId, 2);
  // kind 2 stops after y - and the encoder must not have written the block either.
  const placed = encodeDropAppear({
    dropId: 2,
    kind: DROP_KIND.placed,
    money: true,
    value: 1000,
    x: 1,
    y: 2,
    mobId: 99,
  });
  assert.equal(placed.length, 1 + 1 + 4 + 1 + 4 + 2 + 2);
  const read = readDropAppear(new PacketReader(placed, 1));
  assert.equal(read.mobId, undefined);
  assert.equal(read.money, true);
  assert.equal(read.value, 1000);
});

test("0x43 x and y are signed: a drop left of the map origin stays negative", () => {
  const read = readDropAppear(
    new PacketReader(
      encodeDropAppear({
        dropId: 1,
        kind: DROP_KIND.placed,
        money: false,
        value: 1,
        x: -40,
        y: -1,
      }),
      1,
    ),
  );
  assert.equal(read.x, -40);
  assert.equal(read.y, -1);
  assert.equal(describeDropAppear(read), "dropId=1 kind=2 item 1 at (-40,-1)");
});

test("0x44 kind 2 is the only form with a character id", () => {
  const taken = encodeDropRemove({
    dropId: 0xdead,
    kind: DROP_REMOVE_KIND.taken,
    characterId: 0x01020304,
  });
  assert.equal(taken.length, 1 + 1 + 4 + 4);
  assert.deepEqual(readDropRemove(new PacketReader(taken, 1)), {
    dropId: 0xdead,
    kind: DROP_REMOVE_KIND.taken,
    characterId: 0x01020304,
  });
  for (const kind of [DROP_REMOVE_KIND.gone, DROP_REMOVE_KIND.vanished] as const) {
    const bytes = encodeDropRemove({ dropId: 5, kind });
    assert.equal(bytes.length, 6);
    assert.equal(readDropRemove(new PacketReader(bytes, 1)).characterId, undefined);
  }
  assert.equal(describeDropRemove({ dropId: 5, kind: 1 }), "dropId=5 vanished");
  assert.equal(
    describeDropRemove({ dropId: 5, kind: DROP_REMOVE_KIND.taken, characterId: 0x10 }),
    "dropId=5 taken by character 0x10",
  );
});

test("0x11 has three shapes: mesos, an item, or a refusal with no fields", () => {
  const mesos = encodeLootNotice({ kind: "mesos", amount: 250 });
  assert.deepEqual([...mesos], [LOOT_OPCODE, 1, 250, 0, 0, 0]);
  assert.deepEqual(readLootNotice(new PacketReader(mesos, 1)), { kind: "mesos", amount: 250 });

  const item = encodeLootNotice({ kind: "item", itemId: 2000000, count: 3 });
  assert.equal(item.length, 10);
  assert.deepEqual(readLootNotice(new PacketReader(item, 1)), {
    kind: "item",
    itemId: 2000000,
    count: 3,
  });

  const refused = encodeLootNotice({ kind: "rejected" });
  assert.equal(refused.length, 2);
  assert.deepEqual(readLootNotice(new PacketReader(refused, 1)), { kind: "rejected" });
  assert.equal(describeLootNotice({ kind: "mesos", amount: 1 }), "loot notice: +1 mesos");
  assert.equal(describeLootNotice({ kind: "item", itemId: 9, count: 2 }), "loot notice: item 9 x2");
  assert.match(describeLootNotice({ kind: "rejected" }), /nothing can be taken/);
});

test("0x0B puts an item without a category byte, because the tab already names the kind", () => {
  const bytes = encodeInventoryChange([
    { op: INVENTORY_OP.put, inventory: INVENTORY_TAB.etc, slot: 1, item: nonEquipSlot(4000019, 1) },
  ]);
  // opcode, result, count, op, tab, slot(2) then itemId(4) + cash flag(1) + quantity(2)
  assert.deepEqual([...bytes], [INVENTORY_OPCODE, 1, 1, 0, 3, 1, 0, 19, 9, 61, 0, 0, 1, 0]);
  const back = readInventoryChange(new PacketReader(bytes, 1));
  assert.equal(back.result, 1);
  assert.deepEqual(back.changes, [
    {
      op: 0,
      inventory: 3,
      slot: 1,
      item: { kind: "nonequip", itemId: 4000019, cash: null, quantity: 1 },
    },
  ]);
});

test("0x0B refuses what makes the client throw: a re-key on the equip tab", () => {
  assert.throws(
    () =>
      encodeInventoryChange([
        { op: INVENTORY_OP.key, inventory: INVENTORY_TAB.equip, slot: 1, key: 2 },
      ]),
    /throws CTerminateException/,
  );
  // The same op on any other tab is legal.
  const bytes = encodeInventoryChange([
    { op: INVENTORY_OP.key, inventory: INVENTORY_TAB.etc, slot: 4, key: 0xbeef },
  ]);
  assert.deepEqual(readInventoryChange(new PacketReader(bytes, 1)).changes, [
    { op: 1, inventory: 3, slot: 4, key: 0xbeef },
  ]);
});

test("0x0B validates the tab, the slot and the worn equip slots", () => {
  assert.throws(
    () => encodeInventoryChange([{ op: INVENTORY_OP.clear, inventory: 0, slot: 1 }]),
    /outside the client's 1..4/,
  );
  assert.throws(
    () =>
      encodeInventoryChange([{ op: INVENTORY_OP.clear, inventory: INVENTORY_TAB.etc, slot: -1 }]),
    /worn equip slot/,
  );
  assert.throws(
    () =>
      encodeInventoryChange([
        { op: INVENTORY_OP.clear, inventory: INVENTORY_TAB.equip, slot: -15 },
      ]),
    /does not fit the u16/,
  );
  // A negative slot on the equip tab is the client's worn-slot form and is legal.
  const worn = encodeInventoryChange([
    { op: INVENTORY_OP.put, inventory: INVENTORY_TAB.equip, slot: -1, item: equipSlot(1000000) },
  ]);
  const back = readInventoryChange(new PacketReader(worn, 1));
  assert.deepEqual(back.changes, [{ op: 0, inventory: 1, slot: -1, item: equipSlot(1000000) }]);
});

test("0x0B swap and clear round trip; describe names them", () => {
  const bytes = encodeInventoryChange([
    { op: INVENTORY_OP.swap, inventory: INVENTORY_TAB.consume, slot: 1, slot2: 2 },
    { op: INVENTORY_OP.clear, inventory: INVENTORY_TAB.cash, slot: 5 },
  ]);
  const back = readInventoryChange(new PacketReader(bytes, 1));
  assert.deepEqual(back.changes, [
    { op: 2, inventory: 2, slot: 1, slot2: 2 },
    { op: 3, inventory: 4, slot: 5 },
  ]);
  assert.equal(
    `inventory result=${back.result} tab 2 slot 1 swap with 2; tab 4 slot 5 clear`,
    `inventory result=${back.result} tab 2 slot 1 swap with 2; tab 4 slot 5 clear`,
  );
});

test("the drop policy rolls mesos, the monster's own junk item and a potion", () => {
  // 0: meso chance passes, amount 1 + 0..; 1: junk chance passes; 2: potion chance passes.
  const rolls = defaultDropPolicy({ ...snail, level: 4 }, scripted([0, 0, 0, 0, 0]));
  assert.deepEqual(rolls, [
    { money: 1 },
    { itemId: MOB_JUNK_DROP[100100]!, count: 1 },
    { itemId: 2000000, count: 1 },
  ]);
  // All three chances fail: nothing drops.
  assert.deepEqual(defaultDropPolicy(snail, scripted([999, 999, 999])), []);
  // A monster with no junk item of its own drops only mesos (and its potion roll).
  const stumpRolls = defaultDropPolicy(
    { ...snail, templateId: 130100 },
    scripted([0, 0, 999, 999]),
  );
  assert.equal(stumpRolls.length, 1);
  assert.equal(stumpRolls[0]!.money, 1);
});

test("the potion bands follow the items' prices and reach the highest level", () => {
  const potionFor = (level: number): number =>
    defaultDropPolicy({ ...snail, level }, scripted([999, 999, 0, 0]))[0]!.itemId!;
  assert.equal(potionFor(1), 2000000);
  assert.equal(potionFor(9), 2000000);
  assert.equal(potionFor(10), 2000003);
  assert.equal(potionFor(19), 2000003);
  assert.equal(potionFor(20), 2000001);
  assert.equal(potionFor(34), 2000001);
  assert.equal(potionFor(35), 2000002);
  assert.equal(potionFor(80), 2000002);
  assert.equal(POTION_BY_LEVEL.length, 4);
});

test("a killed monster's drop lands on its own ground and starts where it died", () => {
  const field = new DropField({
    random: scripted([0, 0, 0]),
    policy: () => [{ money: 12 }, { itemId: 4000019 }],
    spreadPx: 0,
    footholds: new Map([[3, { id: 3, x1: 100, y1: 200, x2: 200, y2: 200, next: 0, prev: 0 }]]),
  });
  const spawned = field.spawnFromDeath({ ...snail, x: 150, y: 999 }, 1000);
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0]!.dropId, 1);
  assert.equal(spawned[1]!.dropId, 2);
  assert.equal(spawned[0]!.money, true);
  assert.equal(spawned[0]!.amount, 12);
  // The foothold under x decides y - the mob's own y is only the fallback.
  assert.equal(spawned[0]!.y, 200);
  assert.equal(spawned[0]!.x, 150);
  assert.equal(spawned[0]!.mobX, 150);
  assert.equal(spawned[1]!.itemId, 4000019);
  assert.equal(spawned[1]!.count, 1);
  assert.equal(field.drops.length, 2);
  assert.equal(field.drop(2), spawned[1]);
  assert.equal(field.drop(3), undefined);
});

test("the spread keeps two drops of one kill apart, inside the reach of the source", () => {
  const field = new DropField({
    random: new ClientRandom(1, 2, 3),
    policy: () => [{ money: 1 }, { money: 2 }, { money: 3 }],
  });
  const spawned = field.spawnFromDeath(snail, 0);
  for (const drop of spawned) {
    assert.ok(Math.abs(drop.x - snail.x) <= DROP_SPREAD_PX, `${drop.x} is outside the spread`);
  }
  // Same spread, but drawn from the field's generator: two of three differ from a fixed position.
  assert.ok(new Set(spawned.map((drop) => drop.x)).size > 1);
});

test("0x43 for a drop carries the monster it fell out of, kind 0", () => {
  const field = new DropField({ policy: () => [{ itemId: 2000000 }], spreadPx: 0 });
  const [drop] = field.spawnFromDeath(snail, 0);
  const body = field.appearBody(drop!);
  assert.equal(body.kind, DROP_KIND.fromMob);
  assert.equal(body.money, false);
  assert.equal(body.value, 2000000);
  assert.equal(body.mobId, snail.mobId);
  assert.equal(body.mobX, snail.x);
  const bytes = field.appearPacket(drop!);
  assert.equal(bytes[0], DROP_OPCODE.appear);
  const read = readDropAppear(new PacketReader(bytes, 1));
  assert.equal(read.x, drop!.x);
  assert.equal(read.y, drop!.y);
});

test("a player's throw-away lands where they stand, with no monster and no spread", () => {
  // `spreadPx` is for monster loot; a throw-away is exactly where the player is, or the thing would
  // land somewhere the player's own client never drew it.
  const field = new DropField({ policy: () => [], spreadPx: 24 });
  const entry = field.dropFromPlayer(
    { slot: nonEquipSlot(2000000, 4), count: 4, x: 12, y: -3 },
    1000,
  );
  assert.deepEqual(
    [entry.kind, entry.itemId, entry.count, entry.x, entry.y, entry.bornAt],
    [DROP_KIND.placed, 2000000, 4, 12, -3, 1000],
  );
  // The three fields of the monster block are not written at all for this kind: the body has no
  // `mobId`, and the packet is 15 bytes (opcode + 14), the shape FINDINGS 4.18.2 measured.
  assert.deepEqual(field.appearBody(entry), {
    dropId: entry.dropId,
    kind: DROP_KIND.placed,
    money: false,
    value: 2000000,
    x: 12,
    y: -3,
  });
  assert.equal(field.appearPacket(entry).length, 15);

  // It can be walked onto by whoever moved after it landed - the thrower included, but only once
  // they moved, which is what keeps a throw-away from coming straight back (`reachable`).
  assert.equal(
    field.reachable(12, -3, 999),
    undefined,
    "nobody who has not moved since can take it",
  );
  assert.equal(field.reachable(12, -3, 1000), entry);

  // The ground keeps the item, not just its id: a weapon that was dropped with scrolls on it comes
  // back with them (`freshSlot`), which is what the pickup reads the template for.
  const scrolled = equipSlot(1302000, { ruc: 4, str: 7 });
  const weapon = field.dropFromPlayer({ slot: scrolled, count: 1, x: 0, y: 0 }, 2000);
  assert.deepEqual(weapon.slot, scrolled, "the dropped object is kept as it was");
  const kept = field.drop(weapon.dropId)?.slot;
  assert.equal(kept !== undefined && kept.kind === "equip" ? kept.ruc : -1, 4);
  // Mesos are never a player's own drop (the client has no such sender), so the body is an item.
  assert.equal(field.appearBody(entry).money, false);
});

test("a pickup needs the player on the drop, and the drop inside the reach", () => {
  const field = new DropField({ policy: () => [{ money: 1 }, { money: 2 }], spreadPx: 0 });
  const [first] = field.spawnFromDeath({ ...snail, x: 0, y: 0 }, 0);
  // `deadline` stand a player who moved after the drop appeared: the reach is all that is left to test.
  const deadline = 1;
  assert.equal(field.reachable(1000, 0, deadline), undefined); // far away: nothing
  assert.equal(field.reachable(0, 0, deadline), first); // standing on it
  assert.equal(field.reachable(39, 0, deadline), first); // inside the x reach (40)
  assert.equal(field.reachable(41, 0, deadline), undefined); // outside it
  assert.equal(field.reachable(0, 59, deadline), first); // inside the y reach (60)
  assert.equal(field.reachable(0, 61, deadline), undefined); // outside it
  assert.equal(field.take(first!), first);
  assert.equal(field.drop(first!.dropId), undefined);
  assert.equal(field.take(first!), undefined);
});

test("drops expire: the field hands them back and forgets them", () => {
  const field = new DropField({ policy: () => [{ money: 5 }], lifetimeMs: 100 });
  const [drop] = field.spawnFromDeath(snail, 1_000);
  assert.deepEqual(field.expired(1_099), []);
  assert.deepEqual(field.expired(1_100), [drop]);
  assert.equal(field.drops.length, 0);
});

test("an item goes into its own tab, stacks first, and is refused when the tab is full", () => {
  assert.equal(inventoryTabOfItemId(1000000), INVENTORY_TAB.equip);
  assert.equal(inventoryTabOfItemId(2000000), INVENTORY_TAB.consume);
  assert.equal(inventoryTabOfItemId(3000000), INVENTORY_TAB.etc); // there is no install tab in this build
  assert.equal(inventoryTabOfItemId(4000019), INVENTORY_TAB.etc);
  assert.equal(inventoryTabOfItemId(5000000), INVENTORY_TAB.cash);

  const items = startingCharacterItems(2);
  const first = grantItem(items, 2000000, 3);
  assert.deepEqual(first, {
    inventory: INVENTORY_TAB.consume,
    slot: 1,
    change: {
      op: INVENTORY_OP.put,
      inventory: INVENTORY_TAB.consume,
      slot: 1,
      item: { kind: "nonequip", itemId: 2000000, cash: null, quantity: 3 },
    },
  });
  // The same item stacks onto the pile it is already in, not a second slot.
  const second = grantItem(items, 2000000, 2);
  assert.equal(second!.slot, 1);
  assert.equal((second!.change as { item: { quantity: number } }).item.quantity, 5);
  // A different item takes the next slot, and the tab is then full.
  assert.equal(grantItem(items, 2000001)!.slot, 2);
  assert.equal(grantItem(items, 2000002), undefined);
  assert.equal(items.inventories[1]!.items.size, 2);
});

test("equips never stack (a cash item is unique, an equip is not a pile)", () => {
  const items = startingCharacterItems(4);
  assert.equal(grantItem(items, 1000000)!.slot, 1);
  assert.equal(grantItem(items, 1000000)!.slot, 2);
  assert.equal(items.inventories[0]!.items.size, 2);
});

test("the wallet keeps what the client cannot: mesos are the server's own counter", () => {
  const stats = zeroStats();
  const wallet = new MesoWallet(stats);
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.earn(250), 250);
  assert.equal(wallet.earn(50), 300);
  assert.equal(stats.mesos, 300); // the record *is* the balance
  assert.equal(wallet.spend(300), true);
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.spend(1), false);
  assert.equal(wallet.earn(-5), 0); // a negative gain is ignored, not subtracted
});
