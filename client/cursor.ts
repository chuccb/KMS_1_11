export interface CursorMetadata {
  width: number;
  height: number;
  ox: number;
  oy: number;
}
function cursorMetadata(raw: unknown): CursorMetadata {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("width" in raw) ||
    !("height" in raw) ||
    !("ox" in raw) ||
    !("oy" in raw)
  )
    throw new Error("missing native cursor metadata");
  const { width, height, ox, oy } = raw;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof ox !== "number" ||
    typeof oy !== "number" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isFinite(ox) ||
    !Number.isFinite(oy)
  )
    throw new Error("invalid native cursor metadata");
  return { width, height, ox, oy };
}
/** CWvsApp 553320 -> UI/Basic.img/Cursor/arrow -> 556D60; Gr2D_DX8 10008430/10008120.
 * This archive has ONE arrow, not the later hand/pressed/animated cursor set. Keep it in the
 * browser's cursor plane (no RAF sprite, no input interception), over canvas AND native DOM UI.
 */
export const CURSOR_PATH = "UI/Basic.img/Cursor/arrow";

/** Rasterize only whole physical pixel blocks; image-set declares their actual density.
 * Rounding a fractional CSS bitmap first would discard pixels at DPR 1.25/1.5. Keep native
 * source pixels, cap by whole factors for the browser/OS 128px cursor budget, never downsample.
 * Cursor hotspots are CSS integers; this archive's native arrow hotspot is exactly (0,0).
 */
export function cursorLayout(meta: CursorMetadata, deviceScale = 1, dpr = 1) {
  const { width, height, ox, oy } = cursorMetadata(meta);
  if (
    !Number.isInteger(deviceScale) ||
    deviceScale < 1 ||
    deviceScale > 4 ||
    !Number.isFinite(dpr) ||
    dpr <= 0
  )
    throw new Error("invalid native cursor device scale/density");
  const factor = Math.min(
    deviceScale,
    Math.floor(128 / Math.max(width, height)),
    Math.floor((128 * dpr) / Math.max(width, height)),
  );
  if (factor < 1) throw new Error("native cursor cannot fit without losing source pixels");
  const w = width * factor,
    h = height * factor;
  return {
    width: w,
    height: h,
    x: Math.max(0, Math.min(Math.floor((w - 1) / dpr), Math.round((ox * factor) / dpr))),
    y: Math.max(0, Math.min(Math.floor((h - 1) / dpr), Math.round((oy * factor) / dpr))),
  };
}

export function nativeCursor({
  surfaces,
  onError = () => {},
}: {
  surfaces: readonly HTMLElement[];
  onError?: (error: unknown) => void;
}) {
  let scale = 1,
    density = 1;
  let meta: CursorMetadata | undefined,
    source: HTMLImageElement | undefined,
    lastSize: string | undefined;
  function paint() {
    if (!meta || !source) return;
    const at = cursorLayout(meta, scale, density),
      size = `${at.width}:${at.height}:${density}`;
    if (size === lastSize) return;
    const raster = document.createElement("canvas");
    raster.width = at.width;
    raster.height = at.height;
    const ctx = raster.getContext("2d");
    if (!ctx) throw new Error("native cursor raster unavailable");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, at.width, at.height);
    const value = `image-set(url("${raster.toDataURL("image/png")}") ${density}x) ${at.x} ${at.y}, default`;
    for (const surface of surfaces) {
      surface.style.setProperty("--native-cursor", value);
      surface.classList.add("native-cursor-ready");
    }
    lastSize = size;
  }
  const ready = (async () => {
    const response = await fetch(`/api/canvas/${encodeURIComponent(CURSOR_PATH)}`);
    if (!response.ok) throw new Error(`native cursor metadata: HTTP ${response.status}`);
    meta = cursorMetadata(await response.json());
    cursorLayout(meta); // Reject malformed metadata before allocating a bitmap.
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("native cursor PNG could not be decoded"));
      image.src = `/api/png/${encodeURIComponent(CURSOR_PATH)}`;
    });
    if (image.naturalWidth !== meta.width || image.naturalHeight !== meta.height)
      throw new Error("native cursor PNG/metadata dimensions disagree");
    source = image;
    paint();
  })().catch(onError);
  return {
    ready,
    resize(value: number, dpr: number) {
      scale = value;
      density = dpr;
      try {
        paint();
      } catch (error) {
        onError(error);
      }
    },
  };
}
