/**
 * CUIMessenger（메신저）the 2003 three-person chat room, as the browser models it.
 *
 * EVIDENCE (MapleStory.exe.c / .lst / Data.wz, FINDINGS 4.41 + ADR-095)
 * ---------------------------------------------------------------------------
 * - `sub_4DDAF0` ctor: window type **5** (`sub_43E340(n0xC8, 5, ...)`, registry defaults
 *   `sub_43D750` i==5 → uiWndX5=500, uiWndY5=50, shown 1), member vector = three records of
 *   25 dwords at `this + 25*slot + 31`, `this_8` is the global window pointer.
 * - `sub_4E09D0` build: mode `*(this+22)`: 0 → `UI/UIWindow.img/Messenger/backgrnd` 200x335,
 *   1 → the same plus `Messenger/charView` (97x322) at (200,13) for a 297x335 window
 *   (registry shown default 1), 2 → `Messenger/backgrnd2` 200x51. Controls
 *   (`sub_4E0FF0`): BtUIClose id **1000** at (152,9); CCtrlEdit id **1001** at (11,286)
 *   176x12 (256 chars, black Gulim); CCtrlScrollBar id **1002** at (179,58) len **218**
 *   with `+44 = 172` wrap width and `sub_452130(lines - 15)`.
 * - `sub_4E1320` paint: sixteen wrapped rows, `for (i = 63; i < 271; i += 13)` at x=10,
 *   first row = the scrollbar position - the shared CCtrlScrollBar arithmetic lives in
 *   `client/vscroll.ts` (track = 218 - 3*12 = 182 travel).
 * - `sub_4DFB50` members: the avatar of slot s sits at `98 * s + 103` inside the window
 *   (charView's three cells, feet on the teal name bar of the art) and the name plate
 *   surface draws the name at its own (2,2); the browser puts the plate at (202,105+98s),
 *   i.e. two pixels into the charView column on the slot's bar (🟡 the plate's COM anchor
 *   is a relative attach, not a literal Create rect).
 * - `sub_4DF3E0` member record dwords: [3] avatar COM, [5] typing flag, [6] slot,
 *   [7] character id, [8] face equipment, [9..23] the `sub_45F340` look, [24] name.
 *   `announce != 0` appends 「- '%s'님이 입장하셨습니다」.
 * - `sub_4DDFE0` open: five help rows first (exact literals below), then `0x24 type 0`
 *   with the roomId (0 = create). `/q` and `/Q` close locally without any packet
 *   (`sub_4E24B0`); `/초대 <name>` sends `type 3` with the name only, and an empty name or
 *   your own prints 「- 다른 캐릭터의 이름을 입력하세요.」 instead.
 * - `sub_4DE490` chat: the client composes `"myName : text"`, prints it in its own log
 *   first, then sends `type 5`. `sub_4DEAF0`/`sub_4E1E30` typing indicator: a `type 5`
 *   line of `myName` + `"1"`/`"0"` with **no separator**; the receiver splits the last
 *   char, sets the member's typing flag (ghost tint `0x0CFFFFFF` on the avatar) and prints
 *   nothing; `sub_4E14E0` paints 「N1,N2 님이 입력중입니다」 at (11,316) in Gulim 12 #336699.
 * - `blink` and `chatBalloon` canvases exist in `UI/UIWindow.img/Messenger` but have zero
 *   references in the PE - present with no consumer, like BtLock/BtReset (🟡 unpainted).
 */
import type { MessengerEvent } from "../server/src/protocol/messenger.ts";
import { vScrollScroller, VSCR_CELL, type VScrollBarGeometry } from "./vscroll.ts";

/** The mode-1 window: backgrnd (200x335) plus the charView column (97x322) at (200,13). */
export const MESSENGER_WINDOW = {
  /** `sub_43D750`'s uiWndX5/uiWndY5 defaults. */
  home: { x: 500, y: 50 },
  width: 297,
  height: 335,
  backgrnd: "UI/UIWindow.img/Messenger/backgrnd",
  charView: { path: "UI/UIWindow.img/Messenger/charView", x: 200, y: 13 },
  /** id 1000, `sub_4E0FF0`. */
  close: { x: 152, y: 9, width: 26, height: 26 },
  /** id 1001, `sub_4E0FF0`; the page overlays a DOM input here. */
  edit: { x: 11, y: 286, width: 176, height: 12 },
  /** id 1002: Create(parent, 1002, 1, 0, 179, 58, 218, 0), `+44 = 172` wrap. */
  scrollbar: {
    x: 179,
    y: 58,
    width: VSCR_CELL,
    height: 218,
    arrow: VSCR_CELL,
  } satisfies VScrollBarGeometry,
  /**
   * `sub_4E1320`: sixteen rows at x=10, y = 63 + 13k. The wrap happens at append time in
   * `sub_4DEE50`: width **170** (`n170 = 170` through `sub_439A70`) and every continuation
   * line is prefixed with four spaces (`asc_5BC328`, "    ").
   */
  log: { x: 10, firstY: 63, lastY: 271, pitch: 13, wrap: 170, indent: "    " },
  /** `sub_4E14E0`'s typing row. */
  typing: { x: 11, y: 316 },
  /** `sub_4DFB50`: avatar feet at `98 * slot + 103`, centred in the charView column. */
  member: { feetY: 103, slotPitch: 98, avatarX: 248, nameX: 202, nameY: 105 },
} as const;

/** The client-owned strings, each with the PE address of its Korean original. */
export const MESSENGER_TEXT = {
  /** `sub_4DDFE0` prints these five on every window create. */
  help: [
    "[ Maple Messenger 도움말 ]",
    "-------------------------",
    "초대 : /초대 캐릭터이름",
    "종료 : /q",
    "-------------------------",
  ],
  /** 5BC63C, `sub_4DF3E0`'s announce row. */
  enter: (name: string) => `- '${name}'님이 입장하셨습니다`,
  /** `sub_4DF910`. */
  left: (name: string) => `- '${name}'님이 퇴장하셨습니다`,
  /** `sub_4DF670`. */
  joinFailed: "- 초청 받은 대화방에 참가하지 못했습니다",
  /** `sub_4E19A0` ok != 0. */
  inviteSent: (name: string) => `- '${name}'님에게 초청 메시지를 보냈습니다`,
  /** 5BC7F0, `sub_4E19A0` ok == 0. */
  notFound: (name: string) => `- '${name}'님을 찾지 못했습니다`,
  /** `sub_4E24B0`'s refusal for an empty or self invite. */
  otherName: "- 다른 캐릭터의 이름을 입력하세요.",
  /** 5BC87C: `sub_4E1BB0` with the window already open prints this one row. */
  inviteLine: (name: string) => `- '${name}'님께서 대화방 초청 메시지를 보냈습니다`,
  /** 5BC834: `sub_4E1BB0`'s modal body when the window is closed. */
  inviteModal: (name: string) =>
    `'${name}'님께서 대화방\r\n 초청 메시지를 보냈습니다\r\n초청에 응하시겠습니까?`,
  /** 5BC7D8, `sub_4E14E0`: the names join with "," before this suffix. */
  typingSuffix: " 님이 입력중입니다",
} as const;

/** One filled member cell (the 25-dword record of `sub_4DF3E0`, minus the COM handles). */
export interface MessengerMember {
  name: string;
  level: number;
  face: number;
  look: readonly number[];
  /**
   * The member's own animation clock: `sub_4DFB50` hangs each cell's avatar on a live
   * Shape2D child window (`v9[1]`, positioned via `sub_424590(x,y)`) that `sub_4DEAF0`
   * ticks every 30 ms - the stand animation runs from the moment the cell is filled.
   */
  since: number;
}
export interface MessengerRoomState {
  slots: readonly (MessengerMember | undefined)[];
  lines: readonly string[];
  typing: readonly boolean[];
}
export type MessengerTransition =
  | { kind: "opened" }
  | { kind: "closed" }
  | { kind: "participant"; slot: number }
  | { kind: "left"; slot: number }
  | { kind: "line"; text: string }
  | { kind: "typing"; name: string; on: boolean }
  | { kind: "cell"; slot: number }
  | { kind: "invite"; inviterName: string; roomId: number };

/** `sub_4DE490`'s answer to one finished edit box. */
export type MessengerSay =
  | { kind: "close" }
  | { kind: "command"; name: string }
  | { kind: "chat"; line: string }
  | { kind: "refused" };

export function messengerState() {
  let room:
    | {
        slots: (MessengerMember | undefined)[];
        lines: string[];
        typing: boolean[];
      }
    | undefined;
  let invite: { inviterName: string; roomId: number } | undefined;

  const snapshot = (): MessengerRoomState | undefined =>
    room === undefined
      ? undefined
      : {
          slots: room.slots.map((member) => (member === undefined ? undefined : { ...member })),
          lines: [...room.lines],
          typing: [...room.typing],
        };
  // sub_4DEE50's ZList is unbounded: rows are only ever appended, never trimmed. The
  // scrollbar takes count-15 as its max (sub_452130), same as the trade log.
  const push = (text: string) => {
    if (room === undefined) return;
    room.lines.push(text);
  };

  return {
    get open() {
      return room !== undefined;
    },
    get room(): MessengerRoomState | undefined {
      return snapshot();
    },
    get pendingInvite() {
      return invite === undefined ? undefined : { ...invite };
    },
    /** `sub_4DDF10`: the window comes up with the five help rows, empty cells. */
    openLocal(): MessengerTransition[] {
      room = {
        slots: [undefined, undefined, undefined],
        lines: [...MESSENGER_TEXT.help],
        typing: [false, false, false],
      };
      invite = undefined;
      return [{ kind: "opened" }];
    },
    /** `sub_4DDFA0`: closing drops everything; the wire only learns from `0x24 type 2`. */
    closeLocal(): MessengerTransition[] {
      if (room === undefined) return [];
      room = undefined;
      return [{ kind: "closed" }];
    },
    answerInvite(roomId: number): boolean {
      if (invite?.roomId !== roomId) return false;
      invite = undefined;
      return true;
    },
    dismissInvite(roomId: number) {
      if (invite?.roomId === roomId) invite = undefined;
    },
    /**
     * `sub_4E18D0`'s eight types. `now` is the caller's clock (performance.now()) and only
     * seeds the member animation clocks; every transition is otherwise deterministic.
     */
    receive(event: MessengerEvent, now = 0): MessengerTransition[] {
      switch (event.kind) {
        case "participant": {
          if (room === undefined || event.participant.slot < 0 || event.participant.slot > 2)
            return [];
          const { slot, name, level, face, look } = event.participant;
          room.slots[slot] = { name, level, face, look, since: now };
          room.typing[slot] = false;
          if (event.announce) push(MESSENGER_TEXT.enter(name));
          return [{ kind: "participant", slot }];
        }
        case "joinFailed": {
          if (room === undefined) return [];
          push(MESSENGER_TEXT.joinFailed);
          return [{ kind: "line", text: MESSENGER_TEXT.joinFailed }];
        }
        case "left": {
          if (room === undefined || event.slot < 0 || event.slot > 2) return [];
          const member = room.slots[event.slot];
          room.slots[event.slot] = undefined;
          room.typing[event.slot] = false;
          if (member !== undefined) push(MESSENGER_TEXT.left(member.name));
          return [{ kind: "left", slot: event.slot }];
        }
        case "invite": {
          // `sub_4E1BB0`: open window prints one row, closed window raises the modal.
          if (room !== undefined) {
            push(MESSENGER_TEXT.inviteLine(event.inviterName));
            return [{ kind: "line", text: MESSENGER_TEXT.inviteLine(event.inviterName) }];
          }
          invite = { inviterName: event.inviterName, roomId: event.roomId };
          return [{ kind: "invite", inviterName: event.inviterName, roomId: event.roomId }];
        }
        case "inviteResult": {
          if (room === undefined) return [];
          const text =
            event.ok === 0
              ? MESSENGER_TEXT.notFound(event.name)
              : MESSENGER_TEXT.inviteSent(event.name);
          push(text);
          return [{ kind: "line", text }];
        }
        case "chat": {
          if (room === undefined) return [];
          const split = event.line.indexOf(" : ");
          if (split < 0) {
            // `sub_4E1E30`'s typing line: name = all but the last char, and the flag is
            // `lastChar != "0"` (sub_416B00(right(line,1), "0")) - anything else counts as on.
            if (event.line.length < 2) return [];
            const name = event.line.slice(0, -1);
            const on = event.line.slice(-1) !== "0";
            const slot = room.slots.findIndex((member) => member?.name === name);
            if (slot < 0) return [];
            room.typing[slot] = on;
            return [{ kind: "typing", name, on }];
          }
          // A chat row also clears the speaker's tint: the same member loop runs with the
          // flag false before sub_4DEE50 appends (vtable+232 gets 0 = identity).
          const out: MessengerTransition[] = [];
          const speaker = event.line.slice(0, split);
          const said = room.slots.findIndex((member) => member?.name === speaker);
          if (said >= 0 && room.typing[said] === true) {
            room.typing[said] = false;
            out.push({ kind: "typing", name: speaker, on: false });
          }
          push(event.line);
          out.push({ kind: "line", text: event.line });
          return out;
        }
        case "cellUpdate": {
          // `sub_4E2170`: only an occupied cell applies; level/face/look replace in place,
          // the name and the typing flag stay, and no row is printed.
          if (room === undefined || event.slot < 0 || event.slot > 2) return [];
          const member = room.slots[event.slot];
          if (member === undefined) return [];
          room.slots[event.slot] = {
            ...member,
            level: event.level,
            face: event.face,
            look: event.look,
          };
          return [{ kind: "cell", slot: event.slot }];
        }
        case "roster": {
          // `sub_4E2280`: exactly three marker-led cells; clear empties silently, keep is a
          // no-op, fill replaces the cell (announce=0, so no entrance row).
          if (room === undefined) return [];
          const current = room;
          const out: MessengerTransition[] = [];
          event.cells.forEach((cell, slot) => {
            if (cell.action === "keep") return;
            current.typing[slot] = false;
            current.slots[slot] =
              cell.action === "clear"
                ? undefined
                : {
                    name: cell.name,
                    level: cell.level,
                    face: cell.face,
                    look: cell.look,
                    since: now,
                  };
            out.push({ kind: "cell", slot });
          });
          return out;
        }
      }
    },
    /**
     * `sub_4E24B0` + `sub_4DE490`: `/q` closes with no packet, `/초대 name` becomes a
     * `type 3`, anything else a `type 5` line the caller prints before sending.
     */
    say(text: string, myName: string): MessengerSay {
      if (room === undefined || text === "") return { kind: "refused" };
      if (text === "/q" || text === "/Q") return { kind: "close" };
      if (text.startsWith("/")) {
        const rest = text.slice(1);
        if (rest.startsWith("초대")) {
          const name = rest.slice(2).trim();
          if (name === "" || name === myName) return { kind: "refused" };
          return { kind: "command", name };
        }
        return { kind: "refused" };
      }
      return { kind: "chat", line: `${myName} : ${text}` };
    },
    /** `sub_4DEAF0`: the separator-less typing line. */
    typingLine(myName: string, on: boolean): string {
      return `${myName}${on ? "1" : "0"}`;
    },
    /** `sub_4E14E0`: the names of the members whose flag is up, comma-joined. */
    typingNames(): string {
      if (room === undefined) return "";
      const names: string[] = [];
      room.slots.forEach((member, slot) => {
        if (member !== undefined && room?.typing[slot] === true) names.push(member.name);
      });
      return names.length === 0 ? "" : names.join(",") + MESSENGER_TEXT.typingSuffix;
    },
    clear() {
      room = undefined;
      invite = undefined;
    },
  };
}
export type MessengerState = ReturnType<typeof messengerState>;

/** The log's CCtrlScrollBar (id 1002), same arithmetic as every other list scrollbar. */
export function messengerLogScroller() {
  return vScrollScroller(MESSENGER_WINDOW.scrollbar);
}
export type MessengerLogScroll = ReturnType<typeof messengerLogScroller>;
