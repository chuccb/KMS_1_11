import type { ImageLookup } from "./render-types.ts";
import {
  frameBodyTop,
  frameBottomInset,
  frameSprite,
  UTIL_DLG_FRAME,
  type UiFramePiece,
} from "./uiframe.ts";
/** 531110: shared CUtilDlgEx outer frame, server dialogs use the Ex2 palette (5309B0).
 * Images are direct WZ canvases, not resized CSS boxes. Clip repeats before placing corners.
 *
 * Every offset below is read off the eight `Border` cells rather than written out: the 13 is
 * `topRight.height - topLeft.height`, the 7/54/8 are the corners' and the right border's widths,
 * the 4 is the edge fills' own size and the 18 is what the three bottom pieces share.
 * (`client/uiframe.ts` carries the measurements; `server/test/ui-frame.test.ts` re-measures them.)
 */
export function drawUtilFrame(
  ctx: CanvasRenderingContext2D,
  image: ImageLookup,
  x: number,
  y: number,
  width: number,
  height: number,
  server = false,
) {
  const frame = UTIL_DLG_FRAME;
  const body = frameBodyTop(frame),
    inset = frame.topRight.height,
    bottom = frameBottomInset(frame);
  const stamp = (piece: UiFramePiece, px: number, py: number) => {
    const art = image(frameSprite(server, piece));
    if (art.ready) ctx.drawImage(art.img, px, py);
  };
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y + body, width, height - body);
  // This clip is load-bearing: the fill tiles run until their own 4px cell would cross the right
  // border, so on most widths the last one hangs over it by up to three pixels.
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    x + frame.topLeft.width,
    y + body,
    width - frame.topLeft.width - frame.right.width,
    height - body,
  );
  ctx.clip();
  // The top and the bottom edge fill together, from the left corner to where the right border is.
  for (let px = frame.topLeft.width; px < width - frame.right.width; px += frame.top.width) {
    stamp(frame.top, x + px, y + body);
    stamp(frame.bottom, x + px, y + height - bottom);
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + inset, width, Math.max(0, height - inset - bottom));
  ctx.clip();
  // The two side edges, from under the top strip to where the bottom border starts.
  for (let py = inset; py < height - bottom; py += frame.left.height) {
    stamp(frame.left, x, y + py);
    stamp(frame.right, x + width - frame.right.width, y + py);
  }
  ctx.restore();
  // The four corners last, so they cover the ends of the fills they meet.
  stamp(frame.topLeft, x, y + body);
  stamp(frame.topRight, x + width - frame.topRight.width, y);
  stamp(frame.bottomLeft, x, y + height - bottom);
  stamp(frame.bottomRight, x + width - frame.bottomRight.width, y + height - bottom);
  ctx.restore();
}

/** 531FB0 has FOUR stack arguments (x,y,w,h), ret 10h. The .c's extra arguments are
 * decompiler artefacts. These seven FillRects are from the .lst stack slots/push order.
 */
export function utilTextFrameRects(
  x: number,
  y: number,
  width: number,
  height: number,
  server = false,
) {
  const colors = server
    ? ["#e4ddd3", "#947c6a", "#b39c7d", "#d2c6ba", "#f2eeea"]
    : ["#d3dbe4", "#6a8594", "#7d98b3", "#bac8d2", "#eaeff2"];
  const rect = (x: number, y: number, width: number, height: number, color: string) => ({
    x,
    y,
    width,
    height,
    color,
  });
  return [
    rect(x + 1, y + 1, width - 2, height - 2, colors[0]),
    rect(x, y, width - 1, 1, colors[1]),
    rect(x, y + 1, 1, height - 2, colors[2]),
    rect(x, y + height - 1, 1, 1, colors[3]),
    rect(x + width - 1, y, 1, 1, colors[3]),
    rect(x + 1, y + height - 1, width - 1, 1, colors[4]),
    rect(x + width - 1, y + 1, 1, height - 2, colors[4]),
  ];
}
export function drawUtilTextFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  server = false,
) {
  for (const rect of utilTextFrameRects(x, y, width, height, server)) {
    ctx.fillStyle = rect.color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
}
