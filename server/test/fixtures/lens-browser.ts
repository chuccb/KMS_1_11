/** Explicit isolated browser component; no game transport/accounts/saves. Real PNG, DOM/canvas. */
import { sceneSurface, screenToWorld } from "../../../client/scene-surface.ts";
import { lensViewport, type LensMode } from "../../../client/camera-lens.ts";
import { lensControls } from "../../../client/lens-controls.ts";
import { archiveImages } from "../../../client/image-cache.ts";
import { dropRenderer, dropIconPath } from "../../../client/drop-renderer.ts";
import { requireElement, requireContext2d } from "../../../client/dom.ts";
interface PaintInput {
  uiScale: number;
  lens: LensMode;
  cover?: number;
  style?: "fade" | "shutter";
}
declare global {
  interface Window {
    lensFixture: ReturnType<typeof installLensFixture>;
  }
}
export function installLensFixture() {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const surface = sceneSurface(canvas),
    ctx = surface.context,
    output = requireContext2d(canvas),
    images = archiveImages();
  let facts: unknown,
    clock = 0,
    interactions = 0,
    closes = 0,
    worldKeys = 0;
  const controls = lensControls({
    panel: requireElement("camera-lab", "details"),
    now: () => clock,
    onInteract: () => interactions++,
    onClose: () => closes++,
  });
  const key = () => worldKeys++;
  window.addEventListener("keydown", key);
  const painter = dropRenderer({
    ctx,
    image: images.get,
    item: () => facts,
    describe: () => undefined,
    viewport: () => surface,
  });
  const api = {
    async paint(input: PaintInput) {
      if (!facts) {
        const response = await fetch("/api/item/4000019");
        if (!response.ok) throw new Error("Original item unavailable");
        facts = await response.json();
      }
      const path = dropIconPath(facts);
      if (!path) throw new Error("Invalid original icon");
      const loaded = images.get(path);
      await loaded.loading;
      const original = new OffscreenCanvas(loaded.img.naturalWidth, loaded.img.naturalHeight),
        originalContext = original.getContext("2d");
      if (!originalContext) throw new Error("No native PNG comparison context");
      originalContext.drawImage(loaded.img, 0, 0);
      const originalPixels = originalContext.getImageData(
        0,
        0,
        original.width,
        original.height,
      ).data;
      canvas.width = 800 * input.uiScale;
      canvas.height = 600 * input.uiScale;
      const viewport = lensViewport(input.lens, input.uiScale);
      surface.beginWorld(viewport);
      for (let x = 0; x < Math.ceil(viewport.width); x++) {
        ctx.fillStyle = x % 2 ? "#fff" : "#000";
        ctx.fillRect(x, 0, 1, 20);
      }
      painter.draw(
        { dropId: 1, kind: 2, money: false, value: 4000019, x: 40, y: 80 },
        { x: 40, y: 80, t: 1, phase: "rest" },
        { x: 0, y: 0 },
        0,
      );
      surface.presentWorld(input.cover ?? 0, input.style ?? "fade");
      const k = viewport.pixelScale,
        row = output.getImageData(0, 5 * k, 32 * k, 1).data;
      const runs = Array.from({ length: 32 * k }, (_, i) => row[i * 4]);
      let nativePixelsExact = true;
      if (!input.cover) {
        const actual = output.getImageData(
          (40 - Math.trunc(original.width / 2)) * k,
          (80 - original.height) * k,
          original.width * k,
          original.height * k,
        ).data;
        for (let y = 0; y < original.height * k; y++)
          for (let x = 0; x < original.width * k; x++) {
            const a = (y * original.width * k + x) * 4,
              s = (Math.floor(y / k) * original.width + Math.floor(x / k)) * 4;
            for (let c = 0; c < 3; c++)
              if (
                Math.abs(
                  actual[a + c]! -
                    Math.round((originalPixels[s + c]! * originalPixels[s + 3]!) / 255),
                ) > 1
              )
                nativePixelsExact = false;
            if (actual[a + 3] !== 255) nativePixelsExact = false;
          }
      }
      // The original shell's last row contains black outline pixels. On an opaque black output
      // RGB alone cannot distinguish them from empty background; verify actual source alpha.
      const edge = ctx.getImageData(27, 79, 27, 2).data;
      const atGround = Array.from({ length: 27 }, (_, i) => edge[i * 4 + 3]).some(
        (alpha) => alpha > 0,
      );
      const belowGround = Array.from({ length: 27 }, (_, i) => edge[(27 + i) * 4 + 3]).some(
        (alpha) => alpha > 0,
      );
      surface.beginUi();
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(10, 120, 5, 5);
      surface.presentUi();
      const hud = [...output.getImageData(10, 120, 1, 1).data];
      return {
        viewport,
        runs,
        atGround,
        belowGround,
        nativePixelsExact,
        hud,
        smoothing: output.imageSmoothingEnabled,
        worldPoint: screenToWorld({ x: 100, y: 100 }, { x: -200, y: 300 }, viewport),
        buffer: [ctx.canvas.width, ctx.canvas.height],
      };
    },
    sample(now: number, uiScale = 1) {
      clock = now;
      return { state: controls.sample(now, uiScale), interactions, closes, worldKeys };
    },
    dispose() {
      controls.dispose();
      window.removeEventListener("keydown", key);
    },
  };
  window.lensFixture = api;
  return api;
}
