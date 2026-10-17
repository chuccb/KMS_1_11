/**
 * Using a consumable: what an item in the USE tab does, and what the server does about it.
 *
 * EVIDENCE (FINDINGS 4.34)
 * --------------------------------------------------------------------
 * The client asks and does nothing itself. `sub_462DC0` (a double-click in the inventory window)
 * and `sub_512570` (a quickslot key) both end at a sender and return - the only local effect of
 * using a potion is `sub_526F30(itemId, 4)`, which plays `Sound/Item.img/%08d/Use`. The client's
 * character record is *not* written (FINDINGS 4.33: the record's HP is written by the server's
 * `0x0D`, by entering a field and by the skill path), so **the heal only happens if the server
 * answers**: `0x0B` for the item that left the slot and `0x0D` for the vitals that moved.
 *
 * The three families the client splits its items into, and the sender for each:
 *
 * ```
 * itemId / 10000    sender        opcode   payload
 * 200 | 201 | 202   sub_55B2C0    0x18     u16 slot, u32 itemId      <- this module
 * 203               sub_55B4B0    0x19     s16 slot, u32 itemId      <- this module (a map change)
 * 204 over an equip sub_55B0E0    0x1A     u16 slot, u16 equipSlot   (a scroll; not implemented)
 * ```
 *
 * WHAT IS EVIDENCE, WHAT IS A CHOICE
 * --------------------------------------------------------------------
 * The *effect* is the archive's: `Item/Consume/0XXX.img/<id>/spec` carries `hp`/`mp` (flat) and
 * `hpR`/`mpR` (percent), and the item's own `info/desc` says the same thing in words - 빨간 포션
 * `spec/hp = 50` / "HP를 약 50 회복시킨다", 엘릭서 `hpR = mpR = 50` / "HP를 약 50% 회복시킨다". The
 * percent fields are **not** in the binary: the 2003 server applied them, so the rounding
 * (`Math.floor(max * percent / 100)`) is this server's choice, named here instead of buried.
 *
 * Two more choices, both about a use that cannot do anything:
 *
 * 1. **A use that changes nothing is still answered, but consumable-free.** The client's gate is
 *    "one use request at a time" (`*(this + 6)`, cleared by a non-zero `0x0B` result or `0x0D`
 *    ack), so a request the server ignored would leave the player unable to use *anything* until
 *    some other packet cleared it - which is why `handleUseItem` answers an empty `0x0B` instead of
 *    staying silent (`test/serve.test.ts` pins it). Refusing the *item* is then free: the client's
 *    inventory only ever changes on `0x0B`, so "no `0x0B` entry" is "the potion is still there".
 * 2. **Which uses count as "nothing": no effect at all, or the vitals it would move already at
 *    their maxima** (`hpR`/`mpR` on a full bar, `hp` while dead). Burning a potion for no visible
 *    change is worse than a no-op the player can repeat, and the wire cannot say "refused" -
 *    `0x18`/`0x19` have no result byte (unlike the shop's `0x4B`).
 *
 * Speed/PAD/ACC items use the native temporary-stat tail, with WZ time in milliseconds.
 * Other timed effects stay all-or-nothing refused until their actual mechanics are implemented.
 */
import { recordOf, propertyOf } from "../wz/props.ts";
import { itemImagePath } from "../wz/paths.ts";
import type { WzArchive } from "../wz/archive.ts";
import type { CharacterStats } from "../protocol/chardata.ts";
import type { VitalReport } from "./vitals.ts";

/** The `spec` fields this server knows how to apply, in the order the archive lists them. */
const APPLIED_SPEC_FIELDS = ["hp", "mp", "hpR", "mpR"] as const;

/**
 * The `spec` field that makes an item a *map change* instead of a heal: `02030000` 마을 귀환
 * 주문서 is `moveTo = -1` ("the nearest town") and `02030001`..`02030005` name a town's map id.
 */
const MOVE_TO_FIELD = "moveTo";

/** One item's `spec`, as far as this server reads it. */
export interface ConsumeSpec {
  /** Flat HP restored, `spec/hp`. */
  hp?: number;
  /** Flat MP restored, `spec/mp`. */
  mp?: number;
  /** Percent of `maxHp` restored, `spec/hpR` (엘릭서 50, 파워 엘릭서 100). */
  hpR?: number;
  /** Percent of `maxMp` restored, `spec/mpR`. */
  mpR?: number;
  /** Destination of a 203-family item; `-1` is "the nearest town" (`spec/moveTo`). */
  moveTo?: number;
  /** Implemented timed mechanics: movement, basic physical attack/accuracy and contact evasion/defence. */
  pad?: number;
  acc?: number;
  eva?: number;
  pdd?: number;
  speed?: number;
  time?: number;
  /**
   * `spec` field names that exist on this item but are **not** applied (`mad`, `mdd`, …: the buff line). A use of one of these is refused, so nothing is lost silently.
   */
  unapplied: string[];
}

/**
 * What one item does, read out of `Item/Consume/0XXX.img/<itemId>/spec`.
 *
 * `undefined` for an id the archive does not carry, for an image with no `spec` node at all
 * (a 표창 is a 207 item with none), and for an id outside the four USE-tab families the senders
 * cover - i.e. exactly the items the client would not send `0x18`/`0x19` for either.
 */
export function consumeSpecOf(
  archive: WzArchive | undefined,
  itemId: number,
): ConsumeSpec | undefined {
  if (archive === undefined) return undefined;
  let path: string;
  try {
    path = itemImagePath(itemId);
  } catch {
    // An equip (`Character/<type>/<img>.img`), a cash item, or an id that is not an item at all:
    // `itemImagePath` refuses those, and a refused path is simply an item with no spec. The caller
    // is a packet handler, so this must be an answer and not an exception.
    return undefined;
  }
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  const node = propertyOf(root, String(itemId).padStart(8, "0"));
  if (node === undefined) return undefined;
  const spec = recordOf(node, "spec");
  if (Object.keys(spec).length === 0) return undefined;
  const fields = new Set(Object.keys(spec));
  const read = (name: string): number | undefined => {
    const value = spec[name];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  };
  const applied = new Set<string>([...APPLIED_SPEC_FIELDS, MOVE_TO_FIELD]);
  // Only mechanics with a live consumer are accepted. MAD/MDD/etc still refuse whole items.
  const time = read("time");
  const timed: Pick<ConsumeSpec, "speed" | "pad" | "acc" | "eva" | "pdd" | "time"> = {};
  if (
    time !== undefined &&
    Number.isInteger(time) &&
    time > 0 &&
    time <= 0x7fffffff
  ) {
    for (const key of ["speed", "pad", "acc", "eva", "pdd"] as const) {
      const n = read(key);
      if (
        n !== undefined &&
        Number.isInteger(n) &&
        n !== 0 &&
        n >= -32768 &&
        n <= 32767
      ) {
        timed[key] = n;
        applied.add(key);
      }
    }
    if (Object.keys(timed).length) {
      timed.time = time;
      applied.add("time");
    }
  }
  return {
    hp: read("hp"),
    mp: read("mp"),
    hpR: read("hpR"),
    mpR: read("mpR"),
    moveTo: read(MOVE_TO_FIELD),
    ...timed,
    unapplied: [...fields].filter(
      (name) => !applied.has(name) && typeof spec[name] === "number",
    ),
  };
}

/**
 * The spec reader over one archive, as `GameEntryServerOptions.consumeSpec` wants it.
 *
 * `archive` may be `undefined` (`--data off`), and then no item has a spec and every use is refused -
 * the same "no data, no drops, no shops" rule the rest of the server follows.
 */
export function consumeSpecProvider(
  archive: WzArchive | undefined,
): (itemId: number) => ConsumeSpec | undefined {
  return (itemId) => consumeSpecOf(archive, itemId);
}

/** `true` when the item restores a vital - the two families `0x18` carries. */
export function healsVitals(spec: ConsumeSpec): boolean {
  return (
    spec.hp !== undefined ||
    spec.mp !== undefined ||
    spec.hpR !== undefined ||
    spec.mpR !== undefined
  );
}

/**
 * The vitals one use would restore, as the deltas `0x1C`'s own rules take (`applyVitalReport`).
 *
 * Flat amounts first, then the percentages of the **maxima** - floor, because a percentage that
 * does not divide is a partial point the client's bar cannot show anyway (a choice: the 2003
 * server's rounding is not in the binary).
 */
export function consumeDeltas(
  spec: ConsumeSpec,
  stats: CharacterStats,
): VitalReport {
  const percent = (rate: number | undefined, max: number): number =>
    rate === undefined
      ? 0
      : Math.floor(
          (Math.max(0, Math.trunc(max)) * Math.max(0, Math.trunc(rate))) / 100,
        );
  const hpDelta = (spec.hp ?? 0) + percent(spec.hpR, stats.maxHp);
  const mpDelta = (spec.mp ?? 0) + percent(spec.mpR, stats.maxMp);
  const report: VitalReport = {};
  if (hpDelta !== 0) report.hpDelta = hpDelta;
  if (mpDelta !== 0) report.mpDelta = mpDelta;
  return report;
}
