/** CUtilDlgEx source: 530C20/530CA0/5338A0/5359B0/535E40/535EF0.
 * Supported markup is deliberately bounded: colors, weight, #L<number># / #l and newlines.
 * Item/quest/character substitution and inline icons are NOT implemented; unknown codes remain
 * literal instead of silently deleting content. Browser font measurements are not native GDI.
 */
export const DIALOGUE_FONT = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
export const DIALOGUE_COLORS = {k:'#000000', r:'#ff0000', g:'#00ff00', b:'#0000ff'};
export function dialogueRuns(value) {
  const text = String(value).replace(/\r\n?/g, '\n');
  const runs = [];
  let color = 'k', bold = false, selection;
  function append(text) {
    const last = runs.at(-1);
    if (last && last.color === color && last.bold === bold && last.selection === selection)
      last.text += text;
    else runs.push({text, color, bold, selection});
  }
  for (let i = 0; i < text.length;) {
    if (text[i] === '#') {
      const code = text[i + 1];
      if (Object.hasOwn(DIALOGUE_COLORS, code)) { color = code;i += 2;continue; }
      if (code === 'e' || code === 'n') { bold = code === 'e';i += 2;continue; }
      if (code === 'l') { selection = undefined;i += 2;continue; }
      if (code === 'L') {
        const match = /^#L(\d+)#/.exec(text.slice(i));
        if (match && Number(match[1]) <= 0x7fffffff) {
          selection = Number(match[1]);i += match[0].length;continue;
        }
      }
    }
    const ch = String.fromCodePoint(text.codePointAt(i));append(ch);i += ch.length;
  }
  return runs;
}
export function dialogueLayout(body, measure) {
  const editing = body.kind === 'askText' || body.kind === 'askNumber';
  const textWidth = editing ? 230 : 300, padding = editing ? 2 : 8;
  const runs = dialogueRuns(body.message), pieces = [], rows = [[]];
  let x = padding;
  for (const run of runs) {
    for (const ch of run.text) {
      if (ch === '\n') {rows.push([]);x = padding;continue;}
      const width = Math.max(0, measure(ch, run.bold));
      if (x > padding && x + width + padding > textWidth) {rows.push([]);x = padding;}
      const row = rows.at(-1), last = row.at(-1);
      if (last && last.color === run.color && last.bold === run.bold && last.selection === run.selection) {
        last.text += ch;last.width += width;
      } else {
        const piece = {...run, text:ch, x, y:padding + (rows.length - 1) * 18, width, height:16};
        row.push(piece);pieces.push(piece);
      }
      x += width;
    }
  }
  // Plain-text lines are at least 16px high, followed by 2px; native 530CA0 adds end padding.
  const textHeight = runs.length ? 2 * padding + rows.length * 18 : 0;
  const scrolling = !editing && textHeight > 240 && Math.floor((textHeight - 240) / 8) + 1 > 2;
  const visibleHeight = scrolling ? 240 : textHeight;
  return {pieces, textWidth, textHeight, visibleHeight, scrolling,
    maxScroll:scrolling ? Math.floor((textHeight - visibleHeight) / 8) : 0,
    width:textWidth + 22 + (scrolling ? 12 : 0),
    height:visibleHeight + (editing ? 99 : body.kind === 'menu' ? 58 : 79),
    textX:editing ? 14 : 11, textY:36};
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
