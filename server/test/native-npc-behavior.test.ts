/** ADR-062 SOURCE ONLY: NOT executed, typechecked, syntax-checked, browser/VM/HTTP/login probed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientSession,type ClientEvent} from '../src/client/session.ts';
import {PacketReader} from '../src/protocol/packet.ts';
import {encodeClientNpcIdle,encodeNpcIdle,readNpcIdle,encodeNpcState,encodeNpcEnterField,encodeNpcLeaveField} from '../src/protocol/npc.ts';
import {npcBehaviorOf,type NpcBehavior} from '../src/game/sprites.ts';
import type {ArtReader} from '../src/game/wzart.ts';
import {WzNode,type WzEntry} from '../src/wz/img.ts';
import {FieldInstance,type FieldMember} from '../src/game/world.ts';
import type {MapData} from '../src/game/map.ts';
import {npcPresentation} from '../../client/npcmotion.mjs';
import {npcRandom,npcIdleDelay,chooseNpcIdle,validNpcRequest,receiveNpcIdle,npcActionDuration} from '../../client/npcbehavior.mjs';
const props=(...pairs:[string,unknown][])=>new WzNode('props',pairs.map(([name,value])=>({name,type:9,value} as WzEntry)));
const hex=(bytes:Uint8Array)=>Buffer.from(bytes).toString('hex');
const behavior:NpcBehavior={movable:false,speak:['idle'],extraActions:[
  {name:'blink',speak:['sender0']},{name:'smile',speak:[]},{name:'angry',speak:['receiver2']},{name:'happy',speak:['receiver3']},
]};
const f=(path:string,delay:number,height=40)=>({path,delay,height,ox:0,oy:height});
const actions={stand:[f('stand0',180)],blink:[f('blink0',181),f('blink1',1)],smile:[f('smile0',180)],angry:[f('angry0',180)],happy:[f('happy0',180)]};

test('49A3C0/49A280: stationary seven-byte packets, signed sentinels, conditional CMovePath',()=>{
  const value={npcId:0x01020304,action:-1,speech:-1};
  assert.equal(hex(encodeClientNpcIdle(value)),'2f04030201ffff');
  assert.equal(hex(encodeNpcIdle(value)),'3d04030201ffff');
  assert.deepEqual(readNpcIdle(new PacketReader(encodeNpcIdle(value),1)),value);
  const moving={...value,path:{originX:-5,originY:20,elements:[{attr:0,x:10,y:20,vx:30,vy:0,action:4,foothold:1,duration:900}]}};
  const bytes=encodeNpcIdle(moving);assert.equal(bytes.length,7+5+14);
  const reader=new PacketReader(bytes,1);assert.deepEqual(readNpcIdle(reader,true),moving);assert.equal(reader.remaining,0);
  assert.throws(()=>readNpcIdle(new PacketReader(encodeNpcIdle(value),1),true),/underflow|need|remaining/i);
  assert.deepEqual(readNpcIdle(new PacketReader(encodeNpcIdle({...value,action:-128,speech:127}),1)),{...value,action:-128,speech:127});
});

test('49CBF0: own info, ONE linked root for behavior; no PNG decode, no sorting or empty-slot filtering',()=>{
  const nodes=new Map<string,WzNode>();
  nodes.set('Npc/0000001.img',props(['info',props()],['stand',props()],['ownOnly',props()]));
  nodes.set('Npc/0000001.img/info',props(['link','2'],['speak',props(['2','late'],['0','first'],['note',99])]));
  nodes.set('Npc/0000002.img',props(['info',props()],['stand',props()],['zLast',props()],['move',props()],['aFirst',props()]));
  nodes.set('Npc/0000002.img/info',props(['link','3'],['speak',props(['0','not own'])]));
  nodes.set('Npc/0000002.img/zLast',props(['speak',props(['1','line1'],['0','line0'])]));
  nodes.set('Npc/0000002.img/aFirst',props());
  const reader:ArtReader={size:0,clear(){},node:path=>nodes.get(path),at(){throw new Error('metadata must not decode PNG');}};
  assert.deepEqual(npcBehaviorOf(1,reader),{movable:true,speak:['first','','late'],extraActions:[
    {name:'zLast',speak:['line0','line1']},{name:'aFirst',speak:[]},
  ]});
});

test('49A0C0 vs 49A280 vs 40C730: sender +2, recipient raw guard/speech and raw-2 art remain DISTINCT',()=>{
  const seq=(...values:number[])=>()=>values.shift()!;
  assert.deepEqual(chooseNpcIdle(behavior,seq(0,0)),{action:2,speech:0});
  assert.deepEqual(receiveNpcIdle(behavior,2,0),{name:'blink',text:'receiver2'});
  assert.deepEqual(chooseNpcIdle(behavior,seq(1)),{action:3,speech:-1});
  assert.deepEqual(receiveNpcIdle(behavior,4,0),{name:undefined,text:undefined},'raw count guard does NOT subtract two');
  assert.equal(validNpcRequest(behavior,4,0),true,'sender slot2 is legal despite recipient rejecting raw4');
  assert.deepEqual(chooseNpcIdle(behavior,seq(4)),{action:-1,speech:0});
  assert.deepEqual(receiveNpcIdle(behavior,-1,0),{name:undefined,text:'idle'});
  assert.equal(validNpcRequest(behavior,1,0),false);
  assert.equal(validNpcRequest(behavior,-1,1),false);
  assert.equal(validNpcRequest(behavior,2.5,0),false);
  assert.deepEqual(receiveNpcIdle(behavior,-128,0),{name:undefined,text:undefined});
  assert.equal(validNpcRequest({...behavior,speak:Array(129).fill('line')},-1,-128),true,'byte wrap remains a legal sender request');
});

test('MSVCRT presentation rand; 4..11999ms delay; NPC30ms discards frame overshoot',()=>{
  const rand=npcRandom(1);assert.deepEqual([rand(),rand(),rand()],[41,18467,6334]);
  assert.equal(npcIdleDelay(()=>0),4000);assert.equal(npcIdleDelay(()=>7999),11999);
  assert.equal(npcActionDuration(actions.blink),240,'181->210, 1->30, not duration182');
});

function visual(templates=behavior) {
  const sent:unknown[]=[],bubbles:unknown[]=[];
  const balloons={put(...args:unknown[]){bubbles.push(args);},remove(_id:number){},clear(){bubbles.length=0;}};
  const view=npcPresentation({send:(value:unknown)=>{sent.push(value);return true;},balloons,seed:1});
  view.add({npcId:1,templateId:7,controlled:true},0);view.load(7,actions,templates,0);
  return {view,sent,bubbles};
}

test('controller request waits for echo; speech blocks requests, non-controller never proposes',()=>{
  const {view,sent}=visual({movable:false,speak:['idle'],extraActions:[]});
  view.tick(4020);assert.equal(sent.length,0);view.tick(4050);assert.equal(sent.length,1);
  assert.equal(view.speaking(1,4050),false,'no locally invented speech before acknowledgement');
  view.tick(20000);assert.equal(sent.length,1,'one in-flight request only');
  view.receive({npcId:1,action:-1,speech:0},20000);assert.equal(view.speaking(1,24999),true);
  view.tick(24990);assert.equal(sent.length,1);view.tick(25020);assert.equal(sent.length,2);
  view.controller(1,false,25021);view.tick(100000);assert.equal(sent.length,2);
  view.controller(1,true,100000);view.tick(100030);assert.equal(sent.length,2,'transfer rearms delay, not immediate spam');
});

test('forced action runs once, then base restarts; NPC balloon color/height and removal are isolated',()=>{
  const {view,bubbles}=visual();
  view.receive({npcId:1,action:2,speech:0},100);
  assert.equal(view.frame(1,100).path,'blink0');assert.equal(view.frame(1,310).path,'blink1');
  assert.equal(view.frame(1,340).path,'stand0');assert.equal(view.originY(1),40);
  assert.deepEqual(bubbles[0],[1,'receiver2',100,{color:'#800000',preserveWhitespace:true}]);
  assert.equal(view.speaking(1,5099),true);assert.equal(view.speaking(1,5100),false);
  view.remove(1);assert.equal(view.frame(1,5100),undefined);assert.equal(view.speaking(1,5100),false);
  view.clear();assert.equal(bubbles.length,0);
});

test('late metadata respects packet age; movable browser does not invent a walk AI',()=>{
  const {view,sent,bubbles}=visual({...behavior,movable:true});view.tick(12000);assert.equal(sent.length,0);
  view.clear();view.add({npcId:1,templateId:7},0);
  view.receive({npcId:1,action:-1,speech:0},10);view.load(7,actions,behavior,6000);
  assert.equal(bubbles.length,0);assert.equal(view.speaking(1,6000),false,'expired cold-art speech is not replayed');
  view.locomotion(1,4,6000);assert.equal(view.frame(1,6000),undefined,'move art absent: do not fake stand as walking');
});

function field() {
  const spawn={templateId:7,x:0,y:0,foothold:0,facing:0,rx0:0,rx1:0,cy:0};
  const map:MapData={id:1,imagePath:'Map/Map/000000001.img',name:'fixture',streetName:'',bgm:'',returnMapId:1,
    mobs:[],npcs:[spawn],portals:[],footholds:0,ladderRopes:0};
  const world=new FieldInstance({map,npcTemplate:()=>({templateId:7,name:'NPC',behavior})});
  const member=(characterId:number)=>({characterId,name:String(characterId),face:20000,avatarItems:[],packets:[] as Uint8Array[],
    send(value:Uint8Array){this.packets.push(value);}} satisfies FieldMember & {packets:Uint8Array[]});
  return {world,a:member(1),b:member(2)};
}

test('one field controller, requester-inclusive echo, forged viewer rejected, leave transfers, despawn revokes',()=>{
  const {world,a,b}=field();world.join(a);world.join(b);
  assert.equal(a.packets.filter(p=>p[0]===0x3b).length,1);assert.equal(b.packets.filter(p=>p[0]===0x3b).length,0);
  const report={npcId:1,action:-1,speech:0};
  assert.equal(world.reportNpcIdle(2,report,0),false);
  assert.equal(world.reportNpcIdle(1,report,0),true);
  assert.equal(a.packets.filter(p=>p[0]===0x3d).length,1);assert.equal(b.packets.filter(p=>p[0]===0x3d).length,1);
  assert.equal(world.reportNpcIdle(1,report,100),false,'reconstruction anti-flood guard');
  world.leave(1);assert.equal(b.packets.filter(p=>p[0]===0x3b).length,1);
  assert.equal(world.reportNpcIdle(1,report,500),false);assert.equal(world.reportNpcIdle(2,report,500),true);
  assert.equal(world.removeNpc(1),true);
  assert.deepEqual(b.packets.slice(-2).map(p=>p[0]),[0x3b,0x3a]);
  assert.equal(world.reportNpcIdle(2,report,1000),false);assert.equal(world.removeNpc(1),false);
  world.npcs.spawnAll();assert.equal(world.npcs.npcs.length,1,'spawnAll cannot duplicate pool ids');
});

test('session receives 3B/3D and retains native pool until visibility AND controller bits are clear',()=>{
  const session=new ClientSession({loginPort:0}),events:ClientEvent[]=[];session.onEvent(event=>events.push(event));
  const fake=session as unknown as {handleFieldPacket(value:Uint8Array):void};
  fake.handleFieldPacket(encodeNpcEnterField({npcId:1,templateId:7,x:0,y:0,facing:0}));
  fake.handleFieldPacket(encodeNpcState(1,true));fake.handleFieldPacket(encodeNpcIdle({npcId:1,action:2,speech:-1}));
  assert.deepEqual(events.map(e=>e.kind),['npc-enter','npc-controller','npc-idle']);
  fake.handleFieldPacket(encodeNpcLeaveField(1));assert.equal(events.at(-1)?.kind,'npc-idle');
  fake.handleFieldPacket(encodeNpcState(1,false));assert.deepEqual(events.slice(-2).map(e=>e.kind),['npc-controller','npc-leave']);
  const body=encodeNpcEnterField({npcId:2,templateId:7,x:10,y:20,facing:1});
  const unknown=new Uint8Array(21);unknown.set([0x3b,1]);unknown.set(body.subarray(1),2);
  fake.handleFieldPacket(unknown);assert.equal(events.at(-2)?.kind,'npc-enter');
  fake.handleFieldPacket(encodeNpcState(2,false));assert.equal(events.at(-1)?.kind,'npc-leave',
    'controller-only entry is freed when its sole bit clears');
  session.close();
});
