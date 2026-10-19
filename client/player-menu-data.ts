import type { UiPoint } from "./ui-types.ts";
export { partyState as playerMenuParty } from "./party-state.ts";
export type PlayerMenuAction = "info" | "fameUp" | "fameDown" | "whisper" | "trade" | "invite";
export interface PlayerMenuTarget {
  characterId: number;
  name: string;
}
export interface PlayerMenuRow {
  text: string;
  action?: PlayerMenuAction;
  enabled: boolean;
  reason?: string;
}
/** 52E050/52F0B0/52E780 + ORIGINAL UI/UIWindow.img/ContextMenu/{0,1,2,3}.
 * 0 top81x3; 1 title81x15; 2 ordinary81x15; 3 bottom89x18. The 81px pieces sit at x8.
 */
export const PLAYER_MENU = {
  path: "UI/UIWindow.img/ContextMenu/",
  width: 89,
  cap: 3,
  row: 15,
  bottom: 18,
  left: 12,
  right: 85,
  hitTop: 1,
  hitBottom: 14,
} as const;
export function playerMenuRows(
  name: string,
  leader: boolean,
  inviteVerified = true,
): PlayerMenuRow[] {
  return [
    { text: name, enabled: false },
    // Native id0 falls through 5128B0's switch. Browser policy makes that no-op visibly disabled.
    { text: "개인정보", action: "info", enabled: false, reason: "原版此選項未接處理分支" },
    { text: "인기도 +", action: "fameUp", enabled: true },
    { text: "인기도 -", action: "fameDown", enabled: true },
    { text: "귓속말", action: "whisper", enabled: true },
    { text: "교환신청", action: "trade", enabled: false, reason: "交易房的封包與介面尚未完成" },
    ...(leader
      ? [
          {
            text: "파티초대",
            action: "invite" as const,
            enabled: inviteVerified,
            ...(!inviteVerified
              ? { reason: "此附接世界尚未證實邀請身份保護，已停用以避免加入錯誤隊伍" }
              : {}),
          },
        ]
      : []),
  ];
}
export function playerMenuLayout(point: UiPoint, count: number) {
  const height = PLAYER_MENU.cap + PLAYER_MENU.bottom + Math.max(0, count - 1) * PLAYER_MENU.row;
  // Native 5128B0 anchors at (cursor.x, cursor.y-height). Clamping is browser reachability policy.
  return {
    x: Math.max(0, Math.min(800 - PLAYER_MENU.width, Math.round(point.x))),
    y: Math.max(0, Math.min(600 - height, Math.round(point.y) - height)),
    width: PLAYER_MENU.width,
    height,
  };
}
export function playerMenuRowRect(index: number) {
  return {
    x: PLAYER_MENU.left,
    y: PLAYER_MENU.cap + index * PLAYER_MENU.row + PLAYER_MENU.hitTop,
    width: PLAYER_MENU.right - PLAYER_MENU.left,
    height: PLAYER_MENU.hitBottom - PLAYER_MENU.hitTop,
  };
}
export function playerMenuRowAt(
  rows: readonly PlayerMenuRow[],
  point: UiPoint,
): number | undefined {
  const index = rows.findIndex((row, index) => {
    const rect = playerMenuRowRect(index);
    return (
      row.enabled &&
      point.x >= rect.x &&
      point.x < rect.x + rect.width &&
      point.y >= rect.y &&
      point.y < rect.y + rect.height
    );
  });
  return index < 0 ? undefined : index;
}
/** 51D6C0 -> CAvatar5085E0(a3=1): UNION of the two translated [-22,-65,22,0) rects.
 * Not sprite alpha/size/facing, and not a union of two separate hit tests (the gap also hits).
 */
export function playerContains(current: UiPoint, previous: UiPoint | undefined, point: UiPoint) {
  const old = previous ?? current;
  return (
    point.x >= Math.min(current.x, old.x) - 22 &&
    point.x < Math.max(current.x, old.x) + 22 &&
    point.y >= Math.min(current.y, old.y) - 65 &&
    point.y < Math.max(current.y, old.y)
  );
}
