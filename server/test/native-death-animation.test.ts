/** Regression sources ONLY. Not executed, typechecked or browser-validated for this delivery. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { animationFrame, animationDuration } from "../../client/animation.mjs";
import { deathState, deathPose, tombPose, deathEffects } from "../../client/death.mjs";
// @ts-expect-error Existing browser-only physics module has no TS declaration; source-only regression.
import { beginPath, sampleMotion, collisionWorld, createPlayer, advancePlayer, queueKnockback, drainPlayerPath } from "../../client/motion.mjs";
import { WzArchive } from "../src/wz/archive.ts";
import { WzNode } from "../src/wz/img.ts";
import { artReaderOf, frameDelay, frameProperty } from "../src/game/wzart.ts";
import { spriteFrames } from "../src/game/sprites.ts";
import { portalFrames } from "../src/game/mapart.ts";
import { deathArtOf } from "../src/game/deathart.ts";

const fall = Array.from({length:10}, (_, n) => ({path:`fall/${n}`,delay:80}));
const land = Array.from({length:8}, (_, n) => ({path:`land/${n}`,delay:n<3?100:150}));

test("509AF0 queued fall -> land, exact boundary, final canvas held and existing dead entry skips fall", () => {
  const state = deathState(20,100,1000);
  assert.equal(tombPose({fall,land},state,1000)!.frame!.path,"fall/0");
  assert.equal(tombPose({fall,land},state,1000)!.y,-50);
  assert.equal(tombPose({fall,land},state,1400)!.y,25);
  assert.equal(tombPose({fall,land},state,1799)!.frame!.path,"fall/9");
  assert.equal(tombPose({fall,land},state,1800)!.frame!.path,"land/0");
  assert.equal(tombPose({fall,land},state,1800)!.y,100);
  assert.equal(tombPose({fall,land},state,2850)!.frame!.path,"land/7");
  assert.equal(tombPose({fall,land},state,100000)!.frame!.path,"land/7");
  assert.equal(tombPose({fall,land},deathState(20,100,1000,true),1000)!.frame!.path,"land/7");
});

test("Shape2D parent rotation gives a 2000ms orbit, not a made-up rising ghost; 2500ms two-layer fade", () => {
  const state=deathState(100,200,0);
  assert.deepEqual(deathPose(state,0),{x:90,y:195,alpha:1});
  assert.deepEqual(deathPose(state,500),{x:100,y:185,alpha:.8});
  assert.deepEqual(deathPose(state,1000),{x:110,y:195,alpha:.6});
  assert.deepEqual(deathPose(state,1500),{x:100,y:205,alpha:.4});
  assert.equal(deathPose(state,2500).alpha,0);
  assert.equal(deathPose(state,10000).alpha,0);
  assert.equal(deathPose(deathState(100,200,0,true),10000).alpha,1);
});

test("one live-transition sound; existing dead / stat repeats silent; field/reset and leave discard visuals", () => {
  let sounds=0;
  // Network-free fixture: never use the real browser/global fetch when these sources are run later.
  const effects=deathEffects({image:()=>{},log:()=>{},sound:()=>{sounds++;},
    fetch:async()=>({ok:true,json:async()=>({fall,land})})});
  effects.observe(1,true,{x:10,y:20},0,true);
  effects.observe(1,true,{x:90,y:99},100);
  assert.equal(sounds,0); assert.equal(effects.get(1)!.x,10);
  effects.observe(1,false,{x:90,y:99},150);
  assert.equal(effects.get(1),undefined);
  effects.observe(1,true,{x:30,y:40},200);
  effects.observe(1,true,{x:50,y:60},210);
  assert.equal(sounds,1);
  effects.remove(1);assert.equal(effects.get(1),undefined);
  effects.observe(2,true,{x:30,y:40},250,true);
  effects.reset();assert.equal(effects.get(2),undefined);
});

test("canvas duration + inherited alpha: missing/-1 endpoints retain, looping retains terminal alpha", () => {
  const frames=[{path:"a",delay:100,a0:0,a1:100},{path:"b",delay:200},
    {path:"c",delay:100,a0:-1,a1:200}];
  assert.equal(animationDuration(frames),400);
  assert.equal(animationFrame(frames,50)!.alpha,50/255);
  assert.equal(animationFrame(frames,100)!.alpha,100/255);
  assert.equal(animationFrame(frames,350)!.alpha,150/255);
  assert.equal(animationFrame(frames,1000,false)!.alpha,200/255);
  assert.equal(animationFrame(frames,400)!.alpha,0);
  const carry=[{path:"a",delay:100},{path:"b",delay:100,a1:0}];
  assert.equal(animationFrame(carry,0)!.alpha,1);
  assert.equal(animationFrame(carry,200)!.alpha,0);
  assert.equal(animationFrame([],0),undefined);
});

test("zero-duration path records are instantaneous; native action facing survives opposite displacement", () => {
  const user={x:0,y:0,action:4,facing:0}, world=collisionWorld({});
  beginPath(user,{elements:[{x:10,y:20,vx:100,vy:-270,action:7,foothold:0,attr:2,duration:0},
    {x:20,y:30,vx:100,vy:0,action:7,foothold:0,attr:0,duration:100}]},0);
  sampleMotion(user,0,world);
  assert.equal(user.x,10); assert.equal(user.y,20); assert.equal(user.facing,1);
  sampleMotion(user,50,world);assert.equal(user.x,15);assert.equal(user.facing,1);
  sampleMotion(user,100,world);assert.equal(user.x,20);assert.equal(user.action,7);
  const body=createPlayer(0,0,world,0,false);
  queueKnockback(body,270,-270);advancePlayer(body,{},world,30);
  advancePlayer(body,{},world,30);
  const recorded=drainPlayerPath(body).elements;
  assert.equal(recorded.filter(e=>e.attr&2).length,1,"retain force on its ordered fragment until publication");
  assert.equal(drainPlayerPath(body).elements.some(e=>e.attr&2),false);
});

const path=fileURLToPath(new URL("../../Data.wz",import.meta.url));
test("real WZ: 12 fall canvases exist, but original 800ms queue uses 10; all 8 land frames keep true delays/origins",{skip:!existsSync(path)},()=>{
  const reader=artReaderOf(WzArchive.open(path))!;
  const art=deathArtOf(reader)!;
  assert.equal(art.fall.length,10);assert.equal(art.land.length,8);
  assert.equal(animationDuration(art.fall),800);assert.equal(animationDuration(art.land),1050);
  assert.equal(art.fall[0]!.oy,43);assert.equal(art.land[7]!.ox,20);
  assert.equal(frameDelay(reader.node("Effect/Tomb.img/fall"),"0",90),80);
  assert.equal(frameDelay(reader.node("Effect/Tomb.img/fall/0"),"",90),80);
  assert.equal(frameProperty(reader.node("Effect/Tomb.img/land/3"),"delay"),150);
  const portals=portalFrames(reader);assert.equal(portals.length,8);
  assert.equal(animationDuration(portals),960,"4A3920 defaults missing portal delay to120, not100");
  const glow=spriteFrames(reader,"Map/Obj/acc1.img","grassySoil/nature/25",[]);
  assert.deepEqual(glow.map(f=>[f.delay,f.a0,f.a1]),[[3000,0,255],[3000,255,0]]);
  const absent=new WzNode("props",[]);
  assert.equal(frameDelay(absent,"0",120),120);
});
