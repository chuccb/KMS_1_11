/**
 * Byte-exact tests for `GW_ItemSlot` and for the `CharacterData` item block.
 *
 * Everything asserted here comes from the client's own reader/writer pair (see the evidence notes
 * in `src/protocol/itemslot.ts` and `docs/protocol/FINDINGS.md` 4.9), so these tests fail the
 * moment the layout drifts from the binary - not merely when our encoder and decoder disagree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader, PacketWriter } from "../src/protocol/packet.ts";
import { toHex } from "../src/protocol/frame.ts";
import {
  CHAR_FLAG_INVENTORY_2,
  CHAR_FLAG_INVENTORY_4,
  CHAR_FLAG_ITEMS,
  CHAR_FLAG_MAP32,
  CHAR_FLAG_MAPSTR,
  CHAR_FLAG_STATS,
  CHARACTER_STATS_BYTES,
  characterDataOf,
  emptyCharacterItems,
  readCharacterData,
  writeCharacterData,
  zeroStats,
} from "../src/protocol/chardata.ts";
import {
  ITEM_CATEGORY,
  ITEM_TYPE_FROM_STREAM,
  equipSlot,
  itemSlotBytes,
  nonEquipSlot,
  readItemSlot,
  writeItemSlot,
} from "../src/protocol/itemslot.ts";

/** A sword with a distinct value in every field, so any reorder shows up as a diff. */
function sampleEquip() {
  return equipSlot(0x0013de30, {
    ruc: 0x07,
    cuc: 0x02,
    str: 0x0506,
    dex: 0x0708,
    int: 0x090a,
    luk: 0x0b0c,
    maxHp: 0x0d0e,
    maxMp: 0x0f10,
    pad: 0x1112,
    mad: 0x1314,
    pdd: 0x1516,
    mdd: 0x1718,
    acc: 0x191a,
    eva: 0x1b1c,
    craft: 0x1d1e,
    speed: 0x1f20,
    jump: 0x2122,
  });
}

/** itemId 0x0013de30, no cash block, ruc 7, cuc 2, then str..jump = 0x0506..0x2122. */
const EQUIP_HEX =
  "30de1300" +
  "00" +
  "07" +
  "02" +
  "0605" +
  "0807" +
  "0a09" +
  "0c0b" +
  "0e0d" +
  "100f" +
  "1211" +
  "1413" +
  "1615" +
  "1817" +
  "1a19" +
  "1c1b" +
  "1e1d" +
  "201f" +
  "2221";

test("an equip is itemId + flag + ruc + cuc + fifteen u16, in the tooltip's order", () => {
  const writer = new PacketWriter();
  writeItemSlot(writer, sampleEquip(), 1); // hint 1 = equip: no category byte (sub_45E560 arg 0)
  assert.equal(toHex(writer.toBytes()), EQUIP_HEX);
  assert.equal(writer.length, itemSlotBytes(sampleEquip(), 1));
  assert.deepEqual(readItemSlot(new PacketReader(writer.toBytes()), 1), sampleEquip());
});

test("the category byte is itemId / 1000000, and only the from-stream hint writes it", () => {
  const withByte = new PacketWriter();
  writeItemSlot(withByte, sampleEquip(), ITEM_TYPE_FROM_STREAM);
  assert.equal(withByte.toBytes()[0], ITEM_CATEGORY.equip);
  assert.equal(toHex(withByte.toBytes()), "01" + EQUIP_HEX);

  // 0x0B op 0 is the only caller that passes 0, and there the byte picks the class (sub_45E6A0).
  const potion = new PacketWriter();
  writeItemSlot(potion, nonEquipSlot(2000001, 50), ITEM_TYPE_FROM_STREAM);
  assert.equal(potion.toBytes()[0], ITEM_CATEGORY.consume);
  assert.equal(toHex(potion.toBytes()), "02" + "81841e00" + "00" + "3200");
  const read = readItemSlot(new PacketReader(potion.toBytes()));
  assert.equal(read.kind, "nonequip");
  assert.deepEqual(read, nonEquipSlot(2000001, 50));
});

test("a non-equip is itemId + flag + a u16 quantity", () => {
  const writer = new PacketWriter();
  writeItemSlot(writer, nonEquipSlot(0x00200001, 0x0403), 2);
  assert.equal(toHex(writer.toBytes()), "01002000" + "00" + "0304");
  assert.equal(writer.length, itemSlotBytes(nonEquipSlot(0x00200001, 3), 2));
});

test("a non-equip slot cannot be written where the client expects an equip", () => {
  const writer = new PacketWriter();
  assert.throws(() => writeItemSlot(writer, nonEquipSlot(2000001, 1), 1), /type hint 1/);
});

test("the cash block appears only when it is present, and round-trips as a u64", () => {
  const cash = { sn: 0x0102030405060708n, unknown18: 0x0a0b, unknown1A: 0x1112131415161718n };
  const item = equipSlot(0x0013de30, { cash });
  const writer = new PacketWriter();
  writeItemSlot(writer, item, 1);
  assert.equal(
    toHex(writer.toBytes()),
    "30de1300" +
      "01" /* flag */ +
      "0807060504030201" /* sn, little-endian */ +
      "0b0a" +
      "1817161514131211" +
      "00" /* ruc */ +
      "00" /* cuc */ +
      "00".repeat(30),
  );
  assert.deepEqual(readItemSlot(new PacketReader(writer.toBytes()), 1), item);

  // The client's flag is derived (`*(u64*)(obj + 0x10) != 0`), so a zero sn cannot be written.
  assert.throws(() => writeItemSlot(new PacketWriter(), equipSlot(1, { cash: { ...cash, sn: 0n } }), 1), RangeError);
});

test("the item block is worn + worn cash + equip tab + records, in sub_45FCC0's order", () => {
  const items = emptyCharacterItems();
  items.worn.set(3, sampleEquip());
  items.wornCash.set(1, equipSlot(0x0013de31));
  items.inventories[0] = {
    capacity: 24,
    items: new Map([[1, sampleEquip()]]),
    records: [{ key: 0x0a0b0c0d, value: 0x01020304 }],
  };

  const data = characterDataOf({ id: 1, name: "Hero" }, items);
  assert.equal(data.flags, CHAR_FLAG_STATS | CHAR_FLAG_ITEMS);

  const writer = new PacketWriter();
  writeCharacterData(writer, data);
  const hex = toHex(writer.toBytes());
  assert.equal(writer.length, 1 + CHARACTER_STATS_BYTES + 39 + 39 + 49);
  assert.equal(
    hex.slice(2 * (1 + CHARACTER_STATS_BYTES)),
    "03" + EQUIP_HEX + "00" /* worn slot 3 */
      + "01" + "31de1300" + "00" + "00" + "00" + "00".repeat(30) + "00" /* worn cash slot 1 */
      + "18" /* equip tab capacity 24 */
      + "01" + EQUIP_HEX + "00" /* equip tab slot 1 */
      + "01" /* one record */
      + "0d0c0b0a" + "04030201",
  );
});

test("an item block round-trips, including the per-inventory 8-byte records", () => {
  const items = emptyCharacterItems();
  items.worn.set(1, sampleEquip());
  items.inventories[0] = { capacity: 24, items: new Map([[1, sampleEquip()]]), records: [{ key: 1, value: 2 }] };
  items.inventories[1] = { capacity: 30, items: new Map([[7, nonEquipSlot(2000001, 3)]]), records: [] };
  items.inventories[3] = { capacity: 48, items: new Map(), records: [{ key: 0xdeadbeef, value: 0xffffffff }] };
  items.map32 = [{ key: 0x11111111, value: 0x22222222 }];
  items.mapString = [{ key: "quest", value: "clear" }];

  const data = characterDataOf({ id: 42, name: "RoundTrip" }, items);
  assert.equal(
    data.flags,
    CHAR_FLAG_STATS | CHAR_FLAG_ITEMS | CHAR_FLAG_INVENTORY_2 | CHAR_FLAG_INVENTORY_4 | CHAR_FLAG_MAP32 | CHAR_FLAG_MAPSTR,
  );

  const writer = new PacketWriter();
  writeCharacterData(writer, data);
  const back = readCharacterData(new PacketReader(writer.toBytes()));
  assert.deepEqual(back.stats, { ...zeroStats(), id: 42, name: "RoundTrip" });
  assert.deepEqual(back.items, items);
  assert.equal(back.flags, data.flags);
});

test("slot numbers the client cannot address are refused instead of truncated", () => {
  const items = emptyCharacterItems();
  items.worn.set(15, sampleEquip()); // the client loops 1..14 (sub_45F610)
  assert.throws(() => writeCharacterData(new PacketWriter(), characterDataOf({ id: 1, name: "X" }, items)), /1\.\.14/);

  items.worn.clear();
  items.inventories[0] = { capacity: 4, items: new Map([[9, sampleEquip()]]), records: [] };
  assert.throws(
    () => writeCharacterData(new PacketWriter(), characterDataOf({ id: 1, name: "X" }, items)),
    /declared inventory capacity 4/,
  );

  // capacity 0 means "not stated" and follows the items, which is what an item model without
  // inventory sizes wants.
  items.inventories[0] = { capacity: 0, items: new Map([[9, sampleEquip()]]), records: [] };
  const writer = new PacketWriter();
  writeCharacterData(writer, characterDataOf({ id: 1, name: "X" }, items));
  const bytes = writer.toBytes();
  assert.equal(bytes[1 + CHARACTER_STATS_BYTES + 1 + 1], 9); // flags, worn(empty)=1, wornCash(empty)=1
});
