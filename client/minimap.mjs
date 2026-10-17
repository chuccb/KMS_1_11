/** Original CUIMiniMap: sub_4E52C0, sub_4E5C70, sub_4E6430; config sub_43D750.
 * No modern map-name header, invented monster dots or rescaled whole-map thumbnail. */
export const MINI_FRAME = 'UI/UIWindow.img/MiniMap';
export function miniMapViewport(map, self) {
  const width=map.canvasWidth>=280?210:map.canvasWidth, height=map.canvasHeight>=150?112:map.canvasHeight;
  const unit=2**map.mag;
  // Native clamps low THEN high; preserve integer division / arithmetic shift semantics.
  const crop=(v,center,total,size)=>Math.floor((center+Math.min(Math.max(Math.trunc(v)-Math.trunc(size*unit/2),-center),total-center-size*unit))/unit);
  return {width,height,x:crop(self?.x??0,map.centerX,map.width,width),y:crop(self?.y??0,map.centerY,map.height,height)};
}
export function miniMapPoint(map, viewport, point) {
  const unit=2**map.mag;
  return {x:Math.floor((map.centerX+Math.trunc(point.x))/unit)-viewport.x,
    y:Math.floor((map.centerY+Math.trunc(point.y))/unit)-viewport.y};
}
/** Two overlapping rectangles are the ORIGINAL marker shapes/ARGB colors, not substitute icons. */
export function miniMapMarks(map, viewport, self, users=[], portals=[], tick=0) {
  const out=[], add=(p,color,kind)=>{
    const at=miniMapPoint(map,viewport,p);
    const shapes=kind==='portal'?[[at.x+1,at.y-2,4,6],[at.x,at.y-1,6,4]]:
      kind==='npc'?[[at.x+2,at.y-2,2,6],[at.x+1,at.y-1,4,5]]:
      [[at.x+2,at.y-2,2,6],[at.x+1,at.y-1,4,5]];
    for(const [x,y,w,h] of shapes)out.push({x,y,w,h,color,kind});
  };
  if(tick%128<64)for(let i=portals.length-1;i>=0;i--)if(portals[i].type===2)add(portals[i],'#8090ffcc','portal');
  if(tick%80<40)for(const p of map.npcs??[])add(p,'#20ff20aa','npc');
  for(const p of users)add(p,'#ff2020aa','user');
  if(self)add(self,'#ffff00dd','self');
  return out;
}
export function miniMapWindow({ctx,image,getSelf,getUsers,isInGame,point,isCovered}) {
  const root=document.getElementById('minimap-window');
  let map,portals=[],shown=true,at={x:8,y:8},drag,pointer,cache,cacheCtx,epoch=-1,clockAt,tick=0;
  try {const saved=JSON.parse(localStorage.getItem('kms111.minimap')??'null');
    if(saved){shown=saved.shown!==false;if(Number.isFinite(saved.x)&&Number.isFinite(saved.y))at={x:Math.max(0,Math.min(784,Math.round(saved.x))),y:Math.max(0,Math.min(584,Math.round(saved.y)))};}
  }catch{}
  const save=()=>{try{localStorage.setItem('kms111.minimap',JSON.stringify({...at,shown}));}catch{}};
  function sync(){
    const v=map?miniMapViewport(map,getSelf()):undefined;
    root.classList.toggle('hidden',!shown||!v||!isInGame());
    root.style.pointerEvents = !drag && pointer && isCovered?.(pointer) ? 'none' : 'auto';
    Object.assign(root.style,{left:`${at.x}px`,top:`${at.y}px`,width:`${(v?.width??0)+6}px`,height:`${(v?.height??0)+13}px`});
  }
  root.addEventListener('mousedown',e=>{if(!map||!shown||e.button>0)return;const p=point(e);drag={x:p.x-at.x,y:p.y-at.y};e.preventDefault();});
  window.addEventListener('mousemove',e=>{const p=point(e);pointer=p;if(!drag){sync();return;}at={x:Math.max(0,Math.min(784,Math.round(p.x-drag.x))),y:Math.max(0,Math.min(584,Math.round(p.y-drag.y)))};sync();});
  const release=()=>{if(drag){drag=undefined;save();}};
  window.addEventListener('mouseup',release);window.addEventListener('blur',release);
  const stamp=(name,x,y,w,h)=>{const a=image(`${MINI_FRAME}/${name}`);if(!a.ready)return false;
    if(w===undefined)cacheCtx.drawImage(a.img,x,y);else cacheCtx.drawImage(a.img,x,y,w,h);return true;};
  return {
    setMap(value,doors=[]){map=value;portals=doors;epoch=-1;clockAt=undefined;cache=undefined;sync();},
    toggle(){shown=!shown;save();sync();},
    get shown(){return shown;},
    draw(now){
      sync();if(!map||!isInGame()||!getSelf()){clockAt=undefined;return;}
      // sub_553F40 calls the registered updates through sub_549660 at 30ms intervals.
      // Accumulate by elapsed time, not RAF count. A hidden-but-loaded native window still updates.
      clockAt ??= now;
      const steps=Math.max(0,Math.floor((now-clockAt)/30));tick+=steps;clockAt+=steps*30;
      if(!shown)return;
      const nextEpoch=Math.floor(tick/4),v=miniMapViewport(map,getSelf());
      const bitmap=image(map.path);
      const ready=bitmap.ready&&['nw','n','ne','w','e','sw','s','se'].every(k=>image(`${MINI_FRAME}/${k}`).ready);
      if(!ready)return;
      if(!cache){cache=document.createElement('canvas');cache.width=v.width+6;cache.height=v.height+13;cacheCtx=cache.getContext('2d');cacheCtx.imageSmoothingEnabled=false;}
      if(epoch!==nextEpoch){
        epoch=nextEpoch;cacheCtx.clearRect(0,0,cache.width,cache.height);
        // sub_4E5C70 clears white, overlays ARGB A0000000, then copies the original bitmap at 1:1.
        cacheCtx.fillStyle='#ffffff';cacheCtx.fillRect(3,3,v.width,v.height);
        cacheCtx.fillStyle='#000000a0';cacheCtx.fillRect(3,3,v.width,v.height);
        cacheCtx.save();cacheCtx.beginPath();cacheCtx.rect(3,3,v.width,v.height);cacheCtx.clip();
        cacheCtx.drawImage(bitmap.img,v.x,v.y,v.width,v.height,3,3,v.width,v.height);
        // Native establishes the same content clip for both bitmap and marker rectangles.
        for(const m of miniMapMarks(map,v,getSelf(),getUsers(),portals,tick)){cacheCtx.fillStyle=m.color;cacheCtx.fillRect(m.x,m.y,m.w,m.h);}
        cacheCtx.restore();
        stamp('n',4,0,v.width-2,3);stamp('s',4,v.height+3,v.width-2,3);
        stamp('w',0,4,3,v.height-2);stamp('e',v.width+3,4,3,v.height-2);
        stamp('nw',0,0);stamp('ne',v.width+2,0);stamp('sw',0,v.height+2);stamp('se',v.width+2,v.height+2);
      }
      ctx.drawImage(cache,at.x,at.y);
    },
  };
}
