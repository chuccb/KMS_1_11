import { detailRows } from "./characterstats.mjs";
/** CUIStat: sub_4F2450/4F2820/4F32D0. Base values come only from authoritative CharacterData / 0x0D. */
export const STAT_WINDOW = {
  width: 176,
  height: 315,
  home: { x: 72, y: 72 },
  close: { x: 128, y: 9, w: 32, h: 15 },
  detail: { x: 122, y: 280, w: 47, h: 18 },
};
export const AP_BUTTONS = [
  { field: "maxHp", x: 148, y: 112, mask: 0x800 },
  { field: "maxMp", x: 148, y: 130, mask: 0x2000 },
  { field: "str", x: 148, y: 202, mask: 0x40 },
  { field: "dex", x: 148, y: 220, mask: 0x80 },
  { field: "int", x: 148, y: 238, mask: 0x100 },
  { field: "luk", x: 148, y: 256, mask: 0x200 },
];
export function statWindow({
  ctx,
  image,
  send,
  audio,
  getSelf,
  isInGame,
  point,
  jobName,
  getBasis = () => undefined,
  getTemporary = () => ({}),
  getAmmoPad = () => 0,
  log,
}) {
  const el = (id) => document.getElementById(id),
    root = el("stat-window");
  let opened = false,
    detail = false,
    pending = false,
    nextAt = 0,
    hover,
    pressed,
    drag,
    signature = "";
  let at = { ...STAT_WINDOW.home };
  try {
    const p = JSON.parse(localStorage.getItem("kms111.statAt") ?? "null");
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      at = {
        x: Math.max(0, Math.min(624, p.x)),
        y: Math.max(0, Math.min(285, p.y)),
      };
  } catch {}
  const stamp = (path, x, y) => {
    const a = image(path);
    if (a.ready) ctx.drawImage(a.img, Math.round(x), Math.round(y));
  };
  const box = (node, x, y, w, h) =>
    Object.assign(node.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
  // CUIStat::Update enables by AP; sub_55CF60 gates sends separately, without flashing disabled art.
  const disabled = (b) => {
    const self = getSelf();
    if (!(self?.ap > 0)) return true;
    if (b.field === "maxHp" || b.field === "maxMp")
      return (
        !Number.isInteger(self?.job) ||
        self.job < 0 ||
        self.job >= 500 ||
        !(self[b.field] < (b.field === "maxHp" ? 30000 : 10000))
      );
    return !(self?.[b.field] < 255);
  };
  const blocked = (b) =>
    disabled(b) ||
    pending ||
    performance.now() < nextAt ||
    !(getSelf()?.hp > 0);
  function sync() {
    const self = getSelf(),
      key = [
        opened,
        pending,
        self?.ap,
        self?.hp,
        self?.job,
        !!getBasis(),
        detail,
        ...AP_BUTTONS.map((b) => self?.[b.field]),
      ].join("|");
    if (key === signature) return;
    signature = key;
    root.classList.toggle("hidden", !opened);
    box(root, at.x, at.y, 176, 315);
    for (const b of AP_BUTTONS) el(`ap-${b.field}`).disabled = disabled(b);
    el("stat-detail").disabled = !getBasis();
    el("stat-detail").setAttribute("aria-expanded", String(detail));
  }
  function toggle(value) {
    opened = value ?? !opened;
    if (!opened) detail = false;
    signature = "";
    sync();
    if (opened) {
      audio.effect("UI/DlgNotice");
      el("stat-close").focus();
    } else document.getElementById("view").focus?.();
  }
  box(el("stat-body"), 0, 0, 176, 315);
  box(el("stat-close"), 128, 9, 32, 15);
  box(el("stat-detail"), 122, 280, 47, 18);
  for (const b of AP_BUTTONS) {
    const node = el(`ap-${b.field}`);
    box(node, b.x, b.y, 17, 16);
    node.addEventListener("click", () => {
      if (!opened || blocked(b) || !isInGame()) return;
      pending = true;
      nextAt = performance.now() + 500;
      sync();
      send({ t: "ability-up", field: b.field });
    });
  }
  for (const id of [
    "stat-close",
    "stat-detail",
    ...AP_BUTTONS.map((b) => `ap-${b.field}`),
  ]) {
    const node = el(id);
    node.addEventListener("pointerenter", () => {
      hover = id;
      if (!node.disabled) audio.effect("UI/BtMouseOver");
    });
    node.addEventListener("pointerleave", () => {
      hover = undefined;
      pressed = undefined;
    });
    node.addEventListener("pointerdown", () => {
      pressed = id;
    });
    node.addEventListener("pointerup", () => {
      pressed = undefined;
    });
  }
  el("stat-detail").addEventListener("click", () => {
    if (!getBasis()) return;
    detail = !detail;
    signature = "";
    sync();
    audio.effect("UI/BtMouseClick");
  });
  el("stat-close").addEventListener("click", () => toggle(false));
  el("stat-body").addEventListener("mousedown", (e) => {
    if (!opened) return;
    const p = point(e);
    if (p.y - at.y >= 0 && p.y - at.y < 35) {
      drag = { dx: p.x - at.x, dy: p.y - at.y };
      e.preventDefault();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const p = point(e);
    at = {
      x: Math.max(0, Math.min(624, Math.round(p.x - drag.dx))),
      y: Math.max(0, Math.min(285, Math.round(p.y - drag.dy))),
    };
    box(root, at.x, at.y, 176, 315);
  });
  const release = () => {
    if (!drag) return;
    drag = undefined;
    try {
      localStorage.setItem("kms111.statAt", JSON.stringify(at));
    } catch {}
  };
  window.addEventListener("mouseup", release);
  window.addEventListener("blur", release);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation?.();
      toggle(false);
    }
  });
  sync();
  return {
    get open() {
      return opened;
    },
    toggle,
    contains(x, y) {
      if (!opened || !isInGame()) return false;
      if (x >= at.x && x < at.x + 176 && y >= at.y && y < at.y + 315) return true;
      return detail && !!getBasis() && x >= at.x + 176 && x < at.x + 352 &&
        y >= at.y + 123 && y < at.y + 315;
    },
    receive(message) {
      if (message.t === "ability-result") {
        pending = false;
        signature = "";
        sync();
        if (!message.changed) log("能力點請求已回覆，數值未變更。");
        return true;
      }
      if (
        message.t === "field" ||
        message.t === "disconnect" ||
        message.t === "login"
      ) {
        pending = false;
        nextAt = 0;
        signature = "";
        if (message.t === "disconnect" || message.t === "login") {
          detail = false;
          toggle(false);
        }
      }
      if (message.t === "error" && pending) {
        pending = false;
        signature = "";
        sync();
      }
      return false;
    },
    draw() {
      if (!opened || !isInGame()) return;
      sync();
      const self = getSelf();
      if (!self) return;
      stamp("UI/UIWindow.img/Stat/backgrnd", at.x, at.y);
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "12px 'Dotum','돋움','KMSCJK',sans-serif";
      ctx.fillStyle = "#000";
      const text = (value, x, y) =>
        ctx.fillText(
          String(value ?? "—"),
          Math.round(at.x + x),
          Math.round(at.y + y),
        );
      text(self.name, 45, 61);
      text(jobName(self.job), 45, 79);
      text("내커뮤니티", 68, 97);
      const basis = getBasis(),
        b = basis?.basic;
      text(`${self.hp} / ${b?.maxHp ?? self.maxHp}`, 38, 113);
      text(`${self.mp} / ${b?.maxMp ?? self.maxMp}`, 38, 131);
      text(
        `${self.exp} (${self.expToNext > 0 ? Math.trunc((100 * self.exp) / self.expToNext) : 0}%)`,
        57,
        149,
      );
      text(self.fame, 57, 167);
      ["str", "dex", "int", "luk"].forEach((field, i) =>
        text(
          b && b[field] !== self[field]
            ? `${b[field]} (${self[field]}+${b[field] - self[field]})`
            : self[field],
          45,
          203 + 18 * i,
        ),
      );
      text(self.ap, 77, 282);
      ctx.restore();
      for (const b of AP_BUTTONS) {
        const id = `ap-${b.field}`,
          state = disabled(b)
            ? "disabled"
            : pressed === id
              ? "pressed"
              : hover === id
                ? "mouseOver"
                : "normal";
        stamp(`UI/UIWindow.img/Stat/BtApUp/${state}/0`, at.x + b.x, at.y + b.y);
      }
      const state =
        pressed === "stat-close"
          ? "pressed"
          : hover === "stat-close"
            ? "mouseOver"
            : "normal";
      stamp(`UI/UIWindow.img/BtUIClose/${state}/0`, at.x + 128, at.y + 9);
      const detailState = !basis
        ? "disabled"
        : pressed === "stat-detail"
          ? "pressed"
          : hover === "stat-detail"
            ? "mouseOver"
            : "normal";
      stamp(
        `UI/UIWindow.img/Stat/BtDetail/${detailState}/0`,
        at.x + 122,
        at.y + 280,
      );
      const rows =
        detail && basis ? detailRows(basis, getTemporary(), getAmmoPad()) : [];
      if (rows.length) {
        // CUIStatDetail is attached at parent +(176,123), 176x192; no invented title/close art.
        stamp("UI/UIWindow.img/Stat/backgrnd2", at.x + 176, at.y + 123);
        ctx.save();
        ctx.font = "12px 'Dotum','돋움','KMSCJK',sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#000";
        rows.forEach((value, i) =>
          ctx.fillText(
            value,
            Math.round(at.x + 176 + 80),
            Math.round(at.y + 123 + 12 + 18 * i),
          ),
        );
        ctx.restore();
      }
      // Accessible, non-visible mirror of canvas numbers; don't rebuild DOM per animation frame.
      const description =
        `${self.name} HP ${self.hp}/${b?.maxHp ?? self.maxHp} MP ${self.mp}/${b?.maxMp ?? self.maxMp} STR ${b?.str ?? self.str} DEX ${b?.dex ?? self.dex} INT ${b?.int ?? self.int} LUK ${b?.luk ?? self.luk} AP ${self.ap}` +
        (rows.length
          ? " · " +
            [
              "攻擊",
              "物防",
              "魔攻",
              "魔防",
              "命中",
              "迴避",
              "手技",
              "移動速度",
              "跳躍",
            ]
              .map((name, i) => `${name} ${rows[i]}`)
              .join(" · ")
          : "");
      if (el("stat-values").textContent !== description)
        el("stat-values").textContent = description;
    },
  };
}
