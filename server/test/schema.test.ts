/**
 * The catalogue in `src/protocol/schema.ts` is only useful if it cannot drift away from the code
 * it describes. These tests are that guarantee: every `codecs` name has to resolve to a real
 * export, every opcode may appear only once per direction/stage, a `skeleton` row may not carry
 * invented fields, and every row that claims a field-level codec must actually be described by the
 * `decode` tool's describers.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PACKETS,
  describePacketSchema,
  findPacket,
  packetsOf,
  resolveCodec,
  schemaJson,
  schemaText,
} from "../src/protocol/schema.ts";
import { FIELD_OPCODE, describeClientFieldPacket, describeFieldPacket } from "../src/protocol/field.ts";
import { describeClientPacket } from "../src/protocol/login.ts";

test("every codec name in the catalogue still resolves to an exported function", () => {
  const broken: string[] = [];
  for (const entry of PACKETS) {
    for (const name of entry.codecs) {
      if (resolveCodec(name) === undefined) broken.push(`${entry.name}: ${name}`);
    }
  }
  assert.deepEqual(broken, []);
  assert.equal(resolveCodec("readClientAttack"), resolveCodec("readClientAttack"));
  assert.equal(resolveCodec("noSuchCodec"), undefined);
});

test("an opcode appears at most once per direction and stage", () => {
  const seen = new Set<string>();
  for (const entry of PACKETS) {
    const key = `${entry.direction}/${entry.stage}/0x${entry.opcode.toString(16)}`;
    assert.equal(seen.has(key), false, `duplicate catalogue row for ${key}`);
    seen.add(key);
    assert.ok(entry.name.length > 0, `row ${key} has no name`);
    assert.ok(entry.evidence.length > 0, `row ${key} has no evidence - and that is the point of the table`);
  }
});

test("the same opcode is allowed in both directions when the client really does that", () => {
  // 0x05 is "create character" towards the server and "here is the created character" back; 0x22 is
  // a GM notice towards the server and a user move back. Both pairs exist in the catalogue.
  assert.ok(findPacket(0x05, "c2s", "login"));
  assert.ok(findPacket(0x05, "s2c", "login"));
  assert.ok(findPacket(0x22, "c2s", "field"));
  assert.ok(findPacket(0x22, "s2c", "field"));
});

test("a skeleton row stays empty instead of listing columns nobody decoded", () => {
  for (const entry of PACKETS) {
    if (entry.status === "skeleton") {
      assert.deepEqual(entry.fields, [], `${entry.name} is a skeleton but claims fields`);
      continue;
    }
    // A decoded packet normally has at least one column. The one exception is a body that *is*
    // empty (`0x19`, whose handler reads nothing at all): `requestRelease` is the only opcode that
    // is allowed to list no fields and be `byte-exact`, because there is nothing to list.
    if (entry.opcode === FIELD_OPCODE.requestRelease && entry.stage === "field") continue;
    assert.ok(entry.fields.length > 0, `${entry.name} is ${entry.status} but lists no fields`);
  }
});

test("every row with a field codec is understood by the decode tool's describer", () => {
  const undescribed: string[] = [];
  for (const entry of PACKETS) {
    if (entry.codecs.length === 0) continue;
    if (entry.stage === "field") {
      const plain = new Uint8Array([entry.opcode]);
      const text = entry.direction === "c2s" ? describeClientFieldPacket(plain) : describeFieldPacket(plain);
      // a one-byte packet is "truncated" - which is still recognition, unlike undefined
      if (text === undefined) undescribed.push(`${entry.name} (0x${entry.opcode.toString(16)})`);
    } else if (entry.direction === "c2s") {
      if (describeClientPacket(new Uint8Array([entry.opcode])) === undefined) {
        undescribed.push(entry.name);
      }
    }
  }
  assert.deepEqual(undescribed, []);
});

test("the catalogue groups and renders deterministically", () => {
  const c2sField = packetsOf("c2s", "field");
  assert.deepEqual(
    c2sField.map((entry) => entry.opcode),
    [...c2sField.map((entry) => entry.opcode)].sort((a, b) => a - b),
  );
  const text = schemaText();
  assert.match(text, /^kms111 protocol catalogue/);
  assert.match(text, /byte-exact, \d+ partial, \d+ skeleton/);
  const json = JSON.parse(schemaJson()) as { packets: unknown[] };
  assert.equal(json.packets.length, PACKETS.length);
  assert.equal(describePacketSchema(PACKETS[0]!), describePacketSchema(PACKETS[0]!));
});
