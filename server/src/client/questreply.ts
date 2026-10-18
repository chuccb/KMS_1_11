/** Browser/CLI answer validation at the packet boundary. This is not a quest-script engine.
 * Original senders: 4A5A80/4A5D00 (1/0/FF), 4A5F40/4A6320/4A65C0 (1/0).
 * Keep the currently offered body as authority, never trust the browser's claimed dialog kind.
 */
import { dialogueSelections } from "../../../client/npcdialogue-layout.ts";
import { encodeCp949 } from "../protocol/cp949.ts";
import type { QuestTalkBody, QuestReply } from "../protocol/quest.ts";

export interface QuestReplyDetail {
  kind?: string;
  text?: unknown;
  value?: unknown;
}
export function questReplyFor(
  body: QuestTalkBody,
  answer: number,
  detail: QuestReplyDetail = {},
): QuestReply {
  const cancel = body.kind === "say" || body.kind === "confirm" ? 255 : 0;
  if (!Number.isInteger(answer) || (answer !== 0 && answer !== 1 && answer !== cancel))
    throw new RangeError(`talk answer must be 0 or 1${cancel === 255 ? " or 255" : ""}`);
  if (detail.kind !== undefined && detail.kind !== body.kind)
    throw new RangeError("talk reply does not match the open dialog kind");
  if (body.kind === "say" && answer === 0 && !body.unknownA)
    throw new RangeError("this say dialog has no previous-page button; close with 255");
  if (answer !== 1) return { kind: body.kind, answer };
  switch (body.kind) {
    case "askText": {
      if (typeof detail.text !== "string") throw new RangeError("talk text must be a string");
      const text = detail.text; // No trimming: native ZXString stores the edit bytes verbatim.
      const length = encodeCp949(text).length;
      if (
        text.includes("\0") ||
        length < Math.max(0, body.minLength) ||
        length > (body.maxLength < 0 ? 65535 : body.maxLength)
      )
        throw new RangeError(
          `talk text must contain ${body.minLength}..${body.maxLength} CP949 bytes without NUL`,
        );
      return { kind: body.kind, answer, text };
    }
    case "askNumber":
    case "menu": {
      const value = detail.value;
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 0xffffffff
      )
        throw new RangeError("talk value must be an unsigned 32-bit integer");
      if (body.kind === "askNumber" && (value < body.min || value > body.max))
        throw new RangeError(`talk value must be ${body.min}..${body.max}`);
      if (body.kind === "menu") {
        // Bounded supported menu grammar, independently checked here, not supplied by the browser.
        const offered = dialogueSelections(body.message).has(value);
        if (!offered) throw new RangeError("talk selection was not offered by the open menu");
      }
      return { kind: body.kind, answer, value };
    }
    default:
      return { kind: body.kind, answer };
  }
}
