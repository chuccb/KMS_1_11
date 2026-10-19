import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";
import { paintVScrollbar } from "./vscroll.ts";
import { HUD_FONT } from "./hud.ts";
import type { AvatarImage, BrowserLook } from "./image-cache.ts";
import {
  TRADE_SLOTS,
  TRADE_WINDOW,
  tradeSlotRect,
  type TradeLogScroll,
  type TradeRoomState,
  type TradeParticipant,
  type TradeScrollZone,
} from "./trade-state.ts";

/**
 * The browser's CTradingRoomDlg paint (`sub_4D4960`) and hit test (`sub_4D63C0`, `sub_4D46C0`).
 *
 * It is a renderer plus geometry, not a DOM widget: the exchange window is modeless (the field
 * keeps running under it), so the page hit-tests it on the shared canvas exactly like the shop
 * sheet, and only the three control rectangles act.
 *
 *   - backgrnd 367x295 centred by `sub_461C50`'s rule, so (216,152);
 *   - message log filled (92,21,182,217) at 50 % black, lines wrapped at 166 px like `sub_4D5900`,
 *     text rows from (94,26) at a 13 px pitch up to y<234 like `sub_4D5730` (16 visible lines);
 *   - the log's CCtrlScrollBar painted from `UI/Basic.img/VScr` cells and driven by the
 *     `tradeLogScroller` arithmetic (`sub_452500`/`sub_4525B0`/`sub_452600`/`sub_452670`);
 *   - item counts left-anchored at (35c+291, 35r+148) like `sub_4D5440`'s `sub_525AE0` digits;
 *   - names centred on 44/327 at y=110, mesos right-aligned at 84/366 at y=277 (`sub_4D4960`);
 *   - avatars at (36,103) and (330,103), mine mirrored towards the middle (`sub_4D33A0`);
 *   - 8+8 cells of 32 px at a 35 px pitch, rows from y=129, columns 11/46 and 292/327;
 *   - a 50 % white wash over (286,124,76,144) or (4,124,76,144) once a side locks (`this+63/64`).
 *
 * My half is always the right one - where `sub_4D5C80` accepts drops and `sub_4D33A0` puts my
 * avatar. The native paint hard-codes packet index 0 to the right, which mirrors the accepter's
 * grid; the page follows the avatar rule for both seats instead (docs/NATIVE_TRADE.md).
 */
export interface TradeRendererOptions {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  avatars(look: BrowserLook, flip: boolean): AvatarImage;
  icon(itemId: number): { img: HTMLImageElement; ready: boolean };
}
export type TradeHit =
  | { kind: "close" }
  | { kind: "trade" }
  | { kind: "coin" }
  | { kind: "body" }
  | { kind: "scroll"; zone: TradeScrollZone }
  | { kind: "slot"; side: "mine" | "theirs"; roomSlot: number; occupied: boolean };

const CONTROL_RECTS = {
  close: TRADE_WINDOW.close,
  trade: TRADE_WINDOW.trade,
  coin: TRADE_WINDOW.coin,
} as const;

/** `sub_4D63C0` + `sub_4D46C0` + `sub_452500` in page coordinates; undefined outside the sheet. */
export function tradeWindowAt(
  x: number,
  y: number,
  at: UiPoint,
  room: TradeRoomState | undefined,
  scroll?: TradeLogScroll,
): TradeHit | undefined {
  const lx = x - at.x,
    ly = y - at.y;
  if (lx < 0 || ly < 0 || lx >= TRADE_WINDOW.width || ly >= TRADE_WINDOW.height) return undefined;
  for (const [kind, box] of Object.entries(CONTROL_RECTS) as [
    keyof typeof CONTROL_RECTS,
    (typeof CONTROL_RECTS)[keyof typeof CONTROL_RECTS],
  ][]) {
    if (lx >= box.x && lx < box.x + box.width && ly >= box.y && ly < box.y + box.height)
      return { kind };
  }
  // The log scrollbar acts before the sheet body: sub_4521E0 eats the click, so it never drags.
  const zone = scroll?.hit(lx, ly);
  if (zone !== undefined) return { kind: "scroll", zone };
  for (const side of ["mine", "theirs"] as const) {
    const offers = room?.sides[side === "mine" ? room.myIndex : room.myIndex === 0 ? 1 : 0].offers;
    for (let slot = 1; slot <= TRADE_SLOTS; slot++) {
      const rect = tradeSlotRect(side, slot);
      if (
        rect &&
        lx >= rect.x &&
        lx < rect.x + rect.width &&
        ly >= rect.y &&
        ly < rect.y + rect.height
      )
        return { kind: "slot", side, roomSlot: slot, occupied: offers?.has(slot) ?? false };
    }
  }
  return { kind: "body" };
}

export function tradeRenderer({ ctx, image, avatars, icon }: TradeRendererOptions) {
  const lookOf = (participant: TradeParticipant | undefined): BrowserLook | undefined =>
    participant === undefined
      ? undefined
      : {
          face: participant.face,
          hair: participant.look[0] ?? 30000,
          items: participant.look.slice(1),
        };

  function drawLog(at: UiPoint, messages: readonly string[], scroll: TradeLogScroll | undefined) {
    const log = TRADE_WINDOW.log;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(at.x + log.x, at.y + log.y, log.width, log.height);
    if (messages.length === 0) {
      scroll?.sync(0);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(at.x + log.x + 2, at.y + log.y + 2, log.wrap, log.height - 4);
    ctx.clip();
    ctx.font = HUD_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    const rows: string[] = [];
    for (const text of messages)
      for (const part of text.split("\n")) {
        let line = `    ${part}`;
        while (ctx.measureText(line).width > log.wrap && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > log.wrap) cut--;
          rows.push(line.slice(0, cut));
          line = line.slice(cut);
        }
        rows.push(line);
      }
    // sub_4D5730: `for (y = 26; y < 234; y += 13)` at x=94, first row = the scrollbar position
    // (without a scroller the view stays pinned to the tail, which is where a fresh room sits).
    const line = log.line;
    const capacity = Math.max(1, Math.floor((line.lastY - line.firstY) / line.pitch));
    if (scroll) scroll.sync(rows.length);
    const first = scroll ? scroll.pos : Math.max(0, rows.length - capacity);
    rows
      .slice(first, first + capacity)
      .forEach((row, index) =>
        ctx.fillText(row, at.x + line.x, at.y + line.firstY + index * line.pitch),
      );
    ctx.restore();
  }

  /**
   * The log's CCtrlScrollBar (id 1003) in `UI/Basic.img/VScr` cells; the arithmetic and
   * the cell stamping live in the shared `client/vscroll.ts`.
   */
  function drawScrollbar(at: UiPoint, scroll: TradeLogScroll | undefined) {
    if (scroll === undefined) return;
    paintVScrollbar(ctx, image, at, TRADE_WINDOW.scrollbar, scroll);
  }

  function drawSide(at: UiPoint, room: TradeRoomState, side: "mine" | "theirs") {
    const index = side === "mine" ? room.myIndex : room.myIndex === 0 ? 1 : 0;
    const state = room.sides[index];
    for (const offer of state.offers.values()) {
      const rect = tradeSlotRect(side, offer.roomSlot);
      if (rect === undefined) continue;
      const art = icon(offer.item.itemId);
      if (art.ready) ctx.drawImage(art.img, at.x + rect.x, at.y + rect.y);
      if (offer.count > 1) {
        // sub_4D5440: `sub_525AE0` anchors the digit glyphs left/top at (35c+291, 35r+148).
        ctx.font = HUD_FONT;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(
          String(offer.count),
          at.x + rect.x + TRADE_WINDOW.count.dx,
          at.y + rect.y + TRADE_WINDOW.count.dy,
        );
      }
    }
    if (state.confirmed) {
      const wash = side === "mine" ? TRADE_WINDOW.lock.mine : TRADE_WINDOW.lock.theirs;
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(at.x + wash.x, at.y + wash.y, wash.width, wash.height);
    }
  }

  function draw(
    at: UiPoint,
    room: TradeRoomState | undefined,
    ui: { hover?: string; pressed?: string },
    scroll?: TradeLogScroll,
  ) {
    const bg = image(TRADE_WINDOW.path);
    if (bg.ready) ctx.drawImage(bg.img, at.x, at.y);
    if (room === undefined) return;
    ctx.save();
    drawLog(at, room.messages, scroll);
    drawScrollbar(at, scroll);
    ctx.font = HUD_FONT;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";
    for (const [side, cx] of [
      ["theirs", TRADE_WINDOW.names.left],
      ["mine", TRADE_WINDOW.names.right],
    ] as const) {
      const participant = room.participants.get(
        side === "mine" ? room.myIndex : room.myIndex === 0 ? 1 : 0,
      );
      if (participant === undefined) continue;
      ctx.textAlign = "center";
      ctx.fillText(participant.name, at.x + cx, at.y + TRADE_WINDOW.names.y);
    }
    for (const [side, right] of [
      ["theirs", TRADE_WINDOW.mesos.left],
      ["mine", TRADE_WINDOW.mesos.right],
    ] as const) {
      const state = room.sides[side === "mine" ? room.myIndex : room.myIndex === 0 ? 1 : 0];
      ctx.textAlign = "right";
      ctx.fillText(String(state.mesos), at.x + right, at.y + TRADE_WINDOW.mesos.y);
    }
    for (const [side, anchor, flip] of [
      ["theirs", TRADE_WINDOW.avatars.left, false],
      ["mine", TRADE_WINDOW.avatars.right, true],
    ] as const) {
      const look = lookOf(
        room.participants.get(side === "mine" ? room.myIndex : room.myIndex === 0 ? 1 : 0),
      );
      if (look === undefined) continue;
      const art = avatars(look, flip);
      if (art.ready)
        ctx.drawImage(art.img, at.x + anchor + art.dx, at.y + TRADE_WINDOW.avatars.y + art.dy);
    }
    drawSide(at, room, "theirs");
    drawSide(at, room, "mine");
    for (const [id, box] of Object.entries(CONTROL_RECTS) as [
      keyof typeof CONTROL_RECTS,
      (typeof CONTROL_RECTS)[keyof typeof CONTROL_RECTS],
    ][]) {
      const state = ui.pressed === id ? "pressed" : ui.hover === id ? "mouseOver" : "normal";
      const art = image(
        `${id === "close" ? "UI/UIWindow.img/BtUIClose" : id === "trade" ? "UI/UIWindow.img/Trade/BtTrade" : "UI/UIWindow.img/Trade/BtCoin"}/${state}/0`,
      );
      if (art.ready) ctx.drawImage(art.img, at.x + box.x, at.y + box.y);
    }
    ctx.restore();
  }

  return {
    draw,
    /** Warm every canvas the sheet stamps so opening it does not pop in piece by piece. */
    warm() {
      image(TRADE_WINDOW.path);
      for (const path of [
        "UI/UIWindow.img/BtUIClose",
        "UI/UIWindow.img/Trade/BtTrade",
        "UI/UIWindow.img/Trade/BtCoin",
      ])
        for (const state of ["normal", "pressed", "mouseOver"]) image(`${path}/${state}/0`);
    },
  };
}
export type TradeRenderer = ReturnType<typeof tradeRenderer>;
