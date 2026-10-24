/** Fixed 4:3 native-pixel resolution presets: resolution changes world FOV, never sprite size. */
export const RESOLUTION_OPTIONS = [
  { id: "800x600", label: "800 × 600", width: 800, height: 600 },
  { id: "1024x768", label: "1024 × 768", width: 1024, height: 768 },
  { id: "1280x960", label: "1280 × 960", width: 1280, height: 960 },
  { id: "1600x1200", label: "1600 × 1200", width: 1600, height: 1200 },
] as const;
export type ResolutionId = (typeof RESOLUTION_OPTIONS)[number]["id"];
export const DEFAULT_RESOLUTION: ResolutionId = "800x600";
export function resolutionId(value: unknown): ResolutionId {
  return RESOLUTION_OPTIONS.find((option) => option.id === value)?.id ?? DEFAULT_RESOLUTION;
}
export function resolutionSize(value: unknown) {
  const id = resolutionId(value),
    selected = RESOLUTION_OPTIONS.find((option) => option.id === id);
  if (!selected) throw new Error("Validated game resolution is missing");
  return { id, width: selected.width, height: selected.height };
}
/** Align the surface origin and scroll increments to both CSS and device pixel grids. */
export function originGrid(dpr: number): number {
  for (let step = 1; step <= 64; step++)
    if (Math.abs(step * dpr - Math.round(step * dpr)) < 1e-6) return step;
  return 1;
}
export interface ResolutionLayout {
  resolution: ResolutionId;
  resolutionWidth: number;
  resolutionHeight: number;
  /** CSS footprint; the backing remains the exact selected physical-pixel resolution. */
  width: number;
  height: number;
  scale: number;
  dpr: number;
  /** Device pixel scaling is always 1:1; the selected dimensions themselves expand the field. */
  deviceScale: 1;
  backingWidth: number;
  backingHeight: number;
  left: number;
  top: number;
  contentWidth: number;
  contentHeight: number;
  overflowing: boolean;
}
/** Keep the selected raster 1:1 in device pixels. Small browser viewports scroll; never shrink. */
export function resolutionLayout(
  width: number,
  height: number,
  dpr = 1,
  requested: unknown = DEFAULT_RESOLUTION,
  reservedTop = 0,
): ResolutionLayout {
  width = Number.isFinite(width) && width > 0 ? width : 800;
  height = Number.isFinite(height) && height > 0 ? height : 600;
  dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const selected = resolutionSize(requested),
    grid = originGrid(dpr),
    cssWidth = selected.width / dpr,
    cssHeight = selected.height / dpr,
    chrome =
      Number.isFinite(reservedTop) && reservedTop > 0 ? Math.ceil(reservedTop / grid) * grid : 0,
    usable = Math.max(1, height - chrome),
    left = Math.max(0, Math.floor((width - cssWidth) / (2 * grid) + 1e-9) * grid),
    top = chrome + Math.max(0, Math.floor((usable - cssHeight) / (2 * grid) + 1e-9) * grid),
    contentWidth = width + Math.ceil(Math.max(0, left + cssWidth - width) / grid) * grid,
    contentHeight = height + Math.ceil(Math.max(0, top + cssHeight - height) / grid) * grid;
  return {
    resolution: selected.id,
    resolutionWidth: selected.width,
    resolutionHeight: selected.height,
    width: cssWidth,
    height: cssHeight,
    scale: 1 / dpr,
    dpr,
    deviceScale: 1,
    backingWidth: selected.width,
    backingHeight: selected.height,
    left,
    top,
    contentWidth,
    contentHeight,
    overflowing: cssWidth > width + 1e-6 || cssHeight > usable + 1e-6,
  };
}
