import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {WzArchive} from '../src/wz/archive.ts';
import {miniMapArt} from '../src/game/minimap.ts';
import {artReaderOf,type ArtReader} from '../src/game/wzart.ts';
import {loadMapArt} from '../src/game/mapart.ts';
const path=fileURLToPath(new URL('../../Data.wz',import.meta.url));
const archive=existsSync(path)?WzArchive.open(path):null;
const available={skip:archive===null};
test('a map without original miniMap does not invent a thumbnail; present-but-unreadable canvas fails loudly',()=>{
 const reader:ArtReader={at:()=>undefined,node:()=>undefined,size:0,clear(){}};
 assert.equal(miniMapArt({props:[]},reader,'Map/Map/000000000.img'),undefined);
 assert.throws(()=>miniMapArt({props:[{name:'miniMap',value:{props:[]}}]},reader,'Map/Map/000000000.img'),/canvas cannot be read/);
});
test('all 100 real maps: 80 original miniMap canvases, 20 absent nodes; no fallback or lazy-PNG side effect',available,()=>{
 const reader=artReaderOf(archive!)!;let present=0,absent=0;
 for(const image of archive!.images.filter(i=>/^Map\/Map\/\d{9}\.img$/.test(i.path))){
  const art=miniMapArt(archive!.objects(image.path)[0],reader,image.path);
  if(!art){absent++;continue;}present++;assert.equal(art.mag,4);assert.ok(art.canvasWidth>0&&art.canvasHeight>0);
  assert.equal(typeof Object.getOwnPropertyDescriptor(reader.at(art.path)!,"png")?.get,"function","metadata leaves PNG lazy");
  assert.equal(art.path,image.path+'/miniMap/canvas');assert.ok(art.width>=art.canvasWidth*16);assert.ok(art.height>=art.canvasHeight*16);
 }
 assert.deepEqual([present,absent],[80,20]);
});
test('actual miniMap metadata is served with the map art: native geometry, NPC original coordinates, frame resources',available,()=>{
 const reader=artReaderOf(archive!)!;
 const mini=loadMapArt(archive!,1000000,reader)!.miniMap!;
 assert.deepEqual(mini,{path:'Map/Map/001000000.img/miniMap/canvas',canvasWidth:251,canvasHeight:100,width:4027,height:1612,centerX:530,centerY:878,mag:4,npcs:[]});
 const town=loadMapArt(archive!,100000000,reader)!.miniMap!;assert.equal(town.canvasWidth,437);assert.deepEqual(town.npcs,[{x:158,y:273},{x:3924,y:120}]);
 for(const key of ['nw','n','ne','w','e','sw','s','se'])assert.ok(reader.at(`UI/UIWindow.img/MiniMap/${key}`));
 assert.deepEqual([reader.at('UI/UIWindow.img/MiniMap/sw')!.width,reader.at('UI/UIWindow.img/MiniMap/sw')!.height],[45,11]);
});
