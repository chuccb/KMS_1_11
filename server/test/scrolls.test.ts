/**
 * `204` upgrade scrolls (`game/scrolls.ts`).
 *
 * The pure half (category pairing, the slot/stat application) runs without `Data.wz`; the archive
 * half reads the real `Item/Consume/0204.img` and is skipped when the checkout has no `Data.wz`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import type { ItemSlotEquip } from "../src/protocol/itemslot.ts";
import {
  SCROLL_INC_TO_STAT,
  applyScroll,
  scrollMatchesEquip,
  scrollSpecOf,
  scrollSpecProvider,
} from "../src/game/scrolls.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

/** A fresh `100xxxx` hat: 3 upgrade slots, none used, some base stats. */
function freshHat(): ItemSlotEquip {
  return {
    kind: "equip",
    itemId: 1002000,
    cash: null,
    ruc: 3,
    cuc: 0,
    str: 1,
    dex: 2,
    int: 0,
    luk: 0,
    maxHp: 0,
    maxMp: 0,
    pad: 0,
    mad: 0,
    pdd: 10,
    mdd: 5,
    acc: 0,
    eva: 0,
    craft: 0,
    speed: 0,
    jump: 0,
  };
}

test("scrollMatchesEquip is the client's own family + category gate", () => {
  // The category rule: (scrollId % 10000) / 100 == (equipId / 10000) % 100, both families pinned.
  assert.equal(scrollMatchesEquip(2040000, 1002000), true, "cat 0 투구 scroll on a 100xxxx hat");
  assert.equal(scrollMatchesEquip(2040001, 1002123), true, "same category, any tier");
  assert.equal(scrollMatchesEquip(2043000, 1302000), true, "cat 30 한손검 on a 130xxxx sword");
  assert.equal(scrollMatchesEquip(2044500, 1452000), true, "cat 45 활 on a 145xxxx bow");
  assert.equal(scrollMatchesEquip(2044700, 1472000), true, "cat 47 아대 on a 147xxxx claw");
  // Wrong family on either side.
  assert.equal(scrollMatchesEquip(2000000, 1002000), false, "a potion is not a scroll");
  assert.equal(scrollMatchesEquip(2040000, 2000000), false, "the target must be a 1xxxxxx equip");
  assert.equal(
    scrollMatchesEquip(2040000, 1302000),
    false,
    "hat scroll on a sword: category 0 != 30",
  );
  assert.equal(
    scrollMatchesEquip(2043000, 1002000),
    false,
    "sword scroll on a hat: category 30 != 0",
  );
  // Non-integers are refused, not rounded into a match.
  assert.equal(scrollMatchesEquip(2040000.5, 1002000), false);
});

test("applyScroll always burns one slot; the deltas land only on a success", () => {
  const spec = { success: 60, inc: { pdd: 2, mdd: 1 } as const };
  const win = applyScroll(freshHat(), spec, true);
  assert.equal(win.ruc, 2, "one upgrade slot consumed");
  assert.equal(win.cuc, 1, "one use recorded");
  assert.equal(win.pdd, 12, "10 + incPDD 2");
  assert.equal(win.mdd, 6, "5 + incMDD 1");
  assert.equal(win.str, 1, "a field the scroll does not touch is untouched");
  const lose = applyScroll(freshHat(), spec, false);
  assert.equal(lose.ruc, 2, "a failure still consumes the slot");
  assert.equal(lose.cuc, 1, "a failure still records the use");
  assert.equal(lose.pdd, 10, "but adds no pdd");
  assert.equal(lose.mdd, 5, "and no mdd");
  // The input record is never mutated.
  const input = freshHat();
  applyScroll(input, spec, true);
  assert.equal(input.ruc, 3);
  assert.equal(input.pdd, 10);
});

test("every WZ inc field maps onto a real equip stat", () => {
  const stats = new Set<string>([
    "str",
    "dex",
    "int",
    "luk",
    "maxHp",
    "maxMp",
    "pad",
    "mad",
    "pdd",
    "mdd",
    "acc",
    "eva",
    "craft",
    "speed",
    "jump",
  ]);
  for (const stat of Object.values(SCROLL_INC_TO_STAT)) {
    assert.ok(stats.has(stat), `${stat} is a stat the equip record carries`);
  }
});

test("scrollSpecOf reads the archive's success + inc fields", needsArchive, () => {
  // 02040000 투구 방어력 주문서: 100%, incPDD 1 (verified against the Data.wz dump).
  const hundred = scrollSpecOf(archive!, 2040000);
  assert.ok(hundred);
  assert.equal(hundred.success, 100);
  assert.deepEqual(hundred.inc, { pdd: 1 });
  // 02040001: 60%, incPDD 2 + incMDD 1.
  const sixty = scrollSpecOf(archive!, 2040001);
  assert.ok(sixty);
  assert.equal(sixty.success, 60);
  assert.deepEqual(sixty.inc, { pdd: 2, mdd: 1 });
  // 02040002: 10%, incPDD 5 + incMDD 3 + incACC 1.
  const ten = scrollSpecOf(archive!, 2040002);
  assert.ok(ten);
  assert.equal(ten.success, 10);
  assert.deepEqual(ten.inc, { pdd: 5, mdd: 3, acc: 1 });
  // A weapon scroll: 02043000 한손검 공격력 주문서 carries incPAD.
  const sword = scrollSpecOf(archive!, 2043000);
  assert.ok(sword);
  assert.equal(sword.success, 100);
  assert.ok((sword.inc.pad ?? 0) > 0, "a sword scroll raises pad");
  // Not-a-scroll and no-archive answers, never exceptions.
  assert.equal(scrollSpecOf(archive!, 2000000), undefined, "a potion has no scroll info");
  assert.equal(scrollSpecOf(undefined, 2040000), undefined, "--data off refuses every scroll");
  // The provider form the server takes.
  const provider = scrollSpecProvider(archive!);
  assert.equal(provider(2040000)?.success, 100);
});
