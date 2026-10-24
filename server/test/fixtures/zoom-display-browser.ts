/** Real original assets through production world/output/CSS layout. No game transport or actors. */
import { requireElement } from "../../../client/dom.ts";
import { archiveImages, avatarImages } from "../../../client/image-cache.ts";
import { displayControls } from "../../../client/display-controls.ts";
import { sceneSurface } from "../../../client/scene-surface.ts";
import { lensViewport, type LensMode } from "../../../client/camera-lens.ts";
import type { ResolutionId } from "../../../client/display.ts";
export interface ZoomScreenInput {
  mode: ResolutionId;
  lens: LensMode;
  background: string;
  tile: string;
}
declare global {
  interface Window {
    zoomScreen: ReturnType<typeof installZoomScreen>;
  }
}
export function installZoomScreen() {
  const canvas = requireElement("view", "canvas"),
    surface = sceneSurface(canvas),
    ctx = surface.context,
    output = canvas.getContext("2d");
  if (!output) throw new Error("No output context");
  const select = requireElement("view-scale", "select"),
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
    async paint(input: ZoomScreenInput) {
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
      // Same native packed back/front plane sampling and integer anchors as drawAvatarBodyAt.
      const x = Math.round(70 + avatar.dx),
        y = Math.round(165 + avatar.dy),
        w = avatar.img.naturalWidth,
        h = avatar.planeHeight;
      ctx.drawImage(avatar.img, 0, 0, w, h, x, y, w, h);
      ctx.drawImage(avatar.img, 0, h, w, h, x, y, w, h);
      const nativeAvatar = new OffscreenCanvas(w, h),
        nativeContext = nativeAvatar.getContext("2d");
      if (!nativeContext) throw new Error("No original avatar inspection context");
      nativeContext.drawImage(avatar.img, 0, 0, w, h, 0, 0, w, h);
      nativeContext.drawImage(avatar.img, 0, h, w, h, 0, 0, w, h);
      const rgba = nativeContext.getImageData(0, 0, w, h).data;
      let partialAlpha = 0,
        opaque = 0;
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] === 255) opaque++;
        else if (rgba[i]! > 0) partialAlpha++;
      }
      surface.presentWorld();
      surface.beginUi();
      surface.presentUi();
      const rect = canvas.getBoundingClientRect();
      return {
        png: canvas.toDataURL("image/png"),
        left: rect.left,
        top: rect.top,
        width: canvas.width,
        height: canvas.height,
        dpr: devicePixelRatio,
        pixelScale: viewport.pixelScale,
        smoothing: [ctx.imageSmoothingEnabled, output.imageSmoothingEnabled],
        cssRendering: getComputedStyle(canvas).imageRendering,
        filter: getComputedStyle(canvas).filter,
        avatar: { width: w, height: h, partialAlpha, opaque },
      };
    },
    dispose() {
      display.dispose();
    },
  };
  window.zoomScreen = api;
  return api;
}
