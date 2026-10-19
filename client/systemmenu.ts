import { releaseOnInterrupt } from "./pointer.ts";
import { gameProfile, gameSettings, type GameSettings } from "./gameoptions.ts";
import {
  soundProfile,
  soundSettings,
  nativeVolume,
  sliderCenter,
  sliderStep,
  type SoundSettings,
} from "./systemsettings.ts";
import { requireElement, blurWithin, focusTarget } from "./dom.ts";
import type { ImageLookup } from "./render-types.ts";
import type { UiAudio, UiPoint } from "./ui-types.ts";

type Mode = "menu" | "game" | "sound";
type SoundSlider = "bgm" | "effects";
type ControlSpec =
  | { kind: "button"; id: string; path?: string }
  | { kind: "sound-slider"; id: SoundSlider }
  | { kind: "video"; id: "video"; fixed: number }
  | { kind: "sound-check"; id: "bgmMuted" | "effectsMuted" }
  | { kind: "game-check"; id: keyof GameSettings };
interface ControlBox {
  el: HTMLButtonElement;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
}
type Control = ControlSpec & ControlBox;
interface SystemMenuOptions {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  audio: UiAudio & { applySettings(value: unknown): unknown; readonly settings: SoundSettings };
  point(event: MouseEvent): UiPoint;
  canOpen(): boolean;
  onOpen(): void;
  onQuit(): void;
  onGameSettings?(settings: GameSettings): void;
}
// Native CUIGameMenu / CUIGameOpt / CUISysOpt dialog origins in the 800×600 viewport.
const ORIGIN = {
  menu: { x: 312, y: 180 },
  game: { x: 317, y: 177 },
  sound: { x: 226, y: 187 },
} as const;
/** CUIGameMenu 52C8E0 and CUISysOpt 52D800. Native art, transparent DOM hit targets.
 * 559E20 handles GameMenu indices3/4/5 only: Quest/Party/Community have no branch here.
 * DirectX/video/screenshot controls remain unsupported.
 * No fake packet or modern settings skin stands in for their missing implementations.
 */
export function systemMenu({
  ctx,
  image,
  audio,
  point,
  canOpen,
  onOpen,
  onQuit,
  onGameSettings = () => {},
}: SystemMenuOptions) {
  const root = document.createElement("section");
  root.id = "system-menu";
  root.className = "hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  requireElement("game-ui", "div").append(root);
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {}
  const profile = soundProfile(storage),
    game = gameProfile(storage);
  let currentGame = game.values(),
    gameDraft = { ...currentGame },
    gameOriginal = { ...currentGame };
  let soundDraft = profile.values(),
    soundOriginal = { ...soundDraft };
  const applyGame = (value: unknown) => {
    currentGame = gameSettings(value);
    onGameSettings({ ...currentGame });
  };
  applyGame(currentGame);
  audio.applySettings(profile.values());
  // Warm only original art; opening does not depend on an unrelated inventory icon load.
  for (const kind of ["GameMenu", "SysOpt", "GameOpt"]) image(`UI/UIWindow.img/${kind}/backgrnd`);
  for (const name of ["Quest", "Party", "Community"])
    image(`UI/UIWindow.img/GameMenu/Bt${name}/disabled/0`);
  for (const base of [
    "UI/UIWindow.img/GameMenu/BtGameOpt",
    "UI/UIWindow.img/UtilDlgEx/BtOK",
    "UI/UIWindow.img/UtilDlgEx/BtCancel",
    "UI/UIWindow.img/GameMenu/BtSysOpt",
    "UI/UIWindow.img/GameMenu/BtQuit",
    "UI/UIWindow.img/BtUIClose",
    "UI/Basic.img/BtOK",
    "UI/Basic.img/BtCancel",
  ])
    for (const state of ["normal", "pressed", "mouseOver"]) image(`${base}/${state}/0`);
  for (const name of [
    "left",
    "mid",
    "right",
    "thumbNormal",
    "thumbPressed",
    "thumbDisabled",
    "thumbMouseOver",
  ])
    image(`UI/Basic.img/Slider/${name}`);
  for (let i = 0; i < 4; i++) image(`UI/Basic.img/CheckBox/${i}`);
  image("UI/Basic.img/BtComboBox/disabled/0");

  let mode: Mode | undefined,
    at: UiPoint = { ...ORIGIN.menu };
  let previousFocus: ReturnType<typeof focusTarget>,
    hover: string | undefined,
    pressed: string | undefined;
  let sliding: (ControlBox & { kind: "sound-slider"; id: SoundSlider }) | undefined;
  let controls: Control[] = [];
  const stamp = (path: string, x: number, y: number) => {
    const a = image(path);
    if (a.ready) ctx.drawImage(a.img, x, y);
  };
  function control<T extends ControlSpec>(
    spec: T,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    click?: () => void,
    disabled = false,
  ): T & ControlBox {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "sprite-hit";
    el.setAttribute("aria-label", label);
    el.title = label;
    el.disabled = disabled;
    Object.assign(el.style, {
      left: `${at.x + x}px`,
      top: `${at.y + y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    root.append(el);
    const c = { ...spec, el, x, y, w, h, disabled };
    controls.push(c);
    el.addEventListener("mouseenter", () => {
      hover = spec.id;
      if (!disabled) void audio.effect("UI/BtMouseOver");
    });
    el.addEventListener("mouseleave", () => {
      if (hover === spec.id) hover = undefined;
    });
    el.addEventListener("focus", () => {
      hover = spec.id;
    });
    el.addEventListener("blur", () => {
      if (hover === spec.id) hover = undefined;
    });
    el.addEventListener("mousedown", (e) => {
      if (e.button === 0) pressed = spec.id;
    });
    if (click) el.addEventListener("click", click);
    return c;
  }
  function focusControl(id: string) {
    const c = controls.find((c) => c.id === id);
    if (!c) throw new Error(`Missing system menu control: ${id}`);
    c.el.focus();
  }
  function close(accept = false, restoreFocus = true) {
    if (!mode) return;
    if (mode === "sound") {
      // 52DE80 previews immediately; 52DF20 OK writes, Cancel restores the original fields.
      if (accept) profile.save(soundDraft);
      audio.applySettings(accept ? soundDraft : soundOriginal);
    }
    if (mode === "game") {
      if (accept) game.save(gameDraft);
      applyGame(accept ? gameDraft : gameOriginal);
    }
    blurWithin(root); // Must blur before detaching controls.
    mode = undefined;
    sliding = undefined;
    hover = pressed = undefined;
    controls = [];
    root.replaceChildren();
    root.classList.add("hidden");
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    previousFocus = undefined;
  }
  function mount(next: Mode) {
    root.replaceChildren();
    controls = [];
    hover = pressed = undefined;
    sliding = undefined;
    mode = next;
    at = { ...ORIGIN[next] };
    root.setAttribute(
      "aria-label",
      next === "menu"
        ? "게임 메뉴 / 遊戲選單"
        : next === "game"
          ? "게임 옵션 / 遊戲設定"
          : "시스템 옵션 / 系統設定",
    );
    root.classList.remove("hidden");
  }
  function updateSound() {
    soundDraft = soundSettings(soundDraft);
    audio.applySettings(soundDraft);
    for (const c of controls) {
      if (c.kind === "sound-slider" && !c.disabled) {
        c.el.setAttribute("aria-valuenow", String(soundDraft[c.id]));
        c.el.setAttribute("aria-valuetext", `${Math.round(nativeVolume(soundDraft[c.id]) * 100)}%`);
      }
      if (c.kind === "sound-check") c.el.setAttribute("aria-checked", String(soundDraft[c.id]));
    }
  }
  function slider(id: SoundSlider, label: string, y: number) {
    const c = control({ kind: "sound-slider", id }, label, 116, y, 122, 16);
    c.el.setAttribute("role", "slider");
    c.el.setAttribute("aria-valuemin", "0");
    c.el.setAttribute("aria-valuemax", "19");
    c.el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.el.focus();
      sliding = c;
      soundDraft[id] = sliderStep(point(e).x - at.x - c.x);
      updateSound();
    });
  }
  function openGame() {
    mount("game");
    gameOriginal = { ...currentGame };
    gameDraft = { ...gameOriginal };
    const ids = ["minimap", "whisper", "messenger", "exchange", "party", "game"] as const;
    const labels = [
      "顯示小地圖",
      "接受悄悄話",
      "接受Messenger邀請（尚未接瀏覽器介面）",
      "接受交易邀請",
      "接受組隊邀請",
      "小遊戲（原版亦停用）",
    ];
    ids.forEach((id, i) => {
      const c = control(
        { kind: "game-check", id },
        labels[i],
        134,
        50 + 26 * i,
        12,
        12,
        () => {
          gameDraft[id] = !gameDraft[id];
          applyGame(gameDraft);
          c.el.setAttribute("aria-checked", String(gameDraft[id]));
        },
        // CConfig consumers: goMiniMap/goWhisper/goExchange/goParty are all honoured by the page
        // (sub_4E7030, sub_472910 case 9, sub_481910, party s2c case 3). goMessenger gates the
        // 0x5A messenger window, which the browser has not implemented; goGame (+10) has zero
        // references even in the original client - both stay disabled, as the original is silent.
        i === 2 || i === 5,
      );
      c.el.setAttribute("role", "checkbox");
      c.el.setAttribute("aria-checked", String(gameDraft[id]));
    });
    control(
      { kind: "button", id: "ok", path: "UI/UIWindow.img/UtilDlgEx/BtOK" },
      "確定並保存",
      54,
      203,
      50,
      23,
      () => close(true),
    );
    control(
      { kind: "button", id: "cancel", path: "UI/UIWindow.img/UtilDlgEx/BtCancel" },
      "取消並還原",
      107,
      203,
      50,
      23,
      () => close(),
    );
    focusControl("minimap");
  }
  function openSound() {
    mount("sound");
    soundOriginal = audio.settings;
    soundDraft = { ...soundOriginal };
    control(
      { kind: "video", id: "video", fixed: 3 },
      "DirectX 畫質控制尚未移植",
      116,
      50,
      180,
      16,
      undefined,
      true,
    );
    slider("bgm", "背景音樂音量", 84);
    const bgm = control(
      { kind: "sound-check", id: "bgmMuted" },
      "背景音樂靜音",
      320,
      84,
      12,
      12,
      () => {
        soundDraft.bgmMuted = !soundDraft.bgmMuted;
        updateSound();
      },
    );
    bgm.el.setAttribute("role", "checkbox");
    slider("effects", "音效音量", 118);
    const se = control(
      { kind: "sound-check", id: "effectsMuted" },
      "音效靜音",
      320,
      118,
      12,
      12,
      () => {
        soundDraft.effectsMuted = !soundDraft.effectsMuted;
        updateSound();
      },
    );
    se.el.setAttribute("role", "checkbox");
    control(
      { kind: "button", id: "screenshot" },
      "原版截圖目的地（遊戲資料夾／桌面／C磁碟）尚未移植",
      84,
      152,
      205,
      18,
      undefined,
      true,
    );
    control(
      { kind: "button", id: "ok", path: "UI/Basic.img/BtOK" },
      "確定並保存",
      200,
      183,
      65,
      24,
      () => close(true),
    );
    control(
      { kind: "button", id: "cancel", path: "UI/Basic.img/BtCancel" },
      "取消並還原",
      270,
      183,
      65,
      24,
      () => close(),
    );
    updateSound();
    focusControl("bgm");
  }
  function open() {
    if (mode || !canOpen()) return false;
    previousFocus = focusTarget(document.activeElement);
    onOpen();
    mount("menu");
    control(
      { kind: "button", id: "close", path: "UI/UIWindow.img/BtUIClose" },
      "關閉選單",
      128,
      9,
      32,
      15,
      () => close(),
    );
    const names = ["Quest", "Party", "Community", "GameOpt", "SysOpt", "Quit"];
    const labels = [
      "任務（此原版選單入口無處理分支）",
      "派對（此原版選單入口無處理分支；使用 /파티정보）",
      "社群（此原版選單入口無處理分支）",
      "遊戲設定（小地圖／悄悄話）",
      "系統設定",
      "離開目前連線並回到登入畫面",
    ];
    names.forEach((name, i) =>
      control(
        { kind: "button", id: name, path: `UI/UIWindow.img/GameMenu/Bt${name}` },
        labels[i],
        20,
        63 + 27 * i,
        136,
        23,
        () => {
          if (i === 3) openGame();
          else if (i === 4) openSound();
          else if (i === 5) {
            close(false, false);
            onQuit();
          }
        },
        i < 3,
      ),
    );
    focusControl("SysOpt");
    void audio.effect("UI/DlgNotice");
    return true;
  }
  window.addEventListener("mousemove", (e) => {
    if (!sliding) return;
    soundDraft[sliding.id] = sliderStep(point(e).x - at.x - sliding.x);
    updateSound();
  });
  window.addEventListener("mouseup", () => {
    sliding = undefined;
    pressed = undefined;
  });
  releaseOnInterrupt(() => {
    sliding = undefined;
    pressed = hover = undefined;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!mode) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      const c = controls.find((c) => c.el === document.activeElement);
      if (e.key === "Tab") {
        const available = controls.filter((c) => !c.disabled),
          i = available.findIndex((control) => control === c);
        const next =
          i < 0
            ? e.shiftKey
              ? available.length - 1
              : 0
            : (i + (e.shiftKey ? available.length - 1 : 1)) % available.length;
        available[next]?.el.focus();
        return;
      }
      if (c?.kind === "sound-slider" && !c.disabled) {
        let value = soundDraft[c.id];
        if (["ArrowLeft", "PageUp"].includes(e.key)) value--;
        else if (["ArrowRight", "PageDown"].includes(e.key)) value++;
        else if (e.key === "Home") value = 0;
        else if (e.key === "End") value = 19;
        else if (e.key === "Enter" && !e.repeat) {
          close(true);
          return;
        } else return;
        soundDraft[c.id] = Math.max(0, Math.min(19, value));
        updateSound();
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) c?.el.click();
    },
    { capture: true },
  );
  for (const name of [
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "pointerdown",
    "pointerup",
  ] as const)
    window.addEventListener(
      name,
      (e) => {
        if (mode && !(e.target instanceof Node && root.contains(e.target))) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  root.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    { passive: false },
  );
  return {
    open,
    close,
    get gameSettings() {
      return { ...currentGame };
    },
    setMiniMap(shown: boolean) {
      game.save({ ...currentGame, minimap: shown });
      applyGame(game.values());
    },
    get visible() {
      return !!mode;
    },
    draw() {
      if (!mode) return;
      ctx.save();
      stamp(
        `UI/UIWindow.img/${mode === "menu" ? "GameMenu" : mode === "game" ? "GameOpt" : "SysOpt"}/backgrnd`,
        at.x,
        at.y,
      );
      for (const c of controls) {
        const x = at.x + c.x,
          y = at.y + c.y;
        const state = c.disabled
          ? "disabled"
          : pressed === c.id
            ? "pressed"
            : hover === c.id
              ? "mouseOver"
              : "normal";
        if (c.kind === "button" && c.path) stamp(`${c.path}/${state}/0`, x, y);
        else if (c.kind === "sound-slider" || c.kind === "video") {
          stamp("UI/Basic.img/Slider/left", x, y + 6);
          for (let dx = 3; dx < c.w - 3; dx++) stamp("UI/Basic.img/Slider/mid", x + dx, y + 7);
          stamp("UI/Basic.img/Slider/right", x + c.w - 3, y + 6);
          const thumb = c.disabled
            ? "Disabled"
            : sliding === c
              ? "Pressed"
              : hover === c.id
                ? "MouseOver"
                : "Normal";
          stamp(
            `UI/Basic.img/Slider/thumb${thumb}`,
            x +
              sliderCenter(
                c.kind === "video" ? c.fixed : soundDraft[c.id],
                c.w,
                c.disabled ? 4 : 20,
              ) -
              8,
            y,
          );
        } else if (c.kind === "game-check" || c.kind === "sound-check") {
          const checked = c.kind === "game-check" ? gameDraft[c.id] : soundDraft[c.id];
          // Native checkbox: 0 normal, 1 pressed, 2 checked, 3 checked pressed.
          stamp(`UI/Basic.img/CheckBox/${(checked ? 2 : 0) + (pressed === c.id ? 1 : 0)}`, x, y);
        } else if (c.id === "screenshot") {
          ctx.fillStyle = "#dddddd";
          ctx.fillRect(x, y, c.w, c.h);
          ctx.strokeStyle = "#555555";
          ctx.strokeRect(x, y, c.w, c.h);
          ctx.font = "12px 'Gulim','굴림','KMSCJK',sans-serif";
          ctx.textBaseline = "top";
          ctx.textAlign = "left";
          ctx.fillStyle = "#888888";
          ctx.fillText("메이플스토리 폴더", x + 3, y + 2);
          stamp("UI/Basic.img/BtComboBox/disabled/0", x + c.w - 16, y);
        }
      }
      ctx.restore();
    },
  };
}
