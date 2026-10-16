/**
 * CP949 - the byte encoding of every string a human reads.
 *
 * A v1.11 client is a Korean Windows program: the text it shows is built from **bytes** in the
 * system's ANSI code page, which for this build is CP949 (UHC, the Windows-949 extension of
 * EUC-KR). The WZ reader hands us proper JavaScript strings (its strings are UTF-16LE on disk,
 * `wz/img.ts`), and the client's own Korean literals inside `MapleStory.exe` are CP949 bytes - so
 * anything that has to *travel* to the client has to be turned back into CP949 bytes.
 *
 * EVIDENCE
 * --------
 * `sub_432680` (58280-58360) is the client's string reader: `u16 length` + that many raw bytes,
 * copied into a ZXString<char> as-is - no widening, no code page conversion. The same bytes then
 * reach the renderer through `sub_5338A0` (the dialog's text) and are widened for drawing with the
 * process's ANSI code page, which is why the EXE's own strings are CP949 (FINDINGS 4.13).
 *
 * So a string that is not CP949-representable cannot be shown: this module throws instead of
 * sending bytes the client would draw as mojibake, the same rule `PacketWriter.writeAsciiString`
 * applies to latin1.
 *
 * What the code page covers: ASCII, KS X 1001 and its UHC extension - Korean syllables, hanja,
 * kana, Greek, Cyrillic, box/unit symbols. What it does not: the accented Latin letters of Latin-1
 * (there is no "À" - that is a CP1252 character), punctuation outside KS X 1001 (the code page's
 * dash is not U+2014), and anything outside the BMP. Being representable is not the same as being
 * *drawn* - whether a glyph exists is the client's WZ font's business - which is one more reason
 * this server's own text stays inside the Korean range.
 *
 * IMPLEMENTATION
 * --------------
 * Node has a CP949 *decoder* (`TextDecoder("euc-kr")`, ICU) but no encoder, so the encoder is built
 * once, lazily, by decoding every legal lead/trail pair and inverting the table: 126 leads x 190
 * trails, of which the invalid ones throw (`fatal: true`) and are skipped. ASCII maps to itself;
 * a lone byte >= 0x80 is not a character in this code page (every such byte is a lead byte), so a
 * character with no entry is an error rather than a guess.
 */
let reverse: Map<number, number[]> | undefined;

function reverseTable(): Map<number, number[]> {
  if (reverse !== undefined) return reverse;
  const decoder = new TextDecoder("euc-kr", { fatal: true });
  const table = new Map<number, number[]>();
  for (let code = 0; code <= 0x7f; code++) table.set(code, [code]);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      let text: string;
      try {
        text = decoder.decode(new Uint8Array([lead, trail]));
      } catch {
        continue; // not a defined character in this code page
      }
      if (text.length !== 1) continue; // a pair that decodes to nothing/several characters
      const point = text.codePointAt(0)!;
      if (!table.has(point)) table.set(point, [lead, trail]);
    }
  }
  reverse = table;
  return table;
}

/** The CP949 bytes of `text`, or a `RangeError` naming the first character that has none. */
export function encodeCp949(text: string): Uint8Array {
  const table = reverseTable();
  const out: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0)!;
    const bytes = table.get(point);
    if (bytes === undefined) {
      throw new RangeError(`U+${point.toString(16)} ("${character}") is not a CP949 character`);
    }
    out.push(...bytes);
  }
  return Uint8Array.from(out);
}

/** The text those CP949 bytes stand for - the inverse of `encodeCp949`, for logs and tests. */
export function decodeCp949(bytes: Uint8Array): string {
  return new TextDecoder("euc-kr").decode(bytes);
}
