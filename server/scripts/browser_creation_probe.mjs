/** Real Chromium / actual encrypted login packets. ISOLATED maker/female test store only.
 * Start ports 8595/8596/8597 with those empty accounts; never point this at the user's save.
 * PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, LD_LIBRARY_PATH match browser_motion_probe.mjs. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const port = Number(process.argv[2] ?? 8595);
if (port === 8495) throw new Error('Refusing the user-facing live save: use an isolated creation fixture.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const output = new URL('../../generated/validation/', import.meta.url); await mkdir(output,{recursive:true});
const errors=[],httpErrors=[],results=[];
try {
  for (const [user, name, gender] of [['maker','NativeOne',0],['female','한글용사',1]]) {
    const context=await browser.newContext({viewport:{width:1000,height:800}}),page=await context.newPage();
    page.on('pageerror',(e)=>errors.push(e.message));
    page.on('response',(r)=>{if(r.status()>=400)httpErrors.push([r.status(),r.url()]);});
    await page.addInitScript(()=>{
      window.qaSent=[];window.qaMessages=[];window.qaDraw=[];window.qaTexts=[];window.qaBlob={};
      const Ws=window.WebSocket; window.WebSocket=class extends Ws {
        constructor(...args){super(...args);this.addEventListener('message',(e)=>{try{window.qaMessages.push(JSON.parse(e.data));}catch{}});}
        send(text){try{window.qaSent.push(JSON.parse(text));}catch{}super.send(text);}
      };
      const fetchOriginal=window.fetch;
      window.fetch=async(...args)=>{const response=await fetchOriginal(...args);
        if(String(args[0]).includes('/api/avatar.png')){const blob=response.blob.bind(response);response.blob=async()=>{const b=await blob();b.qaQuery=String(args[0]);return b;};}return response;};
      const create=URL.createObjectURL;URL.createObjectURL=(blob)=>{const url=create(blob);window.qaBlob[url]=blob.qaQuery;return url;};
      const raf=window.requestAnimationFrame;window.requestAnimationFrame=(callback)=>raf((now)=>{if(callback.name==='frame'){window.qaDraw=[];window.qaTexts=[];}callback(now);});
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(img,...args){window.qaDraw.push({src:window.qaBlob[img.src]??decodeURIComponent(img.src??''),args});return draw.call(this,img,...args);};
      const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){window.qaTexts.push({text:String(text),x,y});return fill.call(this,text,x,y,...args);};
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.click('#title-continue');await page.fill('#user',user);await page.fill('#pass',user);await page.click('#login');
    await page.locator('#world-list button').first().click();await page.click('#world-connect');
    await page.waitForFunction(()=>window.qaMessages.some((m)=>m.t==='characters'));
    assert.equal(await page.locator('#character-delete').isDisabled(),true);
    await page.click('#character-new'); await page.click('#native-ok');
    await page.locator('#new-name').waitFor();
    const pos=await page.evaluate(()=>{const input=document.getElementById('new-name').getBoundingClientRect(),dialog=document.getElementById('new-character').getBoundingClientRect();const scale=document.getElementById('view').getBoundingClientRect().width/800;return{dx:(input.x-dialog.x)/scale,dy:(input.y-dialog.y)/scale,w:dialog.width/scale,h:dialog.height/scale};});
    assert.deepEqual(pos,{dx:110,dy:143,w:260,h:424});
    await page.fill('#new-name',name);await page.click('#create');
    assert.equal(await page.evaluate(()=>window.qaSent.some((m)=>m.t==='create')),false,'OK must require a checked current name');
    await page.click('#native-ok');
    if(!gender){
      await page.fill('#new-name','abc');await page.click('#check-name');
      await page.waitForFunction(()=>window.qaMessages.some((m)=>m.t==='error'));
      await page.click('#native-ok');await page.fill('#new-name',name);
    }
    await page.click('#check-name');
    await page.waitForFunction(()=>window.qaMessages.some((m)=>m.t==='name-checked'&&m.result===0));await page.click('#native-ok');
    await page.fill('#new-name',name+'1');await page.click('#create');
    assert.equal(await page.evaluate(()=>window.qaSent.some((m)=>m.t==='create')),false,'editing invalidates availability');
    await page.click('#native-ok');await page.fill('#new-name',name);await page.click('#check-name');
    await page.waitForFunction(()=>window.qaMessages.filter((m)=>m.t==='name-checked').length===2);await page.click('#native-ok');
    const catalog=await (await page.request.get(`http://127.0.0.1:${port}/api/creation`)).json(),groups=gender?catalog.female:catalog.male;
    for(let i=0;i<6;i++){await page.click(`#create-combo-${i}`);assert.equal(await page.locator('#creation-options button').count(),groups[i].length);await page.locator('#creation-options button').last().click();}
    const expected=groups.map((g)=>g.at(-1).id);
    await page.click('#roll-dice'); await page.waitForFunction(()=>!document.getElementById('roll-dice').disabled);
    await page.waitForFunction(([face,hair])=>window.qaDraw.some((d)=>d.src.includes('/api/avatar.png')&&d.src.includes(`face=${face}`)&&d.src.includes(`hair=${hair}`)),expected).catch(async(error)=>{console.log('PREVIEW DEBUG',JSON.stringify({expected,errors,httpErrors,state:await page.evaluate(()=>({draw:window.qaDraw,texts:window.qaTexts,messages:window.qaMessages,sent:window.qaSent,blob:window.qaBlob}))}));await page.screenshot({path:'/tmp/creation-debug.png'});throw error;});
    await page.waitForFunction(()=>window.qaDraw.some((d)=>d.src.includes('CharSelect/newDlg')));
    const shownDice=await page.evaluate(()=>[381,401,421,441].map((y)=>Number(window.qaTexts.find((t)=>t.x===348&&t.y===y)?.text)));
    assert.equal(shownDice.reduce((a,b)=>a+b,0),25);
    await page.screenshot({path:fileURLToPath(new URL(`creation-${user}-native.png`,output)),clip:await page.locator('#view').boundingBox()});
    await page.click('#create');
    await page.waitForFunction(()=>window.qaMessages.some((m)=>m.t==='created'&&m.ok));
    const state=await page.evaluate(()=>({sent:window.qaSent.find((m)=>m.t==='create'),created:window.qaMessages.find((m)=>m.t==='created'),characters:window.qaMessages.filter((m)=>m.t==='characters').at(-1).characters}));
    assert.deepEqual(state.sent.appearance.slice(0,6),expected);assert.deepEqual(state.sent.appearance.slice(6),shownDice);
    assert.equal(state.characters[0].name,name);assert.equal(state.characters[0].str,shownDice[0]);assert.equal(state.characters[0].luk,shownDice[3]);
    assert.equal(await page.locator('#character-dialogs').isVisible(),false);
    // Cancel is entirely local, then confirm exactly one real delete packet.
    await page.click('#character-delete');await page.click('#native-no');
    assert.equal(await page.evaluate(()=>window.qaSent.some((m)=>m.t==='delete-character')),false);
    await page.click('#character-delete');
    await page.waitForFunction(()=>window.qaDraw.some((d)=>d.src.includes('YesNo/backgrnd')));
    await page.screenshot({path:fileURLToPath(new URL(`deletion-${user}-native.png`,output)),clip:await page.locator('#view').boundingBox()});
    await page.click('#native-yes');await page.waitForFunction(()=>window.qaMessages.some((m)=>m.t==='deleted'&&m.ok));
    const deletion=await page.evaluate(()=>window.qaSent.filter((m)=>m.t==='delete-character'));
    assert.equal(deletion.length,1);assert.equal(deletion[0].id,state.created.id);
    assert.equal(await page.locator('#character-delete').isDisabled(),true);
    assert.equal(await page.locator('#character-new').isDisabled(),false);
    results.push({user,gender,name,appearance:state.sent.appearance,createdId:state.created.id,deletePackets:deletion.length});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
  console.log(JSON.stringify({results,errors,httpErrors},null,2));console.log('REAL NATIVE CREATION / DICE / CP949 / CONFIRMED DELETION OK');
}finally{await browser.close();}
