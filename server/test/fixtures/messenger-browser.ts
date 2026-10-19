/** Real canvas + production modal markup + original Messenger PNGs. No account/session/WS/gameplay. */
import { itemDialogs } from "../../../client/itemdialogs.ts";
import { archiveImages, avatarImages } from "../../../client/image-cache.ts";
import { requireElement, requireContext2d } from "../../../client/dom.ts";
import { messengerRenderer, messengerWindowAt } from "../../../client/messenger-window.ts";
import {
  MESSENGER_TEXT,
  MESSENGER_WINDOW,
  messengerLogScroller,
  messengerState,
  type MessengerRoomState,
} from "../../../client/messenger-state.ts";

/** The three fixture members, shared by `room()` and `warm()` so the avatars are loaded art. */
const MEMBER_LOOKS = [
  { face: 20001, hair: 30000, items: [1040001, 1072001] },
  { face: 20002, hair: 31000, items: [1041001, 1071001] },
  { face: 20003, hair: 32000, items: [1050001, 1070001] },
] as const;
const MEMBER_NAMES = ["갑", "을", "병"] as const;

export function installMessengerFixture() {
  const canvas = requireElement("view", "canvas");
  canvas.width = 800;
  canvas.height = 600;
  const ctx = requireContext2d(canvas),
    images = archiveImages(),
    avatars = avatarImages(),
    calls: unknown[] = [];
  const renderer = messengerRenderer({
    ctx,
    image: (path) => images.get(path),
    avatars: (look, flip) => avatars.get(look, "stand1", 0, flip),
  });
  const modal = itemDialogs({
    ctx,
    image: (path) => images.get(path),
    audio: { effect: () => {} },
  });
  const state = messengerState();
  const scroll = messengerLogScroller();
  const at = { ...MESSENGER_WINDOW.home };
  return {
    calls: () => calls,
    state,
    scroll,
    at,
    hit(x: number, y: number) {
      return messengerWindowAt(x, y, at, true, scroll);
    },
    render(room: MessengerRoomState | undefined) {
      ctx.clearRect(0, 0, 800, 600);
      renderer.draw(at, room, {}, scroll);
    },
    /** Whether the stand1 frame-0 art of a member look has arrived (the tint needs real pixels). */
    avatarReady(look: { face: number; hair: number; items: readonly number[] }) {
      return avatars.get(look, "stand1", 0, false).ready;
    },
    pixel(x: number, y: number) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    },
    /** A three-cell room through the real model, with `rows` log lines and an optional typing cell. */
    room(rows: number, typing = -1): MessengerRoomState | undefined {
      const model = messengerState();
      model.openLocal();
      const members = MEMBER_LOOKS.map((look, slot) => ({
        slot,
        name: MEMBER_NAMES[slot] as string,
        level: 30 - 5 * slot,
        face: look.face,
        look: [look.hair, ...look.items],
      }));
      for (const member of members)
        model.receive({ kind: "participant", announce: false, participant: member });
      for (let i = 0; i < rows; i++) model.receive({ kind: "chat", line: `갑 : 줄 ${i}` });
      if (typing >= 0) model.receive({ kind: "chat", line: `${members[typing]!.name}1` });
      return model.room;
    },
    /** sub_4E1BB0's box through the shared CUtilDlgEx modal; yes re-sends the carried roomId. */
    invite(name: string, roomId: number) {
      return modal.confirm({
        text: MESSENGER_TEXT.inviteModal(name),
        accept: () => calls.push({ accept: roomId }),
        reject: () => calls.push({ reject: roomId }),
      });
    },
    question() {
      return requireElement("item-question", "p").textContent ?? "";
    },
    clickYes() {
      requireElement("item-dialog-ok", "button").click();
    },
    async warm() {
      await Promise.all([
        ...[
          MESSENGER_WINDOW.backgrnd,
          MESSENGER_WINDOW.charView.path,
          ...["prev0", "prev1", "next0", "next1", "base", "thumb0", "thumb1"].map(
            (cell) => `UI/Basic.img/VScr/enabled/${cell}`,
          ),
          ...["prev", "next", "base"].map((cell) => `UI/Basic.img/VScr/disabled/${cell}`),
          "UI/UIWindow.img/BtUIClose/normal/0",
          "UI/UIWindow.img/BtUIClose/mouseOver/0",
          "UI/UIWindow.img/BtUIClose/pressed/0",
          "UI/Basic.img/YesNo/backgrnd",
          "UI/Basic.img/BtYes/normal/0",
          "UI/Basic.img/BtNo/normal/0",
        ].map((path) => images.get(path).loading),
        // The member avatars the tint assertion paints with (stand1 frame 0, unflipped).
        ...MEMBER_LOOKS.map((look) => avatars.get(look, "stand1", 0, false).loading),
      ]);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    },
  };
}

export type MessengerFixture = ReturnType<typeof installMessengerFixture>;
