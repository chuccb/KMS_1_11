import {releaseOnInterrupt} from "./pointer.mjs";
import {gameProfile, gameSettings} from './gameoptions.mjs';
import { soundProfile, soundSettings, nativeVolume, sliderCenter, sliderStep } from './systemsettings.mjs';

/** CUIGameMenu 52C8E0 and CUISysOpt 52D800. Native art, transparent DOM hit targets.
 * Unsupported Quest/Party/Community and DirectX/video/screenshot controls stay disabled.
 * No fake packet or modern settings skin stands in for their missing implementations.
 */
export function systemMenu({ctx, image, audio, point, canOpen, onOpen, onQuit, onGameSettings=()=>{}}) {
  const root = document.createElement('section');
  root.id = 'system-menu'; root.className = 'hidden'; root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  document.getElementById('game-ui').append(root);
  let storage;
  try { storage = localStorage; } catch {}
  const profile = soundProfile(storage), game=gameProfile(storage);
  let currentGame=game.values();
  const applyGame=value=>{currentGame=gameSettings(value);onGameSettings({...currentGame});};
  applyGame(currentGame);
  audio.applySettings(profile.values());
  // Warm the small native menu set. Opening must not depend on an unrelated inventory icon load.
  for(const kind of ['GameMenu','SysOpt','GameOpt'])image(`UI/UIWindow.img/${kind}/backgrnd`);
  for(const name of ['Quest','Party','Community'])image(`UI/UIWindow.img/GameMenu/Bt${name}/disabled/0`);
  for(const base of ['UI/UIWindow.img/GameMenu/BtGameOpt','UI/UIWindow.img/UtilDlgEx/BtOK','UI/UIWindow.img/UtilDlgEx/BtCancel','UI/UIWindow.img/GameMenu/BtSysOpt','UI/UIWindow.img/GameMenu/BtQuit',
    'UI/UIWindow.img/BtUIClose','UI/Basic.img/BtOK','UI/Basic.img/BtCancel']) {
    for(const state of ['normal','pressed','mouseOver'])image(`${base}/${state}/0`);
  }
  for(const name of ['left','mid','right','thumbNormal','thumbPressed','thumbDisabled','thumbMouseOver'])image(`UI/Basic.img/Slider/${name}`);
  for(let i=0;i<4;i++)image(`UI/Basic.img/CheckBox/${i}`);
  image('UI/Basic.img/BtComboBox/disabled/0');
  let mode, at, draft, original, previousFocus, hover, pressed, sliding;
  let controls = [];
  const box = (el,x,y,w,h) => Object.assign(el.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});
  const stamp = (path,x,y) => { const a=image(path); if(a.ready) ctx.drawImage(a.img,x,y); };
  function control(id, label, path, x,y,w,h, click, disabled=false) {
    const el=document.createElement('button'); el.type='button'; el.className='sprite-hit';
    el.setAttribute('aria-label',label); el.title=label; el.disabled=disabled;
    box(el,at.x+x,at.y+y,w,h); root.append(el);
    const c={id,el,path,x,y,w,h,disabled}; controls.push(c);
    el.addEventListener('mouseenter',()=>{hover=id;if(!disabled)void audio.effect('UI/BtMouseOver');});
    el.addEventListener('mouseleave',()=>{if(hover===id)hover=undefined;});
    el.addEventListener('focus',()=>{hover=id;});
    el.addEventListener('blur',()=>{if(hover===id)hover=undefined;});
    el.addEventListener('mousedown',e=>{if(e.button===0)pressed=id;});
    if(click) el.addEventListener('click',click);
    return c;
  }
  function close(accept=false, restoreFocus=true) {
    if(!mode)return;
    if(mode==='sound') {
      // 52DE80 previews immediately; 52DF20 OK writes, Cancel restores the original six fields.
      if(accept) profile.save(draft);
      audio.applySettings(accept ? draft : original);
    }
    if(mode==='game') {
      if(accept)game.save(draft);
      applyGame(accept?draft:original);
    }
    // Blur while the active control is still attached; contains() is false after replaceChildren().
    if(root.contains(document.activeElement))document.activeElement.blur();
    mode=undefined; sliding=hover=pressed=undefined; controls=[];
    root.replaceChildren(); root.classList.add('hidden');
    if(restoreFocus && previousFocus?.isConnected)previousFocus.focus();
    previousFocus=undefined;
  }
  function mount(next) {
    root.replaceChildren(); controls=[]; hover=pressed=sliding=undefined;
    mode=next; at=next==='menu'?{x:312,y:180}:next==='game'?{x:317,y:177}:{x:226,y:187};
    root.setAttribute('aria-label',next==='menu'?'게임 메뉴 / 遊戲選單':next==='game'?'게임 옵션 / 遊戲設定':'시스템 옵션 / 系統設定');
    root.classList.remove('hidden');
  }
  function updateSound() {
    draft=soundSettings(draft); audio.applySettings(draft);
    for(const c of controls) {
      if(c.slider && !c.disabled) {
        c.el.setAttribute('aria-valuenow',String(draft[c.id]));
        c.el.setAttribute('aria-valuetext',`${Math.round(nativeVolume(draft[c.id])*100)}%`);
      }
      if(c.check)c.el.setAttribute('aria-checked',String(draft[c.id]));
    }
  }
  function slider(id,label,y) {
    const c=control(id,label,undefined,116,y,122,16);
    c.slider=true; c.el.setAttribute('role','slider');
    c.el.setAttribute('aria-valuemin','0'); c.el.setAttribute('aria-valuemax','19');
    c.el.addEventListener('mousedown',e=>{
      if(e.button!==0)return;
      e.preventDefault(); c.el.focus(); sliding=c;
      draft[id]=sliderStep(point(e).x-at.x-c.x); updateSound();
    });
    return c;
  }
  function openGame() {
    mount('game');original={...currentGame};draft={...original};
    const ids=['minimap','whisper','messenger','exchange','party','game'];
    const labels=['顯示小地圖','接受悄悄話','接受Messenger邀請（尚未接瀏覽器介面）',
      '接受交易邀請（尚未接瀏覽器介面）','接受組隊邀請（尚未接瀏覽器介面）','小遊戲（原版亦停用）'];
    ids.forEach((id,i)=>{
      const c=control(id,labels[i],undefined,134,50+26*i,12,12,()=>{
        draft[id]=!draft[id];applyGame(draft);c.el.setAttribute('aria-checked',String(draft[id]));
      },i>=2);
      c.check=true;c.el.setAttribute('role','checkbox');c.el.setAttribute('aria-checked',String(draft[id]));
    });
    control('ok','確定並保存','UI/UIWindow.img/UtilDlgEx/BtOK',54,203,50,23,()=>close(true));
    control('cancel','取消並還原','UI/UIWindow.img/UtilDlgEx/BtCancel',107,203,50,23,()=>close());
    controls[0].el.focus();
  }
  function openSound() {
    mount('sound'); original=audio.settings; draft={...original};
    const video=control('video','DirectX 畫質控制尚未移植',undefined,116,50,180,16,undefined,true);
    video.slider=true; video.fixed=3;
    slider('bgm','背景音樂音量',84);
    const bgm=control('bgmMuted','背景音樂靜音',undefined,320,84,12,12,()=>{draft.bgmMuted=!draft.bgmMuted;updateSound();});
    bgm.check=true;bgm.el.setAttribute('role','checkbox');
    slider('effects','音效音量',118);
    const se=control('effectsMuted','音效靜音',undefined,320,118,12,12,()=>{draft.effectsMuted=!draft.effectsMuted;updateSound();});
    se.check=true;se.el.setAttribute('role','checkbox');
    control('screenshot','原版截圖目的地（遊戲資料夾／桌面／C磁碟）尚未移植',undefined,84,152,205,18,undefined,true);
    control('ok','確定並保存','UI/Basic.img/BtOK',200,183,65,24,()=>close(true));
    control('cancel','取消並還原','UI/Basic.img/BtCancel',270,183,65,24,()=>close());
    updateSound(); controls.find(c=>c.id==='bgm').el.focus();
  }
  function open() {
    if(mode || !canOpen())return false;
    previousFocus=document.activeElement;onOpen();mount('menu');
    control('close','關閉選單','UI/UIWindow.img/BtUIClose',128,9,32,15,()=>close());
    const names=['Quest','Party','Community','GameOpt','SysOpt','Quit'];
    const labels=['任務（尚未實作）','組隊視窗（尚未實作）','社群視窗（尚未實作）','遊戲設定（小地圖／悄悄話）','系統設定','離開目前連線並回到登入畫面'];
    names.forEach((name,i)=>control(name,labels[i],`UI/UIWindow.img/GameMenu/Bt${name}`,20,63+27*i,136,23,
      ()=>{if(i===3)openGame();else if(i===4)openSound();else if(i===5){close(false,false);onQuit();}},i<3));
    controls.find(c=>c.id==='SysOpt').el.focus();void audio.effect('UI/DlgNotice');return true;
  }
  window.addEventListener('mousemove',e=>{
    if(!sliding)return;
    draft[sliding.id]=sliderStep(point(e).x-at.x-sliding.x);updateSound();
  });
  window.addEventListener('mouseup',()=>{sliding=pressed=undefined;});
  releaseOnInterrupt(()=>{sliding=pressed=undefined;hover=undefined;});
  window.addEventListener('keydown',e=>{
    if(!mode)return;
    e.stopImmediatePropagation();e.preventDefault();
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'){close();return;}
    const c=controls.find(c=>c.el===document.activeElement);
    if(e.key==='Tab') {
      const available=controls.filter(c=>!c.disabled),i=available.indexOf(c);
      const next=i<0?(e.shiftKey?available.length-1:0):(i+(e.shiftKey?available.length-1:1))%available.length;
      available[next]?.el.focus();return;
    }
    if(c?.slider && !c.disabled) {
      let value=draft[c.id];
      if(['ArrowLeft','PageUp'].includes(e.key))value--;
      else if(['ArrowRight','PageDown'].includes(e.key))value++;
      else if(e.key==='Home')value=0;
      else if(e.key==='End')value=19;
      else if(e.key==='Enter'&&!e.repeat){close(true);return;}
      else return;
      draft[c.id]=Math.max(0,Math.min(19,value));updateSound();return;
    }
    if((e.key==='Enter'||e.key===' ')&&!e.repeat)c?.el.click();
  },{capture:true});
  for(const name of ['mousedown','mouseup','click','dblclick','pointerdown','pointerup']) {
    window.addEventListener(name,e=>{
      if(mode&&!root.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();}
    },{capture:true});
  }
  root.addEventListener('contextmenu',e=>e.preventDefault());
  root.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();},{passive:false});
  return {open,close,get gameSettings(){return {...currentGame};},
    setMiniMap(shown){game.save({...currentGame,minimap:shown});applyGame(game.values());},
    get visible(){return !!mode;},draw(){
    if(!mode)return;
    ctx.save();
    stamp(`UI/UIWindow.img/${mode==='menu'?'GameMenu':mode==='game'?'GameOpt':'SysOpt'}/backgrnd`,at.x,at.y);
    for(const c of controls) {
      const x=at.x+c.x,y=at.y+c.y;
      const state=c.disabled?'disabled':pressed===c.id?'pressed':hover===c.id?'mouseOver':'normal';
      if(c.path)stamp(`${c.path}/${state}/0`,x,y);
      else if(c.slider) {
        stamp('UI/Basic.img/Slider/left',x,y+6);
        for(let dx=3;dx<c.w-3;dx++)stamp('UI/Basic.img/Slider/mid',x+dx,y+7);
        stamp('UI/Basic.img/Slider/right',x+c.w-3,y+6);
        const thumb=c.disabled?'Disabled':sliding===c?'Pressed':hover===c.id?'MouseOver':'Normal';
        stamp(`UI/Basic.img/Slider/thumb${thumb}`,x+sliderCenter(c.fixed??draft[c.id],c.w,c.disabled?4:20)-8,y);
      } else if(c.check) {
        // 446...: checkbox has 0 normal, 1 pressed, 2 checked, 3 checked pressed.
        stamp(`UI/Basic.img/CheckBox/${(draft[c.id]?2:0)+(pressed===c.id?1:0)}`,x,y);
      } else if(c.id==='screenshot') {
        ctx.fillStyle='#dddddd';ctx.fillRect(x,y,c.w,c.h);ctx.strokeStyle='#555555';ctx.strokeRect(x,y,c.w,c.h);
        ctx.font="12px 'Gulim','굴림','KMSCJK',sans-serif";ctx.textBaseline='top';ctx.textAlign='left';ctx.fillStyle='#888888';
        ctx.fillText('메이플스토리 폴더',x+3,y+2);stamp('UI/Basic.img/BtComboBox/disabled/0',x+c.w-16,y);
      }
    }
    ctx.restore();
  }};
}
