/**
 * The `goWhisper` gate, read off the real decompilation.
 *
 * FINDINGS §6 item 17 records ADR-059's findings and still calls them untested. The *behaviour*
 * half is in fact covered (`native-chat-gameoptions.test.ts` pins the c2s `0x23`/`0x22` refusal,
 * the s2c `0x1A` reply, `0x1F` public speech, the five-second balloons and the GameOpt wiring).
 * What nothing held was the **original evidence underneath**: that the gate is a field of the
 * CConfig singleton at `+24`, and that the two branches really are "show it" versus "refuse it".
 *
 * So that is what is pinned here, by reading `MapleStory.exe.c` rather than restating the
 * conclusion. If the listing is ever regenerated differently these fail loudly instead of quietly
 * agreeing with a note that has already been wrong once.
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
 * `signature` must run through the `{` (e.g. `"int __thiscall sub_4E7030(int *this)\n{"`) because
 * the listing opens with a block of forward declarations: matching the bare name lands on
 * `...sub_4E7030(int *this);` and the slice then ends at some unrelated function's brace.
 */
function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `${signature.split("\n")[0]} must be defined in the listing`);
  const end = source.indexOf("\n}", at);
  assert.notEqual(end, -1, `${signature.split("\n")[0]} must have a closing brace`);
  return source.slice(at, end);
}

/** The `case N:` block of a switch, up to the next case label or the end of the function. */
function caseBody(body: string, label: number): string {
  const at = body.indexOf(`    case ${label}:`);
  assert.notEqual(at, -1, `case ${label} must exist`);
  const rest = body.slice(at + 1);
  const next = rest.search(/\n {4}case \d+:|\n {4}default:/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("goMiniMap is CConfig+20, and sub_4E7030 toggles it", () => {
  // Independent corroboration that the flags are a 4-byte-strided array of `_DWORD` booleans
  // starting at +20, which is what makes "+24 is goWhisper" a layout claim rather than a guess.
  const body = functionBody(listing(), "int __thiscall sub_4E7030(int *this)\n{");
  assert.ok(
    body.includes("*(_DWORD *)(n0xC8 + 20) = *(_DWORD *)(n0xC8 + 20) == 0;"),
    "sub_4E7030 must flip the minimap flag at CConfig+20",
  );
  // The same field is read back as a bool on the next line.
  assert.ok(
    body.includes("*(_DWORD *)(n0xC8 + 20) != 0"),
    "the toggled value must be read back as a boolean",
  );
});

test("n0xC8 is one named global, so +20 and +24 are the same object's fields", () => {
  // IDA names the variable after the constant it inferred; the guessed-type comment fixes which
  // global it is. Both consumers must be reading that one object.
  const source = listing();
  assert.ok(
    source.includes("// 5C1F74: using guessed type int n0xC8;"),
    "the listing must identify n0xC8 as dword_5C1F74",
  );
});

test("goWhisper is CConfig+24, read by sub_472910 case 9", () => {
  // sub_472910 is the s2c field-message dispatcher (0x22 find, 0x23 whisper, 0x1F chat...).
  // Its case 9 is the incoming whisper, and the gate it reads is CConfig+24.
  const body = functionBody(
    listing(),
    "void __thiscall sub_472910(_DWORD *this, _DWORD *ArgList)\n{",
  );
  const whisper = caseBody(body, 9);
  assert.ok(
    whisper.includes("*(_DWORD *)(n0xC8 + 24) != 0"),
    "case 9 must gate the whisper on CConfig+24",
  );
});

test("whisper off sends the c2s 0x23/0x22 refusal; whisper on only logs the line", () => {
  // The two branches of that gate, which is what turns "a config field" into "the refusal path
  // ADR-059 described". Both are pinned so that neither can be quietly swapped.
  const body = functionBody(
    listing(),
    "void __thiscall sub_472910(_DWORD *this, _DWORD *ArgList)\n{",
  );
  const whisper = caseBody(body, 9);

  // Enabled -> the line goes to the chat log (sub_4FB670) and nothing is sent.
  assert.ok(
    whisper.includes("sub_4FB670(::this_3, lpMultiByteStr, 1)"),
    "an enabled whisper must be appended to the chat log",
  );

  // Disabled -> build c2s 0x23 (35) carrying sub-type 0x22 (34) and send it (sub_43AD50).
  assert.ok(whisper.includes("sub_4A1EA0(&v75, 35, nullptr);"), "the refusal is c2s opcode 0x23");
  assert.ok(whisper.includes("*(_BYTE *)(v76 + v77++) = 34;"), "the refusal carries sub-type 0x22");
  assert.ok(whisper.includes("sub_43AD50(this_13, &v75);"), "and it is actually sent");
});

test("the logged whisper is rendered with the original '>>' prefix", () => {
  // The incoming line is formatted before either branch, so both share it. It is pinned because
  // the shape is what the s2c side (0x1A/0x22) is replying to, and a reformat would be a visible
  // behaviour change with nothing else to catch it.
  const body = functionBody(
    listing(),
    "void __thiscall sub_472910(_DWORD *this, _DWORD *ArgList)\n{",
  );
  assert.ok(
    caseBody(body, 9).includes(`"%s>> %s"`),
    "an incoming whisper must render as '<name>>> <text>'",
  );
});
