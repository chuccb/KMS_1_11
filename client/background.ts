export interface BackgroundLayer {
  x: number;
  y: number;
  rx: number;
  ry: number;
  type: number;
  cx: number;
  cy: number;
  ox?: number;
  oy?: number;
}
/** KMS 1.11 46BDA0/46D220, not a later client's 4..7 auto-scroll table.
 * Type 4: a repeating horizontal 100px relative move, duration abs(trunc(20000/rx)) ms,
 * x camera ratio=0, y ratio=ry; tile horizontally. Shape2D 10010AD0/10010C40's
 * 0x10000000 flag accumulates that delta each period (does NOT ping-pong).
 * All other nonzero types: low bits 1/2 select horizontal/vertical tiling; rx/ry are parallax.
 */
export function backgroundDrift(rx: number, elapsedMs: number): number {
  if (!rx || !Number.isFinite(rx)) return 0;
  const duration = Math.abs(Math.trunc(20000 / rx));
  if (!duration) return 0;
  const elapsed = Math.max(0, elapsedMs);
  const distance =
    100 * Math.floor(elapsed / duration) + Math.trunc((100 * (elapsed % duration)) / duration);
  return rx > 0 ? -distance : distance;
}
const tileStart = (value: number, step: number) => (((value % step) + step) % step) - step;
export function backgroundLayout(
  back: BackgroundLayer,
  width: number,
  height: number,
  cameraX: number,
  cameraY: number,
  elapsedMs: number,
  viewW: number = 800,
  viewH: number = 600,
): {
  x: number;
  y: number;
  stepX: number;
  stepY: number;
  columns: number;
  rows: number;
} {
  const stepX = back.cx > 0 ? back.cx : width;
  const stepY = back.cy > 0 ? back.cy : height;
  const horizontal = back.type === 4 || !!(back.type & 1);
  const vertical = back.type !== 4 && !!(back.type & 2);
  const ox = back.ox ?? 0,
    oy = back.oy ?? 0;
  let x =
    back.x +
    viewW / 2 +
    (back.type === 4
      ? backgroundDrift(back.rx, elapsedMs)
      : (back.rx * (viewW / 2 + cameraX)) / 100);
  let y = back.y + viewH / 2 + (back.ry * (viewH / 2 + cameraY)) / 100;
  // Normalize the footprint, not the origin; large canvas origins must not leave a viewport gap.
  if (horizontal) x = tileStart(x - ox, stepX) + ox;
  if (vertical) y = tileStart(y - oy, stepY) + oy;
  return {
    x,
    y,
    stepX,
    stepY,
    columns: horizontal ? Math.ceil(viewW / stepX) + 3 : 1,
    rows: vertical ? Math.ceil(viewH / stepY) + 3 : 1,
  };
}
