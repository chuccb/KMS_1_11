/** Explicit component harness: real production canvas, DOM controls, image loader and feedback.
 * No transport, login, character action or save. Only GET archive assets/metadata.
 */
import { requireContext2d } from "../../../client/dom.ts";
import { archiveImages } from "../../../client/image-cache.ts";
import { itemDialogs } from "../../../client/itemdialogs.ts";
import { itemMetadataCache } from "../../../client/item-metadata.ts";
import { gameFeedback } from "../../../client/feedback.ts";
import { drawScreenMessages } from "../../../client/feedback-renderer.ts";
interface Draw {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Text {
  text: string;
  x: number;
  y: number;
  alpha: number;
  color: string | CanvasGradient | CanvasPattern;
}
export function installFeedbackFixture() {
  const canvas = document.querySelector("canvas");
  if (!canvas) throw Error("No feedback canvas");
  const ctx = requireContext2d(canvas),
    images = archiveImages(),
    sounds: string[] = [],
    chat: string[] = [],
    draws: Draw[] = [],
    texts: Text[] = [];
  let now = 0,
    accepted = 0,
    rejected = 0,
    blocked = false;
  const nativeDraw = ctx.drawImage.bind(ctx),
    nativeText = ctx.fillText.bind(ctx);
  ctx.drawImage = (image: CanvasImageSource, x: number, y: number) => {
    if (!(image instanceof HTMLImageElement)) throw Error("Expected original archive PNG");
    draws.push({
      path: decodeURIComponent(new URL(image.src).pathname),
      x,
      y,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    nativeDraw(image, x, y);
  };
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    texts.push({ text, x, y, alpha: ctx.globalAlpha, color: ctx.fillStyle });
    if (maxWidth === undefined) nativeText(text, x, y);
    else nativeText(text, x, y, maxWidth);
  };
  const dialog = itemDialogs({
    ctx,
    image: (path) => images.get(path),
    audio: { effect: (path) => sounds.push(path) },
  });
  const metadata = itemMetadataCache({
    read: (id, signal) => fetch(`/api/item/${id}`, { signal }),
    now: () => now,
    onError: (error) => {
      throw error;
    },
  });
  const feedback = gameFeedback({
    dialog,
    now: () => now,
    blocked: () => blocked,
    chat: (text) => chat.push(text),
    onError: (error) => {
      throw error;
    },
    item: metadata.load,
  });
  let outsideClicks = 0;
  document.querySelector("#outside")?.addEventListener("click", () => outsideClicks++);
  return {
    async warm() {
      const paths = [
        "UI/Basic.img/Notice/backgrnd",
        "UI/Basic.img/YesNo/backgrnd",
        ...["OK", "Yes", "No"].flatMap((name) =>
          ["normal", "mouseOver", "pressed"].map((state) => `UI/Basic.img/Bt${name}/${state}/0`),
        ),
      ];
      for (const path of paths) {
        const image = images.get(path);
        await image.loading;
        if (!image.ready) throw Error(`Missing original PNG ${path}`);
      }
    },
    receive(value: unknown) {
      return feedback.receive(value);
    },
    time(value: number) {
      now = value;
    },
    block(value: boolean) {
      blocked = value;
    },
    quantity() {
      dialog.quantity({
        text: "qty",
        initial: 1,
        max: 5,
        accept() {
          accepted++;
        },
        reject() {
          rejected++;
        },
      });
    },
    confirm() {
      dialog.confirm({
        text: "a\r\nb",
        accept() {
          accepted++;
        },
        reject() {
          rejected++;
        },
      });
    },
    cancel() {
      dialog.close();
    },
    reset() {
      feedback.reset();
    },
    paint() {
      ctx.clearRect(0, 0, 800, 600);
      draws.length = texts.length = 0;
      feedback.tick();
      drawScreenMessages(ctx, feedback.rows(now));
      dialog.draw();
      const ok = document.querySelector<HTMLButtonElement>("#item-dialog-ok"),
        cancel = document.querySelector<HTMLButtonElement>("#item-dialog-cancel");
      if (!ok || !cancel) throw Error("No modal controls");
      return {
        draws,
        texts,
        rows: feedback.rows(now),
        open: dialog.open,
        active: document.activeElement?.id,
        ok: { x: ok.offsetLeft, y: ok.offsetTop, width: ok.offsetWidth, height: ok.offsetHeight },
        cancelHidden: cancel.classList.contains("hidden"),
        cancelDisabled: cancel.disabled,
        accepted,
        rejected,
        sounds,
        chat,
        outsideClicks,
      };
    },
    restoration(which: "dialog" | "screen") {
      const draw = ctx.fillText;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.setTransform(1, 0, 0, 1, 7, 11);
      ctx.fillText = () => {
        throw Error("Injected renderer failure");
      };
      let error: string | undefined;
      try {
        if (which === "dialog") dialog.draw();
        else drawScreenMessages(ctx, feedback.rows(now));
      } catch (cause) {
        error = String(cause);
      }
      const alpha = ctx.globalAlpha,
        matrix = ctx.getTransform();
      ctx.fillText = draw;
      ctx.restore();
      return { error, alpha, x: matrix.e, y: matrix.f };
    },
  };
}
declare global {
  interface Window {
    feedbackFixture: ReturnType<typeof installFeedbackFixture>;
  }
}
