/** Isolated fixture account only. Real keyboard, native WZ art, actual canvas blits and DOM drag.
 * PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE same as browser_motion_probe.mjs. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1000,height:800}});page.setDefaultTimeout(45000);
 const errors=[],httpErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)httpErrors.push([r.status(),r.url()]);});
 await page.addInitScript(()=>{
  window.probeMessages=[];window.probeSent=[];window.probeMiniBlits=[];window.probeMiniMarks=[];
  const WS=window.WebSocket;window.WebSocket=class extends WS{
   constructor(...args){super(...args);this.addEventListener('message',e=>{try{window.probeMessages.push({at:performance.now(),...JSON.parse(e.data)});}catch{}});}
   send(data){try{window.probeSent.push({at:performance.now(),...JSON.parse(data)});}catch{}super.send(data);}
  };
  const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(img,...args){
   if(decodeURIComponent(img?.src??'').includes('/miniMap/canvas')){window.probeMiniBlits.push({src:decodeURIComponent(img.src),args,canvas:[this.canvas.width,this.canvas.height]});if(window.probeMiniBlits.length>500)window.probeMiniBlits.shift();}
   return draw.call(this,img,...args);
  };
  const fill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(...args){
   if(this.canvas.width===257&&this.canvas.height===113&&String(this.fillStyle).startsWith('rgba(255, 255, 0,')){window.probeMiniMarks.push(args);if(window.probeMiniMarks.length>200)window.probeMiniMarks.shift();}
   return fill.apply(this,args);
  };
 });
 await page.goto(`http://127.0.0.1:${process.argv[2]??8595}/`);
 await page.click('#title-continue');await page.fill('#user',process.env.BROWSER_ACCOUNT??'travel');await page.fill('#pass',process.env.BROWSER_PASSWORD??'travel');await page.click('#login');
 await page.locator('#world-list button').first().click();await page.click('#world-connect');await page.locator('#character-list button').first().click();await page.click('#character-enter');
 await page.waitForFunction(()=>window.probeMessages.some(m=>m.t==='field'));
 const command=async text=>{await page.fill('#say',text);await page.press('#say','Enter');};
 const enter=async id=>{const before=await page.evaluate(()=>window.probeMessages.filter(m=>m.t==='field').length);await command(`/map ${id}`);await page.waitForFunction(({id,before})=>{const fields=window.probeMessages.filter(m=>m.t==='field');return fields.length>before&&fields.at(-1).mapId===id;},{id,before});};
 if((await page.evaluate(()=>window.probeMessages.findLast(m=>m.t==='field'))).mapId!==1000000)await enter(1000000);
 await page.waitForFunction(()=>window.probeMiniBlits.some(b=>b.src.includes('/001000000.img/'))&&window.probeMiniMarks.length>0);
 const mini=page.locator('#minimap-window');assert.equal(await mini.isVisible(),true);
 const initial=await mini.boundingBox();assert.deepEqual([initial.width,initial.height],[257,113]);
 const mark0=await page.evaluate(()=>window.probeMiniMarks.at(-2));
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(1000);await page.keyboard.up('ArrowRight');await page.waitForTimeout(650);
 const mark1=await page.evaluate(()=>window.probeMiniMarks.at(-2));assert.ok(mark1[0]>mark0[0],'local yellow marker follows the real player');
 await page.keyboard.press('m');assert.equal(await mini.isVisible(),false);await page.keyboard.press('m');assert.equal(await mini.isVisible(),true);
 await page.mouse.move(initial.x+100,initial.y+40);await page.mouse.down();await page.mouse.move(initial.x+180,initial.y+80,{steps:8});await page.mouse.up();
 const dragged=await mini.boundingBox();assert.deepEqual([dragged.x-initial.x,dragged.y-initial.y],[80,40]);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kms111.minimap')));assert.deepEqual(saved,{x:88,y:48,shown:true});
 // Canvas inventory is drawn over the map; its click area must not be swallowed by the minimap's drag overlay.
 await page.keyboard.press('i');await page.mouse.move(dragged.x+40,dragged.y+25);await page.waitForTimeout(200);
 const covered=await mini.evaluate(e=>e.style.pointerEvents);assert.equal(covered,'none');await page.keyboard.press('i');
 const out=new URL('../../generated/validation/',import.meta.url);await mkdir(out,{recursive:true});
 await page.screenshot({path:fileURLToPath(new URL('minimap-native-amherst.png',out)),clip:await page.locator('#view').boundingBox()});
 await enter(100000000);await page.waitForFunction(()=>window.probeMiniBlits.some(b=>b.src.includes('/100000000.img/')));
 const wide=await mini.boundingBox();assert.deepEqual([wide.width,wide.height],[216,99]);
 await page.screenshot({path:fileURLToPath(new URL('minimap-native-henesys.png',out)),clip:await page.locator('#view').boundingBox()});
 await enter(101000000);await page.waitForFunction(()=>window.probeMiniBlits.some(b=>b.src.includes('/101000000.img/')));
 const tall=await mini.boundingBox();assert.deepEqual([tall.width,tall.height],[185,125]);
 await enter(20001);await page.waitForTimeout(800);assert.equal(await mini.isVisible(),false,'original map has no miniMap node; do not draw an invented fallback');
 await enter(1000000);await page.waitForFunction(()=>!document.querySelector('#minimap-window').classList.contains('hidden'));
 assert.equal((await mini.boundingBox()).x,dragged.x,'drag position survives map changes');
 const blits=await page.evaluate(()=>window.probeMiniBlits);for(const b of blits){assert.equal(b.args[2],b.args[6]);assert.equal(b.args[3],b.args[7]);}
 assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
 console.log('REAL NATIVE MINIMAP / LIVE YELLOW MARK / M / DRAG / CANVAS UI OCCLUSION / WIDE & TALL CROP / ABSENT MAP / 1:1 BLITS OK',JSON.stringify({initial,dragged,wide,tall,saved,mark0,mark1,blits:blits.length,errors,httpErrors}));
}finally{await browser.close();}
