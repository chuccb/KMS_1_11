import {
  cameraLens,
  LENS_MODES,
  TRANSITIONS,
  lensMode,
  lensTransition,
  lensViewport,
} from "./camera-lens.ts";
import type { LensResolution } from "./camera-lens.ts";
import { requireQuery } from "./dom.ts";
export const LENS_STORAGE_KEY = "kms111.cameraLens";
export const TRANSITION_STORAGE_KEY = "kms111.cameraTransition";
interface LensControlsOptions {
  panel: HTMLDetailsElement;
  onInteract(): void;
  onClose(): void;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
}
export function lensControls({
  panel,
  onInteract,
  onClose,
  storage,
  now = () => performance.now(),
}: LensControlsOptions) {
  if (storage === undefined)
    try {
      storage = window.localStorage;
    } catch {
      /* Browser may deny preferences. */
    }
  const motion = panel.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)");
  const effectiveStyle = () => (motion?.matches ? "cut" : style);
  const select = requireQuery(panel, "#camera-lens", "select"),
    transitionSelect = requireQuery(panel, "#camera-transition", "select"),
    closer = requireQuery(panel, "#camera-closer", "button"),
    wider = requireQuery(panel, "#camera-wider", "button"),
    replay = requireQuery(panel, "#camera-replay", "button"),
    reset = requireQuery(panel, "#camera-reset", "button"),
    status = requireQuery(panel, "#camera-status", "p");
  let selected = lensMode(undefined),
    style = lensTransition(undefined),
    disposed = false;
  try {
    selected = lensMode(storage?.getItem(LENS_STORAGE_KEY));
    style = lensTransition(storage?.getItem(TRANSITION_STORAGE_KEY));
  } catch {
    /* Use safe defaults. */
  }
  const lens = cameraLens(selected),
    listeners: { target: EventTarget; type: string; listener: EventListener }[] = [];
  function listen(target: EventTarget, type: string, listener: EventListener) {
    target.addEventListener(type, listener);
    listeners.push({ target, type, listener });
  }
  function options<T extends string>(
    definitions: readonly { id: T; label: string }[],
    element: HTMLSelectElement,
  ) {
    element.replaceChildren(
      ...definitions.map((definition) => {
        const option = element.ownerDocument.createElement("option");
        option.value = definition.id;
        option.textContent = definition.label;
        return option;
      }),
    );
  }
  options(LENS_MODES, select);
  options(TRANSITIONS, transitionSelect);
  function sync() {
    transitionSelect.disabled = motion?.matches ?? false;
    replay.disabled = motion?.matches ?? false;
    select.value = selected;
    transitionSelect.value = style;
    const index = LENS_MODES.findIndex((mode) => mode.id === selected);
    wider.disabled = index === 0;
    closer.disabled = index === LENS_MODES.length - 1;
  }
  function persist() {
    try {
      storage?.setItem(LENS_STORAGE_KEY, selected);
      storage?.setItem(TRANSITION_STORAGE_KEY, style);
    } catch {
      /* Session-only is still usable. */
    }
  }
  function change() {
    if (disposed) return;
    selected = lensMode(select.value);
    style = lensTransition(transitionSelect.value);
    lens.request(selected, now(), effectiveStyle());
    sync();
    persist();
    onInteract();
  }
  listen(select, "change", change);
  listen(transitionSelect, "change", change);
  for (const [button, step] of [
    [wider, -1],
    [closer, 1],
  ] as const)
    listen(button, "click", () => {
      if (disposed) return;
      const index = LENS_MODES.findIndex((mode) => mode.id === selected),
        next = LENS_MODES[Math.max(0, Math.min(LENS_MODES.length - 1, index + step))];
      select.value = next.id;
      change();
    });
  listen(replay, "click", () => {
    if (!disposed && !motion?.matches) {
      onInteract();
      lens.request(selected, now(), style === "cut" ? "fade" : style, true);
    }
  });
  listen(reset, "click", () => {
    if (disposed) return;
    selected = "normal";
    style = "cut";
    lens.request(selected, now(), "cut");
    sync();
    persist();
    onInteract();
  });
  listen(panel, "toggle", () => {
    if (panel.open) onInteract();
  });
  listen(panel, "keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Escape" && panel.open) {
      event.preventDefault();
      panel.open = false;
      onClose();
    }
    // Native button/select keyboard activation remains intact, but cannot jump/attack the actor.
    event.stopPropagation();
  });
  listen(panel.ownerDocument, "pointerdown", (event) => {
    if (panel.open && event.target instanceof Node && !panel.contains(event.target))
      panel.open = false;
  });
  if (motion)
    listen(motion, "change", () => {
      lens.clear();
      sync();
    });
  sync();
  return {
    get open() {
      return panel.open;
    },
    sample(time: number, resolution: number | LensResolution) {
      const sampled = lens.sample(time),
        viewport = lensViewport(sampled.mode, resolution),
        hud = typeof resolution === "number" ? `UI ${resolution}×` : "HUD 固定原尺寸";
      const text = `視野 ${viewport.width.toFixed(0)}×${viewport.height.toFixed(0)} · 世界像素 ${viewport.pixelScale}× · ${hud}${motion?.matches ? " · 減少動態：直接切換" : ""} · 只改鏡頭，不改碰撞／能力`;
      if (status.textContent !== text) status.textContent = text;
      wider.title =
        viewport.pixelScale === 1 ? "原像素 1× 已顯示目前解析度的完整視野" : "拉遠並保留原像素";
      return { ...sampled, viewport };
    },
    reveal(time: number) {
      lens.reveal(time, effectiveStyle());
    },
    dismiss() {
      panel.open = false;
      lens.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      panel.open = false;
      lens.clear();
      for (const { target, type, listener } of listeners)
        target.removeEventListener(type, listener);
    },
  };
}
