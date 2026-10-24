/**
 * World **and** UI passes through the production surface, with a worst-case pattern.
 *
 * `zoom-display-browser.ts` verifies the world pass only; the 800x600 UI buffer the HUD, status
 * bar and chat are drawn into had no pixel verification at all. The UI is therefore filled with a
 * fully opaque 2x2 checkerboard - the highest spatial frequency there is - so any resampling
 * whatsoever breaks it, and no transparency is left for the world to leak through.
 */
import { requireElement } from "../../../client/dom.ts";
import { archiveImages, avatarImages } from "../../../client/image-cache.ts";
import { displayControls } from "../../../client/display-controls.ts";
import { sceneSurface } from "../../../client/scene-surface.ts";
import { lensViewport, type LensMode } from "../../../client/camera-lens.ts";
import type { ResolutionId } from "../../../client/display.ts";
export interface DisplayUiSurfaceInput {
  mode: ResolutionId;
  lens: LensMode;
  background: string;
  tile: string;
}
declare global {
  interface Window {
    displayUiSurface: ReturnType<typeof installDisplayUiSurface>;
  }
}
export function installDisplayUiSurface() {
  const canvas = requireElement("view", "canvas") as HTMLCanvasElement,
    surface = sceneSurface(canvas),
    ctx = surface.context,
    output = canvas.getContext("2d");
  if (!output) throw new Error("No output context");
  const select = requireElement("view-scale", "select") as HTMLSelectElement,
    images = archiveImages(),
    avatars = avatarImages();
  const display = displayControls({
    canvas,
    context: output,
    overlay: requireElement("game-ui", "div"),
    stage: requireElement("game-stage", "div"),
    scroll: requireElement("game-viewport", "div"),
    select,
    onScale() {},
  });
  const api = {
    async paint(input: DisplayUiSurfaceInput) {
      select.value = input.mode;
      select.dispatchEvent(new Event("change"));
      display.refresh();
      const background = images.get(input.background),
        tile = images.get(input.tile),
        avatar = avatars.get(
          { face: 20000, hair: 30000, items: [1040001, 1060001, 1071000, 1302000] },
          "stand1",
          0,
          false,
          undefined,
          true,
        );
      await Promise.all([background.loading, tile.loading, avatar.loading]);
      if (!background.ready || !tile.ready || !avatar.ready || avatar.planeHeight <= 0)
        throw new Error("Original art did not load");
      const viewport = lensViewport(input.lens, {
        width: display.layout().resolutionWidth,
        height: display.layout().resolutionHeight,
      });
      surface.beginWorld(viewport);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      ctx.drawImage(background.img, 0, 0);
      ctx.drawImage(tile.img, 100, 100);
      const w = avatar.img.naturalWidth,
        h = avatar.planeHeight;
      ctx.drawImage(avatar.img, 0, 0, w, h, 70, 165, w, h);
      ctx.drawImage(avatar.img, 0, h, w, h, 70, 165, w, h);
      surface.presentWorld();
      // UI pass: fully opaque 2x2 checkerboard (highest possible spatial frequency). Any
      // resampling at all breaks it, and it leaves no transparency for the world to leak through.
      surface.beginUi();
      const ui = ctx.createImageData(800, 600);
      for (let y = 0; y < 600; y++)
        for (let x = 0; x < 800; x++) {
          const i = (y * 800 + x) * 4,
            on = ((x >> 1) & 1) === ((y >> 1) & 1);
          ui.data[i] = on ? 255 : 0;
          ui.data[i + 1] = on ? 0 : 255;
          ui.data[i + 2] = on ? 0 : 255;
          ui.data[i + 3] = 255;
        }
      ctx.putImageData(ui, 0, 0);
      surface.presentUi();
      const rect = canvas.getBoundingClientRect();
      return {
        png: canvas.toDataURL("image/png"),
        left: rect.left,
        top: rect.top,
        width: canvas.width,
        height: canvas.height,
        dpr: devicePixelRatio,
        deviceScale: display.layout().deviceScale,
        pixelScale: viewport.pixelScale,
        smoothing: [ctx.imageSmoothingEnabled, output.imageSmoothingEnabled],
        cssRendering: getComputedStyle(canvas).imageRendering,
      };
    },
    dispose() {
      display.dispose();
    },
  };
  window.displayUiSurface = api;
  return api;
}
