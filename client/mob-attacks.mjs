/** CMob 487D10/488220/488E30 and CUser 50DEC0, NOT a later MapleStory damage model.
 * Native attack-hit callback creates art only; HP/contact stays in 511C60/4C8ED0.
 */
import {intersects,playerContactRect} from './contact.mjs';
export const MOB_BODY_ACTIONS=['move','stand','jump','fly','magic','throw','ball1','ball2','hit1','hit2','hitF','attack1','attack2','attackF'];
export const mobAttackName=action=>({10:'attack1',11:'attack2',12:'attackF'})[action];
export const mobForcedName=action=>({7:'hit1',8:'hit2',9:'hitF',10:'attack1',11:'attack2',12:'attackF'})[action];
export const mobDieNames=['die1','die2','dieF'];
export function mobDieAction(actions,random=Math.random){const names=mobDieNames.filter(n=>actions?.[n]?.length);if(!names.length)return;return names[Math.min(names.length-1,Math.floor(random()*names.length))];}
/** 4885D0/488BC0 protect the attack LAYER only. A valid hit may still replace its controller path. */
export const mobForcedActive=(actions,forced,now)=>!!forced&&now>=forced.since&&now<forced.since+(forced.duration??(actions?.[mobForcedName(forced.action)]??[]).reduce((n,f)=>n+f.delay,0));
export const replaceMobForced=(current,next)=>!(current>=10&&current<=12&&next>=7&&next<=9);
export function mobForcedPose(actions,forced,now){
  if(!forced)return;
  const frames=actions?.[mobForcedName(forced.action)],elapsed=now-forced.since;
  if(!frames?.length||elapsed<0||elapsed>=frames.reduce((n,f)=>n+f.delay,0))return;
  return {frames,elapsed,facing:forced.facing};
}
export function mobAttackRect(attack,source,facing){
  const b=attack.range;if(attack.type!==0||!b)return;
  return {left:source.x+(facing?b.left:-b.right),right:source.x+(facing?b.right:-b.left),top:source.y+b.top,bottom:source.y+b.bottom};
}
/** 488220: 20px strips expanding vertically by distance/4; NOT a flat rectangle or radius circle. */
export function mobAttackRay(origin,end,target){
  const direction=Math.sign(end-origin.x);if(!direction)return false;
  const first=Math.max(0,Math.floor((direction>0?target.left-origin.x:origin.x-target.right)/20)*20);
  for(let x=origin.x+direction*first,travel=first;direction>0?x<end&&x<target.right:x>end&&x>target.left;travel+=20){
    const next=direction>0?Math.min(end,x+20):Math.max(end,x-20),half=Math.trunc(travel/4);
    if(intersects({left:Math.min(x,next),right:Math.max(x,next),top:origin.y-half,bottom:origin.y+half+1},target))return true;
    x=next;
  }
  return false;
}
const signed16=n=>(Math.trunc(n)<<16)>>16;
export const packMobAim=point=>((signed16(point.x)&65535)|((signed16(point.y)&65535)<<16))>>>0;
export const unpackMobAim=value=>({x:signed16(value),y:value>>16});
function aimPoint(rect,facing,y){
  const center=Math.trunc((rect.left+rect.right)/2);
  return {x:facing?Math.max(center,rect.right-10):Math.min(center,rect.left+10),y:Math.max(rect.top,Math.min(rect.bottom,y))};
}
/** One current-facing-first candidate per eligible attack, then choose uniformly (487D10).
 * Target/engagement/MP authority in the server is reconstruction policy, not the recovered owner AI.
 */
export function chooseMobAttack(attacks,source,target,mp,random=Math.random){
  const rect=playerContactRect(target),candidates=[];
  for(const attack of attacks??[]){
    if(attack.conMP>mp||attack.duration<=0)continue;
    for(const facing of [source.facing&1,(source.facing&1)^1]){
      let hit=false;
      if(attack.type===0)hit=intersects(mobAttackRect(attack,source,facing),rect);
      else if(attack.sp&&attack.radius>0){
        const origin={x:source.x+(facing?attack.sp.x:-attack.sp.x),y:source.y+attack.sp.y};
        hit=mobAttackRay(origin,origin.x+(facing?-attack.radius:attack.radius),rect);
      }
      if(!hit)continue;
      const value=attack.type===0?0:attack.ball?.length
        ?packMobAim(aimPoint(rect,source.facing,source.y+attack.sp.y)):target.characterId;
      candidates.push({attack,facing,value});break;
    }
  }
  if(!candidates.length)return;
  return candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))];
}
/** 488E30 extends the vector to range r, lifetime r*10ms (100px/s), not target travel distance.
 * ONLY type2 calls 420140: quadratic y with initial vy=-40, constrained to the endpoint/time.
 * The type1 branch leaves its Vector2D at sp (486A8E -> 486C6E); do NOT invent a linear MoveTo.
 */
export function planMobBall(attack,source,facing,value,start){
  if(!attack.ball?.length||!attack.sp||!(attack.radius>0))return;
  const origin={x:source.x+(facing?attack.sp.x:-attack.sp.x),y:source.y+attack.sp.y},aim=unpackMobAim(value);
  const dx=aim.x-origin.x,dy=aim.y-origin.y,length=Math.hypot(dx,dy);if(!length)return;
  const at=start+attack.attackAfter,duration=Math.trunc(attack.radius*10);
  return {origin,end:{x:Math.trunc(origin.x+dx/length*attack.radius),y:Math.trunc(origin.y+dy/length*attack.radius)},
    start:at,endAt:at+duration,curved:attack.type===2,frames:attack.ball};
}
export function mobBallPoint(ball,now){
  if(now<ball.start||now>=ball.endAt)return;
  if(!ball.curved)return {...ball.origin};
  const t=(now-ball.start)/1000,total=(ball.endAt-ball.start)/1000;
  const y=ball.curved?ball.origin.y-40*t+(ball.end.y-ball.origin.y+40*total)*t*t/(total*total)
    :ball.origin.y+(ball.end.y-ball.origin.y)*t/total;
  return {x:Math.trunc(ball.origin.x+(ball.end.x-ball.origin.x)*t/total),y:Math.trunc(y)};
}
export function mobAttackHitsRect(point,rect){return point.x>=rect.left&&point.x<rect.right&&point.y>=rect.top&&point.y<rect.bottom;}
