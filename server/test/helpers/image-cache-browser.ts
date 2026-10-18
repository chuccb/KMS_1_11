/** Strict-TS browser fixture entry, bundled in memory by the test. Not shipped with the game. */
import { avatarImages } from "../../../client/image-cache.ts";
let created = 0,
  revoked = 0;
const cache = avatarImages({
  createUrl(blob) {
    created++;
    return URL.createObjectURL(blob);
  },
  revokeUrl(url) {
    revoked++;
    URL.revokeObjectURL(url);
  },
});
try {
  const look = { face: 20000, hair: 30000, items: [1040001, 1060001, 1071000, 1302000] };
  const entry = cache.get(look, "stand1", 0, false, undefined, true);
  if (entry.ready) throw new Error("Cache skipped asynchronous PNG loading");
  await entry.loading;
  if (!entry.ready || entry.img.naturalWidth <= 0 || entry.img.naturalHeight <= 0)
    throw new Error("Real avatar PNG failed to decode");
  if (entry.planeHeight <= 0 || entry.img.naturalHeight !== entry.planeHeight * 2)
    throw new Error("Invalid packed plane metadata");
  if (cache.get(look, "stand1", 0, false, undefined, true) !== entry)
    throw new Error("Identical pose lost cache identity");
  if (created !== 1 || revoked !== 1) throw new Error("Blob URL lifetime mismatch");
  const canvas = document.createElement("canvas");
  canvas.width = entry.img.naturalWidth;
  canvas.height = entry.img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.drawImage(entry.img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let visible = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visible++;
  if (!visible) throw new Error("Decoded image lost pixels after blob revocation");
  document.body.textContent = JSON.stringify({
    width: canvas.width,
    height: canvas.height,
    planeHeight: entry.planeHeight,
    dx: entry.dx,
    dy: entry.dy,
    damageOriginY: entry.damageOriginY,
    created,
    revoked,
    visible,
  });
  document.documentElement.dataset.fixtureState = "ready";
} catch (error) {
  document.body.textContent = String(error);
  document.documentElement.dataset.fixtureState = "failed";
}
