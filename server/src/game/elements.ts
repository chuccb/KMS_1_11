/** 4BE150: eight ordered slots P/I/F/L/W/H/D/U; zero/no digits become 999.
 * Unknown letters fail the native loader, rather than being silently ignored. */
export function elementAttributes(value:unknown):number[]|undefined {
  const slots=Array<number>(8).fill(0);
  if(typeof value!=='string'||!value.length)return slots;
  let cursor=0;
  while(cursor<value.length){
    const slot='piflwhdu'.indexOf(value[cursor++]!.toLowerCase());
    if(slot<0)return undefined;
    let number=0;
    while(cursor<value.length&&value.charCodeAt(cursor)>=48&&value.charCodeAt(cursor)<=57)
      number=(Math.imul(number,10)+value.charCodeAt(cursor++)-48)|0;
    slots[slot]=number||999;
  }
  return slots;
}
