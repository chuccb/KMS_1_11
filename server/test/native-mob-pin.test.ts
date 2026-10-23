/**
 * mob+112 (mob[28]) — the "field-mob pin" that gates 0x31 removal.
 *
 * Binary facts (all from MapleStory.exe.c only):
 *  - CMob constructor (sub_484950) zeros mob[28].
 *  - 0x2F (sub_4924A0, '/') sets it to 1 — both when reusing an id and when
 *    allocating a fresh mob.
 *  - 0x31-creation (sub_491630, the else-branch that builds a mob when the
 *    id is NOT in the pool) does NOT touch it — those transients stay 0.
 *  - 0x30 immediate (sub_491AB0, a3==0) clears it to 0, then bails if a
 *    controller is still running.
 *  - 0x31 removal (sub_491830) stops a running controller, then only unlinks
 *    if it is already 0.
 *
 * What we do NOT claim: why the pin exists, whether the original server ever
 * sent 0x31 for a field mob, or what a correct server should do. Those need
 * an oracle trace.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";

const C = fs.readFileSync("MapleStory.exe.c", "latin1");

function body(header: string): string {
  const start = C.indexOf("\n" + header + "\n{");
  if (start < 0) throw new Error(`header not found: ${header}`);
  const end = C.indexOf("\n}", start);
  return C.slice(start, end);
}

const CTOR = body("_DWORD *__thiscall sub_484950(_DWORD *this, int a2)");
const ENTER_2F = body("LONG *__thiscall sub_4924A0(_DWORD *this, int pExceptionObject_1)");
const CREATE_31 = body(
  "int __thiscall sub_491630(_DWORD *this, int p_pExceptionObject, int pExceptionObject)",
);
const REMOVE_NOW = body("void __thiscall sub_491AB0(_DWORD *this, int pExceptionObject, int a3)");
const REMOVE_31 = body("void __thiscall sub_491830(_DWORD *this, int p_pExceptionObject)");

describe("mob+112 is the field-mob pin", () => {
  test("CMob starts with pin 0", () => {
    expect(CTOR).toMatch(/\*\(this \+ 28\) = 0;/);
  });

  test("0x2F sets the pin to 1 in both branches", () => {
    // reuse path: *(_DWORD *)(v9 + 112) = 1
    expect(ENTER_2F).toMatch(/\*\(.+?\(v9 \+ 112\) = 1;/);
    // fresh path: v12[28] = 1
    expect(ENTER_2F).toMatch(/v12\[28\] = 1;/);
    // exactly two writers, both set to 1
    const writes = ENTER_2F.match(/v12\[28\] = 1/g) ?? [];
    const writes2 = ENTER_2F.match(/v9 \+ 112\) = 1/g) ?? [];
    expect(writes.length + writes2.length).toBe(2);
  });

  test("0x31-creation does not touch the pin", () => {
    // sub_491630's creation branch ends with sub_484ED0 then sub_485330, never writes 112 or [28]
    expect(CREATE_31).not.toMatch(/\+ 112\) =/);
    expect(CREATE_31).not.toMatch(/\[28\] =/);
  });

  test("0x30 immediate clears the pin, then checks the controller", () => {
    expect(REMOVE_NOW).toMatch(/if \( v8\[28\] != 0 \)\s*\n\s*v8\[28\] = 0;/);
    expect(REMOVE_NOW).toMatch(/if \( sub_485520\(v8\) != 0 \)\s*\n\s*return;/);
    // clear must come before the controller check — order matters
    const clearIdx = REMOVE_NOW.indexOf("v8[28] = 0;");
    const checkIdx = REMOVE_NOW.indexOf("sub_485520(v8) != 0");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(checkIdx);
  });

  test("0x31 removal stops, then only unlinks if pin is already 0", () => {
    expect(REMOVE_31).toMatch(/if \( sub_485520\(v6\) != 0 \)\s*\{\s*\n\s*sub_485330\(v6, 0\);/);
    expect(REMOVE_31).toMatch(/if \( v6\[28\] == 0 \)\s*\{/);
    // the pin check must be inside the controller-stopped block, after the stop
    const stopIdx = REMOVE_31.indexOf("sub_485330(v6, 0);");
    const pinIdx = REMOVE_31.indexOf("if ( v6[28] == 0 )");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(pinIdx).toBeGreaterThan(-1);
    expect(pinIdx).toBeGreaterThan(stopIdx);
  });

  test("the two 0x30 paths are different: delayed ignores the pin, immediate does not", () => {
    // a3 != 0 path: directly sub_485530, no pin read or write
    const delayed = REMOVE_NOW.slice(
      REMOVE_NOW.indexOf("if ( a3 != 0 )"),
      REMOVE_NOW.indexOf("if ( v8[28]"),
    );
    expect(delayed).toMatch(/sub_485530\(v8\)/);
    expect(delayed).not.toMatch(/v8\[28\]/);
    expect(delayed).not.toMatch(/sub_485520/);
  });
});
