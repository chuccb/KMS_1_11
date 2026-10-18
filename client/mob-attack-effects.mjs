/** 488E30 -> 4862C0 -> 50DEC0. World art only: intentionally no HP, damage RNG or hit reporting.
 * One 30ms collision sample per displayed update (no synthetic catch-up hits after a hidden tab).
 * Created effects are independent world layers; pending missiles are still owned by their mob.
 */
import {playerContactRect,intersects} from './contact.mjs';
import {planMobBall,mobBallPoint,mobAttackRect,mobAttackHitsRect,mobAttackName} from './mob-attacks.mjs';
export function mobAttackEffects({metadata,emit}){
  const pending=[];let serial=0;
  function hit(attack,actor,at){if(attack.hit?.length)emit({kind:'hit',actorId:actor.id,frames:attack.hit,start:at,flip:actor.facing===0,x:actor.x,y:actor.y-30});}
  return {
    clear(){pending.length=0;},
    remove(owner){for(let i=pending.length-1;i>=0;i--)if(pending[i].owner===owner)pending.splice(i,1);},
    put(owner,templateId,action,facing,value,origin,start){
      if(!mobAttackName(action))return;
      // Browser memory policy, not a native queue constant. Never run an evicted attack later.
      if(pending.length>=512)pending.shift();
      for(const r of pending)if(r.owner===owner&&!r.effectDone)r.effectDone=true;
      pending.push({id:++serial,owner,templateId,action,facing,value,origin:{...origin},start,tick:-1});
    },
    step(now,owners,actors){
      const balls=[];
      for(let i=0;i<pending.length;i++){
        const r=pending[i],owner=owners.get(r.owner);
        if(!owner){pending.splice(i--,1);continue;}
        if(!r.attack){
          const data=metadata(r.templateId);if(!data)continue;
          r.attack=data.attacks?.find(a=>a.action===r.action);
          if(!r.attack){pending.splice(i--,1);continue;}
          const a=r.attack;r.ball=planMobBall(a,r.origin,r.facing,r.value,r.start);
          if(!r.ball&&a.type!==0){
            const actor=actors.find(p=>p.id===(r.value>>>0));
            const rect=actor&&playerContactRect(actor),sp={x:r.origin.x+(r.facing?a.sp.x:-a.sp.x),y:r.origin.y+a.sp.y};
            const closest=rect&&{x:Math.max(rect.left,Math.min(rect.right,sp.x)),y:Math.max(rect.top,Math.min(rect.bottom,sp.y))};
            r.target=closest&&Math.hypot(closest.x-sp.x,closest.y-sp.y)<=a.radius?actor.id:undefined;
          }
        }
        const a=r.attack;
        if(!r.effectDone&&now>=r.start+a.effectAfter){
          r.effectDone=true;
          if(a.effect.length&&now<r.start+a.effectAfter+a.effect.reduce((n,f)=>n+f.delay,0))emit({kind:'effect',owner:r.owner,frames:a.effect,start:r.start+a.effectAfter,flip:r.facing===0,x:owner.x,y:owner.y});
        }
        const tick=Math.floor((now-r.start)/30);
        if(r.ball){
          const point=mobBallPoint(r.ball,now);
          if(point){
            r.drawing??={id:r.id,owner:r.owner,frames:r.ball.frames,start:r.ball.start};
            Object.assign(r.drawing,point);balls.push(r.drawing);
            if(tick!==r.tick)for(const actor of actors)if(mobAttackHitsRect(point,playerContactRect(actor,actor.previous)))hit(a,actor,now);
          }
          r.attackDone=now>=r.ball.endAt;
        }else if(!r.attackDone&&now>=r.start+a.attackAfter){
          r.attackDone=true;
          if(now>=r.start+a.attackAfter+30)continue; // No retrospective collision from a cold load/hidden tab.
          if(a.type===0){
            const rect=mobAttackRect(a,r.origin,r.facing);
            for(const actor of actors)if(intersects(rect,playerContactRect(actor,actor.previous)))hit(a,actor,now);
          }else{
            const actor=actors.find(p=>p.id===r.target);if(actor)hit(a,actor,now);
          }
        }
        r.tick=tick;
        if(r.effectDone&&r.attackDone)pending.splice(i--,1);
      }
      return balls;
    },
    get size(){return pending.length;},
  };
}
