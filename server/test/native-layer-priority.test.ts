/** Regression SOURCES ONLY — deliberately not run/typechecked/browser-validated at user's request. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { WzNode, type WzEntry } from "../src/wz/img.ts";
import { avatarPartRank, visualSlots, occludeAvatarParts, composeAvatarBitmap, zRanksOf } from "../src/game/avatar.ts";
import { drawCanvas, bitmapOf } from "../src/game/raster.ts";
import { mapBacks } from "../src/game/mapart.ts";
import { artReaderOf } from "../src/game/wzart.ts";
// @ts-expect-error Browser scene module has no declaration; source-only fixture.
import { compareScene, prepareMapScene, mergeScene, sceneOrdering } from "../../client/scene.mjs";
// @ts-expect-error Browser physics module has no declaration; source-only fixture.
import { actorDepth, collisionWorld, beginPath, sampleMotion } from "../../client/motion.mjs";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const props = (...pairs: [string, unknown][]) => new WzNode("props", pairs.map(([name,value]) => ({name,type:9,value} as WzEntry)));

test("4011C0 zmap empty decrements; explicit numeric value resets the counter, including zero", () => {
  // A deliberately small archive facade, not shipped data or an inferred rank fallback.
  const archive = { has: () => true,
    objects: () => [props(["a",null],["b",-8],["c",""],["d","0"],["e",null])] };
  const ranks = zRanksOf(archive as unknown as WzArchive);
  assert.deepEqual([...ranks], [["a",-1],["b",-8],["c",-9],["d",0],["e",-1]]);
  assert.equal(avatarPartRank("a",ranks),-1);
  assert.equal(avatarPartRank("-27",ranks),-27);
  assert.equal(avatarPartRank(13,ranks),13);
  assert.equal(avatarPartRank(undefined,ranks),0);
  assert.equal(avatarPartRank("unknownArm",ranks),-2147483648);
});

test("402130 resolves TWO-character visual regions, greatest islot priority wins, equal priorities coexist", () => {
  assert.deepEqual(visualSlots("CpH1H5"),["Cp","H1","H5"]);
  const backHair = {name:"backHair",slots:["H1"],slotRank:-111};
  const narrow = {name:"backHairBelowCapNarrow",slots:["H5"],slotRank:-111};
  const below = {name:"backHairBelowCap",slots:["H6"],slotRank:-111};
  const hat = {name:"backCap",slots:["Cp","H1","H5"],slotRank:-103};
  const accessory = {name:"capAccessory",slots:["Cp"],slotRank:-103};
  assert.deepEqual(occludeAvatarParts([backHair,narrow,below,hat,accessory]),[below,hat,accessory]);
  const lateHair = {...backHair};
  assert.deepEqual(occludeAvatarParts([hat,lateHair]),[hat]);
  const multi = {name:"whole",slots:["H6","H1"],slotRank:-111};
  assert.deepEqual(occludeAvatarParts([hat,multi]),[hat],"one conflict removes whole canvas, not only overlapping pixels");
});

test("Gr2D equal-z ordering ignores feet y; persistent stamp only changes with root depth", () => {
  const stamp = sceneOrdering(100), a={}, b={};
  const first = stamp(a,10), second = stamp(b,10);
  assert.ok(first<second);
  assert.equal(stamp(a,10),first);
  assert.ok(compareScene({z:10,y:500,order:first},{z:10,y:-500,order:second})<0);
  assert.ok(stamp(a,11)>second);
  const statics = prepareMapScene([{z:10,y:200},{z:10,y:-200},{z:0,y:0}]);
  assert.deepEqual([...mergeScene(statics,[{kind:"actor",z:10,y:-999,order:50}])].map(node=>node.kind),["map","map","map","actor"]);
});

test("509A80 local controller +2 is not a ladder bonus; air does not acquire a nearby platform's page", () => {
  const floor = {id:1,x1:-100,x2:100,y1:0,y2:0,prev:0,next:0,layer:2,group:3};
  const nearby = {...floor,id:2,y1:-2,y2:-2,layer:6,group:8};
  const world=collisionWorld({footholds:[floor,nearby],ladders:[{id:1,x:0,y1:-100,y2:0,page:5,ladder:true}]});
  for (const [kind,depth] of [["mob",70002],["user",70002],["self",70004],["npc",70003],["drop",70005]] as const)
    assert.equal(actorDepth({x:0,y:0,foothold:1,action:4},world,kind),depth);
  assert.equal(actorDepth({x:0,y:-50,foothold:0,action:14},world,"user"),160008);
  assert.equal(actorDepth({x:0,y:-50,foothold:0,action:14},world,"self"),160010);
  const jumping={x:0,y:-3,foothold:0,action:6,layer:2,group:3};
  assert.equal(actorDepth(jumping,world,"user"),70002);
  const hitMob={x:0,y:-50,foothold:1,action:14};
  assert.equal(actorDepth(hitMob,world,"mob"),70002,"mob hit1 is not a user ladder");
  const moving={x:0,y:0};
  beginPath(moving,{elements:[{x:1,y:0,foothold:1,action:2,duration:10},{x:2,y:-3,foothold:0,action:4,duration:20}]},0);
  sampleMotion(moving,15,world);
  assert.equal(actorDepth(moving,world,"mob"),70002,"page/group survives multiple fragments between RAF calls");
});

test("real archive: native z ranks and same-crop plane packing fold back to the ordinary avatar", {skip:!existsSync(data)}, () => {
  const archive=WzArchive.open(data), ranks=zRanksOf(archive);
  assert.equal(ranks.get("face"),-36);
  assert.ok(ranks.get("Cp")!>ranks.get("Hr")!);
  for (const stance of ["stand1","swingO1","ladder","rope"]) for (const flip of [false,true]) {
    const look={faceId:20000,hairId:30000,items:[1002000,1040002,1060002,1072001,1302000]};
    const flat=composeAvatarBitmap(archive,look,{stance,frame:0,flip})!;
    const packed=composeAvatarBitmap(archive,look,{stance,frame:0,flip,planes:true})!;
    assert.deepEqual([packed.dx,packed.dy,packed.damageOriginY],[flat.dx,flat.dy,flat.damageOriginY]);
    const h=packed.planeHeight!, w=packed.bitmap.width, n=w*h*4;
    assert.equal(packed.bitmap.height,h*2);
    const folded=bitmapOf(w,h);
    drawCanvas(folded,{width:w,height:h,data:packed.bitmap.data.subarray(0,n)},0,0);
    drawCanvas(folded,{width:w,height:h,data:packed.bitmap.data.subarray(n)},0,0);
    assert.deepEqual(folded,flat.bitmap);
  }
});

test("46BDA0 background index participates in root z; modern front is not a KMS 1.11 flag", {skip:!existsSync(data)}, () => {
  const archive=WzArchive.open(data), reader=artReaderOf(archive)!;
  const root=props(["back",props(["2",props(["bS","sunsetCity"],["no",0],["front",1])])]);
  const back=mapBacks(root,reader)[0]!;
  assert.equal(back.z,2000-147990);
  assert.equal(back.front,false);
});

test("field wiring keeps avatar children atomic, damage fixed-plane and bullets at source depth", () => {
  const client=source("../../client/main.js"), web=source("../src/net/webclient.ts");
  assert.match(client,/drawAvatarBodyAt\(entity, screenX, screenY, now, direction\)/);
  assert.match(client,/ctx\.drawImage\(entry\.img, 0, 0,[\s\S]*?ctx\.drawImage\(entry\.img, 0, h,/);
  assert.match(client,/kind:'damage',mark,z:ATTACK_EFFECT_Z/);
  assert.match(client,/kind: "projectile", shot, z: shot\.z/);
  assert.match(client,/const z = actorDepth\(local \? \(playerBody \?\? at\)/);
  assert.doesNotMatch(client,/z: z - 1/);
  assert.doesNotMatch(client,/if \(back\.front\)/);
  assert.match(web,/z: back\.z/);
  assert.match(web,/"x-frame-plane-height": String\(frame\.planeHeight\)/);
  assert.match(client,/drawName\(selfView\.name, x, y\)/);
});
