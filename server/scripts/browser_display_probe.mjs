/** No account/login needed. Chromium layout + screenshot sampling of a diagnostic black/white
 * stripe pattern in the real 800x600 game canvas. The diagnostic is never shipped as game art. */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const results=[];
 for(const dpr of [1,1.25,1.5,2,3]){
  const page=await browser.newPage({viewport:{width:1001,height:801},deviceScaleFactor:dpr}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.probeRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>1;});
  await page.goto(`http://127.0.0.1:${process.argv[2]??8495}/`);
  const measure=()=>page.evaluate(()=>{const c=document.querySelector('#view'),r=c.getBoundingClientRect(),g=document.querySelector('#game-ui').getBoundingClientRect();return{dpr:devicePixelRatio,width:r.width,height:r.height,left:r.left,top:r.top,deviceScale:r.width*devicePixelRatio/800,mode:c.dataset.displayMode,ui:[g.left,g.top,g.width,g.height],backing:[c.width,c.height],smoothing:c.getContext('2d').imageSmoothingEnabled};});
  const layout=await measure(),unit=Math.round(layout.deviceScale);assert.ok(Math.abs(layout.deviceScale-unit)<0.001);assert.deepEqual(layout.backing,[800,600]);assert.equal(layout.smoothing,false);
  assert.ok(Math.abs(layout.left*dpr-Math.round(layout.left*dpr))<0.04);assert.ok(Math.abs(layout.top*dpr-Math.round(layout.top*dpr))<0.04);
  assert.ok(Math.abs(layout.ui[0]-layout.left)<0.02&&Math.abs(layout.ui[1]-layout.top)<0.02&&Math.abs(layout.ui[2]-layout.width)<0.03);
  await page.evaluate(()=>{const x=document.querySelector('#view').getContext('2d');for(let i=0;i<800;i++){x.fillStyle=i%2?'#fff':'#000';x.fillRect(i,0,1,600);}});
  const png=await page.screenshot();
  const row=await page.evaluate(async({encoded,left,top,count})=>{
   const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob());const c=new OffscreenCanvas(image.width,image.height),x=c.getContext('2d');x.drawImage(image,0,0);
   const pixels=x.getImageData(left,top,count,1).data;return Array.from({length:count},(_,i)=>pixels[i*4]);
  },{encoded:png.toString('base64'),left:Math.round(layout.left*dpr),top:Math.round(layout.top*dpr)+10*unit,count:32*unit});
  console.log('grid sample',JSON.stringify({dpr,layout,row:row.slice(0,36)}));
  assert.deepEqual([...new Set(row)].sort((a,b)=>a-b),[0,255],'no interpolated gray pixels');
  for(let i=0;i<row.length;i++)assert.equal(row[i],Math.floor(i/unit)%2?255:0,'each source column must occupy the SAME integer number of device pixels');
  // Change modes through the actual control, then reload to check persistence; no game state injection.
  await page.evaluate(()=>{const s=document.querySelector('#view-scale');s.value='fit';s.dispatchEvent(new Event('change'));});
  assert.deepEqual(await page.evaluate(()=>{const x=document.querySelector('#view').getContext('2d');return [...x.getImageData(1,0,1,1).data];}),[255,255,255,255],'changing presentation must not clear the game canvas');
  const fit=await measure();assert.ok(Math.abs(fit.width-1001)<0.02);assert.equal(fit.mode,'fit');
  await page.reload();assert.equal((await measure()).mode,'fit');
  await page.evaluate(()=>{const s=document.querySelector('#view-scale');s.value='native';s.dispatchEvent(new Event('change'));});assert.equal((await measure()).width,800);
  await page.evaluate(()=>{const s=document.querySelector('#view-scale');s.value='pixel';s.dispatchEvent(new Event('change'));});
  await page.setViewportSize({width:1203,height:903});const resized=await measure();assert.ok(Math.abs(resized.deviceScale-Math.round(resized.deviceScale))<0.001);
  if(dpr===1){
   const session=await page.context().newCDPSession(page);
   await session.send('Emulation.setDeviceMetricsOverride',{width:1203,height:903,deviceScaleFactor:1.25,mobile:false});
   // Chromium 153 flushes resolution media-query changes at a rendering opportunity.
   // Keep game RAF stopped, but allow one native frame for the real matchMedia listener.
   await page.evaluate(()=>new Promise(resolve=>window.probeRAF(resolve)));
   console.log('same-page DPR change',await measure());
   await page.waitForFunction(()=>devicePixelRatio===1.25&&document.querySelector('#view').getBoundingClientRect().width===640,undefined,{polling:50,timeout:5000});
   await session.detach();
  }
  assert.deepEqual(errors,[]);results.push({dpr,layout,unit,shades:[...new Set(row)],fitWidth:fit.width,errors});await page.close();
 }
 console.log('REAL DPR / UNIFORM DEVICE PIXELS / NO FILTER BLUR / OVERLAY ALIGNMENT / MODES / RESIZE / PERSISTENCE OK',JSON.stringify(results));
}finally{await browser.close();}
