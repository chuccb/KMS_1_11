/** Fixed-resolution display lifecycle. World/UI rendering is owned by scene-surface.ts. */
import { RESOLUTION_OPTIONS, originGrid, resolutionId, resolutionLayout } from "./display.ts";
import type { ResolutionId, ResolutionLayout } from "./display.ts";
export { resolutionId } from "./display.ts";
export type { ResolutionId } from "./display.ts";
export const RESOLUTION_STORAGE_KEY = "kms111.resolution";
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
  onScale(layout: ResolutionLayout): void;
  viewport?: DisplayViewport;
  /** A fixed header over the scroll area; its rows are excluded from the centering area. */
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
    mode: ResolutionId = "800x600";
  try {
    storage = viewport.localStorage;
    mode = resolutionId(storage.getItem(RESOLUTION_STORAGE_KEY));
  } catch {
    /* A denied preference store cannot prevent the default 800×600 surface from rendering. */
  }
  select.replaceChildren(
    ...RESOLUTION_OPTIONS.map((definition) => {
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
  const chromeHeight = () => (chrome === undefined ? 0 : chrome.getBoundingClientRect().height);
  let layout = resolutionLayout(
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
    layout = resolutionLayout(measuredWidth, measuredHeight, measuredDpr, mode, measuredChrome);
    if (canvas.width !== layout.backingWidth) canvas.width = layout.backingWidth;
    if (canvas.height !== layout.backingHeight) canvas.height = layout.backingHeight;
    Object.assign(canvas.style, {
      // The bitmap is kept at the chosen physical resolution; inverse DPR affects CSS footprint only.
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
      width: `${layout.backingWidth}px`,
      height: `${layout.backingHeight}px`,
      transformOrigin: "0 0",
      transform: `scale(${1 / layout.dpr})`,
    });
    onScale(layout);
    context.imageSmoothingEnabled = false;
    canvas.dataset.resolution = mode;
    canvas.dataset.deviceScale = "1";
    select.title =
      `${layout.backingWidth}×${layout.backingHeight} · 原像素 1× · DPR ${layout.dpr}` +
      (layout.overflowing ? " · 視窗較小，請捲動；不縮小模糊" : "");
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
    mode = resolutionId(select.value);
    select.value = mode;
    try {
      storage?.setItem(RESOLUTION_STORAGE_KEY, mode);
    } catch {
      /* The session preference remains usable when persistence is unavailable. */
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
