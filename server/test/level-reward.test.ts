/**
 * The per-level AP/SP grant, and the evidence that it is a policy rather than a recovery.
 *
 * Two different things are pinned here, and they must stay separate:
 *
 *   1. **Behaviour** - a level actually hands out the configured points, and the one subsystem the
 *      points gate (`spendAbility`) stops being dead once it does. Ordinary coverage, mutation
 *      verified below.
 *
 *   2. **The provenance claim** - that no number here is evidence. These tests read the real
 *      decompilation for that, so the offsets are verified against `MapleStory.exe.c` rather than
 *      retyped: if the listing is ever regenerated differently, they say so instead of quietly
 *      passing. Nothing about the 2003 reward is asserted, because there is nothing left to assert
 *      it against - the server is gone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_LEVEL_REWARD, awardExp, expToNextLevel } from "../src/game/exp.ts";
import { zeroStats } from "../src/protocol/chardata.ts";
import { spendAbility } from "../src/game/ability.ts";
import { ABILITY_MASK } from "../src/protocol/ability.ts";

const LISTING = "MapleStory.exe.c";

function listing(): string {
  return readFileSync(LISTING, "latin1");
}

/**
 * One decompiled function, from its definition to its closing brace at column 0.
 *
 * `signature` must run through the `{` (e.g. `"int __fastcall sub_4F5450(int a1)\n{"`) because the
 * listing opens with a block of forward declarations: matching on the bare name would land on
 * `int __fastcall sub_4F5450(int a1);` and then swallow half the file.
 */
function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `${signature.split("\n")[0]} must be defined in the listing`);
  const end = source.indexOf("\n}", at);
  assert.notEqual(end, -1, `${signature.split("\n")[0]} must have a closing brace`);
  return source.slice(at, end);
}

test("the stat serializer fixes AP at +69/+71 and SP at +73/+75", () => {
  // sub_45D2E0 serialises the whole character record in wire order, xoring every obfuscated pair as
  // it goes. It is the authoritative reading of the block layout, so the two fields this ADR is
  // about are pinned by what surrounds them rather than by their offsets alone:
  //   ... hp +53/55, maxHp +57/59, mp +61/63, maxMp +65/67, ap +69/71, sp +73/75, exp u32 +77/81 ...
  // That also corroborates the layout comment in protocol/chardata.ts from the client's own side.
  const body = functionBody(
    listing(),
    "int __thiscall sub_45D2E0(char *this, unsigned int *a2)\n{",
  );

  const order = [53, 57, 61, 65, 69, 73, 77].map((offset) => body.indexOf(`this + ${offset}`));
  assert.ok(
    order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]!)),
    "the block must serialise hp, maxHp, mp, maxMp, ap, sp, exp in that order",
  );

  // The widths tell ap and sp apart from the u32s that follow: both go out through the u16 helper.
  for (const offset of [69, 73]) {
    assert.ok(
      body.includes(`sub_45D640((const void **)a2, *(_WORD *)(this + ${offset})`),
      `+${offset} must be written as a u16`,
    );
  }
  assert.ok(
    body.includes("sub_45D740((const void **)a2, *(_DWORD *)(this + 77)"),
    "exp at +77 must be written as a u32",
  );
});

test("AP and SP have getters and no writer anywhere in the client", () => {
  // The claim that makes the grant a policy: across the entire decompilation the four AP/SP bytes
  // are only ever READ. If this ever fails, the original reward IS recoverable and ADR-142 - and
  // the non-zero default - have to be revisited.
  const source = listing();
  const apGetter = functionBody(source, "int __fastcall sub_4F5450(int a1)\n{");
  const spGetter = functionBody(source, "int __fastcall sub_4EF600(int a1)\n{");
  for (const offset of [69, 71]) {
    assert.ok(apGetter.includes(`a1 + ${offset}`), `AP getter must read +${offset}`);
  }
  for (const offset of [73, 75]) {
    assert.ok(spGetter.includes(`a1 + ${offset}`), `SP getter must read +${offset}`);
  }

  const writes = source
    .split("\n")
    .filter((line) => /\*\(_WORD \*\)\(a1 \+ (69|71|73|75)\)\s*=/.test(line));
  assert.deepEqual(writes, [], "the client must never store into AP/SP outside the decoder");
});

test("the client's only level-up routine never touches AP or SP", () => {
  const body = functionBody(listing(), "int __cdecl sub_4C71C0(int a1, _DWORD *a2)\n{");
  // Sanity: this really is the level-up routine that refills HP from maxHp while alive.
  assert.ok(
    body.includes("(*(_WORD *)(a1 + 53) ^ *(_WORD *)(a1 + 55)) > 0"),
    "sub_4C71C0 should gate the refill on hp > 0 at +53/+55",
  );
  assert.ok(
    body.includes("*(_WORD *)(a1 + 57) ^ *(_WORD *)(a1 + 59)"),
    "sub_4C71C0 should read maxHp from +57/+59",
  );
  for (const offset of [69, 71, 73, 75]) {
    assert.ok(
      !new RegExp(`\\b${offset}\\b`).test(body),
      `sub_4C71C0 must not touch the AP/SP offset +${offset}`,
    );
  }
});

test("a level-up grants the configured AP and SP", () => {
  const stats = zeroStats();
  stats.level = 5;
  stats.exp = 0;
  const before = { ...stats };

  const gain = awardExp(stats, expToNextLevel(5), undefined, {}, { ap: 5, sp: 3 });

  assert.equal(gain.levels, 1);
  assert.equal(gain.apGained, 5);
  assert.equal(gain.spGained, 3);
  assert.equal(stats.ap, 5);
  assert.equal(stats.sp, 3);
  assert.equal(stats.level, before.level + 1);
});

test("several levels at once multiply the reward", () => {
  const stats = zeroStats();
  stats.level = 1;
  stats.exp = 0;
  let amount = 0;
  for (let level = 1; level <= 3; level += 1) amount += expToNextLevel(level);

  const gain = awardExp(stats, amount, undefined, {}, { ap: 5, sp: 3 });

  assert.equal(gain.levels, 3);
  assert.equal(stats.ap, 15);
  assert.equal(stats.sp, 9);
});

test("the grant is on the level, not on the exp", () => {
  // Awarding less than a level's worth is the case a flat "one grant per award" bug gets wrong: the
  // exp has moved but the level has not, so nothing may be handed out. (Mutation-verified against
  // granting `ap` instead of `levels * ap`; note that simply lifting the `levels > 0` guard is an
  // *equivalent* mutant, since `levels * ap` is already 0 - the guard is documentation, not a fix.)
  const stats = zeroStats();
  stats.level = 5;
  stats.exp = 0;

  const gain = awardExp(stats, 1, undefined, {}, { ap: 5, sp: 3 });

  assert.equal(gain.levels, 0);
  assert.equal(gain.apGained, 0);
  assert.equal(gain.spGained, 0);
  assert.equal(stats.ap, 0);
  assert.equal(stats.sp, 0);
});

test("a zero policy grants nothing, and both fields stay u16", () => {
  const zeroed = zeroStats();
  zeroed.level = 1;
  awardExp(zeroed, expToNextLevel(1), undefined, {}, { ap: 0, sp: 0 });
  assert.equal(zeroed.ap, 0);
  assert.equal(zeroed.sp, 0);

  // A character who never spends would otherwise walk the u16 past its ceiling and wrap.
  const hoarder = zeroStats();
  hoarder.level = 1;
  hoarder.ap = 0xffff;
  awardExp(hoarder, expToNextLevel(1), undefined, {}, { ap: 5, sp: 3 });
  assert.equal(hoarder.ap, 0xffff, "AP must saturate at the wire's u16 ceiling, not wrap");
});

test("the default is a declared policy, not a recovered number", () => {
  // Pinned so that changing the default is a visible, deliberate edit here. The whole point of
  // ADR-142 is that this pair is ours and must never be mistaken for the 2003 value.
  assert.deepEqual(DEFAULT_LEVEL_REWARD, { ap: 5, sp: 3 });
});

test("granting AP is what makes spendAbility reachable at all", () => {
  // The other half of the argument for a non-zero default. spendAbility refuses on four counts -
  // no AP, dead, AP above the wire's s16, and the stat itself outside 4..254 - so this fixture has
  // to be alive with a real STR before AP is the only thing left to vary.
  const alive = (ap: number) => {
    const stats = zeroStats();
    stats.hp = 50;
    stats.maxHp = 50;
    stats.str = 12;
    stats.ap = ap;
    return stats;
  };

  const starved = alive(0);
  assert.deepEqual(spendAbility(starved, ABILITY_MASK.str), {}, "no AP, no allocation");
  assert.equal(starved.str, 12, "a refused allocation must not move the stat");

  const fed = alive(DEFAULT_LEVEL_REWARD.ap);
  const spent = spendAbility(fed, ABILITY_MASK.str);
  assert.equal(spent.str, 13, "with the default grant, a level's AP can actually be spent");
  assert.equal(spent.ap, DEFAULT_LEVEL_REWARD.ap - 1, "and exactly one point is consumed");
});
