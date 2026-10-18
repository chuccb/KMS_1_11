/** 487A30 -> 4885D0 -> 53D3F0. Native reaction, separate from roaming/player knockback.
 * No gravity launch: ground velocity is tangent130, drag=40000/default mass100;
 * ground edges clamp, airborne ground mobs hold; flyers have only basic horizontal damping/walls.
 * Field/controller authority and packet scheduling remain reconstruction policy. */
export const MOB_PUSH_SPEED=130;
export const MOB_PUSH_DRAG=400;
export const mobHitName=action=>({7:'hit1',8:'hit2',9:'hitF'})[action];
export function mobHitAction(template,rand=Math.random){
  const actions=template?.hitActions??[];
  return actions.length?actions[Math.min(actions.length-1,Math.floor(rand()*actions.length))]:-1;
}
export function mobReaction(template,damage,hitAction,facingLeft,now,until=0){
  const duration=template?.hitDurations?.[hitAction]??0;
  if(!(damage>0)||damage<(template?.pushed??1)||now<until||hitAction<7||hitAction>9||duration<=0)return;
  return {duration,action:hitAction,facing:facingLeft?0:1,velocity:facingLeft?-MOB_PUSH_SPEED:MOB_PUSH_SPEED};
}
const near=(a,b)=>Math.abs(a-b)<1e-6;
/** Move in arc length across only contiguous positive footholds; never fall off a KB edge. */
function groundStep(body,distance,byId){
  let f=byId.get(body.foothold),left=distance;
  for(let hops=0;f&&hops<64;hops++){
    const dx=f.x2-f.x1,dy=f.y2-f.y1,length=Math.hypot(dx,dy);
    if(dx<=0||!length){body.vx=body.vy=body.speed=0;return;}
    const s=(body.x-f.x1)*length/dx,next=s+left;
    if(next>=0&&next<=length){body.x=f.x1+next*dx/length;body.y=f.y1+next*dy/length;return;}
    const right=left>0,edge=right?length:0;
    body.x=right?f.x2:f.x1;body.y=right?f.y2:f.y1;
    left-=edge-s;
    const other=byId.get(right?f.next:f.prev);
    if(!other||other.x2<=other.x1||!near(right?other.x1:other.x2,body.x)||!near(right?other.y1:other.y2,body.y)){
      body.speed=body.vx=body.vy=0;return;
    }
    f=other;body.foothold=f.id;
  }
  if(f){body.speed=body.vx=body.vy=0;} // Corrupt cycle guard, not a native movement rule.
}
export function planMobReactionPath(start,footholds,reaction,ability=1){
  const byId=new Map(footholds.map(f=>[f.id,f]));
  const body={x:start.x,y:start.y,foothold:start.foothold,speed:reaction.duration>=90?reaction.velocity:0,vx:0,vy:0};
  const points=[],facing=reaction.facing&1;
  for(let elapsed=0;elapsed<reaction.duration;){
    const duration=Math.min(30,reaction.duration-elapsed),dt=duration/1000;
    const before=body.speed;
    if(ability!==0){
      body.speed=Math.sign(before)*Math.max(0,Math.abs(before)-MOB_PUSH_DRAG*dt);
      const distance=(before+body.speed)*.5*dt;
      const ground=byId.get(body.foothold);
      if(ground&&ground.x2>ground.x1){
        groundStep(body,distance,byId);
        const f=byId.get(body.foothold),len=f&&Math.hypot(f.x2-f.x1,f.y2-f.y1);
        body.vx=len?(f.x2-f.x1)/len*body.speed:0;body.vy=len?(f.y2-f.y1)/len*body.speed:0;
      }else if(ability===3){
        // 53D3F0 only integrates an off-ground vector for flying ability3, not a jumping ground mob.
        const nextX=body.x+distance;let blocked=false;
        for(const wall of footholds)if(wall.x1===wall.x2&&body.y>Math.min(wall.y1,wall.y2)&&body.y<=Math.max(wall.y1,wall.y2)&&
          Math.min(body.x,nextX)<=wall.x1&&Math.max(body.x,nextX)>=wall.x1&&!near(body.x,nextX)){
          body.x=wall.x1;body.speed=0;blocked=true;break;
        }
        if(!blocked)body.x=nextX;body.vx=body.speed;body.vy=0;
      }else {body.vx=body.speed;body.vy=0;}
    }
    elapsed+=duration;
    points.push({x:Math.trunc(body.x),y:Math.trunc(body.y),vx:Math.trunc(body.vx),vy:Math.trunc(body.vy),
      foothold:body.foothold,action:((body.foothold?1:ability===3?3:2)<<1)|facing,duration});
  }
  return points;
}
/** Mob and NPC animation advance one frame per 30ms update and discard overshoot (4862C0). */
export function nativeMobActions(actions){
  return Object.fromEntries(Object.entries(actions).map(([name,frames])=>[name,frames.map(f=>({...f,
    rawDelay:f.rawDelay??f.delay,delay:Math.max(30,Math.ceil(f.delay/30)*30)}))]));
}
export function mobHitPose(actions,hit,now){
  if(!hit)return;
  const frames=actions?.[mobHitName(hit.action)],elapsed=now-hit.since;
  if(!frames?.length||elapsed<0||elapsed>=frames.reduce((n,f)=>n+f.delay,0))return;
  return {frames,elapsed,facing:hit.facing};
}
