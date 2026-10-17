/**
 * The client's own random number generator, ported exactly.
 *
 * The 2003 client does **not** use the CRT `rand()` for anything that matters: a packet's random
 * seed (`0x16`'s three `u32`s) is handed to `sub_4C7930`, which seeds two generators with it
 * (`CWvsApp+632` and `CWvsApp+652`), and every roll that a player can see - the damage numbers
 * (`sub_4C7960(CWvsApp+632, ...)`), the attack action (`sub_427F60`), drops, mob behaviour - comes
 * out of that generator. The CRT `rand()` shows up in exactly one place: seeding the *global*
 * generator at startup (`sub_461930(&dword_5D2C20, rand(), rand(), rand())`, once).
 *
 * That matters for a server, because it makes the client's "random" results reproducible:
 *
 *   - the server chooses the seed it sends in `0x16`, so it knows every value the client will roll;
 *   - the damage a client reports in `0x0F` can therefore be *recomputed* instead of trusted
 *     (a 2003 client has no reason to lie, but a rewritten one does - this is the first half of
 *     server-authoritative damage).
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
  return [((a | 0x100000) >>> 0), ((b | 0x1000) >>> 0), ((c | 0x10) >>> 0)];
}

/** One step: advances `state` in place and returns the value `sub_4619F0` returns. */
export function nextRandom(state: RandomState): number {
  const [s0, s1, s2] = state;
  const v3 = ((((s0 & 0xfffffffe) << 12) ^ (((s0 & 0x7ffc0) ^ (s0 >>> 13)) >>> 6)) >>> 0);
  const v4 = (((16 * (s1 & 0xfffffff8)) ^ (((s1 >>> 2) ^ (s1 & 0x3f800000)) >>> 23)) >>> 0);
  const v5 = ((((s2 & 0xfffffff0) << 17) ^ (((s2 >>> 3) ^ (s2 & 0x1fffff00)) >>> 8)) >>> 0);
  state[0] = v3;
  state[1] = v4;
  state[2] = v5;
  return (v3 ^ v4 ^ v5) >>> 0;
}

/** `sub_4619F0`'s `Random(span, lo)` form: never touches the state when `span` is 0. */
export function randomRange(state: RandomState, lo: number, span: number): number {
  if (span === 0) return nextRandom(state);
  return lo + (nextRandom(state) % span);
}

/**
 * A generator with its own state - the server side needs one per field (the client seeds two with
 * the same parts, `CWvsApp+632` and `+652`: physical attack 4C7960 uses the first,
 * touch damage 4C8ED0 the second). Attack-action selection is not yet synchronized with the browser.
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
