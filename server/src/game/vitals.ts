/**
 * The player's HP and MP as the server keeps them: the one packet that changes them is the client's
 * own report (c2s `0x1C`), and the one packet that shows the change is the `0x0D` diff.
 *
 * EVIDENCE (FINDINGS 4.33)
 * --------------------------------------------------------------------
 * The 2003 client runs the monster AI itself and rolls the damage it takes itself:
 * `sub_4862C0` (the mob's per-frame) -> `sub_487D10` (pick an attack the player is inside) ->
 * `sub_4885D0`; the local user's own per-frame `sub_511C60` finds an overlapping mob and asks
 * `sub_4C8ED0` for the damage, then `sub_5114A0` plays the hurt action and the damage number.
 *
 * What that path does **not** do is write the client's character record: the record's HP pair
 * (`+53`/`+55`) is written by the server's `0x0D` (`sub_45E0D0`), by item use
 * (`sub_518BF0` -> `sub_4BDDC0`), by entering a field (`sub_45D840`, from the `CharacterData`
 * reader) and by the self level-up routine `sub_4C71C0` (which nothing calls). So `sub_5114A0` can
 * only report the delta - `sub_55B870(-damage, 0, 0)`, the c2s `0x1C` - and the HP bar moves when
 * the server answers with the new value. The map's own regeneration (`sub_558950`) uses the same
 * report with positive deltas: HP 10+1000000.hp and MP 3+2000000.mp, scaled by map recovery.
 * The 30ms clock, HP stance/stationary gate and passive ladder interval are in client/recovery.ts.
 *
 * WHAT THE SERVER DECIDES (ADR-021)
 * --------------------------------------------------------------------
 * 1. **A delta, not a value.** The report is a signed change of the record, so nothing here has to
 *    trust an absolute number the client could have made up - but the *amount* is still the client's
 *    arithmetic. There is no server-side damage model to check it against, and inventing one is not
 *    something the binary says (the original 2003 server lived with the same trust).
 * 2. **Clamping is ours.** HP and MP live in `[0, max]`; a hit that would go below zero lands on 0,
 *    and 0 HP is what the client's death waits on (`CField + 680`, FINDINGS 4.32).
 * 3. **A dead character does not regenerate.** While HP is 0 a positive HP delta is dropped: the
 *    revive path is what refills HP (`revive`, ADR-020), and the field's regen tick would otherwise
 *    put a corpse back on its feet one 10-HP tick at a time. MP has no such rule - it is not part of
 *    the death state.
 */
import type { CharacterStats } from "../protocol/chardata.ts";
import type { StatDiff } from "../protocol/stat.ts";

/** What one `0x1C` said. A field is missing when the client did not set its flag bit. */
export interface VitalReport {
  hpDelta?: number;
  mpDelta?: number;
}

/**
 * Apply one report to a character record **in place** and return the `0x0D` diff for it.
 *
 * The return value only carries the fields that actually moved, so a report that changes nothing -
 * a heal while dead, a hit already at 0 - is not worth a packet; the caller sends the diff when it
 * has a field (`GameEntryServer.handleStatReport`), which is the same idiom the exp and shop paths
 * use.
 *
 * The record is mutated because that is the object the server sent in `0x16` and the one the next
 * report is applied to; it is also what a save writes.
 */
export function applyVitalReport(
  stats: CharacterStats,
  report: VitalReport,
  caps: Pick<CharacterStats, "maxHp" | "maxMp"> = stats,
): StatDiff {
  const diff: StatDiff = {};
  if (report.hpDelta !== undefined) {
    // The death rule: at 0 HP the only way up is the revive path, not the regen tick.
    const delta = report.hpDelta > 0 && stats.hp === 0 ? 0 : whole(report.hpDelta);
    const next = clampVital(stats.hp + delta, caps.maxHp);
    if (next !== stats.hp) {
      stats.hp = next;
      diff.hp = next;
    }
  }
  if (report.mpDelta !== undefined) {
    const next = clampVital(stats.mp + whole(report.mpDelta), caps.maxMp);
    if (next !== stats.mp) {
      stats.mp = next;
      diff.mp = next;
    }
  }
  return diff;
}

/** A delta is an `s16` on the wire; a non-finite one is not a report at all. */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** One vital, clamped to `[0, max]` - there is no state below zero and none above the maximum. */
function clampVital(value: number, max: number): number {
  const ceiling = Number.isFinite(max) && max > 0 ? Math.trunc(max) : 0;
  return Math.min(ceiling, Math.max(0, Math.trunc(value)));
}
