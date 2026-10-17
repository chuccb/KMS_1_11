import { describeClientFieldPacket } from "../src/protocol/field.ts";
import { findPacket, resolveCodec } from "../src/protocol/schema.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  ABILITY_MASK,
  ABILITY_REQUEST_OPCODE,
  encodeAbilityRequest,
  readAbilityRequest,
} from "../src/protocol/ability.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { zeroStats } from "../src/protocol/chardata.ts";
import { encodeStatUpdate, readStatUpdate } from "../src/protocol/stat.ts";
import { spendAbility } from "../src/game/ability.ts";
test("sub_55CF60 AP request is opcode 27 and exactly one little-endian u32 mask", () => {
  for (const field of ["str", "dex", "int", "luk", "maxHp", "maxMp"] as const) {
    const packet = encodeAbilityRequest(field);
    assert.equal(packet[0], ABILITY_REQUEST_OPCODE);
    assert.equal(packet.length, 5);
    assert.equal(
      readAbilityRequest(new PacketReader(packet, 1)),
      ABILITY_MASK[field],
    );
  }
  assert.deepEqual([...encodeAbilityRequest("str")], [0x1b, 0x40, 0, 0, 0]);
  assert.throws(() => readAbilityRequest(new PacketReader(new Uint8Array(3))));
  assert.throws(
    () => readAbilityRequest(new PacketReader(new Uint8Array(5))),
    /exactly/,
  );
  assert.throws(() => encodeAbilityRequest("hp" as "str"), /unsupported/);
});
test("four real base-stat allocations each spend one AP and survive the actual 0x0D codec", () => {
  const stats = zeroStats();
  Object.assign(stats, { str: 4, dex: 5, int: 6, luk: 7, hp: 50, ap: 4 });
  for (const field of ["str", "dex", "int", "luk"] as const) {
    const old = stats[field],
      ap = stats.ap,
      diff = spendAbility(stats, ABILITY_MASK[field]);
    assert.equal(stats[field], old + 1);
    assert.equal(stats.ap, ap - 1);
    assert.deepEqual(diff, { [field]: old + 1, ap: ap - 1 });
    const packet = encodeStatUpdate({ ack: true, diff }),
      decoded = readStatUpdate(new PacketReader(packet, 1));
    assert.equal(decoded.ack, true);
    assert.deepEqual(decoded.diff, diff);
  }
  const before = structuredClone(stats);
  assert.deepEqual(spendAbility(stats, ABILITY_MASK.str), {});
  assert.deepEqual(stats, before);
});
test("invalid masks, unavailable points, death, corruption and u8 overflow never consume AP", () => {
  const fixture = () =>
    Object.assign(zeroStats(), {
      str: 4,
      dex: 5,
      int: 6,
      luk: 7,
      hp: 50,
      ap: 3,
    });
  for (const mask of [
    0,
    0xffffffff,
    ABILITY_MASK.str | ABILITY_MASK.dex,
    ABILITY_MASK.maxHp | ABILITY_MASK.maxMp,
  ]) {
    const s = fixture(),
      before = structuredClone(s);
    assert.deepEqual(spendAbility(s, mask), {});
    assert.deepEqual(s, before);
  }
  for (const changes of [
    { ap: 0 },
    { ap: -1 },
    { ap: 1.5 },
    { ap: 32768 },
    { hp: 0 },
    { hp: -1 },
    { str: 255 },
    { str: 999 },
    { str: 3 },
    { str: NaN },
  ]) {
    const s = Object.assign(fixture(), changes),
      before = structuredClone(s);
    assert.deepEqual(spendAbility(s, ABILITY_MASK.str), {});
    assert.deepEqual(s, before);
  }
  const s = Object.assign(fixture(), { str: 254 });
  assert.deepEqual(spendAbility(s, ABILITY_MASK.str), { str: 255, ap: 2 });
  const before = structuredClone(s);
  assert.deepEqual(spendAbility(s, ABILITY_MASK.str), {});
  assert.deepEqual(s, before);
});

test("AP requests are discoverable in capture descriptions and the machine-readable protocol catalogue", () => {
  assert.match(
    describeClientFieldPacket(encodeAbilityRequest("dex"))!,
    /0x1b AP request: dex/,
  );
  const schema = findPacket(ABILITY_REQUEST_OPCODE, "c2s", "field");
  assert.equal(schema?.name, "abilityUp");
  assert.equal(typeof resolveCodec("readAbilityRequest"), "function");
});
