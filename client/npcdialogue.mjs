import {releaseOnInterrupt} from './pointer.mjs';
import {drawUtilFrame, drawUtilTextFrame} from './utildialog.mjs';
import {DIALOGUE_FONT, DIALOGUE_COLORS, dialogueRuns, dialogueLayout, dialogueButtons,
  dialogueInputError} from './npcdialogue-layout.mjs';

/** Server CUtilDlgEx: native Ex2 art on canvas; DOM only for editing, focus and hit targets.
 * No NPC portrait/title is invented: 4A5910 reads but does not use the packet's NPC id.
 */
export function npcDialogue({ctx, image, audio, point, onOpen, onReply}) {
  const root = document.getElementById('dialogue');
  const label = document.getElementById('dialogue-text');
  const input = document.getElementById('dialogue-input');
  const error = document.getElementById('dialogue-error');
  const targets = document.getElementById('dialogue-controls');
  let current, hover, pressed, armed, released, dragging, previousFocus, center = {x:400,y:300};
  const box = (element, x, y, width, height) => Object.assign(element.style,
    {left:`${x}px`,top:`${y}px`,width:`${width}px`,height:`${height}px`});
  const stamp = (path,x,y) => {const art=image(path);if(art.ready)ctx.drawImage(art.img,x,y);};
  function reset(restore = false) {
    const c = current;
    if (c) center = {x:c.x + Math.trunc(c.width/2),y:c.y + Math.trunc(c.height/2)};
    current = hover = pressed = armed = released = dragging = undefined;
    root.classList.add('hidden');targets.replaceChildren();
    input.value = '';input.setCustomValidity('');input.removeAttribute('aria-invalid');
    error.textContent = '';
    if (restore && previousFocus?.isConnected) previousFocus.focus();
    else if (root.contains(document.activeElement)) document.activeElement.blur();
    previousFocus = undefined;
  }
  function finish(answer, value) {
    const c = current;if (!c) return;
    const reply = {kind:c.body.kind,answer};
    if (answer === 1 && (c.body.kind === 'askText' || c.body.kind === 'askNumber')) {
      const reason = dialogueInputError(c.body, input.value);
      if (reason) {
        error.textContent = reason;input.setCustomValidity(reason);input.setAttribute('aria-invalid','true');
        input.focus();input.select();return;
      }
      if (c.body.kind === 'askText') reply.text = input.value; // Do NOT trim a CP949 edit buffer.
      else reply.value = Number(input.value);
    } else if (answer === 1 && c.body.kind === 'menu') {
      if (!c.pieces.some(p=>p.selection === value)) return;
      reply.value = value;
    }
    reset(true);onReply(reply,c.context);
  }
  function close(notify = true) {
    if (!current) return;
    if (notify) finish(current.body.kind === 'say' || current.body.kind === 'confirm' ? 255 : 0);
    else reset();
  }
  function buttonTarget(spec, action) {
    const element = document.createElement('button');
    element.type='button';element.className='sprite-hit';element.dataset.dialogueKey=spec.key;
    element.textContent=spec.label ?? spec.name; element.setAttribute('aria-label',spec.label ?? spec.name);
    element.addEventListener('click',event=>{
      if(event.button !== 0 || (event.detail > 0 && released !== spec.key))return;
      released=undefined;action();
    });
    element.addEventListener('mouseenter',()=>{
      if(hover!==spec.key && !spec.silent)void audio.effect('UI/BtMouseOver');hover=spec.key;
    });
    element.addEventListener('mouseleave',()=>{if(hover===spec.key)hover=undefined;});
    element.addEventListener('focus',()=>{hover=spec.key;});
    element.addEventListener('blur',()=>{hover=pressed=undefined;});
    element.addEventListener('mousedown',event=>{if(event.button===0){pressed=armed=spec.key;released=undefined;}});
    element.addEventListener('mouseup',event=>{
      if(event.button===0){released=armed===spec.key?spec.key:undefined;armed=pressed=undefined;}
    });
    targets.append(element);return element;
  }
  function placeTargets() {
    const c=current;if(!c)return;
    for(const target of c.buttons)box(target.element,c.x+target.x,c.y+target.y,target.width,target.height);
    for(const target of c.choices) {
      const p=target.piece, top=Math.max(1,p.y-c.scroll*8),bottom=Math.min(c.visibleHeight-1,p.y+16-c.scroll*8);
      target.element.classList.toggle('hidden',bottom<=top);
      box(target.element,c.x+c.textX+p.x,c.y+c.textY+top,p.width,Math.max(0,bottom-top));
    }
  }
  function setScroll(value) {
    if(!current)return;current.scroll=Math.max(0,Math.min(current.maxScroll,Math.round(value)));
    placeTargets();
  }
  function show(npcId, body, context) {
    if(current)return false; // One packet-owned modal at a time, never silently accept/replace it.
    previousFocus=document.activeElement;
    ctx.save();
    const layout=dialogueLayout(body,(text,bold)=>{ctx.font=(bold?'bold ':'')+DIALOGUE_FONT;return ctx.measureText(text).width;});
    ctx.restore();
    // Oversized editor prompts are clipped to the logical viewport, not positioned offscreen.
    const height=Math.min(600,layout.height), width=layout.width;
    const c=current={...layout,height,width,npcId,body,context,scroll:0,choices:[],buttons:[],
      x:Math.max(0,Math.min(800-width,center.x-Math.trunc(width/2))),
      y:Math.max(0,Math.min(600-height,center.y-Math.trunc(height/2)))};
    label.textContent=dialogueRuns(body.message).map(r=>r.text).join('');
    const editing=body.kind==='askText'||body.kind==='askNumber';
    input.classList.toggle('hidden',!editing);
    if(editing) {
      input.inputMode=body.kind==='askNumber'?'numeric':'text';
      input.maxLength=body.kind==='askText'?(body.maxLength<0?65535:body.maxLength):9;
      input.value=String(body.kind==='askText'?body.defaultText:body.defaultValue);
      c.editorHeight=Math.min(c.textHeight,c.height-99);
      if(c.editorHeight<c.textHeight)c.maxScroll=Math.ceil((c.textHeight-c.editorHeight)/8);
      box(input,c.x+16,c.y+c.editorHeight+38,c.width-30,14);
      // Native number edits are capped at 9 bytes; unsigned protocol ranges are retained in data.
      if(body.kind==='askNumber')input.maxLength=9;
    }
    for(const spec of dialogueButtons(body,width,height)) {
      const element=buttonTarget(spec,()=>finish(spec.answer));
      c.buttons.push({...spec,element});
    }
    if(body.kind==='menu') {
      for(const piece of c.pieces) {
        if(piece.selection===undefined)continue;
        const spec={key:`choice-${piece.selection}`,name:piece.text,label:piece.text,silent:true};
        const element=buttonTarget(spec,()=>finish(1,piece.selection));
        element.addEventListener('focus',()=>{
          if(piece.y < c.scroll*8)setScroll(Math.floor(piece.y/8));
          else if(piece.y+16 > c.scroll*8+c.visibleHeight)setScroll(Math.ceil((piece.y+17-c.visibleHeight)/8));
        });
        c.choices.push({piece,element});
      }
    }
    for(const name of ['Border/0','Border/1','Border/2','Border/3','Border/4','Border/5','Border/6','Border/7'])
      image(`UI/UIWindow.img/UtilDlgEx2/${name}`);
    for(const spec of c.buttons)for(const state of ['normal','mouseOver','pressed'])
      image(spec.key==='close'?`UI/UIWindow.img/BtUIClose2/${state}/0`:`UI/UIWindow.img/UtilDlgEx2/Bt${spec.name}/${state}/0`);
    if(c.scrolling)for(const name of ['base','prev0','next0','thumb0','thumb1'])image(`UI/Basic.img/VScr/enabled/${name}`);
    placeTargets();root.classList.remove('hidden');onOpen();
    if(editing){input.focus();input.select();}
    else (c.choices[0]?.element ?? c.buttons.find(b=>b.answer===1)?.element ?? c.buttons[0]?.element)?.focus();
    // 4A5A80..4A65C0 open the modal without an extra DlgNotice sound.
    return true;
  }
  input.addEventListener('input',()=>{
    input.setCustomValidity('');input.removeAttribute('aria-invalid');error.textContent='';
  });
  window.addEventListener('keydown',event=>{
    if(!current)return;
    event.stopImmediatePropagation();
    if(event.isComposing || event.keyCode===229)return;
    const c=current;
    if(event.key==='Escape'){event.preventDefault();if(!event.repeat)close();}
    else if(event.key==='Tab') {
      event.preventDefault();
      const controls=[...(input.classList.contains('hidden')?[]:[input]),...c.choices.map(x=>x.element),...c.buttons.map(x=>x.element)];
      const index=controls.indexOf(document.activeElement), count=controls.length;
      const next=controls[(index+(event.shiftKey?count-1:1)+count)%count];
      const choice=c.choices.find(x=>x.element===next);
      if(choice && choice.element.classList.contains('hidden'))
        setScroll(Math.floor(choice.piece.y/8));
      next?.focus();
    } else if(event.key==='Enter') {
      event.preventDefault();if(event.repeat)return;
      if(c.body.kind==='menu') {
        const choice=c.choices.find(x=>x.element===document.activeElement);if(choice)finish(1,choice.piece.selection);
      } else if(c.body.kind==='confirm') {
        const button=c.buttons.find(x=>x.element===document.activeElement);if(button)finish(button.answer);
      } else finish(1);
    } else if(c.body.kind==='confirm' && /^[yn]$/i.test(event.key)) {
      event.preventDefault();if(!event.repeat)finish(event.key.toLowerCase()==='y'?1:0);
    } else if(c.maxScroll>0 && ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)) {
      event.preventDefault();setScroll(event.key==='Home'?0:event.key==='End'?c.maxScroll:
        c.scroll+({ArrowUp:-1,ArrowDown:1,PageUp:-Math.floor((c.editorHeight??c.visibleHeight)/8),PageDown:Math.floor((c.editorHeight??c.visibleHeight)/8)})[event.key]);
    } else if(document.activeElement!==input && !(event.ctrlKey||event.metaKey))event.preventDefault();
  },{capture:true});
  root.addEventListener('wheel',event=>{
    if(!current)return;event.preventDefault();event.stopPropagation();
    setScroll(current.scroll+Math.sign(event.deltaY)*3);
  },{passive:false});
  root.addEventListener('mousedown',event=>{
    if(event.button!==0 || !current?.scrolling || event.target!==root)return;
    const c=current,p=point(event),x=c.x+c.textX+c.textWidth,y=c.y+c.textY;
    if(p.x<x||p.x>=x+12||p.y<y||p.y>=y+c.visibleHeight)return;
    event.preventDefault();
    if(p.y<y+12)setScroll(c.scroll-1);
    else if(p.y>=y+c.visibleHeight-12)setScroll(c.scroll+1);
    else {dragging=true;setScroll((p.y-y-18)/(c.visibleHeight-36)*c.maxScroll);}
  });
  window.addEventListener('mousemove',event=>{
    if(!current||!dragging)return;
    const c=current;setScroll((point(event).y-c.y-c.textY-18)/(c.visibleHeight-36)*c.maxScroll);
  });
  window.addEventListener('mouseup',()=>{dragging=false;pressed=armed=undefined;});
  root.addEventListener('mousedown',event=>{if(event.button===0)armed=released=pressed=undefined;},{capture:true});
  root.addEventListener('contextmenu',event=>event.preventDefault());
  for(const name of ['mousedown','mouseup','click','dblclick','pointerdown','pointerup'])window.addEventListener(name,event=>{
    if(current && !root.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}
  },{capture:true});
  releaseOnInterrupt(()=>{pressed=hover=armed=released=undefined;dragging=false;});
  return {show,close,get open(){return !!current;},get preview(){return current?.context?.preview===true;},draw(){
    const c=current;if(!c)return;
    const {x,y,width:w,height:h}=c;
    ctx.save();drawUtilFrame(ctx,image,x,y,w,h,true);
    const editing=c.body.kind==='askText'||c.body.kind==='askNumber';
    if(!editing && c.visibleHeight>1) {
      drawUtilTextFrame(ctx,x+c.textX,y+c.textY,c.textWidth,c.visibleHeight,true);
    }
    ctx.save();ctx.beginPath();
    const clipHeight=editing?Math.max(0,c.editorHeight):Math.max(0,c.visibleHeight-2);
    ctx.rect(x+c.textX+1,y+c.textY+1,c.textWidth-2,clipHeight);ctx.clip();
    ctx.textAlign='left';ctx.textBaseline='top';
    for(const piece of c.pieces) {
      const py=y+c.textY+piece.y-c.scroll*8;
      if(py+16<y+c.textY||py>=y+c.textY+clipHeight)continue;
      ctx.font=(piece.bold?'bold ':'')+DIALOGUE_FONT;ctx.fillStyle=DIALOGUE_COLORS[piece.color];
      ctx.fillText(piece.text,x+c.textX+piece.x,py);
      if(piece.selection!==undefined && hover===`choice-${piece.selection}`) {
        ctx.fillStyle='#000000';ctx.fillRect(x+c.textX+piece.x,py+15,piece.width,1);
      }
    }
    ctx.restore();
    if(editing) {
      ctx.fillStyle='#000000';ctx.fillRect(x+13,y+c.editorHeight+35,w-25,18);
      ctx.fillStyle='#ffffff';ctx.fillRect(x+14,y+c.editorHeight+36,w-27,16);
    }
    if(c.scrolling) {
      const sx=x+c.textX+c.textWidth, sy=y+c.textY, base='UI/Basic.img/VScr/enabled';
      ctx.save();ctx.beginPath();ctx.rect(sx,sy,12,c.visibleHeight);ctx.clip();
      for(let py=12;py<c.visibleHeight-12;py+=12)stamp(`${base}/base`,sx,sy+py);
      stamp(`${base}/prev0`,sx,sy);stamp(`${base}/next0`,sx,sy+c.visibleHeight-12);
      stamp(`${base}/${dragging?'thumb1':'thumb0'}`,sx,sy+12+Math.round((c.visibleHeight-36)*c.scroll/c.maxScroll));
      ctx.restore();
    }
    for(const spec of c.buttons) {
      const state=pressed===spec.key?'pressed':hover===spec.key?'mouseOver':'normal';
      const path=spec.key==='close'?`UI/UIWindow.img/BtUIClose2/${state}/0`:
        `UI/UIWindow.img/UtilDlgEx2/Bt${spec.name}/${state}/0`;
      stamp(path,x+spec.x,y+spec.y);
    }
    ctx.restore();
  }};
}
