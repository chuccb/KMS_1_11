/** SOURCE ONLY; not executed/typechecked/browser/VM/probe validated in this delivery. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { avatarMotionOf, nativeBodyFrameDelay } from "../src/game/avatarmotion.ts";
import { composeAvatarBitmap, stanceOf, frameDelayOf } from "../src/game/avatar.ts";
// @ts-expect-error Pure browser source module has no declaration.
import { animationPose, avatarStance, avatarMotionProfiles } from "../../client/avatar-motion.mjs";
const data=fileURLToPath(new URL("../../Data.wz",import.meta.url));
const profile={weaponId:0,walk:"walk1",stand:"stand1",actions:{
  stand1:{frames:[0,1,2,1].map(index=>({index,delay:500}))},
  walk1:{frames:[0,1,2,3].map(index=>({index,delay:180}))},
  rope:{frames:[0,1].map(index=>({index,delay:250}))},
  dead:{frames:[{index:0,delay:150}]},
}};

test("ordinary body countdown uses 30ms, discards overshoot, keeps each frame's own delay",()=>{
  const actor:any={}; const options={profile}; const frames=[0];
  animationPose(actor,"stand1",false,0,options);
  for(let now=30;now<=2040;now+=30) {
    const pose=animationPose(actor,"stand1",false,now,options);
    if(now%510===0) frames.push(pose.frame);
  }
  assert.deepEqual(frames,[0,1,2,1,0],"not 500ms modulo, or 0/1/2/0");
  const odd={profile:{actions:{walk1:{frames:[{index:2,delay:31},{index:7,delay:61}]}}}};
  animationPose(actor,"walk1",false,0,odd);
  assert.equal(animationPose(actor,"walk1",false,30,odd).frame,2);
  assert.equal(animationPose(actor,"walk1",false,60,odd).frame,7);
  assert.equal(animationPose(actor,"walk1",false,120,odd).frame,7);
  assert.equal(animationPose(actor,"walk1",false,150,odd).frame,2);
});

test("rope counts down during idle, waits at zero, resumes by INTEGER Y not stale vy",()=>{
  const actor:any={vy:100},options={profile,y:0};
  animationPose(actor,"rope",true,0,options);
  for(let now=30;now<=300;now+=30) animationPose(actor,"rope",true,now,options);
  assert.equal(actor.animation.index,0,"stale vy/held input must not animate a stationary remote");
  assert.equal(actor.animation.remaining,0);
  assert.equal(animationPose(actor,"rope",true,330,{...options,y:0.9}).frame,0);
  assert.equal(animationPose(actor,"rope",false,360,{...options,y:1.1}).frame,1,"actual integer movement wins");
  for(let now=390;now<=660;now+=30) animationPose(actor,"rope",true,now,{...options,y:1.1});
  assert.equal(actor.animation.index,1);
  assert.equal(animationPose(actor,"rope",false,690,{...options,y:2.1}).frame,0,"resume immediately after idle countdown expires");
});

test("look/stance/facing/metadata changes reset body only; repeated draw and self snapshots do not",()=>{
  const actor:any={faceClock:{keep:true},emotion:{value:2}};
  const options={profile,key:"look",facing:0};
  animationPose(actor,"walk1",false,0,options);
  assert.equal(animationPose(actor,"walk1",false,180,options).frame,1);
  const snapshot={...actor,hp:5};
  assert.equal(animationPose(snapshot,"walk1",false,180,options).frame,1);
  assert.equal(animationPose(snapshot,"walk1",false,180,{...options,facing:1}).frame,0);
  assert.equal(animationPose(snapshot,"walk1",false,360,{...options,facing:1}).frame,1);
  assert.equal(animationPose(snapshot,"walk1",false,360,{...options,key:"new hat",facing:1}).frame,0);
  animationPose(snapshot,"dead",false,390,options);
  assert.equal(animationPose(snapshot,"walk1",false,420,options).frame,0);
  assert.equal(snapshot.faceClock,actor.faceClock); assert.equal(snapshot.emotion,actor.emotion);
  assert.equal(animationPose(snapshot,"stand1",false,450).frame,0,"cold metadata has no fabricated loop");
  assert.equal(snapshot.animation,undefined);
});

test("ordinary timing ignores attackSpeed/movement speed; background replay is bounded",()=>{
  const actor:any={speedPercent:130,attackSpeed:0};
  animationPose(actor,"walk1",false,0,{profile});
  assert.equal(animationPose(actor,"walk1",false,180,{profile}).frame,1);
  const idle:any={}; animationPose(idle,"stand1",false,0,{profile});
  assert.equal(animationPose(idle,"stand1",false,100000,{profile}).frame,0);
  assert.equal(idle.animation.remaining,260,"only 8 presentation ticks, not invisible seconds");
  assert.equal(avatarStance("walk1",{walk:"walk2"}),"walk2");
  assert.equal(avatarStance("stand1",{stand:"stand2"}),"stand2");
  assert.equal(avatarStance("rope",{stand:"stand2"}),"rope");
});

test("metadata retries after backoff, preserves pending seats and aborts cleared owners without writing actors",async()=>{
  let clock=0,calls=0;
  const cache=avatarMotionProfiles({now:()=>clock,fetcher:async()=>{calls++;return {ok:false,status:404};}});
  await cache.get(0).promise; cache.get(0); assert.equal(calls,1);
  clock=5000; await cache.get(0).promise; assert.equal(calls,2);
  assert.equal(cache.get(-1),undefined);
  let signal:AbortSignal|undefined;
  const other=avatarMotionProfiles({limit:1,fetcher:async(_url:string,options:{signal:AbortSignal})=>{
    signal??=options.signal; return {ok:true,json:async()=>profile};
  }});
  const old=other.get(0); await Promise.resolve();
  assert.equal(other.get(1402000),undefined,"saturation must not evict/abort every pending request each RAF");
  other.clear(); assert.equal(signal?.aborted,true);
  await old.promise; other.clear();
});

test("original WZ: independent weapon walk/stand, body delays, reverse idle and composed stance2",{skip:!existsSync(data)},()=>{
  const wz=WzArchive.open(data), reader=artReaderOf(wz)!;
  const bare=avatarMotionOf(reader,0)!, sword=avatarMotionOf(reader,1402000)!,axe=avatarMotionOf(reader,1412000)!;
  assert.deepEqual([bare.walk,bare.stand,sword.walk,sword.stand,axe.walk,axe.stand],
    ["walk1","stand1","walk1","stand2","walk2","stand2"]);
  assert.equal(avatarMotionOf(reader,-1),undefined);
  assert.deepEqual(bare.actions.stand1!.frames.map(f=>f.index),[0,1,2,1]);
  assert.deepEqual(bare.actions.rope!.frames.map(f=>f.delay),[250,250]);
  assert.equal(bare.actions.dead!.frames[0]!.delay,150);
  assert.equal(frameDelayOf(reader,"dead",0),150);
  assert.deepEqual([nativeBodyFrameDelay(undefined),nativeBodyFrameDelay("200"),nativeBodyFrameDelay(0)],[150,200,0]);
  assert.equal(stanceOf(2,true,axe),"walk2"); assert.equal(stanceOf(4,false,sword),"stand2");
  assert.equal(stanceOf(10,false),"prone"); assert.equal(stanceOf(12,false),"fly");
  for(const flip of [false,true]) {
    const look={faceId:20000,hairId:30000,items:[1040002,1060002,1072001,1412000]};
    assert.ok(composeAvatarBitmap(wz,look,{stance:axe.walk,frame:3,flip}));
    assert.ok(composeAvatarBitmap(wz,look,{stance:axe.stand,frame:2,flip}));
  }
});

test("integration source: field/offscreen, selection, creation and reset all share the ordinary clock",()=>{
  const source=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
  const main=source("../../client/main.js"),creation=source("../../client/creation.mjs");
  assert.match(main,/bodyPose: sampleAvatarMotion/);
  assert.match(main,/sampleAvatarMotion\(character, look,/);
  assert.match(main,/stanceOfEntity\(user, now\);.*off-screen/);
  assert.match(main,/resetAvatarMotion\(selfView\)/);
  assert.match(creation,/bodyPose\(previewActor, look, 'stand1', now\)/);
  assert.doesNotMatch(main,/selectedCharacterSince/);
  assert.doesNotMatch(creation,/Math\.floor\(now \/ 500\) % 3/);
  const inspector=main.slice(main.indexOf("function resetAvatarPreview()"),main.indexOf("const testToolsPanel = testTools({"));
  assert.doesNotMatch(inspector,/\bsend\(/,"read-only canvas must not send a gameplay command");
  assert.match(inspector,/items:\[\.\.\.current.items/);
  const html=source("../../client/index.html"),tools=source("../../client/testtools.mjs");
  assert.match(html,/qa-motion-canvas/); assert.match(html,/不修改角色或存檔/);
  assert.match(tools,/resetMotionPreview\(\)/);
});
