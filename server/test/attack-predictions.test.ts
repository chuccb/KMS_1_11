/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { attackPredictions } from "../../client/attack-predictions.ts";
test("target correlation uses original action clock, supports multi-target, ignores duplicate replies", () => {
  let time = 0;
  const ledger = attackPredictions({ now: () => time }),
    mob = { id: 1 };
  const token = ledger.add({
    start: 100,
    targets: new Map([
      [1, { mob, delayMs: 200 }],
      [2, { mob, delayMs: 270 }],
    ]),
  });
  time = 90;
  const first = ledger.consume(token, 1)!;
  assert.equal(first.start, 100);
  assert.deepEqual(first.target, { mob, delayMs: 200 });
  assert.equal(ledger.consume(token, 1), undefined);
  assert.equal(ledger.consume(token, 99), undefined);
  assert.ok(ledger.consume(token, 2));
  assert.equal(ledger.consume(token, 2), undefined);
});
test("field/death clear never reuses a token; bounded old/expired work cannot reappear", () => {
  let time = 0;
  const ledger = attackPredictions({ now: () => time, limit: 2, ttl: 100 });
  const context = { targets: new Map([[1, { id: 1 }]]) };
  const old = ledger.add(context);
  ledger.clear();
  const newer = ledger.add(context);
  assert.notEqual(old, newer);
  assert.equal(ledger.consume(old, 1), undefined);
  ledger.add(context);
  ledger.add(context);
  assert.equal(ledger.consume(newer, 1), undefined);
  const expiring = ledger.add(context);
  time = 100;
  assert.equal(ledger.consume(expiring, 1), undefined);
});

test("prediction resource bounds reject invalid configuration, not a gameplay clamp", () => {
  assert.throws(() => attackPredictions({ limit: 0 }), RangeError);
  assert.throws(() => attackPredictions({ ttl: Infinity }), RangeError);
});
