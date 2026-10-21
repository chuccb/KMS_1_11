import type { ImageLookup } from "./render-types.ts";
import type { QuestTalkBody, QuestReply } from "../server/src/protocol/quest.ts";
import type { DialogueRun, DialoguePiece, DialogueAsset } from "./npcdialogue-layout.ts";
import type { UiPoint, UiAudio } from "./ui-types.ts";
import { requireElement, blurWithin, focusTarget } from "./dom.ts";
export interface DialoguePreviewContext {
  preview: true;
  page: number;
  exampleKind: string;
}
interface DialogueOptions {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  audio: UiAudio;
  point(event: MouseEvent): UiPoint;
  onOpen(): void;
  onReply(reply: QuestReply, context?: DialoguePreviewContext): void;
}
type DialogueLayout = ReturnType<typeof dialogueLayout>;
type ButtonTarget = ReturnType<typeof dialogueButtons>[number] & {
  element: HTMLButtonElement;
  piece?: undefined;
};
interface ChoiceTarget {
  piece: DialoguePiece;
  element: HTMLButtonElement;
  answer?: undefined;
}
interface DialogueState extends DialogueLayout {
  npcId: number;
  body: QuestTalkBody;
  context?: DialoguePreviewContext;
  runs: DialogueRun[];
  scroll: number;
  assetMap: Map<string, DialogueAsset>;
  abort: AbortController;
  loading: boolean;
  x: number;
  y: number;
  editorHeight?: number;
  choices: ChoiceTarget[];
  buttons: ButtonTarget[];
  iconHover?: UiPoint & { text: string };
}
import { dialogueAssets } from "./dialogue-assets.ts";
import { drawSimpleTooltip } from "./tooltip.ts";
import { releaseOnInterrupt } from "./pointer.ts";
import { drawUtilFrame, drawUtilTextFrame } from "./utildialog.ts";
import { vScrollTravel, VSCR_CELL } from "./vscroll.ts";
import {
  DIALOGUE_FONT,
  DIALOGUE_COLORS,
  dialogueRuns,
  dialogueLayout,
  dialogueButtons,
  dialogueInputError,
  dialoguePlainText,
  dialogueAssetKey,
} from "./npcdialogue-layout.ts";

/** Server CUtilDlgEx: native Ex2 art on canvas; DOM only for editing, focus and hit targets.
 * No NPC portrait/title is invented: 4A5910 reads but does not use the packet's NPC id.
 */
export function npcDialogue({ ctx, image, audio, point, onOpen, onReply }: DialogueOptions) {
  const root = requireElement("dialogue", "section");
  const label = requireElement("dialogue-text", "p");
  const input = requireElement("dialogue-input", "input");
  const error = requireElement("dialogue-error", "p");
  const targets = requireElement("dialogue-controls", "div");
  const assets = dialogueAssets({ image });
  root.tabIndex = -1;
  let current: DialogueState | undefined,
    hover: string | undefined,
    pressed: string | undefined,
    armed: string | undefined,
    released: string | undefined,
    dragging: boolean | undefined,
    previousFocus: ReturnType<typeof focusTarget>,
    center = { x: 400, y: 300 };
  const box = (element: HTMLElement, x: number, y: number, width: number, height: number) =>
    Object.assign(element.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  const stamp = (path: string, x: number, y: number) => {
    const art = image(path);
    if (art.ready) ctx.drawImage(art.img, x, y);
  };
  function reset(restore = false) {
    const c = current;
    c?.abort.abort();
    root.removeAttribute("aria-busy");
    if (c) center = { x: c.x + Math.trunc(c.width / 2), y: c.y + Math.trunc(c.height / 2) };
    current = hover = pressed = armed = released = dragging = undefined;
    root.classList.add("hidden");
    targets.replaceChildren();
    input.value = "";
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    if (restore && previousFocus?.isConnected) previousFocus.focus();
    else blurWithin(root);
    previousFocus = undefined;
  }
  function finish(answer: number, value?: number) {
    const c = current;
    if (!c || (answer === 1 && c.loading)) return;
    const reply: QuestReply = { kind: c.body.kind, answer };
    if (answer === 1 && (c.body.kind === "askText" || c.body.kind === "askNumber")) {
      const reason = dialogueInputError(c.body, input.value);
      if (reason) {
        error.textContent = reason;
        input.setCustomValidity(reason);
        input.setAttribute("aria-invalid", "true");
        input.focus();
        input.select();
        return;
      }
      if (reply.kind === "askText")
        reply.text = input.value; // Do NOT trim a CP949 edit buffer.
      else if (reply.kind === "askNumber") reply.value = Number(input.value);
    } else if (answer === 1 && reply.kind === "menu") {
      if (!c.pieces.some((p) => p.selection === value)) return;
      reply.value = value;
    }
    reset(true);
    onReply(reply, c.context);
  }
  function close(notify = true) {
    if (!current) return;
    if (notify) finish(current.body.kind === "say" || current.body.kind === "confirm" ? 255 : 0);
    else reset();
  }
  function buttonTarget(
    spec: { key: string; name: string; label?: string; silent?: boolean },
    action: () => void,
  ) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "sprite-hit";
    element.dataset.dialogueKey = spec.key;
    element.textContent = spec.label ?? spec.name;
    element.setAttribute("aria-label", spec.label ?? spec.name);
    element.addEventListener("click", (event) => {
      if (event.button !== 0 || (event.detail > 0 && released !== spec.key)) return;
      released = undefined;
      action();
    });
    element.addEventListener("mouseenter", () => {
      if (hover !== spec.key && !spec.silent) void audio.effect("UI/BtMouseOver");
      hover = spec.key;
    });
    element.addEventListener("mouseleave", () => {
      if (hover === spec.key) hover = undefined;
    });
    element.addEventListener("focus", () => {
      hover = spec.key;
    });
    element.addEventListener("blur", () => {
      hover = pressed = undefined;
    });
    element.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        pressed = armed = spec.key;
        released = undefined;
      }
    });
    element.addEventListener("mouseup", (event) => {
      if (event.button === 0) {
        released = armed === spec.key ? spec.key : undefined;
        armed = pressed = undefined;
      }
    });
    targets.append(element);
    return element;
  }
  function placeTargets() {
    const c = current;
    if (!c) return;
    for (const target of c.buttons)
      box(target.element, c.x + target.x, c.y + target.y, target.width, target.height);
    for (const target of c.choices) {
      const p = target.piece,
        top = Math.max(1, p.y - c.scroll * 8),
        bottom = Math.min(c.visibleHeight - 1, p.y + p.height - c.scroll * 8);
      const left = Math.max(1, p.x),
        right = Math.min(c.textWidth - 1, p.x + p.width);
      target.element.classList.toggle("hidden", bottom <= top || right <= left);
      box(
        target.element,
        c.x + c.textX + left,
        c.y + c.textY + top,
        Math.max(0, right - left),
        Math.max(0, bottom - top),
      );
    }
  }
  function setScroll(value: number) {
    if (!current) return;
    current.iconHover = undefined;
    current.scroll = Math.max(0, Math.min(current.maxScroll, Math.round(value)));
    placeTargets();
  }
  const choiceStops = (c: DialogueState) =>
    c.choices.filter((choice) => choice.element.tabIndex === 0);
  function reveal(c: DialogueState, piece: DialoguePiece) {
    if (piece.y < c.scroll * 8 + 1) setScroll(Math.floor((piece.y - 1) / 8));
    else if (piece.y + piece.height > c.scroll * 8 + c.visibleHeight)
      setScroll(Math.ceil((piece.y + piece.height + 1 - c.visibleHeight) / 8));
  }
  function measureLayout(
    body: QuestTalkBody,
    assetMap: ReadonlyMap<string, DialogueAsset>,
  ): DialogueLayout {
    ctx.save();
    const layout = dialogueLayout(
      body,
      (text, bold) => {
        ctx.font = (bold ? "bold " : "") + DIALOGUE_FONT;
        return ctx.measureText(text).width;
      },
      (run) => assetMap.get(dialogueAssetKey(run)),
    );
    ctx.restore();
    return layout;
  }
  function applyLayout(c: DialogueState, prepared?: DialogueLayout) {
    if (current !== c) return;
    const focusKey = document.activeElement?.getAttribute("data-dialogue-key");
    const anchor = c.width
      ? { x: c.x + Math.trunc(c.width / 2), y: c.y + Math.trunc(c.height / 2) }
      : center;
    const layout = prepared ?? measureLayout(c.body, c.assetMap);
    Object.assign(c, layout, { height: Math.min(600, layout.height), iconHover: undefined });
    c.x = Math.max(0, Math.min(800 - c.width, anchor.x - Math.trunc(c.width / 2)));
    c.y = Math.max(0, Math.min(600 - c.height, anchor.y - Math.trunc(c.height / 2)));
    const editing = c.body.kind === "askText" || c.body.kind === "askNumber";
    if (editing) {
      c.editorHeight = Math.min(c.textHeight, c.height - 99);
      if (c.editorHeight < c.textHeight)
        c.maxScroll = Math.ceil((c.textHeight - c.editorHeight) / 8);
      box(input, c.x + 16, c.y + c.editorHeight + 38, c.width - 30, 14);
    }
    c.scroll = Math.max(0, Math.min(c.maxScroll, c.scroll));
    label.textContent = dialoguePlainText(c.runs, (run) => c.assetMap.get(dialogueAssetKey(run)));
    targets.replaceChildren();
    c.choices = [];
    c.buttons = [];
    hover = pressed = armed = released = undefined;
    dragging = false;
    for (const spec of dialogueButtons(c.body, c.width, c.height)) {
      const element = buttonTarget(spec, () => finish(spec.answer));
      c.buttons.push({ ...spec, element });
    }
    if (c.body.kind === "menu") {
      const names = new Map<number, string[]>();
      for (const run of c.runs)
        if (run.selection !== undefined)
          names.set(run.selection, [
            ...(names.get(run.selection) || []),
            dialoguePlainText([run], (record) => c.assetMap.get(dialogueAssetKey(record))),
          ]);
      const seen = new Set<number>();
      for (const piece of c.pieces) {
        if (piece.selection === undefined || piece.width <= 0) continue;
        const name = names.get(piece.selection);
        if (!name) throw new Error("Dialogue choice has no source text");
        const spec = { key: `choice-${piece.selection}`, name: name.join(" "), silent: true };
        const element = buttonTarget(spec, () => finish(1, piece.selection));
        element.disabled = c.loading;
        element.tabIndex = seen.has(piece.selection) ? -1 : 0;
        seen.add(piece.selection);
        element.addEventListener("focus", () => reveal(c, piece));
        c.choices.push({ piece, element });
      }
    }
    for (const name of [
      "Border/0",
      "Border/1",
      "Border/2",
      "Border/3",
      "Border/4",
      "Border/5",
      "Border/6",
      "Border/7",
    ])
      image(`UI/UIWindow.img/UtilDlgEx2/${name}`);
    for (const spec of c.buttons)
      for (const state of ["normal", "mouseOver", "pressed"])
        image(
          spec.key === "close"
            ? `UI/UIWindow.img/BtUIClose2/${state}/0`
            : `UI/UIWindow.img/UtilDlgEx2/Bt${spec.name}/${state}/0`,
        );
    if (c.scrolling)
      for (const name of ["base", "prev0", "next0", "thumb0", "thumb1"])
        image(`UI/Basic.img/VScr/enabled/${name}`);
    placeTargets();
    if (focusKey) {
      const target = [...choiceStops(c), ...c.buttons].find(
        (item) => item.element.dataset.dialogueKey === focusKey,
      );
      if (target && !target.element.disabled) {
        if (target.piece) reveal(c, target.piece);
        target.element.focus();
      }
    }
  }
  function show(npcId: number, body: QuestTalkBody, context?: DialoguePreviewContext) {
    if (current) return false; // One packet-owned modal, never silently replace or accept it.
    previousFocus = focusTarget(document.activeElement);
    const runs = dialogueRuns(body.message);
    const assetMap = new Map<string, DialogueAsset>(),
      layout = measureLayout(body, assetMap);
    const c: DialogueState = {
      ...layout,
      npcId,
      body,
      context,
      runs,
      scroll: 0,
      assetMap,
      abort: new AbortController(),
      loading: runs.some((run) => run.kind),
      x: center.x - Math.trunc(layout.width / 2),
      y: center.y - Math.trunc(Math.min(600, layout.height) / 2),
      height: Math.min(600, layout.height),
      choices: [],
      buttons: [],
    };
    current = c;
    root.setAttribute("aria-busy", String(c.loading));
    const editing = body.kind === "askText" || body.kind === "askNumber";
    input.classList.toggle("hidden", !editing);
    if (editing) {
      input.inputMode = body.kind === "askNumber" ? "numeric" : "text";
      input.maxLength = body.kind === "askText" ? (body.maxLength < 0 ? 65535 : body.maxLength) : 9;
      input.value = String(body.kind === "askText" ? body.defaultText : body.defaultValue);
    }
    applyLayout(c, layout);
    root.classList.remove("hidden");
    onOpen();
    if (editing) {
      input.focus();
      input.select();
    } else if (c.loading) root.focus();
    else
      (
        choiceStops(c)[0]?.element ??
        c.buttons.find((b) => b.answer === 1)?.element ??
        c.buttons[0]?.element
      )?.focus();
    if (c.loading) {
      const complete = (map: Map<string, DialogueAsset>) => {
        if (current !== c || c.abort.signal.aborted) return;
        const focusRoot = document.activeElement === root;
        c.assetMap = map;
        c.loading = false;
        root.setAttribute("aria-busy", "false");
        applyLayout(c);
        if (focusRoot) {
          const first = choiceStops(c)[0] ?? c.buttons.find((b) => b.answer === 1) ?? c.buttons[0];
          if (first) {
            if (first.piece) reveal(c, first.piece);
            first.element.focus();
          }
        }
      };
      void assets.load(runs, c.abort.signal).then(complete, () => complete(new Map()));
    }
    // Font arrival can change wrap; never reset the editor, scroll, or a newer packet's modal.
    void document.fonts
      ?.load(DIALOGUE_FONT)
      .then(() => {
        if (current === c) applyLayout(c);
      })
      .catch(() => {});
    // Original modal open has no extra DlgNotice sound.
    return true;
  }
  input.addEventListener("input", () => {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    error.textContent = "";
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!current) return;
      event.stopImmediatePropagation();
      if (event.isComposing || event.keyCode === 229) return;
      const c = current;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) close();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const controls = [
          ...(input.classList.contains("hidden") ? [] : [input]),
          ...choiceStops(c)
            .filter((x) => !x.element.disabled)
            .map((x) => x.element),
          ...c.buttons.map((x) => x.element),
        ];
        const index = controls.findIndex((control) => control === document.activeElement),
          count = controls.length;
        const next =
          controls[
            index < 0
              ? event.shiftKey
                ? count - 1
                : 0
              : (index + (event.shiftKey ? count - 1 : 1)) % count
          ];
        const choice = c.choices.find((x) => x.element === next);
        if (choice && choice.element.classList.contains("hidden")) reveal(c, choice.piece);
        next?.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (event.repeat) return;
        if (c.body.kind === "menu") {
          const choice = c.choices.find((x) => x.element === document.activeElement);
          if (choice) finish(1, choice.piece.selection);
          else if (c.buttons.some((b) => b.element === document.activeElement)) close();
        } else if (c.body.kind === "confirm") {
          const button = c.buttons.find((x) => x.element === document.activeElement);
          if (button) finish(button.answer);
        } else finish(1);
      } else if (event.key === " " && document.activeElement !== input) {
        event.preventDefault();
        if (!event.repeat && document.activeElement instanceof HTMLElement)
          document.activeElement.click();
      } else if (c.body.kind === "confirm" && /^[yn]$/i.test(event.key)) {
        event.preventDefault();
        if (!event.repeat) finish(event.key.toLowerCase() === "y" ? 1 : 0);
      } else if (
        c.maxScroll > 0 &&
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        setScroll(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? c.maxScroll
              : c.scroll +
                {
                  ArrowUp: -1,
                  ArrowDown: 1,
                  PageUp: -Math.floor((c.editorHeight ?? c.visibleHeight) / 8),
                  PageDown: Math.floor((c.editorHeight ?? c.visibleHeight) / 8),
                }[event.key as "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown"],
        );
      } else if (document.activeElement !== input && !(event.ctrlKey || event.metaKey))
        event.preventDefault();
    },
    { capture: true },
  );
  root.addEventListener("mousemove", (event) => {
    const c = current;
    if (!c || c.loading) return;
    const p = point(event),
      x = p.x - c.x - c.textX,
      y = p.y - c.y - c.textY;
    c.iconHover = undefined;
    if (x <= 0 || x >= c.textWidth - 1 || y <= 0 || y >= c.visibleHeight - 1) return;
    const piece = c.pieces.find(
      (piece) =>
        piece.image &&
        x > piece.x &&
        x < piece.x + piece.width &&
        y > piece.y - c.scroll * 8 &&
        y < piece.y + piece.height - c.scroll * 8,
    );
    if (piece) c.iconHover = { text: piece.text, x: p.x + 20, y: p.y + 20 };
  });
  root.addEventListener("mouseleave", () => {
    if (current) current.iconHover = undefined;
  });
  root.addEventListener(
    "wheel",
    (event) => {
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      setScroll(current.scroll + Math.sign(event.deltaY) * 3);
    },
    { passive: false },
  );
  root.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !current?.scrolling || event.target !== root) return;
    const c = current,
      p = point(event),
      x = c.x + c.textX + c.textWidth,
      y = c.y + c.textY;
    if (p.x < x || p.x >= x + VSCR_CELL || p.y < y || p.y >= y + c.visibleHeight) return;
    event.preventDefault();
    if (p.y < y + VSCR_CELL) setScroll(c.scroll - 1);
    else if (p.y >= y + c.visibleHeight - VSCR_CELL) setScroll(c.scroll + 1);
    else {
      dragging = true;
      // The thumb is grabbed at its centre, not its top edge: one cap plus half a thumb.
      const grab = VSCR_CELL + VSCR_CELL / 2;
      setScroll(((p.y - y - grab) / vScrollTravel(c.visibleHeight)) * c.maxScroll);
    }
  });
  window.addEventListener("mousemove", (event) => {
    if (!current || !dragging) return;
    const c = current;
    // Same centre-grab offset as the mousedown arm above.
    const grab = VSCR_CELL + VSCR_CELL / 2;
    setScroll(
      ((point(event).y - c.y - c.textY - grab) / vScrollTravel(c.visibleHeight)) * c.maxScroll,
    );
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    pressed = armed = undefined;
  });
  root.addEventListener(
    "mousedown",
    (event) => {
      if (event.button === 0) armed = released = pressed = undefined;
    },
    { capture: true },
  );
  root.addEventListener("contextmenu", (event) => event.preventDefault());
  for (const name of ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"])
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
  releaseOnInterrupt(() => {
    if (current) current.iconHover = undefined;
    pressed = hover = armed = released = undefined;
    dragging = false;
  });
  return {
    show,
    close,
    get open() {
      return !!current;
    },
    get preview() {
      return current?.context?.preview === true;
    },
    draw() {
      const c = current;
      if (!c) return;
      const { x, y, width: w, height: h } = c;
      ctx.save();
      drawUtilFrame(ctx, image, x, y, w, h, true);
      const editing = c.body.kind === "askText" || c.body.kind === "askNumber";
      if (!editing && c.visibleHeight > 1) {
        drawUtilTextFrame(ctx, x + c.textX, y + c.textY, c.textWidth, c.visibleHeight, true);
      }
      ctx.save();
      ctx.beginPath();
      const editorHeight = Math.min(c.textHeight, c.height - 99);
      const clipHeight = editing ? Math.max(0, editorHeight) : Math.max(0, c.visibleHeight - 2);
      ctx.rect(x + c.textX + 1, y + c.textY + 1, c.textWidth - 2, clipHeight);
      ctx.clip();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (const piece of c.pieces) {
        const py = y + c.textY + piece.y - c.scroll * 8;
        if (py + piece.height < y + c.textY || py >= y + c.textY + clipHeight) continue;
        ctx.font = (piece.bold ? "bold " : "") + DIALOGUE_FONT;
        ctx.fillStyle = DIALOGUE_COLORS[piece.color];
        if (piece.image) stamp(piece.image, x + c.textX + piece.x, py);
        else ctx.fillText(piece.text, x + c.textX + piece.x, py);
        if (piece.selection !== undefined && hover === `choice-${piece.selection}`) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(x + c.textX + piece.x, py + piece.height - 1, piece.width, 1);
        }
      }
      ctx.restore();
      if (editing) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(x + 13, y + editorHeight + 35, w - 25, 18);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + 14, y + editorHeight + 36, w - 27, 16);
      }
      if (c.scrolling) {
        const sx = x + c.textX + c.textWidth,
          sy = y + c.textY,
          base = "UI/Basic.img/VScr/enabled";
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, VSCR_CELL, c.visibleHeight);
        ctx.clip();
        for (let py = VSCR_CELL; py < c.visibleHeight - VSCR_CELL; py += VSCR_CELL)
          stamp(`${base}/base`, sx, sy + py);
        stamp(`${base}/prev0`, sx, sy);
        stamp(`${base}/next0`, sx, sy + c.visibleHeight - VSCR_CELL);
        stamp(
          `${base}/${dragging ? "thumb1" : "thumb0"}`,
          sx,
          sy + VSCR_CELL + Math.round((vScrollTravel(c.visibleHeight) * c.scroll) / c.maxScroll),
        );
        ctx.restore();
      }
      for (const spec of c.buttons) {
        const state =
          pressed === spec.key ? "pressed" : hover === spec.key ? "mouseOver" : "normal";
        const path =
          spec.key === "close"
            ? `UI/UIWindow.img/BtUIClose2/${state}/0`
            : `UI/UIWindow.img/UtilDlgEx2/Bt${spec.name}/${state}/0`;
        stamp(path, x + spec.x, y + spec.y);
      }
      ctx.restore();
      if (c.iconHover)
        drawSimpleTooltip(ctx, c.iconHover.x, c.iconHover.y, c.iconHover.text, {
          font: DIALOGUE_FONT,
        });
    },
  };
}
