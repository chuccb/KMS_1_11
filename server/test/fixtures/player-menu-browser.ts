/** Real component/cache/canvas/DOM, only original-WZ GETs. No transport, account or player. */
import { playerMenu } from "../../../client/player-menu.ts";
import { archiveImages } from "../../../client/image-cache.ts";
import { requireContext2d, requireElement } from "../../../client/dom.ts";
import type { PlayerMenuAction, PlayerMenuTarget } from "../../../client/player-menu-data.ts";
export function installPlayerMenuFixture() {
  const canvas = requireElement("surface", "canvas"),
    ctx = requireContext2d(canvas),
    images = archiveImages();
  const actions: { action: PlayerMenuAction; target: PlayerMenuTarget }[] = [];
  const draws: { path: string; x: number; y: number; width: number; height: number }[] = [],
    texts: {
      text: string;
      x: number;
      y: number;
      color: string | CanvasGradient | CanvasPattern;
    }[] = [];
  const nativeDraw = ctx.drawImage.bind(ctx),
    nativeText = ctx.fillText.bind(ctx);
  ctx.drawImage = (source: CanvasImageSource, x: number, y: number) => {
    if (!(source instanceof HTMLImageElement)) throw Error("Expected archive PNG");
    draws.push({
      path: decodeURIComponent(new URL(source.src).pathname),
      x,
      y,
      width: source.naturalWidth,
      height: source.naturalHeight,
    });
    nativeDraw(source, x, y);
  };
  ctx.fillText = (text: string, x: number, y: number) => {
    texts.push({ text, x, y, color: ctx.fillStyle });
    nativeText(text, x, y);
  };
  let verified = true;
  let blocked = false,
    valid = true,
    opened = 0,
    outside = 0,
    canvasClicks = 0,
    keys = 0;
  const errors: string[] = [],
    target = { characterId: 7, name: "상대이름" };
  const menu = playerMenu({
    ctx,
    image: (path) => images.get(path),
    point: (event) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - r.left) * 800) / r.width,
        y: ((event.clientY - r.top) * 600) / r.height,
      };
    },
    canOpen: () => !blocked,
    canInvite: () => verified,
    valid: () => valid,
    onOpen: () => opened++,
    onAction: (action, target) => actions.push({ action, target }),
    onError: (message) => errors.push(message),
  });
  requireElement("outside", "button").addEventListener("click", () => outside++);
  canvas.addEventListener("click", () => canvasClicks++);
  window.addEventListener("keydown", () => keys++);
  return {
    warm: menu.warm,
    verified(value: boolean) {
      verified = value;
    },
    show(leader = false, x = 300, y = 400) {
      return menu.show(target, { x, y }, leader);
    },
    async stale() {
      const pending = menu.show(target, { x: 300, y: 400 }, false);
      menu.close(false);
      return await pending;
    },
    blocked(value: boolean) {
      blocked = value;
    },
    valid(value: boolean) {
      valid = value;
    },
    close: menu.close,
    paint() {
      draws.length = texts.length = 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#224466";
      ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = "#abcdef";
      ctx.font = "8px serif";
      ctx.globalAlpha = 0.7;
      ctx.imageSmoothingEnabled = true;
      const before = {
        fill: ctx.fillStyle,
        font: ctx.font,
        alpha: ctx.globalAlpha,
        smooth: ctx.imageSmoothingEnabled,
      };
      menu.draw();
      const after = {
        fill: ctx.fillStyle,
        font: ctx.font,
        alpha: ctx.globalAlpha,
        smooth: ctx.imageSmoothingEnabled,
      };
      ctx.globalAlpha = 1;
      return {
        open: menu.open,
        state: menu.state,
        draws,
        texts,
        actions,
        opened,
        outside,
        canvasClicks,
        keys,
        errors,
        active: document.activeElement?.id,
        before,
        after,
      };
    },
    pixel(x: number, y: number) {
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    },
  };
}
declare global {
  interface Window {
    playerMenuFixture: ReturnType<typeof installPlayerMenuFixture>;
  }
}
