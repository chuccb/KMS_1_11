/** Real HTML/edit/modal/canvas/original PNGs. No account/session/WS or gameplay. */
import { chatEntry } from "../../../client/chat-entry.ts";
import { runSocialCommand } from "../../../client/social-commands.ts";
import { itemDialogs } from "../../../client/itemdialogs.ts";
import { partyInvitation } from "../../../client/party-invitation.ts";
import { archiveImages } from "../../../client/image-cache.ts";
import { requireElement, requireContext2d } from "../../../client/dom.ts";
export function installSocialFixture() {
  const canvas = requireElement("view", "canvas"),
    input = requireElement("say", "input");
  canvas.width = 800;
  canvas.height = 600;
  const ctx = requireContext2d(canvas),
    images = archiveImages(),
    calls: unknown[] = [];
  const entry = chatEntry({
    input,
    onFocus: () => calls.push("focus"),
    command: (text) => {
      if (
        runSocialCommand(text, {
          party: (command, name) => calls.push({ party: command, name }),
          request: (name, text) => calls.push({ private: name, text }),
          trade: (name) => calls.push({ trade: name }),
          error: (message) => calls.push({ error: message }),
        })
      )
        return true;
      if (text.startsWith("/")) {
        calls.push({ error: "unknown" });
        return true;
      }
      return false;
    },
    send: (text) => calls.push({ public: text }),
  });
  const modal = itemDialogs({
    ctx,
    image: (path) => images.get(path),
    audio: { effect: () => {} },
  });
  let owner: object | undefined = {},
    available = true;
  const prompt = partyInvitation({
    modal,
    context: () => owner,
    canOpen: () => !modal.open,
    available: () => available,
    reply: (id, accepted) => calls.push({ reply: id, accepted }),
    unavailable: () => calls.push({ error: "unverified" }),
  });
  return {
    calls: () => calls,
    async warm() {
      await Promise.all(
        [
          "UI/Basic.img/YesNo/backgrnd",
          "UI/Basic.img/Notice/backgrnd",
          "UI/Basic.img/BtOK/normal/0",
          "UI/Basic.img/BtYes/normal/0",
          "UI/Basic.img/BtNo/normal/0",
        ].map((path) => images.get(path).loading),
      );
    },
    offer: (id: number) => prompt.offer(id, "상대이름"),
    paint() {
      modal.draw();
      return {
        open: modal.open,
        pending: prompt.pending,
        question: requireElement("item-question", "p").textContent,
      };
    },
    membership() {
      prompt.membershipChanged(true);
    },
    changeContext() {
      owner = {};
    },
    deny() {
      available = false;
    },
    notice() {
      modal.notice({ text: "Other owner", accept: () => calls.push("other accepted") });
    },
    close() {
      modal.close(false);
    },
    dispose() {
      entry.dispose();
      modal.close(false);
    },
  };
}
declare global {
  interface Window {
    socialFixture: ReturnType<typeof installSocialFixture>;
  }
}
