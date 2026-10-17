import test from 'node:test';
import assert from 'node:assert/strict';
import {miniMapViewport,miniMapPoint,miniMapMarks,MINI_FRAME} from '../../client/minimap.mjs';
const amherst={canvasWidth:251,canvasHeight:100,width:4027,height:1612,centerX:530,centerY:878,mag:4,npcs:[]};
test('actual Amherst miniMap uses full 251x100 canvas and native center/mag, not VR bounds',()=>{
 const v=miniMapViewport(amherst,{x:-91,y:184});assert.deepEqual(v,{width:251,height:100,x:0,y:0});assert.deepEqual(miniMapPoint(amherst,v,{x:-91,y:184}),{x:27,y:66});assert.equal(MINI_FRAME,'UI/UIWindow.img/MiniMap');
});
test('native threshold crops wide maps to 210 and tall maps to 112; no thumbnail scaling',()=>{
 const wide={...amherst,canvasWidth:437,width:6994};assert.equal(miniMapViewport(wide,{x:0,y:0}).width,210);
 assert.equal(miniMapViewport({...amherst,canvasWidth:279},{x:0,y:0}).width,279);assert.equal(miniMapViewport({...amherst,canvasWidth:280},{x:0,y:0}).width,210);
 assert.equal(miniMapViewport({...amherst,canvasHeight:149},{x:0,y:0}).height,149);assert.equal(miniMapViewport({...amherst,canvasHeight:150},{x:0,y:0}).height,112);
 const v=miniMapViewport(wide,{x:4000,y:0});assert.equal(v.x,178);assert.ok(v.x+v.width<=wide.canvasWidth);
});
test('negative coordinates use arithmetic-shift floor, not truncation or rounding',()=>{assert.deepEqual(miniMapPoint({...amherst,centerX:0,centerY:0}, {x:0,y:0},{x:-1,y:-17}),{x:-1,y:-2});});
test('native marks: only visible type2 doors, static NPC x/y, red others, yellow self; no monster/hidden-door dots',()=>{
 const v=miniMapViewport(amherst,{x:0,y:0}),map={...amherst,npcs:[{x:0,y:0}]};
 const doors=[0,1,2,3].map(type=>({type,x:0,y:0}));const marks=miniMapMarks(map,v,{x:0,y:0},[{x:1,y:1}],doors,0);
 assert.deepEqual(marks.map(m=>m.kind),['portal','portal','npc','npc','user','user','self','self']);assert.deepEqual([...new Set(marks.map(m=>m.color))],['#8090ffcc','#20ff20aa','#ff2020aa','#ffff00dd']);
 assert.equal(miniMapMarks(map,v,{x:0,y:0},[],doors,64).some(m=>m.kind==='portal'),false);assert.equal(miniMapMarks(map,v,{x:0,y:0},[],doors,40).some(m=>m.kind==='npc'),false);
});
