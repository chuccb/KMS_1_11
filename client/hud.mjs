/** CUIStatusBar 4FA5E0/4FB440 and CField 46DA30, KMS 1.11 (not modern UI). */
export const HUD_FONT = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
export const STATUS_GAUGES = Object.freeze({
  hp: { x: 49, y: 143, w: 163, h: 16 },
  mp: { x: 49, y: 162, w: 163, h: 16 },
  exp: { x: 50, y: 190, w: 151, h: 8 },
});
export function gaugeFill(width, value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.trunc(width * Math.max(0, Math.min(value, max)) / max);
}
export function expPercent(value, max) { return gaugeFill(100, value, max); }

/** Native title is a separate 40px-high layer, anchored (799-width,3), not a minimap header.
 * WZ marks have 38x38 pixels. Gulim BA/16 white font + black offset shadow; browser font metrics differ.
 */
export function mapTitleLayout(streetWidth, mapWidth, hasMark) {
  const space = hasMark ? 40 : 0;
  const width = Math.max(streetWidth, mapWidth) + space + 4;
  return { x: 799 - width, y: 3, width, height: 40,
    streetX: width - streetWidth - space - 2,
    mapX: width - mapWidth - space - 2, markX: width - 39 };
}
export function drawMapTitle(ctx, image, title) {
  if (!title || (!title.streetName && !title.mapName)) return;
  ctx.save();
  ctx.font = "bold 16px 'Gulim', '굴림', 'KMSCJK', sans-serif";
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const at = mapTitleLayout(ctx.measureText(title.streetName).width,
    ctx.measureText(title.mapName).width, !!title.mark);
  for (const [text, x, y] of [[title.streetName, at.streetX, 1], [title.mapName, at.mapX, 21]]) {
    ctx.fillStyle = '#000000'; ctx.fillText(text, at.x + x + 1, at.y + y + 1);
    ctx.fillStyle = '#ffffff'; ctx.fillText(text, at.x + x, at.y + y);
  }
  if (title.mark) {
    const mark = image(title.mark.path);
    if (mark.ready) ctx.drawImage(mark.img, at.x + at.markX, at.y);
  }
  ctx.restore();
}

/** 4FC440 -> 525AE0, zero spacing: advance by each ORIGINAL ItemNo canvas width. */
export function drawItemCount(ctx, image, value, x, y) {
  const digits = Array.from(String(Math.max(0, Math.trunc(value))), digit => image(`UI/Basic.img/ItemNo/${digit}`));
  if (!digits.every(d => d.ready)) return; // Never paint later digits at a wrong x while loading.
  for (const digit of digits) {
    ctx.drawImage(digit.img, x, y);
    x += digit.img.naturalWidth;
  }
}
/** 4F9AD0 strict hit rectangles; the EXP target includes its label, not just coloured pixels. */
export function statusVitalText(x, y, self, totals) {
  const localY = y - 392;
  if (x > 4 && x < 212 && localY > 143 && localY < 159) return `HP : ${self.hp} / ${totals.maxHp}`;
  if (x > 4 && x < 212 && localY > 162 && localY < 178) return `MP : ${self.mp} / ${totals.maxMp}`;
  if (x > 10 && x < 206 && localY > 190 && localY < 198) return `EXP : ${self.exp} / ${self.expToNext ?? 0}`;
  return undefined;
}
