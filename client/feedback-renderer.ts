/** CUIScreenMsg: 290×14 clipped rows, right-aligned white font0 + black font1 (1,1) shadow.
 * Browser Gulim/KMSCJK metrics remain a platform approximation, not original IWzFont/GDI pixels.
 */
import { SCREEN_MESSAGES, type ScreenMessageRow } from "./feedback-data.ts";
export function drawScreenMessages(
  ctx: CanvasRenderingContext2D,
  rows: readonly ScreenMessageRow[],
): void {
  ctx.save();
  try {
    ctx.font = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    for (const row of rows) {
      if (row.alpha <= 0) continue;
      ctx.save();
      try {
        ctx.globalAlpha *= row.alpha;
        ctx.beginPath();
        ctx.rect(row.x, row.y, SCREEN_MESSAGES.width, SCREEN_MESSAGES.height);
        ctx.clip();
        ctx.fillStyle = "#000000";
        ctx.fillText(row.text, row.x + SCREEN_MESSAGES.width + 1, row.y + 1);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(row.text, row.x + SCREEN_MESSAGES.width, row.y);
      } finally {
        ctx.restore();
      }
    }
  } finally {
    ctx.restore();
  }
}
