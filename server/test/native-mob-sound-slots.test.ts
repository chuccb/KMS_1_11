/**
 * The two `u16` in the mob spawn packet `0x2F` that §4.12.1 left as "只拿去查表" (items 4 and 5).
 *
 * They are **sound-set ids**, looked up in one global map, and the result builds the mob's two
 * positioned sound emitters. Everything here is read from the raw disassembly, for two reasons:
 *
 *   - The decompiler gives these two lookups a mysterious `n2 = 0` / `n2 = 1` argument that does not
 *     exist. It is the **SEH try-level** (`var_4`), which IDA promotes to a variable and then prints
 *     as if it were passed somewhere. `sub_489800` takes three parameters, not four.
 *   - The two values are read as `u16` but **used as `s16`** (`movsx`). The decompiler types them
 *     `__int16` in one place and `unsigned __int16` in another, so the wire width and the value's
 *     signedness get blurred together.
 *
 * What is established below, and what is not:
 *
 *   - **Established**: both fields are sign-extended; both are looked up in the *same* global map
 *     (`this_7 + 0x64`); the map node's value pointer is at `[result + 4]`; the *second* value's
 *     `+0x20` field is what reaches `sub_53D310`, for **both** emitters; there are exactly two
 *     emitters, held at `mob + 26` and `mob + 27`; the emitter family carries a 3-5 minute random
 *     idle timer; and `this_7` is the audio listener (its own position at `+4` is copied into every
 *     emitter).
 *   - **NOT established**: what the ids *name*. The map is read in exactly two places and never
 *     written anywhere in `.text`, so the key space cannot be recovered from this binary. Anything
 *     beyond "a sound-set id" would be invention, and is deliberately not asserted here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LISTING = fileURLToPath(new URL("../../MapleStory.exe.lst", import.meta.url));
const DECOMPILED = fileURLToPath(new URL("../../MapleStory.exe.c", import.meta.url));

interface Insn {
  va: number;
  text: string;
}

/** One instruction per `.text:` line, with the byte column and `;` comments stripped. */
function instructions(from: number, to: number): Insn[] {
  const out: Insn[] = [];
  for (const line of readFileSync(LISTING, "latin1").split("\n")) {
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

const SUB_484ED0 = [0x484ed0, 0x485330] as const; // CMob::Init

function indexOf(insns: Insn[], pattern: RegExp, from = 0): number {
  const at = insns.findIndex((insn, i) => i >= from && pattern.test(insn.text));
  return at;
}

/** Every `n`th match, in order. */
function allOf(insns: Insn[], pattern: RegExp): number[] {
  return insns.flatMap((insn, i) => (pattern.test(insn.text) ? [i] : []));
}

test("both fields are read as u16 and then sign-extended before the lookup", () => {
  // The wire width is unsigned, but a `movsx` follows each read: a negative id is meaningful, so a
  // value of 0xFFFF is -1 and not 65535. This is the one detail the decompiled table gets wrong.
  const insns = instructions(SUB_484ED0[0], SUB_484ED0[1]);
  // x and y are read with `sub_45DC80` too, so the two we want are the ones *after* the `u8` facing.
  const facing = indexOf(insns, /^call\s+sub_45DC40$/);
  assert.notEqual(facing, -1, "the facing byte must be read with sub_45DC40");
  const reads = allOf(insns, /^call\s+sub_45DC80$/).filter((at) => at > facing);
  assert.equal(reads.length, 2, `exactly two u16 follow the facing byte, got ${reads.length}`);
  // x and y are sign-extended elsewhere in the function, so scope to the two ids.
  const extensions = allOf(insns, /^movsx\s+\w+,\s+word ptr/).filter((at) => at > facing);
  assert.equal(
    extensions.length,
    2,
    `each u16 must be sign-extended exactly once, got ${extensions.length}`,
  );
  // The real order is worth pinning because it is not the obvious one: the packet is drained
  // first (both u16 back to back), and only then is each value sign-extended and looked up -
  // A entirely before B. So a malformed packet fails on the *second* read, not at first use.
  const lookups = allOf(insns, /^call\s+sub_489800$/);
  assert.ok(reads[0] < reads[1], "the two ids must be read in packet order");
  assert.ok(
    reads[1] < extensions[0],
    "both ids must be drained from the packet before either is used",
  );
  assert.ok(extensions[0] < lookups[0], "the first id must be sign-extended before its lookup");
  assert.ok(
    lookups[0] < extensions[1],
    "the first id's lookup must finish before the second id is touched",
  );
  assert.ok(extensions[1] < lookups[1], "the second id must be sign-extended before its lookup");
});

test("both lookups hit the same global map, this_7 + 0x64", () => {
  const insns = instructions(SUB_484ED0[0], SUB_484ED0[1]);
  const lookups = allOf(insns, /^call\s+sub_489800$/);
  assert.equal(lookups.length, 2, `expected two map lookups, got ${lookups.length}`);
  for (const at of lookups) {
    // `mov eax, this_7` then `lea ecx, [eax+64h]`: the map is a singleton's field, and it is one
    // map for both ids - not two maps that happen to be looked up the same way.
    const window = insns.slice(Math.max(0, at - 12), at).map((insn) => insn.text);
    assert.ok(
      window.some((t) => /^mov eax, this_7$/.test(t)),
      `the lookup must load the singleton, got: ${window.join(" | ")}`,
    );
    assert.ok(
      window.some((t) => /^lea ecx, \[eax\+64h\]$/.test(t)),
      `the lookup must target this_7 + 0x64, got: ${window.join(" | ")}`,
    );
  }
});

test("sub_489800 has three parameters - the decompiler's n2 is the SEH try-level", () => {
  const insns = instructions(SUB_484ED0[0], SUB_484ED0[1]);
  const lookups = allOf(insns, /^call\s+sub_489800$/);
  // Three pushes, not four: the fourth "argument" in the decompilation is `var_4`, which is the
  // function's SEH state slot. It is written to 0/-1 around the calls and never pushed.
  for (const at of lookups) {
    const before = insns.slice(Math.max(0, at - 6), at).map((insn) => insn.text);
    // Two pushes plus `this` in ecx: `sub_489800` is __thiscall, so the third parameter is a
    // register and never appears on the stack.
    assert.equal(
      before.filter((t) => /^push /.test(t)).length,
      2,
      `sub_489800 takes this + 2 arguments: ${before.join(" | ")}`,
    );
    assert.ok(
      before.some((t) => /^lea ecx, \[eax\+64h\]$/.test(t)),
      `the third parameter must be \`this\` in ecx: ${before.join(" | ")}`,
    );
  }
  // …and `var_4` really is the SEH state: it is set to -1 after each lookup, which is the
  // "outside any try block" marker.
  const resets = allOf(insns, /^mov \[\w+\+\w+\+var_4\], 0FFFFFFFFh$/);
  assert.ok(resets.length >= 2, `the SEH state must be reset after each lookup: ${resets.length}`);
  assert.ok(
    resets.some((at) => at > lookups[0] && at < lookups[1]),
    "reset after the first lookup",
  );
  assert.ok(
    resets.some((at) => at > lookups[1]),
    "reset after the second lookup",
  );
});

test("the map's value pointer is [node + 4], and a miss yields a null value", () => {
  const insns = instructions(SUB_484ED0[0], SUB_484ED0[1]);
  const lookups = allOf(insns, /^call\s+sub_489800$/);
  for (const at of lookups) {
    // The read is well past the `jz`/`jmp` pair that picks the hit or miss path.
    const after = insns.slice(at + 1, at + 24).map((insn) => insn.text);
    // `jz` on a null return falls into `mov dword ptr [..pvarg+4], ebp` - `ebp` is 0 here, so a
    // miss is a *null value* rather than an error, and the code carries on either way.
    assert.ok(
      after.some((t) => /^mov \w+, \[\w+\+4\]$/.test(t)),
      `the value pointer must be read at +4: ${after.join(" | ")}`,
    );
  }
});

test("only the second id's +0x20 field reaches sub_53D310 - and it feeds both emitters", () => {
  const insns = instructions(SUB_484ED0[0], SUB_484ED0[1]);
  // `test ebp, ebp / jz / mov ebx, [ebp+20h] / xor ebx, ebx` is the `v18 = B ? *(B + 32) : 0`.
  const at = indexOf(insns, /^mov ebx, \[ebp\+20h\]$/);
  assert.notEqual(at, -1, "the second value's +0x20 field must be taken");
  assert.ok(
    /^xor ebx, ebx$/.test(insns[at + 2]?.text ?? ""),
    "a missing entry must degrade to 0 and not skip the emitters",
  );
  const calls = allOf(insns, /^call\s+sub_53D310$/);
  assert.equal(calls.length, 2, `exactly two emitters are configured, got ${calls.length}`);
  assert.ok(calls[0] > at && calls[1] > at, "both emitters must be built after v18 is known");
});

test("the two emitters are stored on the mob at +26 and +27", () => {
  const insns = instructions(SUB_484ED0[0], SUB_484ED0[1]);
  // `sub_48AA50` is the attach: QueryInterface for a fixed IID, release the old, store the new.
  const attaches = allOf(insns, /^call\s+sub_48AA50$/);
  assert.equal(attaches.length, 2, `expected two attach sites, got ${attaches.length}`);
  for (const at of attaches) {
    const window = insns.slice(Math.max(0, at - 6), at).map((insn) => insn.text);
    // IDA prints the byte offset: 26 * 4 = 0x68, 27 * 4 = 0x6C.
    assert.ok(
      window.some((t) => /^lea \w+, \[(esi|edi|ebp)\+(68|6C)h\]$/.test(t)),
      `an emitter must be attached at mob + 26 or + 27, got: ${window.join(" | ")}`,
    );
  }
});

test("sub_53D310 stores the template field at +72 and the looked-up field at +73", () => {
  const source = readFileSync(DECOMPILED, "latin1");
  const at = source.indexOf("int __thiscall sub_53D310(_DWORD *this, int a2, int a3, int a4)\n{");
  assert.notEqual(at, -1, "sub_53D310 must be defined");
  const body = source.slice(at, source.indexOf("\n}", at));
  assert.ok(body.includes("*(this + 72) = a3;"), "arg 3 (the template field) must land at +72");
  assert.ok(body.includes("*(this + 73) = a4;"), "arg 4 (the map field) must land at +73");
  assert.ok(body.includes("sub_537230(this, a2)"), "the emitter must be bound to its owner first");
});

test("the emitter family carries a 3-5 minute random idle timer", () => {
  // `sub_53D390` is the sibling that arms the emitter: 180000 + rand() % 60000 ms.
  const source = readFileSync(DECOMPILED, "latin1");
  const at = source.indexOf("int __thiscall sub_53D390(_DWORD *this, int a2)\n{");
  assert.notEqual(at, -1, "sub_53D390 must be defined");
  const body = source.slice(at, source.indexOf("\n}", at));
  assert.ok(/rand\(\) % 60000/.test(body), "the idle delay must be a 60000 ms spread");
  assert.ok(/\+ 180000/.test(body), "the idle delay must start at 3 minutes");
});

test("this_7 is the audio listener: its own position is copied into every emitter", () => {
  // `sub_537230` copies 16 bytes from `this_7 + 4` into the emitter's `+33`. That is the one hard
  // link between the map's owner and the sound objects, and it is what makes `this_7` the listener
  // rather than merely a container.
  const source = readFileSync(DECOMPILED, "latin1");
  const at = source.indexOf("int __thiscall sub_537230(_DWORD *this, int a2)\n{");
  assert.notEqual(at, -1, "sub_537230 must be defined");
  const body = source.slice(at, source.indexOf("\n}", at));
  assert.ok(/this_7 \+ 4/.test(body), "the listener's position must be read from this_7 + 4");
  assert.ok(/this \+ 33/.test(body), "it must be copied into the emitter at +33");
  // Four dwords, written through `v3`; the third happens to be the one returned from the copy.
  assert.ok(/\*v3 = \*\(_DWORD \*\)\(this_7 \+ 4\);/.test(body), "dword 0");
  for (const index of [1, 3])
    assert.ok(body.includes(`v3[${index}] = v2[${index}];`), `dword ${index}`);
  assert.ok(body.includes("v3[2] = result;"), "dword 2");
});

test("the emitters are positioned and clamped to the viewport", () => {
  const source = readFileSync(DECOMPILED, "latin1");
  const at = source.indexOf(
    "LONG __thiscall sub_537260(int this, int a2, int a3, int a4, int a5, int a6, int a7, int a8)\n{",
  );
  assert.notEqual(at, -1, "sub_537260 must be defined");
  const body = source.slice(at, source.indexOf("\n}", at));
  // x is clamped to [+132, +140] and y to [+136, +144] - the same shape as the camera bounds.
  assert.ok(/a3 >= \*\(_DWORD \*\)\(this \+ 132\)/.test(body), "x must have a lower bound");
  assert.ok(/a3 > v9/.test(body), "x must have an upper bound");
  assert.ok(/a4 >= \*\(_DWORD \*\)\(this \+ 136\)/.test(body), "y must have a lower bound");
  assert.ok(/a4 > \*\(_DWORD \*\)\(this \+ 144\)/.test(body), "y must have an upper bound");
});
