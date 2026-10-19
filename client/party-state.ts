import type { PartyResult, PartyMember } from "../server/src/protocol/party.ts";
/** 45F5C0's102bytes = six(4+13)byte slots. Shared with the native codec; no server runtime import
 * in browser modules (the live server serves client/ modules, not the server/ source tree).
 */
export const PARTY_MAX_MEMBERS = 6;
/** CWvsApp+404 partyId / +408 six IDs / +432 six13-byte names, 55C5E0.
 * Do not compact empty slots or infer membership from a roster: sync/join set partyId directly;
 * type10 clears it for the named self, even if a contradictory roster still includes self.
 * Ended retains the old bytes but gates all actions by partyId==0, like native. Clear on session end.
 */
export function partyState() {
  const empty = (): PartyMember[] =>
    Array.from({ length: PARTY_MAX_MEMBERS }, () => ({ characterId: 0, name: "" }));
  let id = 0,
    members = empty();
  return {
    get id() {
      return id;
    },
    receive(result: PartyResult, selfId: number, selfName = "") {
      if (result.kind === "created") {
        id = result.partyId;
        members = empty();
        members[0] = { characterId: selfId, name: selfName };
      } else if (result.kind === "sync" || result.kind === "joined" || result.kind === "left") {
        members = empty().map((slot, index) => ({ ...(result.members[index] ?? slot) }));
        id = result.kind === "left" && result.characterId === selfId ? 0 : result.partyId;
      } else if (result.kind === "ended") id = 0;
    },
    leader(selfId: number | undefined) {
      return id !== 0 && selfId !== undefined && selfId !== 0 && members[0]!.characterId === selfId;
    },
    targetId(name: string) {
      return members.find((member) => member.name === name)?.characterId ?? 0;
    },
    /** Copies preserve the fixed slots; callers cannot silently change protocol state. */
    roster(): readonly PartyMember[] {
      return members.map((member) => ({ ...member }));
    },
    clear() {
      id = 0;
      members = empty();
    },
  };
}
export type PartyState = ReturnType<typeof partyState>;
export type PartyCommandFeedback =
  | { kind: "info"; lines: readonly string[] }
  | { kind: "notLeader" }
  | { kind: "memberNotFound"; name: string }
  | { kind: "targetNotFound" }
  | { kind: "alreadyInParty" }
  | { kind: "notInParty" };
/** 55CC40 appends a space plus EVERY one of the six names, including empty trailing slots. */
export function partyInfo(state: PartyState, selfId: number): readonly string[] {
  if (!state.id) return ["가입한 파티가 없습니다"];
  const line =
    "파티원:" +
    state
      .roster()
      .map((member) => " " + member.name)
      .join("");
  return state.leader(selfId) ? [line, "당신은 파티장입니다."] : [line];
}
export function partyCommandLines(feedback: PartyCommandFeedback): readonly string[] {
  switch (feedback.kind) {
    case "info":
      return feedback.lines;
    case "notLeader":
      return ["파티의 방장이 아닙니다"];
    case "memberNotFound":
      return [`'${feedback.name}'님은 파티의 멤버가 아닙니다.`];
    case "targetNotFound":
      return ["캐릭터를 찾을 수 없습니다"];
    case "alreadyInParty":
      return ["이미 가입한 파티가 있습니다"];
    case "notInParty":
      return ["가입한 파티가 없습니다"];
  }
}
