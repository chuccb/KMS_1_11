/**
 * 隊伍的狀態：誰跟誰一隊、誰是隊長、誰邀請了誰。
 *
 * 這一層不知道封包，也不知道 socket——它只回答「這個角色在哪一隊」與「把這個人加進去之後名冊長
 * 什麼樣」，`net/loginserver.ts` 負責把結果變成 `0x10`。分成兩層的理由跟 `game/mobs.ts` 一樣：
 * 名冊的規則（六格、隊長、邀請）可以單獨測，封包的 byte 由 `protocol/party.ts` 的 golden 測試釘住。
 *
 * 三件屬於**我們**的選擇（client 沒有這些規則，原伺服器也看不到，ADR-030）：
 *
 * 1. **隊伍在世界層，不在場地層。** 名冊裡只有角色 id 與名字（FINDINGS 4.37），沒有地圖，所以
 *    隊員分散在兩張圖是合法的；`FieldInstance` 因此不持有隊伍，`PartyRegistry` 掛在
 *    `GameEntryServer` 上。
 * 2. **隊長退隊＝解散。** client 的 `0x10` type 10 `flag = 0` 就是這個意思（「파티장을
 *    그만둡니다. 파티가 해체되었습니다」），而封包裡沒有任何「換隊長」的欄位——所以這一版沒有
 *    隊長轉移，隊長一走就解散。
 * 3. **下線＝退隊**（隊長下線＝解散）。2003 的隊伍是記憶體裡的東西，沒有離線隊員；這也讓
 *    「同一個角色只會有一條連線」的規則延伸到隊伍上。
 *
 * 邀請是**一個目標一格**（後到的邀請蓋掉前一個）：client 的邀請對話框是模態的（`sub_52C140`），
 * 一個玩家不可能同時看著兩個邀請。
 */
import { PARTY_MAX_MEMBERS, type PartyMember } from "../protocol/party.ts";

/** 一隊：id、隊長、名冊（最多 `PARTY_MAX_MEMBERS` 個，順序就是名冊的格子順序）。 */
export interface Party {
  readonly id: number;
  leaderId: number;
  readonly members: PartyMember[];
}

/** 一個還沒被回答的邀請。 */
export interface PartyInvite {
  readonly partyId: number;
  readonly inviterId: number;
}

/** 有人離開隊伍的結果：`members` 是**離開之前**的名冊，`remaining` 是離開之後的。 */
export interface PartyLeave {
  readonly party: Party;
  readonly member: PartyMember;
  /** 隊長離開（＝解散）時為 true，此時 `remaining` 一定是空的。 */
  readonly leaderLeft: boolean;
  readonly members: PartyMember[];
  readonly remaining: PartyMember[];
}

export class PartyRegistry {
  private readonly parties = new Map<number, Party>();
  private readonly partyIdOf = new Map<number, number>();
  /** targetCharacterId -> 邀請（後到的蓋掉前一個）。 */
  private readonly invites = new Map<number, PartyInvite>();
  private nextId = 1;

  /** 這個角色所在的隊伍，沒有就是 `undefined`。 */
  partyOf(characterId: number): Party | undefined {
    const id = this.partyIdOf.get(characterId);
    return id === undefined ? undefined : this.parties.get(id);
  }

  partyById(partyId: number): Party | undefined {
    return this.parties.get(partyId);
  }

  isLeader(characterId: number): boolean {
    return this.partyOf(characterId)?.leaderId === characterId;
  }

  /** 建一隊，`leader` 是第一個隊員。 */
  create(leader: PartyMember): Party {
    if (this.partyIdOf.has(leader.characterId)) {
      throw new Error(`character ${leader.characterId} is already in a party`);
    }
    const party: Party = { id: this.nextId++, leaderId: leader.characterId, members: [leader] };
    this.parties.set(party.id, party);
    this.partyIdOf.set(leader.characterId, party.id);
    return party;
  }

  /** 名冊還塞得下嗎（六格）。 */
  hasRoom(party: Party): boolean {
    return party.members.length < PARTY_MAX_MEMBERS;
  }

  /**
   * 把人加進隊伍。回傳加入後的名冊；隊伍滿了或人已經在別隊時不做事並回傳 `undefined`
   * （呼叫端負責回 `0x10` type 15／7）。
   */
  join(party: Party, member: PartyMember): PartyMember[] | undefined {
    if (!this.hasRoom(party)) return undefined;
    if (this.partyIdOf.has(member.characterId)) return undefined;
    party.members.push(member);
    this.partyIdOf.set(member.characterId, party.id);
    this.invites.delete(member.characterId);
    return party.members;
  }

  /** 記一個邀請（`target` 之後可以用 `inviteOf` 查回來）。 */
  invite(partyId: number, inviterId: number, targetId: number): void {
    this.invites.set(targetId, { partyId, inviterId });
  }

  inviteOf(targetId: number): PartyInvite | undefined {
    return this.invites.get(targetId);
  }

  dropInvite(targetId: number): void {
    this.invites.delete(targetId);
  }

  /**
   * 把一個角色從他的隊伍裡拿掉。回傳離開的結果（呼叫端拿 `remaining` 去寫 `0x10`），
   * 不在任何隊伍裡時回傳 `undefined`。
   *
   * 隊長離開時整隊解散：`parties`／`partyIdOf` 的每一個成員都要清掉，`remaining` 是空的。
   */
  leave(characterId: number): PartyLeave | undefined {
    const party = this.partyOf(characterId);
    if (party === undefined) return undefined;
    const index = party.members.findIndex((member) => member.characterId === characterId);
    if (index < 0) {
      // 不該發生：`partyIdOf` 與名冊必須一致。留著這一行是為了讓不一致早點爆出來。
      throw new Error(`character ${characterId} is in party ${party.id} but not in its member list`);
    }
    const members = [...party.members];
    const member = members[index]!;
    const leaderLeft = party.leaderId === characterId;
    const remaining = members.filter((other) => other.characterId !== characterId);
    this.partyIdOf.delete(characterId);
    this.invites.delete(characterId);
    if (leaderLeft || remaining.length === 0) {
      for (const rest of remaining) this.partyIdOf.delete(rest.characterId);
      this.parties.delete(party.id);
      return { party, member, leaderLeft, members, remaining: [] };
    }
    party.members.splice(index, 1);
    return { party, member, leaderLeft: false, members, remaining };
  }

  /** 現在有幾隊（測試與日誌用）。 */
  get count(): number {
    return this.parties.size;
  }
}
