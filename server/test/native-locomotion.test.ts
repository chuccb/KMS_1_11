/** SOURCE-ONLY regressions. NOT executed/typechecked/browser-validated, at the user's request. */
import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_SHOE, NATIVE_FOOTHOLD, NATIVE_FLUID, groundStep, airStep, jumpVelocity } from "../../client/native-locomotion.mjs";
// @ts-expect-error Browser motion has no declaration; source-only regression.
import { PHYSICS, collisionWorld, createPlayer, advancePlayer, requestPlayerJump, advanceMob, queueKnockback, movementSnapshot, drainPlayerPath, beginPath, sampleMotion } from "../../client/motion.mjs";
import { readBrowserMovePath } from "../src/net/browsermove.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { encodeClientUserMove, readClientUserMove } from "../src/protocol/field.ts";

const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const floor={id:1,x1:-1000,y1:0,x2:1000,y2:0,prev:0,next:0,layer:2,group:3};
const flat=()=>collisionWorld({footholds:[floor]});

test("537CA0: flat 140000/100 force, 80000/100 drag; .9 is slip, not flat friction",()=>{
  assert.equal(NATIVE_SHOE.mass,100); assert.equal(NATIVE_SHOE.slip,.9);
  assert.deepEqual(NATIVE_FOOTHOLD,{walk:1,drag:1}); assert.deepEqual(NATIVE_FLUID,{drag:1,gravity:1});
  const go=groundStep(0,0,1,.03); close(go.speed,42);close(go.distance,.63);
  const stop=groundStep(100,0,0,.03);close(stop.speed,76);close(stop.distance,2.64);
  close(groundStep(125,0,-1,.03).speed,83);
  close(groundStep(200,0,1,.03).speed,176); // braking, not an instantaneous clamp to125
});

test("5643D0 / 537D35: normalized tangent and literal orientation-dependent slope force",()=>{
  const world=collisionWorld({footholds:[{...floor,x1:0,y1:0,x2:80,y2:60}]});
  const f=world.byId.get(1);close(f.cos,.8);close(f.sin,.6);close(f.length,100);
  const body=createPlayer(40,30,world,1);
  advancePlayer(body,{horizontal:1},world,30);
  close(body.groundSpeed,57.12);close(body.vx,45.696);close(body.vy,34.272);
  close(body.x,40.68544);close(body.y,30.51408);assert.equal(body.layer,2);
  close(groundStep(0,-.6,1,.03).speed,26.88);
});

test("537CA0 steep slip, uphill half-slip, zero-drag slope force and 16000 overspeed brake",()=>{
  close(groundStep(0,.95,0,.03).speed,17.1);
  close(groundStep(0,-.95,0,.03).speed,-17.1);
  close(groundStep(0,.95,-1,.03).speed,8.55);
  close(groundStep(0,.6,0,.03,NATIVE_SHOE,{walk:1,drag:0}).speed,10.8);
  close(groundStep(200,0,0,.03,NATIVE_SHOE,{walk:1,drag:0}).speed,195.2);
});

test("5382F0: preserve a walking jump, reverse through air control, decay excess terminal velocity",()=>{
  close(airStep(125,-555,1,.03).vx,125);
  close(airStep(125,-555,-1,.03).vx,119);
  close(airStep(125,-555,0,.03).vx,122);
  close(airStep(0,1000,0,.03).vy,997);
  close(airStep(0,660,0,.03).vy,670);
  close(airStep(0,-1000,0,.03).vy,-940);
  close(airStep(0,0,1,.03).dx,.09);
});

test("5378D0: standing drift half, downhill/uphill launch caps, unchanged default gravity",()=>{
  assert.deepEqual(jumpVelocity(100,.6,0),{vx:50,vy:-555});
  close(jumpVelocity(0,.6,1).vx,136);close(jumpVelocity(0,.6,-1).vx,-64);
  close(jumpVelocity(0,0,1,{...NATIVE_SHOE,walkSpeed:1.3,jump:1.23}).vx,130);
});

test("30ms controller: latch short RAF keypresses; do not manufacture background catch-up",()=>{
  assert.equal(PHYSICS.stepMs,30);
  const world=flat(),body=createPlayer(0,0,world,1);
  advancePlayer(body,{jump:true},world,10);assert.equal(body.grounded,true);
  advancePlayer(body,{jump:false},world,20);assert.equal(body.grounded,false);
  assert.equal(body.groundJumps,1);close(body.vy,-495);close(body.y,-16.75);
  const betweenFrames=createPlayer(0,0,world,1);
  requestPlayerJump(betweenFrames); // keyup happened before the first RAF: no held input remains
  advancePlayer(betweenFrames,{jump:false},world,30);assert.equal(betweenFrames.groundJumps,1);
  const stopped=createPlayer(0,0,world,1);
  advancePlayer(stopped,{jump:true},world,10);
  advancePlayer(stopped,{disabled:true},world,20);assert.equal(stopped.grounded,true);
  const capped=createPlayer(0,0,world,1);
  advancePlayer(capped,{horizontal:1},world,10000);
  assert.equal(drainPlayerPath(capped).elements.reduce((s:number,e:{duration:number})=>s+e.duration,0),240);
});

test("Down+jump uses ordinary jump; no invented 300ms ignored-platform fall-through",()=>{
  const world=collisionWorld({footholds:[floor,{...floor,id:2,y1:100,y2:100}]});
  const body=createPlayer(0,0,world,1);
  advancePlayer(body,{vertical:1,jump:true},world,30);
  assert.equal(body.grounded,false);assert.equal(body.groundJumps,1);assert.ok(body.vy<0);
  assert.equal(body.ignored,undefined);
});

test("linked floor transition preserves tangent speed and changes world velocity; jump lifts before external force",()=>{
  const world=collisionWorld({footholds:[{...floor,x1:-1000,x2:10,next:2},
    {...floor,id:2,x1:10,y1:0,x2:90,y2:60,prev:1}]});
  const body=createPlayer(9,0,world,1);body.vx=125;
  advancePlayer(body,{horizontal:1},world,30);
  assert.equal(body.foothold,2);close(body.groundSpeed,125);close(body.vx,100);close(body.vy,75);
  const jumped=createPlayer(0,0,flat(),1);
  queueKnockback(jumped,270,-270);advancePlayer(jumped,{jump:true},flat(),30);
  assert.equal(jumped.groundJumps,1);close(jumped.vx,267);close(jumped.vy,-765);
  assert.equal(drainPlayerPath(jumped).elements.filter((e:{attr:number})=>e.attr&2).length,1);
});

test("landing projects velocity onto slope and halves it, or clears opposing-input drift",()=>{
  const world=flat();
  const body=createPlayer(0,-1,world,0,false);body.vx=100;body.vy=100;
  advanceMob(body,{horizontal:1},world,30);assert.equal(body.grounded,true);close(body.groundSpeed,50);
  const opposed=createPlayer(0,-1,world,0,false);opposed.vx=100;opposed.vy=100;
  advanceMob(opposed,{horizontal:-1},world,30);assert.equal(opposed.grounded,true);close(opposed.vx,0);
});

test("5426F0/564DF0: up-grab only while falling, with 10px swept X tolerance and numeric-id ordering",()=>{
  const world=collisionWorld({footholds:[],ladders:[{id:9,x:0,y1:0,y2:100,page:3},
    {id:2,x:0,y1:0,y2:100,page:4}]});
  const rising=createPlayer(9,20,world,0,false);rising.vy=-200;
  advancePlayer(rising,{vertical:-1},world,30);assert.equal(rising.ladder,undefined);
  const falling=createPlayer(9,20,world,0,false);falling.vy=200;
  advancePlayer(falling,{vertical:-1},world,30);assert.equal(falling.ladder?.id,2);assert.equal(falling.layer,4);
  const blocked=createPlayer(0,20,world,0,false);blocked.vy=200;
  advancePlayer(blocked,{vertical:-1,allowClimb:false},world,30);assert.equal(blocked.ladder,undefined);
});

test("542DF0: 3px/tick, upperFoothold clamp, y1-5 exit, y2+1 exit, directional ladder jump",()=>{
  for(const upper of [false,true]){
    const world=collisionWorld({footholds:[floor],ladders:[{id:7,x:0,y1:0,y2:100,upperFoothold:upper}]});
    const body=createPlayer(0,0,world,1);
    advancePlayer(body,{vertical:1},world,30);assert.equal(body.ladder?.id,7);
    advancePlayer(body,{vertical:1,speedPercent:130},world,30);close(body.y,3);
    advancePlayer(body,{vertical:-1},world,60);close(body.y,upper?-5:0);
    assert.equal(Boolean(body.ladder),!upper);
  }
  const world=collisionWorld({footholds:[],ladders:[{id:7,x:0,y1:0,y2:100}]});
  const body=createPlayer(0,99,world,0,false);body.ladder=world.ladders[0];
  advancePlayer(body,{vertical:1},world,30);close(body.y,101);assert.equal(body.ladder,undefined);
  const exit=createPlayer(0,50,world,0,false);exit.ladder=world.ladders[0];
  advancePlayer(exit,{jump:true,horizontal:1},world,30);
  close(exit.vx,162.5);close(exit.vy,-217.5);assert.equal(exit.groundJumps,0);
});

test("5426F0 death branch freezes an airborne or ladder body; pending jump/KB cannot revive movement",()=>{
  const world=flat(),body=createPlayer(0,-100,world,0,false);
  body.vx=100;body.vy=200;body.dead=true;queueKnockback(body,270,-270);
  advancePlayer(body,{jump:true,horizontal:1,vertical:1},world,120);
  close(body.x,0);close(body.y,-100);close(body.vx,0);close(body.vy,0);
  assert.equal(body.knockback,undefined);assert.equal(body.jumpQueued,false);
  assert.equal(movementSnapshot(body).action,18);
});

test("ordered 30ms records/attr survive drain; bridge/native codec preserve them and terminal authority",()=>{
  const world=flat(),body=createPlayer(0,0,world,1);
  advancePlayer(body,{horizontal:1},world,90);
  queueKnockback(body,270,-270);advancePlayer(body,{},world,30);
  const path=readBrowserMovePath(drainPlayerPath(body));
  assert.deepEqual(path.elements.map(e=>e.duration),[0,30,30,30,0,30]);
  assert.equal(path.elements.filter(e=>e.attr===2).length,1);
  assert.equal(path.elements.find(e=>e.attr===2)!.duration,0,"force belongs to its actual launch transition");
  const wire=readClientUserMove(new PacketReader(encodeClientUserMove({stageByte:0,path}),1));
  assert.deepEqual(wire.path,path);
  assert.equal(drainPlayerPath(body).elements.some((e:{attr:number})=>e.attr),false);
  const negative=createPlayer(-1.9,-2.9,collisionWorld({}),0,false);negative.vx=-1.9;
  assert.deepEqual([movementSnapshot(negative).x,movementSnapshot(negative).y,movementSnapshot(negative).vx],[-1,-2,-1]);
});

test("landing terminal state does not ground-project the preceding falling interval",()=>{
  const world=flat(),entity={x:0,y:-20,action:6,foothold:0};
  beginPath(entity,{elements:[{x:0,y:-20,foothold:0,action:6,duration:0},
    {x:10,y:0,foothold:0,action:6,duration:30},{x:10,y:0,foothold:1,action:4,duration:0}]},0);
  sampleMotion(entity,15,world);close(entity.y,-10);assert.equal(entity.action,6);
  sampleMotion(entity,30,world);close(entity.y,0);assert.equal(entity.foothold,1);assert.equal(entity.action,4);
});

test("browser admission rejects malformed, oversized and non-native attribute paths before socket writes",()=>{
  const good={originX:0,originY:0,elements:[{attr:0,x:0,y:0,vx:0,vy:0,action:4,foothold:1,duration:30}]};
  for(const bad of [null,[],{...good,elements:[]},{...good,elements:Array(65).fill(good.elements[0])},
    {...good,originX:NaN},{...good,originY:'0'},
    ...[{attr:1},{x:32768},{y:-32769},{vx:Infinity},{duration:-1},{duration:1001},{action:256},{foothold:-32769}]
      .map(diff=>({...good,elements:[{...good.elements[0],...diff}]})),
    {...good,elements:[{...good.elements[0],duration:600},{...good.elements[0],duration:600}]}])
    assert.throws(()=>readBrowserMovePath(bad));
  assert.deepEqual(readBrowserMovePath(good),good);
});
