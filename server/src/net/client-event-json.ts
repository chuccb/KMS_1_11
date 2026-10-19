import type { ClientEvent } from "../client/session.ts";
/** One receive-only JSON projection, shared by the real bridge and wire/feedback regressions.
 * Do not drop branch discriminants such as system-notice.type or invent defaults for them.
 */
export function clientEventJson(
  event: ClientEvent,
  contactField: number,
  partyInviteIdentity = false,
): Record<string, unknown> {
  const { kind, ...rest } = event;
  return {
    t: kind,
    ...rest,
    ...(kind === "field" ? { contactField, playerMenu: true, partyInviteIdentity } : {}),
  };
}
