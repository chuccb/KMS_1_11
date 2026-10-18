import {activeSkill} from './active-skills.ts';
import {releaseOnInterrupt} from "./pointer.ts";
import {tooltipAnchor} from "./tooltip.ts";
/** CUISkill: 4EC910/4ECD40/4ED8E0/4EE5E0. Four 40px rows, not the later two-column skill UI. */
export const SKILL_WINDOW = {
  width: 176,
  height: 315,
  home: { x: 96, y: 96 },
  rows: 4,
  rowY: 119,
  rowHeight: 40,
};
export function skillRowAt(x, y, count, offset = 0) {
  if (x < 5 || x >= 159 || y < 119 || y >= 279) return -1;
  if ((y - 119) % 40 >= 38) return -1;
  const row = offset + Math.floor((y - 119) / 40);
  return row < count ? row : -1;
}
export function skillState(skill, learned) {
  if (skill.requirements.some((r) => (learned.get(r.skillId) ?? 0) < r.level))
    return 0;
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
  onUse = () => {}, onBindDrag = () => {},
}) {
  const root = document.getElementById("skill-window"),
    el = (id) => document.getElementById(id);
  let at = { ...SKILL_WINDOW.home },
    opened = false,
    books = [],
    selected = 0,
    offset = 0;
  let learned = new Map(),
    job,
    epoch = 0,
    pending = false,
    nextAt = 0,
    hover,
    pressed,
    drag,
    scrollDrag,
    tooltip;
  const catalogs = new Map();
  let signature = "",
    learnedRevision = 0;
  try {
    const p = JSON.parse(localStorage.getItem("kms111.skillAt") ?? "null");
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      at = {
        x: Math.max(0, Math.min(624, p.x)),
        y: Math.max(0, Math.min(285, p.y)),
      };
  } catch {}
  const position = (node, x, y, w, h) =>
    Object.assign(node.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
  const rows = () => books[selected]?.skills ?? [];
  const max = () => Math.max(0, rows().length - 4);
  const active = (i) => rows()[offset + i];
  const canUp = (skill) =>
    !!skill && getSelf()?.sp > 0 && skillState(skill, learned) === 1;
  const blocked = () =>
    pending || performance.now() < nextAt || !(getSelf()?.hp > 0) || isModal();
  function sync() {
    const self = getSelf();
    const key = [
      opened,
      isInGame(),
      at.x,
      at.y,
      self?.hp,
      self?.sp,
      selected,
      offset,
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
        const end =
          i === books.length - 1
            ? 173
            : 7 + Math.round((154 * (i + 1)) / books.length);
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
    if (el("skill-values").textContent !== description)
      el("skill-values").textContent = description;
  }
  async function load() {
    const current = getSelf()?.job;
    if (!Number.isInteger(current) || current === job) return;
    job = current;
    const token = ++epoch;
    books = [];
    selected = offset = 0;
    tooltip = undefined;
    try {
      let data = catalogs.get(current);
      if (!data) {
        const response = await fetch(`/api/skills/${current}`);
        if (!response.ok) throw new Error("無法讀取原始技能資料");
        data = await response.json();
        catalogs.set(current, data);
      }
      if (token !== epoch || getSelf()?.job !== current || !isInGame()) return;
      books = data.books;
      sync();
    } catch (error) {
      if (token === epoch) log(String(error));
    }
  }
  function toggle(value) {
    opened = value ?? !opened;
    tooltip = undefined;
    if (opened) {
      if (!catalogs.has(getSelf()?.job)) job = undefined;
      void load();
      audio.effect("UI/DlgNotice");
    }
    sync();
  }
  function scroll(n) {
    offset = Math.max(0, Math.min(max(), Math.trunc(n)));
    tooltip = undefined;
    sync();
  }
  const local = (e) => {
    const p = point(e);
    return { x: p.x - at.x, y: p.y - at.y };
  };
  position(el("skill-close"), 128, 9, 32, 15);
  for (let i = 0; i < 4; i++) {
    el(`skill-tab-${i}`).addEventListener("click", () => {
      if (isModal() || !books[i]) return;
      selected = i;
      offset = 0;
      tooltip = undefined;
      sync();
    });
    const node = el(`sp-up-${i}`);
    position(node, 139, 137 + 40 * i, 17, 16);
    node.addEventListener("click", () => {
      const skill = active(i);
      if (!opened || !isInGame() || !canUp(skill) || blocked()) return;
      pending = true;
      nextAt = performance.now() + 500;
      sync();
      send({ t: "skill-up", skillId: skill.id });
    });
  }
  for (const id of [
    "skill-close",
    "sp-up-0",
    "sp-up-1",
    "sp-up-2",
    "sp-up-3",
  ]) {
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
      offset = 0;
      sync();
    } else if(p.x>=11 && p.x<46 && p.y>=119 && p.y<279) {
      const index=skillRowAt(p.x,p.y,rows().length,offset),skill=rows()[index];
      if(skill && (learned.get(skill.id)??0)>0 && activeSkill(skill.id))onBindDrag(skill,point(e));
    } else if (p.x >= 161 && p.x < 173 && p.y >= 116 && p.y < 278 && max()) {
      const y = p.y - 116,
        thumb = 12 + (126 * offset) / max();
      if (y < 12) scroll(offset - 1);
      else if (y >= 150) scroll(offset + 1);
      else if (y >= thumb && y < thumb + 12) scrollDrag = y - thumb;
      else scroll(offset + (y < thumb ? -4 : 4));
      e.preventDefault();
    }
  });
  root.addEventListener('dblclick',e=>{
    if(e.button!==0||isModal()||e.target?.closest?.('button'))return;
    const p=local(e),index=skillRowAt(p.x,p.y,rows().length,offset),skill=rows()[index];
    if(!skill || !(learned.get(skill.id)>0))return;
    if(!activeSkill(skill.id)){log('此技能的完整效果尚未接通，未消耗 HP／MP。');return;}
    onUse(skill.id);e.preventDefault();
  });
  root.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isModal() && e.deltaY) scroll(offset + Math.sign(e.deltaY));
    },
    { passive: false },
  );
  root.addEventListener("mousemove", (e) => {
    const p = local(e),
      i = skillRowAt(p.x, p.y, rows().length, offset);
    tooltip =
      !isModal() && i >= 0 && !drag && scrollDrag === undefined
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
    if (scrollDrag !== undefined)
      scroll(((local(e).y - 116 - 12 - scrollDrag) * max()) / 126);
  });
  const release = () => {
    if (drag)
      try {
        localStorage.setItem("kms111.skillAt", JSON.stringify(at));
      } catch {}
    drag = undefined;
    scrollDrag = undefined;
    pressed = undefined;
  };
  window.addEventListener("mouseup", release);
  releaseOnInterrupt(() => { release(); tooltip = undefined; });
  root.addEventListener("keydown", (e) => {
    if (isModal()) return;
    if (
      ["ArrowLeft", "ArrowRight"].includes(e.key) &&
      e.target?.getAttribute?.("role") === "tab" &&
      books.length
    ) {
      e.preventDefault();
      e.stopPropagation();
      selected =
        (selected + (e.key === "ArrowRight" ? 1 : books.length - 1)) %
        books.length;
      offset = 0;
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
        offset + { ArrowUp: -1, ArrowDown: 1, PageUp: -4, PageDown: 4 }[e.key],
      );
    } else if (e.key === "Enter" || e.key === " ") e.stopPropagation();
  });
  const stamp = (path, x, y) => {
    const a = image(path);
    if (a.ready)
      ctx.drawImage(a.img, Math.round(at.x + x), Math.round(at.y + y));
  };
  const tabs = () => {
    if (!books.length) return;
    const piece = (p, x) => stamp(`UI/Basic.img/Tab/${p}`, x, 52);
    piece(`left${selected === 0 ? 1 : 0}`, 3);
    let start = 7;
    for (let i = 0; i < books.length; i++) {
      const end = 7 + Math.round((154 * (i + 1)) / books.length),
        lit = i === selected;
      if (i < books.length - 1)
        piece(`middle${lit ? 1 : i + 1 === selected ? 2 : 0}`, end - 14);
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
    if (isModal()) {tooltip = undefined; return;}
    if (!tooltip) return;
    // Level is resolved every frame, so an SP reply updates a stationary hover too.
    const s = tooltip.skill, level = learned.get(s.id) ?? 0;
    const at = tooltipAnchor('skill', tooltip.x, tooltip.y);
    tooltipRenderer.skill(at.x, at.y, s, level);
  }
  sync();
  return {
    level(id) {return learned.get(id)??0;},
    get open() {
      return opened;
    },
    toggle,
    contains(x, y) {
      return (
        opened &&
        isInGame() &&
        x >= at.x &&
        x < at.x + 176 &&
        y >= at.y &&
        y < at.y + 315
      );
    },
    receive(message) {
      if (message.t === "skills") {
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
          ctx.fillText(
            String(learned.get(s.id) ?? 0),
            at.x + 43,
            at.y + y + 20,
          );
          const icon =
            state === 0
              ? "iconDisabled"
              : tooltip?.skill.id === s.id
                ? "iconMouseOver"
                : "icon";
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
        const enabled = max() > 0,
          prefix = `UI/Basic.img/VScr/${enabled ? "enabled" : "disabled"}`;
        for (let y = 128; y < 266; y += 12) stamp(`${prefix}/base`, 161, y);
        stamp(`${prefix}/${enabled ? "prev0" : "prev"}`, 161, 116);
        stamp(`${prefix}/${enabled ? "next0" : "next"}`, 161, 266);
        if (enabled)
          stamp(
            `${prefix}/${scrollDrag === undefined ? "thumb0" : "thumb1"}`,
            161,
            128 + Math.round((126 * offset) / max()),
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
