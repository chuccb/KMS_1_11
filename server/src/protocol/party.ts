/**
 * 組隊（파티）：s2c `0x10` 與 c2s `0x26`。
 *
 * EVIDENCE (MapleStory.exe.c / .lst, FINDINGS 4.37)
 * -----------------------------------------------------------------------------
 * **兩個方向共用同一個號碼空間嗎？不。** `0x10` 是 `CWvsApp` 層的 opcode（`sub_43B170` 把
 * `0x0A`–`0x14` 交給 `sub_55A900`），處理函式是 `sub_55C5E0`；`0x26` 是 client 送到**遊戲伺服器**
 * 的請求（`sub_4A1EA0(..., 38, 0)`），五個送出點分别是 `/파티만들기`、`/파티탈퇴`、
 * `/파티초대 <name>`、`/파티강퇴 <name>` 與「收到邀請按『是』」，全部在
 * `sub_470E10`（聊天指令）與 `sub_55C5E0` 裡。
 *
 * **`0x10`（s2c）**：`u8 type` + 依 type 的 payload：
 *
 * | type | payload | client 的反應 |
 * |---|---|---|
 * | `3` | `u32 inviterId` + `str inviterName` | 跳「'name'님이 파티에 초대했습니다. 파티에 가입하시겠습니까?」對話框（`sub_52C140` 的 `IDYES`）；按「是」送 `0x26 type 2` + 同一個 u32 |
 * | `5` | `u32 partyId` + **102-byte 名冊** | 安靜地整份同步（無訊息） |
 * | `6` | `u32 partyId` | 「새로운 파티를 만들었습니다」；client 自己把名冊清空、把自己寫進第 0 格 |
 * | `7`／`14` | — | 「이미 가입한 파티가 있습니다」 |
 * | `8` | — | 「초보자는 파티를 만들 수 없습니다」 |
 * | `10` | `u32 partyId` + `u32 characterId` + `u8 flag`；`flag != 0` 再加 `u8 kicked` + `str name` + 102-byte 名冊 | 見下 |
 * | `11` | — | 「가입한 파티가 없습니다」 |
 * | `13` | `u32 partyId` + `str name` + 102-byte 名冊 | 「'name'님이 파티에 가입하셨습니다」（`name` 是自己時是「파티에 가입되었습니다.」）|
 * | `15` | — | 「가입하려는 파티에 이미 최대 인원 수만큼의 파티원이 가입했습니다」 |
 * | 其他 | — | 「알 수 없는 오류가 발생해서 파티 요청을 처리하지 못했습니다」 |
 *
 * `type 10` 的兩種意思（`sub_55C5E0` case 10）：`flag == 0` 是**隊長退隊、隊伍解散**——client 只讀
 * `partyId`／`characterId`，然後把自己的 `partyId` 歸零；`characterId` 是自己時印「파티장을
 * 그만둡니다. 파티가 해체되었습니다」、否則印「파티장이 파티를 그만둬서 파티에서 나갑니다」。`flag != 0`
 * 是**有人退隊或被踢**：`kicked` 區分兩者（0＝自己退出、1＝被踢），名冊是**更新後**的那一份
 *（client 直接 `qmemcpy` 覆蓋自己的 6 格）。
 *
 * **`0x26`（c2s）**：`u8 type` + payload：
 *
 * | type | 意義 | payload | 送出點 |
 * |---|---|---|---|
 * | `0` | 建立 | — | `/파티만들기`（`sub_471CD0`，先檢查「還沒加入隊伍」）|
 * | `1` | 退出 | `u8`（唯一寫入者是字面 `0`，語意未定位）| `/파티탈퇴`（`sub_471E90`）|
 * | `2` | 接受邀請 | `u32 inviterId`（`type 3` 讀到的那一個）| 邀請對話框按「是」（`sub_55C5E0`）|
 * | `3` | 邀請 | `u32 targetCharacterId` | `/파티초대 <name>`（`sub_472050`，只找**同一張圖**的 CUserPool）|
 * | `4` | 踢人 | `u32 targetCharacterId` | `/파티강퇴 <name>`（`sub_4722E0`，只找自己名冊裡的名字）|
 *
 * **102-byte 名冊**：`sub_45F5C0` 是一次 `qmemcpy(…, 0x66)`，所以欄位要從**讀取端**看：
 * `sub_55DB00` 用 `this + 432 + 13 * i` 找名字、用 `this + 408 + 4 * i` 取回角色 id（i = 0..5），
 * `sub_55CC40`（`/파티정보`）也以 13 bytes 步進印出六個名字。於是名冊＝
 * `u32 characterId[6]`（24 bytes）+ `char name[6][13]`（78 bytes）＝ **102 bytes**，
 * 空位是全 0。名字欄位與 `CharacterData` 的那一個相同（13 bytes、NUL 結尾、ASCII），所以直接沿用
 * `chardata.ts` 的 `nameFieldBytes`／`nameFieldToString`。
 *
 * 兩件 client 自己的事，伺服器不需要模仿但值得知道：
 *
 * 1. `type 3` 的邀請是**模態對話框**（`sub_52C140`），client 在按下答案前不會處理別的封包。
 * 2. `type 3` 只有在 `*(CWvsApp + 36) != 0` 時才會被讀；那一格是本機角色的**名字物件**（`type 6`
 *    用它填名冊第 0 格：`lstrcpyA(this + 432, *(this + 36) + 4)`），所以「角色還沒載入」時邀請整包
 *    丟掉。我們的伺服器只在遊戲內送它，所以一定會被讀到。
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import {
  CHARACTER_NAME_BYTES,
  nameFieldBytes,
  nameFieldToString,
} from "./chardata.ts";

/** 兩個方向的號碼（同名不同方向，跟 `0x0B`／`0x0F` 一樣）。 */
export const PARTY_OPCODE = {
  /** s2c：`sub_55C5E0`（`CWvsApp` 層，`sub_55A900` case 16）。 */
  result: 0x10,
  /** c2s：`sub_4A1EA0(..., 38, 0)`，五個送出點見檔頭。 */
  request: 0x26,
} as const;

/** 名冊的格數：`sub_45F5C0` 的 102 bytes 就是 6 × (4 + 13)。 */
export const PARTY_MAX_MEMBERS = 6;

/** 一個隊員：角色 id 與名字（名字就是 `CharacterData` 的 13-byte 欄位）。 */
export interface PartyMember {
  characterId: number;
  name: string;
}

/** `0x10` 的 `type` 值，只列 `sub_55C5E0` 有 case 的。 */
export const PARTY_RESULT_TYPE = {
  invite: 3,
  sync: 5,
  created: 6,
  alreadyInParty: 7,
  beginnerCannotCreate: 8,
  memberLeft: 10,
  notInParty: 11,
  memberJoined: 13,
  alreadyInPartyToo: 14,
  full: 15,
} as const;

/** `0x26` 的 `type` 值，只列有五個送出點的。 */
export const PARTY_REQUEST_TYPE = {
  create: 0,
  leave: 1,
  accept: 2,
  invite: 3,
  kick: 4,
} as const;

/** `0x26` 進來的一個請求。 */
export type ClientPartyRequest =
  | { kind: "create" }
  /** 退出；`unknown` 是封包的第二個 byte（唯一寫入者寫 0，語意未定位）。 */
  | { kind: "leave"; unknown: number }
  | { kind: "accept"; inviterId: number }
  | { kind: "invite"; targetId: number }
  | { kind: "kick"; targetId: number };

/** 讀一個 `0x26`（不含 opcode）。 */
export function readClientPartyRequest(reader: PacketReader): ClientPartyRequest {
  const kind = reader.readByte();
  switch (kind) {
    case PARTY_REQUEST_TYPE.create:
      return { kind: "create" };
    case PARTY_REQUEST_TYPE.leave:
      return { kind: "leave", unknown: reader.readByte() };
    case PARTY_REQUEST_TYPE.accept:
      return { kind: "accept", inviterId: reader.readU32() };
    case PARTY_REQUEST_TYPE.invite:
      return { kind: "invite", targetId: reader.readU32() };
    case PARTY_REQUEST_TYPE.kick:
      return { kind: "kick", targetId: reader.readU32() };
    default:
      throw new RangeError(`0x26 type 0x${kind.toString(16)} is not a party request (0x00-0x04)`);
  }
}

/** 寫一個 `0x26`（測試與 `capture` 重播用）。 */
export function encodeClientPartyRequest(request: ClientPartyRequest): Uint8Array {
  const writer = new PacketWriter().writeByte(PARTY_OPCODE.request);
  switch (request.kind) {
    case "create":
      return writer.writeByte(PARTY_REQUEST_TYPE.create).toBytes();
    case "leave":
      return writer.writeByte(PARTY_REQUEST_TYPE.leave).writeByte(request.unknown).toBytes();
    case "accept":
      return writer.writeByte(PARTY_REQUEST_TYPE.accept).writeU32(request.inviterId).toBytes();
    case "invite":
      return writer.writeByte(PARTY_REQUEST_TYPE.invite).writeU32(request.targetId).toBytes();
    case "kick":
      return writer.writeByte(PARTY_REQUEST_TYPE.kick).writeU32(request.targetId).toBytes();
  }
}

/** 給日誌與 `decode` 的一行。 */
export function describeClientPartyRequest(request: ClientPartyRequest): string {
  switch (request.kind) {
    case "create":
      return "0x26 party: create";
    case "leave":
      return `0x26 party: leave (unknown=${request.unknown})`;
    case "accept":
      return `0x26 party: accept inviter=${request.inviterId}`;
    case "invite":
      return `0x26 party: invite target=${request.targetId}`;
    case "kick":
      return `0x26 party: kick target=${request.targetId}`;
  }
}

/**
 * 102-byte 名冊：先六個 `u32`、再六個 13-byte 名字（`sub_45F5C0` 的 memcpy，見檔頭）。
 * 不足的格子寫 0；超過六個是我們自己的 bug，直接丟。
 */
export function encodePartyTable(members: readonly PartyMember[]): Uint8Array {
  if (members.length > PARTY_MAX_MEMBERS) {
    throw new RangeError(`a party table holds ${PARTY_MAX_MEMBERS} members, got ${members.length}`);
  }
  const writer = new PacketWriter(24 + PARTY_MAX_MEMBERS * CHARACTER_NAME_BYTES);
  for (let i = 0; i < PARTY_MAX_MEMBERS; i++) writer.writeU32(members[i]?.characterId ?? 0);
  const empty = new Uint8Array(CHARACTER_NAME_BYTES);
  for (let i = 0; i < PARTY_MAX_MEMBERS; i++) {
    const member = members[i];
    writer.writeBytes(member === undefined ? empty : nameFieldBytes(member.name));
  }
  return writer.toBytes();
}

/** 讀回 102-byte 名冊（`0x10` 的測試與 `decode` 用）。名字為空的格子會被丟掉。 */
export function readPartyTable(reader: PacketReader): PartyMember[] {
  const ids: number[] = [];
  for (let i = 0; i < PARTY_MAX_MEMBERS; i++) ids.push(reader.readU32());
  const members: PartyMember[] = [];
  for (let i = 0; i < PARTY_MAX_MEMBERS; i++) {
    const name = nameFieldToString(reader.readBytes(CHARACTER_NAME_BYTES));
    if (name !== "") members.push({ characterId: ids[i]!, name });
  }
  return members;
}

/** `0x10` 的一個結果。 */
export type PartyResult =
  | { kind: "invite"; inviterId: number; inviterName: string }
  | { kind: "sync"; partyId: number; members: readonly PartyMember[] }
  | { kind: "created"; partyId: number }
  | { kind: "joined"; partyId: number; name: string; members: readonly PartyMember[] }
  | { kind: "left"; partyId: number; characterId: number; kicked: boolean; name: string; members: readonly PartyMember[] }
  | { kind: "ended"; partyId: number; leaderId: number }
  | { kind: "alreadyInParty" }
  | { kind: "notInParty" }
  | { kind: "beginnerCannotCreate" }
  | { kind: "full" }
  | { kind: "unknown" };

/** 寫一個 `0x10`。 */
export function encodePartyResult(result: PartyResult): Uint8Array {
  const writer = new PacketWriter().writeByte(PARTY_OPCODE.result);
  switch (result.kind) {
    case "invite":
      return writer
        .writeByte(PARTY_RESULT_TYPE.invite)
        .writeU32(result.inviterId)
        .writeAsciiString(result.inviterName)
        .toBytes();
    case "sync":
      return writer.writeByte(PARTY_RESULT_TYPE.sync).writeU32(result.partyId).writeBytes(encodePartyTable(result.members)).toBytes();
    case "created":
      return writer.writeByte(PARTY_RESULT_TYPE.created).writeU32(result.partyId).toBytes();
    case "joined":
      return writer
        .writeByte(PARTY_RESULT_TYPE.memberJoined)
        .writeU32(result.partyId)
        .writeAsciiString(result.name)
        .writeBytes(encodePartyTable(result.members))
        .toBytes();
    case "left":
      return writer
        .writeByte(PARTY_RESULT_TYPE.memberLeft)
        .writeU32(result.partyId)
        .writeU32(result.characterId)
        .writeByte(1)
        .writeByte(result.kicked ? 1 : 0)
        .writeAsciiString(result.name)
        .writeBytes(encodePartyTable(result.members))
        .toBytes();
    case "ended":
      // `flag = 0`: 隊長退隊、隊伍解散。client 只讀 partyId 與發起人 id。
      return writer
        .writeByte(PARTY_RESULT_TYPE.memberLeft)
        .writeU32(result.partyId)
        .writeU32(result.leaderId)
        .writeByte(0)
        .toBytes();
    case "alreadyInParty":
      return writer.writeByte(PARTY_RESULT_TYPE.alreadyInParty).toBytes();
    case "notInParty":
      return writer.writeByte(PARTY_RESULT_TYPE.notInParty).toBytes();
    case "beginnerCannotCreate":
      return writer.writeByte(PARTY_RESULT_TYPE.beginnerCannotCreate).toBytes();
    case "full":
      return writer.writeByte(PARTY_RESULT_TYPE.full).toBytes();
    case "unknown":
      // `sub_55C5E0` 的 default：沒有 payload，client 印「알 수 없는 오류…」。
      return writer.writeByte(0).toBytes();
  }
}

/**
 * 讀一個 `0x10`（不含 opcode）。`decode` 與測試用；`type 10` 的兩種意思由 `flag` 決定
 * （`0` ＝隊長退隊、隊伍解散），`type 10` 以外的未知 type 一律成為 `unknown`（client 的 default
 * 分支就是印一行「알 수 없는 오류…」）。
 */
export function readPartyResult(reader: PacketReader): PartyResult {
  const type = reader.readByte();
  switch (type) {
    case PARTY_RESULT_TYPE.invite:
      return { kind: "invite", inviterId: reader.readU32(), inviterName: reader.readAsciiString() };
    case PARTY_RESULT_TYPE.sync:
      return { kind: "sync", partyId: reader.readU32(), members: readPartyTable(reader) };
    case PARTY_RESULT_TYPE.created:
      return { kind: "created", partyId: reader.readU32() };
    case PARTY_RESULT_TYPE.memberJoined:
      return {
        kind: "joined",
        partyId: reader.readU32(),
        name: reader.readAsciiString(),
        members: readPartyTable(reader),
      };
    case PARTY_RESULT_TYPE.memberLeft: {
      const partyId = reader.readU32();
      const characterId = reader.readU32();
      const flag = reader.readByte();
      if (flag === 0) return { kind: "ended", partyId, leaderId: characterId };
      return {
        kind: "left",
        partyId,
        characterId,
        kicked: reader.readByte() !== 0,
        name: reader.readAsciiString(),
        members: readPartyTable(reader),
      };
    }
    case PARTY_RESULT_TYPE.alreadyInParty:
    case PARTY_RESULT_TYPE.alreadyInPartyToo:
      return { kind: "alreadyInParty" };
    case PARTY_RESULT_TYPE.beginnerCannotCreate:
      return { kind: "beginnerCannotCreate" };
    case PARTY_RESULT_TYPE.notInParty:
      return { kind: "notInParty" };
    case PARTY_RESULT_TYPE.full:
      return { kind: "full" };
    default:
      return { kind: "unknown" };
  }
}

/** 給日誌與 `decode` 的一行；名冊只印人數與名字。 */
export function describePartyResult(result: PartyResult): string {
  switch (result.kind) {
    case "invite":
      return `0x10 party: invite from ${result.inviterId} "${result.inviterName}"`;
    case "sync":
      return `0x10 party: sync ${result.partyId} [${result.members.map((m) => m.name).join(", ")}]`;
    case "created":
      return `0x10 party: created ${result.partyId}`;
    case "joined":
      return `0x10 party: ${result.name} joined ${result.partyId} [${result.members.map((m) => m.name).join(", ")}]`;
    case "left":
      return `0x10 party: ${result.name}${result.kicked ? " kicked from" : " left"} ${result.partyId} [${result.members.map((m) => m.name).join(", ")}]`;
    case "ended":
      return `0x10 party: ${result.partyId} ended (leader ${result.leaderId} left)`;
    default:
      return `0x10 party: ${result.kind}`;
  }
}
