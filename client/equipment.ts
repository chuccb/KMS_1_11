import type { InventoryView, ItemView } from "../server/src/client/session.ts";
import type { HtmlImageLookup, UiPoint, UiAudio } from "./ui-types.ts";
import { SLOT_SIZE } from "./slot.ts";
import { buttonSprite, BT_UI_CLOSE, uiButtonFace } from "./uicontrols.ts";
import { requireElement } from "./dom.ts";
import { isRecord, isFiniteNumber } from "./resource-validation.ts";
type EquipmentHit =
  { kind: "slot"; slot: number; item?: ItemView } | { kind: "body" | "close"; item?: never };
interface EquipmentOptions {
  ctx: CanvasRenderingContext2D;
  image: HtmlImageLookup;
  icon(id: number): ReturnType<HtmlImageLookup>;
  getInventory(): Pick<InventoryView, "worn"> | undefined;
  getSelf(): object | undefined;
  isInGame(): boolean;
  point(event: MouseEvent): UiPoint;
  audio: UiAudio;
  beginItem(item: { tab: number; slot: number; item: ItemView }, point: UiPoint): void;
  isCovered?(point: UiPoint): boolean;
  describe(id: number): unknown;
  hover(item?: ItemView, point?: UiPoint): void;
}
import { releaseOnInterrupt } from "./pointer.ts";
import { bodyPart, partFitsItem, equipConflict, firstBagSlot, canWear } from "./equip-rules.ts";
export { bodyPart, partFitsItem, equipConflict, firstBagSlot, canWear };
/**
 * CUIEquip: 4D89F0 / 4D9110. Coordinates read from PE VA 005BC368, fourteen (s32 x,s32 y).
 *
 * 176x315 is `UI/UIWindow.img/Equip/backgrnd` - a 176x315 canvas in Data.wz, the same plate the
 * stat and skill windows use.
 */
export const EQUIP_WINDOW = {
  backgrnd: "UI/UIWindow.img/Equip/backgrnd",
  width: 176,
  height: 315,
  home: { x: 48, y: 48 },
  close: { x: 128, y: 9, w: BT_UI_CLOSE.width, h: BT_UI_CLOSE.height },
};
export const EQUIP_SLOTS: readonly (readonly [number, number])[] = [
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
export function equipSlotAt(x: number, y: number) {
  return (
    EQUIP_SLOTS.findIndex(
      ([sx, sy]) => sx < x && x < sx + SLOT_SIZE && sy < y && y < sy + SLOT_SIZE,
    ) + 1
  );
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
}: EquipmentOptions) {
  const root = requireElement("equip-window", "section");
  let opened = false,
    at = { ...EQUIP_WINDOW.home },
    drag: { dx: number; dy: number; x: number; y: number } | undefined,
    moved = false,
    pointer: UiPoint | undefined,
    press: UiPoint | undefined,
    pressed = false;
  try {
    const s: unknown = JSON.parse(localStorage.getItem("kms111.equipAt") ?? "null");
    if (isRecord(s) && isFiniteNumber(s.x) && isFiniteNumber(s.y))
      at = {
        x: Math.max(0, Math.min(784, s.x)),
        y: Math.max(0, Math.min(584, s.y)),
      };
  } catch {}
  function hit(x: number, y: number): EquipmentHit | undefined {
    if (!opened || !isInGame()) return;
    const lx = x - at.x,
      ly = y - at.y;
    if (lx < 0 || ly < 0 || lx >= EQUIP_WINDOW.width || ly >= EQUIP_WINDOW.height) return;
    const c = EQUIP_WINDOW.close;
    if (lx >= c.x && lx < c.x + c.w && ly >= c.y && ly < c.y + c.h) return { kind: "close" };
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
  const closeButton = requireElement("equip-close", "button");
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
    if (press && Math.abs(pointer.x - press.x) + Math.abs(pointer.y - press.y) > 3) moved = true;
    if (drag) {
      if (Math.abs(pointer.x - drag.x) + Math.abs(pointer.y - drag.y) > 3) moved = true;
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
  releaseOnInterrupt(() => {
    release();
    hover(undefined);
  });
  function toggle(value?: boolean) {
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
      const b = image(EQUIP_WINDOW.backgrnd);
      if (b.ready) ctx.drawImage(b.img, at.x, at.y);
      const close = image(
        buttonSprite(
          "UI/UIWindow.img/BtUIClose",
          uiButtonFace({
            pressed,
            hover: pointer !== undefined && hit(pointer.x, pointer.y)?.kind === "close",
          }),
        ),
      );
      if (close.ready)
        ctx.drawImage(close.img, at.x + EQUIP_WINDOW.close.x, at.y + EQUIP_WINDOW.close.y);
      for (const item of getInventory()?.worn ?? []) {
        const xy = EQUIP_SLOTS[item.slot - 1];
        if (!xy) continue;
        const a = icon(item.itemId);
        if (a.ready)
          ctx.drawImage(
            a.img,
            at.x + xy[0] + Math.floor((SLOT_SIZE - a.img.naturalWidth) / 2),
            at.y + xy[1] + Math.floor((SLOT_SIZE - a.img.naturalHeight) / 2),
          );
      }
    },
  };
}
