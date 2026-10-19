import { parseSocialCommand, type PartyCommand } from "../../../client/social-commands.ts";
import { whisperNameError } from "../../../client/whisper.ts";
export interface ChatInputActions {
  party(command: PartyCommand, name: string): Promise<void>;
  whisper(name: string, text: string): Promise<void>;
  find(name: string): Promise<void>;
  /** sub_471A40: `/교환 <name>`; the session resolves the name in its own field user pool. */
  trade(name: string): Promise<void>;
  say(text: string): Promise<void>;
  /** 524A00 compares against the local character, so the router needs the current self name. */
  selfName(): string;
}
/** Shared by the real bridge and synthetic peer regressions. A slash line is never public speech,
 * including malformed/unknown/unsupported commands and rejected private requests.
 * Operator map tools have their own typed warp-map path and server authorization, not chat fallback.
 */
export async function routeChatInput(text: string, actions: ChatInputActions): Promise<void> {
  const command = parseSocialCommand(text);
  if (command?.kind === "error") throw new Error(command.message);
  if (command?.kind === "party") return await actions.party(command.command, command.name);
  if (command?.kind === "whisper") {
    /** 470E10's /귓속말 branch requires sub_524A00(name, null, null) != 0 BEFORE sub_4717D0, so the
     * original admission belongs to this command entry, not to the transport-level {t:"whisper"}
     * JSON (that one is a bridge API whose contract the wire regressions pin). Native drops the
     * rejected line silently; the browser already prints the reason, so the shared router answers
     * with the same Korean text instead of sending. /찾기 has no such gate, so find() stays as-is.
     */
    const reason = whisperNameError(command.name, actions.selfName());
    if (reason !== undefined) throw new Error(reason);
    return await actions.whisper(command.name, command.text);
  }
  if (command?.kind === "find") return await actions.find(command.name);
  if (command?.kind === "trade") return await actions.trade(command.name);
  if (text.trimStart().startsWith("/"))
    throw new Error("未知指令，沒有送到公開聊天；輸入 /help 查看瀏覽器指令。");
  await actions.say(text);
}
