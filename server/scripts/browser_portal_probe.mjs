/** Real WZ/Chromium regression. Use ONLY isolated fixture accounts, never the user's save.
 * Default: travel account starts in Amherst. --auto: autotest fixture starts at map 105040200
 * spawn byte 9 (the real west00 arrival), walks and drops through the real type-3 east00 volume.
 * All runtime travel uses keyboard/commands; no local-position or physics-state injection.
 * Same PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE environment as browser_motion_probe.mjs. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const automatic=process.argv.includes('--auto');
try {
 const page=await browser.newPage({viewport:{width:1000,height:800}});page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.probeSent=[];window.probeMessages=[];
  const Original=window.WebSocket;window.WebSocket=class extends Original {
   constructor(...args){super(...args);this.addEventListener('message',event=>{try{window.probeMessages.push({at:performance.now(),...JSON.parse(event.data)});}catch{}});}
   send(data){try{window.probeSent.push({at:performance.now(),...JSON.parse(data)});}catch{}super.send(data);}
  };
 });
 const user=process.env.BROWSER_ACCOUNT??(automatic?'autotest':'travel');
 await page.goto(`http://127.0.0.1:${process.argv[2]??8595}/`);
 await page.click('#title-continue');await page.fill('#user',user);await page.fill('#pass',process.env.BROWSER_PASSWORD??user);await page.click('#login');
 await page.locator('#world-list button').first().click();await page.click('#world-connect');
 await page.locator('#character-list button').first().click();await page.click('#character-enter');
 const field=async(id,index)=>{
  await page.waitForFunction(({id,index})=>{const f=window.probeMessages.findLast(m=>m.t==='field');const move=window.probeSent.findLast(m=>m.t==='move');return f?.mapId===id&&(index===undefined||f.self.spawnPortal===index)&&move?.at>f.at;},{id,index},{timeout:60000});
  await page.waitForTimeout(650);
  return page.evaluate(()=>({field:window.probeMessages.findLast(m=>m.t==='field'),move:window.probeSent.findLast(m=>m.t==='move')}));
 };
 const command=async text=>{await page.fill('#say',text);await page.press('#say','Enter');assert.equal(await page.evaluate(()=>document.activeElement?.id),'','command Enter exits chat instead of refocusing it');};
 const lastMove=()=>page.evaluate(()=>window.probeSent.findLast(m=>m.t==='move'));
 const walkTo=async target=>{
  for(let i=0;i<24;i++) {
   const before=await lastMove(),distance=target-before.x;if(Math.abs(distance)<=8)return;
   const key=distance>0?'ArrowRight':'ArrowLeft',ms=Math.min(1500,Math.max(35,Math.abs(distance)/125*1000-60));
   await page.evaluate(async({key,ms})=>{window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));await new Promise(r=>setTimeout(r,ms));window.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true}));},{key,ms});
   await page.waitForTimeout(350);
  }
  assert.fail(`walk did not reach ${target}: ${JSON.stringify(await lastMove())}`);
 };
 const output=new URL('../../generated/validation/',import.meta.url);await mkdir(output,{recursive:true});
 if(automatic){
  const start=await field(105040200,9);assert.ok(Math.abs(start.move.x-887)<1);
  await walkTo(985);
  await page.keyboard.down('ArrowDown');await page.keyboard.down('Alt');await page.waitForTimeout(120);await page.keyboard.up('Alt');await page.keyboard.up('ArrowDown');
  const arrival=await field(105040100,16);
  assert.equal(arrival.move.x,900);assert.ok(Math.abs(arrival.move.y+1095)<2);
  const sent=await page.evaluate(()=>window.probeSent.filter(m=>m.t==='portal'));
  assert.equal(sent.length,1);assert.equal(sent[0].name,'east00');
  await page.screenshot({path:fileURLToPath(new URL('portal-auto-native.png',output)),clip:await page.locator('#view').boundingBox()});
  console.log('REAL TYPE-3 AUTO / AIRBORNE / NO UP / NATIVE TN OK',JSON.stringify({start:start.move,arrival:arrival.move,spawnPortal:arrival.field.self.spawnPortal,sent}));
 }else{
  await page.waitForFunction(()=>window.probeMessages.some(m=>m.t==='field')&&window.probeSent.some(m=>m.t==='move'));
  if((await page.evaluate(()=>window.probeMessages.findLast(m=>m.t==='field'))).mapId!==1000000)await command('/map 1000000');
  await field(1000000,0);
  await walkTo(-391);await page.keyboard.down('ArrowUp');await field(50000,2);await page.keyboard.up('ArrowUp');
  const there=await lastMove();assert.ok(Math.abs(there.x-3041)<2,'arrival must be east00, NOT sp at -183');
  await page.keyboard.down('ArrowUp');await field(1000000,3);await page.keyboard.up('ArrowUp');
  console.log('REAL UP PORTAL / ROUND TRIP / NATIVE TN OK',JSON.stringify(there));
  await command('/map 1000001');await field(1000001,0);await walkTo(1153);
  await page.keyboard.down('ArrowUp');await field(1000000,1);await page.keyboard.up('ArrowUp');
  const hidden=await lastMove();assert.equal(hidden.x,-52);assert.ok(Math.abs(hidden.y+385)<15);
  // Type 1 is NOT automatic: leave the character standing in it for over the sender guard.
  const count=await page.evaluate(()=>window.probeMessages.filter(m=>m.t==='field').length);await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>window.probeMessages.filter(m=>m.t==='field').length),count);
  await page.keyboard.down('ArrowUp');await field(1000001,5);await page.keyboard.up('ArrowUp');
  console.log('REAL HIDDEN TYPE-1 REQUIRES UP / TN INDEX OK',JSON.stringify(hidden));
  await command('/map 0');await field(0,0);
  const zero=await lastMove();assert.equal(zero.x,-206);
  await command('/where');await command('/maps 두갈래길');await command('/help');
  await page.waitForFunction(()=>document.querySelector('#chatbox').textContent.includes('50000'));
  await command('/map 123456789');await page.waitForFunction(()=>window.probeMessages.some(m=>m.t==='chat'&&m.text.includes('does not exist')));
  assert.equal((await page.evaluate(()=>window.probeMessages.findLast(m=>m.t==='field'))).mapId,0);
  await command('/go 1000000');await field(1000000,0);
  await page.screenshot({path:fileURLToPath(new URL('portal-roundtrip-native.png',output)),clip:await page.locator('#view').boundingBox()});
  console.log('REAL MAP COMMAND / MAP ZERO / MAPS SEARCH / WHERE / MISSING MAP RECOVERY OK',JSON.stringify(zero));
 }
 assert.deepEqual(errors,[]);
 const summary=await page.evaluate(()=>({fields:window.probeMessages.filter(m=>m.t==='field').map(m=>({map:m.mapId,index:m.self.spawnPortal})),portals:window.probeSent.filter(m=>m.t==='portal'),errors:window.probeMessages.filter(m=>m.t==='error')}));
 console.log('REAL BROWSER PORTAL OK',JSON.stringify({...summary,jsErrors:errors}));
} finally {await browser.close();}
