import type { ImageLookup } from "./render-types.ts";
import type { UiPoint, UiAudio } from "./ui-types.ts";
import { requireElement, focusTarget, blurWithin } from "./dom.ts";
interface DialogOptions {
  text: string;
  at?: UiPoint;
  reject?(): void;
}
export interface QuantityDialogOptions extends DialogOptions {
  initial: number;
  min?: number;
  max: number;
  accept(value: number): void;
}
export interface TextDialogOptions extends DialogOptions {
  initial: string;
  maxLength?: number;
  validate?(value: string): string | undefined;
  accept(value: string): void;
}
export interface ConfirmDialogOptions extends DialogOptions {
  accept(value: number): void;
}
type DialogSpec =
  | (QuantityDialogOptions & { mode: "quantity" })
  | (TextDialogOptions & { mode: "text" })
  | (ConfirmDialogOptions & { mode: "confirm" | "notice" });
type DialogState = DialogSpec & {
  lines: string[];
  textHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
import { BASIC_DIALOG, basicDialogLines, basicDialogTextY } from "./feedback-data.ts";
import { drawUtilFrame } from "./utildialog.ts";
import { releaseOnInterrupt } from "./pointer.ts";
/** CUtilDlgEx numeric input: 4643F0 / 4B7960 / 535EF0 / 532A80 / 531110.
 * Native art on canvas, DOM only for text/numeric editing, focus and hit targets.
 * No inventory writes: callers revalidate their source snapshot before sending.
 */
export function itemDialogs({
  ctx,
  image,
  audio,
  onOpen = () => {},
}: {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  audio: UiAudio;
  onOpen?(): void;
}) {
  const root = requireElement("item-dialog", "section");
  const input = requireElement("item-quantity", "input");
  const label = requireElement("item-question", "p");
  const error = requireElement("item-quantity-error", "p");
  const ok = requireElement("item-dialog-ok", "button");
  const cancel = requireElement("item-dialog-cancel", "button");
  let current: DialogState | undefined,
    hover: string | undefined,
    pressed: string | undefined,
    previousFocus: ReturnType<typeof focusTarget>;
  const box = (el: HTMLElement, x: number, y: number, w: number, h: number) =>
    Object.assign(el.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
  const stamp = (path: string, x: number, y: number) => {
    const a = image(path);
    if (a.ready) ctx.drawImage(a.img, x, y);
  };
  function close(restoreFocus = true, cancelled = true) {
    const previous = current;
    current = undefined;
    hover = pressed = undefined;
    root.classList.add("hidden");
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    else blurWithin(root);
    previousFocus = undefined;
    if (cancelled) previous?.reject?.();
  }
  function linesOf(text: string, width: number) {
    ctx.save();
    ctx.font = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
    const lines = [];
    for (const paragraph of String(text).split("\n")) {
      let line = "";
      for (const ch of paragraph) {
        if (line && ctx.measureText(line + ch).width > width) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
      lines.push(line);
    }
    ctx.restore();
    return lines;
  }
  function open(options: DialogSpec) {
    const { mode } = options;
    if (current) return false;
    const editing = mode === "quantity" || mode === "text";
    const lines = editing ? linesOf(options.text, 230) : basicDialogLines(options.text);
    const textHeight = lines.length * 16;
    const width = editing ? 252 : BASIC_DIALOG.width;
    const height = editing ? textHeight + 99 : BASIC_DIALOG.height;
    const x = Math.max(0, Math.min(800 - width, Math.round((options.at?.x ?? 400) - width / 2)));
    const y = Math.max(0, Math.min(600 - height, Math.round((options.at?.y ?? 300) - height / 2)));
    previousFocus = focusTarget(document.activeElement);
    current = { ...options, lines, textHeight, x, y, width, height };
    label.textContent = options.text;
    error.textContent = "";
    input.classList.toggle("hidden", !editing);
    cancel.classList.toggle("hidden", mode === "notice");
    cancel.disabled = mode === "notice";
    ok.textContent = mode === "confirm" ? "예" : "확인";
    cancel.textContent = mode === "confirm" ? "아니오" : "취소";
    if (options.mode === "quantity" || options.mode === "text") {
      input.value = String(options.initial);
      input.maxLength =
        options.mode === "text" ? (options.maxLength ?? 12) : String(options.max).length;
      input.inputMode = mode === "text" ? "text" : "numeric";
      input.setAttribute(
        "aria-label",
        options.mode === "text"
          ? options.text
          : `${options.text} (${options.min ?? 1}–${options.max})`,
      );
      box(input, x + 16, y + textHeight + 38, width - 30, 14);
    }
    const buttonY = editing ? y + height - 42 : y + height - 40;
    box(ok, editing ? x + width - 119 : x + width / 2 - 50, buttonY, 50, 23);
    box(cancel, editing ? x + width - 65 : x + width / 2 + 4, buttonY, 50, 23);
    if (!editing) {
      box(
        ok,
        x + (mode === "notice" ? BASIC_DIALOG.okX : BASIC_DIALOG.yesX),
        y + BASIC_DIALOG.buttonY,
        BASIC_DIALOG.buttonWidth,
        BASIC_DIALOG.buttonHeight,
      );
      box(
        cancel,
        x + BASIC_DIALOG.noX,
        y + BASIC_DIALOG.buttonY,
        BASIC_DIALOG.buttonWidth,
        BASIC_DIALOG.buttonHeight,
      );
    }
    root.classList.remove("hidden");
    onOpen();
    if (editing) {
      input.focus();
      input.select();
    } else if (mode === "notice") ok.focus();
    else cancel.focus(); // Explicit browser safety policy: destructive Yes/No never defaults to Yes.
    void audio.effect("UI/DlgNotice");
    return true;
  }
  function accept() {
    const c = current;
    if (!c) return;
    let value = 1;
    if (c.mode === "quantity") {
      const raw = input.value.trim();
      value = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(value) || value < (c.min ?? 1) || value > c.max) {
        error.textContent = `${c.min ?? 1}–${c.max} 사이의 숫자를 입력하세요.`;
        input.setCustomValidity(error.textContent);
        input.setAttribute("aria-invalid", "true");
        input.focus();
        input.select();
        return;
      }
    }
    if (c.mode === "text") {
      const value = input.value.trim();
      const reason = c.validate?.(value);
      if (reason) {
        error.textContent = reason;
        input.setCustomValidity(reason);
        input.setAttribute("aria-invalid", "true");
        input.focus();
        input.select();
        return;
      }
      close(true, false);
      c.accept(value);
      return;
    }
    close(true, false);
    c.accept(value);
  }
  ok.addEventListener("click", accept);
  cancel.addEventListener("click", () => close());
  input.addEventListener("input", () => {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
  });
  for (const button of [ok, cancel]) {
    button.addEventListener("mouseenter", () => {
      hover = button.id;
    });
    button.addEventListener("mouseleave", () => {
      hover = undefined;
    });
    button.addEventListener("focus", () => {
      hover = button.id;
    });
    button.addEventListener("blur", () => {
      hover = pressed = undefined;
    });
    button.addEventListener("mousedown", (event) => {
      if (event.button === 0 && !button.disabled) pressed = button.id;
    });
    button.addEventListener("mouseup", () => {
      pressed = undefined;
    });
  }
  releaseOnInterrupt(() => {
    pressed = hover = undefined;
  });
  // A full-surface modal owns game keys even when focus is on a button or moved by the browser.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!current) return;
      if (current.mode === "text" && (event.isComposing || event.keyCode === 229)) return;
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) close();
      } else if (
        current.mode === "confirm" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        /^[yn]$/i.test(event.key)
      ) {
        event.preventDefault();
        if (!event.repeat) event.key.toLowerCase() === "y" ? accept() : close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat) document.activeElement === cancel ? close() : accept();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const controls =
          current.mode === "notice"
            ? [ok]
            : current.mode === "confirm"
              ? [ok, cancel]
              : [input, ok, cancel];
        const index = controls.findIndex((control) => control === document.activeElement);
        controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
      } else if (document.activeElement !== input) event.preventDefault();
    },
    { capture: true },
  );
  root.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    { passive: false },
  );
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  // Keep stray input behind the modal from closing windows, attacking, or selecting a portal.
  for (const name of ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"]) {
    window.addEventListener(
      name,
      (event) => {
        if (current && !(event.target instanceof Node && root.contains(event.target))) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }
  return {
    get open() {
      return !!current;
    },
    quantity(options: QuantityDialogOptions) {
      if (!Number.isInteger(options.max) || options.max < (options.min ?? 1)) return false;
      return open({ ...options, mode: "quantity" });
    },
    text(options: TextDialogOptions) {
      return open({ ...options, mode: "text" });
    },
    notice(options: ConfirmDialogOptions) {
      return open({ ...options, mode: "notice" });
    },
    confirm(options: ConfirmDialogOptions) {
      return open({ ...options, mode: "confirm" });
    },
    close,
    draw() {
      const c = current;
      if (!c) return;
      const { x, y, width: w, height: h } = c;
      ctx.save();
      try {
        const editing = c.mode === "quantity" || c.mode === "text";
        if (editing) {
          drawUtilFrame(ctx, image, x, y, w, h);
          // 532A80: input border at (13,textHeight+35), inner white face (14,+36).
          ctx.fillStyle = "#000000";
          ctx.fillRect(x + 13, y + c.textHeight + 35, w - 25, 18);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x + 14, y + c.textHeight + 36, w - 27, 16);
        } else {
          stamp(`UI/Basic.img/${c.mode === "notice" ? "Notice" : "YesNo"}/backgrnd`, x, y);
        }
        ctx.font = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
        ctx.fillStyle = "#000000";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        if (editing) c.lines.forEach((line, i) => ctx.fillText(line, x + 14, y + 36 + i * 16));
        else {
          ctx.save();
          try {
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            ctx.font = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
            for (const [index, line] of c.lines.entries()) {
              const tx =
                  x +
                  BASIC_DIALOG.textLeft +
                  Math.trunc((BASIC_DIALOG.textWidth - ctx.measureText(line).width) / 2),
                ty = y + basicDialogTextY(c.lines.length) + BASIC_DIALOG.lineHeight * index;
              ctx.fillStyle = "#ffffff";
              ctx.fillText(line, tx + 1, ty + 1);
              ctx.fillStyle = "#000000";
              ctx.fillText(line, tx, ty);
            }
          } finally {
            ctx.restore();
          }
        }
        if (error.textContent) {
          ctx.fillStyle = "#a00000";
          ctx.font = "10px 'Dotum', 'KMSCJK', sans-serif";
          ctx.fillText(error.textContent, x + 14, y + h - 16);
        }
        for (const button of c.mode === "notice" ? [ok] : [ok, cancel]) {
          const name = editing
            ? button === ok
              ? "OK"
              : "Cancel"
            : c.mode === "notice"
              ? "OK"
              : button === ok
                ? "Yes"
                : "No";
          const state =
            pressed === button.id ? "pressed" : hover === button.id ? "mouseOver" : "normal";
          const path = editing ? "UI/UIWindow.img/UtilDlgEx" : "UI/Basic.img";
          stamp(
            `${path}/Bt${name}/${state}/0`,
            parseFloat(button.style.left),
            parseFloat(button.style.top),
          );
        }
      } finally {
        ctx.restore();
      }
    },
  };
}
