/** Owns title/modal/selection DOM and input. Transport, character creation and actor caches are injected. */
import { isEditingControl, requireElement } from "./dom.ts";
import type { GameElements } from "./game-dom.ts";
import { loginSelection, type LoginLook, type LoginSelectionRequest } from "./login-data.ts";
import {
  drawSelectionScreen,
  drawTitleScreen,
  TITLE_BUTTONS,
  type LoginPainting,
  type LoginPointerState,
  type LoginStage,
} from "./login-presentation.ts";
import { characterSlot, SELECTION_BUTTONS, WORLD_UI } from "./selection.ts";

interface LoginScreenOptions extends LoginPainting {
  ui: GameElements["ui"];
  audio: { effect(path: string): unknown; setBgm(path: string): unknown };
  connect(): void;
  log(message: string): void;
  send(request: LoginSelectionRequest): unknown;
  preload(look: LoginLook): unknown;
  dismissLabs(): void;
  labOpen(): boolean;
  creation(): {
    readonly open: boolean;
    openCreate(): unknown;
    openDelete(): unknown;
    draw(now: number): void;
  };
}
/** Optional remembered account name only; no password persistence and no import-time DOM access. */
export function loginScreen(options: LoginScreenOptions) {
  const { ui, audio } = options;
  const title = requireElement("title-ui", "div"),
    menu = requireElement("title-menu", "nav");
  const notice = requireElement("title-notice", "p"),
    remember = requireElement("remember-user", "input");
  const bar = requireElement("bar", "header");
  const buttons = new Map<string, HTMLButtonElement>();
  for (const { id } of [...TITLE_BUTTONS, ...SELECTION_BUTTONS])
    buttons.set(id, requireElement(id, "button"));
  function button(id: string) {
    const element = buttons.get(id);
    if (!element) throw new Error(`Unknown login button #${id}`);
    return element;
  }
  const abort = new AbortController(),
    events = { signal: abort.signal };
  const selection = loginSelection();
  let stage: LoginStage = "title",
    dialogOpen = false,
    loginPending = false;
  const disabled = (id: string) => button(id).disabled;
  const titlePointer: LoginPointerState = { disabled },
    selectionPointer: LoginPointerState = { disabled };
  function clearPointer() {
    titlePointer.hover =
      titlePointer.pressed =
      selectionPointer.hover =
      selectionPointer.pressed =
        undefined;
  }
  function refresh() {
    button("world-connect").disabled = !selection.canConnect;
    button("character-enter").disabled = button("character-delete").disabled = !selection.canEnter;
    button("character-new").disabled = !selection.canCreate;
    [...ui.worldList.children].forEach((element, index) =>
      element.setAttribute(
        "aria-pressed",
        String(selection.scroll + index === selection.worldIndex),
      ),
    );
    [...ui.characterList.children].forEach((element, index) =>
      element.setAttribute("aria-pressed", String(index === selection.characterIndex)),
    );
  }
  function showPanel(panel: HTMLElement) {
    if (panel !== ui.connect && panel !== ui.worlds && panel !== ui.characters)
      throw new Error("Unknown login panel");
    options.dismissLabs();
    stage = panel === ui.connect ? "title" : panel === ui.worlds ? "worlds" : "characters";
    audio.setBgm(stage === "title" ? "BgmUI/Title" : "BgmUI/WCSelect");
    dialogOpen = panel === ui.connect;
    clearPointer();
    title.classList.toggle("hidden", stage !== "title");
    menu.classList.toggle("hidden", dialogOpen);
    bar.classList.add("hidden");
    for (const element of [ui.connect, ui.worlds, ui.characters]) element.classList.add("hidden");
    panel.classList.remove("hidden");
    refresh();
  }
  function closeTitleLogin() {
    if (loginPending) return;
    dialogOpen = false;
    clearPointer();
    ui.connect.classList.add("hidden");
    menu.classList.remove("hidden");
    ui.pass.value = "";
    ui.status.textContent = "";
    button("title-continue").focus();
  }
  function connectWorld() {
    if (stage !== "worlds" || options.labOpen() || options.creation().open) return;
    const request = selection.connectWorld();
    if (!request) return;
    refresh();
    options.send(request);
    showPanel(ui.characters);
    ui.characterStatus.textContent = "讀取角色…";
  }
  function enterCharacter() {
    if (stage !== "characters" || options.labOpen() || options.creation().open) return;
    const request = selection.enterCharacter();
    if (!request) return;
    refresh();
    ui.characterStatus.textContent = "進入遊戲…";
    options.send(request);
  }
  function selectCharacter(index: number) {
    if (options.labOpen() || options.creation().open || !selection.selectCharacter(index)) return;
    void audio.effect("UI/CharSelect");
    refresh();
  }
  function rebuildWorldRows() {
    ui.worldList.replaceChildren(
      ...selection.worlds
        .slice(selection.scroll, selection.scroll + WORLD_UI.visibleRows)
        .map((world, offset) => {
          const index = selection.scroll + offset,
            element = document.createElement("button");
          element.type = "button";
          element.className = "sprite-hit";
          element.textContent = world.name;
          element.setAttribute("aria-label", world.name);
          Object.assign(element.style, {
            left: `${WORLD_UI.x + WORLD_UI.rowX}px`,
            top: `${WORLD_UI.y + WORLD_UI.rowY + WORLD_UI.rowHeight * offset}px`,
            width: `${WORLD_UI.rowWidth}px`,
            height: `${WORLD_UI.rowHeight}px`,
          });
          element.dataset.loginIndex = String(index);
          return element;
        }),
    );
    refresh();
  }
  function rejectList(kind: string, error: unknown): false {
    const text = `無效${kind}清單，請重新登入：${error instanceof Error ? error.message : String(error)}`;
    // Do not allow commands using a stale list after a malformed reply. A valid new reply unlocks it.
    selection.block();
    refresh();
    ui.status.textContent = ui.characterStatus.textContent = text;
    ui.status.classList.add("bad");
    ui.characterStatus.classList.add("bad");
    options.log(text);
    return false;
  }
  function replaceCharacters(value: unknown): boolean {
    try {
      selection.replaceCharacters(value);
    } catch (error) {
      return rejectList("角色", error);
    }
    ui.characterList.replaceChildren(
      ...selection.characters.map((character, index) => {
        const slot = characterSlot(index);
        if (!slot) throw new Error(`Character index ${index} exceeds native slots`);
        const element = document.createElement("button");
        element.type = "button";
        element.className = "sprite-hit";
        element.textContent = character.name;
        element.title = `${character.name} · Lv.${character.level}`;
        element.setAttribute("aria-label", element.title);
        Object.assign(element.style, {
          left: `${slot.x}px`,
          top: `${slot.y}px`,
          width: `${slot.width}px`,
          height: `${slot.height}px`,
        });
        element.dataset.loginIndex = String(index);
        options.preload(character);
        return element;
      }),
    );
    refresh();
    return true;
  }
  function submit() {
    if (!loginPending && stage === "title" && dialogOpen) options.connect();
  }
  // A bounded set of listeners: scrolling/replacing rows never adds AbortSignal subscriptions.
  function rowIndex(event: Event, root: HTMLElement): number | undefined {
    const element = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(element instanceof HTMLButtonElement) || element.parentElement !== root) return undefined;
    const value = element.dataset.loginIndex;
    if (value === undefined || !/^\d+$/.test(value)) return undefined;
    return Number(value);
  }
  ui.worldList.addEventListener(
    "click",
    (event) => {
      if (stage !== "worlds" || options.labOpen() || options.creation().open) return;
      const index = rowIndex(event, ui.worldList);
      if (index !== undefined && selection.selectWorld(index)) refresh();
    },
    events,
  );
  ui.worldList.addEventListener(
    "dblclick",
    (event) => {
      if (rowIndex(event, ui.worldList) !== undefined) connectWorld();
    },
    events,
  );
  ui.characterList.addEventListener(
    "click",
    (event) => {
      const index = rowIndex(event, ui.characterList);
      if (stage === "characters" && index !== undefined) selectCharacter(index);
    },
    events,
  );
  ui.characterList.addEventListener(
    "dblclick",
    (event) => {
      if (rowIndex(event, ui.characterList) !== undefined) enterCharacter();
    },
    events,
  );
  function bindButton(id: string, state: LoginPointerState, kind: "title" | "selection") {
    const element = button(id);
    const clear = () => {
      state.hover = state.pressed = undefined;
    };
    element.addEventListener(
      kind === "title" ? "mouseenter" : "pointerenter",
      () => {
        state.hover = id;
        if (kind === "title" || !element.disabled) void audio.effect("UI/BtMouseOver");
      },
      events,
    );
    element.addEventListener(kind === "title" ? "mouseleave" : "pointerleave", clear, events);
    element.addEventListener(
      kind === "title" ? "mousedown" : "pointerdown",
      (event) => {
        if (event.button === 0 && !element.disabled) state.pressed = id;
      },
      events,
    );
    element.addEventListener(
      kind === "title" ? "mouseup" : "pointerup",
      () => {
        state.pressed = undefined;
      },
      events,
    );
    element.addEventListener(
      "focus",
      () => {
        state.hover = id;
      },
      events,
    );
    element.addEventListener("blur", clear, events);
    if (kind === "title") {
      element.addEventListener(
        "keydown",
        (event) => {
          if (!element.disabled && (event.key === " " || event.key === "Enter")) state.pressed = id;
        },
        events,
      );
      element.addEventListener(
        "keyup",
        () => {
          state.pressed = undefined;
        },
        events,
      );
    }
  }
  for (const definition of TITLE_BUTTONS) bindButton(definition.id, titlePointer, "title");
  for (const definition of SELECTION_BUTTONS) {
    Object.assign(button(definition.id).style, {
      left: `${definition.x}px`,
      top: `${definition.y}px`,
      width: `${definition.width}px`,
      height: `${definition.height}px`,
    });
    bindButton(definition.id, selectionPointer, "selection");
  }

  window.addEventListener(
    "mouseup",
    () => {
      titlePointer.pressed = undefined;
    },
    events,
  );
  window.addEventListener(
    "pointerup",
    () => {
      selectionPointer.pressed = undefined;
    },
    events,
  );
  window.addEventListener("pointercancel", clearPointer, events);
  window.addEventListener("blur", clearPointer, events);
  button("title-continue").addEventListener(
    "click",
    () => {
      notice.textContent = "";
      showPanel(ui.connect);
      (remember.checked && ui.user.value ? ui.pass : ui.user).focus();
    },
    events,
  );
  button("login-cancel").addEventListener("click", closeTitleLogin, events);
  button("title-new").addEventListener(
    "click",
    () => {
      notice.textContent = "此重建伺服器的帳號由管理員設定；登入後可建立角色，未提供網站註冊。";
    },
    events,
  );
  button("title-homepage").addEventListener(
    "click",
    () => {
      notice.textContent = "原版按鈕連至 MapleStory 官網；此重建版未連接官方帳號服務。";
    },
    events,
  );
  button("title-quit").addEventListener(
    "click",
    () => {
      notice.textContent = "遊戲尚未連線；可直接關閉此瀏覽器分頁離開。";
    },
    events,
  );
  button("login-lost").addEventListener(
    "click",
    () => {
      ui.status.textContent = "帳號及密碼由此重建伺服器的管理員管理，未連接官方帳密查詢服務。";
    },
    events,
  );
  button("world-connect").addEventListener("click", connectWorld, events);
  button("character-enter").addEventListener("click", enterCharacter, events);
  button("character-new").addEventListener(
    "click",
    () => {
      if (
        stage === "characters" &&
        !options.labOpen() &&
        !options.creation().open &&
        selection.canCreate
      )
        void options.creation().openCreate();
    },
    events,
  );
  button("character-delete").addEventListener(
    "click",
    () => {
      if (
        stage === "characters" &&
        !options.labOpen() &&
        selection.canEnter &&
        !options.creation().open
      )
        void options.creation().openDelete();
    },
    events,
  );
  ui.worldList.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (
        stage === "worlds" &&
        !options.labOpen() &&
        !options.creation().open &&
        selection.scrollWorlds(event.deltaY)
      )
        rebuildWorldRows();
    },
    { ...events, passive: false },
  );
  ui.connect.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Tab") return;
      const controls = [
        ui.user,
        ui.pass,
        remember,
        button("login-lost"),
        ui.login,
        button("login-cancel"),
      ].filter((element) => !element.disabled);
      const index = controls.findIndex((element) => element === document.activeElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && index === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      }
    },
    events,
  );
  ui.login.addEventListener("click", submit, events);
  ui.pass.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    },
    events,
  );
  ui.user.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ui.pass.focus();
      }
    },
    events,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (stage === "title") {
        if (event.key === "Escape" && dialogOpen) closeTitleLogin();
        return;
      }
      if (
        stage === "game" ||
        options.labOpen() ||
        options.creation().open ||
        isEditingControl(document.activeElement)
      )
        return;
      // Native button activation owns Enter on a focused hit target; do not send twice on keydown+click.
      if (
        event.key === "Enter" &&
        [
          ...SELECTION_BUTTONS.map((definition) => definition.id),
          "create",
          "create-cancel",
        ].includes(document.activeElement?.id ?? "")
      )
        return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (stage === "worlds") connectWorld();
        else enterCharacter();
      }
      if (selection.pending) return;
      if (stage === "characters" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        if (selection.moveCharacter(delta)) {
          void audio.effect("UI/CharSelect");
          refresh();
        }
      } else if (stage === "worlds" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        if (selection.moveWorld(event.key === "ArrowUp" ? -1 : 1)) rebuildWorldRows();
      }
    },
    events,
  );
  refresh();
  return {
    get stage() {
      return stage;
    },
    get loginPending() {
      return loginPending;
    },
    get selectedCharacter() {
      return selection.selected;
    },
    clearPointer,
    showPanel,
    closeTitleLogin,
    refresh,
    setLoginPending(pending: boolean) {
      loginPending = pending;
      ui.login.disabled =
        ui.user.disabled =
        ui.pass.disabled =
        button("login-cancel").disabled =
          pending;
    },
    setSelectionPending(pending: boolean) {
      selection.setPending(pending);
      refresh();
    },
    replaceWorlds(value: unknown): boolean {
      try {
        selection.replaceWorlds(value);
      } catch (error) {
        return rejectList("世界", error);
      }
      rebuildWorldRows();
      return true;
    },
    replaceCharacters,
    selectCharacterId(id: number) {
      const index = selection.characters.findIndex((character) => character.id === id);
      if (index >= 0) selectCharacter(index);
    },
    hidePanels() {
      options.dismissLabs();
      stage = "game";
      clearPointer();
      title.classList.add("hidden");
      bar.classList.remove("hidden");
      for (const element of [ui.connect, ui.worlds, ui.characters]) element.classList.add("hidden");
    },
    rememberAccount() {
      try {
        localStorage.setItem("kms111.loginUser", remember.checked ? ui.user.value : "");
      } catch {
        /* Only the account name is optional persistence. */
      }
    },
    start() {
      try {
        const saved = localStorage.getItem("kms111.loginUser");
        if (saved) {
          ui.user.value = saved;
          remember.checked = true;
        }
      } catch {
        /* Browser privacy settings may disable persistence. Never store a password. */
      }
      bar.classList.add("hidden");
      ui.connect.classList.add("hidden");
      button("title-continue").focus();
    },
    draw(now: number) {
      if (stage === "title")
        drawTitleScreen(options, { ...titlePointer, dialogOpen, remember: remember.checked });
      else if (stage !== "game") {
        drawSelectionScreen(options, { ...selectionPointer, selection, stage }, now);
        options.creation().draw(now);
      }
    },
    dispose() {
      abort.abort();
      clearPointer();
    },
  };
}
