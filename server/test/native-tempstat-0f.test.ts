/**
 * What s2c `0x0F` is, and what it can never do.
 *
 * FINDINGS §6 item 6 closed the `0x0D`/`0x0F` duration/mask question but left two things open:
 * "`0x0F` 的其他 mode" and "取消效果語意". This file answers both, and it reads the **raw
 * disassembly** rather than the decompilation, because the decompiler reuses `pExceptionObject`,
 * `v7` and `a3` for three different quantities inside these two functions - the `.c` is genuinely
 * misleading here, and reading it alone is what left the question open in the first place.
 *
 * Answers:
 *
 *   - `0x0F` is `sub_55C090`, reached from `sub_55A900` case 15. It calls exactly three things:
 *     `timeGetTime`, `sub_4C5DC0`, `_CxxThrowException`. No stat diff, no icon, no redraw.
 *   - Its header is **two** bytes, not one, and the temporary-stat block is read only when
 *     `A != 0 && B == 0`. So `B` is a mode selector with exactly one implemented value; any other
 *     value is parsed and then discarded (the dispatcher ignores `sub_55C090`'s return, so no
 *     other mode has any effect in this build).
 *   - There is **no cancel opcode**. A buff ends two ways only: `sub_4C65A0` (per frame) clears any
 *     slot whose `now > expiry`, and `sub_4C5DC0` returns 0 without reading anything when
 *     `durationMs == 0`.
 *
 * The structural difference from `0x0D` is the useful part: `0x0F` passes `nullptr` as
 * `sub_4C5DC0`'s out-parameter, so it never receives the mask back, and therefore can never take
 * the `sub_4CBBD0` branch that registers a buff icon. **`0x0F` can change stats but can never show
 * an icon.**
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

/**
 * One instruction per `.text:` line, so tests can assert on order and not just membership.
 *
 * The listing is `VA`, then the encoded bytes, then at least two spaces, then the instruction:
 * `.text:0055C095 C7 47 18 00 00 00 00     mov     dword ptr [edi+18h], 0`. The byte column has
 * to be consumed explicitly or it ends up glued to the front of the mnemonic.
 */
function instructions(from: number, to: number): Insn[] {
  const out: Insn[] = [];
  for (const line of readFileSync(LISTING, "latin1").split("\n")) {
    if (!line.startsWith(".text:")) continue;
    const m = /^[0-9A-F]{8}\s+(?:[0-9A-F]{2}[ \t]+)+(\S.*)$/.exec(line.slice(6));
    if (m === null) continue;
    const va = parseInt(line.slice(6, 14), 16);
    if (va < from || va >= to) continue;
    // Trailing `; comment` is IDA's annotation, not part of the instruction.
    const text = m[1].split(";")[0].replace(/\s+/g, " ").trim();
    if (text.length > 0) out.push({ va, text });
  }
  assert.ok(out.length > 0, `no instructions in [${from.toString(16)}, ${to.toString(16)})`);
  return out;
}

const SUB_55C090 = [0x55c090, 0x55c130] as const; // s2c 0x0F
const SUB_55BEB0 = [0x55beb0, 0x55c090] as const; // s2c 0x0D

function callsOf(range: readonly [number, number]): Set<string> {
  const out = new Set<string>();
  for (const insn of instructions(range[0], range[1])) {
    const m = /\bcall\s+(?:ds:__imp_)?([A-Za-z_][A-Za-z0-9_]*)/.exec(insn.text);
    if (m !== null) out.add(m[1]);
  }
  return out;
}

/** Index of the first instruction whose text matches, or -1. */
function indexOf(insns: Insn[], pattern: RegExp): number {
  return insns.findIndex((insn) => pattern.test(insn.text));
}

test("s2c 0x0F is sub_55C090, dispatched from sub_55A900 case 15", () => {
  const source = readFileSync(DECOMPILED, "latin1");
  const dispatcher = source.slice(source.indexOf("void __thiscall sub_55A900("));
  assert.ok(
    dispatcher.includes("case 13:\n      sub_55BEB0("),
    "case 13 must be 0x0D / sub_55BEB0",
  );
  assert.ok(
    dispatcher.includes("case 15:\n      sub_55C090("),
    "case 15 must be 0x0F / sub_55C090",
  );
});

test("sub_55A900 is only reachable for opcodes 0x0A..0x14", () => {
  // Everything outside that window goes to the field/manager vtable instead, so `0x0F` here is a
  // CUserLocal opcode and not the attack opcode of the same number in the other direction.
  const source = readFileSync(DECOMPILED, "latin1");
  const at = source.indexOf("sub_55A900(n3000,");
  assert.notEqual(at, -1, "the dispatcher must be called with n3000");
  const guard = source.slice(at - 260, at);
  assert.ok(
    /< 0xAu \|\| .* > 0x14u/.test(guard),
    "the call must sit behind the 0x0A..0x14 window guard",
  );
});

test("0x0F touches only the temporary-stat decoder - no stat diff, no icon, no redraw", () => {
  // This is the structural answer: `0x0F` is `0x0D` with everything else stripped out.
  const calls = callsOf(SUB_55C090);
  assert.deepEqual([...calls].sort(), ["_CxxThrowException", "sub_4C5DC0", "timeGetTime"]);

  const zeroD = callsOf(SUB_55BEB0);
  for (const expected of ["sub_45DC40", "sub_45E0D0", "sub_4CBBD0", "sub_55AA80", "sub_4C5DC0"]) {
    assert.ok(zeroD.has(expected), `0x0D must call ${expected}`);
  }
  for (const absent of ["sub_45E0D0", "sub_4CBBD0", "sub_55AA80"]) {
    assert.ok(!calls.has(absent), `0x0F must not call ${absent}`);
  }
});

test("0x0F resets the +0x18/+0x1C stamp pair unconditionally; 0x0D only when ack != 0", () => {
  // `0x0D` reads a varint `ack` first and jumps over the reset when it is zero. `0x0F` has no such
  // guard - the two writes are the first thing it does, before any read or branch.
  const zeroF = instructions(SUB_55C090[0], SUB_55C090[1]);
  const clearF = indexOf(zeroF, /^mov dword ptr \[edi\+18h\], 0$/);
  const stampF = indexOf(zeroF, /^mov \[edi\+1Ch\], eax$/);
  const branchF = indexOf(zeroF, /^j(?:z|nz|b|nb|be|a|l|ge|le|g)/);
  assert.ok(clearF !== -1 && stampF !== -1, "0x0F must write +0x18 and +0x1C");
  assert.ok(clearF < stampF, "0x0F must clear +0x18 before stamping +0x1C");
  assert.ok(branchF !== -1 && stampF < branchF, "0x0F must stamp before any conditional jump");

  const zeroD = instructions(SUB_55BEB0[0], SUB_55BEB0[1]);
  const clearD = indexOf(zeroD, /^mov dword ptr \[esi\+18h\], 0$/);
  const branchD = indexOf(zeroD, /^jz short/);
  assert.ok(clearD !== -1 && branchD !== -1, "0x0D must both guard and write the pair");
  assert.ok(branchD < clearD, "0x0D must skip the reset when ack == 0");
});

test("0x0F's header is two bytes, and the block is read only when A != 0 and B == 0", () => {
  // `test dl,dl / jz` sends A == 0 straight to the epilogue; `test al,al / jnz` does the same for
  // B != 0. `sub_4C5DC0` sits between them, so it is reached in exactly one of the four cases.
  const insns = instructions(SUB_55C090[0], SUB_55C090[1]);
  const testA = indexOf(insns, /^test dl, dl$/);
  const skipA = indexOf(insns, /^jz short/);
  const testB = indexOf(insns, /^test al, al$/);
  const skipB = indexOf(insns, /^jnz short/);
  const decode = indexOf(insns, /^call sub_4C5DC0$/);
  for (const [name, at] of [
    ["test dl,dl", testA],
    ["jz (A==0 -> done)", skipA],
    ["test al,al", testB],
    ["jnz (B!=0 -> done)", skipB],
    ["call sub_4C5DC0", decode],
  ] as const) {
    assert.notEqual(at, -1, `${name} must be present`);
  }
  assert.ok(testA < skipA, "A must be tested before its skip");
  assert.ok(skipA < testB, "B must be read only after A passed");
  assert.ok(testB < skipB, "B must be tested before its skip");
  // `jnz` jumps to the epilogue, so the decoder is its *fall-through*: it runs only when B == 0.
  assert.ok(
    skipB < decode,
    "the decoder must be the fall-through of B's skip, i.e. reached only when B == 0",
  );
  // Both skips land on the same epilogue label, which is what makes the two guards conjunctive.
  const target = (at: number): string => {
    const m = /short (loc_[0-9A-F]+)$/.exec(insns[at].text);
    assert.ok(m !== null, `the skip at ${at} must name its target`);
    return m[1];
  };
  assert.equal(target(skipA), target(skipB), "both skips must land on the same epilogue");
  // Nothing follows the decoder but the epilogue: no icon call, no redraw.
  assert.ok(
    !insns.slice(decode + 1).some((insn) => /^call /.test(insn.text)),
    "the decoder must be the last call in 0x0F",
  );
});

test("0x0F passes nullptr as the out-parameter - so it can never register a buff icon", () => {
  // `sub_4C5DC0(this, pkt, tick, out)` writes `*out = mask`. With `out == nullptr` the mask is
  // thrown away, and the caller's `if (mask != 0) sub_4CBBD0(...)` branch simply does not exist.
  const zeroF = instructions(SUB_55C090[0], SUB_55C090[1]);
  const at = indexOf(zeroF, /^call sub_4C5DC0$/);
  assert.notEqual(at, -1, "0x0F must call the decoder");
  const args = zeroF.slice(Math.max(0, at - 5), at).map((insn) => insn.text);
  assert.ok(
    args.some((t) => /^push 0$/.test(t)),
    `0x0F must push 0 for the out-parameter, got: ${args.join(" | ")}`,
  );
  assert.ok(
    args.some((t) => /^lea ecx, \[edi\+70h\]$/.test(t)),
    "0x0F must pass this + 0x70 (this + 28) as the decoder's this",
  );

  const zeroD = instructions(SUB_55BEB0[0], SUB_55BEB0[1]);
  const atD = indexOf(zeroD, /^call sub_4C5DC0$/);
  const argsD = zeroD.slice(Math.max(0, atD - 5), atD).map((insn) => insn.text);
  assert.ok(
    argsD.some((t) => /^lea ecx, \[esp\+/.test(t)) && argsD.some((t) => /^push ecx$/.test(t)),
    `0x0D must push a real stack buffer, got: ${argsD.join(" | ")}`,
  );
  // And 0x0D follows it with the icon call, gated on the returned mask being non-zero.
  const icon = indexOf(zeroD, /^call sub_4CBBD0$/);
  assert.ok(icon > atD, "0x0D must call sub_4CBBD0 after the decoder");
  assert.ok(
    zeroD.slice(atD, icon).some((insn) => /^jz short/.test(insn.text)),
    "0x0D must skip the icon call when the mask is 0",
  );
  assert.ok(
    zeroD
      .slice(Math.max(0, icon - 4), icon)
      .some((insn) => /lea ecx, \[esi\+178h\]/.test(insn.text)),
    "the icon call must target this + 0x178 (this + 94)",
  );
});

test("there is no cancel opcode: a buff ends by expiry sweep, or by duration 0", () => {
  const source = readFileSync(DECOMPILED, "latin1");
  // Anchor through the `{`: there is a forward declaration at the top of the listing, and slicing
  // from that one lands on the declarations block, whose next `\n}` is thousands of lines away.
  const at = source.indexOf("int __thiscall sub_4C65A0(_DWORD *this, int thisa)\n{");
  assert.notEqual(at, -1, "sub_4C65A0 must be defined, not merely declared");
  const body = source.slice(at, source.indexOf("\n}", at));

  // A slot is "on" iff its value pair differs; it dies when the clock passes its (obfuscated) expiry.
  assert.ok(
    /\*\(this \+ 2\) != \*\(this \+ 3\)/.test(body),
    "a slot must be considered active only when its value pair differs",
  );
  assert.ok(
    /thisa - \(\*\(this \+ 4\) \^ \*\(this \+ 5\)\) > 0/.test(body),
    "expiry must be `now - (expiry ^ obfuscator) > 0`",
  );
  // Clearing writes the same obfuscator to both halves, which is what makes them equal.
  assert.ok(
    /\*\(this \+ 2\) = v4;[\s\S]{0,80}\*\(this \+ 3\) = v4;/.test(body),
    "clearing must set both halves of the value pair to the same obfuscator",
  );

  // The decoder's early exit: duration 0 means "read nothing at all".
  const decoderAt = source.indexOf(
    "int __thiscall sub_4C5DC0(_DWORD *this, int pExceptionObject, int a3, _DWORD *a4)\n{",
  );
  assert.notEqual(decoderAt, -1, "sub_4C5DC0 must be defined, not merely declared");
  const decoderBody = source.slice(decoderAt, source.indexOf("\n}", decoderAt));
  assert.ok(
    /v9 = pExceptionObject == 0;[\s\S]{0,200}if \( v9 \)\s*\n\s*return 0;/.test(decoderBody),
    "durationMs == 0 must return 0 before the mask is read",
  );
});

test("the sweep runs per frame, and a changed slot redraws icons and the stat panel", () => {
  const source = readFileSync(DECOMPILED, "latin1");
  const at = source.indexOf("sub_4C65A0(this + 28, this_3) != 0");
  assert.notEqual(at, -1, "the per-frame update must call the sweeper on this + 28");
  const block = source.slice(at, at + 220);
  assert.ok(block.includes("sub_4CC2D0(this + 94)"), "an expired slot must drop its icon");
  assert.ok(block.includes("sub_55AA80(this)"), "an expired slot must redraw the panel");
});
