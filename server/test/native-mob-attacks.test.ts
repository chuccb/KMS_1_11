/** ADR-076 regression SOURCES ONLY. Not run/typechecked/syntax/browser/VM/probe validated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chooseMobAttack,mobAttackRect,mobAttackRay,packMobAim,unpackMobAim,planMobBall,mobBallPoint,
  replaceMobForced,mobForcedPose,mobForcedActive,mobDieAction,MOB_BODY_ACTIONS,mobAttackHitsRect} from '../../client/mob-attacks.mjs';
import {mobAttackEffects,type MobEffectLayer} from '../../client/mob-attack-effects.mjs';
import {MobField,mobTemplateProvider,type MobTemplate} from '../src/game/mobs.ts';
import {mobArtOf,type MobAttackArt,type SpriteFrame} from '../src/game/sprites.ts';
import {WzArchive} from '../src/wz/archive.ts';
import {artReaderOf} from '../src/game/wzart.ts';
import type {MapData} from '../src/game/map.ts';
import {PacketReader} from '../src/protocol/packet.ts';
import {readMobMove,readMobStat,encodeMobMove,encodeMobStat,encodeMobEnterField} from '../src/protocol/mob.ts';
import {ClientSession,type ClientEvent} from '../src/client/session.ts';
const frame:SpriteFrame={path:'fixture',ox:0,oy:0,delay:120};
const attack:MobAttackArt={name:'attack1',action:10,type:2,conMP:2,duration:700,visualDuration:720,
  effectAfter:100,attackAfter:300,sp:{x:23,y:-31},radius:250,effect:[frame],hit:[frame],ball:[frame]};
const source=(p:string)=>readFileSync(resolve(import.meta.dirname,'../../',p),'utf8');
const wz=resolve(import.meta.dirname,'../../Data.wz');
const origin={x:100,y:100,facing:0},target={x:250,y:100,characterId:7};
const floor={id:1,layer:1,group:0,x1:0,y1:100,x2:600,y2:100,prev:0,next:0};
const template:MobTemplate={templateId:9999997,name:'fixture',level:30,maxHP:600,maxMP:4,exp:1,speedPercent:100,
  moveAbility:1,dieMs:540,pushed:1,hitActions:[7],hitDurations:{7:200},hitVisualDurations:{7:240},attacks:[attack]};
function field(){
 const spawn={templateId:9999997,x:100,y:100,foothold:1,facing:0,rx0:0,rx1:600,cy:100};
 const map:MapData={id:1,imagePath:'Map/Map/000000001.img',name:'',streetName:'',bgm:'',returnMapId:1,mobs:[spawn],npcs:[],portals:[],footholds:1,ladderRopes:0};
 return new MobField({map,footholds:new Map([[1,floor]]),template:()=>template,behavior:'roam',random:()=>0});
}
test('488220 is widening 20px strips, with a 1px first strip and exclusive RECT edges',()=>{
 assert.equal(mobAttackRay({x:0,y:0},100,{left:0,right:19,top:1,bottom:2}),false);
 assert.equal(mobAttackRay({x:0,y:0},100,{left:80,right:90,top:15,bottom:16}),true);
 assert.equal(mobAttackRay({x:0,y:0},100,{left:100,right:101,top:0,bottom:1}),false);
 assert.equal(mobAttackRay({x:0,y:0},-100,{left:-90,right:-80,top:15,bottom:16}),true);
 assert.equal(mobAttackRay({x:0,y:0},0,{left:-1,right:1,top:0,bottom:1}),false);
});
test('type0 preserves raw left-facing rectangle and mirrors both x edges',()=>{
 const a={...attack,type:0 as const,range:{left:-100,right:-10,top:-60,bottom:0},ball:[]};
 assert.deepEqual(mobAttackRect(a,origin,1),{left:0,right:90,top:40,bottom:100});
 assert.deepEqual(mobAttackRect(a,origin,0),{left:110,right:200,top:40,bottom:100});
 const chosen=chooseMobAttack([a],origin,{x:40,y:100,characterId:7},4,()=>0)!;
 assert.equal(chosen.facing,1);assert.equal(chosen.value,0);
});
test('picker MP gate, preferred facing, no unneeded random draw and no fabricated attack',()=>{
 let draws=0;const random=()=>{draws++;return 0;};
 assert.equal(chooseMobAttack([],origin,target,4,random),undefined);
 assert.equal(chooseMobAttack([attack],origin,target,1,random),undefined);assert.equal(draws,0);
 const chosen=chooseMobAttack([attack],origin,target,2,random)!;
 assert.equal(chosen.facing,0);assert.equal(draws,1);
 assert.deepEqual(unpackMobAim(chosen.value),{x:238,y:69});
 const direct=chooseMobAttack([{...attack,ball:[]}],origin,target,4,()=>0)!;assert.equal(direct.value,7);
});
test('Value packs signed 16-bit x/y, not an object id for a ball',()=>{
 for(const p of [{x:-32768,y:32767},{x:32767,y:-32768},{x:-53,y:-100}])assert.deepEqual(unpackMobAim(packMobAim(p)),p);
});
test('type2 extends range, schedules release and follows 420140 quadratic y, not a linear line',()=>{
 const ball=planMobBall({...attack,sp:{x:0,y:0},radius:100},{x:0,y:0},0,packMobAim({x:10,y:0}),1000)!;
 assert.equal(ball.start,1300);assert.equal(ball.endAt,2300);assert.deepEqual(ball.end,{x:100,y:0});
 assert.equal(mobBallPoint(ball,1299),undefined);assert.deepEqual(mobBallPoint(ball,1800),{x:50,y:-10});
 assert.equal(mobBallPoint(ball,2300),undefined);
 assert.equal(planMobBall(attack,{x:100,y:100},0,packMobAim({x:77,y:69}),0),undefined,'zero-length ray is not a fake bullet');
 const stationary=planMobBall({...attack,type:1,sp:{x:0,y:0},radius:100},{x:0,y:0},0,packMobAim({x:10,y:0}),1000)!;
 assert.deepEqual(mobBallPoint(stationary,1800),{x:0,y:0},'486A8E skips 420140; no invented linear MoveTo');
});
test('10..12 protect body/facing from 7..9, with a cold-metadata duration guard',()=>{
 assert.equal(replaceMobForced(10,7),false);assert.equal(replaceMobForced(11,9),false);
 assert.equal(replaceMobForced(7,10),true);assert.equal(replaceMobForced(10,1),true);
 const f={action:10,facing:1,since:1000,duration:720},actions={attack1:[{...frame,delay:720}]};
 assert.equal(mobForcedActive(undefined,f,1700),true);assert.equal(mobForcedActive(undefined,f,1720),false);
 assert.equal(mobForcedPose(actions,f,1719)!.facing,1);assert.equal(mobForcedPose(actions,f,1720),undefined);
 assert.equal(mobDieAction({die2:[frame]},()=>0),'die2');assert.equal(mobDieAction({},()=>0),undefined);
});
test('authority: engaged live target, MP debit/0x34, hold patrol, KB still moves while attack pose survives',()=>{
 const f=field();assert.equal(f.attackPackets(1000,[target]).length,0,'not globally aggressive');
 f.applyDamage(1,0,1000,{hitAnimation:7,facingLeft:false,characterId:7});
 const packets=f.attackPackets(1000,[target]);assert.deepEqual(packets.map(p=>p[0]),[0x33,0x34]);
 assert.equal(readMobMove(new PacketReader(packets[0]!,1)).body.actionByte,20);
 assert.equal(readMobStat(new PacketReader(packets[1]!,1)).mp,2);
 assert.equal(f.movePackets(1100).length,0);assert.equal(f.attackPackets(1100,[target]).length,0);
 const hit=f.applyDamage(1,5,1100,{hitAnimation:7,facingLeft:true,characterId:7})!;
 assert.deepEqual(hit.packets.map(p=>p[0]),[0x34,0x33]);assert.equal(f.mobs[0]!.forced!.action,10);
 assert.equal(f.mobs[0]!.reactionUntil,1300);assert.equal(f.mobs[0]!.attackUntil,1720);
 const resume=f.resumePackets();assert.ok(readMobMove(new PacketReader(resume[0]!,1)).body.actionByte&128,'resume must preserve restored phase, not clear it');
 const phase=f.presentation(1,1200)!;assert.equal(phase.forced!.age,200);assert.equal(phase.mp,2);assert.equal(phase.reactionRemaining,100);
 assert.equal(f.attackPackets(1500,[target]).length,0);assert.equal(f.movePackets(1500).length,0);
 assert.equal(f.attackPackets(1720,[target]).length,2);assert.equal(f.mobs[0]!.mp,0);
 assert.equal(f.attackPackets(2440,[target]).length,0,'spent MP prevents the next cast');
 f.applyDamage(1,1000,2500);assert.equal(f.mobs[0]!.forced,undefined);assert.equal(f.mobs[0]!.aggroCharacterId,undefined);
 f.lifecyclePackets(9000);assert.equal(f.mobs[0]!.mp,4);assert.equal(f.mobs[0]!.attackUntil,undefined);
});
test('authority rejects missing target and airborne non-flyer, with no MP consumption',()=>{
 const f=field(),mob=f.mobs[0]!;mob.aggroCharacterId=7;mob.foothold=0;
 assert.equal(f.attackPackets(1000,[target]).length,0);assert.equal(mob.mp,4);
 mob.foothold=1;assert.equal(f.attackPackets(1100,[]).length,0);assert.equal(mob.aggroCharacterId,undefined);
});
test('ball is point-in-RECT, keeps flying/hitting on later ticks, creates art only',()=>{
 const emitted:MobEffectLayer[]=[],fx=mobAttackEffects({metadata:()=>({attacks:[attack]}),emit:e=>emitted.push(e)});
 const owners=new Map([['1',origin]]),p={id:7,x:77,y:100,facing:0};
 fx.put('1',9999997,10,0,packMobAim({x:200,y:69}),origin,1000);
 assert.equal(fx.step(1099,owners,[p]).length,0);assert.equal(emitted.length,0);
 fx.step(1100,owners,[p]);assert.equal(emitted[0]!.kind,'effect');assert.equal(emitted[0]!.start,1100);
 const balls=fx.step(1300,owners,[p]);assert.equal(balls.length,1);assert.equal(emitted.at(-1)!.kind,'hit');
 const hits=emitted.filter(e=>e.kind==='hit').length;
 fx.step(1301,owners,[p]);assert.equal(emitted.filter(e=>e.kind==='hit').length,hits,'same 30ms tick is not hit twice');
 fx.step(1330,owners,[p]);assert.equal(emitted.filter(e=>e.kind==='hit').length,hits+1,'not removed on impact');
 assert.equal(mobAttackHitsRect({x:22,y:-1},{left:-22,right:22,top:-65,bottom:0}),false);
 assert.equal(fx.step(3800,owners,[p]).length,0);assert.equal(fx.size,0);
});
test('cold metadata keeps original deadlines, never restarts expired effects/releases; owner remove flushes queue',()=>{
 let ready=false;const emitted:MobEffectLayer[]=[];
 const fx=mobAttackEffects({metadata:()=>ready?{attacks:[attack]}:undefined,emit:e=>emitted.push(e)}),owners=new Map([['1',origin]]);
 fx.put('1',9999997,10,0,packMobAim({x:200,y:69}),origin,1000);fx.step(1100,owners,[]);assert.equal(fx.size,1);
 ready=true;fx.step(5000,owners,[]);assert.equal(emitted.length,0);assert.equal(fx.size,0);
 fx.put('1',9999997,10,0,0,origin,6000);fx.remove('1');assert.equal(fx.size,0);
 fx.put('1',9999997,10,0,0,origin,6000);fx.clear();assert.equal(fx.size,0);
});
test('session forwards unsigned Value and u16 MP; 0x34 is not a hit action',()=>{
 const session=new ClientSession({loginPort:0}),events:ClientEvent[]=[];session.onEvent(e=>events.push(e));
 const fake=session as unknown as {handleFieldPacket(packet:Uint8Array):void};
 fake.handleFieldPacket(encodeMobEnterField({mobId:1,templateId:9999997,x:100,y:100,facing:0}));
 const value=packMobAim({x:-30,y:-100});
 fake.handleFieldPacket(encodeMobMove(1,{actionByte:20,value,path:{originX:100,originY:100,elements:[{attr:0,x:100,y:100,vx:0,vy:0,foothold:1,action:2,duration:720}]}}));
 fake.handleFieldPacket(encodeMobStat({mobId:1,mp:58}));
 const move=events.find(e=>e.kind==='mob-move');if(move?.kind==='mob-move')assert.equal(move.value,value);
 assert.deepEqual(events.at(-1),{kind:'mob-stat',mobId:1,mp:58});assert.equal(session.mob(1)!.mp,58);session.close();
});
test('real archive: only 9999997 info is usable; art-only 9999999 is NOT an attack definition',{skip:!existsSync(wz)},()=>{
 const archive=WzArchive.open(wz),reader=artReaderOf(archive)!;
 const art=mobArtOf(9999997,reader)!,a=art.attacks![0]!;
 assert.equal(art.attacks!.length,1);assert.equal(a.type,2);assert.equal(a.conMP,2);assert.deepEqual(a.sp,{x:23,y:-31});assert.equal(a.radius,250);
 assert.deepEqual([a.duration,a.visualDuration,a.effectAfter,a.attackAfter],[700,720,100,300]);
 assert.deepEqual(a.effect.map(f=>f.delay),[80,80,80,80]);assert.deepEqual(a.ball.map(f=>f.delay),[80,80,80,80]);
 assert.deepEqual(a.hit.map(f=>f.delay),[120,120]);assert.equal(a.hit[0]!.oy,41);
 assert.equal(mobArtOf(9999999,reader)!.attacks!.length,0);
 const t=mobTemplateProvider(archive)(9999997)!;assert.equal(t.maxMP,60);assert.equal(t.attacks!.length,1);
});
test('wiring: full body-frame admission, phase bridge, art-only callback and separate read-only preview',()=>{
 for(const name of ['jump','fly','hit2','hitF','attack1','attack2','attackF'])assert.ok(MOB_BODY_ACTIONS.includes(name));
 const browser=source('client/main.js'),effects=source('client/mob-attack-effects.mjs'),bridge=source('server/src/net/webclient.ts');
 assert.match(browser,/mobForcedActive/);assert.match(browser,/mobAttackFx\.put/);assert.match(browser,/phase\.forced\.age/);
 assert.match(bridge,/const frame = MOB_BODY_ACTIONS/);assert.match(bridge,/attacks:mob.attacks/);assert.match(bridge,/mobPresentation/);
 assert.doesNotMatch(effects,/rollNativeTouch|hpDelta|contactClock|contactImpulse|1500/);
 const preview=source('client/mob-attack-preview.mjs');assert.doesNotMatch(preview,/send\(|audio\.|Math\.random/);
 assert.match(source('client/index.html'),/qa-mob-canvas/);assert.match(source('client/testtools.mjs'),/resetMobPreview/);
});
