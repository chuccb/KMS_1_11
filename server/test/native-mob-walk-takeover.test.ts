/**
 * Server-driven movement (`0x33`) takes over from the client's own mob walking, and does not fight
 * it. This is the client-side half of §6 item 14, which left open whether the two would interrupt
 * each other.
 *
 * The answer comes from one shared predicate. All four paths that touch a mob's walking ask the
 * same question — `sub_485520(mob)`, which is just `*( *(mob + 27) + 24 )`, "is a controller
 * running?" — and they split on it in a way that is not symmetric and not obvious:
 *
 *   - `0x31` flag 1 (advance the client's own walking): a running controller means **do nothing**.
 *   - `0x31` flag 0 (remove): a running controller means **stop it**, then remove.
 *   - `0x33` (server-driven move): a running controller means **stop it**, then apply the path.
 *
 * So `0x33` never fights the client's walking; it cancels it first and lands the mob in the same
 * "-2 / -3" states that the explicit stop produces. Sending `0x33` per leg is therefore safe
 * regardless of whether the original server also sent `0x31`.
 *
 * What is deliberately NOT asserted: what the original server actually sent (`--npc-walk`'s
 * default). That is an oracle question about a server this repository does not contain, and no
 * amount of client-side evidence can answer it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DECOMPILED = fileURLToPath(new URL("../../MapleStory.exe.c", import.meta.url));
const decompiled = readFileSync(DECOMPILED, "latin1");

/** The body of a decompiled function, from its definition to the closing `}`. */
function functionBody(header: string): string {
  const at = decompiled.indexOf(`\n${header}\n{`);
  assert.notEqual(at, -1, `function not found: ${header}`);
  const end = decompiled.indexOf("\n}", at);
  assert.notEqual(end, -1, `unterminated function: ${header}`);
  return decompiled.slice(at, end);
}

const IS_RUNNING = functionBody("int __thiscall sub_485520(_DWORD *this)");
const TOGGLE = functionBody("int __thiscall sub_485330(_DWORD *this, int a2)");
const MOVE = functionBody("void __thiscall sub_488BC0(int *this, int pExceptionObject)");
const ENTER = functionBody(
  "int __thiscall sub_491630(_DWORD *this, int p_pExceptionObject, int pExceptionObject)",
);
const REMOVE = functionBody("void __thiscall sub_491830(_DWORD *this, int p_pExceptionObject)");

test("sub_485520 is the one predicate, and it is a single dereference", () => {
  // `*(this + 27)` is the controller object; `+ 24` on it is the running pointer.
  assert.match(
    IS_RUNNING,
    /return \*\(_DWORD \*\)\(\*\(this \+ 27\) \+ 24\);/,
    "the whole function is one load",
  );
  assert.equal(IS_RUNNING.split("\n").filter((l) => l.includes("return")).length, 1);
});

test("0x31 flag 1 skips the step when a controller is already running", () => {
  // `sub_485330(v8, 1)` is reached only when sub_485520 returns 0; otherwise it returns as-is.
  // The only call into the walker is guarded by `result == 0`; anything else falls through and
  // leaves the mob exactly as it was. There is no `return result;` in between.
  assert.match(
    ENTER,
    /result = sub_485520\(v8\);\n    if \( result == 0 \)\n      return sub_485330\(v8, 1\);\n  \}/,
    "a running controller makes 0x31 flag 1 a no-op",
  );
  assert.equal(
    /sub_485330\(v8, 1\);\n    return result;/.test(ENTER),
    false,
    "the advance must not fall through into a return of the predicate",
  );
});

test("0x33 stops a running controller before applying the path", () => {
  // `v4 = *(this + 27)`, so `v4[6]` is byte 24 — the same field sub_485520 reads.
  assert.match(MOVE, /v4 = \(_DWORD \*\)\*\(this \+ 27\);/);
  assert.match(MOVE, /if \( v4\[6\] != 0 \)/);
  // The stop is a virtual call with seven zero arguments, through vtable slot 184.
  assert.match(
    MOVE,
    /\(\*\(void \(__thiscall \*\*\)\(_DWORD \*, _DWORD, _DWORD, _DWORD, _DWORD, _DWORD, _DWORD, _DWORD\)\)\(\*v4 \+ 184\)\)\(\n        v4,\n        0,\n        0,\n        0,\n        0,\n        0,\n        0,\n        0\);/,
  );
  // ... and then the sight/position bookkeeping is refreshed before the new path is read.
  assert.match(
    MOVE,
    /sub_4963A0\(\(int\)\(v3 \+ 54\), \*\(_DWORD \*\)\(\*\(this \+ 31\) \+ 24\), v3\);/,
  );
});

test("0x33 inlines the same stop that sub_485330(mob, 0) performs", () => {
  // sub_485330's stop branch ends with the identical call: slot 184, this + seven zeros.
  assert.match(
    TOGGLE,
    /return \(\*\(int \(__thiscall \*\*\)\(_DWORD \*, _DWORD, _DWORD, _DWORD, _DWORD, _DWORD, _DWORD, _DWORD\)\)\(\*v3 \+ 184\)\)\(\n             v3,\n             0,\n             0,\n             0,\n             0,\n             0,\n             0,\n             0\);/,
  );
  assert.match(TOGGLE, /v3 = \(_DWORD \*\)\*\(this \+ 27\);/);
});

test("sub_485330 is the start/stop state machine on mob + 29", () => {
  // start (a2 != 0): -> state 4, then the walking call.
  assert.match(TOGGLE, /if \( a2 != 0 \)/);
  assert.match(TOGGLE, /\*\(this \+ 29\) = 4;/);
  // stop (a2 == 0): 4 -> -2, 5 -> -3, anything else -> -1.
  assert.match(TOGGLE, /else if \( result != 0 \)/);
  assert.match(TOGGLE, /if \( \*\(this \+ 29\) == 4 \)\n    \{\n      \*\(this \+ 29\) = -2;/);
  assert.match(TOGGLE, /else if \( \*\(this \+ 29\) == 5 \)\n    \{\n      \*\(this \+ 29\) = -3;/);
  assert.match(TOGGLE, /v7 = \*\(this \+ 31\);\n      \*\(this \+ 29\) = -1;/);
});

test("0x33 leaves the mob in the same stopped states as the explicit stop", () => {
  // -2 when the last byte's low bit is clear, -3 when it is set. Both are sub_485330's stop states.
  assert.match(MOVE, /\*\(this \+ 29\) = -\(pExceptionObject_2 != 0\) - 2;/);
  // And the whole body is skipped outright while the mob is in state 1.
  assert.match(MOVE, /if \( \*\(this \+ 29\) != 1 \)/);
});

test("0x31 flag 0 stops before removing, and only releases when mob + 112 is clear", () => {
  assert.match(
    REMOVE,
    /if \( sub_485520\(v6\) != 0 \)\n        \{\n          sub_485330\(v6, 0\);\n          if \( v6\[28\] == 0 \)/,
    "removal calls the real stop, not an inlined copy",
  );
  // `v6[28]` is byte 112 on the mob: a non-zero value abandons the release chain.
  assert.ok(REMOVE.includes("v6[28]"), "expected the mob + 112 gate");
});

test("the four paths split on the predicate in a way that favours the server", () => {
  // Count how each handler reacts to a running controller.
  assert.match(ENTER, /sub_485520\(v8\)/, "0x31 flag 1 consults the predicate");
  assert.match(REMOVE, /sub_485520\(v6\)/, "0x31 flag 0 consults the predicate");
  assert.match(MOVE, /v4\[6\] != 0/, "0x33 consults the same field inline");
  // Exactly one of them treats "running" as a reason to do nothing.
  assert.equal(
    /return result;/.test(ENTER) && !/return result;/.test(REMOVE) && !/return result;/.test(MOVE),
    true,
    "only the advance path bails out; the other two stop and proceed",
  );
});
