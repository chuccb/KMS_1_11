import type { MiniRoomEvent } from "../server/src/protocol/miniroom.ts";
import type { ItemSlot } from "../server/src/protocol/itemslot.ts";
import { vScrollScroller } from "./vscroll.ts";

/** `sub_4D2DB0` allocates eight 16-byte cells per side; `sub_4D63C0` numbers them 1..8.
 * Lives here (not in the server codec) so browser modules never pull a server runtime import;
 * `protocol/miniroom.ts` re-exports it, the same arrangement as PARTY_MAX_MEMBERS. */
export const TRADE_SLOTS = 8;

/**
 * The 1:1 exchange window (CTradingRoomDlg, `sub_4D2DB0`) as the 2003 client draws it.
 *
 * Every number here is read off the binary or the archive, not guessed:
 *
 *   - `home` is `sub_461C50`'s centring of the 367x295 `Trade/backgrnd`, the same rule the shop
 *     window uses (`((800 - w) >> 1, (600 - h) >> 1)`), so (216,152).
 *   - the eight-per-side slot grid is `sub_4D63C0`'s hit test (32 px cells, 35 px pitch, two
 *     columns, four rows, top row at y=129; my columns start at x=292, theirs at x=11) and the
 *     `Trade/backgrnd` pixels agree cell for cell.
 *   - names/mesos/log/lock overlays are `sub_4D4960`'s paint: my name centred on 327 and theirs on
 *     44 at y=110, mesos right-aligned at 366 and 84 at y=277, the message log filled at
 *     (92,21,182,217) with its CCtrlScrollBar (id 1003) at (262,21) and `+44 = 166` wrapping, and a
 *     50 % white wash over (286,124,76,144) or (4,124,76,144) once a side locks.
 *   - log text is `sub_4D5730`: `for (y = 26; y < 234; y += 13)` at x=94 with the font at `this+61`
 *     and the first visible line = the scrollbar position `*(this[58] + 48)` -> 16 rows.
 *   - the log scrollbar is a CCtrlScrollBar (`sub_4D3EF0` creates id 1003 at (262,21) length 216):
 *     `sub_4D5900` sets max = rows-15 on every append and follows to the new bottom only when the
 *     view was already at it; `sub_452150` clamps pos to [0, max-1]; `sub_452500` splits the track
 *     into 12 px arrows, a 12 px thumb at `12 + pos*180/(max-1)` and two page zones; `sub_4525B0`
 *     steps +-1, `sub_452600` pages +-max(max/16, 16), `sub_452670`/`sub_4526A0` drag the thumb by
 *     `startPos + max*dy/180`, and `sub_452340` accepts the wheel over the control rect only.
 *   - an offered item's count is `sub_4D5440` + `sub_525AE0` (a per-digit painter: left/top anchor,
 *     x advances by digit width + spacing): non-equipment draws its count from (35c+291, 35r+148),
 *     i.e. one pixel left of the cell at 19 below its top; equipment (id / 1000000 == 1) draws none.
 *   - avatars are `sub_4D33A0`/`sub_4D3730`: self at (330,103) mirrored towards the middle, the
 *     other player at (36,103).
 *   - controls are `sub_4D3EF0`: BtTrade id1001 at (222,267), BtCoin id1002 at (285,275), the
 *     unused CCtrlEdit id1004 at (96,248,176,12), BtUIClose id2 at (319,9).
 *
 * Re-read in ADR-111: the two button coordinates above are exactly what `sub_4D3EF0` creates, and
 * `UI/UIWindow.img/Trade/backgrnd` is 367x295 in Data.wz, so `home` (216,152) is the same centring
 * as every other sheet. The same constructor also creates **id1003 at (262,21) with height 216**
 * (`*(*(this + 58) + 44) = 166`) - the offer list's own scrollbar, which the browser window does
 * not model because its list never overflows. Noted, not invented.
 */
export const TRADE_WINDOW = {
  path: "UI/UIWindow.img/Trade/backgrnd",
  width: 367,
  height: 295,
  home: { x: 216, y: 152 },
  close: { x: 319, y: 9, width: 32, height: 15 },
  trade: { x: 222, y: 267, width: 50, height: 23 },
  coin: { x: 285, y: 275, width: 14, height: 14 },
  edit: { x: 96, y: 248, width: 176, height: 12 },
  log: {
    x: 92,
    y: 21,
    width: 182,
    height: 217,
    wrap: 166,
    /** `sub_4D5730`: rows run `for (y = 26; y < 234; y += 13)` at x = 94 -> 16 visible lines. */
    line: { x: 94, firstY: 26, pitch: 13, lastY: 234 },
  },
  /** `sub_4D5440`: the count glyph anchor relative to the slot cell (`sub_525AE0` = left/top). */
  count: { dx: -1, dy: 19 },
  scrollbar: { x: 262, y: 21, width: 12, height: 216, arrow: 12 },
  slots: { size: 32, pitch: 35, columns: 2, rows: 4, top: 129, left: 11, right: 292 },
  names: { left: 44, right: 327, y: 110 },
  mesos: { left: 84, right: 366, y: 277 },
  avatars: { left: 36, right: 330, y: 103 },
  lock: {
    mine: { x: 286, y: 124, width: 76, height: 144 },
    theirs: { x: 4, y: 124, width: 76, height: 144 },
  },
} as const;

/** `sub_4D63C0`: room slot `1..8` -> the cell's top-left in window coordinates for one side. */
export function tradeSlotRect(side: "mine" | "theirs", roomSlot: number) {
  const index = roomSlot - 1;
  if (!Number.isInteger(roomSlot) || index < 0 || index >= TRADE_SLOTS) return undefined;
  const column = index % TRADE_WINDOW.slots.columns,
    row = Math.floor(index / TRADE_WINDOW.slots.columns);
  return {
    x:
      (side === "mine" ? TRADE_WINDOW.slots.right : TRADE_WINDOW.slots.left) +
      column * TRADE_WINDOW.slots.pitch,
    y: TRADE_WINDOW.slots.top + row * TRADE_WINDOW.slots.pitch,
    width: TRADE_WINDOW.slots.size,
    height: TRADE_WINDOW.slots.size,
  };
}

/** One of `sub_452500`'s hit zones, re-exported from the shared CCtrlScrollBar module. */
export type { VScrollZone as TradeScrollZone } from "./vscroll.ts";
export { vScrollPage as tradeLogPage } from "./vscroll.ts";

/**
 * The trade log's CCtrlScrollBar state (id 1003): the shared `vScrollScroller` bound to
 * the sheet's own control rect, created at (262,21) with len 216 by `sub_4D3EF0`.
 */
export function tradeLogScroller() {
  return vScrollScroller(TRADE_WINDOW.scrollbar);
}
export type TradeLogScroll = ReturnType<typeof tradeLogScroller>;

/** The string literals the client owns, with the PE address of each Korean original. */
export const TRADE_TEXT = {
  /** 481910's `'%s'님께서 1:1 교환을\r\n 요청하였습니다\r\n요청에 응하시겠습니까?` */
  invite: (name: string) =>
    `'${name}'님께서 1:1 교환을\r\n 요청하였습니다\r\n요청에 응하시겠습니까?`,
  /** 4D61F0's BtTrade confirm box. */
  confirm: "정말로 교환하시겠습니까?",
  /** 4D5F50's BtCoin input box. */
  mesos: "얼마를 올리시겠습니까?",
  /** 481B20 code 1, also 471A40's missing target. */
  notFound: "캐릭터를 찾을 수 없습니다",
  /** 481B20 code 2. */
  busy: (name: string) => `'${name}'님은 다른 일을 하는 중입니다`,
  /** 4D3D70's type 8 codes. */
  cancelled: "상대방이 교환을 취소했습니다.",
  done: "교환이 성사되었습니다.\r\n결과를 확인해 주세요.",
  failed: "교환에 실패하였습니다.",
  /** 471A40's two pre-send refusals (the third, the GM one, is the account gate below). */
  gm: "관리용 아이디는 1:1교환을 할 수 없습니다",
  windowOpen: "다른 작업중에는 1:1교환을 할 수 없습니다",
} as const;

export interface TradeParticipant {
  index: number;
  name: string;
  face: number;
  look: readonly number[];
  level: number;
}
export interface TradeOffer {
  roomSlot: number;
  count: number;
  item: ItemSlot;
}
export interface TradeSideState {
  offers: ReadonlyMap<number, TradeOffer>;
  mesos: number;
  confirmed: boolean;
}
export interface TradeRoomState {
  myIndex: number;
  participants: ReadonlyMap<number, TradeParticipant>;
  sides: readonly [TradeSideState, TradeSideState];
  messages: readonly string[];
}
/** What one `0x50` changed, so a view can react without re-deriving it from the packet. */
export type TradeTransition =
  | { kind: "opened"; myIndex: number }
  | { kind: "closed"; code?: number }
  | { kind: "invite"; inviterId: number; inviterName: string }
  | { kind: "participant"; index: number }
  | { kind: "offer"; index: number; roomSlot: number }
  | { kind: "mesos"; index: number }
  | { kind: "locked" }
  | { kind: "message"; text: string };

interface MutableSide {
  offers: Map<number, TradeOffer>;
  mesos: number;
  confirmed: boolean;
}
const emptySide = (): MutableSide => ({ offers: new Map(), mesos: 0, confirmed: false });
/** `sub_4D5900` keeps the log as a growing list; the browser caps it so a long room cannot. */
const LOG_LINES = 64;

/**
 * The room the window shows. Mirrors CTradingRoomDlg's fields: the two 8-slot vectors
 * (`this+65`/`this+66`), the two mesos (`this+67`/`this+68`), my lock (`this+63`), the received
 * lock (`this+64`), myIndex (`this+22`), participants (`sub_482340`) and the message log.
 *
 * Index 0 is the RIGHT side and index 1 the LEFT one in the native paint; `myIndex` says which
 * index is me. The view always puts me on the right (the avatar rule of `sub_4D33A0`), so it asks
 * the state for "my side" instead of indexing by packet order.
 */
export function tradeState() {
  let room:
    | {
        myIndex: number;
        participants: Map<number, TradeParticipant>;
        sides: [MutableSide, MutableSide];
        messages: string[];
      }
    | undefined;
  let invite: { id: number; name: string } | undefined;
  let lastActionAt = 0;

  const snapshot = (): TradeRoomState | undefined =>
    room === undefined
      ? undefined
      : {
          myIndex: room.myIndex,
          participants: new Map([...room.participants].map(([k, v]) => [k, { ...v }])),
          sides: [
            {
              offers: new Map(room.sides[0].offers),
              mesos: room.sides[0].mesos,
              confirmed: room.sides[0].confirmed,
            },
            {
              offers: new Map(room.sides[1].offers),
              mesos: room.sides[1].mesos,
              confirmed: room.sides[1].confirmed,
            },
          ],
          messages: [...room.messages],
        };

  return {
    get room(): TradeRoomState | undefined {
      return snapshot();
    },
    get open() {
      return room !== undefined;
    },
    get pendingInvite() {
      return invite === undefined ? undefined : { ...invite };
    },

    answerInvite(inviterId: number) {
      if (invite?.id !== inviterId) return false;
      invite = undefined;
      return true;
    },
    /** `sub_4815E0`/`sub_481D00`/`sub_4D3360` applied to the room model. */
    receive(event: MiniRoomEvent): TradeTransition[] {
      switch (event.kind) {
        case "invite": {
          // `sub_481910`: one modal at a time, and never while a room is up. The view decides
          // visibility (CConfig goExchange, dialog policy); a blocked offer is answered false.
          if (invite === undefined && room === undefined)
            invite = { id: event.inviterId, name: event.inviterName };
          return [{ kind: "invite", inviterId: event.inviterId, inviterName: event.inviterName }];
        }
        case "enter": {
          // `sub_481790` throws for a second dialog and for a kind it cannot build; ignore both.
          if (room !== undefined || event.roomKind !== 1) return [];
          room = {
            myIndex: event.myIndex,
            participants: new Map(event.participants.map((p) => [p.index, { ...p }])),
            sides: [emptySide(), emptySide()],
            messages: [],
          };
          invite = undefined;
          return [{ kind: "opened", myIndex: event.myIndex }];
        }
        case "participant": {
          if (room === undefined || room.participants.has(event.participant.index)) return [];
          room.participants.set(event.participant.index, { ...event.participant });
          return [{ kind: "participant", index: event.participant.index }];
        }
        case "message": {
          if (room === undefined) return [];
          room.messages.push(event.text);
          if (room.messages.length > LOG_LINES)
            room.messages.splice(0, room.messages.length - LOG_LINES);
          return [{ kind: "message", text: event.text }];
        }
        case "item": {
          if (room === undefined || event.index < 0 || event.index > 1) return [];
          const side = room.sides[event.index];
          side.offers.set(event.roomSlot, {
            roomSlot: event.roomSlot,
            count: event.item.kind === "equip" ? 1 : event.item.quantity,
            item: event.item,
          });
          return [{ kind: "offer", index: event.index, roomSlot: event.roomSlot }];
        }
        case "mesos": {
          if (room === undefined || event.index < 0 || event.index > 1) return [];
          room.sides[event.index].mesos = event.amount;
          return [{ kind: "mesos", index: event.index }];
        }
        case "lock": {
          // `sub_4D3BB0`: one flag for "the other side locked"; my own lock is set locally.
          if (room === undefined) return [];
          const other = room.myIndex === 0 ? 1 : 0;
          room.sides[other].confirmed = true;
          return [{ kind: "locked" }];
        }
        case "finish":
          room = undefined;
          return [{ kind: "closed", code: event.code }];
        case "refused":
        case "ready":
          return [];
      }
    },
    /** `sub_4D61F0` sets `this+63` locally; the wire only ever carries the peer's lock. */
    confirmLocally() {
      if (room === undefined) return false;
      room.sides[room.myIndex].confirmed = true;
      return true;
    },
    /** `sub_4D5C80`/`sub_4D5F50`: locked, alone, or inside the 500 ms native throttle -> silent no. */
    canOffer(now: number) {
      if (room === undefined) return false;
      if (room.sides[room.myIndex].confirmed) return false;
      if (room.participants.size <= 1) return false;
      if (now - lastActionAt < 500) return false;
      return true;
    },
    markOffer(now: number) {
      lastActionAt = now;
    },
    /** `sub_4D5C80`: my side only, and only into a slot that holds nothing yet. */
    roomSlotForDrop(x: number, y: number): number | undefined {
      if (room === undefined) return undefined;
      for (let slot = 1; slot <= TRADE_SLOTS; slot++) {
        const rect = tradeSlotRect("mine", slot);
        if (
          rect &&
          x >= rect.x &&
          x < rect.x + rect.width &&
          y >= rect.y &&
          y < rect.y + rect.height
        ) {
          return room.sides[room.myIndex].offers.has(slot) ? undefined : slot;
        }
      }
      return undefined;
    },
    mySide(): TradeSideState | undefined {
      return room === undefined ? undefined : snapshot()!.sides[room.myIndex];
    },
    theirSide(): TradeSideState | undefined {
      return room === undefined ? undefined : snapshot()!.sides[room.myIndex === 0 ? 1 : 0];
    },
    me(): TradeParticipant | undefined {
      return room === undefined ? undefined : room.participants.get(room.myIndex);
    },
    them(): TradeParticipant | undefined {
      return room === undefined ? undefined : room.participants.get(room.myIndex === 0 ? 1 : 0);
    },
    clear() {
      room = undefined;
      invite = undefined;
      lastActionAt = 0;
    },
  };
}
export type TradeState = ReturnType<typeof tradeState>;
/** `sub_471A40`'s two printable refusals; the GM one has no browser analogue (no admin accounts). */
export type TradeCommandFeedback = { kind: "notFound" } | { kind: "windowOpen" };
export function tradeCommandLines(feedback: TradeCommandFeedback): readonly string[] {
  return feedback.kind === "notFound" ? [TRADE_TEXT.notFound] : [TRADE_TEXT.windowOpen];
}

/** `sub_4D3D70` maps the type 8 code to its box; anything else closes silently. */
export function tradeFinishText(code: number): string | undefined {
  if (code === 1) return TRADE_TEXT.cancelled;
  if (code === 3) return TRADE_TEXT.done;
  if (code === 4) return TRADE_TEXT.failed;
  return undefined;
}
