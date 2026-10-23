/**
 * The client's own random number generator, ported exactly.
 *
 * A packet's random seed (`0x16`'s three `u32`s) is handed to `sub_4C7930`, which seeds two client
 * generators (`CWvsApp+632` and `CWvsApp+652`). Located consumers include physical damage
 * (`sub_4C7960(CWvsApp+632, ...)`) and touch damage (`sub_4C8ED0(CWvsApp+652, ...)`). This does
 * **not** make server-selected loot part of the client RNG: `0x43`
 * arrives with the item id or meso amount already chosen, and the audited WZ has no monster drop
 * table. This repo's server loot uses an independent, injectable server RNG (`game/drops.ts`).
 *
 * The CRT `rand()` shows up in one located place: seeding a separate global generator at startup
 * (`sub_461930(&dword_5D2C20, rand(), rand(), rand())`, once). Do not conflate those streams.
 *
 * For a server-side parity check, a known `0x16` seed makes a client stream reproducible only when
 * the consumer and call order are also known and mirrored; it does not imply every random consumer
 * has been located. A damage report can be checked against the specific physical-damage stream and
 * inputs that the server models. None of those client streams is a source for this repo's loot rolls.
 *
 * EVIDENCE (MapleStory.exe.c)
 * --------------------------
 * `sub_48A900` / `sub_461930` (identical bodies) - seeding:
 *
 *   this[0] = a | 0x100000;   this[1] = b | 0x1000;   this[2] = c | 0x10;
 *
 * (the three OR masks keep the state out of the all-zero / low-bit-degenerate cases; they are part
 * of the generator's definition, so a seed of 0 is legal and gives `0x100000, 0x1000, 0x10`).
 *
 * `sub_4619F0` - "advance and return", the generator's only step:
 *
 *   v3 = ((s0 & 0xFFFFFFFE) << 12) ^ ((s0 & 0x7FFC0 ^ (s0 >> 13)) >> 6);
 *   v4 = (16 * (s1 & 0xFFFFFFF8)) ^ (((s1 >> 2) ^ (s1 & 0x3F800000)) >> 23);
 *   v5 = ((s2 & 0xFFFFFFF0) << 17) ^ (((s2 >> 3) ^ (s2 & 0x1FFFFF00)) >> 8);
 *   s = { v3, v4, v5 };                      // the new state is what the step produced
 *   return v3 ^ v4 ^ v5;
 *
 * All arithmetic is on *unsigned* 32-bit values (C `unsigned int`), which is why every write below
 * ends in `>>> 0`.
 *
 * `sub_45D6xx` - the `Random` wrapper the rest of the client calls:
 *
 *   if (span != 0) return lo + sub_4619F0(&state) % span;    // Random(span, lo)
 *   else           return sub_4619F0(&state);                // Random()
 *
 * `test/random.test.ts` pins the whole thing against a hand-computed sequence, so this port cannot
 * drift away from the formulas above unnoticed.
 */

/** The three 32-bit parts the client keeps in memory; `parts[0..2]` are its `this[0..2]`. */
export type RandomState = [number, number, number];

/**
 * Applies the client's seed masks and returns the initial state. `0` is a valid seed part: the
 * masks are what keeps the state away from the degenerate values.
 */
export function seedState(a: number, b: number, c: number): RandomState {
  return [(a | 0x100000) >>> 0, (b | 0x1000) >>> 0, (c | 0x10) >>> 0];
}

/** One step: advances `state` in place and returns the value `sub_4619F0` returns. */
export function nextRandom(state: RandomState): number {
  const [s0, s1, s2] = state;
  const v3 = (((s0 & 0xfffffffe) << 12) ^ (((s0 & 0x7ffc0) ^ (s0 >>> 13)) >>> 6)) >>> 0;
  const v4 = ((16 * (s1 & 0xfffffff8)) ^ (((s1 >>> 2) ^ (s1 & 0x3f800000)) >>> 23)) >>> 0;
  const v5 = (((s2 & 0xfffffff0) << 17) ^ (((s2 >>> 3) ^ (s2 & 0x1fffff00)) >>> 8)) >>> 0;
  state[0] = v3;
  state[1] = v4;
  state[2] = v5;
  return (v3 ^ v4 ^ v5) >>> 0;
}

/** `sub_4619F0`'s `Random(span, lo)` form; span 0 returns the raw next value and still advances state. */
export function randomRange(state: RandomState, lo: number, span: number): number {
  if (span === 0) return nextRandom(state);
  return lo + (nextRandom(state) % span);
}

/**
 * One isolated instance of the client's generator. The client seeds two streams from the same
 * packet parts (`CWvsApp+632` and `+652`): physical damage uses the first and touch damage the
 * second. A server may use this class to reproduce a specifically evidenced client stream; it is
 * not a default or evidence source for server-selected loot. Attack-action selection is not yet
 * synchronized with the browser.
 */
export class ClientRandom {
  readonly state: RandomState;

  constructor(a: number, b: number, c: number) {
    this.state = seedState(a, b, c);
  }

  /** The next 32-bit value, exactly as `sub_4619F0` returns it. */
  next(): number {
    return nextRandom(this.state);
  }

  /** `lo + next() % span`, the client's `Random(span, lo)`. */
  range(lo: number, span: number): number {
    return randomRange(this.state, lo, span);
  }

  /** A copy, so one consumer's rolls cannot advance another's. */
  clone(): ClientRandom {
    return new ClientRandom(this.state[0], this.state[1], this.state[2]);
  }

  /** The state as the client stores it (masks included) - handy in tests and logs. */
  parts(): RandomState {
    return [...this.state];
  }
}
