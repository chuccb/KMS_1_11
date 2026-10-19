/** 470E10 player commands, 525EC0 exact / 526070 command+ASCII-space prefix.
 * Browser aliases are explicit extensions, not strings sent to the native server.
 * Unknown/malformed slash lines must never fall back to public chat.
 */
export const PARTY_COMMANDS = [
  "info",
  "create",
  "leave",
  "invite",
  "kick",
  "accept",
  "decline",
] as const;
export type PartyCommand = (typeof PARTY_COMMANDS)[number];
export function isPartyCommand(value: unknown): value is PartyCommand {
  return typeof value === "string" && PARTY_COMMANDS.some((command) => command === value);
}
export type SocialCommand =
  | { kind: "party"; command: PartyCommand; name: string }
  | { kind: "whisper"; name: string; text: string }
  | { kind: "find"; name: string }
  | { kind: "trade"; name: string }
  | { kind: "error"; message: string };
const invalid = (usage: string): SocialCommand => ({ kind: "error", message: `用法：${usage}` });
const nativeParty = [
  ["/파티정보", "info"],
  ["/파티만들기", "create"],
  ["/파티탈퇴", "leave"],
  ["/파티초대", "invite"],
  ["/파티강퇴", "kick"],
] as const;
export function parseSocialCommand(input: string): SocialCommand | undefined {
  // The current browser edit trims outer whitespace; keep that policy shared with direct JSON.
  const text = input.trim();
  if (!text.startsWith("/")) return undefined;
  if (/[\r\n\0]/.test(text))
    return { kind: "error", message: "指令不可包含換行或NUL；沒有送到公開聊天。" };
  for (const [prefix, command] of nativeParty) {
    if (text !== prefix && !text.startsWith(prefix + " ")) continue;
    const name = text.slice(prefix.length + 1);
    if (command === "invite" || command === "kick")
      return name ? { kind: "party", command, name } : invalid(`${prefix} 이름`);
    return text === prefix ? { kind: "party", command, name: "" } : invalid(prefix);
  }
  const alias = /^\/(?:party|파티)(?:[ \t]+([^ \t]+)(?:[ \t]+(.*))?)?$/i.exec(text);
  if (alias) {
    const command = alias[1]?.toLowerCase(),
      name = alias[2] ?? "";
    if (!isPartyCommand(command))
      return invalid("/party info|create|leave|invite 이름|kick 이름|accept|decline");
    if (command === "invite" || command === "kick")
      return name ? { kind: "party", command, name } : invalid(`/party ${command} 이름`);
    return name ? invalid(`/party ${command}`) : { kind: "party", command, name: "" };
  }
  // Original commands take one ASCII space and preserve the remaining argument (not \s+).
  if (text === "/귓속말" || text.startsWith("/귓속말 ")) {
    const rest = text.slice("/귓속말 ".length),
      split = rest.indexOf(" ");
    return split > 0 && split < rest.length - 1
      ? { kind: "whisper", name: rest.slice(0, split), text: rest.slice(split + 1) }
      : invalid("/귓속말 이름 내용");
  }
  if (text === "/찾기" || text.startsWith("/찾기 ")) {
    const name = text.slice("/찾기 ".length);
    return name ? { kind: "find", name } : invalid("/찾기 이름");
  }
  const short = /^\/(w|f)(?:[ \t]+([^ \t]+)(?:[ \t]+(.*))?)?$/i.exec(text);
  if (short) {
    const name = short[2] ?? "",
      rest = short[3] ?? "";
    return short[1]!.toLowerCase() === "f"
      ? name && !rest
        ? { kind: "find", name }
        : invalid("/f 이름")
      : name && rest
        ? { kind: "whisper", name, text: rest }
        : invalid("/w 이름 내용");
  }
  // sub_471A40: the rest of the line is the target name; an empty one fails the pool lookup.
  if (text === "/교환" || text.startsWith("/교환 "))
    return { kind: "trade", name: text.slice("/교환 ".length) };
  return undefined;
}
export interface SocialCommandActions {
  party(command: PartyCommand, name: string): void;
  request(name: string, text?: string): void;
  trade(name: string): void;
  error(message: string): void;
}
/** Synchronous consumption result lets the edit clear/blur normally without async public fallback. */
export function runSocialCommand(text: string, actions: SocialCommandActions): boolean {
  const command = parseSocialCommand(text);
  if (!command) return false;
  if (command.kind === "party") actions.party(command.command, command.name);
  else if (command.kind === "error") actions.error(command.message);
  else if (command.kind === "trade") actions.trade(command.name);
  else actions.request(command.name, command.kind === "whisper" ? command.text : undefined);
  return true;
}
