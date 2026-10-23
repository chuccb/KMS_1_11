/**
 * Where the client reads `hp`, `mp`, `mdd`, `time` and friends - and why an ASCII grep cannot see them.
 *
 * FINDINGS §6 item 19 recorded that `spec`, `hp`, `hpR`, `mp` and `moveTo` have "no ASCII strings
 * in the binary", and inferred from that the client must read those fields generically. That
 * inference is wrong, and the way it went wrong is worth pinning, because the same mistake was
 * made twice while working this item and would be made again:
 *
 *   WZ property names are **UTF-16**. IDA emits them as `wchar_t aHp[] = L"hp";`, and the raw
 *   executable holds them in a UTF-16 string pool, not a NUL-terminated ASCII one. `grep -a "pad"`
 *   over `MapleStory.exe` returns **zero** hits while `pad` is sitting in the binary - so "absent
 *   from the binary" concluded from an ASCII scan is a false negative, not evidence.
 *
 * The parser itself is `sub_4BC590`. It reads 26 field names in a fixed order and fills one entry
 * of the 120-byte effect array at `+72` of the owning record. It is called exactly once, from
 * `sub_4BB270`, which walks `Skill/%03d.img/skill/%07d/...`. So the shared effect parser is wired
 * to the SKILL tree only; nothing in this binary calls it with an item `spec` node.
 *
 * What *is* genuinely absent, in **both** encodings, is `spec` itself - and, separately, `hpR`,
 * `mpR`, `moveTo` and `slotMax`. That is a real finding: the rate and teleport fields this server
 * applies are justified by the Data.wz data alone, never by a literal key in the client. The last
 * test keeps that justification honest: if a field name ever shows up in the client, the note that
 * it "cannot" must be revised, and if it ever vanishes from Data.wz the field must stop being
 * applied.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";

const LISTING = fileURLToPath(new URL("../../MapleStory.exe.c", import.meta.url));
const EXE = fileURLToPath(new URL("../../MapleStory.exe", import.meta.url));
const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));

/** The consume families `Item/Consume/0XXX.img` carries in this build. */
const CONSUME_PREFIXES = ["0200", "0201", "0202", "0203", "0204", "0205", "0206", "0207"] as const;

const archive: WzArchive | undefined = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : undefined;

function listing(): string {
  return readFileSync(LISTING, "latin1");
}

function exe(): Buffer {
  return readFileSync(EXE);
}

/**
 * One decompiled function, from its definition to its closing brace at column 0.
 *
 * `signature` must run through the `{`: the listing opens with a block of forward declarations and
 * a bare-name match lands on `int __stdcall sub_4BC590(int, int ***, int);` instead.
 */
function functionBody(source: string, signature: string): string {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `${signature.split("\n")[0]} must be defined in the listing`);
  const end = source.indexOf("\n}", at);
  assert.notEqual(end, -1, `${signature.split("\n")[0]} must have a closing brace`);
  return source.slice(at, end);
}

function countAll(haystack: Buffer, needle: Buffer): number {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    n++;
    at = haystack.indexOf(needle, at + 1);
  }
  return n;
}

/** How a field name is spelled in the raw executable: as ASCII, and as UTF-16. */
function occurrences(haystack: Buffer, field: string): { ascii: number; utf16: number } {
  return {
    ascii: countAll(haystack, Buffer.from(field, "ascii")),
    utf16: countAll(haystack, Buffer.from(field, "utf16le")),
  };
}

const EFFECT_PARSER = "int __stdcall sub_4BC590(int pExceptionObject, int ***a2, int a3)\n{";

/**
 * The ordered field vocabulary of `sub_4BC590`, read out of the listing rather than retyped, so a
 * regenerated listing that renames or reorders a symbol fails here instead of silently agreeing.
 */
function fieldVocabulary(): string[] {
  const body = functionBody(listing(), EFFECT_PARSER);
  // Every field read is `sub_405DF0(&out, aName);` - the getter that resolves one WZ property.
  const reads = body.match(
    /sub_405DF0\(\s*(?:\(int \*\*\)&|&)?[A-Za-z_][A-Za-z0-9_]*\s*,\s*(a[A-Z][A-Za-z0-9_]*|asc_[0-9A-F]+)\s*\)/g,
  );
  assert.ok(
    reads !== null && reads.length > 0,
    "sub_4BC590 must read WZ fields through sub_405DF0",
  );
  return reads.map((read) => {
    const symbol = /,\s*(a[A-Z][A-Za-z0-9_]*|asc_[0-9A-F]+)\s*\)/.exec(read);
    assert.ok(symbol !== null, `unparseable field read: ${read}`);
    return symbol[1];
  });
}

/** Resolve an IDA string symbol to the literal it holds, plus the width it is declared with. */
function stringLiteral(symbol: string): { value: string; wide: boolean } {
  const declaration = new RegExp(
    `^\\s*(?:wchar_t|char)\\s+${symbol}\\[\\]\\s*=\\s*(L?)"(.*?)";`,
    "m",
  ).exec(listing());
  assert.ok(declaration !== null, `${symbol} must be declared as a string in the listing`);
  return { value: declaration[2], wide: declaration[1] === "L" };
}

test("sub_4BC590 reads the effect field vocabulary, in one fixed order", () => {
  assert.deepEqual(fieldVocabulary(), [
    "aHs",
    "aHp",
    "aMp",
    "aPad",
    "aPdd",
    "aMad",
    "aMdd",
    "aAcc",
    "aEva",
    "aCraft",
    "aSpeed",
    "aJump",
    "aHpcon",
    "aMpcon",
    "aItemcon",
    "aItemconno",
    "aDamage",
    "aTime",
    "aProp",
    "aRange",
    "aAttackcount",
    "aBulletcount",
    "aMastery",
    "asc_5B5D1C", // "x" - one letter, so IDA never gave it an `aXxx` name
    "aY_1",
    "aZ",
  ]);
});

test("every one of those field names is declared UTF-16, not ASCII", () => {
  for (const symbol of fieldVocabulary()) {
    const { value, wide } = stringLiteral(symbol);
    assert.ok(wide, `${symbol} ("${value}") must be a wide (UTF-16) literal`);
  }
});

test("the flat heal fields are real: hp, mp and time are all in the vocabulary", () => {
  const names = fieldVocabulary().map((symbol) => stringLiteral(symbol).value);
  for (const field of ["hp", "mp", "time"]) {
    assert.ok(names.includes(field), `"${field}" must be a field the client reads`);
  }
});

test("pad, pdd, mad and mdd are read as one four-way group", () => {
  // ADR-143 corrected the note that called `mdd` a misreading. The corroboration is independent of
  // the note: all four appear consecutively, in this order, inside one parser.
  const names = fieldVocabulary().map((symbol) => stringLiteral(symbol).value);
  const at = names.indexOf("pad");
  assert.notEqual(at, -1, "pad must be in the vocabulary");
  assert.deepEqual(names.slice(at, at + 4), ["pad", "pdd", "mad", "mdd"]);
});

test("the names are invisible to an ASCII scan - which is why the note called them absent", () => {
  // This is the trap, pinned. `pad`, `pdd`, `mad`, `mdd` and `mastery` have NO ASCII spelling in
  // the executable and exactly one UTF-16 spelling each. `hp`, `mp` and `hs` do return ASCII hits,
  // but they are noise - substrings of unrelated text - which is worse: a positive ASCII hit on
  // those is what made the rest of the list look like it had been checked.
  const raw = exe();
  for (const field of ["pad", "pdd", "mad", "mdd", "mastery"]) {
    const { ascii, utf16 } = occurrences(raw, field);
    assert.equal(
      ascii,
      0,
      `"${field}" must have no ASCII spelling (and therefore be invisible to grep -a)`,
    );
    assert.equal(utf16, 1, `"${field}" must appear exactly once, as UTF-16`);
  }
});

test("spec, hpR, mpR, moveTo and slotMax really are absent - in both encodings", () => {
  // The half of the note that survives. `spec` is the node name that holds every consume effect,
  // and the client has no string for it at all; neither does it have one for the rate fields.
  const raw = exe();
  for (const field of ["spec", "hpR", "mpR", "moveTo", "slotMax"]) {
    const { ascii, utf16 } = occurrences(raw, field);
    assert.equal(ascii, 0, `"${field}" must not appear in ASCII`);
    assert.equal(utf16, 0, `"${field}" must not appear in UTF-16 either`);
  }
});

test("the effect parser is wired to the skill tree only - called once, from sub_4BB270", () => {
  const source = listing();
  // Forward declaration + the one call + the definition is three mentions. A fourth would mean a
  // second caller, which is exactly what would make the item `spec` tree share this parser.
  const mentions = source.split("sub_4BC590").length - 1;
  assert.equal(mentions, 3, `sub_4BC590 must have exactly one caller (found ${mentions} mentions)`);

  const skillLoader = functionBody(
    source,
    "int __thiscall sub_4BB270(int **this, int pvarg, int pExceptionObject, int a4)\n{",
  );
  // The path is a symbol, not an inline literal: `aSkill03dImgSki* = L"Skill/%03d.img/..."`.
  assert.ok(
    /aSkill03dImgSki/.test(skillLoader),
    "the sole caller must be the skill loader that walks Skill/%03d.img",
  );
  assert.ok(
    stringLiteral("aSkill03dImgSki").value.startsWith("Skill/%03d.img/skill/%07d/"),
    "the path symbol must resolve to the skill tree",
  );
  // It fills one entry of the 120-byte array: `sub_4BC590(itemId, record + 72, levelIndex)`.
  assert.ok(
    /sub_4BC590\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*\(int \*\*\*\)\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\+\s*72\s*\)\s*,/.test(
      skillLoader,
    ),
    "the skill loader must pass `record + 72`, the 120-byte effect entry array",
  );
});

test(
  "the rate fields this server applies are justified by Data.wz alone, never by the client",
  {
    skip: archive === undefined,
  },
  () => {
    // `hpR`, `mpR` and `moveTo` are applied by `consumeSpecOf`, yet the client carries no string for
    // any of them. The only possible justification is the data, so assert the data really has them -
    // and assert the client really does not, so the two halves cannot drift apart unnoticed.
    const raw = exe();
    for (const field of ["hpR", "mpR", "moveTo"]) {
      const { ascii, utf16 } = occurrences(raw, field);
      assert.equal(
        ascii + utf16,
        0,
        `"${field}" must still be absent from the client before being trusted`,
      );
    }

    const reader = artReaderOf(archive);
    assert.ok(reader !== undefined, "a present Data.wz must yield a reader");
    const wanted = new Set<string>(["hpR", "mpR", "moveTo"]);
    const found = new Set<string>();
    for (const prefix of CONSUME_PREFIXES) {
      const node = reader.node(`Item/Consume/${prefix}.img`);
      if (node === undefined) continue; // a family this Data.wz does not carry
      for (const child of (node.value ?? []) as { name: string; value?: { value?: unknown[] } }[]) {
        if (!Number.isInteger(Number(child.name)) || Number(child.name) <= 0) continue;
        // The rate fields live under `spec`, not beside `info`, so descend one level.
        const props = (child.value?.value ?? []) as {
          name: string;
          value?: { value?: unknown[] };
        }[];
        const spec = props.find((prop) => prop.name === "spec");
        if (spec === undefined) continue;
        for (const prop of (spec.value?.value ?? []) as { name: string }[]) {
          if (wanted.has(prop.name)) found.add(prop.name);
        }
      }
    }
    for (const field of wanted) {
      assert.ok(
        found.has(field),
        `${field} must exist in Data.wz, since the client carries no string for it`,
      );
    }
  },
);
