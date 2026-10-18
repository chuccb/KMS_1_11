import {animationFrame} from './animation.mjs';
import {npcRandom,npcIdleDelay,chooseNpcIdle,receiveNpcIdle,npcFrameDelay,npcActionDuration} from './npcbehavior.mjs';

/** CNpc presentation/controller, separate from users, combat RNG, dialogue and persistence.
 * Authority lives on the server: only a designated controller proposes; EVERY client (sender too)
 * renders the 0x3D acknowledgement. The original receiver's +2 discrepancy is preserved literally.
 * This does not implement CVecCtrlNpc walking/pathfinding. Movable NPC requests remain disabled in
 * this browser until its 5398B0 / 49A3C0 path is established; native clients retain their own vecctrl.
 */
export function npcPresentation({send,balloons,seed}) {
  const records=new Map(),art=new Map(),rand=npcRandom(seed);
  function settle(r,now) {
    if(r.forced&&now>=r.forced.since+r.forced.duration) {
      r.baseSince=r.forced.since+r.forced.duration;r.forced=undefined;
    }
  }
  function accept(r,value,now) {
    const data=art.get(r.templateId);
    if(!data){r.pending.push(value);if(r.pending.length>16)r.pending.shift();return;}
    settle(r,value.at);
    r.inflight=false;r.lastReply={action:value.action,speech:value.speech};
    const result=receiveNpcIdle(data.behavior,value.action,value.speech);
    if(result.name!==undefined) {
      const frames=data.actions[result.name];
      if(frames?.length)r.forced={name:result.name,since:value.at,duration:npcActionDuration(frames)};
    }
    if(result.text!==undefined&&value.at+5000>now) {
      r.speechUntil=value.at+5000;
      const name=r.forced?.name??r.baseName;
      // 4373A0 takes canvas0 height from the current NPC layer; not the clickable rectangle.
      r.chatOriginY=data.actions[name]?.[0]?.height;
      balloons.put(r.npcId,result.text,value.at,{color:'#800000',preserveWhitespace:true});
    }
    settle(r,now);
  }
  const api={
    clear(){records.clear();art.clear();balloons.clear();},
    add(npc,now) {
      api.remove(npc.npcId);
      const r={npcId:npc.npcId,templateId:npc.templateId,controlled:false,tickAt:now,
        idle:0,inflight:false,baseSince:now,baseName:'stand',speechUntil:0,pending:[]};
      records.set(npc.npcId,r);api.controller(npc.npcId,npc.controlled===true,now);
    },
    remove(id){records.delete(id);balloons.remove(id);},
    controller(id,on,now) {
      const r=records.get(id);if(!r||r.controlled===on)return;
      r.controlled=on;r.inflight=false;r.tickAt=now;
      if(on)r.idle=npcIdleDelay(rand); // 499760; not 'start walking'.
    },
    load(templateId,actions,behavior,now) {
      if(!behavior)return;
      const quantized=Object.fromEntries(Object.entries(actions).map(([name,frames])=>
        [name,frames.map(frame=>({...frame,delay:npcFrameDelay(frame)}))]));
      art.set(templateId,{actions:quantized,behavior});
      for(const r of records.values())if(r.templateId===templateId) {
        const pending=r.pending.splice(0);for(const value of pending)accept(r,value,now);
      }
    },
    receive(value,now){const r=records.get(value.npcId);if(r)accept(r,{...value,at:now},now);},
    tick(now) {
      for(const r of records.values()) {
        settle(r,now);
        const elapsed=Math.max(0,Math.floor((now-r.tickAt)/30)*30);r.tickAt+=elapsed;
        if(!r.controlled)continue;
        r.idle-=elapsed;
        const data=art.get(r.templateId);
        if(!data||data.behavior.movable||r.idle>0||r.inflight||r.forced||now<r.speechUntil)continue;
        // Native resets the timer before drawing the next slot, using the same presentation rand.
        r.idle=npcIdleDelay(rand);
        const value=chooseNpcIdle(data.behavior,rand);
        if(value&&send({npcId:r.npcId,...value})!==false){r.inflight=true;r.lastRequest={...value};}
      }
    },
    locomotion(id,action,now) {
      const r=records.get(id);if(!r)return;
      const name=(action>>1)===2?'move':'stand'; // 499B70: NPC-specific, not mob/user stance table.
      if(r.baseName!==name){r.baseName=name;r.baseSince=now;}
    },
    frame(id,now) {
      const r=records.get(id);if(!r)return undefined;settle(r,now);
      const data=art.get(r.templateId);if(!data)return undefined;
      return animationFrame(data.actions[r.forced?.name??r.baseName],now-(r.forced?.since??r.baseSince));
    },
    snapshot(id,now) {
      const r=records.get(id);if(!r)return undefined;
      return {controlled:r.controlled,waiting:r.inflight,action:r.forced?.name??r.baseName,
        idleMs:Math.max(0,r.idle),speaking:r.speechUntil>now,metadata:art.has(r.templateId),
        ...(r.lastReply?{reply:{...r.lastReply}}:{}),...(r.lastRequest?{request:{...r.lastRequest}}:{})};
    },
    speaking(id,now){return (records.get(id)?.speechUntil??0)>now;},
    originY(id){return records.get(id)?.chatOriginY;},
  };
  return api;
}
