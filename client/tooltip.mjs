import {HUD_FONT} from './hud.mjs';

/** CUIToolTip 502CE0: 799/599 boundary, ARGB A0000040 fill, four transparent corner pixels.
 * a5 additionally cuts the inset keyline with 00FFFFFF; it is NOT an opaque blue/grey outline.
 * Draw holes in the path, not clearRect on the already-painted world/UI beneath the tooltip.
 */
export function tooltipPosition(x, y, width, height) {
  return {x: Math.max(0, Math.min(Math.round(x), 799 - width)),
    y: Math.max(0, Math.min(Math.round(y), 599 - height))};
}
export function drawTooltipFrame(ctx, x, y, width, height, keyline = false) {
  ctx.beginPath();
  ctx.moveTo(x + 1, y); ctx.lineTo(x + width - 1, y);
  ctx.lineTo(x + width - 1, y + 1); ctx.lineTo(x + width, y + 1);
  ctx.lineTo(x + width, y + height - 1); ctx.lineTo(x + width - 1, y + height - 1);
  ctx.lineTo(x + width - 1, y + height); ctx.lineTo(x + 1, y + height);
  ctx.lineTo(x + 1, y + height - 1); ctx.lineTo(x, y + height - 1);
  ctx.lineTo(x, y + 1); ctx.lineTo(x + 1, y + 1); ctx.closePath();
  if (keyline && width > 4 && height > 4) {
    ctx.rect(x + 1, y + 2, 1, height - 4);
    ctx.rect(x + width - 2, y + 2, 1, height - 4);
    ctx.rect(x + 2, y + 1, width - 4, 1);
    ctx.rect(x + 2, y + height - 2, width - 4, 1);
  }
  ctx.fillStyle = 'rgba(0,0,64,0.6274509803921569)';
  ctx.fill('evenodd');
}

/** Legacy compact paragraph helper retained for existing consumers/fixtures, NOT the game
 * item/skill renderer. Native rich plans and their lexer are defined below.
 * Simple status text uses 500F50's font 172 (Gulim 12), text (4,3), +8 width / +6 font height.
 */
export function tooltipRows(lines, measure, maxWidth) {
  const result = [];
  for (const text of lines) {
    for (const line of String(text).replace(/\\r\\n|\\n|\\r/g, '\n').split(/\r\n|\r|\n/)) {
      let row = '';
      for (const c of line) {
        if (row && measure(row + c) > maxWidth) { result.push(row); row = ''; }
        row += c;
      }
      result.push(row);
    }
  }
  return result;
}
export function drawTextTooltip(ctx, x, y, lines, {maxWidth = 270, keyline = false} = {}) {
  if (!lines.length) return;
  ctx.save();
  ctx.font = HUD_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const rows = tooltipRows(lines, text => ctx.measureText(text).width, Math.max(1, maxWidth - 8));
  // Oversized descriptions are clipped rather than allowed to put the entire box off-screen.
  const height = Math.min(598, rows.length * 14 + 4);
  const width = Math.max(8, Math.min(maxWidth, Math.ceil(rows.reduce((max, text) => Math.max(max, ctx.measureText(text).width), 0)) + 8));
  const at = tooltipPosition(x, y, width, height);
  drawTooltipFrame(ctx, at.x, at.y, width, height, keyline);
  ctx.beginPath(); ctx.rect(at.x + 3, at.y + 3, width - 6, height - 6); ctx.clip();
  ctx.fillStyle = '#ffffff';
  rows.forEach((line, i) => ctx.fillText(line, at.x + 4, at.y + 3 + i * 14));
  ctx.restore();
}

/** 500F50 simple name tip, not an item-stat panel: font172, text(4,3), width+8/height+6.
 * Font height is measured at runtime, like 505530; Canvas fallback metrics are not native GDI.
 */
export function drawSimpleTooltip(ctx,x,y,text,{font=HUD_FONT,fontHeight}={}) {
  if(!text)return;
  ctx.save();ctx.font=font;ctx.textAlign='left';ctx.textBaseline='top';
  const metrics=ctx.measureText(text),lineHeight=metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent;
  const measuredHeight=Number.isFinite(lineHeight)&&lineHeight>0?Math.ceil(lineHeight):13;
  const width=Math.max(8,Math.min(799,Math.ceil(metrics.width)+8)),height=(fontHeight??measuredHeight)+6;
  const at=tooltipPosition(x,y,width,height);
  drawTooltipFrame(ctx,at.x,at.y,width,height);
  ctx.beginPath();ctx.rect(at.x+3,at.y+3,width-6,height-6);ctx.clip();
  ctx.fillStyle='#ffffff';ctx.fillText(text,at.x+4,at.y+3);ctx.restore();
}

/** 4FFE30's seven fonts. Browser fallbacks are not a claim of matching Win32 Gulim metrics. */
export const TOOLTIP_FONTS = Object.freeze({
  1: {font: "bold 14px 'Gulim', '굴림', 'KMSCJK', sans-serif", color: '#ffffff', height: 16},
  2: {font: "bold 14px 'Gulim', '굴림', 'KMSCJK', sans-serif", color: '#fdf514', height: 16},
  3: {font: "bold 14px 'Gulim', '굴림', 'KMSCJK', sans-serif", color: '#ff8a18', height: 16},
  4: {font: HUD_FONT, color: '#ffffff', height: 13},
  5: {font: HUD_FONT, color: '#bbbbbb', height: 13},
  6: {font: HUD_FONT, color: '#7b8c91', height: 13},
  7: {font: HUD_FONT, color: '#f20303', height: 13},
});

/** Native callers differ: shop does NOT add 20; quick-slot subtracts 128. */
export function tooltipAnchor(source, x, y) {
  return {x, y: y + (source === 'quick' ? -128 : source === 'shop' ? 0 : 20)};
}

/** 503AF0, NOT the dialogue lexer and NOT word wrapping. The overflowing character stays on
 * the row, with one hanging period/comma. Literal \\n flushes a nonempty row; \\\\ prints one slash;
 * unknown escape pairs disappear. Whitespace at each row's start is discarded. */
export function nativeTooltipRows(text, measure, width) {
  const chars = Array.from(String(text ?? '')), rows = [];
  let row = '';
  const flush = () => {if (row) rows.push(row); row = '';};
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i];
    if (c === '\\') {
      c = chars[++i];
      if (c === 'n') {flush(); continue;}
      if (c !== '\\') continue;
    }
    if (!row && /[ \t\r\n]/.test(c)) continue;
    row += c;
    if (measure(row) > width) {
      if (chars[i + 1] === '.' || chars[i + 1] === ',') row += chars[++i];
      flush();
    }
  }
  flush();
  return rows;
}

const textCommand = (text, x, y, font = 4, center = false) => ({kind: 'text', text, x, y, font, center});
const rectCommand = (x, y, width, height, color) => ({kind: 'rect', x, y, width, height, color});
const imageCommand = (meta, x, y, scale = 1) => ({kind: 'image', ...meta, x, y,
  width: meta.width * scale, height: meta.height * scale});
const centered = (text, y, font = 4) => textCommand(text, 0, y, font, true);
const equipStatNames = [
  ['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'],
  ['maxHp', 'HP'], ['maxMp', 'MP'], ['pad', '공격력'], ['mad', '마력'],
  ['pdd', '물리방어력'], ['mdd', '마법방어력'], ['acc', '명중률'], ['eva', '회피율'],
  ['craft', '손재주'], ['speed', '이동속도'], ['jump', '점프력'],
];
const weaponClasses = {30: '한손검', 31: '한손도끼', 32: '한손둔기', 33: '단검',
  37: '완드', 38: '스태프', 40: '두손검', 41: '두손도끼', 42: '두손둔기',
  43: '창', 44: '폴암', 45: '활', 46: '석궁'}; // 4FFC90 has no final case 47.

/** 503840 + 5054B0: normal canvas (never iconRaw), 68² A0FFFFFF plate, 2× pixels.
 * Listing +50/+58 are width/height; +84/+7C are origin x/y. Do not read +84 as height. */
function iconCommands(icon) {
  if (!icon?.path) return [];
  return [rectCommand(14, 32, 68, 68, 'rgba(255,255,255,0.6274509803921569)'),
    imageCommand(icon, 16 - 2 * icon.ox, 32 + 2 * (33 - icon.oy), 2)];
}
function footerPlan(plan, lines, metrics) {
  const pitch = metrics.height(4) + 4;
  // Assembly 50340A is add edx,4. The decompiler's DWORD* +1 is NOT one pixel.
  plan.height += lines.length * pitch;
  for (let i = 0; i < lines.length; i++) {
    plan.width = Math.max(plan.width, metrics.width(lines[i], 4) + 20);
    plan.commands.push(centered(lines[i], plan.separator + 8 + i * pitch));
  }
  return plan;
}
function descriptionCommands(desc, metrics) {
  const rows = nativeTooltipRows(desc, text => metrics.width(text, 4), 270 - 92);
  return rows.map((text, i) => textCommand(text, 92, 35 + i * (metrics.height(4) + 4)));
}

/** 502780 stack/use/setup/etc. Price/count belong to the shop/bag, not this native tip. */
export function nativeItemTooltip(facts, metrics) {
  if (!facts?.name) return;
  return {type: 4, width: 290, height: 116, separator: -1,
    commands: [centered(facts.name, 10, 1), ...iconCommands(facts.icon),
      ...descriptionCommands(facts.desc, metrics)]};
}

/** 5029A0. hs is archive text, not a new formula evaluator. Max omits the next-level section. */
export function nativeSkillTooltip(skill, level, metrics) {
  if (!skill?.name) return;
  const lines = [];
  if (level > 0) lines.push(`[현재레벨 ${level}]`, skill.levels.find(r => r.level === level)?.hs ?? '');
  if (level < skill.maxLevel) lines.push(`[다음레벨 ${level + 1}]`, skill.levels.find(r => r.level === level + 1)?.hs ?? '');
  const plan = {type: 5, width: 290, height: 128, separator: 114,
    commands: [centered(skill.name, 10, 1), ...iconCommands(skill.icon),
      ...descriptionCommands(skill.desc, metrics)]};
  return footerPlan(plan, lines, metrics);
}

/** 5014C0 / 504480 / 525AE0. basic is effective BasicStat, including effective worn STR etc.
 * Only an explicit SHOP BUY template can construct stats from WZ. Unknown bag/sell stats are
 * not replaced by defaults: those callers wait for an actual inventory instance. */
export function nativeEquipmentTooltip(facts, item, basic, metrics, {template = false} = {}) {
  if (!facts?.name || !facts.requirements || !basic) return;
  const actual = template ? facts.equipment : item;
  if (!actual?.stats) return;
  const cuc = (actual.cuc ?? 0) & 255, ruc = (actual.ruc ?? 0) & 255;
  const sex = Math.floor(item.itemId / 1000) % 10;
  const gender = sex === 0 ? '남' : sex === 1 ? '여' : '';
  const title = cuc > 0 ? `${facts.name} (+${cuc}${gender})` : gender ? `${facts.name} (${gender})` : facts.name;
  const titleFont = cuc > 0 ? 3 : 1, lines = [];
  const group = Math.floor(item.itemId / 100000);
  const weapon = group === 13 || group === 14 ? weaponClasses[Math.floor(item.itemId / 10000) % 100] : undefined;
  if (weapon) lines.push(`무기분류 : ${weapon}`);
  for (const [key, label] of equipStatNames) {
    const value = ((actual.stats[key] ?? 0) << 16) >> 16;
    if (value > 0) lines.push(`${label} : +${value}`);
  }
  if (ruc > 0) lines.push(`업그레이드 가능 횟수 : ${ruc}`);
  const plan = {type: 3, width: Math.max(216, metrics.width(title, titleFont) + 20), height: 142,
    separator: 128, commands: [centered(title, 10, titleFont), ...iconCommands(facts.icon)]};
  const requirements = facts.requirements;
  for (const [i, key] of ['level', 'str', 'dex', 'int', 'luk'].entries()) {
    const required = requirements[key] ?? 0;
    const path = `UI/UIWindow.img/ToolTip/Equip/${(basic?.[key] ?? 0) < required ? 'Cannot' : 'Can'}`;
    plan.commands.push(imageCommand({path: `${path}/req${i === 0 ? 'LEV' : key.toUpperCase()}`, width: 45, height: 7}, 96, 35 + i * 14));
    let x = 146;
    for (const digit of String(Math.max(0, Math.trunc(required)))) {
      const width = digit === '1' ? 3 : 5;
      // Native Copy at x,y; origin on digit 1 is NOT used as a manual displacement.
      plan.commands.push(imageCommand({path: `${path}/${digit}`, width, height: 7}, x, 35 + i * 14));
      x += width + 1;
    }
  }
  // These colors describe the item's job mask, NOT whether the current player is that job.
  let x = 12;
  for (const [i, name] of ['초보자', '전사', '마법사', '궁수', '도적'].entries()) {
    const allowed = requirements.job === 0 || (i > 0 && (requirements.job & (1 << (i - 1))) !== 0);
    const text = `${name}   `, font = allowed ? 4 : 7;
    plan.commands.push(textCommand(text, x, 110, font));
    x += metrics.width(text, font);
  }
  return footerPlan(plan, lines, metrics);
}

/** Shared painter/cache for bag, worn, shop, skills and the explicitly read-only examples.
 * Plans depend on font arrival, actual instance, effective requirements and learned level. Images
 * stay in the existing artImage cache; no per-hover network callbacks can revive a closed tip. */
export function nativeTooltipRenderer({ctx, image}) {
  const cache = new Map(), heights = new Map(), widths = new Map(), identities = new WeakMap();
  let nextIdentity = 0;
  function identity(facts) {
    if (!facts) return 0;
    if (!identities.has(facts)) identities.set(facts, ++nextIdentity);
    return identities.get(facts);
  }
  const metrics = {
    width(text, font) {
      const key = `${font}:${text}`;
      if (widths.has(key)) return widths.get(key);
      ctx.font = TOOLTIP_FONTS[font].font;
      const width = Math.ceil(ctx.measureText(text).width);
      if (widths.size >= 2048) widths.delete(widths.keys().next().value);
      widths.set(key, width); return width;
    },
    height(font) {
      if (!heights.has(font)) {
        ctx.font = TOOLTIP_FONTS[font].font;
        const m = ctx.measureText('가Mg'), height = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
        heights.set(font, Number.isFinite(height) && height > 0 ? Math.ceil(height) : TOOLTIP_FONTS[font].height);
      }
      return heights.get(font);
    },
  };
  function invalidate() {cache.clear(); heights.clear(); widths.clear();}
  // One renderer lives with the page; changing the bundled font must invalidate measured plans.
  globalThis.document?.fonts?.addEventListener?.('loadingdone', invalidate);
  function plan(key, build) {
    if (cache.has(key)) return cache.get(key);
    const value = build();
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    if (value) cache.set(key, value); // Missing facts may still be arriving: don't cache absence.
    return value;
  }
  function paint(value, x, y) {
    if (!value) return;
    const width = Math.min(799, Math.ceil(value.width)), height = Math.min(599, Math.ceil(value.height));
    const at = tooltipPosition(x, y, width, height);
    drawTooltipFrame(ctx, at.x, at.y, width, height, true);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.beginPath(); ctx.rect(2, 2, width - 4, height - 4); ctx.clip();
    ctx.imageSmoothingEnabled = false; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (const command of value.commands) {
      if (command.kind === 'rect') {
        ctx.fillStyle = command.color; ctx.fillRect(command.x, command.y, command.width, command.height);
      } else if (command.kind === 'image') {
        const asset = image(command.path);
        if (asset.ready) ctx.drawImage(asset.img, command.x, command.y, command.width, command.height);
      } else {
        ctx.font = TOOLTIP_FONTS[command.font].font; ctx.fillStyle = TOOLTIP_FONTS[command.font].color;
        const left = command.center ? Math.floor((width - metrics.width(command.text, command.font)) / 2) : command.x;
        ctx.fillText(command.text, left, command.y);
      }
    }
    if (value.separator >= 0) {ctx.fillStyle = '#ffffff'; ctx.fillRect(6, value.separator, width - 12, 1);}
    ctx.restore();
  }
  return {
    item(x, y, facts, item, basic, options = {}) {
      ctx.save();
      const key = JSON.stringify(['item', identity(facts), item.itemId, item.stats, item.ruc, item.cuc, basic && [basic.level, basic.str, basic.dex, basic.int, basic.luk], options.template === true]);
      const value = plan(key, () => Math.floor(item.itemId / 1000000) === 1
        ? nativeEquipmentTooltip(facts, item, basic, metrics, options) : nativeItemTooltip(facts, metrics));
      paint(value, x, y); ctx.restore();
    },
    skill(x, y, facts, level) {
      ctx.save(); const value = plan(JSON.stringify(['skill', identity(facts), level]), () => nativeSkillTooltip(facts, level, metrics));
      paint(value, x, y); ctx.restore();
    },
    clear: invalidate,
  };
}
