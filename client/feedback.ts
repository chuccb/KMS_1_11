/** Native receive-side feedback. Names are async browser resources, never fake numeric labels.
 * No socket/game operations: only validated messages, transient UI and same-level EXP comparison.
 */
import { isRecord } from "./resource-validation.ts";
import {
  readFeedbackEvent,
  lootText,
  experienceText,
  screenMessagePool,
  SCREEN_MESSAGES,
  type FeedbackSelf,
} from "./feedback-data.ts";
export interface FeedbackDialog {
  readonly open: boolean;
  notice(options: { text: string; accept(value: number): void; reject(): void }): boolean;
  close(restoreFocus?: boolean): void;
}
export interface FeedbackOptions {
  dialog: FeedbackDialog;
  item(id: number): Promise<unknown>;
  chat(text: string): void;
  now(): number;
  blocked(): boolean;
  onError(error: unknown): void;
}
/** Browser workload policies, not native game constants or limits on server rewards. */
export const FEEDBACK_LIMITS = { pendingNames: 6, notices: 16 } as const;
export function gameFeedback(options: FeedbackOptions) {
  const pool = screenMessagePool(),
    pending = new Set<number>();
  let prior: FeedbackSelf | undefined,
    epoch = 0,
    order = 0,
    disposed = false,
    ownNotice = false;
  const notices: string[] = [];
  const clock = () => Math.trunc(options.now());
  function put(text: string, at = clock(), sequence = ++order) {
    if (!disposed && clock() - at < SCREEN_MESSAGES.durationMs)
      pool.put({ text, at, order: sequence });
  }
  function cancelPending() {
    epoch++;
    pending.clear();
    notices.length = 0;
    if (ownNotice) {
      ownNotice = false;
      options.dialog.close(false);
    }
  }
  function reset() {
    cancelPending();
    pool.clear();
    prior = undefined;
  }
  function releaseNotice() {
    ownNotice = false;
  }
  return {
    receive(value: unknown) {
      if (disposed) return false;
      const event = readFeedbackEvent(value);
      if (!event) return false;
      switch (event.t) {
        case "login":
        case "disconnect":
          reset();
          return false;
        case "field":
          cancelPending();
          prior = event.self;
          return false;
        case "self": {
          const text = experienceText(prior, event.self);
          prior = event.self;
          if (text) put(text);
          return false;
        }
        case "system-notice":
          if (event.type === 0) options.chat(`[공지사항] ${event.text}`);
          else {
            if (notices.length >= FEEDBACK_LIMITS.notices)
              throw Error("System notice queue overflow");
            notices.push(event.text);
          }
          return true;
        case "loot": {
          if (event.notice.kind !== "item") {
            const text = lootText(event.notice);
            if (text) put(text);
            return true;
          }
          const notice = event.notice,
            sequence = ++order,
            at = clock(),
            generation = epoch;
          if (pending.size >= FEEDBACK_LIMITS.pendingNames)
            pending.delete(pending.values().next().value!);
          pending.add(sequence);
          // Starts a shared item-cache lookup once, not forty polling timers; never extends receive-time TTL.
          void Promise.resolve()
            .then(() => {
              if (disposed || epoch !== generation || !pending.has(sequence)) return;
              if (clock() - at >= SCREEN_MESSAGES.durationMs) {
                pending.delete(sequence);
                return;
              }
              return options.item(notice.itemId);
            })
            .then((facts) => {
              if (disposed || epoch !== generation || !pending.delete(sequence)) return;
              const text = lootText(
                notice,
                isRecord(facts) && typeof facts.name === "string" ? facts.name : undefined,
              );
              if (text) put(text, at, sequence);
            })
            .catch((error) => {
              if (!disposed && epoch === generation && pending.delete(sequence))
                options.onError(error);
            });
          return true;
        }
      }
    },
    tick() {
      if (disposed || ownNotice || options.dialog.open || options.blocked() || !notices.length)
        return;
      ownNotice = true;
      if (
        options.dialog.notice({ text: notices[0]!, accept: releaseNotice, reject: releaseNotice })
      )
        notices.shift();
      else ownNotice = false;
    },
    rows: pool.rows,
    reset,
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
    },
  };
}
