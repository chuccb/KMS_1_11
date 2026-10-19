import type { PartyResult } from "../server/src/protocol/party.ts";
/** 55C5E0 font6 text; names have already been decoded at the ClientSession event boundary.
 * Invite is a modal, sync is silent. Neither belongs in the chat-message switch.
 */
export function partyMessage(
  result: PartyResult,
  selfId: number,
  selfName: string,
): string | undefined {
  switch (result.kind) {
    case "invite":
    case "sync":
      return undefined;
    case "created":
      return "새로운 파티를 만들었습니다";
    case "alreadyInParty":
      return "이미 가입한 파티가 있습니다";
    case "beginnerCannotCreate":
      return "초보자는 파티를 만들 수 없습니다";
    case "notInParty":
      return "가입한 파티가 없습니다";
    case "full":
      return "가입하려는 파티에 이미 최대 인원 수만큼의 파티원이 가입했습니다";
    case "unknown":
      return "알 수 없는 오류가 발생해서 파티 요청을 처리하지 못했습니다";
    case "ended":
      return result.leaderId === selfId
        ? "파티장을 그만둡니다. 파티가 해체되었습니다"
        : "파티장이 파티를 그만둬서 파티에서 나갑니다";
    case "joined":
      return result.name === selfName
        ? "파티에 가입되었습니다."
        : `'${result.name}'님이 파티에 가입하셨습니다`;
    case "left":
      return result.characterId === selfId
        ? result.kicked
          ? "파티에서 강퇴당했습니다."
          : "파티를 그만둡니다"
        : `'${result.name}'님이 파티${result.kicked ? "에서 강퇴당" : "를 탈퇴"}하셨습니다`;
  }
}
export function partyInvitationText(name: string): string {
  return `'${name}'님이 파티에 초대했습니다.\r\n파티에 가입하시겠습니까?`;
}
