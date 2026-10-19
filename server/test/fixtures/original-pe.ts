/** Read-only PE evidence helper. No runtime game, generated dump or network dependency. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeCp949, decodeCp949 } from "../../src/protocol/cp949.ts";
export function originalPe(name: string) {
  const bytes = readFileSync(resolve(import.meta.dirname, "../../../", name)),
    pe = bytes.readUInt32LE(0x3c),
    optional = pe + 24,
    imageBase = bytes.readUInt32LE(optional + 28),
    sectionTable = optional + bytes.readUInt16LE(pe + 20),
    count = bytes.readUInt16LE(pe + 6);
  function offset(va: number) {
    const rva = va - imageBase;
    for (let index = 0; index < count; index++) {
      const section = sectionTable + index * 40,
        base = bytes.readUInt32LE(section + 12),
        size = bytes.readUInt32LE(section + 16);
      if (rva >= base && rva < base + size) return bytes.readUInt32LE(section + 20) + rva - base;
    }
    throw Error(`Unmapped original VA ${va.toString(16)}`);
  }
  return {
    bytesAt(va: number, length: number) {
      const start = offset(va);
      if (
        !Number.isSafeInteger(length) ||
        length < 1 ||
        offset(va + length - 1) !== start + length - 1
      )
        throw Error("Invalid original PE byte range");
      return Buffer.from(bytes.subarray(start, start + length));
    },
    containsCp949(text: string) {
      return bytes.includes(Buffer.from(encodeCp949(text)));
    },
    ansi(va: number) {
      const start = offset(va),
        end = bytes.indexOf(0, start);
      if (end < 0) throw Error("Unterminated original string");
      return decodeCp949(bytes.subarray(start, end));
    },
    pointer(va: number) {
      return bytes.readUInt32LE(offset(va));
    },
    wide(va: number) {
      const start = offset(va);
      let end = start;
      while (end + 1 < bytes.length && bytes.readUInt16LE(end) !== 0) end += 2;
      return bytes.toString("utf16le", start, end);
    },
  };
}
