/**
 * `sub_4BDDC0` is the **skill cost check**, not the consume-item application path.
 *
 * §4.34.4 attributed it to items: it called `dword_5C2038` the "道具效果表" and read
 * `sub_4BDDC0` as "subtract the table's value from the character's HP/MP". That reading is wrong in
 * a way that matters, because §4.34.4b then concluded from it that "`hpR`/`mpR` rounding can only
 * live in the loader" — a conclusion drawn from the wrong subsystem entirely.
 *
 * What `dword_5C2038` actually is: **CSkillInfo**. What `sub_4BDDC0` actually checks: whether the
 * character can *pay* for a skill (hpCon / mpCon / itemCon). The way to tell the two apart is that
 * the HP check refuses when `hpCon >= hp` but the MP check only refuses when `mpCon > mp`. That
 * asymmetry is "you may not kill yourself with a skill"; it makes no sense for a potion, which
 * would want the opposite. It is asserted here on the raw jump conditions (`jl` vs `jle`).
 *
 * The knock-on consequence, also asserted here: the quickslot entry has a **kind** byte, and kind 1
 * (skill) is applied locally and sends no packet, while kind 2 (item) is the path that sends
 * c2s `0x18`. Since the only field-name vocabulary in the binary is wired to the skill tree and the
 * string `spec` appears in neither encoding, this client has **no** client-side item effect table.
 *
 * What is deliberately NOT asserted: where the item effects are actually applied. If the client
 * does not read `spec`, the answer is "the server does, and the client only receives `0x0D`" — but
 * that is a claim about absence, and this test only pins the absences it can enumerate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LISTING = fileURLToPath(new URL("../../MapleStory.exe.lst", import.meta.url));
const DECOMPILED = fileURLToPath(new URL("../../MapleStory.exe.c", import.meta.url));

const listing = readFileSync(LISTING, "latin1");
const decompiled = readFileSync(DECOMPILED, "latin1");

interface Insn {
  va: number;
  text: string;
}

/** One instruction per `.text:` line, with the byte column and `;` comments stripped. */
function instructions(from: number, to: number): Insn[] {
  const out: Insn[] = [];
  for (const line of listing.split("\n")) {
    if (!line.startsWith(".text:")) continue;
    const m = /^[0-9A-F]{8}\s+(?:[0-9A-F]{2}[ \t]+)+(\S.*)$/.exec(line.slice(6));
    if (m === null) continue;
    const va = parseInt(line.slice(6, 14), 16);
    if (va < from || va >= to) continue;
    const text = m[1].split(";")[0].replace(/\s+/g, " ").trim();
    if (text.length > 0) out.push({ va, text });
  }
  assert.ok(out.length > 0, `no instructions in [${from.toString(16)}, ${to.toString(16)})`);
  return out;
}

function indexOf(insns: Insn[], pattern: RegExp, from = 0): number {
  return insns.findIndex((insn, i) => i >= from && pattern.test(insn.text));
}

function allOf(insns: Insn[], pattern: RegExp): Insn[] {
  return insns.filter((insn) => pattern.test(insn.text));
}

/** The body of a decompiled function, from its definition to the closing `}`. */
function functionBody(header: string): string {
  const at = decompiled.indexOf(`\n${header}\n{`);
  assert.notEqual(at, -1, `function not found: ${header}`);
  const end = decompiled.indexOf("\n}", at);
  assert.notEqual(end, -1, `unterminated function: ${header}`);
  return decompiled.slice(at, end);
}

/** Every byte offset the field parser writes through its 120-byte-strided entry pointer. */
function entryWrites(): Map<number, string> {
  const body = functionBody("int __stdcall sub_4BC590(int pExceptionObject, int ***a2, int a3)");
  const lines = body.split("\n");
  const literal = (sym: string): string | undefined =>
    new RegExp(`^(?:wchar_t|char)\\s+${sym}\\[\\]\\s*=\\s*(?:L?)"(.*?)";`, "m").exec(
      decompiled,
    )?.[1];
  const forms = [
    /p_pvarg_4\[(\d+)\] = /,
    /p_pvarg_3\[(\d+)\] = /,
    /\(\(_DWORD \*\)p_pvarg_3 \+ (\d+)\) = /,
    /\(\(_DWORD \*\)p_pvarg_4 \+ (\d+)\) = /,
  ];
  const out = new Map<number, string>();
  for (let k = 0; k < lines.length; k++) {
    const read =
      /sub_405DF0\(\s*(?:\(int \*\*\)&|&)?\w+\s*,\s*(a[A-Z][A-Za-z0-9_]*|asc_[0-9A-F]+)\s*\)/.exec(
        lines[k],
      );
    if (read === null) continue;
    for (const line of lines.slice(k, k + 45)) {
      const hit = forms.map((f) => f.exec(line)).find((m) => m !== null);
      if (hit === undefined) continue;
      const slot = Number(hit[1]);
      if (!out.has(slot)) out.set(slot, literal(read[1]) ?? "?");
      break;
    }
  }
  return out;
}

const BDDC0 = instructions(0x4bddc0, 0x4bdf80);
const QUICKSLOT = instructions(0x512570, 0x5126f5);

test("dword_5C2038 is the CSkillInfo singleton, not an item effect table", () => {
  // The constructor that publishes it is the CSkillInfo one, and the lookup helper reads the
  // singleton's own hash map: `*(this + 2)` is the bucket array, `*(this + 3)` the bucket count.
  const ctor = functionBody("_DWORD *__thiscall sub_4BA4B0(_DWORD *this)");
  assert.match(ctor, /dword_5C2038 = /, "the ctor must publish the singleton");
  assert.match(ctor, /CSkillInfo::`vftable'/, "the object it builds must be a CSkillInfo");

  const lookup = functionBody("int __thiscall sub_4BAC80(_DWORD *this, int a2)");
  assert.match(
    lookup,
    /\*\(_DWORD \*\*\)\(v3 \+ 4 \* \(__ROR4__\(a2, 5\) % \*\(this \+ 3\)\)\)/,
    "the id must be looked up in the singleton's own ZMap",
  );
});

test("sub_4BDD20 resolves a skill to a level and clamps it to the entry-array length", () => {
  const body = functionBody("int __thiscall sub_4BDD20(_DWORD *this, int a2, int a3, int *a4)");
  // a2 is the character's record: its own map at +386 (buckets) / +390 (count) maps id -> level.
  assert.match(body, /v5 = \*\(_DWORD \*\)\(a2 \+ 386\);/);
  assert.match(body, /__ROR4__\(a3, 5\) % \*\(_DWORD \*\)\(a2 \+ 390\)/);
  // The level indexes the 120-byte entry array held at the SKILLROOT's +72.
  assert.match(body, /result = \*\(_DWORD \*\)\(v4 \+ 72\);/);
  // ... and is clamped: an out-of-range level yields the array length, not a wild pointer.
  assert.match(body, /if \( v6 < result \)\n    return v6;\n  return result;/);
});

test("the cost check and the field parser use the same 120-byte strided entry", () => {
  const cost = functionBody("int __userpurge sub_4BDDC0@<eax>(int n4@<edi>, int a2, int n4_1)");
  assert.match(
    cost,
    /n4_2 = \*\(_DWORD \*\)\(v35 \+ 72\) \+ 120 \* v5 - 120;/,
    "the entry is base + 120 * level - 120 (the level is 1-based)",
  );

  const parse = functionBody("int __stdcall sub_4BC590(int pExceptionObject, int ***a2, int a3)");
  // `int *` arithmetic: 30 ints = 120 bytes, and `&pvarg_1[-7] - 2` is the -120 bias.
  assert.match(
    parse,
    /p_pvarg_4 = \(int \*\)&pvarg_1\[-7\] \+ 30 \* Value_1 - 2;/,
    "the parser must index the same array with the same stride and bias",
  );
  assert.match(parse, /pvarg_1 = \(VARIANTARG \*\)\*a2;/);
});

test("the 120-byte entry layout puts hpCon/mpCon/itemCon/itemConNo at +48/+52/+56/+60", () => {
  const writes = entryWrites();
  assert.equal(writes.get(12), "hpCon");
  assert.equal(writes.get(13), "mpCon");
  assert.equal(writes.get(14), "itemCon");
  assert.equal(writes.get(15), "itemConNo");
  // These are the four bytes `sub_4BDDC0` reads, so the dword indices are also the byte offsets /4.
  for (const dword of [12, 13, 14, 15]) {
    assert.ok(writes.has(dword), `expected a write at dword ${dword}`);
  }
});

test("HP refuses on `cost >= hp` but MP only on `cost > mp` — you may not kill yourself", () => {
  // This is the assertion that separates "cost" from "heal". A potion would want the reverse.
  const gates = allOf(BDDC0, /^cmp eax, ecx$/);
  assert.equal(gates.length, 2, "expected exactly two cost-vs-current comparisons");

  const hpGate = indexOf(BDDC0, /^cmp eax, ecx$/);
  // The current value is the XOR pair at +53/+55, recombined with `xor` right before the compare.
  assert.deepEqual(
    BDDC0.slice(hpGate - 3, hpGate).map((i) => i.text),
    ["movsx ecx, word ptr [ebp+37h]", "movsx edx, word ptr [ebp+35h]", "xor ecx, edx"],
  );
  assert.equal(
    BDDC0[hpGate + 1].text,
    "jl short loc_4BDE5E",
    "HP: continue only when the cost is STRICTLY less than current HP",
  );

  const mpGate = indexOf(BDDC0, /^cmp eax, ecx$/, hpGate + 1);
  assert.deepEqual(
    BDDC0.slice(mpGate - 3, mpGate).map((i) => i.text),
    ["movsx ecx, word ptr [ebp+3Fh]", "movsx edx, word ptr [ebp+3Dh]", "xor ecx, edx"],
  );
  assert.equal(
    BDDC0[mpGate + 1].text,
    "jle short loc_4BDE7A",
    "MP: continue when the cost is less than OR EQUAL to current MP",
  );
});

test("both costs are compared against the character's obfuscated XOR pairs", () => {
  // HP lives at +53 ^ +55 and MP at +61 ^ +63, each read as a sign-extended WORD.
  const pairs = allOf(BDDC0, /^movsx e(cx|dx), word ptr \[ebp\+(3[57]h|3[DF]h)\]$/);
  assert.equal(pairs.length, 4, "expected four movsx over the two XOR pairs");
  const offsets = pairs.map((i) => /\[ebp\+(\w+)\]/.exec(i.text)?.[1]);
  assert.deepEqual(offsets, ["37h", "35h", "3Fh", "3Dh"]);
});

test("the item leg is a hold-requirement: the count at +0x3C gates it, the id picks the tab", () => {
  // `cmp [ebx+3Ch], esi` / `jle` — a required count of 0 skips the whole leg (ebx = the entry).
  const count = indexOf(BDDC0, /^cmp \[ebx\+3Ch\], esi$/);
  assert.ok(count > 0, "expected the itemConNo check at +0x3C");
  assert.equal(BDDC0[count + 1].text, "jle loc_4BDF69", "a count of 0 skips the leg");
  // The id is divided by 1e6 to get the inventory tab, which must be 1..4.
  const tabLo = indexOf(BDDC0, /^cmp edi, esi$/, count);
  assert.ok(tabLo > 0);
  assert.equal(BDDC0[tabLo + 1].text, "jle loc_4BDF5E", "tab <= 0 is refused");
  assert.equal(BDDC0[tabLo + 2].text, "cmp edi, 4");
  assert.equal(BDDC0[tabLo + 3].text, "jg loc_4BDF5E", "tab > 4 is refused");
});

test("quickslot kind 1 is the skill leg (local, no packet) and kind 2 is the item leg (0x18)", () => {
  // `[eax + ecx*8 + 94h]` is the kind byte (byte 148, stride 8). `dec`/`jz` implements == 1.
  const kind = indexOf(QUICKSLOT, /^mov edx, \[eax\+ecx\*8\+94h\]$/);
  assert.ok(kind > 0, "expected the kind byte load at +94h");
  assert.equal(QUICKSLOT[kind + 1].text, "dec edx");
  assert.equal(QUICKSLOT[kind + 2].text, "jz loc_5126DA", "kind 1 -> the skill leg");
  assert.equal(QUICKSLOT[kind + 3].text, "dec edx");
  assert.equal(QUICKSLOT[kind + 4].text, "jnz loc_5126E9", "kind 2 -> the item leg");

  // The skill leg loads the id from +98h (byte 152) and calls sub_518BF0 with it.
  const skill = indexOf(QUICKSLOT, /^mov eax, \[eax\+ecx\*8\+98h\]$/, kind + 5);
  assert.ok(skill > 0, "expected the skill leg to load the id at +98h");
  assert.equal(QUICKSLOT[skill + 1].text, "push eax", "sub_518BF0 takes exactly one argument");
  assert.equal(QUICKSLOT[skill + 3].text, "call sub_518BF0");
  // ... and it returns immediately: no packet is sent on this leg.
  assert.equal(QUICKSLOT[skill + 4].text, "pop edi");
  assert.ok(
    !QUICKSLOT.slice(skill, skill + 8).some((i) => i.text.startsWith("call sub_55B")),
    "the skill leg must not send c2s 0x18",
  );
});

test("sub_4BDDC0 has exactly one caller, and it is inside sub_518BF0", () => {
  // sub_518BF0 spans [0x518BF0, 0x519270); the sole call site must fall inside it.
  const callers = allOf(instructions(0x401000, 0x580000), /^call sub_4BDDC0$/);
  assert.equal(callers.length, 1, `expected one caller, found ${callers.length}`);
  const [site] = callers;
  assert.ok(
    site.va >= 0x518bf0 && site.va < 0x519270,
    `call site ${site.va.toString(16)} is not inside sub_518BF0`,
  );
  // And the skill leg's death/action guard sits at the top of that same function.
  const body = functionBody("int __thiscall sub_518BF0(int *this, int Args)");
  assert.match(
    body,
    /\(\*\(this \+ 45\) & 0xFFFFFFFE\) == 0x12/,
    "sub_518BF0 must refuse while the character is dead",
  );
});

test("no client-side item effect table: the field vocabulary is skill-only", () => {
  // Two textual `int __stdcall sub_4BC590(` lines (a forward declaration and the definition) and
  // exactly one real call, which is the skill loader's.
  assert.equal(decompiled.split("sub_4BC590(").length - 1, 3);
  assert.equal([...decompiled.matchAll(/(?<!int __stdcall )sub_4BC590\(/g)].length, 1);
  // ... and that one call site is the skill loader.
  const loader = functionBody(
    "int __thiscall sub_4BB270(int **this, int pvarg, int pExceptionObject, int a4)",
  );
  assert.match(
    loader,
    /sub_4BC590\(pExceptionObject_2, \(int \*\*\*\)\(v131 \+ 72\), \(int\)i_2\[0\]\)/,
  );

  // The only `Item/` path templates in the whole binary, and none of them names `spec`.
  const templates = [...decompiled.matchAll(/^wchar_t a\w+\[\] = (L"Item\/[^"]*");/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    templates.sort(),
    ['L"Item/%s/%04d.img"', 'L"Item/Book/0500.img/05000000/info/icon"', 'L"Item/Special/0900.img"'],
    "the only Item/ paths are the generic icon one and two hardcoded nodes",
  );
  // ... while the node the parser walks is the skill tree.
  assert.match(
    functionBody("int __stdcall sub_4BC590(int pExceptionObject, int ***a2, int a3)"),
    /aSkill03dImg/,
  );
  // `spec` appears in neither encoding: not as a wide string, and not as a bare ASCII one.
  assert.equal(/wchar_t \w*\[\] = L"spec";/.test(decompiled), false);
  assert.equal(/char \w*\[\] = "spec";/.test(decompiled), false);
});
