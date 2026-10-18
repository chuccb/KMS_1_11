export interface CursorMetadata {
  width: number;
  height: number;
  ox: number;
  oy: number;
}
function cursorMetadata(raw: unknown): CursorMetadata {
  if (!raw || typeof raw !== "object") throw new Error("missing native cursor metadata");
  const data = raw as Record<string, unknown>;
  if (
    ![data.width, data.height, data.ox, data.oy].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  )
    throw new Error("invalid native cursor metadata");
  return data as unknown as CursorMetadata;
}
/** CWvsApp 553320 -> UI/Basic.img/Cursor/arrow -> 556D60; Gr2D_DX8 10008430/10008120.
 * This archive has ONE arrow, not the later hand/pressed/animated cursor set. Keep it in the
 * browser's cursor plane (no RAF sprite, no input interception), over canvas AND native DOM UI.
 */
export const CURSOR_PATH = "UI/Basic.img/Cursor/arrow";

/** CSS cursor bitmaps have implementation-specific limits (commonly 128x128). Scale with the
 * 800x600 surface, NOT again with DPR: the browser/OS already applies device scaling to cursors.
 * At extreme zoom cap the bitmap instead of silently losing the native cursor altogether.
 */
export function cursorLayout(meta: CursorMetadata, scale = 1) {
  const { width, height, ox, oy } = meta;
  if (![width, height, ox, oy].every(Number.isFinite) || width < 1 || height < 1)
    throw new Error("invalid native cursor canvas metadata");
  const factor = Math.min(
    Number.isFinite(scale) && scale > 0 ? scale : 1,
    128 / Math.max(width, height),
  );
  const w = Math.max(1, Math.round(width * factor)),
    h = Math.max(1, Math.round(height * factor));
  return {
    width: w,
    height: h,
    x: Math.max(0, Math.min(w - 1, Math.round((ox * w) / width))),
    y: Math.max(0, Math.min(h - 1, Math.round((oy * h) / height))),
  };
}

export function nativeCursor({
  surfaces,
  onError = () => {},
}: {
  surfaces: readonly HTMLElement[];
  onError?: (error: unknown) => void;
}) {
  let scale = 1;
  let meta: CursorMetadata | undefined,
    source: HTMLImageElement | undefined,
    lastSize: string | undefined;
  function paint() {
    if (!meta || !source) return;
    const at = cursorLayout(meta, scale),
      size = `${at.width}:${at.height}`;
    if (size === lastSize) return;
    const raster = document.createElement("canvas");
    raster.width = at.width;
    raster.height = at.height;
    const ctx = raster.getContext("2d");
    if (!ctx) throw new Error("native cursor raster unavailable");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, at.width, at.height);
    const value = `url("${raster.toDataURL("image/png")}") ${at.x} ${at.y}, url("/api/png/${encodeURIComponent(CURSOR_PATH)}") ${Math.max(0, Math.round(meta.ox))} ${Math.max(0, Math.round(meta.oy))}, default`;
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
    resize(value: number) {
      scale = value;
      try {
        paint();
      } catch (error) {
        onError(error);
      }
    },
  };
}
