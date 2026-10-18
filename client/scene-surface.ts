/** Two-pass pixel compositor: world has its own FOV; original UI/input stay 800×600.
 * Every world pixel and UI pixel expands by an INTEGER device factor. No fractional bitmap
 * resize, blur, CSS zoom/rotation, gameplay transform or unbounded offscreen allocation.
 */
import { requireContext2d } from "./dom.ts";
export interface SceneViewport {
  width: number;
  height: number;
  zoom: number;
  pixelScale: number;
  uiScale: number;
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
      geometryChanged = viewport.zoom !== next.zoom;
      viewport = next;
      width = next.width;
      height = next.height;
      const w = Math.max(800, Math.ceil(width)),
        h = Math.max(600, Math.ceil(height));
      if (buffer.width !== w) buffer.width = w;
      if (buffer.height !== h) buffer.height = h;
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
        output.imageSmoothingEnabled = false;
        output.setTransform(viewport.pixelScale, 0, 0, viewport.pixelScale, 0, 0);
        output.drawImage(buffer, 0, 0);
        output.resetTransform();
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
      width = 800;
      height = 600;
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
        output.drawImage(buffer, 0, 0, 800, 600, 0, 0, canvas.width, canvas.height);
      } finally {
        output.restore();
      }
    },
  };
}

/** UI view coordinates and world coordinates MUST cross this one inverse pair. */
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
