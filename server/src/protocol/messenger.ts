/**
 * 메신저（messenger）：c2s `0x24` 與 s2c `0x4D`／`0x4E`／`0x4F`。
 *
 * EVIDENCE (MapleStory.exe.c / .lst, FINDINGS 4.41)
 * -----------------------------------------------------------------------------
 * 2003 的「메신저」不是好友名單，而是**三人聊天室**（대화방）：視窗一打開就印出
 * 「초대 : /초대 캐릭터이름」「종료 : /q」，成員格子是 3 格——`sub_4DF3E0` 的第一行就是
 * `if ((unsigned int)slot <= 2)`，每一格 100 bytes（`this + 25 * slot + 31`）。
 *
 * **兩個方向是兩個不同的 opcode**：client 送 `0x24`（六個送出點，全部在 `CUIMessenger`：
 * `sub_4DDFE0` 的 type 0、`sub_4DE280` 的 type 2、`sub_4E24B0` 的 type 3、`sub_4DE490` 的 type 5），
 * 伺服器送 `0x4D`–`0x4F`（三個 opcode 都交給 `sub_4E18D0`，所以它讀的是 `u8 type`，opcode 本身
 * 不帶語意；本伺服器固定用 `0x4D`）。
 *
 * **`0x24`（c2s）**
 *
 * | type | payload | 意義 | 送出點 |
 * |---|---|---|---|
 * | `0` | `u32 roomId` | 開房間／進房間；`0` ＝ 開一個新的 | `sub_4DDFE0`（視窗建立時；邀請的「是」也是走這條，見下）|
 * | `2` | — | 關掉視窗（離開房間）| `sub_4DE280` |
 * | `3` | `str` | `/` 開頭的文字（`/q` 由 client 自己吃掉）| `sub_4E24B0` |
 * | `5` | `str` | 一般聊天 | `sub_4DE490` |
 *
 * **`0x4D`（s2c）**——`sub_4E18D0` 先讀 `u8 type`，再交給：
 *
 * | type | 去哪裡 | payload | 畫面 |
 * |---|---|---|---|
 * | `0` | `sub_4DF1D0` | `u8 room` ＋ `u8 slot` ＋ `u32 face` ＋ 外觀清單（`u32`…`0`）＋ `str name` ＋ `u8 announce` | 一格成員；`announce != 0` 時印「- '%s'님이 입장하셨습니다」|
 * | `1` | `sub_4DF620` | `u8 code` | 「- 초청 받은 대화방에 참가하지 못했습니다」|
 * | `2` | `sub_4DF8B0` | `u8 slot` | 「- '%s'님이 퇴장하셨습니다」（名字取自那一格）|
 * | `3` | `sub_4E1BB0` | `str inviterName` ＋ `u32 roomId` | 模態：「'%s'님께서 대화방 초청 메시지를 보냈습니다…」（按「是」→ 用那個 `u32` 走 `0x24 type 0`）|
 * | `4` | `sub_4E19A0` | `str name` ＋ `u8 ok` | 「- '%s'님에게 초청 메시지를 보냈습니다」／「- '%s'님을 찾지 못했습니다」（`ok == 0` 是找不到）|
 * | `5` | `sub_4E1E30` | `str line` | 一行聊天；**字串裡自己帶「說話者 : 內容」**（`strstr(line, " : ")` 就是它在拆名字）|
 * | `6` | `sub_4E2170` | `u8` ＋ `u8` | 未讀（本伺服器不送）|
 * | `7` | `sub_4E2280` | 未讀 | 未讀（本伺服器不送）|
 *
 * 成員紀錄是 `[u8 room][u8 slot][u32][外觀…0][str name][u8 announce]`：`sub_4DF1D0` 一個 byte
 * 一個 byte 讀，`sub_4DF3E0` 把它寫進 `this + 25 * room + 31`（`v9[6] = slot`、`v9[7] = u32`），
 * 外觀由 `sub_45F340`（`0x1C`／交易同一個讀取器）讀成 15 格，並把第 2 格（`101xxxx` 臉飾）
 * **抽出來**另存（`v9[8]`）。所以那個 `u32` 不是「臉」——臉已經在外觀清單裡了。🟡 這裡送的是
 * **角色 id**（`0x4D type 3` 的 `u32` 就是同一個東西：client 的「是」會原封不動送回來）。
 *
 * `0x4E`／`0x4F` 走同一個 handler，本伺服器不用它們（封包沒有辦法分辨三者，所以固定送 `0x4D`）。
 */
import { PacketReader, PacketWriter } from "./packet.ts";

export const MESSENGER_OPCODE = {
  /** c2s：`sub_4A1EA0(..., 36, 0)` 的 36。 */
  request: 0x24,
  /** s2c：`sub_4E18D0`（`0x4D`／`0x4E`／`0x4F` 都指向它，這裡固定用第一個）。 */
  result: 0x4d,
} as const;

/** `sub_4DF3E0` 只認 `slot <= 2`。 */
export const MESSENGER_ROOM_SIZE = 3;

/** c2s `0x24` 的 type。 */
export const MESSENGER_REQUEST_TYPE = {
  enter: 0,
  leave: 2,
  command: 3,
  chat: 5,
} as const;

/** s2c `0x4D` 的 type。 */
export const MESSENGER_RESULT_TYPE = {
  participant: 0,
  joinFailed: 1,
  left: 2,
  invite: 3,
  inviteResult: 4,
  chat: 5,
} as const;

/** `type 4` 的 `ok`：找不到人時是 0。 */
export const MESSENGER_INVITE_RESULT = { notFound: 0, sent: 1 } as const;

/** c2s `0x24` 進來的一個請求。 */
export type ClientMessengerRequest =
  /** `roomId == 0` ＝ 開一個新的房間。 */
  | { kind: "enter"; roomId: number }
  | { kind: "leave" }
  /** `/` 開頭的文字（`/q` 不會送到這裡，client 自己吃掉）。 */
  | { kind: "command"; text: string }
  | { kind: "chat"; text: string };

/** 讀一個 `0x24`（不含 opcode）。未知的 type 丟 `RangeError`。 */
export function readClientMessengerRequest(reader: PacketReader): ClientMessengerRequest {
  const type = reader.readByte();
  switch (type) {
    case MESSENGER_REQUEST_TYPE.enter:
      return { kind: "enter", roomId: reader.readU32() };
    case MESSENGER_REQUEST_TYPE.leave:
      return { kind: "leave" };
    case MESSENGER_REQUEST_TYPE.command:
      return { kind: "command", text: reader.readAsciiString() };
    case MESSENGER_REQUEST_TYPE.chat:
      return { kind: "chat", text: reader.readAsciiString() };
    default:
      throw new RangeError(`0x24 type 0x${type.toString(16)} is not a messenger request`);
  }
}

/** 寫一個 `0x24`（測試與重播用）。 */
export function encodeClientMessengerRequest(request: ClientMessengerRequest): Uint8Array {
  const writer = new PacketWriter().writeByte(MESSENGER_OPCODE.request);
  switch (request.kind) {
    case "enter":
      return writer.writeByte(MESSENGER_REQUEST_TYPE.enter).writeU32(request.roomId >>> 0).toBytes();
    case "leave":
      return writer.writeByte(MESSENGER_REQUEST_TYPE.leave).toBytes();
    case "command":
      return writer.writeByte(MESSENGER_REQUEST_TYPE.command).writeAsciiString(request.text).toBytes();
    case "chat":
      return writer.writeByte(MESSENGER_REQUEST_TYPE.chat).writeAsciiString(request.text).toBytes();
  }
}

/** 給日誌與 `decode` 的一行。 */
export function describeClientMessengerRequest(request: ClientMessengerRequest): string {
  switch (request.kind) {
    case "enter":
      return `0x24 messenger: enter room=${request.roomId}`;
    case "leave":
      return "0x24 messenger: leave";
    case "command":
      return `0x24 messenger: command "${request.text}"`;
    case "chat":
      return `0x24 messenger: chat "${request.text}"`;
  }
}

/** 房間裡的一格。 */
export interface MessengerParticipant {
  /** client 的三個房間之一（`this + 25 * room + 31`）；本伺服器一次只開一間，永遠送 0。 */
  room: number;
  /** 0..2（`sub_4DF3E0` 的上限）。 */
  slot: number;
  name: string;
  /** 臉（`CharacterData.appearanceA`）：`sub_4DF3E0` 把它存進 `v9[7]`，與 `0x1C` 的第一個 `u32` 同一個值。 */
  face: number;
  /** `0x1C` 的外觀清單：頭髮在最前面，寫入時自動補結尾的 0。 */
  look: readonly number[];
}

function resultWriter(type: number): PacketWriter {
  return new PacketWriter().writeByte(MESSENGER_OPCODE.result).writeByte(type);
}

/**
 * `type 0`：房間裡的一格。
 *
 * `announce` 是紀錄的最後一個 byte：非 0 時 client 印「- '%s'님이 입장하셨습니다」
 * （`sub_4DF3E0` 的 `if (a8 != 0)` → `sub_4389B0(&pv, aSI_0)`）。所以「剛進來」送 1、
 * 「只是更新」送 0。
 */
export function encodeMessengerParticipant(
  participant: MessengerParticipant,
  announce: boolean,
): Uint8Array {
  if (participant.slot < 0 || participant.slot >= MESSENGER_ROOM_SIZE) {
    throw new RangeError(`messenger slot ${participant.slot} is outside the client's 0..2`);
  }
  if (participant.room < 0 || participant.room >= MESSENGER_ROOM_SIZE) {
    throw new RangeError(`messenger room ${participant.room} is outside the client's 0..2`);
  }
  const writer = resultWriter(MESSENGER_RESULT_TYPE.participant)
    .writeByte(participant.room)
    .writeByte(participant.slot)
    .writeU32(participant.face >>> 0);
  for (const itemId of participant.look) writer.writeU32(itemId >>> 0);
  return writer
    .writeU32(0)
    .writeAsciiString(participant.name)
    .writeByte(announce ? 1 : 0)
    .toBytes();
}

/** `type 1`：進不去（`code` 只被印出來，沒有其他語意）。 */
export function encodeMessengerJoinFailed(code = 1): Uint8Array {
  return resultWriter(MESSENGER_RESULT_TYPE.joinFailed).writeByte(code).toBytes();
}

/** `type 2`：某一格離開（名字由 client 從那一格取）。 */
export function encodeMessengerLeft(slot: number): Uint8Array {
  if (slot < 0 || slot >= MESSENGER_ROOM_SIZE) {
    throw new RangeError(`messenger slot ${slot} is outside the client's 0..2`);
  }
  return resultWriter(MESSENGER_RESULT_TYPE.left).writeByte(slot).toBytes();
}

/** `type 3`：邀請。`roomId` 是「是」之後 `0x24 type 0` 要送回來的那個值。 */
export function encodeMessengerInvite(invite: { inviterName: string; roomId: number }): Uint8Array {
  return resultWriter(MESSENGER_RESULT_TYPE.invite)
    .writeAsciiString(invite.inviterName)
    .writeU32(invite.roomId >>> 0)
    .toBytes();
}

/** `type 4`：邀請的結果（送／找不到）。 */
export function encodeMessengerInviteResult(result: { ok: number; name: string }): Uint8Array {
  return resultWriter(MESSENGER_RESULT_TYPE.inviteResult)
    .writeAsciiString(result.name)
    .writeByte(result.ok)
    .toBytes();
}

/** `type 5`：一行聊天。**字串裡自己帶「說話者 : 內容」**。 */
export function encodeMessengerChat(line: string): Uint8Array {
  return resultWriter(MESSENGER_RESULT_TYPE.chat).writeAsciiString(line).toBytes();
}

/** 一個 `0x4D` 讀回來的樣子（測試、`decode` 與 probe 用）。 */
export type MessengerEvent =
  | { kind: "participant"; participant: MessengerParticipant; announce: boolean }
  | { kind: "joinFailed"; code: number }
  | { kind: "left"; slot: number }
  | { kind: "invite"; inviterName: string; roomId: number }
  | { kind: "inviteResult"; ok: number; name: string }
  | { kind: "chat"; line: string };

/** 讀一個 `0x4D`（不含 opcode）。 */
export function readMessengerResult(reader: PacketReader): MessengerEvent {
  const type = reader.readByte();
  switch (type) {
    case MESSENGER_RESULT_TYPE.participant: {
      const room = reader.readByte();
      const slot = reader.readByte();
      const face = reader.readU32();
      const look: number[] = [];
      for (;;) {
        const itemId = reader.readU32();
        if (itemId === 0) break;
        look.push(itemId);
      }
      const name = reader.readAsciiString();
      const announce = reader.readByte() !== 0;
      return { kind: "participant", participant: { room, slot, face, look, name }, announce };
    }
    case MESSENGER_RESULT_TYPE.joinFailed:
      return { kind: "joinFailed", code: reader.readByte() };
    case MESSENGER_RESULT_TYPE.left:
      return { kind: "left", slot: reader.readByte() };
    case MESSENGER_RESULT_TYPE.invite:
      return { kind: "invite", inviterName: reader.readAsciiString(), roomId: reader.readU32() };
    case MESSENGER_RESULT_TYPE.inviteResult:
      return { kind: "inviteResult", name: reader.readAsciiString(), ok: reader.readByte() };
    case MESSENGER_RESULT_TYPE.chat:
      return { kind: "chat", line: reader.readAsciiString() };
    default:
      throw new RangeError(`0x4d type 0x${type.toString(16)} is not a known messenger result`);
  }
}

/** 給日誌與 `decode` 的一行。 */
export function describeMessengerResult(event: MessengerEvent): string {
  switch (event.kind) {
    case "participant":
      return `0x4d messenger: slot ${event.participant.slot} "${event.participant.name}"${
        event.announce ? " (entered)" : ""
      }`;
    case "joinFailed":
      return `0x4d messenger: join failed code=${event.code}`;
    case "left":
      return `0x4d messenger: slot ${event.slot} left`;
    case "invite":
      return `0x4d messenger: "${event.inviterName}" invites to room ${event.roomId}`;
    case "inviteResult":
      return `0x4d messenger: invite of "${event.name}" ${event.ok === 0 ? "not found" : "sent"}`;
    case "chat":
      return `0x4d messenger: ${event.line}`;
  }
}
