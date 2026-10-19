/** CWvsApp feedback projection and CUIScreenMsg layout. Pure: no DOM, transport, accounts or writes. */
import { isRecord } from "./resource-validation.ts";
import type { LootNotice } from "../server/src/protocol/drop.ts";
export type FeedbackSelf = { characterId: number; level: number; exp: number };
export type FeedbackEvent =
  | { t: "loot"; notice: LootNotice }
  | { t: "system-notice"; type: 0 | 1; text: string }
  | { t: "field" | "self"; self: FeedbackSelf }
  | { t: "login" | "disconnect" };
function uint(value: unknown, max = 0xffffffff): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}
export function readFeedbackEvent(value: unknown): FeedbackEvent | undefined {
  if (!isRecord(value)) return;
  switch (value.t) {
    case "login":
    case "disconnect":
      return { t: value.t };
    case "field":
    case "self": {
      const self = value.self;
      if (
        !isRecord(self) ||
        !uint(self.characterId) ||
        !uint(self.level, 255) ||
        self.level === 0 ||
        !uint(self.exp)
      )
        throw Error("Invalid feedback self snapshot");
      return {
        t: value.t,
        self: { characterId: self.characterId, level: self.level, exp: self.exp },
      };
    }
    case "system-notice":
      if ((value.type !== 0 && value.type !== 1) || typeof value.text !== "string")
        throw Error("Invalid system notice");
      return { t: value.t, type: value.type, text: value.text };
    case "loot": {
      const n = value.notice;
      if (!isRecord(n)) throw Error("Invalid loot notice");
      if (n.kind === "mesos" && uint(n.amount))
        return { t: value.t, notice: { kind: n.kind, amount: n.amount } };
      if (n.kind === "item" && uint(n.itemId) && uint(n.count))
        return { t: value.t, notice: { kind: n.kind, itemId: n.itemId, count: n.count } };
      if (n.kind === "rejected") return { t: value.t, notice: { kind: n.kind } };
      throw Error("Invalid loot notice");
    }
  }
}
/** 55C130: no numeric-id substitution for an unknown/empty archive name; count0 uses singular. */
export function lootText(notice: LootNotice, name?: string): string | undefined {
  if (notice.kind === "mesos") return `메소를 얻었습니다 (+${notice.amount | 0})`;
  if (notice.kind === "rejected") return "아이템을 더 이상 가질 수 없습니다";
  if (!name) return;
  return (notice.count | 0) > 1
    ? `아이템을 얻었습니다 (${name} ${notice.count | 0}개)`
    : `아이템을 얻었습니다 (${name})`;
}
/** 55BEB0: EXP toast only for an increasing counter at the SAME level and character. */
export function experienceText(
  before: FeedbackSelf | undefined,
  after: FeedbackSelf,
): string | undefined {
  return before &&
    before.characterId === after.characterId &&
    before.level === after.level &&
    after.exp > before.exp
    ? `경험치를 얻었습니다 (+${after.exp - before.exp})`
    : undefined;
}
/** Shape2D 10019160+98 -> 10011030 -> 10010AD0 -> 10010C40: integer linear RelMove. */
export function nativeScreenAlpha(age: number): number {
  const elapsed = Math.max(0, Math.min(SCREEN_MESSAGES.durationMs, Math.trunc(age)));
  return (255 - Math.trunc((255 * elapsed) / SCREEN_MESSAGES.durationMs)) / 255;
}
export const SCREEN_MESSAGES = {
  count: 6,
  width: 290,
  height: 14,
  x: 504,
  y: 382,
  durationMs: 6000,
} as const;
export interface ScreenMessage {
  order: number;
  text: string;
  at: number;
}
export interface ScreenMessageRow extends ScreenMessage {
  x: number;
  y: number;
  alpha: number;
}
/** Six reused native slots: expired rows remain in place until rotated out, not reflowed each RAF. */
export function screenMessagePool() {
  let entries: ScreenMessage[] = [];
  return {
    put(entry: ScreenMessage) {
      entries = [...entries.filter((e) => e.order !== entry.order), entry]
        .sort((a, b) => a.order - b.order)
        .slice(-SCREEN_MESSAGES.count);
    },
    clear() {
      entries = [];
    },
    rows(now: number): ScreenMessageRow[] {
      return entries.map((entry, index) => ({
        ...entry,
        x: SCREEN_MESSAGES.x,
        y:
          SCREEN_MESSAGES.y +
          (SCREEN_MESSAGES.count - entries.length + index) * SCREEN_MESSAGES.height,
        alpha: nativeScreenAlpha(Math.trunc(now) - entry.at),
      }));
    },
  };
}
/** 461C50 centers the WZ264x132 frame; 52B8B0 controls; 52C4C0 text band.
 * Insets are canvas coordinates, not CSS spacing guesses or text wrapping limits. */
export const BASIC_DIALOG = {
  width: 264,
  height: 132,
  textLeft: 15,
  textWidth: 234,
  textTop: 43,
  textBandHeight: 43,
  lineHeight: 14,
  buttonY: 92,
  buttonWidth: 65,
  buttonHeight: 24,
  okX: 100,
  yesX: 59,
  noX: 140,
} as const;
/** CUtilDlg splits CRLF only (525880), centers font4/5 rows at 14px; it does not word-wrap. */
export function basicDialogLines(text: string) {
  return text.split("\r\n");
}
export function basicDialogTextY(lines: number) {
  return (
    Math.trunc((BASIC_DIALOG.textBandHeight - BASIC_DIALOG.lineHeight * lines) / 2) +
    BASIC_DIALOG.textTop
  );
}
