/**
 * Who stamps the moment of death: `CField + 680`, and the chain that writes it.
 *
 * FINDINGS §6 item 18(a) asks which code declares "the player is now dead", and says the only
 * writer found was an entry hook in `sub_509AF0`, recommending a search downward from the callers
 * of `sub_5084C0`. This file closes it: `sub_5084C0` is not merely the search hint, it **is** the
 * caller - it is the action-byte setter, and it stamps the time itself when the action becomes
 * 18/19.
 *
 * It also pins a trap that produced a wrong conclusion the first time through, and is recorded
 * here so it cannot be repeated silently:
 *
 *   `+680` looks like it has NO readers if you grep for the literal `680`. It does not - the
 *   reader is `sub_558CF0`, which takes `_DWORD *this` and writes `this + 170`, i.e. byte offset
 *   170 * 4 = 680. IDA prints the same field three different ways depending on the parameter type:
 *   `n3000 + 680` (int), `this + 680` (int), `this + 170` (_DWORD*). Only the first two match a
 *   naive grep. The last test here asserts the type equivalence explicitly.
 *
 * Everything below reads `MapleStory.exe.c`, so a regenerated listing fails loudly instead of
 * quietly agreeing with a note that was already incomplete once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LISTING = "MapleStory.exe.c";

function listing(): string {
  return readFileSync(LISTING, "latin1");
}

/**
 * One decompiled function, from its definition to its closing brace at column 0.
 *
 * `signature` must run through the `{`: the listing opens with a block of forward declarations and
 * a bare-name match lands on `...sub_5084C0(int *this, int n35, int a3);` instead.
 */
function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `${signature.split("\n")[0]} must be defined in the listing`);
  const end = source.indexOf("\n}", at);
  assert.notEqual(end, -1, `${signature.split("\n")[0]} must have a closing brace`);
  return source.slice(at, end);
}

test("sub_5084C0 is the action-byte setter, and 18/19 is the dead pair", () => {
  const body = functionBody(listing(), "int __thiscall sub_5084C0(int *this, int n35, int a3)\n{");
  // The action byte lives at +45 and is only rewritten when it actually changes (or is forced).
  assert.ok(body.includes("*(this + 45) = n35;"), "the action byte must be written to +45");
  assert.ok(
    body.includes("if ( a3 != 0 || n35 != *(this + 45) )"),
    "an unchanged action must not be rewritten unless forced",
  );
  // `(n35 & 0xFFFFFFFE) == 0x12` is true for 0x12 and 0x13 - dead facing either way. It appears
  // twice: once for the vtable hook, once for the timestamp.
  const deadTests = body.split("(n35 & 0xFFFFFFFE) == 0x12").length - 1;
  assert.equal(deadTests, 2, "the dead action must be tested twice (hook, then timestamp)");
});

test("sub_5084C0 stamps the death time itself: it calls sub_509AF0 from the dead branch", () => {
  // This is the answer to 18(a). The note suggested searching *down from* sub_5084C0's callers;
  // sub_5084C0 calls the stamper directly, so the search was one step shorter than it looked.
  const body = functionBody(listing(), "int __thiscall sub_5084C0(int *this, int n35, int a3)\n{");
  assert.ok(
    body.includes("sub_509AF0(this, (void **)(a3 == 0));"),
    "the dead branch must call sub_509AF0, passing 'was this not forced' as the second argument",
  );
});

test("sub_509AF0 latches CField+680 to the current tick, once, for the local user", () => {
  const body = functionBody(listing(), "int __thiscall sub_509AF0(int *this, void **a2)\n{");
  // Three guards and one store, in one statement.
  assert.ok(
    body.includes("if ( (int *)this_6 == this && a2 != nullptr && *(_DWORD *)(n3000 + 680) == 0 )"),
    "the stamp must be limited to the local user, a non-forced change, and an unstamped field",
  );
  assert.ok(
    body.includes("*(_DWORD *)(n3000 + 680) = *(_DWORD *)(n3000_0 + 20);"),
    "the stamp must copy the current tick",
  );
});

test("sub_558CF0 is the reader: 2200 ms after the stamp, the revive dialog opens", () => {
  const body = functionBody(listing(), "char *__thiscall sub_558CF0(_DWORD *this)\n{");
  // `this` is `_DWORD *`, so `this + 170` is byte offset 680 - see the last test in this file.
  assert.ok(body.includes("this_1 = (char *)*(this + 170);"), "it must read the stamp");
  assert.ok(
    body.includes("if ( this_1 != nullptr && this_2 - this_1 > 2200 )"),
    "it must compare the elapsed time against 2200 ms",
  );
  // The dialog: a 0x5C-byte object off dword_5C25F0, constructed by sub_4E94E0.
  assert.ok(body.includes("sub_403350(&dword_5C25F0, 0x5Cu)"), "the revive dialog allocation");
  assert.ok(body.includes("sub_4E94E0(this_1)"), "the revive dialog constructor");
  // And the stamp is consumed, so the dialog opens once.
  assert.ok(body.includes("*(this + 170) = 0;"), "the stamp must be cleared once consumed");
});

test("the tick both sides use is n3000_0[5], a millisecond counter", () => {
  // The stamper copies *(n3000_0 + 20) and the reader compares against `this_2`; `this_2` is set
  // from n3000_0[5] at the top of sub_558CF0. *(n3000_0 + 20) and n3000_0[5] are the same DWORD.
  const reader = functionBody(listing(), "char *__thiscall sub_558CF0(_DWORD *this)\n{");
  assert.ok(reader.includes("this_3 = n3000_0[5];"), "the reader's 'now' must be n3000_0[5]");
  assert.ok(reader.includes("this_2 = (char *)this_3;"), "and it must be carried in this_2");
  // Independent evidence that it is milliseconds: elsewhere the same counter is compared to 300.
  assert.ok(
    listing().includes("if ( n3000_0[5] - *(this + 19) > 300 )"),
    "n3000_0[5] must be a millisecond tick (compared against 300 elsewhere)",
  );
});

test("+170 on a _DWORD* is +680 bytes - the three spellings are ONE field", () => {
  // The trap that produced a wrong 'no readers' conclusion. Asserted so the equivalence is not
  // re-derived by hand every time.
  assert.equal(170 * 4, 680, "a _DWORD* index of 170 is byte offset 680");

  const source = listing();
  // sub_558CF0 takes _DWORD *this and is called with the n3000 singleton, so its `this + 170`
  // really is CField+680 and not some other object's field.
  assert.ok(
    source.includes("char *__thiscall sub_558CF0(_DWORD *this)"),
    "sub_558CF0 must take a _DWORD* for the +170 spelling to mean byte 680",
  );
  assert.ok(source.includes("sub_558CF0(n3000);"), "and it must be called with n3000");

  // A near-miss worth keeping out: sub_4FFE30 is the CUIToolTip constructor and its `this + 170`
  // is CUIToolTip+680, a different object entirely. Pinned so it cannot be mistaken for this one.
  const tooltip = functionBody(listing(), "int *__thiscall sub_4FFE30(int *this)\n{");
  assert.ok(
    tooltip.includes("&CUIToolTip::"),
    "sub_4FFE30's +170 belongs to CUIToolTip, not CField - do not conflate them",
  );
});

test("every CField+680 site: one stamper, one consumer, two clears", () => {
  const source = listing();
  // The two literal-680 sites and the _DWORD*-170 sites, by function.
  assert.ok(
    source.includes("*(_DWORD *)(n3000 + 680) = *(_DWORD *)(n3000_0 + 20);"),
    "sub_509AF0 stamps it",
  );
  const init = functionBody(source, "LPCCH __thiscall sub_558FD0(int this)\n{");
  assert.ok(init.includes("*(_DWORD *)(this + 680) = 0;"), "sub_558FD0 clears it on field init");
  const teardown = functionBody(source, "_DWORD *__thiscall sub_559330(_DWORD *this)\n{");
  assert.ok(teardown.includes("*(this + 170) = 0;"), "sub_559330 clears it on teardown");
  assert.ok(source.includes("sub_559330((_DWORD *)n3000);"), "and it runs on n3000");
});
