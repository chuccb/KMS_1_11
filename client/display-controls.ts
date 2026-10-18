/** Browser presentation control; never changes simulation/hit-test coordinates or sends packets. */
import { DISPLAY_MODES, viewLayout } from "./display.ts";
export const DISPLAY_STORAGE_KEY = "kms111.displayMode";
export type DisplayMode = (typeof DISPLAY_MODES)[number];
export function displayMode(value: unknown): DisplayMode {
  return DISPLAY_MODES.find((mode) => mode === value) ?? "pixel";
}
interface DisplayViewport extends Pick<EventTarget, "addEventListener" | "removeEventListener"> {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly localStorage: Pick<Storage, "getItem" | "setItem">;
}
interface DisplayControlsOptions {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  overlay: HTMLElement;
  select: HTMLSelectElement;
  onScale(scale: number): void;
  viewport?: DisplayViewport;
}
export function displayControls({
  canvas,
  context,
  overlay,
  select,
  onScale,
  viewport = window,
}: DisplayControlsOptions) {
  let storage: Pick<Storage, "getItem" | "setItem"> | undefined,
    mode: DisplayMode = "pixel";
  try {
    storage = viewport.localStorage;
    mode = displayMode(storage.getItem(DISPLAY_STORAGE_KEY));
  } catch {
    /* Preference storage may be denied independently of rendering. */
  }
  let measuredWidth = Number.NaN,
    measuredHeight = Number.NaN,
    measuredDpr = Number.NaN;
  let disposed = false;
  select.value = mode;
  function resize() {
    if (disposed) return;
    // Assigning backing dimensions clears the canvas, so do not do it on mode/window/DPR changes.
    if (canvas.width !== 800) canvas.width = 800;
    if (canvas.height !== 600) canvas.height = 600;
    measuredWidth = viewport.innerWidth;
    measuredHeight = viewport.innerHeight;
    measuredDpr = viewport.devicePixelRatio;
    const layout = viewLayout(measuredWidth, measuredHeight, measuredDpr, mode);
    Object.assign(canvas.style, {
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      left: `${layout.left}px`,
      top: `${layout.top}px`,
    });
    Object.assign(overlay.style, {
      left: `${layout.left}px`,
      top: `${layout.top}px`,
      transform: `scale(${layout.scale})`,
    });
    onScale(layout.scale);
    context.imageSmoothingEnabled = false;
    canvas.dataset.displayMode = mode;
    select.title = `800×600 → ${Math.round(layout.width)}×${Math.round(layout.height)} CSS px · DPR ${layout.dpr} · 每原像素 ${Number(layout.deviceScale.toFixed(3))} 實體像素${layout.downsampled ? "（視窗太小，正在縮小）" : ""}`;
  }
  function change() {
    mode = displayMode(select.value);
    select.value = mode;
    try {
      storage?.setItem(DISPLAY_STORAGE_KEY, mode);
    } catch {
      /* Session-only still works. */
    }
    resize();
  }
  select.addEventListener("change", change);
  viewport.addEventListener("resize", resize);
  resize();
  return {
    resize,
    mode: () => mode,
    /** Called by the existing app frame, including title/selection. DPR-only changes do not
     * reliably emit resize/matchMedia events (also reproduced in Chromium CDP). No new timer
     * or RAF loop: compare three scalars and relayout only when a browser measurement changes.
     */
    refresh() {
      if (
        viewport.innerWidth !== measuredWidth ||
        viewport.innerHeight !== measuredHeight ||
        viewport.devicePixelRatio !== measuredDpr
      )
        resize();
    },
    dispose() {
      disposed = true;
      select.removeEventListener("change", change);
      viewport.removeEventListener("resize", resize);
    },
  };
}
