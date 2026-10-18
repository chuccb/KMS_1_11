/** Presentation only: never change the original 800x600 simulation/hit-test coordinate system.
 * Pixel mode maps each source pixel to an integer square of DEVICE pixels, not CSS pixels.
 * Browser zoom / OS scaling is included in devicePixelRatio. A tiny viewport must downsample. */
export const DISPLAY_MODES = ["pixel", "native", "fit"] as const;
/** Chromium snaps a canvas paint origin in CSS space before device rasterization. Align BOTH
 * grids: at DPR 1.25 the shared grid is 4 CSS px; at DPR 2 it is 1 CSS px, not half a CSS px. */
function originGrid(dpr: number) {
  for (let step = 1; step <= 64; step++)
    if (Math.abs(step * dpr - Math.round(step * dpr)) < 1e-6) return step;
  return 1; // Unusual irrational DPR: exact alignment of both grids is not representable.
}
export function viewLayout(width: number, height: number, dpr = 1, mode = "pixel") {
  width = Number.isFinite(width) && width > 0 ? width : 800;
  height = Number.isFinite(height) && height > 0 ? height : 600;
  dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const fit = Math.min(width / 800, height / 600);
  let scale = fit;
  if (mode === "native") scale = Math.min(1, fit);
  else if (mode !== "fit" && fit * dpr >= 1) scale = Math.floor(fit * dpr + 1e-9) / dpr;
  const cssWidth = 800 * scale,
    cssHeight = 600 * scale;
  const grid = originGrid(dpr);
  return {
    width: cssWidth,
    height: cssHeight,
    scale,
    dpr,
    left: Math.max(0, Math.floor((width - cssWidth) / (2 * grid) + 1e-9) * grid),
    top: Math.max(0, Math.floor((height - cssHeight) / (2 * grid) + 1e-9) * grid),
    deviceScale: scale * dpr,
    downsampled: scale * dpr < 1 - 1e-9,
  };
}
