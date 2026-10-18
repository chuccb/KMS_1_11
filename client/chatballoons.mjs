import {balloonLayout} from './chatlayout.mjs';
/** 50B320 -> 4373A0 -> 4386E0. One current 5000ms balloon per known user, fixed root z250210. */
export function chatBalloons({image}) {
  const records=new Map();
  const names=['nw','n','ne','w','c','e','sw','s','se','arrow'];
  for(const style of ['normal','dead'])for(const name of names)image(`UI/ChatBalloon.img/${style}/${name}`);
  document.fonts?.addEventListener('loadingdone',()=>{for(const r of records.values()){delete r.normalLayout;delete r.deadLayout;}});
  return {
    put(id,text,now){records.set(id,{text:String(text).trim(),until:now+5000});},
    clear(){records.clear();},remove(id){records.delete(id);},
    active(now){for(const [id,r] of records)if(now>=r.until)records.delete(id);return records.entries();},
    draw(ctx,id,x,y,originY,dead,now){
      const record=records.get(id);if(!record||now>=record.until||!Number.isFinite(originY))return;
      const style=dead?'dead':'normal',art=Object.fromEntries(names.map(k=>[k,image(`UI/ChatBalloon.img/${style}/${k}`)]));
      if(!names.every(k=>art[k].ready))return; // Never fake a missing WZ frame with a CSS bubble.
      ctx.save();ctx.font="12px 'Gulim','굴림','KMSCJK',sans-serif";ctx.textBaseline='top';ctx.textAlign='left';
      const key=dead?'deadLayout':'normalLayout';
      const at=record[key]??=balloonLayout(record.text,t=>ctx.measureText(t).width,dead);
      const left=Math.round(x+at.x),top=Math.round(y-originY-5+at.y);
      const stamp=(name,dx,dy)=>{ctx.globalAlpha=224/255;ctx.drawImage(art[name].img,left+dx,top+dy);ctx.globalAlpha=1;};
      stamp('nw',0,0);stamp('ne',at.width-6,0);stamp('sw',0,at.arrowY);stamp('se',at.width-6,at.arrowY);
      for(let i=0;i<at.columns;i++) {
        stamp('n',6+i*12,0);
        // Native arrow origin is (1,0) normal, (2,0) dead; replaces the central south cell.
        stamp(i===Math.floor(at.columns/2)?'arrow':'s',6+i*12-(i===Math.floor(at.columns/2)?(dead?2:1):0),at.arrowY);
        for(let row=0;row<at.lines.length;row++)stamp('c',6+i*12,6+row*14);
      }
      for(let row=0;row<at.lines.length;row++){
        stamp('w',0,6+row*14);stamp('e',at.width-6,6+row*14);
        ctx.fillStyle='#000000';const text=at.lines[row];
        ctx.fillText(text,left+6+Math.trunc((at.columns*12-ctx.measureText(text).width)/2),top+6+row*14);
      }
      ctx.restore();
    },
  };
}
