/** Regression SOURCES only: not executed for this delivery, per user instruction. */
import test from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeStatUpdate, readStatUpdate } from "../src/protocol/stat.ts";
import {
  TEMPORARY_STAT_FIELDS,
  type TemporaryStatUpdate,
} from "../src/protocol/temporarystat.ts";
const speed: TemporaryStatUpdate = {
  durationMs: 180000,
  values: { speed: 8 },
  sourceIsSkill: false,
  sourceId: 2002001,
};
test("PE order is duration then mask then s16 values and ONE source pair", () => {
  const bytes = encodeStatUpdate({ diff: {}, temporary: speed });
  assert.equal(
    Buffer.from(bytes).toString("hex"),
    "0d00" + "00000000" + "20bf0200" + "80000000" + "0800" + "00" + "518c1e00",
  );
  const reader = new PacketReader(bytes, 1);
  assert.deepEqual(readStatUpdate(reader), {
    ack: false,
    diff: {},
    temporary: speed,
  });
  assert.equal(reader.remaining, 0);
});
test("all twelve fields are signed and follow ascending bit order", () => {
  const values = Object.fromEntries(
    TEMPORARY_STAT_FIELDS.map((key, i) => [key, -i - 1]),
  );
  const update = { ...speed, values, sourceIsSkill: true, sourceId: 1001003 };
  const bytes = encodeStatUpdate({
    ack: true,
    diff: { hp: 1 },
    temporary: update,
  });
  // 1 opcode + 1 ack + 4 stat mask + 2 HP + 4 duration + 4 temporary mask + 24 values + 5 source.
  assert.equal(bytes.length, 45);
  assert.deepEqual(readStatUpdate(new PacketReader(bytes, 1)), {
    ack: true,
    diff: { hp: 1 },
    temporary: update,
  });
});
test("absent temporary block is still just four zero bytes, preserving old packet shape", () => {
  assert.deepEqual(
    readStatUpdate(new PacketReader(encodeStatUpdate({ diff: {} }), 1)),
    { ack: false, diff: {} },
  );
});
test("invalid duration, overflow, unknown flags and truncated source refuse instead of guessing", () => {
  for (const durationMs of [0, -1, 0.5, 0x80000000])
    assert.throws(
      () => encodeStatUpdate({ diff: {}, temporary: { ...speed, durationMs } }),
      RangeError,
    );
  assert.throws(
    () =>
      encodeStatUpdate({
        diff: {},
        temporary: { ...speed, values: { speed: 32768 } },
      }),
    RangeError,
  );
  const badMask = encodeStatUpdate({ diff: {}, temporary: speed });
  badMask[11] = 0x10; // mask bit 0x1000, outside the twelve native fields
  assert.throws(
    () => readStatUpdate(new PacketReader(badMask, 1)),
    /Unknown temporary-stat mask/,
  );
  const bytes = encodeStatUpdate({ diff: {}, temporary: speed });
  assert.throws(() =>
    readStatUpdate(new PacketReader(bytes.subarray(0, -1), 1)),
  );
});
