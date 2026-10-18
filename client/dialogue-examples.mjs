/** Explicitly non-original, read-only operator examples. Never sent as quest packets/rewards. */
export function dialogueExample(kind, page = 0) {
  const heading = 'UI PREVIEW - not an NPC quest\r\n';
  switch(kind) {
    case 'say': return page === 0
      ? {kind, message:heading+'#e#bCUtilDlgEx2#n#k\r\nNext / Enter: page 2\r\nESC / Close: cancel\r\n'+
          Array.from({length:18},(_,i)=>`Scroll row ${i+1}`).join('\r\n'),unknownA:0,unknownB:1}
      : {kind,message:heading+'#gPage 2#k\r\nPrev: page 1\r\nOK / Enter: finish',unknownA:1,unknownB:0};
    case 'confirm': return {kind,message:heading+'Yes / Y or No / N. ESC cancels.\r\nNo character changes.'};
    case 'askText': return {kind,message:heading+'CP949 input: 4 to 12 bytes.\r\nSpaces are preserved, not trimmed.',
      defaultText:'메이플',minLength:4,maxLength:12};
    case 'askNumber': return {kind,message:heading+'Input a number from 1 to 99.\r\nNo mesos or items are changed.',defaultValue:1,min:1,max:99};
    case 'menu': return {kind,message:heading+'Select a marked line. No quest is run.\r\n#L10##bChoice 10#l\r\n#L20##rChoice 20#l'};
  }
}
