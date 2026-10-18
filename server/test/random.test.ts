/**
 * The client's random generator, pinned to a hand-computed sequence.
 *
 * The expected values below were computed straight from the C formulas in `random.ts`'s header
 * (the same three expressions Hex-Rays prints for `sub_4619F0`), so this test is what keeps the
 * port honest: if someone "cleans up" the bit twiddling, the sequence changes and this fails.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ClientRandom, nextRandom, randomRange, seedState } from "../src/protocol/random.ts";

const A = 0x12345678;
const B = 0x9abcdef0;
const C = 0x0fedcba9;

test("seeding applies the client's three masks (so a zero seed is still a valid state)", () => {
  assert.deepEqual(seedState(A, B, C), [0x12345678, 0x9abcdef0, 0x0fedcbb9]);
  assert.deepEqual(seedState(0, 0, 0), [0x100000, 0x1000, 0x10]);
});

test("the first five values for the golden seed are the formulas' own output", () => {
  const state = seedState(A, B, C);
  assert.deepEqual(
    [nextRandom(state), nextRandom(state), nextRandom(state), nextRandom(state), nextRandom(state)],
    [0x79c46c15, 0xe50a82b0, 0xd52589e9, 0xcc1f09d5, 0xb208ef16],
  );
  assert.deepEqual(state, [0xfdbce37e, 0xef7827d2, 0xa0cc2bba]);
});

test("randomRange is `lo + next() % span`, and span 0 passes the raw value through", () => {
  const state = seedState(A, B, C);
  assert.deepEqual(
    [0, 1, 2, 3].map(() => randomRange(state, 0, 100)),
    [61, 80, 45, 97],
  );
  const raw = seedState(A, B, C);
  const passthrough = randomRange(raw, 7, 0);
  assert.equal(passthrough, 0x79c46c15);
});

test("two generators with the same parts roll alike, and a clone does not disturb the original", () => {
  const first = new ClientRandom(A, B, C);
  const second = new ClientRandom(A, B, C);
  const clone = first.clone();
  const three = [first.next(), first.next(), first.next()];
  assert.deepEqual(three, [second.next(), second.next(), second.next()]);
  // the clone was taken before those rolls, so it repeats them ...
  assert.deepEqual([clone.next(), clone.next(), clone.next()], three);
  // ... while the original has moved on to the same place
  assert.equal(first.range(0, 100), clone.range(0, 100));
  // the third seed part really does change the stream
  assert.notDeepEqual(new ClientRandom(A, B, C + 1).parts(), new ClientRandom(A, B, C).parts());
});
