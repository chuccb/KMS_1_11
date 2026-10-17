/** Added as regression source, NOT executed at the user's request (2026-10-17). */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  firstBasicAmmo,
  spendBasicAmmo,
  isCompatibleAmmo,
  basicAttackProvider,
  basicProjectileFrames,
} from "../src/game/basicattack.ts";
import { emptyCharacterItems } from "../src/protocol/chardata.ts";
import { equipSlot, nonEquipSlot } from "../src/protocol/itemslot.ts";
import { INVENTORY_OP } from "../src/protocol/inventory.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  encodeClientAttack,
  readClientAttack,
  encodeUserAttack,
  readUserAttack,
} from "../src/protocol/field.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";

function bag(weaponId: number) {
  const items = emptyCharacterItems();
  items.worn.set(11, equipSlot(weaponId));
  items.inventories[1]!.capacity = 24;
  return items;
}

test("511630: compatible family, numerical slots, empty stars skipped and no mutation on refusal", () => {
  const items = bag(1472000),
    use = items.inventories[1]!.items;
  use.set(12, nonEquipSlot(2070001, 5));
  use.set(1, nonEquipSlot(2060000, 999));
  use.set(2, nonEquipSlot(2070000, 0));
  use.set(5, nonEquipSlot(2070000, 2));
  assert.deepEqual(firstBasicAmmo(items), { slot: 5, itemId: 2070000 });
  const before = [...use.entries()];
  assert.equal(spendBasicAmmo(items, 12), undefined);
  assert.deepEqual([...use.entries()], before);
  const spent = spendBasicAmmo(items, 5)!;
  assert.equal(spent.itemId, 2070000);
  assert.equal(
    spent.change.op,
    INVENTORY_OP.put,
    "do not misuse the undecoded op1 key as quantity",
  );
  assert.deepEqual(use.get(5), nonEquipSlot(2070000, 1));
  spendBasicAmmo(items, 5);
  assert.deepEqual(
    use.get(5),
    nonEquipSlot(2070000, 0),
    "keep an empty rechargeable set",
  );
  assert.deepEqual(firstBasicAmmo(items), { slot: 12, itemId: 2070001 });
});

test("bow/crossbow never borrow stars or each other's arrows; last arrow clears with its id retained", () => {
  for (const [weapon, arrow, other] of [
    [1452000, 2060000, 2061000],
    [1462000, 2061000, 2060000],
  ]) {
    const items = bag(weapon!),
      use = items.inventories[1]!.items;
    use.set(1, nonEquipSlot(other!, 99));
    use.set(2, nonEquipSlot(2070000, 500));
    use.set(4, nonEquipSlot(arrow!, 1));
    assert.deepEqual(firstBasicAmmo(items), { slot: 4, itemId: arrow });
    const spent = spendBasicAmmo(items, 4)!;
    assert.equal(spent.itemId, arrow);
    assert.deepEqual(spent.change, {
      op: INVENTORY_OP.clear,
      inventory: 2,
      slot: 4,
    });
    assert.equal(use.has(4), false);
    assert.equal(firstBasicAmmo(items), undefined);
  }
  assert.equal(isCompatibleAmmo(1302000, 2070000), false);
});

test("0x10 empty basic shot keeps hits=1 and the USE slot; 0x24 empty relay keeps its projectile id", () => {
  const shot = {
    hits: 1,
    targetCount: 0,
    skillId: 0,
    facingLeft: true,
    action: 22,
    speed: 3,
    projectileSlot: 2,
    targets: [],
  };
  const bytes = encodeClientAttack(shot, 0x10);
  assert.deepEqual([...bytes], [0x10, 1, 0, 0, 0, 0, 0x96, 3, 2, 0]);
  assert.deepEqual(readClientAttack(new PacketReader(bytes, 1), 0x10), shot);
  const relay = {
    characterId: 7,
    hits: 1,
    skillLevel: 0,
    skillId: 0,
    facingLeft: false,
    action: 24,
    speed: 2,
    afterimage: 0,
    projectileItemId: 2070000,
    targets: [],
  };
  const packet = encodeUserAttack(relay, 0x24);
  assert.deepEqual(
    [...packet],
    [0x24, 7, 0, 0, 0, 1, 0, 24, 2, 0, 0xf0, 0x95, 0x1f, 0],
  );
  assert.deepEqual(readUserAttack(new PacketReader(packet, 1)), relay);
});

const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "native action tables use WZ bow/crossbow/claw poses, five shoot2 frames and real bullet origins",
  { skip: !existsSync(data) },
  () => {
    const reader = artReaderOf(WzArchive.open(data))!;
    const profile = basicAttackProvider(reader);
    const bow = profile(1452000)!,
      crossbow = profile(1462000)!,
      claw = profile(1472000)!;
    assert.deepEqual(
      bow.shoot.map((a) => [a.action, a.stance]),
      [[22, "shoot1"]],
    );
    assert.deepEqual(bow.shoot[0]!.delays, [350, 150, 350]);
    assert.deepEqual(crossbow.shoot[0]!.baseDelays, [150, 150, 250, 100, 100]);
    assert.deepEqual(crossbow.shoot[0]!.delays, [168, 168, 281, 112, 112]);
    assert.deepEqual(
      claw.shoot.map((a) => [a.action, a.stance]),
      [
        [24, "swingO1"],
        [25, "swingO2"],
        [26, "swingO3"],
      ],
    );
    assert.deepEqual(
      claw.melee.map((a) => a.stance),
      ["stabO1", "stabO2"],
    );
    assert.deepEqual(
      basicProjectileFrames(reader, 2070000).map((f) => [f.delay, f.ox, f.oy]),
      [
        [30, 9, 9],
        [30, 8, 8],
      ],
    );
    assert.equal(basicProjectileFrames(reader, 2000000).length, 0);
  },
);
