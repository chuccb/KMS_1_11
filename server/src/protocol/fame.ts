/**
 * 人氣（인기도）：c2s `0x20` 與 s2c `0x12`。
 *
 * EVIDENCE (MapleStory.exe.c, FINDINGS 4.38)
 * -----------------------------------------------------------------------------
 * **送出**：`0x20` 只有一個送出者 `sub_55D7B0(CWvsApp, name, up)`，兩個呼叫點都是角色右鍵選單
 * （`sub_5478F0` 的 `인기도 +`／`인기도 -`，`n2 = 1`／`2`）。它先在自己的 `CUserPool` 裡找那個人
 * （**同一張圖**）、沒有就本地印「캐릭터를 찾을 수 없습니다」；通過 5 分鐘的本地冷卻
 * （`timeGetTime() - *(app+0x2AC) < 300000` →「잠시 후 다시 시도해 보세요」）才送出
 * `[0x20][u32 角色 id][u8 up]`（`up`：1 ＝ 올리기、0 ＝ 내리기）。冷卻與「找不到」都在 client，
 * 所以伺服器**不需要**重做它們 —— 但重做也不會錯（封包可以偽造）。
 *
 * **回包**：`0x12` 的處理函式是 `sub_55C390`，`u8 type` 之後：
 *
 * | type | payload | client 顯示 |
 * |---|---|---|
 * | `0` | `str name` + `u8 up` | 「'%s'님의 인기도를 내렸습니다.」／「…올려주었습니다.」（**給送出者**）|
 * | `1` | — | **什麼都不顯示**（`break`）|
 * | `2` | — | 「초보자는 인기도를 올리거나 내리지 못합니다.」|
 * | `3` | — | 「오늘은 더 이상 인기도를 올리거나 내리지 못합니다.」|
 * | `4` | — | 「이번 달에는 더 이상 지정된 캐릭터의 인기도를 올리거나 내리지 못합니다.」|
 * | `5` | `str name` + `u8 up` | 「'%s'님께서 '%s'님의 인기도를 …」（**給被給的人**，第二個名字是收件者自己）|
 * | 其他 | — | 「알 수 없는 오류로 인기도를 올리거나 내리지 못했습니다.」|
 *
 * 注意 `type 5` 的第二個名字：處理函式讀的是 `*(CWvsApp + 36) + 4`（本機角色的名字，§4.37.4），
 * **不是封包裡的欄位** —— 所以 `0x12` 的兩個字串型別都只有一個名字是由伺服器給的。
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** 兩個方向的號碼。 */
export const FAME_OPCODE = {
  /** c2s：`sub_4A1EA0(&buf, 32, 0)`，送出者是 `sub_55D7B0`。 */
  request: 0x20,
  /** s2c：`sub_55C390`（`CWvsApp` 層，`sub_55A900` case 18）。 */
  result: 0x12,
} as const;

/** `0x12` 的 `type`，只列 `sub_55C390` 有 case 的。 */
export const FAME_RESULT_TYPE = {
  changed: 0,
  ignored: 1,
  beginner: 2,
  alreadyToday: 3,
  alreadyThisMonth: 4,
  received: 5,
} as const;

/** 一個 `0x20`：對誰、往上還是往下。 */
export interface ClientFameRequest {
  targetId: number;
  up: boolean;
}

/** 讀一個 `0x20`（不含 opcode）。 */
export function readClientFameRequest(reader: PacketReader): ClientFameRequest {
  const targetId = reader.readU32();
  const up = reader.readByte() !== 0;
  return { targetId, up };
}

/** 寫一個 `0x20`（測試與 `capture` 重播用）。 */
export function encodeClientFameRequest(request: ClientFameRequest): Uint8Array {
  return new PacketWriter()
    .writeByte(FAME_OPCODE.request)
    .writeU32(request.targetId)
    .writeByte(request.up ? 1 : 0)
    .toBytes();
}

/** 給日誌與 `decode` 的一行。 */
export function describeClientFameRequest(request: ClientFameRequest): string {
  return `0x20 fame: ${request.up ? "up" : "down"} ${request.targetId}`;
}

/** `0x12` 的一個結果。 */
export type FameResult =
  /** 給送出者：動作成功（`name` 是被給的人）。 */
  | { kind: "changed"; name: string; up: boolean }
  /** 什麼都不顯示（`type 1`）：我們的「忽略」——目標不在這張圖、或自己給自己。 */
  | { kind: "ignored" }
  | { kind: "beginner" }
  | { kind: "alreadyToday" }
  | { kind: "alreadyThisMonth" }
  /** 給被給的人（`name` 是給的人；第二個名字由 client 自己補）。 */
  | { kind: "received"; name: string; up: boolean };

/** 寫一個 `0x12`。 */
export function encodeFameResult(result: FameResult): Uint8Array {
  const writer = new PacketWriter().writeByte(FAME_OPCODE.result);
  switch (result.kind) {
    case "changed":
      return writer.writeByte(FAME_RESULT_TYPE.changed).writeAsciiString(result.name).writeByte(result.up ? 1 : 0).toBytes();
    case "ignored":
      return writer.writeByte(FAME_RESULT_TYPE.ignored).toBytes();
    case "beginner":
      return writer.writeByte(FAME_RESULT_TYPE.beginner).toBytes();
    case "alreadyToday":
      return writer.writeByte(FAME_RESULT_TYPE.alreadyToday).toBytes();
    case "alreadyThisMonth":
      return writer.writeByte(FAME_RESULT_TYPE.alreadyThisMonth).toBytes();
    case "received":
      return writer.writeByte(FAME_RESULT_TYPE.received).writeAsciiString(result.name).writeByte(result.up ? 1 : 0).toBytes();
  }
}

/**
 * 讀一個 `0x12`（不含 opcode）。`type 1`（什麼都不顯示）與未知 type 分開：前者是 client 的
 * 一個 case，後者走 default 的錯誤訊息。
 */
export function readFameResult(reader: PacketReader): FameResult {
  const type = reader.readByte();
  switch (type) {
    case FAME_RESULT_TYPE.changed:
      return { kind: "changed", name: reader.readAsciiString(), up: reader.readByte() !== 0 };
    case FAME_RESULT_TYPE.ignored:
      return { kind: "ignored" };
    case FAME_RESULT_TYPE.beginner:
      return { kind: "beginner" };
    case FAME_RESULT_TYPE.alreadyToday:
      return { kind: "alreadyToday" };
    case FAME_RESULT_TYPE.alreadyThisMonth:
      return { kind: "alreadyThisMonth" };
    case FAME_RESULT_TYPE.received:
      return { kind: "received", name: reader.readAsciiString(), up: reader.readByte() !== 0 };
    default:
      throw new RangeError(`0x12 type 0x${type.toString(16)} is not a fame result (0x00-0x05)`);
  }
}

/** 給日誌與 `decode` 的一行。 */
export function describeFameResult(result: FameResult): string {
  switch (result.kind) {
    case "changed":
      return `0x12 fame: ${result.name} ${result.up ? "up" : "down"}`;
    case "received":
      return `0x12 fame: ${result.name} ${result.up ? "up" : "down"} (someone famed you)`;
    default:
      return `0x12 fame: ${result.kind}`;
  }
}
