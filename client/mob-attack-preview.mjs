/** Explicit developer-only WZ viewer. Uses the live game's pure rules but its OWN actor, clock,
 * metadata request, effect queue and canvas. No character mutations, sounds, sends or gameplay RNG.
 */
import {nativeMobActions} from './mob-reaction.mjs';
import {chooseMobAttack} from './mob-attacks.mjs';
import {mobAttackEffects} from './mob-attack-effects.mjs';
import {animationFrame} from './animation.mjs';
export function mobAttackPreview({canvas,image}){
  let generation=0,request,data,selected,error,key,start,retryAt=0;
  const layers=[],owners=new Map(),fx=mobAttackEffects({metadata:()=>data,emit:e=>layers.push(e)});
  function reset(){generation++;request?.abort();request=undefined;selected=undefined;data=undefined;error=undefined;key=undefined;start=undefined;retryAt=0;fx.clear();owners.clear();layers.length=0;canvas?.getContext?.('2d')?.clearRect(0,0,canvas.width,canvas.height);}
  function load(id,now){
    if(selected===id&&(data||request||now<retryAt))return;
    request?.abort();const token=++generation;selected=id;data=undefined;error=undefined;key=undefined;
    request=new AbortController();const signal=request.signal;
    fetch(`/api/mob/${id}`,{signal}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}).then(result=>{
      if(token!==generation)return;data={...result,actions:nativeMobActions(result.actions??{})};start=undefined;
      for(const frames of Object.values(data.actions))for(const f of frames)image(f.path);
      for(const a of data.attacks??[])for(const frames of [a.effect,a.ball,a.hit])for(const f of frames)image(f.path);
    }).catch(e=>{if(token===generation&&e.name!=='AbortError'){error=String(e);retryAt=performance.now()+5000;}})
      .finally(()=>{if(token===generation)request=undefined;});
  }
  function draw(painter,frame,x,y,flip){
    if(!frame)return;const art=image(frame.path);if(!art?.ready)return;
    painter.save();painter.globalAlpha=frame.alpha??1;painter.translate(Math.round(x),Math.round(y));
    if(flip)painter.scale(-1,1);painter.drawImage(art.img,-frame.ox,-frame.oy);painter.restore();
  }
  return {reset,draw(now,{id,action,left,chain}){
    const painter=canvas?.getContext?.('2d');if(!painter)return '閱覽畫布不可用。';
    painter.clearRect(0,0,canvas.width,canvas.height);painter.imageSmoothingEnabled=false;
    if(!/^\d{1,7}$/.test(id))return '請填入原WZ怪物ID（1–7位數）。';
    load(Number(id),now);if(!data)return error?`無法讀取 ${id}：${error}；5秒後重試，不補假素材。`:'原WZ metadata載入中…';
    const frames=data.actions[action];if(!frames?.length)return `${id} 沒有 ${action}，不以其他動作假代。`;
    const attack=data.attacks?.find(a=>a.name===action),bodyMs=frames.reduce((n,f)=>n+f.delay,0);
    const span=chain&&attack?Math.max(bodyMs,attack.effectAfter+attack.effect.reduce((n,f)=>n+f.delay,0),attack.attackAfter+(attack.ball.length?(attack.radius??0)*10:0)+attack.hit.reduce((n,f)=>n+f.delay,0))+500:bodyMs+400;
    const nextKey=`${id}|${action}|${left}|${chain}`,facing=left?1:0;
    const owner={x:left?350:95,y:200,facing},actor={id:1,characterId:1,x:left?140:280,y:200,facing:facing^1};
    owners.set('preview',owner);
    if(key!==nextKey||start===undefined||now-start>=span){
      key=nextKey;start=now;fx.clear();layers.length=0;
      if(chain&&attack){
        const choice=chooseMobAttack([attack],owner,actor,data.maxMP??0,()=>0);
        if(choice)fx.put('preview',Number(id),attack.action,choice.facing,choice.value,owner,start);
      }
    }
    painter.strokeStyle='#6a7885';painter.setLineDash([3,3]);painter.strokeRect(actor.x-22,actor.y-65,44,65);painter.setLineDash([]);
    painter.fillStyle='#465568';painter.font='12px sans-serif';painter.fillText('唯讀玩家判定框',actor.x-44,actor.y+18);
    const elapsed=now-start;
    const body=chain&&attack&&elapsed>=bodyMs?animationFrame(data.actions.stand??data.actions.move,elapsed-bodyMs):animationFrame(frames,elapsed,false);
    draw(painter,body,owner.x,owner.y,facing===0);
    for(const b of fx.step(now,owners,[actor]))draw(painter,animationFrame(b.frames,now-b.start),b.x,b.y,false);
    for(let i=0;i<layers.length;i++){const e=layers[i];if(now>=e.start+e.frames.reduce((n,f)=>n+f.delay,0)){layers.splice(i--,1);continue;}
      draw(painter,animationFrame(e.frames,now-e.start,false),e.kind==='effect'?owner.x:actor.x,e.kind==='effect'?owner.y:actor.y-30,e.flip);
    }
    return `${id} / ${action}：raw ${frames.reduce((n,f)=>n+(f.rawDelay??f.delay),0)}ms／body ${bodyMs}ms；MP ${data.maxMP??0}／pushed ${data.pushed??1}。`+
      (attack?` 原info type${attack.type}、conMP ${attack.conMP}、effectAfter ${attack.effectAfter}ms、attackAfter ${attack.attackAfter}ms、r ${attack.radius??'—'}。命中只播放原hit圖，不扣HP。`:'此動作沒有有效原attack/info，只看身體圖，不生成攻擊。');
  }};
}
