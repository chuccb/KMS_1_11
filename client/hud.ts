import type { MapTitleArt } from "../server/src/game/mapart.ts";
import type { HtmlImageLookup } from "./ui-types.ts";
/** CUIStatusBar 4FA5E0/4FB440 and CField 46DA30, KMS 1.11 (not modern UI). */
export const HUD_FONT: string = "12px 'Gulim', '굴림', 'KMSCJK', sans-serif";
export const STATUS_GAUGES: Readonly<
  Record<"hp" | "mp" | "exp", { x: number; y: number; w: number; h: number }>
> = Object.freeze({
  hp: { x: 49, y: 143, w: 163, h: 16 },
  mp: { x: 49, y: 162, w: 163, h: 16 },
  exp: { x: 50, y: 190, w: 151, h: 8 },
});
export function gaugeFill(width: number, value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.trunc((width * Math.max(0, Math.min(value, max))) / max);
}
export function expPercent(value: number, max: number): number {
  return gaugeFill(100, value, max);
}

/**
 * The 2003 status bar (`UI/StatusBar.img`).
 *
 * `CUIStatusBar` is a window at (0, 392) of the 800x600 surface (`sub_545450(this, 0, 392, 800,
 * 208)`), and it is not one picture: a 243x208 left panel, the 446x27 chat bar along the bottom and
 * the 111x136 key pad at the right edge. HP/MP/EXP are 1-px gauge sheets stretched to the troughs
 * the client fills - `v36 = 163 * hp` in `sub_4FA5E0` is the 163-px width, and `sub_4FA170`'s
 * tooltip boxes name the same rectangles (HP 143..159, MP 162..178, EXP 190..198).
 *
 * The layout is gathered here with the rest of the HUD geometry (`STATUS_GAUGES`, `gaugeFill`,
 * `statusVitalText`) because they are the same window's own rectangles; main.js keeps the hover and
 * press state and asks these helpers with it.
 */
export interface StatusBarButton {
  /** `UI/StatusBar.img/<name>/<state>/0` - `normal`, `mouseOver`, `pressed`. */
  name: string;
  x: number;
  /** Relative to `STATUS_BAR.y`, like every other coordinate of this window. */
  y: number;
  w: number;
  h: number;
  action: string;
}

export const STATUS_BAR: Readonly<{
  y: number;
  panel: { path: string; x: number; y: number };
  chat: { path: string; x: number; y: number };
  keys: { path: string; x: number; y: number };
  gauges: typeof STATUS_GAUGES;
  buttons: readonly StatusBarButton[];
}> = Object.freeze({
  y: 392,
  panel: { path: "UI/StatusBar.img/base/0", x: 0, y: 392 },
  chat: { path: "UI/StatusBar.img/base/1", x: 243, y: 573 },
  keys: { path: "UI/StatusBar.img/base/2", x: 689, y: 464 },
  gauges: STATUS_GAUGES,
  // `base/0` carries the same pixels at these spots; the client still draws the button widgets on
  // top of it so a hover or a press can swap the face (36x35, and `BtMenu` 38x17).
  buttons: [
    { name: "BtItem", x: 9, y: 7, w: 36, h: 35, action: "inventory" },
    { name: "BtEquip", x: 9, y: 43, w: 36, h: 35, action: "equip" },
    { name: "BtStat", x: 38, y: 67, w: 36, h: 35, action: "stat" },
    { name: "BtSkill", x: 9, y: 91, w: 36, h: 35, action: "skill" },
    { name: "BtMenu", x: 192, y: 91, w: 38, h: 17, action: "menu" },
  ],
});

/** The button under a SURFACE point, or `undefined`. `y` is already offset by `STATUS_BAR.y`. */
export function statusBarButtonAt(x: number, y: number): StatusBarButton | undefined {
  return STATUS_BAR.buttons.find(
    (button) =>
      x >= button.x &&
      x < button.x + button.w &&
      y >= STATUS_BAR.y + button.y &&
      y < STATUS_BAR.y + button.y + button.h,
  );
}

/** Every face the bar can show, so a hover or a press never has to wait for a fetch. */
export function preloadStatusBar(image: (path: string) => unknown): void {
  for (const name of [...STATUS_BAR.buttons.map((button) => button.name), "BtChat"])
    for (const state of ["normal", "mouseOver", "pressed"])
      image(`UI/StatusBar.img/${name}/${state}/0`);
}

/** 4FA170 uses 527720(1): plain black 12px Gulim, NOT white outlined text. */
export function statusText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = HUD_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000000";
  ctx.fillText(text, x, y);
}

/** CLife::47D110: child z=5, at feet +(-width/2,2), text +(2,2), A0-black
 * rectangle with transparent 1px corners. Browser Gulim fallback metrics are not original GDI.
 *
 * The plate is `ceil(measureText(name)) + 5` wide and 16 high, its corners are left transparent
 * (the fill is inset a pixel and two 1x14 bars close the ends), and the text sits 2px inside.
 * `A0` is 160/255. NPCs pass `#ffff20` (see `drawNamePlate`'s caller), players use white.
 */
export function drawNamePlate(
  ctx: CanvasRenderingContext2D,
  name: string | undefined,
  x: number,
  y: number,
  color = "#ffffff",
): void {
  if (!name) return;
  ctx.save();
  ctx.font = HUD_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const w = Math.ceil(ctx.measureText(name).width) + 5,
    h = 16;
  const left = Math.round(x) - Math.trunc(w / 2),
    top = Math.round(y) + 2;
  ctx.fillStyle = "rgba(0,0,0,0.6274509803921569)"; // A0
  ctx.fillRect(left + 1, top, w - 2, h);
  ctx.fillRect(left, top + 1, 1, h - 2);
  ctx.fillRect(left + w - 1, top + 1, 1, h - 2);
  ctx.fillStyle = color;
  ctx.fillText(name, left + 2, top + 2);
  ctx.restore();
}

/**
 * The whisper recipient field, on the chat bar along the bottom of the surface.
 *
 * Bar-local `fill(245, 186, 79, 17)` and `text(246, 189)` with the bar's origin at y=392, so the
 * page paints the plate at (245, 578) and the name at (246, 581). Without a recipient the field
 * reads 모두에게 - "to everyone" - which is what the native edit box shows before a name is picked.
 */
export const WHISPER_FIELD: Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  textY: number;
  everyone: string;
}> = Object.freeze({
  x: 245,
  y: 578,
  width: 79,
  height: 17,
  textX: 246,
  textY: 581,
  everyone: "모두에게",
});

/** The whisper target's name, clipped to the field so a long name cannot spill out of it. */
export function drawWhisperRecipient(
  ctx: CanvasRenderingContext2D,
  recipient: string | undefined,
): void {
  ctx.save();
  ctx.fillStyle = "#315573";
  ctx.fillRect(WHISPER_FIELD.x, WHISPER_FIELD.y, WHISPER_FIELD.width, WHISPER_FIELD.height);
  ctx.beginPath();
  ctx.rect(WHISPER_FIELD.x, WHISPER_FIELD.y, WHISPER_FIELD.width, WHISPER_FIELD.height);
  ctx.clip();
  ctx.font = HUD_FONT;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(recipient || WHISPER_FIELD.everyone, WHISPER_FIELD.textX, WHISPER_FIELD.textY);
  ctx.restore();
}

/** `sub_4F6B70`'s BtChat (StatusBar id 1004): bar-local (65, 91) -> page (65, 483), 38x17. */
export const MESSENGER_BUTTON: Readonly<{ x: number; y: number; width: number; height: number }> =
  Object.freeze({ x: 65, y: 483, width: 38, height: 17 });

/** Whether a SURFACE point is on BtChat. The caller decides whether the field is playable. */
export function messengerButtonAt(x: number, y: number): boolean {
  return (
    x >= MESSENGER_BUTTON.x &&
    x < MESSENGER_BUTTON.x + MESSENGER_BUTTON.width &&
    y >= MESSENGER_BUTTON.y &&
    y < MESSENGER_BUTTON.y + MESSENGER_BUTTON.height
  );
}

/** BtChat's own face; the WZ node carries `normal`, `mouseOver`, `pressed` and `disabled`. */
export function drawMessengerButton(
  ctx: CanvasRenderingContext2D,
  image: HtmlImageLookup,
  pressed: boolean,
  hover: boolean,
): void {
  const state = pressed ? "pressed" : hover ? "mouseOver" : "normal";
  const art = image(`UI/StatusBar.img/BtChat/${state}/0`);
  if (art.ready) ctx.drawImage(art.img, MESSENGER_BUTTON.x, MESSENGER_BUTTON.y);
}

/** Integer division: HP/MP 163px, EXP 151px (4FA5E0). One source pixel stretched to the fill. */
export function drawStatusGauge(
  ctx: CanvasRenderingContext2D,
  image: HtmlImageLookup,
  key: "hp" | "mp" | "exp",
  value: number,
  max: number,
): void {
  const trough = STATUS_BAR.gauges[key];
  const entry = image(`UI/StatusBar.img/gauge/${key}`);
  if (!entry.ready || max <= 0) return;
  const filled = gaugeFill(trough.w, value, max);
  if (filled <= 0) return;
  ctx.drawImage(entry.img, 0, 0, 1, trough.h, trough.x, STATUS_BAR.y + trough.y, filled, trough.h);
}

/** Native title is a separate 40px-high layer, anchored (799-width,3), not a minimap header.
 * WZ marks have 38x38 pixels. Gulim BA/16 white font + black offset shadow; browser font metrics differ.
 */
export function mapTitleLayout(
  streetWidth: number,
  mapWidth: number,
  hasMark: boolean,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  streetX: number;
  mapX: number;
  markX: number;
} {
  const space = hasMark ? 40 : 0;
  const width = Math.max(streetWidth, mapWidth) + space + 4;
  return {
    x: 799 - width,
    y: 3,
    width,
    height: 40,
    streetX: width - streetWidth - space - 2,
    mapX: width - mapWidth - space - 2,
    markX: width - 39,
  };
}
export function drawMapTitle(
  ctx: CanvasRenderingContext2D,
  image: HtmlImageLookup,
  title: MapTitleArt | undefined,
): void {
  if (!title || (!title.streetName && !title.mapName)) return;
  ctx.save();
  ctx.font = "bold 16px 'Gulim', '굴림', 'KMSCJK', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const at = mapTitleLayout(
    ctx.measureText(title.streetName).width,
    ctx.measureText(title.mapName).width,
    !!title.mark,
  );
  for (const [text, x, y] of [
    [title.streetName, at.streetX, 1],
    [title.mapName, at.mapX, 21],
  ] as const) {
    ctx.fillStyle = "#000000";
    ctx.fillText(text, at.x + x + 1, at.y + y + 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, at.x + x, at.y + y);
  }
  if (title.mark) {
    const mark = image(title.mark.path);
    if (mark.ready) ctx.drawImage(mark.img, at.x + at.markX, at.y);
  }
  ctx.restore();
}

/** 4FC440 -> 525AE0, zero spacing: advance by each ORIGINAL ItemNo canvas width. */
export function drawItemCount(
  ctx: CanvasRenderingContext2D,
  image: HtmlImageLookup,
  value: number,
  x: number,
  y: number,
): void {
  const digits = Array.from(String(Math.max(0, Math.trunc(value))), (digit) =>
    image(`UI/Basic.img/ItemNo/${digit}`),
  );
  if (!digits.every((d) => d.ready)) return; // Never paint later digits at a wrong x while loading.
  for (const digit of digits) {
    ctx.drawImage(digit.img, x, y);
    x += digit.img.naturalWidth;
  }
}
/** 4F9AD0 strict hit rectangles; the EXP target includes its label, not just coloured pixels. */
export function statusVitalText(
  x: number,
  y: number,
  self: { hp: number; mp: number; exp: number; expToNext?: number },
  totals: { maxHp: number; maxMp: number },
): string | undefined {
  const localY = y - 392;
  if (x > 4 && x < 212 && localY > 143 && localY < 159) return `HP : ${self.hp} / ${totals.maxHp}`;
  if (x > 4 && x < 212 && localY > 162 && localY < 178) return `MP : ${self.mp} / ${totals.maxMp}`;
  if (x > 10 && x < 206 && localY > 190 && localY < 198)
    return `EXP : ${self.exp} / ${self.expToNext ?? 0}`;
  return undefined;
}
