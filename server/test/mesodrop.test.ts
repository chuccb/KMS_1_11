/**
 * Golden-source coverage for the meso-drop and recharge-double codecs.
 *
 * Added 2026-10-17 under the then-standing "do not run" instruction; that era is over - the suite
 * runs this file like every other, and it passes. The wire chains are covered elsewhere: the 207
 * shop chain by shops/serve/webclient tests (ADR-101), the `0x1F` drop handler's *field* effects
 * by drop-landing; the drop's wire request path itself remains untested (MESO_RECHARGE.md).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { encodeMesoDrop, readMesoDrop } from "../src/protocol/mesodrop.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { describeClientFieldPacket } from "../src/protocol/field.ts";
import {
  encodeRechargeUnitPrice,
  encodeShopOpen,
  readShopOpen,
  shopRechargeUnitPrice,
} from "../src/protocol/shop.ts";

test("55D5F0 writes opcode31 and exactly one LE u32", () => {
  assert.deepEqual([...encodeMesoDrop(10)], [0x1f, 10, 0, 0, 0]);
  assert.deepEqual([...encodeMesoDrop(50000)], [0x1f, 0x50, 0xc3, 0, 0]);
  assert.equal(readMesoDrop(new PacketReader(encodeMesoDrop(50000), 1)), 50000);
  assert.equal(describeClientFieldPacket(encodeMesoDrop(10)), "0x1f drop 10 mesos");
  for (const amount of [0, 9, 50001, -1, 10.5, NaN, Infinity])
    assert.throws(() => encodeMesoDrop(amount));
  assert.throws(() => readMesoDrop(new PacketReader(new Uint8Array(3))));
  assert.throws(() => readMesoDrop(new PacketReader(new Uint8Array(5))), /exactly/);
});

test("2070001 also carries the recharge double: category division is integer division", () => {
  const rate = encodeRechargeUnitPrice(0.5);
  assert.deepEqual([...rate], [0, 0, 0, 0, 0, 0, 0xe0, 0x3f]);
  const opened = {
    shopId: 12100,
    items: [{ itemId: 2070001, price: 0, maxCount: 500, cash: rate }],
  };
  const packet = encodeShopOpen(opened);
  const result = readShopOpen(new PacketReader(packet, 1));
  assert.deepEqual(result, opened);
  assert.equal(shopRechargeUnitPrice(result.items[0]!), 0.5);
});
