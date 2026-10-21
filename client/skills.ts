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
/** CUISkill: 4EC910/4ECD40/4ED8E0/4EE5E0. Four 40px rows, not the later two-column skill UI. */
export const SKILL_WINDOW = {
  width: 176,
  height: 315,
  home: { x: 96, y: 96 },
  rows: 4,
  rowY: 119,
  rowHeight: 40,
};
export function skillRowAt(x: number, y: number, count: number, offset = 0) {
  if (x < 5 || x >= 159 || y < 119 || y >= 279) return -1;
  if ((y - 119) % 40 >= 38) return -1;
  const row = offset + Math.floor((y - 119) / 40);
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
  const scrollBar = vScrollScroller(
    { x: 161, y: 116, width: VSCR_CELL, height: 162, arrow: VSCR_CELL },
    4,
  );
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
    position(root, at.x, at.y, 176, 315);
    for (let i = 0; i < 4; i++) {
      const skill = active(i),
        button = el(`sp-up-${i}`);
      const tab = el(`skill-tab-${i}`),
        book = books[i];
      tab.hidden = !book;
      tab.tabIndex = i === selected ? 0 : -1;
      tab.setAttribute("aria-selected", String(i === selected));
      tab.setAttribute("aria-label", book?.name ?? "無技能書");
      if (book) {
        const x = i === 0 ? 3 : 7 + Math.round((154 * i) / books.length);
        const end = i === books.length - 1 ? 173 : 7 + Math.round((154 * (i + 1)) / books.length);
        position(tab, x, 52, end - x, 24);
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
  for (let i = 0; i < 4; i++) {
    el(`skill-tab-${i}`).addEventListener("click", () => {
      if (isModal() || !books[i]) return;
      selected = i;
      scroll(0);
      tooltip = undefined;
      sync();
    });
    const node = el(`sp-up-${i}`);
    position(node, 139, 137 + 40 * i, 17, 16);
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
    } else if (p.y >= 52 && p.y < 76 && p.x >= 3 && p.x < 173 && books.length) {
      selected = Math.min(
        books.length - 1,
        Math.max(0, Math.floor(((p.x - 7) * books.length) / 154)),
      );
      scroll(0);
      sync();
    } else if (p.x >= 11 && p.x < 46 && p.y >= 119 && p.y < 279) {
      const index = skillRowAt(p.x, p.y, rows().length, offset()),
        skill = rows()[index];
      if (skill && (learned.get(skill.id) ?? 0) > 0 && activeSkill(skill.id))
        onBindDrag(skill, point(e));
    } else if (p.x >= 161 && p.x < 173 && p.y >= 116 && p.y < 278) {
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
    const piece = (p: string, x: number) => stamp(`UI/Basic.img/Tab/${p}`, x, 52);
    piece(`left${selected === 0 ? 1 : 0}`, 3);
    let start = 7;
    for (let i = 0; i < books.length; i++) {
      const end = 7 + Math.round((154 * (i + 1)) / books.length),
        lit = i === selected;
      if (i < books.length - 1) piece(`middle${lit ? 1 : i + 1 === selected ? 2 : 0}`, end - 14);
      for (let x = start; x < end - (i < books.length - 1 ? 14 : 0); x++)
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
    piece(`right${selected === books.length - 1 ? 1 : 0}`, 161);
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
      return opened && isInGame() && x >= at.x && x < at.x + 176 && y >= at.y && y < at.y + 315;
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
      stamp("UI/UIWindow.img/Skill/backgrnd", 0, 0);
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
        for (let i = 0; i < 4; i++) {
          const s = active(i);
          if (!s) continue;
          const state = skillState(s, learned),
            y = 119 + 40 * i;
          stamp(`UI/UIWindow.img/Skill/skill${state === 0 ? 0 : 1}`, 5, y);
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
          stamp(`UI/UIWindow.img/Skill/BtSpUp/${face}/0`, 139, 137 + 40 * i);
        }
        const enabled = scrollBar.max > 1,
          prefix = `UI/Basic.img/VScr/${enabled ? "enabled" : "disabled"}`;
        for (let y = 128; y < 266; y += 12) stamp(`${prefix}/base`, 161, y);
        // The pressed arrow cells light up while held, exactly like paintVScrollbar.
        stamp(
          `${prefix}/${
            enabled && scrollBar.pressed === "prev" ? "prev1" : enabled ? "prev0" : "prev"
          }`,
          161,
          116,
        );
        stamp(
          `${prefix}/${
            enabled && scrollBar.pressed === "next" ? "next1" : enabled ? "next0" : "next"
          }`,
          161,
          266,
        );
        // sub_452500's thumbTop: arrow + floor(pos * (len - 3*arrow) / (max - 1)).
        if (enabled)
          stamp(
            `${prefix}/${scrollBar.dragging ? "thumb1" : "thumb0"}`,
            161,
            116 + scrollBar.thumbTop(),
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
