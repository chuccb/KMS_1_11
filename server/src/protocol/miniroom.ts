/**
 * 小房間（miniroom）：c2s `0x25` 與 s2c `0x50`。1:1 교환（交易）是第一個實作的房間種類。
 *
 * EVIDENCE (MapleStory.exe.c，FINDINGS 4.39／4.40)
 * -----------------------------------------------------------------------------
 * **兩個方向共用同一個 type 空間**，但方向不同：`0x25` 是 client 送出的請求、`0x50` 是伺服器的回包。
 * `0x25` 不是交易專用——`objdump` 只找到七個送出點，其中四個在 `CTradingRoomDlg`（`0x4D31F0`、
 * `0x4D5C80`、`0x4D5F50`、`0x4D61F0`），另外三個是 `/교환`（`sub_471A40`）、
 * `CMiniRoomBaseDlg` 的「按是」（`sub_481910`）與「用名字邀請」（`sub_4820E0`）。
 *
 * **`0x25`（c2s）**
 *
 * | type | payload | 誰送 | 意義 |
 * |---|---|---|---|
 * | `0` | `u8 roomKind` + `u32 targetId` | `/교환`（`sub_471A40`，`.text:00471b17`）| 用角色 id 邀請；`roomKind` 的唯一寫入者是字面 `1`（＝交易，跟 s2c `type 4` 的第一個 byte 同一個值）|
 * | `3` | `u32 inviterId` | 邀請的模態對話框按「是」（`sub_481910`，`.text:00481a2a`）| 接受；u32 是 `type 1` 帶回來的那一個 |
 * | `5` | `str name` | `sub_4820E0`（`.text:00482xxx` 的 `*(…)=5`）| 用**名字**邀請（`CMiniRoomBaseDlg` 的共用helper；`sub_45C5E0` 先找名字）|
 * | `7` | — | 關窗／취소（`sub_4D31F0`，參數 2）| 離開房間 |
 * | `11` | `u8 tab` + `u16 slot` + （`tab != 1` 時）`u16 count` + `u8 roomSlot` | 把道具放上交易格（`sub_4D5C80`）| **不含道具本體**：伺服器自己從庫存查 |
 * | `12` | `u32 mesos` | 金額輸入框（`sub_4D5F50`）| 放錢 |
 * | `13` | — | 「정말로 교환하시겠습니까?」按「是」（`sub_4D61F0`）| 確認 |
 *
 * `type 11` 的 `tab` 就是庫存的 1..4（**1 = 裝備**），所以 `tab == 1` 時沒有 count——裝備不可堆疊。
 * `roomSlot` 是 1..8（`sub_4D63C0` 回傳的 y；`sub_4D5C80` 對 `y <= 0` 直接放棄）。
 *
 * **`0x50`（s2c）**，`sub_4815E0` 先讀 `u8 type`，再依「有沒有開著的房間視窗」分派：
 *
 * | type | payload | 分派 | 意義 |
 * |---|---|---|---|
 * | `1` | `str inviterName` + `u32 inviterId` | `sub_481910` | 有人邀請你；模態「'%s'님께서 1:1 교환을 요청하였습니다」|
 * | `2` | `u8 code`（`2` 再加 `str name`）| `sub_481B20` | 邀請的結果：`0` 成功（無訊息）、`1`「캐릭터를 찾을 수 없습니다」、`2`「'%s'님은 다른 일을 하는 중입니다」|
 * | `3` | `u8 index` + 參與者 | `sub_481E00` | 房間裡多一個人（該格必須是空的）|
 * | `4` | `u8 roomKind` + `u8 count` + `u8 myIndex` + `n × (u8 index + 參與者)` + `u8 >= 0x80` | `sub_481790`→`sub_481D00` | **進房間**；`roomKind` 必須是 `1`（`sub_481570` 只認 1，其他回 null ⇒ client 丟 `AVCDisconnectException`）|
 * | `5` | `u8` + `str text` | vtable slot 15（`sub_4D3BD0`）| 視窗裡的系統訊息 |
 * | `6` | `u8 index` + 參與者 | `sub_481EB0` | 更新某一格（跟 `type 3` 同形狀）|
 * | `7` | — | vtable slot 16（`0x481460`，`ret 4`）| **no-op** |
 * | `8` | `u8 code` | vtable slot 17（`sub_4D3D70`）| 結束：`1`「상대방이 교환을 취소했습니다」、`3`「교환이 성사되었습니다」、`4`「교환에 실패하였습니다」；並關窗 |
 * | `11` | `u8 index` + `u8 roomSlot` + **道具** | slot 18（`sub_4D3360` case 11 = `sub_4D3950`）| 某一格放上了道具 |
 * | `12` | `u8 index` + `u32 mesos` | slot 18 case 12（`sub_4D3B30`）| 某一邊的錢 |
 * | `13` | — | slot 18 case 13（`sub_4D3BB0`）| 鎖定（`this+256 = 1`）|
 *
 * **參與者**（`sub_482340`）：`u8 A` + `u32 B` + `u32…`（以 0 結尾的外觀清單）+ `str name`。
 *
 * - 外觀清單就是 `0x1C` 的清單：**頭髮在最前面**，然後是穿在身上的裝備（`sub_45F340` 依 id 自己分類）。
 * - `B` 是**臉**：`sub_45F340` 把 3xxxx（頭髮）放進 `src[0]`、把 101xxxx（臉部裝飾）抽出來另外回傳，
 *   2xxxx（臉）則整個被丟掉——所以臉只能從封包的另一個欄位進來，而 `sub_424590(obj, A, B)` 正好只
 *   設兩個值（`obj+8`／`obj+12`，`+16` 之後才是 15 個字的外觀）。
 * - `A` 是唯一還沒定位的欄位：它被 `sub_423EC0` 拿去建兩個文字標籤（`sub_421E00` 的第二個參數就是它），
 *   所以是一個**要顯示的數字**。我們送**等級**，並在 FINDINGS §4.40 標成 🟡（推論，不是讀出來的）。
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import { readItemSlot, writeItemSlot, type ItemSlot } from "./itemslot.ts";
import {
  MINIROOM_BUSY_REFUSAL_CODE,
  MINIROOM_TRADE_KIND,
  TRADE_SLOTS,
} from "../../../client/trade-constants.ts";
export { TRADE_SLOTS } from "../../../client/trade-constants.ts";

/** 兩個方向的號碼。 */
export const MINIROOM_OPCODE = {
  /** c2s：`sub_4A1EA0(..., 37, 0)`。 */
  request: 0x25,
  /** s2c：`CWvsApp` 層的 `sub_4815E0`。 */
  result: 0x50,
} as const;

/** s2c `type 4`／c2s `type 0`: the sole implemented 1:1 trade room kind. */
export const MINIROOM_KIND = { trade: MINIROOM_TRADE_KIND } as const;

/** `0x25` 的 type。 */
export const MINIROOM_REQUEST_TYPE = {
  invite: 0,
  accept: 3,
  inviteByName: 5,
  leave: 7,
  offerItem: 11,
  offerMesos: 12,
  confirm: 13,
} as const;

/** `0x50` 的 type。 */
export const MINIROOM_RESULT_TYPE = {
  invite: 1,
  refused: 2,
  participant: 3,
  enter: 4,
  message: 5,
  update: 6,
  ready: 7,
  finish: 8,
  item: 11,
  mesos: 12,
  lock: 13,
} as const;

/** `type 2` 的拒絕碼。 */
export const MINIROOM_REFUSAL = {
  /** 0＝成功，什麼都不顯示（`sub_481B20` 的 `if (n2 != 0)` 之外）。 */
  ok: 0,
  /** 「캐릭터를 찾을 수 없습니다」 */
  notFound: 1,
  /** 「'%s'님은 다른 일을 하는 중입니다」 */
  busy: MINIROOM_BUSY_REFUSAL_CODE,
} as const;

/** `type 8` 的結束碼。 */
export const TRADE_FINISH = {
  cancelled: 1,
  done: 3,
  failed: 4,
} as const;

/** c2s `0x25` 進來的一個請求。 */
export type ClientMiniRoomRequest =
  /** `/교환`：`roomKind` 唯一的值是 `1`。 */
  | { kind: "invite"; roomKind: number; targetId: number }
  | { kind: "accept"; inviterId: number }
  | { kind: "inviteByName"; name: string }
  | { kind: "leave" }
  /** `count` 只在 `tab != 1` 時在封包裡（`null` ＝裝備）。 */
  | { kind: "offerItem"; tab: number; slot: number; count: number | null; roomSlot: number }
  | { kind: "offerMesos"; amount: number }
  | { kind: "confirm" };

/** 讀一個 `0x25`（不含 opcode）。未知的 type 會丟 `RangeError`——client 不會送，送了就是壞掉的封包。 */
export function readClientMiniRoomRequest(reader: PacketReader): ClientMiniRoomRequest {
  const kind = reader.readByte();
  switch (kind) {
    case MINIROOM_REQUEST_TYPE.invite:
      return { kind: "invite", roomKind: reader.readByte(), targetId: reader.readU32() };
    case MINIROOM_REQUEST_TYPE.accept:
      return { kind: "accept", inviterId: reader.readU32() };
    case MINIROOM_REQUEST_TYPE.inviteByName:
      return { kind: "inviteByName", name: reader.readAsciiString() };
    case MINIROOM_REQUEST_TYPE.leave:
      return { kind: "leave" };
    case MINIROOM_REQUEST_TYPE.offerItem: {
      const tab = reader.readByte();
      const slot = reader.readU16();
      const count = tab === 1 ? null : reader.readU16();
      const roomSlot = reader.readByte();
      return { kind: "offerItem", tab, slot, count, roomSlot };
    }
    case MINIROOM_REQUEST_TYPE.offerMesos:
      return { kind: "offerMesos", amount: reader.readU32() };
    case MINIROOM_REQUEST_TYPE.confirm:
      return { kind: "confirm" };
    default:
      throw new RangeError(`0x25 type 0x${kind.toString(16)} is not a miniroom request`);
  }
}

/** 寫一個 `0x25`（測試與重播用）。 */
export function encodeClientMiniRoomRequest(request: ClientMiniRoomRequest): Uint8Array {
  const writer = new PacketWriter().writeByte(MINIROOM_OPCODE.request);
  switch (request.kind) {
    case "invite":
      return writer
        .writeByte(MINIROOM_REQUEST_TYPE.invite)
        .writeByte(request.roomKind)
        .writeU32(request.targetId >>> 0)
        .toBytes();
    case "accept":
      return writer
        .writeByte(MINIROOM_REQUEST_TYPE.accept)
        .writeU32(request.inviterId >>> 0)
        .toBytes();
    case "inviteByName":
      return writer
        .writeByte(MINIROOM_REQUEST_TYPE.inviteByName)
        .writeAsciiString(request.name)
        .toBytes();
    case "leave":
      return writer.writeByte(MINIROOM_REQUEST_TYPE.leave).toBytes();
    case "offerItem":
      writer
        .writeByte(MINIROOM_REQUEST_TYPE.offerItem)
        .writeByte(request.tab)
        .writeU16(request.slot & 0xffff);
      if (request.tab !== 1) writer.writeU16((request.count ?? 1) & 0xffff);
      return writer.writeByte(request.roomSlot).toBytes();
    case "offerMesos":
      return writer
        .writeByte(MINIROOM_REQUEST_TYPE.offerMesos)
        .writeU32(request.amount >>> 0)
        .toBytes();
    case "confirm":
      return writer.writeByte(MINIROOM_REQUEST_TYPE.confirm).toBytes();
  }
}

/** 給日誌與 `decode` 的一行。 */
export function describeClientMiniRoomRequest(request: ClientMiniRoomRequest): string {
  switch (request.kind) {
    case "invite":
      return `0x25 miniroom: invite target=${request.targetId} kind=${request.roomKind}`;
    case "accept":
      return `0x25 miniroom: accept inviter=${request.inviterId}`;
    case "inviteByName":
      return `0x25 miniroom: invite name="${request.name}"`;
    case "leave":
      return "0x25 miniroom: leave";
    case "offerItem":
      return `0x25 miniroom: offer item tab=${request.tab} slot=${request.slot} count=${request.count ?? "-"} roomSlot=${request.roomSlot}`;
    case "offerMesos":
      return `0x25 miniroom: offer ${request.amount} mesos`;
    case "confirm":
      return "0x25 miniroom: confirm";
  }
}

/** 一個參與者，也就是 `type 3`／`type 4` 裡的一段。 */
export interface MiniRoomParticipant {
  /** 0 或 1：房間裡的格子。 */
  index: number;
  name: string;
  /** 臉（`CharacterData.appearanceA`）；`sub_424590` 的參數，寫進 `CUser+68`（§4.11.3c）。 */
  face: number;
  /** `0x1C` 的外觀清單：頭髮在最前面，以 0 結尾（寫入時補上）。 */
  look: readonly number[];
  /** 封包第一個 byte；見檔頭（🟡 推論為等級）。 */
  level: number;
}

function writeParticipant(writer: PacketWriter, participant: MiniRoomParticipant): void {
  writer.writeByte(participant.level & 0xff);
  writer.writeU32(participant.face >>> 0);
  for (const itemId of participant.look) writer.writeU32(itemId >>> 0);
  writer.writeU32(0);
  writer.writeAsciiString(participant.name);
}

function resultWriter(type: number): PacketWriter {
  return new PacketWriter().writeByte(MINIROOM_OPCODE.result).writeByte(type);
}

/** `type 1`：邀請。 */
export function encodeMiniRoomInvite(invite: {
  inviterId: number;
  inviterName: string;
}): Uint8Array {
  return resultWriter(MINIROOM_RESULT_TYPE.invite)
    .writeAsciiString(invite.inviterName)
    .writeU32(invite.inviterId >>> 0)
    .toBytes();
}

/** `type 2`：邀請的結果。`busy` 帶對方的名字，另外兩個不帶。 */
export function encodeMiniRoomRefused(refusal: { code: number; name?: string }): Uint8Array {
  const writer = resultWriter(MINIROOM_RESULT_TYPE.refused).writeByte(refusal.code);
  if (refusal.code === MINIROOM_REFUSAL.busy && refusal.name !== undefined) {
    writer.writeAsciiString(refusal.name);
  }
  return writer.toBytes();
}

/** `type 3`／`type 6`：房間裡的一格。 */
export function encodeMiniRoomParticipant(participant: MiniRoomParticipant): Uint8Array {
  const writer = resultWriter(MINIROOM_RESULT_TYPE.participant).writeByte(participant.index);
  writeParticipant(writer, participant);
  return writer.toBytes();
}

/**
 * `type 4`：進房間。
 *
 * `sub_481D00` 的讀法：`u8 count`（`this+92`）、`u8 myIndex`（`this+88`）、然後
 * **`u8 index` + 參與者** 一直重複到某個 byte 的最高位是 1 為止（`pExceptionObject_2 < 0` 就 break）。
 * 我們用 `0xff` 當結束字元——client 只檢查符號位，值本身丟掉。
 */
export function encodeMiniRoomEnter(enter: {
  roomKind: number;
  myIndex: number;
  participants: readonly MiniRoomParticipant[];
}): Uint8Array {
  const writer = resultWriter(MINIROOM_RESULT_TYPE.enter)
    .writeByte(enter.roomKind)
    .writeByte(enter.participants.length)
    .writeByte(enter.myIndex);
  for (const participant of enter.participants) {
    writer.writeByte(participant.index);
    writeParticipant(writer, participant);
  }
  return writer.writeByte(0xff).toBytes();
}

/** `type 5`：視窗裡的系統訊息（第一個 byte 被 client 跳過）。 */
export function encodeMiniRoomMessage(text: string): Uint8Array {
  return resultWriter(MINIROOM_RESULT_TYPE.message).writeByte(0).writeAsciiString(text).toBytes();
}

/** `type 8`：結束（會關窗）。 */
export function encodeMiniRoomFinish(code: number): Uint8Array {
  return resultWriter(MINIROOM_RESULT_TYPE.finish).writeByte(code).toBytes();
}

/** `type 11`：某一格放上了道具。`sub_45E6A0` 用 0 當第三個參數，所以**類別 byte 在線上**。 */
export function encodeMiniRoomItem(update: {
  index: number;
  roomSlot: number;
  item: ItemSlot;
}): Uint8Array {
  if (update.roomSlot < 1 || update.roomSlot > TRADE_SLOTS) {
    throw new RangeError(
      `trade slot ${update.roomSlot} is outside the client's 1..${TRADE_SLOTS} (sub_4D63C0)`,
    );
  }
  const writer = resultWriter(MINIROOM_RESULT_TYPE.item)
    .writeByte(update.index)
    .writeByte(update.roomSlot);
  writeItemSlot(writer, update.item, 0);
  return writer.toBytes();
}

/** `type 12`：某一邊的錢。 */
export function encodeMiniRoomMesos(update: { index: number; amount: number }): Uint8Array {
  return resultWriter(MINIROOM_RESULT_TYPE.mesos)
    .writeByte(update.index)
    .writeU32(update.amount >>> 0)
    .toBytes();
}

/** `type 13`：鎖定（沒有 payload）。 */
export function encodeMiniRoomLock(): Uint8Array {
  return resultWriter(MINIROOM_RESULT_TYPE.lock).toBytes();
}

function readParticipant(reader: PacketReader, index: number): MiniRoomParticipant {
  const level = reader.readByte();
  const face = reader.readU32();
  const look: number[] = [];
  for (;;) {
    const itemId = reader.readU32();
    if (itemId === 0) break;
    look.push(itemId);
  }
  return { index, name: reader.readAsciiString(), face, look, level };
}

/** 一個 `0x50`，讀回來的樣子（測試、`decode` 與 probe 用）。 */
export type MiniRoomEvent =
  | { kind: "invite"; inviterId: number; inviterName: string }
  | { kind: "refused"; code: number; name?: string }
  | { kind: "participant"; participant: MiniRoomParticipant }
  | { kind: "enter"; roomKind: number; myIndex: number; participants: MiniRoomParticipant[] }
  | { kind: "message"; text: string }
  | { kind: "finish"; code: number }
  | { kind: "item"; index: number; roomSlot: number; item: ItemSlot }
  | { kind: "mesos"; index: number; amount: number }
  | { kind: "lock" }
  /** `type 7`：`sub_4815E0` 的 vtable+16 是 `nullsub_58`——一個不帶內容、什麼都不做的 type。 */
  | { kind: "ready" };

/** 讀一個 `0x50`（不含 opcode）。`7` 讀得出來但沒有內容：native 對它甚麼都不做。 */
export function readMiniRoomResult(reader: PacketReader): MiniRoomEvent {
  const type = reader.readByte();
  switch (type) {
    case MINIROOM_RESULT_TYPE.ready:
      return { kind: "ready" };
    case MINIROOM_RESULT_TYPE.invite: {
      const inviterName = reader.readAsciiString();
      return { kind: "invite", inviterName, inviterId: reader.readU32() };
    }
    case MINIROOM_RESULT_TYPE.refused: {
      const code = reader.readByte();
      return code === MINIROOM_REFUSAL.busy
        ? { kind: "refused", code, name: reader.readAsciiString() }
        : { kind: "refused", code };
    }
    case MINIROOM_RESULT_TYPE.participant:
    case MINIROOM_RESULT_TYPE.update: {
      const index = reader.readByte();
      return { kind: "participant", participant: readParticipant(reader, index) };
    }
    case MINIROOM_RESULT_TYPE.enter: {
      const roomKind = reader.readByte();
      const count = reader.readByte();
      const myIndex = reader.readByte();
      const participants: MiniRoomParticipant[] = [];
      while (reader.remaining > 0) {
        const index = reader.readByte();
        if (index >= 0x80) break;
        participants.push(readParticipant(reader, index));
      }
      if (participants.length !== count) {
        throw new RangeError(
          `type 4 announced ${count} participant(s) but carried ${participants.length}`,
        );
      }
      return { kind: "enter", roomKind, myIndex, participants };
    }
    case MINIROOM_RESULT_TYPE.message:
      reader.readByte();
      return { kind: "message", text: reader.readAsciiString() };
    case MINIROOM_RESULT_TYPE.finish:
      return { kind: "finish", code: reader.readByte() };
    case MINIROOM_RESULT_TYPE.item: {
      const index = reader.readByte();
      const roomSlot = reader.readByte();
      return { kind: "item", index, roomSlot, item: readItemSlot(reader, 0) };
    }
    case MINIROOM_RESULT_TYPE.mesos:
      return { kind: "mesos", index: reader.readByte(), amount: reader.readU32() };
    case MINIROOM_RESULT_TYPE.lock:
      return { kind: "lock" };
    default:
      throw new RangeError(`0x50 type 0x${type.toString(16)} is not a known miniroom result`);
  }
}

/** 給日誌與 `decode` 的一行。 */
export function describeMiniRoomResult(event: MiniRoomEvent): string {
  switch (event.kind) {
    case "invite":
      return `0x50 miniroom: invite from "${event.inviterName}" (${event.inviterId})`;
    case "refused":
      return `0x50 miniroom: refused code=${event.code}${event.name === undefined ? "" : ` name="${event.name}"`}`;
    case "participant":
      return `0x50 miniroom: participant ${event.participant.index} "${event.participant.name}"`;
    case "enter":
      return `0x50 miniroom: enter kind=${event.roomKind} me=${event.myIndex} [${event.participants
        .map((participant) => `"${participant.name}"`)
        .join(", ")}]`;
    case "message":
      return `0x50 miniroom: message "${event.text}"`;
    case "finish":
      return `0x50 miniroom: finish code=${event.code}`;
    case "item":
      return `0x50 miniroom: side ${event.index} slot ${event.roomSlot} <- item ${event.item.itemId}`;
    case "mesos":
      return `0x50 miniroom: side ${event.index} ${event.amount} mesos`;
    case "lock":
      return "0x50 miniroom: lock";
    case "ready":
      return "0x50 miniroom: ready (no-op)";
  }
}
