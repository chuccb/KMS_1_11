import {HUD_FONT} from './hud.mjs';

/** CUIToolTip 502CE0: 799/599 boundary, ARGB A0000040 fill, four transparent corner pixels.
 * a5 additionally cuts the inset keyline with 00FFFFFF; it is NOT an opaque blue/grey outline.
 * Draw holes in the path, not clearRect on the already-painted world/UI beneath the tooltip.
 */
export function tooltipPosition(x, y, width, height) {
  return {x: Math.max(0, Math.min(Math.round(x), 799 - width)),
    y: Math.max(0, Math.min(Math.round(y), 599 - height))};
}
export function drawTooltipFrame(ctx, x, y, width, height, keyline = false) {
  ctx.beginPath();
  ctx.moveTo(x + 1, y); ctx.lineTo(x + width - 1, y);
  ctx.lineTo(x + width - 1, y + 1); ctx.lineTo(x + width, y + 1);
  ctx.lineTo(x + width, y + height - 1); ctx.lineTo(x + width - 1, y + height - 1);
  ctx.lineTo(x + width - 1, y + height); ctx.lineTo(x + 1, y + height);
  ctx.lineTo(x + 1, y + height - 1); ctx.lineTo(x, y + height - 1);
  ctx.lineTo(x, y + 1); ctx.lineTo(x + 1, y + 1); ctx.closePath();
  if (keyline && width > 4 && height > 4) {
    ctx.rect(x + 1, y + 2, 1, height - 4);
    ctx.rect(x + width - 2, y + 2, 1, height - 4);
    ctx.rect(x + 2, y + 1, width - 4, 1);
    ctx.rect(x + 2, y + height - 2, width - 4, 1);
  }
  ctx.fillStyle = 'rgba(0,0,64,0.6274509803921569)';
  ctx.fill('evenodd');
}

/** Defensive browser wrapping for the existing compact item/skill descriptions. The complete
 * native per-item/skill font, icon and requirement layout remains separate work, not claimed here.
 * Simple status text uses 500F50's font 172 (Gulim 12), text (4,3), +8 width / +6 font height.
 */
export function tooltipRows(lines, measure, maxWidth) {
  const result = [];
  for (const text of lines) {
    for (const line of String(text).replace(/\\r\\n|\\n|\\r/g, '\n').split(/\r\n|\r|\n/)) {
      let row = '';
      for (const c of line) {
        if (row && measure(row + c) > maxWidth) { result.push(row); row = ''; }
        row += c;
      }
      result.push(row);
    }
  }
  return result;
}
export function drawTextTooltip(ctx, x, y, lines, {maxWidth = 270, keyline = false} = {}) {
  if (!lines.length) return;
  ctx.save();
  ctx.font = HUD_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const rows = tooltipRows(lines, text => ctx.measureText(text).width, Math.max(1, maxWidth - 8));
  // Oversized descriptions are clipped rather than allowed to put the entire box off-screen.
  const height = Math.min(598, rows.length * 14 + 4);
  const width = Math.max(8, Math.min(maxWidth, Math.ceil(rows.reduce((max, text) => Math.max(max, ctx.measureText(text).width), 0)) + 8));
  const at = tooltipPosition(x, y, width, height);
  drawTooltipFrame(ctx, at.x, at.y, width, height, keyline);
  ctx.beginPath(); ctx.rect(at.x + 3, at.y + 3, width - 6, height - 6); ctx.clip();
  ctx.fillStyle = '#ffffff';
  rows.forEach((line, i) => ctx.fillText(line, at.x + 4, at.y + 3 + i * 14));
  ctx.restore();
}

/** 500F50 simple name tip, not an item-stat panel: font172, text(4,3), width+8/height+6.
 * Font height is measured at runtime, like 505530; Canvas fallback metrics are not native GDI.
 */
export function drawSimpleTooltip(ctx,x,y,text,{font=HUD_FONT,fontHeight}={}) {
  if(!text)return;
  ctx.save();ctx.font=font;ctx.textAlign='left';ctx.textBaseline='top';
  const metrics=ctx.measureText(text),lineHeight=metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent;
  const measuredHeight=Number.isFinite(lineHeight)&&lineHeight>0?Math.ceil(lineHeight):13;
  const width=Math.max(8,Math.min(799,Math.ceil(metrics.width)+8)),height=(fontHeight??measuredHeight)+6;
  const at=tooltipPosition(x,y,width,height);
  drawTooltipFrame(ctx,at.x,at.y,width,height);
  ctx.beginPath();ctx.rect(at.x+3,at.y+3,width-6,height-6);ctx.clip();
  ctx.fillStyle='#ffffff';ctx.fillText(text,at.x+4,at.y+3);ctx.restore();
}
