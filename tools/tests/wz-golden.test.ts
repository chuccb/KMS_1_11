import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WzArchive } from "../../server/src/wz/archive.ts";

interface GoldenImage {
  path: string;
  size: number;
  checksum: number;
  offset: number;
  source: string;
}
interface GoldenManifest {
  file_size: number;
  wz_version: number;
  tree_end: number;
  images: GoldenImage[];
}
const root = resolve(import.meta.dirname, "../..");

test("TypeScript archive agrees with the saved independent Python manifest and raw-byte checksums", () => {
  // This file is existing evidence, not regenerated from the implementation under test.
  const golden: GoldenManifest = JSON.parse(
    readFileSync(resolve(root, "analysis/data_wz_manifest.json"), "utf8"),
  );
  const bytes = readFileSync(resolve(root, "Data.wz"));
  const archive = WzArchive.open(resolve(root, "Data.wz"));
  expect(bytes.length).toBe(golden.file_size);
  expect(archive.wzVersion).toBe(golden.wz_version);
  expect(archive.treeEnd).toBe(golden.tree_end);
  expect(archive.images.length).toBe(1056);
  let offset = golden.tree_end;
  for (const image of golden.images) {
    const actual = archive.image(image.path)!;
    expect(actual.size).toBe(image.size);
    expect(actual.dataOffset).toBe(image.offset);
    expect(String(actual.source)).toBe(image.source);
    expect(image.offset).toBe(offset);
    const checksum = bytes
      .subarray(image.offset, image.offset + image.size)
      .reduce((sum, byte) => (sum + byte) | 0, 0);
    expect(checksum).toBe(image.checksum);
    offset += image.size;
  }
  expect(offset).toBe(bytes.length);
});
