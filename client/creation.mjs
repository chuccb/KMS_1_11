/** CUINewChar controls: sub_42F160/430690/430C30. All x/y are native 800x600 pixels. */
export const NEW_CHARACTER_UI = { x: 270, y: 88, width: 260, height: 424, feetX: 411, feetY: 211 };
export const CREATION_BUTTONS = [
  { id: 'check-name', path: 'UI/Login.img/CharSelect/BtCheckId', x: 461, y: 229, width: 43, height: 16 },
  { id: 'create', path: 'UI/Basic.img/BtOK', x: 328, y: 471, width: 65, height: 24 },
  { id: 'create-cancel', path: 'UI/Basic.img/BtCancel', x: 409, y: 471, width: 65, height: 24 },
];
// Literal CP949 strings recovered from MapleStory.exe .data (VAs in CREATION_VALIDATION.md).
export const CREATION_TEXT = {"delete": "선택된 캐릭터를 지우시겠습니까?", "warning": "[캐릭터만들기 주의사항]\n비속어를 포함하거나 연상시키는 이름은\n이용중지될 수 있으니 주의바랍니다", "unchecked": "먼저 Check버튼을 눌러\n캐릭터이름이 사용가능한지 체크하세요.", "available": "캐릭터이름 '%s'는\n 사용하실 수 있습니다", "taken": "캐릭터이름 '%s'는\n 이미 사용중 입니다", "failed": "알 수 없는 오류로\n 캐릭터이름 중복 확인에 실패했습니다"};
export const COMBO_LABELS = ['얼굴', '헤어스타일', '상의', '하의', '신발', '무기'];
export function rollCreationDice(random = Math.random) {
  const dice = [4, 4, 4, 4];
  for (let i = 0; i < 9; i++) dice[Math.min(3, Math.floor(random() * 4))]++;
  return dice;
}

/** Paint native art; HTML is only transparent hit targets and the real name input. */
export function characterDialogs({ ctx, image, avatar, face = () => ({emotion:undefined,frame:0}), send, audio, log = () => {}, busy, getSelected, isCharacterStage }) {
  const el = (id) => document.getElementById(id);
  const root = el('character-dialogs'), createRoot = el('new-character'), confirmRoot = el('character-confirm');
  const input = el('new-name'), choices = el('creation-options');
  let mode = 'closed', returnMode = 'closed', noticeText = '', pending = false;
  let catalog, catalogPromise, gender = 0, picks = [], groups = [], dice = [4, 4, 4, 13];
  let checkedName = '', dropdown = -1, dropdownHover = -1, hover, pressed, deleteTarget;
  let diceStep = 0, diceAt = 0;
  const previewActor = {};
  const stamp = (path, x, y) => { const art = image(path); if (art.ready) ctx.drawImage(art.img, x, y); };
  const setBox = (element, x, y, width, height) => Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  const setBusy = (value) => { pending = value; busy(value); sync(); };
  function sync() {
    root.classList.toggle('hidden', mode === 'closed');
    createRoot.classList.toggle('hidden', mode !== 'create');
    confirmRoot.classList.toggle('hidden', !['notice', 'delete'].includes(mode));
    input.disabled = pending;
    for (const button of CREATION_BUTTONS) el(button.id).disabled = pending || !groups.length || diceStep > 0 && button.id !== 'create-cancel';
    el('roll-dice').disabled = pending || diceStep > 0;
    for (let i = 0; i < 6; i++) el(`create-combo-${i}`).disabled = pending || !groups.length;
    el('native-yes').classList.toggle('hidden', mode !== 'delete');
    el('native-no').classList.toggle('hidden', mode !== 'delete');
    el('native-ok').classList.toggle('hidden', mode !== 'notice');
    for (const id of ['native-yes', 'native-no', 'native-ok']) el(id).disabled = pending;
  }
  function close() {
    if (pending) return;
    mode = 'closed'; dropdown = -1; choices.replaceChildren(); checkedName = ''; deleteTarget = undefined; sync();
    el('character-new').focus();
  }
  function notice(text, back = 'create') {
    noticeText = text; returnMode = back; mode = 'notice'; dropdown = -1; choices.replaceChildren(); sync(); el('native-ok').focus(); audio.effect('UI/DlgNotice');
  }
  function acknowledge() {
    if (pending) return;
    mode = returnMode; sync(); if (mode === 'create') input.focus(); else el('character-new').focus();
  }
  const appearance = () => [...picks, ...dice];
  async function openCreate() {
    if (pending || !isCharacterStage()) return;
    setBusy(true);
    try {
      catalogPromise ??= fetch('/api/creation').then(async (response) => {
        if (!response.ok) throw new Error('無法讀取原版 MakeCharInfo；此服務需要 Data.wz。');
        return response.json();
      }).catch((error) => { catalogPromise = undefined; throw error; });
      catalog = await catalogPromise;
      groups = gender === 1 ? catalog.female : catalog.male;
      if (!Array.isArray(groups) || groups.length !== 6 || groups.some((g) => !g.length)) throw new Error('MakeCharInfo 的六組外觀不完整。');
      setBusy(false);
      picks = groups.map((g) => g[0].id); dice = rollCreationDice(); diceStep = 0; checkedName = ''; input.value = '';
      notice(CREATION_TEXT.warning, 'create');
    } catch (error) { setBusy(false); notice(error.message, 'closed'); }
  }
  function openDelete() {
    const selected = getSelected();
    if (pending || !selected || !isCharacterStage()) return;
    // Capture the exact id being confirmed; changing selection later cannot delete another slot.
    deleteTarget = { id: selected.id, name: selected.name };
    mode = 'delete'; dropdown = -1; choices.replaceChildren(); sync(); el('native-yes').focus(); audio.effect('UI/DlgNotice');
  }
  function checkName() {
    if (mode !== 'create' || pending || diceStep > 0) return;
    checkedName = '';
    if (!input.value) return notice('캐릭터이름은 4자 이상이어야 합니다.');
    setBusy(true); send({ t: 'check-name', name: input.value, appearance: appearance() });
  }
  function submit() {
    if (mode !== 'create' || pending || diceStep > 0) return;
    if (!checkedName || checkedName !== input.value) return notice(CREATION_TEXT.unchecked);
    setBusy(true); send({ t: 'create', name: input.value, appearance: appearance() });
  }
  function confirmDelete() {
    if (mode !== 'delete' || pending || !deleteTarget) return;
    setBusy(true); send({ t: 'delete-character', id: deleteTarget.id, confirmed: true });
  }
  function openCombo(index) {
    if (mode !== 'create' || pending || !groups[index]) return;
    dropdown = dropdown === index ? -1 : index; dropdownHover = -1; choices.replaceChildren();
    if (dropdown < 0) return;
    for (const [at, option] of groups[index].entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'sprite-hit';
      button.textContent = option.name; button.setAttribute?.('aria-label', option.name);
      setBox(button, 378, 266 + index * 20 + at * 18, 127, 18);
      button.addEventListener('pointerenter', () => { dropdownHover = at; });
      button.addEventListener('click', () => {
        picks[index] = option.id; dropdown = -1; choices.replaceChildren(); audio.effect('UI/BtMouseClick'); el(`create-combo-${index}`).focus();
      });
      choices.appendChild(button);
    }
  }
  for (const button of CREATION_BUTTONS) {
    const node = el(button.id); setBox(node, button.x - 270, button.y - 88, button.width, button.height);
    node.addEventListener('pointerenter', () => { hover = button.id; if (!node.disabled) audio.effect('UI/BtMouseOver'); });
    node.addEventListener('pointerleave', () => { hover = undefined; pressed = undefined; });
    node.addEventListener('click', () => { if (!node.disabled) audio.effect('UI/BtMouseClick'); });
    node.addEventListener('pointerdown', () => { pressed = button.id; });
    node.addEventListener('pointerup', () => { pressed = undefined; });
  }
  for (let i = 0; i < 6; i++) {
    const button = el(`create-combo-${i}`); setBox(button, 108, 160 + i * 20, 127, 18);
    button.addEventListener('pointerenter', () => { hover = button.id; if (!button.disabled) audio.effect('UI/BtMouseOver'); });
    button.addEventListener('pointerleave', () => { hover = undefined; pressed = undefined; });
    button.addEventListener('pointerdown', () => { pressed = button.id; });
    button.addEventListener('pointerup', () => { pressed = undefined; });
    button.addEventListener('click', () => openCombo(i));
    button.addEventListener('keydown', (event) => {
      if (pending || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation?.();
      const at = groups[i].findIndex((o) => o.id === picks[i]);
      picks[i] = groups[i][(at + (event.key === 'ArrowDown' ? 1 : groups[i].length - 1)) % groups[i].length].id;
      dropdown = -1; choices.replaceChildren();
    });
  }
  setBox(input, 110, 143, 80, 14); setBox(el('roll-dice'), 150, 300, 85, 67);
  for (const [id, x, path] of [['native-yes', 327, 'BtYes'], ['native-no', 408, 'BtNo'], ['native-ok', 368, 'BtOK']]) {
    const node = el(id); setBox(node, x, 326, 65, 24); node.dataset.path = path;
    node.addEventListener('pointerenter', () => { hover = id; if (!node.disabled) audio.effect('UI/BtMouseOver'); });
    node.addEventListener('click', () => { if (!node.disabled) audio.effect('UI/BtMouseClick'); });
    node.addEventListener('pointerleave', () => { hover = undefined; pressed = undefined; });
    node.addEventListener('pointerdown', () => { pressed = id; }); node.addEventListener('pointerup', () => { pressed = undefined; });
  }
  el('check-name').addEventListener('click', checkName);
  el('create').addEventListener('click', submit); el('create-cancel').addEventListener('click', close);
  el('native-yes').addEventListener('click', confirmDelete); el('native-no').addEventListener('click', close); el('native-ok').addEventListener('click', acknowledge);
  input.addEventListener('input', () => { checkedName = ''; });
  el('roll-dice').addEventListener('click', () => {
    if (!pending && !diceStep) { audio.effect('UI/BtMouseClick'); diceStep = 1; diceAt = performance.now() + 30; sync(); }
  });
  root.addEventListener('keydown', (event) => {
    if (mode === 'closed') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (dropdown >= 0) { const index = dropdown; dropdown = -1; choices.replaceChildren(); el(`create-combo-${index}`).focus(); }
      else if (!pending) mode === 'notice' ? acknowledge() : close();
    }
    else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); checkedName === input.value && checkedName ? submit() : checkName(); }
    else if (event.key === 'Tab') {
      const ids = mode === 'create' ? ['new-name', 'check-name', ...Array.from({length: 6}, (_, i) => `create-combo-${i}`), 'roll-dice', 'create', 'create-cancel'] : mode === 'delete' ? ['native-no', 'native-yes'] : ['native-ok'];
      const nodes = ids.map(el).filter((node) => !node.disabled), index = nodes.indexOf(document.activeElement);
      if (index === nodes.length - 1 && !event.shiftKey || index <= 0 && event.shiftKey) { event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus(); }
    }
    event.stopPropagation?.();
  });
  root.addEventListener('click', (event) => { if (event.target === root) { dropdown = -1; choices.replaceChildren(); } });
  sync();
  return {
    get open() { return mode !== 'closed'; },
    setGender(value) { gender = value === 1 ? 1 : 0; }, openCreate, openDelete,
    receive(message) {
      if (message.t === 'field' || message.t === 'login' && message.result === 0) { setBusy(false); close(); }
      if (message.t === 'name-checked') {
        setBusy(false);
        if (message.name !== input.value) return true;
        checkedName = message.result === 0 ? message.name : '';
        notice((message.result === 0 ? CREATION_TEXT.available : message.result > 0 ? CREATION_TEXT.taken : CREATION_TEXT.failed).replace('%s', message.name)); return true;
      }
      if (message.t === 'created') {
        setBusy(false);
        if (message.ok) close(); else notice('캐릭터 생성에 실패했습니다.\n' + message.reason);
      } else if (message.t === 'deleted') {
        setBusy(false); if (message.ok) close(); else notice('캐릭터 삭제에 실패했습니다.', 'closed'); return true;
      } else if (message.t === 'error' && mode !== 'closed') { setBusy(false); notice(message.message, mode === 'create' ? 'create' : 'closed'); log(`error: ${message.message}`); return true; }
      return false;
    },
    draw(now) {
      if (mode === 'closed') return;
      ctx.save(); ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif"; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = '#000';
      if (mode === 'create') {
        while (diceStep > 0 && now >= diceAt) { dice = rollCreationDice(); diceStep++; diceAt += 30; if (diceStep >= 12) { diceStep = 0; sync(); } }
        stamp('UI/Login.img/CharSelect/newDlg', 270, 88);
        const look = {face:picks[0],hair:picks[1],items:picks.slice(2)};
        const pose = face(previewActor, look, now), bodyFrame = Math.floor(now / 500) % 3;
        let preview = avatar(look, 'stand1', bodyFrame, true, pose.emotion, false, pose.frame);
        if (!preview.ready) preview = avatar(look, 'stand1', bodyFrame, true);
        if (preview.ready) ctx.drawImage(preview.img, 411 + preview.dx, 211 + preview.dy);
        for (let i = 0; i < 6; i++) {
          const y = 248 + i * 20; ctx.fillStyle = '#c4d4e2'; ctx.fillRect(378, y, 127, 18);
          ctx.fillStyle = '#000'; ctx.fillText(groups[i]?.find((o) => o.id === picks[i])?.name ?? '', 381, y + 2, 104);
          const id = `create-combo-${i}`;
          const state = el(id).disabled ? 'disabled' : dropdown === i || pressed === id ? 'pressed' : hover === id ? 'mouseOver' : 'normal';
          stamp(`UI/Basic.img/BtComboBox/${state}/0`, 488, y + 1);
        }
        for (const [index, value] of dice.entries()) ctx.fillText(String(value), 348, 381 + index * 20);
        const frame = image(`UI/Login.img/CharSelect/dice${Math.floor(diceStep / 3)}`);
        if (frame.ready) ctx.drawImage(frame.img, 464, 453 - frame.img.naturalHeight);
        for (const button of CREATION_BUTTONS) {
          const state = el(button.id).disabled ? 'disabled' : pressed === button.id ? 'pressed' : hover === button.id ? 'mouseOver' : 'normal';
          stamp(`${button.path}/${state}/0`, button.x, button.y);
        }
        if (dropdown >= 0) {
          groups[dropdown].forEach((option, index) => {
            const y = 266 + dropdown * 20 + index * 18;
            ctx.fillStyle = index === dropdownHover ? '#819aaf' : '#c4d4e2'; ctx.fillRect(378, y, 127, 18);
            ctx.strokeStyle = '#586e80'; ctx.strokeRect(378, y, 127, 18);
            ctx.fillStyle = '#000'; ctx.fillText(option.name, 381, y + 2, 121);
          });
        }
      } else {
        stamp(`UI/Basic.img/${mode === 'delete' ? 'YesNo' : 'Notice'}/backgrnd`, 268, 234);
        const text = mode === 'delete' ? CREATION_TEXT.delete : noticeText;
        const lines = text.split('\n');
        const top = 234 + 43 + Math.trunc((43 - 14 * lines.length) / 2);
        ctx.textAlign = 'center';
        lines.forEach((line, index) => {
          ctx.fillStyle = '#fff'; ctx.fillText(line, 401, top + index * 14 + 1, 234);
          ctx.fillStyle = '#000'; ctx.fillText(line, 400, top + index * 14, 234);
        });
        for (const [id, x, path] of mode === 'delete' ? [['native-yes', 327, 'BtYes'], ['native-no', 408, 'BtNo']] : [['native-ok', 368, 'BtOK']]) {
          const state = el(id).disabled ? 'disabled' : pressed === id ? 'pressed' : hover === id ? 'mouseOver' : 'normal';
          stamp(`UI/Basic.img/${path}/${state}/0`, x, 326);
        }
      }
      ctx.restore();
    },
  };
}
