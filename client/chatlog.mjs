import {releaseOnInterrupt} from "./pointer.mjs";
import {wrapChatText,followChat} from './chatlayout.mjs';
/** 4FB670/4FBEE0: six rows, 13px advance; cap 64 WRAPPED records, not 64 messages.
 * IWzFont is replaced by browser Gulim/fallback measurement, not by CSS auto wrapping.
 */
export function chatHistory({root,list,bar,clock=()=>performance.now()}) {
  const prev=bar.querySelector('[data-chat-prev]'),next=bar.querySelector('[data-chat-next]');
  const thumb=bar.querySelector('[data-chat-thumb]'),track=bar.querySelector('[data-chat-track]');
  const context=document.createElement('canvas').getContext('2d');
  let drag,sticky=true,lastScroll=clock();
  const max=()=>Math.max(0,root.scrollHeight-root.clientHeight);
  function sync(){
    const end=max(),enabled=end>0;
    bar.classList.toggle('disabled',!enabled);prev.disabled=next.disabled=!enabled;thumb.hidden=!enabled;
    thumb.style.top=`${12+(end?Math.round(46*root.scrollTop/end):0)}px`;
  }
  function scroll(value){
    root.scrollTop=Math.max(0,Math.min(max(),Math.round(value/13)*13));
    lastScroll=clock();sticky=root.scrollTop>=max()-1;sync();
  }
  function changed(incoming=true){
    while(list.children.length>64){
      const row=list.firstElementChild;row.chatGroup.removed++;row.remove();
      root.scrollTop=Math.max(0,root.scrollTop-13);
    }
    if(incoming?(list.children.length<=7||followChat(sticky,lastScroll,clock())):sticky){root.scrollTop=max();sticky=true;}
    sync();
  }
  function rows(group){
    context.font="12px 'Gulim','굴림','KMSCJK',sans-serif";
    return wrapChatText(group.text,text=>context.measureText(text).width).slice(group.removed).map(text=>{
      const row=document.createElement('li');row.textContent=text;row.className=group.tone;row.chatGroup=group;return row;
    });
  }
  function update(group,text,tone=group.tone){
    const old=[...list.children].filter(row=>row.chatGroup===group);
    if(!old.length)return; // Late metadata never resurrects a pruned message or another owner's log.
    const prior=root.scrollTop;group.text=String(text);group.tone=tone;
    old[0].before(...rows(group));for(const row of old)row.remove();root.scrollTop=prior;changed(false);
  }
  prev.addEventListener('click',()=>scroll(root.scrollTop-13));
  next.addEventListener('click',()=>scroll(root.scrollTop+13));
  root.addEventListener('wheel',e=>{
    if(!e.deltaY)return;e.preventDefault();scroll(root.scrollTop+Math.sign(e.deltaY)*39);
  },{passive:false});
  track.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    const rect=bar.getBoundingClientRect(),scale=rect.height/82;if(!scale)return;
    const local=(e.clientY-rect.top)/scale;
    scroll(root.scrollTop+(local<12+46*root.scrollTop/(max()||1)?-78:78));e.preventDefault();
  });
  thumb.addEventListener('mousedown',e=>{
    if(e.button!==0)return;drag={y:e.clientY,scroll:root.scrollTop};e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!drag)return;const scale=bar.getBoundingClientRect().height/82;if(!scale)return;
    scroll(drag.scroll+(e.clientY-drag.y)/scale*max()/46);
  });
  const release=()=>{drag=undefined;};
  window.addEventListener('mouseup',release);releaseOnInterrupt(release);
  // Re-measure only on font availability changes, never on every RAF or every unrelated image load.
  document.fonts?.addEventListener('loadingdone',()=>{
    const groups=new Set([...list.children].map(row=>row.chatGroup));
    for(const group of groups)update(group,group.text);
  });
  return {
    append(text,tone='normal'){
      const group={text:String(text),tone,removed:0};list.append(...rows(group));changed();
      return {update:(text,tone)=>update(group,text,tone)};
    },
    changed,latest(){scroll(max());},cancelDrag:release,
    clear(){release();list.replaceChildren();sticky=true;sync();},
  };
}
