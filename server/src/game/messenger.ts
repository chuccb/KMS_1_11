/**
 * 三人聊天室（메신저）的規則：房間、成員、邀請。
 *
 * EVIDENCE (FINDINGS 4.41)
 * -----------------------------------------------------------------------------
 * 客戶端只給了三件事：格子只有 **3 格**（`sub_4DF3E0` 的 `slot <= 2`）、房間用一個 `u32` 編號
 * （`0x24 type 0` 與 `0x4D type 3` 是同一個值）、以及離開是「哪一格」（`0x4D type 2`）。
 * 「誰可以進哪個房間」「邀請多久失效」「一個人能不能同時在兩個房間」線上都沒有欄位，
 * 所以那是這個模組的政策：
 *
 * - **一個人只有一個房間**：`0x4D type 0` 的格子是 0..2，如果同一個人能在兩間房裡，兩邊的格子
 *   會互相蓋掉（client 的成員陣列是 `this + 25 * slot + 31`，沒有房間維度）。
 * - **進房間要有邀請**：`0x24 type 0` 帶的是房間編號，但編號是伺服器給的；沒有邀請就等於
 *   「猜中別人的房間號碼」，所以 join 一定先查邀請（`roomId == 0` 是「開新房間」，不需要邀請）。
 * - **邀請 60 秒失效**：跟交易一樣，client 沒有「拒絕」封包（模態只有「是」），沒有逾時就會永遠
 *   留著一張已經沒有意義的邀請。交易用 30 秒，是因為交易視窗本來就短；聊天室的邀請比較像
 *   「嗨，來聊」，給兩倍。
 * - **房間空了就消失**：2003 的聊天室沒有「主持人」也沒有殘留狀態，最後一個人離開就沒有房間。
 */
import { MESSENGER_ROOM_SIZE } from "../protocol/messenger.ts";

/** 邀請的存活時間（毫秒）。 */
export const MESSENGER_INVITE_TTL_MS = 60_000;

/** 房間裡的一個人。 */
export interface MessengerMember {
  characterId: number;
  name: string;
}

/** 一間房。`members` 的**索引就是格子號**（0..2），所以刪人時後面的要往前補。 */
export interface MessengerRoom {
  id: number;
  members: MessengerMember[];
}

/** 一張還沒被用掉的邀請。 */
export interface MessengerInvite {
  roomId: number;
  /** 邀請者的名字——`0x4D type 3` 要把它送給被邀請的人。 */
  inviterName: string;
  expiresAt: number;
}

export class MessengerRegistry {
  private readonly rooms = new Map<number, MessengerRoom>();
  private readonly roomOfCharacter = new Map<number, number>();
  private readonly invites = new Map<number, MessengerInvite>();
  private nextRoomId = 1;

  /** 開一個新的房間，回傳它的編號。 */
  create(member: MessengerMember): MessengerRoom {
    const room: MessengerRoom = { id: this.nextRoomId++, members: [member] };
    this.rooms.set(room.id, room);
    this.roomOfCharacter.set(member.characterId, room.id);
    this.invites.delete(member.characterId);
    return room;
  }

  /** 這個人現在在哪一間房。 */
  roomOf(characterId: number): MessengerRoom | undefined {
    const id = this.roomOfCharacter.get(characterId);
    return id === undefined ? undefined : this.rooms.get(id);
  }

  /** 這個人所在的格子；不在房間裡就是 `undefined`。 */
  slotOf(characterId: number): number | undefined {
    const room = this.roomOf(characterId);
    if (room === undefined) return undefined;
    const slot = room.members.findIndex((member) => member.characterId === characterId);
    return slot < 0 ? undefined : slot;
  }

  /** 依編號找房間（測試與 `invite` 用）。 */
  room(id: number): MessengerRoom | undefined {
    return this.rooms.get(id);
  }

  /**
   * 進房間。回傳 `undefined` 代表「進不去」：房間不存在、滿了、或這個人已經在別的房間裡。
   * 呼叫端負責先查邀請。
   */
  join(roomId: number, member: MessengerMember): MessengerRoom | undefined {
    const room = this.rooms.get(roomId);
    if (room === undefined || room.members.length >= MESSENGER_ROOM_SIZE) return undefined;
    if (this.roomOfCharacter.has(member.characterId)) return undefined;
    room.members.push(member);
    this.roomOfCharacter.set(member.characterId, roomId);
    this.invites.delete(member.characterId);
    return room;
  }

  /**
   * 離開房間。回傳離開後的房間（給廣播 `0x4D type 2` 用）與**離開的那一格**；
   * 房間因此空掉時 `room` 是最後一次看得到的樣子，而且已經從表裡移除。
   */
  leave(
    characterId: number,
  ): { room: MessengerRoom; member: MessengerMember; slot: number } | undefined {
    const room = this.roomOf(characterId);
    if (room === undefined) return undefined;
    const slot = room.members.findIndex((member) => member.characterId === characterId);
    if (slot < 0) return undefined;
    const [member] = room.members.splice(slot, 1);
    this.roomOfCharacter.delete(characterId);
    this.invites.delete(characterId);
    if (room.members.length === 0) this.rooms.delete(room.id);
    return { room, member: member!, slot };
  }

  /** 記一張邀請（同一個人只留最新的一張）。 */
  invite(inviteeId: number, invite: { roomId: number; inviterName: string }, now: number): void {
    this.invites.set(inviteeId, { ...invite, expiresAt: now + MESSENGER_INVITE_TTL_MS });
  }

  /** 還沒過期的邀請。 */
  inviteOf(characterId: number, now: number): MessengerInvite | undefined {
    const invite = this.invites.get(characterId);
    if (invite === undefined) return undefined;
    if (invite.expiresAt <= now) {
      this.invites.delete(characterId);
      return undefined;
    }
    return invite;
  }

  clearInvite(characterId: number): void {
    this.invites.delete(characterId);
  }

  /** 測試與診斷用：現在有幾間房、幾張活著的邀請。 */
  get size(): { rooms: number; invites: number } {
    return { rooms: this.rooms.size, invites: this.invites.size };
  }
}
