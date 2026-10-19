import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";
import { HUD_FONT } from "./hud.ts";
import { requireElement, focusTarget } from "./dom.ts";
import { releaseOnInterrupt } from "./pointer.ts";
import {
  PLAYER_MENU,
  playerMenuRows,
  playerMenuLayout,
  playerMenuRowRect,
  playerMenuRowAt,
  type PlayerMenuTarget,
  type PlayerMenuRow,
  type PlayerMenuAction,
} from "./player-menu-data.ts";
export interface PlayerMenuState {
  target: PlayerMenuTarget;
  rows: PlayerMenuRow[];
  layout: ReturnType<typeof playerMenuLayout>;
  selected: number | undefined;
}
/** 52E780 draws real WZ cap/cells/bottom, THEN text. 52E670 keeps previous hover on gaps/title.
 * No invented border/background and no CCtrlButton hover/click sound (this is not CCtrlButton).
 */
export function drawPlayerMenu(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  state: PlayerMenuState,
) {
  const frames = [0, 1, 2, 3].map((index) => image(`${PLAYER_MENU.path}${index}`));
  if (!frames.every((frame) => frame.ready)) return;
  const { x, y } = state.layout;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frames[0]!.img, x + 8, y);
  for (let index = 0; index < state.rows.length - 1; index++)
    ctx.drawImage(
      frames[index === 0 ? 1 : 2]!.img,
      x + 8,
      y + PLAYER_MENU.cap + index * PLAYER_MENU.row,
    );
  ctx.drawImage(frames[3]!.img, x, y + PLAYER_MENU.cap + (state.rows.length - 1) * PLAYER_MENU.row);
  ctx.font = HUD_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const [index, row] of state.rows.entries()) {
    const rect = playerMenuRowRect(index);
    const selected = index === state.selected && row.enabled;
    if (selected) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x + rect.x, y + rect.y, rect.width, rect.height);
    }
    ctx.fillStyle = index === 0 || selected ? "#ffffff" : row.enabled ? "#000000" : "#404040";
    ctx.fillText(row.text, x + rect.x + 1, y + rect.y + 1);
  }
  ctx.restore();
}
/** Native pointer-captured CUIContextMenu, plus explicit browser focus/keyboard/reachability policy.
 * Buttons are transparent accessibility/hit targets; only the canvas paints original art/text.
 */
export function playerMenu({
  ctx,
  image,
  point,
  canOpen,
  valid,
  onOpen,
  onAction,
  onError = () => {},
  canInvite = () => true,
}: {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  point(event: MouseEvent): UiPoint;
  canOpen(): boolean;
  canInvite?(): boolean;
  valid(target: PlayerMenuTarget): boolean;
  onOpen(): void;
  onAction(action: PlayerMenuAction, target: PlayerMenuTarget): void;
  onError?(message: string): void;
}) {
  const root = document.createElement("section");
  root.id = "player-menu";
  root.className = "player-menu hidden";
  root.tabIndex = -1;
  root.setAttribute("role", "menu");
  requireElement("game-ui", "div").append(root);
  let current: PlayerMenuState | undefined,
    epoch = 0;
  let previousFocus: ReturnType<typeof focusTarget>;
  let pending = false;
  let blockClick = false,
    blockContext = false;
  const consume = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const localPoint = (event: MouseEvent, state: PlayerMenuState) => {
    const p = point(event);
    return { x: p.x - state.layout.x, y: p.y - state.layout.y };
  };
  const inside = (p: UiPoint, state: PlayerMenuState) =>
    p.x > 0 && p.y > 0 && p.x < state.layout.width && p.y < state.layout.height;
  function close(restore = true) {
    ++epoch;
    pending = false;
    const wasOpen = !!current;
    current = undefined;
    root.classList.add("hidden");
    root.replaceChildren();
    if (wasOpen && root.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    if (wasOpen && restore && previousFocus?.isConnected) previousFocus.focus();
    previousFocus = undefined;
  }
  function activate(index: number | undefined) {
    const state = current,
      row = index === undefined ? undefined : state?.rows[index];
    const allowed = !!state && canOpen() && valid(state.target);
    close(false);
    if (allowed && row?.enabled && row.action) onAction(row.action, state!.target);
  }
  async function warm() {
    const frames = [0, 1, 2, 3].map((index) => image(`${PLAYER_MENU.path}${index}`));
    try {
      await Promise.all(frames.map((frame) => frame.loading));
      if (frames.every((frame) => frame.ready)) return true;
      onError("原版角色選單素材尚未載入，未開啟不可見的操作區。");
    } catch (error) {
      onError(`原版角色選單素材讀取失敗：${String(error)}`);
    }
    return false;
  }
  function select(index: number, focus = false) {
    if (!current || !current.rows[index]?.enabled) return;
    current.selected = index;
    for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
      const active = Number(button.dataset.index) === index;
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus({ preventScroll: true });
    }
  }
  window.addEventListener(
    "mousemove",
    (event) => {
      if (!current) return;
      const index = playerMenuRowAt(current.rows, localPoint(event, current));
      if (index !== undefined) select(index);
      consume(event);
    },
    { capture: true },
  );
  window.addEventListener(
    "mousedown",
    (event) => {
      if (!current) {
        if (pending) close(false);
        blockClick = blockContext = false;
        return;
      }
      if (event.button === 0) blockClick = true;
      if (!inside(localPoint(event, current), current)) {
        blockContext = event.button === 2;
        close();
      }
      consume(event);
    },
    { capture: true },
  );
  window.addEventListener(
    "mouseup",
    (event) => {
      if (!current && !blockClick) return;
      if (current && event.button === 0) {
        const state = current;
        const p = localPoint(event, state);
        const row = playerMenuRowAt(state.rows, p);
        // Browser-disabled info/trade and dead gaps must NEVER invoke a sticky older fame choice.
        if (inside(p, state) && row !== undefined) activate(row);
        else close();
      }
      consume(event);
    },
    { capture: true },
  );
  window.addEventListener(
    "click",
    (event) => {
      if (blockClick) {
        blockClick = false;
        consume(event);
      } else if (current && !root.contains(event.target as Node)) {
        close();
        consume(event);
      }
    },
    { capture: true },
  );
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (current || blockContext) {
        blockContext = false;
        consume(event);
      }
    },
    { capture: true },
  );
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : undefined;
    if (target instanceof HTMLButtonElement && !target.disabled)
      activate(Number(target.dataset.index));
    consume(event);
  });
  root.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLButtonElement) select(Number(event.target.dataset.index));
  });
  root.addEventListener("focusout", (event) => {
    if (current && !(event.relatedTarget instanceof Node && root.contains(event.relatedTarget)))
      close(false);
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!current) return;
      consume(event);
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        if (!event.repeat) activate(current.selected);
        return;
      }
      const choices = current.rows.flatMap((row, index) => (row.enabled ? [index] : []));
      if (!choices.length) return;
      const old = current.selected === undefined ? -1 : choices.indexOf(current.selected);
      const backwards = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
      if (["ArrowDown", "ArrowUp", "Tab"].includes(event.key))
        select(
          choices[
            old < 0
              ? backwards
                ? choices.length - 1
                : 0
              : (old + (backwards ? -1 : 1) + choices.length) % choices.length
          ]!,
          true,
        );
      else if (event.key === "Home") select(choices[0]!, true);
      else if (event.key === "End") select(choices.at(-1)!, true);
    },
    { capture: true },
  );
  releaseOnInterrupt(() => {
    close(false);
    blockClick = blockContext = false;
  });
  return {
    get open() {
      return !!current;
    },
    get state(): Readonly<PlayerMenuState> | undefined {
      return current;
    },
    warm,
    close,
    async show(target: PlayerMenuTarget, at: UiPoint, leader: boolean) {
      close(false);
      const generation = epoch;
      if (!canOpen() || !valid(target)) return false;
      pending = true;
      const ready = await warm();
      if (generation !== epoch) return false;
      pending = false;
      if (!ready || !canOpen() || !valid(target)) return false;
      const rows = playerMenuRows(target.name, leader, canInvite()),
        layout = playerMenuLayout(at, rows.length);
      previousFocus = focusTarget(document.activeElement);
      current = { target: { ...target }, rows, layout, selected: undefined };
      root.setAttribute("aria-label", `${target.name} · 角色選單`);
      Object.assign(root.style, {
        left: `${layout.x}px`,
        top: `${layout.y}px`,
        width: `${layout.width}px`,
        height: `${layout.height}px`,
      });
      for (const [index, row] of rows.entries()) {
        if (!row.action) continue;
        const button = document.createElement("button"),
          rect = playerMenuRowRect(index);
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = row.text;
        button.disabled = !row.enabled;
        button.title = row.reason ?? row.text;
        button.dataset.index = String(index);
        button.dataset.action = row.action;
        button.tabIndex = -1;
        Object.assign(button.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        root.append(button);
      }
      root.classList.remove("hidden");
      onOpen();
      root.focus({ preventScroll: true });
      return true;
    },
    draw() {
      if (current && (!canOpen() || !valid(current.target))) close(false);
      if (current) drawPlayerMenu(ctx, image, current);
    },
  };
}
