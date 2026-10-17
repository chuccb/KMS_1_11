/** CUIEquip: 4D89F0 / 4D9110. Coordinates read from PE VA 005BC368, fourteen (s32 x,s32 y). */
export const EQUIP_WINDOW = {
  width: 176,
  height: 315,
  home: { x: 48, y: 48 },
  close: { x: 128, y: 9, w: 32, h: 15 },
};
export const EQUIP_SLOTS = [
  [39, 55],
  [39, 88],
  [72, 121],
  [105, 121],
  [39, 154],
  [39, 187],
  [39, 220],
  [6, 187],
  [6, 154],
  [138, 154],
  [105, 154],
  [105, 187],
  [138, 187],
  [105, 253],
];
export function equipSlotAt(x, y) {
  return (
    EQUIP_SLOTS.findIndex(
      ([sx, sy]) => sx < x && x < sx + 32 && sy < y && y < sy + 32,
    ) + 1
  );
}
export function bodyPart(id) {
  const p = Math.floor(id / 10000);
  return (
    {
      100: 1,
      101: 2,
      102: 3,
      103: 4,
      104: 5,
      105: 5,
      106: 6,
      107: 7,
      108: 8,
      109: 10,
      110: 9,
    }[p] ?? ([13, 14].includes(Math.floor(id / 100000)) ? 11 : 0)
  );
}
export function equipConflict(id, worn = []) {
  const has = (n) => worn.find((i) => i.slot === n);
  return Math.floor(id / 100000) === 14 && has(10)
    ? 10
    : Math.floor(id / 10000) === 109 &&
        Math.floor((has(11)?.itemId ?? 0) / 100000) === 14
      ? 11
      : Math.floor(id / 10000) === 105 && has(6)
        ? 6
        : Math.floor(id / 10000) === 106 &&
            Math.floor((has(5)?.itemId ?? 0) / 10000) === 105
          ? 5
          : 0;
}
export function firstBagSlot(inventory, tab) {
  const t = inventory?.tabs.find((t) => t.tab === tab);
  if (!t) return 0;
  for (let i = 1; i <= t.capacity; i++)
    if (!t.items.some((x) => x.slot === i)) return i;
  return 0;
}
/** sub_4636B0/sub_4658E0: exclude replaced/conflicting equips BEFORE checking the new item.
 * Base stats and per-instance wire stats, never the WZ template's incSTR as a substitute.
 * No buff system exists yet; this is not a claim of complete buff/stat dependency reconstruction. */
export function canWear(
  item,
  facts,
  self,
  inventory,
  part = bodyPart(item.itemId),
) {
  if (!self || self.hp <= 0) return "角色死亡時不能穿戴裝備。";
  if (!part || part !== bodyPart(item.itemId) || facts?.cash || item.cash)
    return "此裝備部位或現金裝備尚不支援。";
  const req = facts?.requirements;
  if (!req) return "正在讀取原始裝備需求，請稍後再試。";
  const gender = Math.floor(item.itemId / 1000) % 10;
  if (gender !== 2 && self.gender !== 2 && gender !== self.gender)
    return "角色性別不符合裝備需求。";
  const jobGroup = Math.trunc(self.job / 100),
    weapon = Math.floor(item.itemId / 10000) % 100;
  if (
    jobGroup === 2 &&
    Math.floor(item.itemId / 100000) >= 13 &&
    Math.floor(item.itemId / 100000) <= 14 &&
    weapon >= 40 &&
    weapon <= 47
  )
    return "法師不能使用這個武器種類。";
  if (
    req.job !== 0 &&
    (req.job & (jobGroup === 0 ? 0 : 1 << (jobGroup - 1))) === 0
  )
    return "職業不符合裝備需求。";
  const conflict = equipConflict(item.itemId, inventory?.worn),
    replaced = inventory?.worn.find((x) => x.slot === part);
  if (conflict && replaced && !firstBagSlot(inventory, 1))
    return "裝備欄沒有空位放置衝突的裝備。";
  const total = { str: self.str, dex: self.dex, int: self.int, luk: self.luk };
  for (const worn of inventory?.worn ?? [])
    if (worn.slot !== part && worn.slot !== conflict)
      for (const k of Object.keys(total)) total[k] += worn.stats?.[k] ?? 0;
  if (
    self.level < req.level ||
    Object.keys(total).some((k) => total[k] < req[k])
  )
    return "目前能力不足，無法穿戴這件裝備。";
  return undefined;
}
export function equipmentWindow({
  ctx,
  image,
  icon,
  getInventory,
  getSelf,
  isInGame,
  point,
  audio,
  beginItem,
  isCovered,
  describe,
  hover,
}) {
  const root = document.getElementById("equip-window");
  let opened = false,
    at = { ...EQUIP_WINDOW.home },
    drag,
    moved = false,
    pointer,
    press,
    pressed = false;
  try {
    const s = JSON.parse(localStorage.getItem("kms111.equipAt") ?? "null");
    if (Number.isFinite(s?.x) && Number.isFinite(s?.y))
      at = {
        x: Math.max(0, Math.min(784, s.x)),
        y: Math.max(0, Math.min(584, s.y)),
      };
  } catch {}
  function hit(x, y) {
    if (!opened || !isInGame()) return;
    const lx = x - at.x,
      ly = y - at.y;
    if (lx < 0 || ly < 0 || lx >= 176 || ly >= 315) return;
    const c = EQUIP_WINDOW.close;
    if (lx >= c.x && lx < c.x + c.w && ly >= c.y && ly < c.y + c.h)
      return { kind: "close" };
    const slot = equipSlotAt(lx, ly);
    return slot
      ? {
          kind: "slot",
          slot: -slot,
          item: getInventory()?.worn.find((i) => i.slot === slot),
        }
      : { kind: "body" };
  }
  function sync() {
    root.classList.toggle("hidden", !opened || !isInGame());
    Object.assign(root.style, {
      left: `${at.x}px`,
      top: `${at.y}px`,
      width: "176px",
      height: "315px",
      pointerEvents: !drag && pointer && isCovered?.(pointer) ? "none" : "auto",
    });
  }
  const closeButton = document.getElementById("equip-close");
  Object.assign(closeButton.style, {
    left: "128px",
    top: "9px",
    width: "32px",
    height: "15px",
  });
  closeButton.addEventListener("click", () => toggle(false));
  root.addEventListener("mousedown", (e) => {
    if (e.button > 0) return;
    const p = point(e),
      h = hit(p.x, p.y);
    moved = false;
    press = p;
    pressed = h?.kind === "close";
    if (h?.kind === "slot") {
      if (h.item) beginItem({ tab: 1, slot: h.slot, item: h.item }, p);
      e.preventDefault();
      return;
    }
    if (h?.kind === "body") {
      drag = { dx: p.x - at.x, dy: p.y - at.y, x: p.x, y: p.y };
      e.preventDefault();
    }
  });
  root.addEventListener("click", (e) => {
    if (moved) return;
    const p = point(e);
    if (hit(p.x, p.y)?.kind === "close") toggle(false);
  });
  window.addEventListener("mousemove", (e) => {
    pointer = point(e);
    if (
      press &&
      Math.abs(pointer.x - press.x) + Math.abs(pointer.y - press.y) > 3
    )
      moved = true;
    if (drag) {
      if (Math.abs(pointer.x - drag.x) + Math.abs(pointer.y - drag.y) > 3)
        moved = true;
      if (moved) {
        at = {
          x: Math.max(0, Math.min(784, Math.round(pointer.x - drag.dx))),
          y: Math.max(0, Math.min(584, Math.round(pointer.y - drag.dy))),
        };
      }
    }
    const h = isCovered?.(pointer) ? undefined : hit(pointer.x, pointer.y);
    if (h?.item) describe(h.item.itemId);
    hover(h?.item, pointer);
    sync();
  });
  const release = () => {
    if (drag && moved)
      try {
        localStorage.setItem("kms111.equipAt", JSON.stringify(at));
      } catch {}
    drag = undefined;
    press = undefined;
    pressed = false;
  };
  window.addEventListener("mouseup", release);
  window.addEventListener("blur", release);
  function toggle(value) {
    const show = value ?? !opened;
    if (show === opened) return;
    opened = show;
    drag = undefined;
    hover(undefined, pointer);
    audio.effect(opened ? "UI/MenuUp" : "UI/MenuDown");
    sync();
  }
  return {
    hit,
    toggle,
    get open() {
      return opened;
    },
    draw() {
      sync();
      if (!opened || !isInGame() || !getSelf()) return;
      const b = image("UI/UIWindow.img/Equip/backgrnd");
      if (b.ready) ctx.drawImage(b.img, at.x, at.y);
      const close = image(
        `UI/UIWindow.img/BtUIClose/${pressed ? "pressed" : pointer && hit(pointer.x, pointer.y)?.kind === "close" ? "mouseOver" : "normal"}/0`,
      );
      if (close.ready) ctx.drawImage(close.img, at.x + 128, at.y + 9);
      for (const item of getInventory()?.worn ?? []) {
        const xy = EQUIP_SLOTS[item.slot - 1];
        if (!xy) continue;
        const a = icon(item.itemId);
        if (a.ready)
          ctx.drawImage(
            a.img,
            at.x + xy[0] + Math.floor((32 - a.img.naturalWidth) / 2),
            at.y + xy[1] + Math.floor((32 - a.img.naturalHeight) / 2),
          );
      }
    },
  };
}
