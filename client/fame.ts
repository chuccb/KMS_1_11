import type { FameFeedback } from "../server/src/client/fame.ts";
/** 55C390 and 55D7B0: already-Unicode names, exact EXE CP949 literals, StatusBar font6.
 * Type1 is SILENT. Type5's second name is local, never a second wire string.
 */
export function fameMessage(result: FameFeedback, selfName: string): string | undefined {
  switch (result.kind) {
    case "changed":
      return `'${result.name}'님의 인기도를 ${result.up ? "올려주었습니다." : "내렸습니다."}`;
    case "received":
      return `'${result.name}'님께서 '${selfName}'님의 인기도를 ${result.up ? "올려주었습니다." : "내렸습니다."}`;
    case "ignored":
      return undefined;
    case "beginner":
      return "초보자는 인기도를 올리거나 내리지 못합니다.";
    case "alreadyToday":
      return "오늘은 더 이상 인기도를 올리거나 내리지 못합니다.";
    case "alreadyThisMonth":
      return "이번 달에는 더 이상 지정된 캐릭터의 인기도를 올리거나 내리지 못합니다.";
    case "unknown":
      return "알 수 없는 오류로 인기도를 올리거나 내리지 못했습니다.";
    case "notFound":
      return "캐릭터를 찾을 수 없습니다";
    case "cooldown":
      return "잠시 후 다시 시도해 보세요";
  }
}
