import type { ClientEvent } from "../client/session.ts";
import type { ClientEventJson } from "./webclient-messages.ts";

export type { ClientEventJson } from "./webclient-messages.ts";

/** One receive-only JSON projection, shared by the real bridge and wire/feedback regressions.
 * Do not drop branch discriminants such as system-notice.type or invent defaults for them.
 */
export function clientEventJson<Event extends ClientEvent>(
  event: Event,
  contactField: number,
  partyInviteIdentity = false,
): ClientEventJson<Event> {
  const { kind, ...rest } = event;
  // The projection is a mechanical `kind` -> `t` rename. The assertion retains the correlation
  // between each union member and its discriminator after the object spread.
  return {
    t: kind,
    ...rest,
    ...(kind === "field"
      ? { contactField, playerMenu: true, socialCommands: true, partyInviteIdentity, trade: true }
      : {}),
  } as ClientEventJson<Event>;
}
