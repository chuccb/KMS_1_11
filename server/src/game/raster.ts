/**
 * A tiny RGBA compositor.
 *
 * The server has to hand the browser pictures the 2003 client builds out of many WZ canvases: an
 * avatar is a body, a head, a face, hair and one canvas per worn item, each with its own origin and
 * its own place in the draw order; a whole map is a background stack plus tens of thousands of tile
 * and object canvases. `wz/img.ts` decodes one canvas at a time; this module puts them together.
 *
 * The rules are the ones the original engine uses, and they are small enough to state:
 *
 *   - a canvas is placed by its `origin`: an origin of `(ox, oy)` means the pixel at `(ox, oy)` of
 *     the image lands on the object's position;
 *   - pixels are composited source-over, with the source alpha scaled by an optional alpha (the
 *     map's `back/a`);
 *   - a flipped canvas mirrors around the origin, not around its own centre (see `drawCanvas`);
 *   - a fully transparent pixel still counts for nothing: the destination is left untouched, so
 *     stacking a hundred canvases over the same spot does not darken the background.
 *
 * Everything is plain `Uint8Array` RGBA, the layout `canvasToRgba` produces, so no image library is
 * involved and a test can read the result back pixel by pixel.
 */

/** An RGBA8 image, row-major, no padding. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** An empty (transparent) bitmap. */
export function bitmapOf(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/**
 * Draws `src` over `dst` so that `src`'s `(ox, oy)` lands on `(x, y)` of the destination.
 *
 * `flip` mirrors the source around that origin - what the map's object `f` and a left-facing
 * character do. `alpha` is 0..255 and multiplies the source alpha (map backgrounds carry one).
 */
export function drawCanvas(
  dst: Bitmap,
  src: Bitmap,
  x: number,
  y: number,
  ox = 0,
  oy = 0,
  alpha = 255,
  flip = false,
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  const oxi = Math.round(ox);
  const oyi = Math.round(oy);
  // A flipped canvas mirrors its own columns around the origin: source column `u` lands on
  // `x + ox - u`, so the leftmost destination column is `x + ox - (width - 1)`.
  const startX = flip ? xi + oxi - (src.width - 1) : xi - oxi;
  const startY = yi - oyi;
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  if (a === 0) return;
  const x0 = Math.max(0, startX);
  const x1 = Math.min(dst.width, startX + src.width);
  const y0 = Math.max(0, startY);
  const y1 = Math.min(dst.height, startY + src.height);
  if (x0 >= x1 || y0 >= y1) return;
  const d = dst.data;
  const s = src.data;
  for (let py = y0; py < y1; py++) {
    const sy = py - startY;
    for (let px = x0; px < x1; px++) {
      const sx = flip ? xi + oxi - px : px - startX;
      const si = (sy * src.width + sx) * 4;
      const sa = s[si + 3];
      if (sa === 0) continue;
      const di = (py * dst.width + px) * 4;
      if (sa === 255 && a === 255) {
        d[di] = s[si];
        d[di + 1] = s[si + 1];
        d[di + 2] = s[si + 2];
        d[di + 3] = 255;
        continue;
      }
      const scale = (sa * a) / 255 / 255;
      const da = d[di + 3] / 255;
      const outA = scale + da * (1 - scale);
      if (outA === 0) continue;
      d[di] = Math.round((s[si] * scale + d[di] * da * (1 - scale)) / outA);
      d[di + 1] = Math.round((s[si + 1] * scale + d[di + 1] * da * (1 - scale)) / outA);
      d[di + 2] = Math.round((s[si + 2] * scale + d[di + 2] * da * (1 - scale)) / outA);
      d[di + 3] = Math.round(outA * 255);
    }
  }
}

/** The smallest box around the non-transparent pixels, or `undefined` for a blank bitmap. */
export function boundsOf(
  image: Bitmap,
): { left: number; top: number; right: number; bottom: number } | undefined {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return undefined;
  return { left, top, right, bottom };
}

/** A copy of `box` of `image` (clamped to the image); the same bitmap when the box covers it all. */
export function cropBitmap(
  image: Bitmap,
  box: { left: number; top: number; right: number; bottom: number },
): Bitmap {
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(image.width - 1, box.right);
  const bottom = Math.min(image.height - 1, box.bottom);
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (left === 0 && top === 0 && width === image.width && height === image.height) return image;
  const out = bitmapOf(Math.max(0, width), Math.max(0, height));
  for (let y = 0; y < out.height; y++) {
    const from = ((top + y) * image.width + left) * 4;
    out.data.set(image.data.subarray(from, from + out.width * 4), y * out.width * 4);
  }
  return out;
}
