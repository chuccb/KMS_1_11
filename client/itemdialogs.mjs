/** CUtilDlgEx numeric input: 4643F0 / 4B7960 / 535EF0 / 532A80 / 531110.
 * Native art on canvas, DOM only for numeric editing, focus and hit targets.
 * No inventory writes: callers revalidate their source snapshot before sending.
 */
export function itemDialogs({ ctx, image, audio, onOpen = () => {} }) {
  const root = document.getElementById("item-dialog");
  const input = document.getElementById("item-quantity");
  const label = document.getElementById("item-question");
  const error = document.getElementById("item-quantity-error");
  const ok = document.getElementById("item-dialog-ok");
  const cancel = document.getElementById("item-dialog-cancel");
  let current, hover, pressed, previousFocus;
  const box = (el, x, y, w, h) =>
    Object.assign(el.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
  const stamp = (path, x, y) => {
    const a = image(path);
    if (a.ready) ctx.drawImage(a.img, x, y);
  };
  function close(restoreFocus = true) {
    current = undefined;
    hover = pressed = undefined;
    root.classList.add("hidden");
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    else if (root.contains(document.activeElement))
      document.activeElement.blur();
    previousFocus = undefined;
  }
  function linesOf(text, width) {
    ctx.save();
    ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
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
  function open(options, mode) {
    if (current) return false;
    const lines = linesOf(options.text, mode === "quantity" ? 230 : 236);
    const textHeight = lines.length * 16;
    const width = mode === "quantity" ? 252 : 264;
    const height = mode === "quantity" ? textHeight + 99 : 132;
    const x = Math.max(
      0,
      Math.min(800 - width, Math.round((options.at?.x ?? 400) - width / 2)),
    );
    const y = Math.max(
      0,
      Math.min(600 - height, Math.round((options.at?.y ?? 300) - height / 2)),
    );
    previousFocus = document.activeElement;
    current = { ...options, mode, lines, textHeight, x, y, width, height };
    label.textContent = options.text;
    error.textContent = "";
    input.classList.toggle("hidden", mode !== "quantity");
    if (mode === "quantity") {
      input.value = String(options.initial);
      input.maxLength = String(options.max).length;
      input.setAttribute(
        "aria-label",
        `${options.text} (${options.min ?? 1}–${options.max})`,
      );
      box(input, x + 16, y + textHeight + 38, width - 30, 14);
    }
    const buttonY = mode === "quantity" ? y + height - 42 : y + height - 40;
    box(
      ok,
      mode === "quantity" ? x + width - 119 : x + width / 2 - 50,
      buttonY,
      50,
      23,
    );
    box(
      cancel,
      mode === "quantity" ? x + width - 65 : x + width / 2 + 4,
      buttonY,
      50,
      23,
    );
    if (mode !== "quantity") {
      box(ok, x + 60, y + 92, 65, 24);
      box(cancel, x + 138, y + 92, 65, 24);
    }
    root.classList.remove("hidden");
    onOpen();
    if (mode === "quantity") {
      input.focus();
      input.select();
    } else cancel.focus(); // Destructive confirmations never default to Yes on a stray Enter.
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
      if (
        !Number.isSafeInteger(value) ||
        value < (c.min ?? 1) ||
        value > c.max
      ) {
        error.textContent = `${c.min ?? 1}–${c.max} 사이의 숫자를 입력하세요.`;
        input.setCustomValidity(error.textContent);
        input.setAttribute("aria-invalid", "true");
        input.focus();
        input.select();
        return;
      }
    }
    close();
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
    button.addEventListener("mousedown", () => {
      pressed = button.id;
    });
    button.addEventListener("mouseup", () => {
      pressed = undefined;
    });
  }
  window.addEventListener("blur", () => {
    pressed = undefined;
  });
  // A full-surface modal owns game keys even when focus is on a button or moved by the browser.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!current) return;
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat)
          document.activeElement === cancel ? close() : accept();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const controls =
          current.mode === "quantity" ? [input, ok, cancel] : [ok, cancel];
        const index = controls.indexOf(document.activeElement);
        controls[
          (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
        ].focus();
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
  for (const name of [
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "pointerdown",
    "pointerup",
  ]) {
    window.addEventListener(
      name,
      (event) => {
        if (current && !root.contains(event.target)) {
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
    quantity(options) {
      if (!Number.isInteger(options.max) || options.max < (options.min ?? 1))
        return false;
      return open(options, "quantity");
    },
    confirm(options) {
      return open(options, "confirm");
    },
    close,
    draw() {
      const c = current;
      if (!c) return;
      const { x, y, width: w, height: h } = c;
      ctx.save();
      if (c.mode === "quantity") {
        // 531110: white interior, Border/1+6 horizontal, /3+4 vertical, four native corners.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y + 13, w, h - 13);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 7, y + 13, w - 15, h - 13);
        ctx.clip();
        for (let px = 7; px < w - 8; px += 4) {
          stamp("UI/UIWindow.img/UtilDlgEx/Border/1", x + px, y + 13);
          stamp("UI/UIWindow.img/UtilDlgEx/Border/6", x + px, y + h - 18);
        }
        ctx.restore();
        for (let py = 31; py < h - 18; py += 4) {
          stamp("UI/UIWindow.img/UtilDlgEx/Border/3", x, y + py);
          stamp("UI/UIWindow.img/UtilDlgEx/Border/4", x + w - 8, y + py);
        }
        stamp("UI/UIWindow.img/UtilDlgEx/Border/0", x, y + 13);
        stamp("UI/UIWindow.img/UtilDlgEx/Border/2", x + w - 54, y);
        stamp("UI/UIWindow.img/UtilDlgEx/Border/5", x, y + h - 18);
        stamp("UI/UIWindow.img/UtilDlgEx/Border/7", x + w - 8, y + h - 18);
        // 532A80: input border at (13,textHeight+35), inner white face (14,+36).
        ctx.fillStyle = "#000000";
        ctx.fillRect(x + 13, y + c.textHeight + 35, w - 25, 18);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + 14, y + c.textHeight + 36, w - 27, 16);
      } else {
        stamp("UI/Basic.img/YesNo/backgrnd", x, y);
      }
      ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
      ctx.fillStyle = "#000000";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      c.lines.forEach((line, i) =>
        ctx.fillText(
          line,
          x + 14,
          y + (c.mode === "quantity" ? 36 : 24) + i * 16,
        ),
      );
      if (error.textContent) {
        ctx.fillStyle = "#a00000";
        ctx.font = "10px 'Dotum', 'KMSCJK', sans-serif";
        ctx.fillText(error.textContent, x + 14, y + h - 16);
      }
      for (const b of [ok, cancel]) {
        const name =
          c.mode === "quantity"
            ? b === ok
              ? "OK"
              : "Cancel"
            : b === ok
              ? "Yes"
              : "No";
        const state =
          pressed === b.id
            ? "pressed"
            : hover === b.id
              ? "mouseOver"
              : "normal";
        const path =
          c.mode === "quantity" ? "UI/UIWindow.img/UtilDlgEx" : "UI/Basic.img";
        if (c.mode === "quantity")
          stamp(
            `${path}/Bt${name}/${state}/0`,
            parseFloat(b.style.left),
            parseFloat(b.style.top),
          );
        else {
          // Basic buttons are 65x24, unlike UtilDlgEx's 50x23.
          box(b, b === ok ? x + 60 : x + 138, y + 92, 65, 24);
          stamp(
            `${path}/Bt${name}/${state}/0`,
            parseFloat(b.style.left),
            parseFloat(b.style.top),
          );
        }
      }
      ctx.restore();
    },
  };
}
