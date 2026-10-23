/**
 * `unknown26` — a real byte between the two appearance words and the following dword.
 *
 * Binary answer: its wire/storage mechanics are known, its meaning is not. The CharacterData codec
 * preserves it; the 0x0D diff uses a four-byte wire slot but stores only AL. The original listing
 * contains no other direct scalar access to +0x1A, so there is no located gameplay/visual consumer
 * that would justify renaming it (for example, to a guessed skin field).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DECOMPILED = fileURLToPath(new URL("../../MapleStory.exe.c", import.meta.url));
const LISTING = fileURLToPath(new URL("../../MapleStory.exe.lst", import.meta.url));
const decompiled = readFileSync(DECOMPILED, "latin1");
const listing = readFileSync(LISTING, "latin1");

/** Get one decompiled function body by its exact signature. */
function functionBody(header: string): string {
  const at = decompiled.indexOf(`\n${header}\n{`);
  assert.notEqual(at, -1, `function not found: ${header}`);
  const end = decompiled.indexOf("\n}", at);
  assert.notEqual(end, -1, `unterminated function: ${header}`);
  return decompiled.slice(at, end);
}

interface Instruction {
  readonly address: number;
  readonly text: string;
}

/** Parse one real instruction per `.text:` line; consume the variable-length byte column. */
const instructions: readonly Instruction[] = listing.split("\n").flatMap((line): Instruction[] => {
  if (!line.startsWith(".text:")) return [];
  const match = /^\.text:([0-9A-F]{8})\s+(?:[0-9A-F]{2}[ \t]+)+(.+)$/.exec(line);
  if (match === null) return [];
  const text = match[2]!.split(";")[0]!.replace(/\s+/g, " ").trim();
  if (text.length === 0) return [];
  return [{ address: Number.parseInt(match[1]!, 16), text }];
});

function instructionAt(address: number): Instruction {
  const found = instructions.find((instruction) => instruction.address === address);
  assert.ok(found, `instruction missing at ${address.toString(16)}`);
  return found;
}

const CHAR_READ = functionBody("char __thiscall sub_45D840(char *this, int k)");
const CHAR_WRITE = functionBody("int __thiscall sub_45D2E0(char *this, unsigned int *a2)");
const STAT_DISPATCH = functionBody(
  "void __thiscall sub_55A900(int *this, int pExceptionObject, const char *pExceptionObjecta)",
);
const STAT_HANDLER = functionBody(
  "unsigned __int8 __thiscall sub_55BEB0(int *this, int pExceptionObject)",
);
const DIFF_READ = functionBody("char __thiscall sub_45E0D0(int this, int pExceptionObject)");
const DIFF_SERIALIZER = functionBody(
  "int __thiscall sub_45DE00(int this, int a2, unsigned int *a3)",
);
const READ_BYTE = functionBody(
  "int __cdecl sub_45DC40(_BYTE *a1, _BYTE *a2, int pExceptionObject)",
);
const READ_DWORD = functionBody(
  "int __cdecl sub_45DCC0(_DWORD *a1, _DWORD *a2, unsigned int pExceptionObject)",
);

test("CharacterData reads one byte at +26, between the two appearance words and the next dword", () => {
  assert.match(CHAR_READ, /\*\(_DWORD \*\)\(this \+ 18\) = k_4;/);
  assert.match(CHAR_READ, /\*\(_DWORD \*\)\(this \+ 22\) = k_5;/);
  assert.match(CHAR_READ, /v16 = sub_45DC40\(/);
  assert.match(CHAR_READ, /\*\(this \+ 26\) = k_6;/);
  assert.match(CHAR_READ, /\*\(_DWORD \*\)\(this \+ 27\) = k_7;/);

  const before = CHAR_READ.indexOf("*(_DWORD *)(this + 22) = k_5;");
  const field = CHAR_READ.indexOf("*(this + 26) = k_6;");
  const after = CHAR_READ.indexOf("*(_DWORD *)(this + 27) = k_7;");
  assert.ok(
    before >= 0 && field > before && after > field,
    "the byte is in the claimed field order",
  );

  // The called primitive checks/consumes exactly one byte, then copies one byte to the destination.
  assert.match(READ_BYTE, /result = 1;/);
  assert.match(READ_BYTE, /\*a1 = \*a2;/);
  assert.equal(instructionAt(0x45d943).text, "mov [edi+1Ah], al");
});

test("CharacterData writes the byte at +26 as one byte, without folding it into hair", () => {
  assert.match(CHAR_WRITE, /v6 = \*\(_DWORD \*\)\(this \+ 22\);/);
  assert.match(CHAR_WRITE, /LOBYTE\(v6\) = \*\(this \+ 26\);/);
  assert.match(
    CHAR_WRITE,
    /sub_431DE0\(a2, 1\);\s*\n\s*\*\(_BYTE \*\)\(a2\[2\] \+ a2\[1\]\) = v6;\s*\n\s*\+\+a2\[2\];/,
  );
  assert.match(CHAR_WRITE, /v7 = \*\(_DWORD \*\)\(this \+ 27\);/);
  assert.equal(instructionAt(0x45d37c).text, "mov bl, [edi+1Ah]");
  assert.equal(instructionAt(0x45d38e).text, "mov [eax+ecx], bl");
});

test("s2c 0x0D case 13 reaches the active diff reader", () => {
  assert.match(STAT_DISPATCH, /case 13:\s*\n\s*sub_55BEB0\(this, \(int\)pExceptionObjecta\);/);
  assert.match(STAT_HANDLER, /sub_45E0D0\(src, pExceptionObject\);/);
  assert.equal(instructionAt(0x55a932).text, "call sub_55BEB0");
  assert.match(
    listing,
    /sub_45E0D0\s+proc near\s+; CODE XREF: sub_55BEB0\+95/,
    "the active handler's raw call xref leads to this decoder",
  );
});

test("the 0x0D diff reads four bytes for the field, then keeps only the low byte", () => {
  assert.match(DIFF_READ, /if \( \(v4 & 4\) != 0 \)/);
  assert.match(DIFF_READ, /v10 = sub_45DCC0\(/);
  assert.match(DIFF_READ, /LOBYTE\(pExceptionObject_2\) = pExceptionObject;/);
  assert.match(DIFF_READ, /\*\(_BYTE \*\)\(this \+ 26\) = pExceptionObject_2;/);
  assert.match(
    DIFF_READ,
    /if \( \(v4 & 8\) != 0 \)[\s\S]*?\*\(_DWORD \*\)\(this \+ 27\) = pExceptionObject_2;/,
  );

  // The helper checks four available bytes and copies a DWORD; the receiver stores AL at +0x1A.
  assert.match(READ_DWORD, /n4 = 4;/);
  assert.match(READ_DWORD, /\*a1 = \*a2;/);
  assert.equal(instructionAt(0x45e187).text, "call sub_45DCC0");
  assert.equal(instructionAt(0x45e19b).text, "mov [edi+1Ah], al");
  assert.equal(instructionAt(0x45e1ce).text, "mov [edi+1Bh], eax");
});

test("the counterpart diff serializer zero-extends the byte to its u32 slot", () => {
  assert.match(DIFF_SERIALIZER, /if \( \(result & 4\) != 0 \)/);
  assert.match(DIFF_SERIALIZER, /v7 = \*\(unsigned __int8 \*\)\(this \+ 26\);/);
  assert.match(
    DIFF_SERIALIZER,
    /sub_431DE0\(a3, 4\);\s*\n\s*\*\(_DWORD \*\)\(a3\[1\] \+ a3\[2\]\) = v7;/,
  );
  assert.equal(instructionAt(0x45de70).text, "mov cl, [edi+1Ah]");
  assert.equal(
    instructions.filter((instruction) => instruction.text === "call sub_45DE00").length,
    0,
    "no direct call xref makes this serializer supplemental evidence only",
  );
});

test("the original listing has no other direct scalar access to offset +0x1A", () => {
  // There are also four LEAs for GW_ItemSlot's separate cash block, which are not accesses to a
  // CharacterData field. Enumerate every +1Ah memory operand in the whole listing and distinguish
  // those address calculations from the four actual byte loads/stores above.
  const refs = instructions.filter((instruction) => /\[[^\]]+\+1Ah\]/.test(instruction.text));
  assert.deepEqual(
    refs.map(({ address }) => address),
    [0x45d37c, 0x45d943, 0x45de70, 0x45e19b, 0x45e731, 0x45e76a, 0x47a7d3, 0x47cdf1],
  );
  const scalar = refs.filter((instruction) => !instruction.text.startsWith("lea "));
  assert.deepEqual(
    scalar.map(({ address }) => address),
    [0x45d37c, 0x45d943, 0x45de70, 0x45e19b],
  );
});

test("the avatar rebuild path does not interpret the opaque byte", () => {
  const avatar = functionBody("LONG *__cdecl sub_4C5020(int src, LONG *a2, int a3, int a4)");
  assert.match(avatar, /n2_2 = \*\(unsigned __int8 \*\)\(src \+ 17\);/, "gender is read");
  assert.match(avatar, /v6 = \*\(unsigned __int8 \*\)\(src \+ 31\);/, "level is read");
  assert.doesNotMatch(avatar, /src \+ 26|src \+ 0x1A/);
});
