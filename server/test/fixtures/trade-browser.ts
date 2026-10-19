/** Real canvas + production modal markup + original Trade PNGs. No account/session/WS/gameplay. */
import { itemDialogs } from "../../../client/itemdialogs.ts";
import { archiveImages, avatarImages } from "../../../client/image-cache.ts";
import { requireElement, requireContext2d } from "../../../client/dom.ts";
import { tradeRenderer, tradeWindowAt } from "../../../client/trade-window.ts";
import {
  TRADE_TEXT,
  TRADE_WINDOW,
  tradeState,
  type TradeRoomState,
} from "../../../client/trade-state.ts";

export function installTradeFixture() {
  const canvas = requireElement("view", "canvas");
  canvas.width = 800;
  canvas.height = 600;
  const ctx = requireContext2d(canvas),
    images = archiveImages(),
    avatars = avatarImages(),
    calls: unknown[] = [];
  const renderer = tradeRenderer({
    ctx,
    image: (path) => images.get(path),
    avatars: (look, flip) => avatars.get(look, "stand1", 0, flip),
    icon: () => ({ img: new Image(), ready: false }),
  });
  const modal = itemDialogs({
    ctx,
    image: (path) => images.get(path),
    audio: { effect: () => {} },
  });
  const state = tradeState();
  const at = { ...TRADE_WINDOW.home };
  return {
    calls: () => calls,
    state,
    at,
    hit(x: number, y: number) {
      return tradeWindowAt(x, y, at, state.room);
    },
    render(room: TradeRoomState | undefined) {
      ctx.clearRect(0, 0, 800, 600);
      renderer.draw(at, room, {});
    },
    pixel(x: number, y: number) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    },
    /** sub_481910's box through the shared CUtilDlgEx modal. */
    invite(name: string) {
      return modal.confirm({
        text: TRADE_TEXT.invite(name),
        accept: () => calls.push({ accept: name }),
        reject: () => calls.push({ reject: name }),
      });
    },
    question() {
      return requireElement("item-question", "p").textContent ?? "";
    },
    clickYes() {
      requireElement("item-dialog-ok", "button").click();
    },
    async warm() {
      await Promise.all(
        [
          TRADE_WINDOW.path,
          "UI/UIWindow.img/BtUIClose/normal/0",
          "UI/UIWindow.img/Trade/BtTrade/normal/0",
          "UI/UIWindow.img/Trade/BtCoin/normal/0",
          "UI/Basic.img/YesNo/backgrnd",
          "UI/Basic.img/BtYes/normal/0",
          "UI/Basic.img/BtNo/normal/0",
        ].map((path) => images.get(path).loading),
      );
    },
  };
}
export type TradeFixture = ReturnType<typeof installTradeFixture>;
