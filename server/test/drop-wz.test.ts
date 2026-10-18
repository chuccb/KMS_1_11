/** Original archive only: no network/game sessions or save access. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { auditDropLandings } from "../../tools/audit-drop-landing.ts";
import { mesoFramePath } from "../../client/drop-renderer.ts";

test("all 100 original WZ maps: 379422 slope/edge/jump drops survive native packets and browser landing/depth", () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const report = auditDropLandings(archive);
  assert.equal(report.maps, 100);
  assert.equal(report.floors, 21079);
  assert.equal(report.slopes, 11810);
  assert.equal(report.samples, 379422);
  assert.deepEqual(report.floorless, []);
});
test("original reward icons have variable sizes/origins; all 16 money frames and sample item PNGs reach their bottom pixel", () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")),
    reader = artReaderOf(archive)!,
    catalog = itemCatalogOf(archive)!;
  const icons = [4000019, 2000000, 1302000, 1452000].map((id) => {
    const icon = catalog.info(id)?.iconRaw;
    assert.ok(icon);
    return icon;
  });
  assert.deepEqual(
    icons.map((icon) => [icon.width, icon.height, icon.ox, icon.oy]),
    [
      [25, 25, -4, 27],
      [27, 27, -3, 30],
      [31, 29, 0, 30],
      [31, 31, 0, 31],
    ],
  );
  const paths = [
    ...icons.map((icon) => icon.path),
    ...[1, 50, 100, 1000].flatMap((amount) =>
      Array.from({ length: 4 }, (_, frame) => mesoFramePath(amount, frame * 140)),
    ),
  ];
  for (const path of paths) {
    const art = reader.at(path);
    assert.ok(art, path);
    assert.ok(art.png.length > 0);
    const bottom = art.rgba.subarray((art.height - 1) * art.width * 4);
    assert.ok(
      Array.from({ length: art.width }, (_, x) => bottom[x * 4 + 3]).some((alpha) => alpha !== 0),
      path,
    );
  }
});
