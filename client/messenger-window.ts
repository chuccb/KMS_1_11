/**
 * CUIMessenger paint + hit test for the page canvas, mirroring `client/trade-window.ts`.
 *
 *   - backgrnd 200x335 at the window origin and the charView column 97x322 at (200,13)
 *     (`sub_4E09D0` mode 1, the registry `uiOpt5` default of `sub_43D750`);
 *   - sixteen wrapped log rows at x=10, y=63+13k from the scrollbar position
 *     (`sub_4E1320`), wrapped at the scrollbar's `+44 = 172` like `sub_4DEE50`;
 *   - the log's CCtrlScrollBar (id 1002) from `UI/Basic.img/VScr` via `client/vscroll.ts`;
 *   - BtUIClose id 1000 at (152,9) with its three sprite states (`sub_4E0FF0`);
 *   - member avatars feet-anchored at (248, 103+98*slot) inside the charView column and
 *     their names at (202, 105+98*slot) on the art's teal name bars (`sub_4DFB50`);
 *     a typing member's avatar gets the `0x0CFFFFFF` ghost wash of `sub_4E1E30`;
 *   - the typing row 「N1,N2 님이 입력중입니다」 at (11,316), Gulim 12 #336699 (`sub_4E14E0`).
 *
 * The edit box (id 1001, (11,286) 176x12) is a DOM input the page positions over the
 * canvas - `sub_449CB0`'s CCtrlEdit is a real child HWND natively, so a canvas-only
 * rectangle could never hold the caret. Hit testing still reports the rect so clicks
 * focus that input.
 */
import {
  MESSENGER_TEXT,
  MESSENGER_WINDOW,
  type MessengerMember,
  type MessengerRoomState,
} from "./messenger-state.ts";
import type { MessengerLogScroll } from "./messenger-state.ts";
import { paintVScrollbar } from "./vscroll.ts";
import type { VScrollZone } from "./vscroll.ts";
import { HUD_FONT } from "./hud.ts";
import type { AvatarImage, BrowserLook } from "./image-cache.ts";
import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";

export interface MessengerRendererOptions {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  /** `since` is the member's cell-fill clock: the native avatar is a live, ticking Shape2D node. */
  avatars(look: BrowserLook, flip: boolean, since: number): AvatarImage;
}
/** `sub_45F340`'s list arrives hair-first; the face u32 travels beside it (FINDINGS 4.41.3). */
function browserLookOf(member: MessengerMember): BrowserLook {
  return { face: member.face, hair: member.look[0] ?? 30000, items: member.look.slice(1) };
}

export type MessengerHit =
  { kind: "close" } | { kind: "edit" } | { kind: "body" } | { kind: "scroll"; zone: VScrollZone };

/** `sub_4E0FF0`'s rects plus the sheet body, in page coordinates. */
export function messengerWindowAt(
  x: number,
  y: number,
  at: UiPoint,
  open: boolean,
  scroll?: MessengerLogScroll,
): MessengerHit | undefined {
  if (!open) return undefined;
  const lx = x - at.x,
    ly = y - at.y;
  if (lx < 0 || ly < 0 || lx >= MESSENGER_WINDOW.width || ly >= MESSENGER_WINDOW.height)
    return undefined;
  const close = MESSENGER_WINDOW.close;
  if (lx >= close.x && lx < close.x + close.width && ly >= close.y && ly < close.y + close.height)
    return { kind: "close" };
  const zone = scroll?.hit(lx, ly);
  if (zone !== undefined) return { kind: "scroll", zone };
  const edit = MESSENGER_WINDOW.edit;
  if (lx >= edit.x && lx < edit.x + edit.width && ly >= edit.y && ly < edit.y + edit.height)
    return { kind: "edit" };
  return { kind: "body" };
}

export function messengerRenderer(options: MessengerRendererOptions) {
  const { ctx, image, avatars } = options;

  /**
   * `sub_4DEE50`'s append-time wrap: the longest prefix that fits 170 px becomes a row and
   * the remainder is re-measured with `asc_5BC328`'s four-space continuation indent.
   */
  function wrapLines(messages: readonly string[]): string[] {
    const log = MESSENGER_WINDOW.log;
    const rows: string[] = [];
    for (const text of messages)
      for (const part of text.split("\n")) {
        let line = part;
        for (;;) {
          if (ctx.measureText(line).width <= log.wrap || line.length <= 1) {
            rows.push(line);
            break;
          }
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > log.wrap) cut--;
          rows.push(line.slice(0, cut));
          line = log.indent + line.slice(cut);
        }
      }
    return rows;
  }

  function draw(
    at: UiPoint,
    room: MessengerRoomState | undefined,
    ui: { hover?: string; pressed?: string },
    scroll?: MessengerLogScroll,
  ) {
    const bg = image(MESSENGER_WINDOW.backgrnd);
    if (bg.ready) ctx.drawImage(bg.img, at.x, at.y);
    if (room === undefined) return;
    const view = image(MESSENGER_WINDOW.charView.path);
    if (view.ready)
      ctx.drawImage(
        view.img,
        at.x + MESSENGER_WINDOW.charView.x,
        at.y + MESSENGER_WINDOW.charView.y,
      );
    ctx.save();
    // The log: sixteen wrapped rows from the scrollbar position, like `sub_4E1320`.
    const log = MESSENGER_WINDOW.log;
    ctx.font = HUD_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#000000";
    const rows = wrapLines(room.lines);
    if (scroll) scroll.sync(rows.length);
    const capacity = Math.max(1, Math.floor((log.lastY - log.firstY) / log.pitch));
    const first = scroll ? scroll.pos : Math.max(0, rows.length - capacity);
    rows
      .slice(first, first + capacity)
      .forEach((row, index) =>
        ctx.fillText(row, at.x + log.x, at.y + log.firstY + index * log.pitch),
      );
    if (scroll !== undefined) paintVScrollbar(ctx, image, at, MESSENGER_WINDOW.scrollbar, scroll);
    // Members: avatar feet on the charView bars, names on the plate row, ghost when typing.
    const member = MESSENGER_WINDOW.member;
    room.slots.forEach((slot, index) => {
      if (slot === undefined) return;
      const feetY = member.feetY + member.slotPitch * index;
      const art = avatars(browserLookOf(slot), false, slot.since);
      if (art.ready) {
        // `sub_4E1E30` tints the avatar COM through vtable+232 with 0xCFFFFFFF while the
        // member types and 0 when idle. The build sets the same slot to 0x00FFFFFF and the
        // avatar is plainly visible, so alpha 0 is the identity; CharSelect dims unchosen
        // characters with 0x80FFFFFF (`sub_42E210`) - the alpha byte is an opacity modulate.
        // Typing therefore draws the sprite at 0xCC/0xFF = 80 % opacity.
        if (room.typing[index] === true) ctx.globalAlpha = 204 / 255;
        ctx.drawImage(art.img, at.x + member.avatarX + art.dx, at.y + feetY + art.dy);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillText(slot.name, at.x + member.nameX, at.y + member.nameY + member.slotPitch * index);
    });
    // The typing row of `sub_4E14E0`.
    const names = room.slots
      .filter((slot, index) => slot !== undefined && room.typing[index] === true)
      .map((slot) => (slot as { name: string }).name);
    if (names.length > 0) {
      ctx.fillStyle = "#336699";
      ctx.fillText(
        names.join(",") + MESSENGER_TEXT.typingSuffix,
        at.x + MESSENGER_WINDOW.typing.x,
        at.y + MESSENGER_WINDOW.typing.y,
      );
    }
    // BtUIClose id 1000.
    const close = MESSENGER_WINDOW.close;
    const state =
      ui.pressed === "close" ? "pressed" : ui.hover === "close" ? "mouseOver" : "normal";
    const closeArt = image(`UI/UIWindow.img/BtUIClose/${state}/0`);
    if (closeArt.ready) ctx.drawImage(closeArt.img, at.x + close.x, at.y + close.y);
    ctx.restore();
  }

  function warm() {
    for (const path of [
      MESSENGER_WINDOW.backgrnd,
      MESSENGER_WINDOW.charView.path,
      "UI/UIWindow.img/BtUIClose/normal/0",
      "UI/UIWindow.img/BtUIClose/mouseOver/0",
      "UI/UIWindow.img/BtUIClose/pressed/0",
      ...["prev0", "prev1", "next0", "next1", "base", "thumb0", "thumb1"].map(
        (cell) => `UI/Basic.img/VScr/enabled/${cell}`,
      ),
      ...["prev", "next", "base"].map((cell) => `UI/Basic.img/VScr/disabled/${cell}`),
    ])
      image(path);
  }

  return { draw, warm };
}
