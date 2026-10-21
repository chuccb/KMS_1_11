import type { ImageLookup } from "./render-types.ts";
import type { SkillBook, SkillInfo } from "../server/src/game/skills.ts";
import type { SkillChange } from "../server/src/protocol/skills.ts";
import type { SelfView } from "../server/src/client/session.ts";
import type { NativeTooltipRenderer } from "./tooltip.ts";
import type { UiPoint, UiAudio } from "./ui-types.ts";
import { requireElement } from "./dom.ts";
import { isRecord, isFiniteNumber } from "./resource-validation.ts";
import { isSkillCatalogue, type SkillCatalogue } from "./combat-resource-validation.ts";
interface SkillWindowOptions {
  ctx: CanvasRenderingContext2D;
  tooltipRenderer: NativeTooltipRenderer;
  image: ImageLookup;
  audio: UiAudio;
  send(message: { t: "skill-up"; skillId: number }): unknown;
  point(event: MouseEvent): UiPoint;
  getSelf(): Pick<SelfView, "hp" | "job" | "sp"> | undefined;
  isInGame(): boolean;
  log(message: string): void;
  isModal(): boolean;
  onUse?(id: number): void;
  onBindDrag?(skill: SkillInfo, point: UiPoint): void;
}
import { activeSkill } from "./active-skills.ts";
import { releaseOnInterrupt } from "./pointer.ts";
import { vScrollPage, vScrollScroller, VSCR_CELL } from "./vscroll.ts";
import { tooltipAnchor } from "./tooltip.ts";
import { TAB_LEFT, TAB_MIDDLE, TAB_RIGHT } from "./tabstrip.ts";
/**
 * CUISkill: 4EC910/4ECD40/4ED8E0/4EE5E0. Four 40px rows, not the later two-column skill UI.
 *
 * 176x315 is `UI/UIWindow.img/Skill/backgrnd` - a 176x315 canvas in Data.wz, the same plate the
 * stat and equip windows use.
 */
export const SKILL_WINDOW = {
  backgrnd: "UI/UIWindow.img/Skill/backgrnd",
  width: 176,
  height: 315,
  home: { x: 96, y: 96 },
};

/**
 * `sub_4ECD40` (`MapleStory.exe.c:243551`) is where CUISkill builds its controls, and the whole
 * sheet falls out of three of them:
 *
 *  - `CCtrlTab id2000 at (3, 52), 170 wide` (`:243618`) - the strip runs 3..173, and the part the
 *    CAPS leave for the tabs themselves is 170 - 4 - 12 = 154 wide, from x = 3 + 4 = 7.
 *  - `CCtrlScrollBar id2001 at (161, 116) height 162` (`:243639`), whose `+44` wrap is 156
 *    (`:243646`) - the same `UI/Basic.img/VScr` cells the trade log and the messenger use.
 *  - `CCtrlButton id(2010 + i) at (139, 137 + 40 * i)`, `n137 += 40`, `while (n137 < 297)`
 *    (`:243695`..`:243704`) - four SP-up buttons on a 40 px pitch, which is also the row pitch.
 *
 * The rest of the numbers below are ours: the row band's `x`/`width` and its `SKILL_ROW_LIVE`
 * height are the click target we drew around the art, not anything the PE states.
 */
export const SKILL_TABS = { x: 3, y: 52, width: 170, height: 24 };
export const SKILL_TAB_INNER = {
  x: SKILL_TABS.x + TAB_LEFT,
  width: SKILL_TABS.width - TAB_LEFT - TAB_RIGHT,
};
export const SKILL_SCROLLBAR = { x: 161, y: 116, width: VSCR_CELL, height: 162, arrow: VSCR_CELL };
/** Where the bar's `next` arrow goes: its own bottom edge less one cell. */
export const SKILL_SCROLLBAR_NEXT_Y = SKILL_SCROLLBAR.y + SKILL_SCROLLBAR.height - VSCR_CELL;
export const SKILL_ROWS = 4;
export const SKILL_ROW_TOP = 119;
export const SKILL_ROW_PITCH = 40;
export const SKILL_ROW = { x: 5, width: 154 };
export const SKILL_ROW_LIVE = 38;
export const SKILL_UP_BUTTON = {
  x: 139,
  firstY: 137,
  pitch: SKILL_ROW_PITCH,
  lastY: 297,
  width: 17,
  height: 16,
};
export function skillRowAt(x: number, y: number, count: number, offset = 0) {
  if (
    x < SKILL_ROW.x ||
    x >= SKILL_ROW.x + SKILL_ROW.width ||
    y < SKILL_ROW_TOP ||
    y >= SKILL_ROW_TOP + SKILL_ROWS * SKILL_ROW_PITCH
  )
    return -1;
  if ((y - SKILL_ROW_TOP) % SKILL_ROW_PITCH >= SKILL_ROW_LIVE) return -1;
  const row = offset + Math.floor((y - SKILL_ROW_TOP) / SKILL_ROW_PITCH);
  return row < count ? row : -1;
}
export function skillState(
  skill: Pick<SkillInfo, "id" | "maxLevel" | "requirements">,
  learned: ReadonlyMap<number, number>,
) {
  if (skill.requirements.some((r) => (learned.get(r.skillId) ?? 0) < r.level)) return 0;
  return (learned.get(skill.id) ?? 0) >= skill.maxLevel ? -1 : 1;
}
export function skillWindow({
  ctx,
  tooltipRenderer,
  image,
  send,
  audio,
  point,
  getSelf,
  isInGame,
  log,
  isModal,
  onUse = () => {},
  onBindDrag = () => {},
}: SkillWindowOptions) {
  const root = requireElement("skill-window", "section"),
    el = (id: string) => requireElement(id, "button");
  let at = { ...SKILL_WINDOW.home },
    opened = false,
    books: SkillBook[] = [],
    selected = 0;
  let learned = new Map<number, number>(),
    job: number | undefined,
    epoch = 0,
    pending = false,
    nextAt = 0,
    hover: string | undefined,
    pressed: string | undefined,
    drag: UiPoint | undefined,
    pointer: UiPoint | undefined,
    tooltip: { skill: SkillInfo; x: number; y: number } | undefined;
  // The skill list's CCtrlScrollBar, created exactly like the trade and messenger ones:
  // sub_4ECD40's `vtable[8](bar, this, 2001, 1, 0, 161, 116, 162, 0)` (+44 = 156), and
  // sub_4EE420 keeps `SetMax(bar, listCount - 3)` - four visible rows, so rowCapacity 4.
  // sub_4ED8E0 draws from `*(bar + 48)` (pos) straight into the 8-byte skill records.
  const scrollBar = vScrollScroller(SKILL_SCROLLBAR, SKILL_ROWS);
  /** The old hand-rolled 0..rows-4 offset is exactly the native scrollbar pos. */
  const offset = () => scrollBar.pos;
  const catalogs = new Map<number, SkillCatalogue>();
  let signature = "",
    learnedRevision = 0;
  try {
    const p: unknown = JSON.parse(localStorage.getItem("kms111.skillAt") ?? "null");
    if (isRecord(p) && isFiniteNumber(p.x) && isFiniteNumber(p.y))
      at = {
        x: Math.max(0, Math.min(624, p.x)),
        y: Math.max(0, Math.min(285, p.y)),
      };
  } catch {}
  const position = (node: HTMLElement, x: number, y: number, w: number, h: number) =>
    Object.assign(node.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
  const rows = () => books[selected]?.skills ?? [];
  const active = (i: number) => rows()[offset() + i];
  const canUp = (skill: SkillInfo | undefined) =>
    !!skill && (getSelf()?.sp ?? 0) > 0 && skillState(skill, learned) === 1;
  const blocked = () =>
    pending || performance.now() < nextAt || !((getSelf()?.hp ?? 0) > 0) || isModal();
  function sync() {
    scrollBar.sync(rows().length);
    const self = getSelf();
    const key = [
      opened,
      isInGame(),
      at.x,
      at.y,
      self?.hp,
      self?.sp,
      selected,
      offset(),
      books.map((b) => b.id).join(","),
      learnedRevision,
    ].join("|");
    if (signature === key) return;
    signature = key;
    root.classList.toggle("hidden", !opened || !isInGame());
    position(root, at.x, at.y, SKILL_WINDOW.width, SKILL_WINDOW.height);
    for (let i = 0; i < SKILL_ROWS; i++) {
      const skill = active(i),
        button = el(`sp-up-${i}`);
      const tab = el(`skill-tab-${i}`),
        book = books[i];
      tab.hidden = !book;
      tab.tabIndex = i === selected ? 0 : -1;
      tab.setAttribute("aria-selected", String(i === selected));
      tab.setAttribute("aria-label", book?.name ?? "無技能書");
      if (book) {
        const x =
          i === 0
            ? SKILL_TABS.x
            : SKILL_TAB_INNER.x + Math.round((SKILL_TAB_INNER.width * i) / books.length);
        const end =
          i === books.length - 1
            ? SKILL_TABS.x + SKILL_TABS.width
            : SKILL_TAB_INNER.x + Math.round((SKILL_TAB_INNER.width * (i + 1)) / books.length);
        position(tab, x, SKILL_TABS.y, end - x, SKILL_TABS.height);
      }
      button.hidden = !skill;
      button.disabled = !canUp(skill);
      button.setAttribute(
        "aria-label",
        skill
          ? `提升 ${skill.name}，目前 ${learned.get(skill.id) ?? 0}，最高 ${skill.maxLevel}`
          : "無技能",
      );
    }
    const description = `SP ${getSelf()?.sp ?? 0} ${books[selected]?.name ?? ""} ${rows()
      .map((s) => `${s.name} ${learned.get(s.id) ?? 0}/${s.maxLevel}`)
      .join("；")}`;
    const values = requireElement("skill-values", "p");
    if (values.textContent !== description) values.textContent = description;
  }
  async function load() {
    const current = getSelf()?.job;
    if (current === undefined || !Number.isInteger(current) || current === job) return;
    job = current;
    const token = ++epoch;
    books = [];
    selected = 0;
    scrollBar.reset();
    tooltip = undefined;
    try {
      let data = catalogs.get(current);
      if (!data) {
        const response = await fetch(`/api/skills/${current}`);
        if (!response.ok) throw new Error("無法讀取原始技能資料");
        const payload: unknown = await response.json();
        if (!isSkillCatalogue(payload) || payload.job !== current)
          throw new Error("Invalid skill catalogue");
        data = payload;
        catalogs.set(current, data);
      }
      if (token !== epoch || getSelf()?.job !== current || !isInGame()) return;
      books = data.books;
      sync();
    } catch (error) {
      if (token === epoch) log(String(error));
    }
  }
  function toggle(value?: boolean) {
    opened = value ?? !opened;
    tooltip = undefined;
    if (opened) {
      const current = getSelf()?.job;
      if (current === undefined || !catalogs.has(current)) job = undefined;
      void load();
      audio.effect("UI/DlgNotice");
    }
    sync();
  }
  /** Absolute offset; the shared scroller clamps into [0, max-1] like sub_452150. */
  function scroll(n: number) {
    scrollBar.by(Math.trunc(n) - scrollBar.pos);
    tooltip = undefined;
    sync();
  }
  const local = (e: MouseEvent) => {
    const p = point(e);
    return { x: p.x - at.x, y: p.y - at.y };
  };
  position(el("skill-close"), 128, 9, 32, 15);
  for (let i = 0; i < SKILL_ROWS; i++) {
    el(`skill-tab-${i}`).addEventListener("click", () => {
      if (isModal() || !books[i]) return;
      selected = i;
      scroll(0);
      tooltip = undefined;
      sync();
    });
    const node = el(`sp-up-${i}`);
    position(
      node,
      SKILL_UP_BUTTON.x,
      SKILL_UP_BUTTON.firstY + SKILL_UP_BUTTON.pitch * i,
      SKILL_UP_BUTTON.width,
      SKILL_UP_BUTTON.height,
    );
    node.addEventListener("click", () => {
      const skill = active(i);
      if (!opened || !isInGame() || !skill || !canUp(skill) || blocked()) return;
      pending = true;
      nextAt = performance.now() + 500;
      sync();
      send({ t: "skill-up", skillId: skill.id });
    });
  }
  for (const id of ["skill-close", "sp-up-0", "sp-up-1", "sp-up-2", "sp-up-3"]) {
    const node = el(id);
    node.addEventListener("pointerenter", () => {
      hover = id;
      if (!node.disabled) audio.effect("UI/BtMouseOver");
    });
    node.addEventListener("pointerleave", () => {
      hover = pressed = undefined;
    });
    node.addEventListener("pointerdown", () => {
      pressed = id;
    });
    node.addEventListener("pointerup", () => {
      pressed = undefined;
    });
  }
  el("skill-close").addEventListener("click", () => {
    if (!isModal()) toggle(false);
  });
  root.addEventListener("mousedown", (e) => {
    if (isModal() || e.button !== 0) return;
    const p = local(e);
    tooltip = undefined;
    if (p.y < 35 && e.target === root) {
      drag = { x: p.x, y: p.y };
      e.preventDefault();
    } else if (
      p.y >= SKILL_TABS.y &&
      p.y < SKILL_TABS.y + SKILL_TABS.height &&
      p.x >= SKILL_TABS.x &&
      p.x < SKILL_TABS.x + SKILL_TABS.width &&
      books.length
    ) {
      selected = Math.min(
        books.length - 1,
        Math.max(0, Math.floor(((p.x - SKILL_TAB_INNER.x) * books.length) / SKILL_TAB_INNER.width)),
      );
      scroll(0);
      sync();
    } else if (
      p.x >= 11 &&
      p.x < 46 &&
      p.y >= SKILL_ROW_TOP &&
      p.y < SKILL_ROW_TOP + SKILL_ROWS * SKILL_ROW_PITCH
    ) {
      const index = skillRowAt(p.x, p.y, rows().length, offset()),
        skill = rows()[index];
      if (skill && (learned.get(skill.id) ?? 0) > 0 && activeSkill(skill.id))
        onBindDrag(skill, point(e));
    } else if (
      p.x >= SKILL_SCROLLBAR.x &&
      p.x < SKILL_SCROLLBAR.x + VSCR_CELL &&
      p.y >= SKILL_SCROLLBAR.y &&
      p.y < SKILL_SCROLLBAR.y + SKILL_SCROLLBAR.height
    ) {
      // sub_452500/sub_4521E0 through the shared scroller: arrows step, the track pages by
      // sub_452600's max(floor(max/16),16), the thumb starts the drag, and holding repeats
      // every 50 ms (sub_4523D0) - the old hand-rolled ±4 page was not the native amount.
      const zone = scrollBar.hit(p.x, p.y);
      if (zone) {
        scrollBar.activate(zone, p.y, performance.now());
        pointer = p;
        tooltip = undefined;
        sync();
        e.preventDefault();
      }
    }
  });
  root.addEventListener("dblclick", (e) => {
    if (e.button !== 0 || isModal() || (e.target instanceof Element && e.target.closest("button")))
      return;
    const p = local(e),
      index = skillRowAt(p.x, p.y, rows().length, offset()),
      skill = rows()[index];
    if (!skill || !((learned.get(skill.id) ?? 0) > 0)) return;
    if (!activeSkill(skill.id)) {
      log("此技能的完整效果尚未接通，未消耗 HP／MP。");
      return;
    }
    onUse(skill.id);
    e.preventDefault();
  });
  root.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isModal() && e.deltaY) scroll(offset() + Math.sign(e.deltaY));
    },
    { passive: false },
  );
  root.addEventListener("mousemove", (e) => {
    const p = local(e),
      i = skillRowAt(p.x, p.y, rows().length, offset());
    tooltip =
      !isModal() && i >= 0 && !drag && !scrollBar.dragging
        ? { skill: rows()[i], x: p.x + at.x, y: p.y + at.y }
        : undefined;
  });
  root.addEventListener("mouseleave", () => {
    tooltip = undefined;
  });
  window.addEventListener("mousemove", (e) => {
    if (drag) {
      const p = point(e);
      at = {
        x: Math.max(0, Math.min(624, Math.round(p.x - drag.x))),
        y: Math.max(0, Math.min(285, Math.round(p.y - drag.y))),
      };
      sync();
    }
    pointer = local(e);
    // sub_4526A0: pos = startPos + max * dy / (len - 3*arrow), truncated then clamped.
    if (scrollBar.dragging) {
      scrollBar.moveTo(pointer.y);
      sync();
    }
  });
  const release = () => {
    if (drag)
      try {
        localStorage.setItem("kms111.skillAt", JSON.stringify(at));
      } catch {}
    drag = undefined;
    scrollBar.end(); // sub_4522B0: the release-page branch is dead code in the original.
    pressed = undefined;
  };
  window.addEventListener("mouseup", release);
  releaseOnInterrupt(() => {
    release();
    tooltip = undefined;
  });
  root.addEventListener("keydown", (e) => {
    if (isModal()) return;
    if (
      ["ArrowLeft", "ArrowRight"].includes(e.key) &&
      e.target instanceof Element &&
      e.target.getAttribute("role") === "tab" &&
      books.length
    ) {
      e.preventDefault();
      e.stopPropagation();
      selected = (selected + (e.key === "ArrowRight" ? 1 : books.length - 1)) % books.length;
      scroll(0);
      tooltip = undefined;
      sync();
      el(`skill-tab-${selected}`).focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      toggle(false);
    } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      scroll(
        offset() +
          ({
            ArrowUp: -1,
            ArrowDown: 1,
            PageUp: -vScrollPage(scrollBar.max),
            PageDown: vScrollPage(scrollBar.max),
          }[e.key as "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown"] ?? 0),
      );
    } else if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });
  const stamp = (path: string, x: number, y: number) => {
    const a = image(path);
    if (a.ready) ctx.drawImage(a.img, Math.round(at.x + x), Math.round(at.y + y));
  };
  const tabs = () => {
    if (!books.length) return;
    const piece = (p: string, x: number) => stamp(`UI/Basic.img/Tab/${p}`, x, SKILL_TABS.y);
    piece(`left${selected === 0 ? 1 : 0}`, SKILL_TABS.x);
    let start = SKILL_TAB_INNER.x;
    for (let i = 0; i < books.length; i++) {
      const end = SKILL_TAB_INNER.x + Math.round((SKILL_TAB_INNER.width * (i + 1)) / books.length),
        lit = i === selected;
      if (i < books.length - 1)
        piece(`middle${lit ? 1 : i + 1 === selected ? 2 : 0}`, end - TAB_MIDDLE);
      for (let x = start; x < end - (i < books.length - 1 ? TAB_MIDDLE : 0); x++)
        piece(`fill${lit ? 1 : 0}`, x);
      ctx.textAlign = "center";
      ctx.fillStyle = "#000";
      ctx.fillText(
        [" I ", " II ", " III ", " IV "][i],
        at.x + (start + end) / 2,
        at.y + 59 + (lit ? 0 : 1),
      );
      start = end;
    }
    piece(
      `right${selected === books.length - 1 ? 1 : 0}`,
      SKILL_TAB_INNER.x + SKILL_TAB_INNER.width,
    );
    ctx.textAlign = "left";
  };
  function drawTooltip() {
    if (isModal()) {
      tooltip = undefined;
      return;
    }
    if (!tooltip) return;
    // Level is resolved every frame, so an SP reply updates a stationary hover too.
    const s = tooltip.skill,
      level = learned.get(s.id) ?? 0;
    const at = tooltipAnchor("skill", tooltip.x, tooltip.y);
    tooltipRenderer.skill(at.x, at.y, s, level);
  }
  sync();
  return {
    level(id: number) {
      return learned.get(id) ?? 0;
    },
    get open() {
      return opened;
    },
    toggle,
    contains(x: number, y: number) {
      return (
        opened &&
        isInGame() &&
        x >= at.x &&
        x < at.x + SKILL_WINDOW.width &&
        y >= at.y &&
        y < at.y + SKILL_WINDOW.height
      );
    },
    receive(message: {
      t: string;
      skills?: readonly SkillChange[];
      changes?: readonly SkillChange[];
      ack?: boolean;
      skillId?: number;
      changed?: boolean;
    }) {
      if (message.t === "skills" && message.skills) {
        learnedRevision++;
        learned = new Map(message.skills.map((s) => [s.skillId, s.level]));
        sync();
        return true;
      }
      if (message.t === "skill-result") {
        pending = false;
        nextAt = performance.now() + 500;
        sync();
        if (!message.changed) log("技能點請求已回覆，未變更技能。");
        return true;
      }
      if (["field", "disconnect", "login"].includes(message.t)) {
        ++epoch;
        job = undefined;
        books = [];
        learnedRevision++;
        learned.clear();
        pending = false;
        nextAt = 0;
        tooltip = undefined;
        release();
        if (message.t !== "field") toggle(false);
      }
      if (message.t === "error" && pending) {
        pending = false;
        sync();
      }
      return false;
    },
    draw() {
      if (!opened || !isInGame()) return;
      void load();
      sync();
      // sub_4523D0: while the capture is down, every tick re-hits the live cursor zone and
      // repeats the pressed arrow/page through the 50 ms gate (the thumb never repeats).
      if (scrollBar.pressed && scrollBar.pressed !== "thumb" && pointer)
        scrollBar.tick(performance.now(), pointer.x, pointer.y);
      stamp(SKILL_WINDOW.backgrnd, 0, 0);
      ctx.save();
      ctx.font = "11px 'Dotum','돋움','KMSCJK',sans-serif";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#000";
      ctx.textAlign = "left";
      ctx.fillText(String(getSelf()?.sp ?? 0), at.x + 68, at.y + 282);
      tabs();
      const book = books[selected];
      if (book) {
        stamp("Item/Book/0500.img/05000000/info/icon", 23, 82);
        ctx.fillStyle = "#000";
        ctx.fillText(book.name, at.x + 59, at.y + 91);
        for (let i = 0; i < SKILL_ROWS; i++) {
          const s = active(i);
          if (!s) continue;
          const state = skillState(s, learned),
            y = SKILL_ROW_TOP + SKILL_ROW_PITCH * i;
          stamp(`UI/UIWindow.img/Skill/skill${state === 0 ? 0 : 1}`, SKILL_ROW.x, y);
          ctx.save();
          ctx.beginPath();
          ctx.rect(at.x + 43, at.y + y, 93, 18);
          ctx.clip();
          ctx.fillText(s.name, at.x + 43, at.y + y + 4);
          ctx.restore();
          ctx.fillText(String(learned.get(s.id) ?? 0), at.x + 43, at.y + y + 20);
          const icon =
            state === 0 ? "iconDisabled" : tooltip?.skill.id === s.id ? "iconMouseOver" : "icon";
          stamp(`${s.path}/${icon}`, 8, y + 3);
          const id = `sp-up-${i}`,
            face = !canUp(s)
              ? "disabled"
              : pressed === id
                ? "pressed"
                : hover === id
                  ? "mouseOver"
                  : "normal";
          stamp(
            `UI/UIWindow.img/Skill/BtSpUp/${face}/0`,
            SKILL_UP_BUTTON.x,
            SKILL_UP_BUTTON.firstY + SKILL_UP_BUTTON.pitch * i,
          );
        }
        const enabled = scrollBar.max > 1,
          prefix = `UI/Basic.img/VScr/${enabled ? "enabled" : "disabled"}`;
        for (let y = SKILL_SCROLLBAR.y + VSCR_CELL; y < SKILL_SCROLLBAR_NEXT_Y; y += VSCR_CELL)
          stamp(`${prefix}/base`, SKILL_SCROLLBAR.x, y);
        // The pressed arrow cells light up while held, exactly like paintVScrollbar.
        stamp(
          `${prefix}/${
            enabled && scrollBar.pressed === "prev" ? "prev1" : enabled ? "prev0" : "prev"
          }`,
          SKILL_SCROLLBAR.x,
          SKILL_SCROLLBAR.y,
        );
        stamp(
          `${prefix}/${
            enabled && scrollBar.pressed === "next" ? "next1" : enabled ? "next0" : "next"
          }`,
          SKILL_SCROLLBAR.x,
          SKILL_SCROLLBAR_NEXT_Y,
        );
        // sub_452500's thumbTop: arrow + floor(pos * (len - 3*arrow) / (max - 1)).
        if (enabled)
          stamp(
            `${prefix}/${scrollBar.dragging ? "thumb1" : "thumb0"}`,
            SKILL_SCROLLBAR.x,
            SKILL_SCROLLBAR.y + scrollBar.thumbTop(),
          );
      }
      stamp(
        `UI/UIWindow.img/BtUIClose/${pressed === "skill-close" ? "pressed" : hover === "skill-close" ? "mouseOver" : "normal"}/0`,
        128,
        9,
      );
      drawTooltip();
      ctx.restore();
    },
  };
}
