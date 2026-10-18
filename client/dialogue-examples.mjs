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
    case 'rich': return {kind:'say',unknownA:0,unknownB:0,message:heading+
      '#e#bNative inline icons#n#k\r\n'+
      'Normal item icon: #i2000000#  Weapon: #i1302000#\r\n'+
      'Skill icon: #s1000000#  Hover an icon for its WZ name.\r\n'+
      'No items are granted, no skill is learned. ## is a literal hash.\r\n'+
      Array.from({length:12},(_,i)=>`Row ${i+1}: #i2000000# text #s1000000# bottom aligned.`).join('\r\n')};
    case 'richMenu': return {kind:'menu',message:heading+
      'Icons and text share a selection. No quest is run.\r\n'+
      '#L10##i2000000# #bPotion / value 10#k#l\r\n'+
      '#L20##i1302000# #rWeapon / value 20#k#l\r\n'+
      '#L42##s1000000# #gSkill / value 42: this deliberately long label wraps, and Tab still visits this choice only once.#k#l\r\n'+
      '#L84##i2000000##s1000000##l'};
    case 'menu': return {kind,message:heading+'Select a marked line. No quest is run.\r\n#L10##bChoice 10#l\r\n#L20##rChoice 20#l'};
  }
}
