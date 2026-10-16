/**
 * Experience and levels: the client's own table, and the server's account of it.
 *
 * EVIDENCE (FINDINGS 4.21.3)
 * --------------------------------------------------------------------
 * The 2003 client does not store an exp table - it *computes* one at startup. `sub_4C7110` (reached
 * through the thunk `sub_4C7100`, which sits in the `.data:005AD228` pointer table) fills the array
 * at `0x5C2134`/`0x5C2138` - two names, one array, the destination pointer is four bytes past the
 * source - for `n` in `1..200`:
 *
 * ```
 * n = 1..5     f(n) = n * (n * n / 2 + 15)              // integer division, `sar` by 1
 * n = 6..50    f(n) = q * (q + 19), q = n * n / 3       // integer division, magic-number /3
 * n = 51..200  f(n) = trunc(f(n - 1) * 1.0548)          // `fild`/`fmul 1.0548`/`_ftol`
 * ```
 *
 * `sub_4C7190(n)` is the accessor: `n > 200` returns `0x7FFFFFFF`, `n < 1` is clamped to 1. The
 * client's own level-up routine `sub_4C71C0` compares the record's exp with `f(level)`, subtracts it
 * and adds one level - i.e. `f(n)` is "exp needed to go from level `n` to `n + 1`".
 *
 * THE NUMBERS ARE THE REAL ONES: `f(1..20)` = 15, 34, 57, 92, 135, 372, 560, 840, 1242, 1716, 2360,
 * 3216, 4200, 5460, 7050, 8840, 11040, 13716, 16680, 20216 - the published 2003 EXP table. All 200
 * values were compared against a fan-site copy of that table; 196 match exactly and the four that do
 * not (levels 59, 144, 162, 198) are single-entry typos that the neighbouring levels contradict (the
 * chain `f(n) = trunc(f(n - 1) * 1.0548)` reproduces the level *after* each of them from our value).
 * The growth factor even shows up in the community's reverse-engineered high-level formula,
 * `49269.68724 * e^(0.053351115 * level)` - `e^0.053351115` = 1.05480.
 *
 * WHAT THE SERVER OWNS
 * --------------------------------------------------------------------
 * Nothing in the binary awards experience: it arrives in the `0x0D` stat diff (FINDINGS 4.21), and
 * the client only *displays* it (the exp bar, "경험치가 상승했습니다" and the level-up effect - all of
 * which the `0x0D` handler does by comparing the new record against the old one). So the exp account
 * is the server's, exactly like the wallet: the amount is the monster's own data
 * (`Mob/<id>.img -> info/exp`, already in `MobTemplate.exp`) and the threshold is the client's table
 * above. Killing is attributed by the field session, which is one connection - a party would have to
 * split the amount, and there is no party system yet.
 *
 * On a level-up the record's HP and MP are refilled **if the character is alive**, which is what the
 * client's own routine does (`sub_4C71C0`: only when `hp > 0`, then `hp = maxHp`, `mp = maxMp`).
 * What the server does *not* do is raise `maxHp`/`maxMp`/`ap`/`sp`: those numbers lived in the
 * original server and are not in the binary, so a freshly levelled character keeps the maxima it had
 * until a stat-growth rule is decided (FINDINGS 4.21.4).
 */
import type { CharacterStats } from "../protocol/chardata.ts";

/** Levels the client's table covers (`sub_4C7110` stops at 200, `sub_4C71C0` clamps there). */
export const EXP_TABLE_MAX_LEVEL = 200;

/** The value `sub_4C7190` returns for a level above 200. */
export const EXP_TABLE_OVERFLOW = 0x7fffffff;

/** The multiplier of the `51..200` branch, exactly as the double in `.rdata:00586DF0`. */
export const EXP_GROWTH_FACTOR = 1.0548;

/** The level's contribution to `n * (n * n / 2 + 15)` (levels 1..5). */
const LOW_LEVEL_LIMIT = 5;
/** Up to here the table is a closed formula; above it the factor takes over. */
const FORMULA_LEVEL_LIMIT = 50;

const table: number[] = [];

/**
 * Exp needed to go from `level` to `level + 1` - the client's `dword_5C2138[level]`.
 *
 * `level > 200` returns `0x7FFFFFFF` and `level < 1` is treated as 1, both as `sub_4C7190` does.
 */
export function expToNextLevel(level: number): number {
  const n = Number.isFinite(level) ? Math.trunc(level) : 1;
  if (n > EXP_TABLE_MAX_LEVEL) return EXP_TABLE_OVERFLOW;
  if (n < 1) return valueAt(1);
  return valueAt(n);
}

function valueAt(level: number): number {
  for (let n = table.length + 1; n <= level; n++) {
    let value: number;
    if (n <= LOW_LEVEL_LIMIT) {
      value = n * (Math.floor((n * n) / 2) + 15);
    } else if (n <= FORMULA_LEVEL_LIMIT) {
      const q = Math.floor((n * n) / 3);
      value = q * (q + 19);
    } else {
      // `_ftol` truncates toward zero; the multiplicand is `f(n - 1)`, i.e. what is already here.
      value = Math.trunc(table[n - 2] * EXP_GROWTH_FACTOR);
    }
    table[n - 1] = value;
  }
  return table[level - 1];
}

/** What one exp gain did to a character record. */
export interface ExpGain {
  /** Exp actually added (never negative; a gain of 0 or less changes nothing but the wallet's call). */
  gained: number;
  /** Levels gained by this award (0 for a plain gain, 1 or more when the bar filled up). */
  levels: number;
  /** `true` when anything in the record changed - i.e. when a `0x0D` has to be sent. */
  changed: boolean;
  /** `true` when the level went up and HP/MP were refilled to their maxima. */
  fullHeal: boolean;
}

/**
 * Add experience to a character record **in place** and roll the level-ups that follow.
 *
 * The record is mutated because that is the object the server sent in `0x16` and the one the next
 * stat diff compares against; the caller snapshots it beforehand (`diffStats`) to get the packet.
 *
 * Level-ups stop at `maxLevel` (the client's table ends at 200); beyond that the exp just piles up
 * inside the wire's `u32`. A level-up refills HP and MP only when the character is alive, exactly as
 * the client's own routine does.
 */
export function awardExp(stats: CharacterStats, amount: number, maxLevel = EXP_TABLE_MAX_LEVEL): ExpGain {
  const gain = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  if (gain <= 0) return { gained: 0, levels: 0, changed: false, fullHeal: false };

  const before = { level: stats.level, exp: stats.exp, hp: stats.hp, mp: stats.mp };
  const limit = Math.min(Math.trunc(maxLevel), EXP_TABLE_MAX_LEVEL);
  let levels = 0;
  let exp = stats.exp + gain;
  while (stats.level < limit && exp >= expToNextLevel(stats.level)) {
    exp -= expToNextLevel(stats.level);
    stats.level += 1;
    levels += 1;
  }
  stats.exp = Math.min(exp, 0xffffffff);
  if (levels > 0 && stats.hp > 0) {
    stats.hp = stats.maxHp;
    stats.mp = stats.maxMp;
  }
  return {
    gained: gain,
    levels,
    changed:
      stats.exp !== before.exp ||
      stats.level !== before.level ||
      stats.hp !== before.hp ||
      stats.mp !== before.mp,
    fullHeal: levels > 0 && stats.hp === stats.maxHp && stats.hp !== before.hp,
  };
}
