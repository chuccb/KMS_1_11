/** Evidence anchors read ORIGINAL binaries, not generated assets or later-version constants.
 * These guards support manual C/listing cross-checks; they are not native runtime/pixel parity.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
function originalPe(name: string) {
  const bytes = readFileSync(resolve(import.meta.dirname, "../../", name)),
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
test("original EXE CUtilDlg vtable/UTF16 Notice,YesNo,DlgNotice,Gulim; original Shape2D RelMove and integer interpolator vtable anchors", () => {
  const exe = originalPe("MapleStory.exe"),
    shape = originalPe("Shape2D.dll");
  assert.equal(exe.pointer(0x587720 + 0x0c), 0x52b8b0);
  assert.equal(exe.pointer(0x587720 + 0x1c), 0x52bdc0);
  assert.equal(exe.pointer(0x587720 + 0x28), 0x52c4c0);
  assert.equal(exe.wide(0x5bca8c), "UI/Basic.img/Notice/backgrnd");
  assert.equal(exe.wide(0x5be5c0), "UI/Basic.img/YesNo/backgrnd");
  assert.equal(exe.wide(0x5be598), "UI/Basic.img/BtYes");
  assert.equal(exe.wide(0x5be5f8), "DlgNotice");
  assert.equal(exe.wide(0x5b3a00), "굴림");
  assert.equal(shape.pointer(0x10019160 + 0x98), 0x10011030);
  assert.equal(shape.pointer(0x100199f8 + 8), 0x10010c40);
});
