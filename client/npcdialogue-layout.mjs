/** CUtilDlgEx: 534A80/534FA0 lexer; 5338A0 records; 535520 wrap; 5359B0/535A60 rows.
 * Canonical bounded grammar only; no invented later-version name/quest substitutions.
 * Browser font metrics are not the original GDI fonts.
 */
export const DIALOGUE_FONT = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
export const DIALOGUE_COLORS = {k:'#000000', r:'#ff0000', g:'#00ff00', b:'#0000ff'};
export function dialogueRuns(message) {
  const runs=[];
  let color='k',bold=false,selection,buffer='';
  const flush=()=>{if(buffer){runs.push({text:buffer,color,bold,selection});buffer='';}};
  const text=String(message ?? '').replace(/\r\n?/g,'\n');
  for(let i=0;i<text.length;) {
    if(text[i]==='\n'){flush();runs.push({text:'\n',color,bold,selection});i++;continue;}
    if(text[i]==='#') {
      const code=text[i+1];
      if(code==='#'){buffer+='#';i+=2;continue;}
      if(Object.hasOwn(DIALOGUE_COLORS,code)){flush();color=code;i+=2;continue;}
      if(code==='e'||code==='n'){flush();bold=code==='e';i+=2;continue;}
      if(code==='l'){flush();selection=undefined;i+=2;continue;}
      if(code==='L'||code==='i'||code==='s') {
        const match=/^#([Lis])(\d+)#/.exec(text.slice(i));
        if(match && Number(match[2])<=0x7fffffff) {
          flush();const id=Number(match[2]);
          if(code==='L')selection=id;
          else runs.push({text:'',kind:code==='i'?'item':'skill',id,color,bold,selection});
          i+=match[0].length;continue;
        }
      }
    }
    const ch=String.fromCodePoint(text.codePointAt(i));buffer+=ch;i+=ch.length;
  }
  flush();return runs;
}
export const dialogueAssetKey = run => `${run.kind}:${run.id}`;
export function dialoguePlainText(runs, resolve=()=>undefined) {
  return runs.map(run=>run.kind ? (resolve(run)?.name || `${run.kind} ${run.id}`) : run.text).join('');
}
/** Shared canonical lexer: escaped ##L isn't an offered choice at the answer boundary. */
export function dialogueSelections(message) {
  return new Set(dialogueRuns(message).filter(run=>run.selection!==undefined && (run.kind || (run.text && run.text!=='\n'))).map(run=>run.selection));
}
/** WZ-sized icons, bottom-aligned against each row's maximum; no placeholder or icon scaling. */
export function dialogueLayout(body, measure, resolve=()=>undefined) {
  const editing=body.kind==='askText'||body.kind==='askNumber';
  const textWidth=editing?230:300, padding=editing?2:8;
  const runs=dialogueRuns(body.message),pieces=[],rows=[[]];
  let row=rows[0],x=padding;
  const nextRow=()=>{row=[];rows.push(row);x=padding;};
  const add=piece=>{row.push(piece);pieces.push(piece);x+=piece.width;};
  for(const run of runs) {
    if(run.text==='\n'){nextRow();continue;}
    if(run.kind) {
      const asset=resolve(run), icon=asset?.icon;
      if(!icon || !Number.isFinite(icon.width)||!Number.isFinite(icon.height)||icon.width<=0||icon.height<=0)continue;
      if(x>padding && x+icon.width+padding>textWidth)nextRow();
      add({...run,text:asset.name || `${run.kind} ${run.id}`,image:icon.path,
        width:icon.width,height:icon.height,x,y:0});
      continue;
    }
    let remaining=run.text;
    while(remaining) {
      const available=textWidth-padding-x;
      if(measure(remaining,run.bold)<=available) {
        add({...run,text:remaining,width:measure(remaining,run.bold),height:16,x,y:0});break;
      }
      // Search measured whole substrings; summing glyph widths loses kerning/shaping.
      const chars=Array.from(remaining);let low=0,high=chars.length;
      while(low<high){const mid=Math.ceil((low+high)/2);
        if(measure(chars.slice(0,mid).join(''),run.bold)<=available)low=mid;else high=mid-1;}
      if(low===0 && x>padding){nextRow();continue;}
      low=Math.max(1,low); // Progress even for a malformed over-wide glyph/canvas.
      if(chars[low]==='.'||chars[low]===',')low++; // 5338A0: one hanging punctuation mark.
      const part=chars.slice(0,low).join('');
      add({...run,text:part,width:measure(part,run.bold),height:16,x,y:0});
      remaining=chars.slice(low).join('').replace(/^[ \t]+/,'');
      if(remaining)nextRow();
    }
  }
  let y=padding;
  for(const row of rows) {
    const height=row.reduce((max,p)=>Math.max(max,p.height),16);
    for(const p of row)p.y=y+height-p.height;
    y+=height+2;
  }
  const textHeight=runs.length?padding+y:0;
  const scrolling=!editing&&textHeight>240&&Math.floor((textHeight-240)/8)+1>2;
  const visibleHeight=scrolling?240:textHeight;
  return {pieces,textWidth,textHeight,visibleHeight,scrolling,
    maxScroll:scrolling?Math.floor((textHeight-visibleHeight)/8):0,
    width:textWidth+22+(scrolling?12:0),
    height:visibleHeight+(editing?99:body.kind==='menu'?58:79),
    textX:editing?14:11,textY:36};
}
export function dialogueButtons(body, width, height) {
  const button = (key, name, x, y, answer) => ({key, name, x, y, width:50, height:23, answer});
  const result = [{key:'close', name:'Close', x:width-48, y:9, width:32, height:15,
    answer:body.kind === 'say' || body.kind === 'confirm' ? 255 : 0}];
  if (body.kind === 'say') {
    if (body.unknownA) result.push(button('prev', 'Prev', width-115, height-40, 0));
    result.push(button('primary', body.unknownB ? 'Next' : 'OK', width-61, height-40, 1));
  } else if (body.kind === 'confirm') {
    result.push(button('yes', 'Yes', width/2-50, height-40, 1));
    result.push(button('no', 'No', width/2+4, height-40, 0));
  } else if (body.kind !== 'menu') {
    result.push(button('primary', 'OK', width-119, height-42, 1));
    result.push(button('cancel', 'Cancel', width-65, height-42, 0));
  }
  return result;
}

let cp949;
/** Same defined-pair repertoire as server/protocol/cp949.ts; never count Korean as one byte. */
export function dialogueTextBytes(value) {
  if (/^[\x00-\x7f]*$/.test(value)) return value.length;
  if (!cp949) {
    const table = new Set(), decoder = new TextDecoder('euc-kr', {fatal:true});
    for (let lead=0x81;lead<=0xfe;lead++) for (let trail=0x41;trail<=0xfe;trail++) {
      try {const ch=decoder.decode(Uint8Array.of(lead,trail));if(ch.length===1)table.add(ch);} catch {}
    }
    cp949 = table;
  }
  let bytes = 0;
  for (const ch of value) {
    if (ch.codePointAt(0) < 128) bytes++;
    else if (cp949.has(ch)) bytes += 2;
    else return undefined;
  }
  return bytes;
}
export function dialogueInputError(body, value) {
  if (body.kind === 'askText') {
    const bytes = dialogueTextBytes(value);
    if (bytes === undefined || value.includes('\0')) return 'CP949로 표현할 수 없는 문자가 있습니다.';
    if (bytes < Math.max(0,body.minLength)) return `${body.minLength}자 이상 입력해야 합니다.`;
    if (bytes > (body.maxLength < 0 ? 65535 : body.maxLength)) return `${body.maxLength}자 이하로 입력해 주세요.`;
  } else if (body.kind === 'askNumber') {
    if (!/^[0-9]+$/.test(value)) return '숫자만 입력가능합니다.';
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < body.min || number > body.max)
      return `${body.min} 이상 ${body.max} 이하의 숫자를 입력해 주세요.`;
  }
}
