/** Display lifecycle only. Main owns a separate logical render surface; UI/input remain 800×600. */
import { DISPLAY_OPTIONS, displayMode, originGrid, viewLayout } from "./display.ts";
import type { DisplayMode, ViewLayout } from "./display.ts";
export { displayMode } from "./display.ts";
export type { DisplayMode } from "./display.ts";
export const DISPLAY_STORAGE_KEY = "kms111.displayMode";
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
  stage: HTMLElement;
  scroll: HTMLElement;
  select: HTMLSelectElement;
  onScale(layout: ViewLayout): void;
  viewport?: DisplayViewport;
  /**
   * A fixed element that overlays the top of the scroll area - the header bar. Its height is
   * removed from the usable area so the surface is never tucked underneath it. A header that is
   * hidden (the title screen hides it) measures 0 and reserves nothing.
   */
  chrome?: HTMLElement;
}
export function displayControls({
  canvas,
  context,
  overlay,
  stage,
  scroll,
  select,
  onScale,
  viewport = window,
  chrome,
}: DisplayControlsOptions) {
  let storage: Pick<Storage, "getItem" | "setItem"> | undefined,
    mode: DisplayMode = "pixel";
  try {
    storage = viewport.localStorage;
    mode = displayMode(storage.getItem(DISPLAY_STORAGE_KEY));
  } catch {
    /* Preference denial cannot stop rendering. */
  }
  select.replaceChildren(
    ...DISPLAY_OPTIONS.map((definition) => {
      const option = select.ownerDocument.createElement("option");
      option.value = definition.id;
      option.textContent = definition.label;
      return option;
    }),
  );
  select.value = mode;
  let measuredWidth = NaN,
    measuredHeight = NaN,
    measuredDpr = NaN,
    measuredChrome = NaN,
    disposed = false;
  // `display: none` measures 0, so a hidden header is already "reserves nothing".
  const chromeHeight = () => (chrome === undefined ? 0 : chrome.getBoundingClientRect().height);
  let layout = viewLayout(
    viewport.innerWidth,
    viewport.innerHeight,
    viewport.devicePixelRatio,
    mode,
  );
  const available = () => ({
    width: scroll.clientWidth || viewport.innerWidth,
    height: (scroll.clientHeight || viewport.innerHeight) - chromeHeight(),
  });
  function resize() {
    if (disposed) return;
    const size = available();
    measuredWidth = size.width;
    measuredHeight = size.height;
    measuredDpr = viewport.devicePixelRatio;
    measuredChrome = chromeHeight();
    layout = viewLayout(measuredWidth, measuredHeight, measuredDpr, mode, measuredChrome);
    // Only an actual device-scale change reallocates the output. The logical renderer is separate.
    if (canvas.width !== layout.backingWidth) canvas.width = layout.backingWidth;
    if (canvas.height !== layout.backingHeight) canvas.height = layout.backingHeight;
    Object.assign(canvas.style, {
      // CSS layout quantizes fractional widths to 1/64px. Keep the bitmap at its exact
      // integer size and compensate density in the transform, not a lossy layout resize.
      width: `${layout.backingWidth}px`,
      height: `${layout.backingHeight}px`,
      transformOrigin: "0 0",
      transform: `scale(${1 / layout.dpr})`,
      left: `${layout.left}px`,
      top: `${layout.top}px`,
    });
    Object.assign(stage.style, {
      width: `${layout.contentWidth}px`,
      height: `${layout.contentHeight}px`,
    });
    Object.assign(overlay.style, {
      left: `${layout.left}px`,
      top: `${layout.top}px`,
      transform: `scale(${layout.scale})`,
    });
    onScale(layout);
    context.imageSmoothingEnabled = false;
    canvas.dataset.displayMode = mode;
    canvas.dataset.deviceScale = String(layout.deviceScale);
    select.title = `4:3 · ${layout.backingWidth}×${layout.backingHeight} 實體像素 · DPR ${layout.dpr} · 原像素 ${layout.deviceScale}×${layout.deviceScale}${layout.overflowing ? " · 視窗較小，請捲動；不縮小模糊" : ""}`;
    alignScroll();
  }
  function alignScroll() {
    if (disposed) return;
    const grid = originGrid(layout.dpr);
    for (const axis of ["scrollLeft", "scrollTop"] as const) {
      const value = scroll[axis];
      if (Number.isFinite(value)) {
        const snapped = Math.round(value / grid) * grid;
        if (Math.abs(snapped - value) > 1e-6) scroll[axis] = snapped;
      }
    }
  }
  function change() {
    mode = displayMode(select.value);
    select.value = mode;
    try {
      storage?.setItem(DISPLAY_STORAGE_KEY, mode);
    } catch {
      /* Session preference remains usable. */
    }
    resize();
  }
  select.addEventListener("change", change);
  viewport.addEventListener("resize", resize);
  scroll.addEventListener("scroll", alignScroll);
  resize();
  return {
    resize,
    mode: () => mode,
    layout: () => layout,
    refresh() {
      const size = available();
      if (
        size.width !== measuredWidth ||
        size.height !== measuredHeight ||
        viewport.devicePixelRatio !== measuredDpr ||
        chromeHeight() !== measuredChrome
      )
        resize();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      select.removeEventListener("change", change);
      viewport.removeEventListener("resize", resize);
      scroll.removeEventListener("scroll", alignScroll);
    },
  };
}
