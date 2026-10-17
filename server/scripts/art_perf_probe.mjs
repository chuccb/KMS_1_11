/** Cold provider work, and actual PNG compressions (not just HTTP cache hits). No Data.wz writes. */
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
let compressions = 0;
const original = zlib.deflateSync;
zlib.deflateSync = function (...args) {
  compressions++;
  return original.apply(this, args);
};
syncBuiltinESMExports();
try {
  const { WzArchive } = await import("../src/wz/archive.ts");
  const { artProviderOf } = await import("../src/game/art.ts");
  const archive = WzArchive.open(
      process.argv[2] ??
        fileURLToPath(new URL("../../Data.wz", import.meta.url)),
    ),
    provider = artProviderOf(archive);
  let start = performance.now();
  const map = provider.mapArt(1000000);
  const mapMs = performance.now() - start;
  assert.ok(map);
  assert.equal(compressions, 0, "metadata must not compress any PNGs");
  start = performance.now();
  for (let frame = 0; frame < 3; frame++)
    assert.ok(
      provider.avatar(
        {
          face: 20000,
          hair: 30000,
          items: [1040002, 1060002, 1072001, 1302000],
        },
        { stance: "walk1", frame },
      ),
    );
  const avatarMs = performance.now() - start;
  assert.equal(
    compressions,
    3,
    "only the final three avatar PNGs, not all their unused body-part PNGs",
  );
  const canvas = provider.reader.at(map.sprites[0].frames[0].path);
  assert.ok(canvas);
  const png = canvas.png;
  assert.equal(compressions, 4);
  assert.equal(canvas.png, png);
  assert.equal(
    compressions,
    4,
    "repeated PNG read shares the cached compressed buffer",
  );
  console.log(
    JSON.stringify(
      {
        coldMapMetadataMs: mapMs,
        mapPngCompressions: 0,
        sprites: map.sprites.length,
        threeAvatarFramesMs: avatarMs,
        avatarPngCompressions: 3,
        cachedPngReused: true,
      },
      null,
      2,
    ),
  );
} finally {
  zlib.deflateSync = original;
  syncBuiltinESMExports();
}
