/** 531110: shared CUtilDlgEx outer frame, server dialogs use the Ex2 palette (5309B0).
 * Images are direct WZ canvases, not resized CSS boxes. Clip repeats before placing corners.
 */
export function drawUtilFrame(ctx, image, x, y, width, height, server = false) {
  const base = `UI/UIWindow.img/UtilDlgEx${server ? '2' : ''}/Border`;
  const stamp = (part, px, py) => {
    const art = image(`${base}/${part}`);
    if (art.ready) ctx.drawImage(art.img, px, py);
  };
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y + 13, width, height - 13);
  ctx.save();
  ctx.beginPath();ctx.rect(x + 7, y + 13, width - 15, height - 13);ctx.clip();
  for (let px = 7; px < width - 8; px += 4) {
    stamp(1, x + px, y + 13);stamp(6, x + px, y + height - 18);
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();ctx.rect(x, y + 31, width, Math.max(0, height - 49));ctx.clip();
  for (let py = 31; py < height - 18; py += 4) {
    stamp(3, x, y + py);stamp(4, x + width - 8, y + py);
  }
  ctx.restore();
  stamp(0, x, y + 13);stamp(2, x + width - 54, y);
  stamp(5, x, y + height - 18);stamp(7, x + width - 8, y + height - 18);
  ctx.restore();
}

/** 531FB0 has FOUR stack arguments (x,y,w,h), ret 10h. The .c's extra arguments are
 * decompiler artefacts. These seven FillRects are from the .lst stack slots/push order.
 */
export function utilTextFrameRects(x, y, width, height, server = false) {
  const colors = server
    ? ['#e4ddd3','#947c6a','#b39c7d','#d2c6ba','#f2eeea']
    : ['#d3dbe4','#6a8594','#7d98b3','#bac8d2','#eaeff2'];
  const rect = (x,y,width,height,color) => ({x,y,width,height,color});
  return [
    rect(x+1,y+1,width-2,height-2,colors[0]),
    rect(x,y,width-1,1,colors[1]),
    rect(x,y+1,1,height-2,colors[2]),
    rect(x,y+height-1,1,1,colors[3]),
    rect(x+width-1,y,1,1,colors[3]),
    rect(x+1,y+height-1,width-1,1,colors[4]),
    rect(x+width-1,y+1,1,height-2,colors[4]),
  ];
}
export function drawUtilTextFrame(ctx,x,y,width,height,server = false) {
  for(const rect of utilTextFrameRects(x,y,width,height,server)) {
    ctx.fillStyle=rect.color;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
  }
}
