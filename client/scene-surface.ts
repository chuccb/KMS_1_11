/** Separate native-pixel world and UI passes on one bounded, crisp canvas. */
import { requireContext2d } from "./dom.ts";
export interface SceneViewport {
  width: number;
  height: number;
  /** World units represented by one output pixel; inverse-projection factor for pointer input. */
  zoom: number;
  pixelScale: number;
  /** Kept for the integer-scale lens fixture; fixed-resolution UI does not use this as a scale. */
  uiScale: number;
}
export interface ResolutionSize {
  width: number;
  height: number;
}
export function sceneViewport(uiScale: number, pixelScale = uiScale): SceneViewport {
  if (
    !Number.isInteger(uiScale) ||
    uiScale < 1 ||
    uiScale > 4 ||
    !Number.isInteger(pixelScale) ||
    pixelScale < 1 ||
    pixelScale > 12
  )
    throw new Error("Scene scales must be bounded positive integer device pixels");
  return {
    width: (800 * uiScale) / pixelScale,
    height: (600 * uiScale) / pixelScale,
    zoom: pixelScale / uiScale,
    pixelScale,
    uiScale,
  };
}
/** The selected resolution is the world raster size. `pixelScale` is an independent lens choice. */
export function sceneViewportForResolution(
  resolutionWidth: number,
  resolutionHeight: number,
  pixelScale = 1,
): SceneViewport {
  if (
    !Number.isSafeInteger(resolutionWidth) ||
    !Number.isSafeInteger(resolutionHeight) ||
    resolutionWidth < 800 ||
    resolutionWidth > 1600 ||
    resolutionHeight < 600 ||
    resolutionHeight > 1200 ||
    Math.abs(resolutionWidth / resolutionHeight - 4 / 3) > 1e-12 ||
    !Number.isInteger(pixelScale) ||
    pixelScale < 1 ||
    pixelScale > 3
  )
    throw new Error("Invalid bounded 4:3 native-pixel resolution/lens scale");
  return {
    width: resolutionWidth / pixelScale,
    height: resolutionHeight / pixelScale,
    zoom: pixelScale,
    pixelScale,
    uiScale: 1,
  };
}
export function sceneSurface(canvas: HTMLCanvasElement) {
  const output = requireContext2d(canvas),
    buffer = canvas.ownerDocument.createElement("canvas"),
    context = requireContext2d(buffer);
  let viewport = sceneViewport(1),
    width = 800,
    height = 600,
    geometryChanged = false;
  buffer.width = width;
  buffer.height = height;
  function ensureBuffer(w: number, h: number) {
    // Keep the largest bounded dimensions reached, so a wide world pass and full-size UI pass do
    // not reallocate the shared canvas on every animation frame.
    if (buffer.width < w) buffer.width = w;
    if (buffer.height < h) buffer.height = h;
  }
  function clear() {
    context.resetTransform();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, buffer.width, buffer.height);
    context.imageSmoothingEnabled = false;
  }
  return {
    context,
    viewport: () => viewport,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    beginWorld(next: SceneViewport) {
      geometryChanged =
        viewport.width !== next.width ||
        viewport.height !== next.height ||
        viewport.zoom !== next.zoom ||
        viewport.pixelScale !== next.pixelScale;
      viewport = next;
      width = next.width;
      height = next.height;
      ensureBuffer(
        Math.max(800, Math.ceil(width), canvas.width),
        Math.max(600, Math.ceil(height), canvas.height),
      );
      clear();
      output.resetTransform();
      output.globalAlpha = 1;
      output.globalCompositeOperation = "source-over";
      output.imageSmoothingEnabled = false;
      output.fillStyle = "#000";
      output.fillRect(0, 0, canvas.width, canvas.height);
    },
    presentWorld(cover = 0, style: "fade" | "shutter" = "fade") {
      output.save();
      try {
        output.resetTransform();
        output.globalAlpha = 1;
        output.imageSmoothingEnabled = false;
        const sourceWidth = Math.ceil(viewport.width),
          sourceHeight = Math.ceil(viewport.height);
        output.drawImage(
          buffer,
          0,
          0,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth * viewport.pixelScale,
          sourceHeight * viewport.pixelScale,
        );
        output.fillStyle = "#000";
        const bounded = Number.isFinite(cover) ? Math.max(0, Math.min(1, cover)) : 0;
        // RAF can skip the exact opacity peak. The first actually painted new FOV must still
        // be fully hidden; a completely elapsed transition (cover=0) never adds stale black.
        const alpha = geometryChanged && bounded > 0 ? 1 : bounded;
        if (style === "shutter") {
          const h = Math.ceil((canvas.height * alpha) / 2);
          output.fillRect(0, 0, canvas.width, h);
          output.fillRect(0, canvas.height - h, canvas.width, h);
        } else {
          output.globalAlpha = alpha;
          output.fillRect(0, 0, canvas.width, canvas.height);
        }
      } finally {
        geometryChanged = false;
        output.restore();
      }
    },
    beginUi(clearOutput = false) {
      width = canvas.width || 800;
      height = canvas.height || 600;
      ensureBuffer(width, height);
      clear();
      if (clearOutput) {
        output.resetTransform();
        output.globalAlpha = 1;
        output.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    presentUi() {
      output.save();
      try {
        output.resetTransform();
        output.globalAlpha = 1;
        output.imageSmoothingEnabled = false;
        // A fixed-size HUD is drawn at native 1:1 pixels. Never stretch its 800×600 assets to
        // whichever world resolution the selected output canvas currently uses.
        output.drawImage(buffer, 0, 0, width, height, 0, 0, width, height);
      } finally {
        output.restore();
      }
    },
  };
}

/** Screen/world inverse pair; screen coordinates are selected-resolution physical pixels. */
export function screenToWorld(
  point: { x: number; y: number },
  camera: { x: number; y: number },
  viewport: SceneViewport,
) {
  return { x: point.x / viewport.zoom + camera.x, y: point.y / viewport.zoom + camera.y };
}
export function worldToScreen(
  point: { x: number; y: number },
  camera: { x: number; y: number },
  viewport: SceneViewport,
) {
  return { x: (point.x - camera.x) * viewport.zoom, y: (point.y - camera.y) * viewport.zoom };
}
