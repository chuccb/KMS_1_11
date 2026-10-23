import { miniRoomEventJson } from "../../../client/trade-wire.ts";
import type { ClientEvent } from "../client/session.ts";
import type { ClientEventJson } from "./webclient-messages.ts";

export type {
  ClientEventJson,
  ItemSlotJson,
  ItemSlotCashBlockJson,
  MiniRoomEventJson,
} from "./webclient-messages.ts";

/** One receive-only JSON projection, shared by the real bridge and wire/feedback regressions.
 * Do not drop branch discriminants such as system-notice.type or invent defaults for them.
 */
export function clientEventJson<Event extends ClientEvent>(
  event: Event,
  contactField: number,
  partyInviteIdentity = false,
): ClientEventJson<Event> {
  if (event.kind === "trade") {
    return {
      t: "trade",
      event: miniRoomEventJson(event.event),
    } as ClientEventJson<Event>;
  }

  const { kind, ...rest } = event;
  // The projection is a mechanical `kind` -> `t` rename except for the explicitly JSON-safe
  // MiniRoom item projection above. The assertion retains each union member's discriminator.
  return {
    t: kind,
    ...rest,
    ...(kind === "field"
      ? { contactField, playerMenu: true, socialCommands: true, partyInviteIdentity, trade: true }
      : {}),
  } as ClientEventJson<Event>;
}
