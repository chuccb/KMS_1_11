import type { ConfirmDialogOptions } from "./itemdialogs.ts";
import { partyInvitationText } from "./party.ts";
interface PartyModal {
  confirm(options: ConfirmDialogOptions): boolean;
  close(restoreFocus?: boolean, cancelled?: boolean): void;
}
/** Own only the party confirmation, not every shared item dialog. Field/death cancellation calls
 * its reject normally; a subsequent native membership update invalidates this ticket as well.
 * Old callbacks cannot answer a new offer, close another owner's dialog, or send twice.
 */
export function partyInvitation({
  modal,
  context,
  canOpen,
  available,
  reply,
  unavailable,
}: {
  modal: PartyModal;
  context(): object | undefined;
  canOpen(): boolean;
  available(): boolean;
  reply(inviterId: number, accepted: boolean): void;
  unavailable(): void;
}) {
  let active: { id: number; owner: object } | undefined;
  return {
    offer(id: number, name: string) {
      if (active) return; // first offer owns the modal; never reject a duplicate same-id ticket.
      if (!available()) {
        reply(id, false);
        unavailable();
        return;
      }
      const owner = context();
      if (!owner || !canOpen()) {
        reply(id, false);
        return;
      }
      const ticket = { id, owner };
      active = ticket;
      const finish = (accepted: boolean) => {
        if (active !== ticket) return;
        active = undefined;
        reply(id, accepted && context() === owner);
      };
      if (
        !modal.confirm({
          text: partyInvitationText(name),
          accept: () => finish(true),
          reject: () => finish(false),
        })
      )
        finish(false);
    },
    membershipChanged(inParty: boolean) {
      if (!inParty || !active) return;
      const ticket = active;
      active = undefined;
      modal.close(false, false);
      reply(ticket.id, false); // local-only: no invented native rejection opcode.
    },
    get pending() {
      return active?.id;
    },
  };
}
