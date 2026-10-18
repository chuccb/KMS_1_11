/** Presentation policy: 4:3, integer DEVICE pixels only. Never downsample to fit.
 * A small viewport scrolls the full surface instead of destroying source pixels.
 * Manual sizes are physical pixel multiples (not CSS multiples under fractional OS/browser zoom).
 */
export const DISPLAY_MODES = ["pixel", "pixel-1", "pixel-2", "pixel-3", "pixel-4"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];
export const DISPLAY_OPTIONS: readonly { id: DisplayMode; label: string }[] = [
  { id: "pixel", label: "清晰自動 · 等比例" },
  { id: "pixel-1", label: "清晰 1× · 800×600 實體像素" },
  { id: "pixel-2", label: "清晰 2× · 1600×1200 實體像素" },
  { id: "pixel-3", label: "清晰 3× · 2400×1800 實體像素" },
  { id: "pixel-4", label: "清晰 4× · 3200×2400 實體像素" },
];
export function displayMode(value: unknown): DisplayMode {
  // Retired fractional fit/native preferences migrate to a clear policy, never restore blur.
  if (value === "native") return "pixel-1";
  return DISPLAY_MODES.find((mode) => mode === value) ?? "pixel";
}
/** Align both CSS and device grids (Chromium snaps paint origins in CSS space). */
export function originGrid(dpr: number): number {
  for (let step = 1; step <= 64; step++)
    if (Math.abs(step * dpr - Math.round(step * dpr)) < 1e-6) return step;
  return 1;
}
export function viewLayout(width: number, height: number, dpr = 1, requested: unknown = "pixel") {
  width = Number.isFinite(width) && width > 0 ? width : 800;
  height = Number.isFinite(height) && height > 0 ? height : 600;
  dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const mode = displayMode(requested);
  const deviceScale =
    mode === "pixel"
      ? Math.max(1, Math.min(4, Math.floor(Math.min(width / 800, height / 600) * dpr + 1e-9)))
      : Number(mode.slice(-1));
  const scale = deviceScale / dpr,
    cssWidth = 800 * scale,
    cssHeight = 600 * scale;
  const grid = originGrid(dpr);
  return {
    width: cssWidth,
    height: cssHeight,
    scale,
    dpr,
    deviceScale,
    backingWidth: 800 * deviceScale,
    backingHeight: 600 * deviceScale,
    left: Math.max(0, Math.floor((width - cssWidth) / (2 * grid) + 1e-9) * grid),
    top: Math.max(0, Math.floor((height - cssHeight) / (2 * grid) + 1e-9) * grid),
    // Pad only the scroll tail, so even the browser-clamped END remains on both grids.
    contentWidth: width + Math.ceil(Math.max(0, cssWidth - width) / grid) * grid,
    contentHeight: height + Math.ceil(Math.max(0, cssHeight - height) / grid) * grid,
    overflowing: cssWidth > width + 1e-6 || cssHeight > height + 1e-6,
  };
}
export type ViewLayout = ReturnType<typeof viewLayout>;
