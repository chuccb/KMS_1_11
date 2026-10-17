/** Source-only regressions added 2026-10-18. NOT RUN at the user's request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gaugeFill, expPercent, STATUS_GAUGES, mapTitleLayout, drawItemCount, statusVitalText } from '../../client/hud.mjs';
import { QUICK_SLOTS, quickSlotAt, quickItemAllowed, bindQuickItem, quickItemState, quickItemProfile } from '../../client/quickslots.mjs';
import { mapTitleArt } from '../src/game/mapart.ts';
import type { ArtReader } from '../src/game/wzart.ts';

const props = (record:Record<string,unknown>) => ({props:Object.entries(record).map(([name,value])=>({name,value}))});
test('4FA5E0: integer gauges are 163/163/151; EXP percentage is not rounded',()=>{
  assert.deepEqual(Object.values(STATUS_GAUGES).map(g=>g.w), [163,163,151]);
  assert.equal(gaugeFill(163,1,2),81);
  assert.equal(gaugeFill(151,1,2),75);
  assert.equal(expPercent(199,200),99);
  assert.equal(expPercent(0,15),0);
  for (const max of [0,-1,NaN,Infinity]) assert.equal(gaugeFill(163,1,max),0);
  assert.equal(gaugeFill(163,-3,10),0);
  assert.equal(gaugeFill(163,99,10),163);
});
test('46DA30: right anchored title and optional 40px mark band, without minimap dependence',()=>{
  const withMark=mapTitleLayout(100,60,true), without=mapTitleLayout(100,60,false);
  assert.equal(withMark.x+withMark.width,799);
  assert.equal(withMark.x+withMark.markX,760);
  assert.equal(withMark.x+withMark.streetX+100,757);
  assert.equal(without.x+without.streetX+100,797);
  assert.equal(withMark.y,3);
  assert.equal(withMark.height,40);
});
test('map info strings/mark preserve exact Korean resource names; None makes no resource request',()=>{
  const calls:string[]=[];
  const reader={at:(path:string)=>{calls.push(path);return {};} } as unknown as ArtReader;
  const title=mapTitleArt(props({info:props({streetName:'빅토리아로드',mapName:'헤네시스',mapMark:'헤네시스'})}),reader);
  assert.deepEqual(title,{streetName:'빅토리아로드',mapName:'헤네시스',mark:{path:'Map/MapHelper.img/mark/헤네시스'}});
  assert.deepEqual(calls,['Map/MapHelper.img/mark/헤네시스']);
  calls.length=0;
  assert.deepEqual(mapTitleArt(props({info:props({mapMark:'None'})}),reader),{streetName:'',mapName:''});
  assert.deepEqual(calls,[]);
  const missing={at:()=>undefined} as unknown as ArtReader;
  assert.throws(()=>mapTitleArt(props({info:props({mapMark:'requested'})}),missing),/mapMark canvas cannot be read/);
});
test('4F9AD0 strict vital targets, including EXP label; no permanent numbers over gauges',()=>{
  const self={hp:12,mp:8,exp:7,expToNext:15},totals={maxHp:50,maxMp:30};
  assert.equal(statusVitalText(5,536,self,totals),'HP : 12 / 50');
  assert.equal(statusVitalText(11,583,self,totals),'EXP : 7 / 15');
  assert.equal(statusVitalText(4,536,self,totals),undefined);
  assert.equal(statusVitalText(5,535,self,totals),undefined);
  assert.equal(statusVitalText(11,590,self,totals),undefined);
});
test('525AE0: original ItemNo bitmaps, variable width, zero spacing and loading guard',()=>{
  const draws:unknown[][]=[];
  const ctx={drawImage:(...args:unknown[])=>draws.push(args)};
  const image=(path:string)=>({ready:true,img:{path,naturalWidth:path.endsWith('/1')?5:8}});
  drawItemCount(ctx,image,101,692,584);
  assert.deepEqual(draws.map(d=>[d[1],d[2]]),[[692,584],[697,584],[705,584]]);
  draws.length=0;
  drawItemCount(ctx,()=>({ready:false}),12,692,584);
  assert.equal(draws.length,0);
});
test('PE 5BCEC0 / 511E20: seven original positions and VK keys; right/bottom are exclusive',()=>{
  assert.deepEqual(QUICK_SLOTS.map(s=>s.key),['Shift','Insert','Home','PageUp','Delete','End','PageDown']);
  for (let i=0;i<7;i++) {
    const s=QUICK_SLOTS[i];
    assert.equal(quickSlotAt(s.x,s.y),i);
    assert.equal(quickSlotAt(s.x+31,s.y+31),i);
    assert.notEqual(quickSlotAt(s.x+32,s.y+32),i);
  }
  assert.equal(quickSlotAt(750,480),-1);
});
test('463DF0 and 512570: only 200/201/202, unique ID bindings, aggregate count, lowest slot use',()=>{
  for(const id of [2000000,2010000,2020000]) assert.equal(quickItemAllowed(id),true);
  for(const id of [2030000,2070000,1302000,2000000.5,NaN]) assert.equal(quickItemAllowed(id),false);
  const original=[2000000,null,null,null,null,null,null];
  const bound=bindQuickItem(original,3,2000000)!;
  assert.deepEqual(bound,[null,null,null,2000000,null,null,null]);
  assert.equal(original[0],2000000,'no mutation of caller/profile');
  assert.equal(bindQuickItem(original,7,2000000),undefined);
  const items=[{slot:8,itemId:2000000,quantity:4},{slot:2,itemId:2000000,quantity:3},{slot:1,itemId:2000001,quantity:9}];
  const state=quickItemState({tabs:[{tab:2,items}]},2000000);
  assert.equal(state.quantity,7);assert.equal(state.item?.slot,2);
  assert.deepEqual(quickItemState(undefined,2000000),{quantity:0,item:undefined});
});
test('local quickslot profiles are owner scoped, corrupt/blocked storage cannot abort field entry',()=>{
  const data=new Map<string,string>();
  const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
  assert.equal(quickItemProfile(storage,'a:1').bind(2,2000000),true);
  assert.equal(quickItemProfile(storage,'a:1').values()[2],2000000);
  assert.equal(quickItemProfile(storage,'b:1').values()[2],null);
  const blocked={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
  assert.equal(quickItemProfile(blocked,'a').bind(0,2000000),true);
});
