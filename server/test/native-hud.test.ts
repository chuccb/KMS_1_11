/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  gaugeFill,
  expPercent,
  STATUS_BAR,
  STATUS_GAUGES,
  WHISPER_FIELD,
  MESSENGER_BUTTON,
  drawNamePlate,
  drawStatusGauge,
  drawWhisperRecipient,
  drawMessengerButton,
  messengerButtonAt,
  mapTitleLayout,
  statusBarButtonAt,
  statusText,
  statusVitalText,
  preloadStatusBar,
} from "../../client/hud.ts";
import { jobNameOf } from "../../client/jobs.ts";
import {
  QUICK_SLOTS,
  quickSlotAt,
  quickItemAllowed,
  bindQuickItem,
  quickItemState,
  quickItemProfile,
  quickSlotIconOrigin,
  skillIconPath,
} from "../../client/quickslots.ts";
import { mapTitleArt } from "../src/game/mapart.ts";
import type { ArtReader } from "../src/game/wzart.ts";

const props = (record: Record<string, unknown>) => ({
  props: Object.entries(record).map(([name, value]) => ({ name, value })),
});
test("4FA5E0: integer gauges are 163/163/151; EXP percentage is not rounded", () => {
  assert.deepEqual(
    Object.values(STATUS_GAUGES).map((g) => g.w),
    [163, 163, 151],
  );
  assert.equal(gaugeFill(163, 1, 2), 81);
  assert.equal(gaugeFill(151, 1, 2), 75);
  assert.equal(expPercent(199, 200), 99);
  assert.equal(expPercent(0, 15), 0);
  for (const max of [0, -1, NaN, Infinity]) assert.equal(gaugeFill(163, 1, max), 0);
  assert.equal(gaugeFill(163, -3, 10), 0);
  assert.equal(gaugeFill(163, 99, 10), 163);
});
test("46DA30: right anchored title and optional 40px mark band, without minimap dependence", () => {
  const withMark = mapTitleLayout(100, 60, true),
    without = mapTitleLayout(100, 60, false);
  assert.equal(withMark.x + withMark.width, 799);
  assert.equal(withMark.x + withMark.markX, 760);
  assert.equal(withMark.x + withMark.streetX + 100, 757);
  assert.equal(without.x + without.streetX + 100, 797);
  assert.equal(withMark.y, 3);
  assert.equal(withMark.height, 40);
});
test("map info strings/mark preserve exact Korean resource names; None makes no resource request", () => {
  const calls: string[] = [];
  const reader = {
    at: (path: string) => {
      calls.push(path);
      return {};
    },
  } as unknown as ArtReader;
  const title = mapTitleArt(
    props({
      info: props({ streetName: "빅토리아로드", mapName: "헤네시스", mapMark: "헤네시스" }),
    }),
    reader,
  );
  assert.deepEqual(title, {
    streetName: "빅토리아로드",
    mapName: "헤네시스",
    mark: { path: "Map/MapHelper.img/mark/헤네시스" },
  });
  assert.deepEqual(calls, ["Map/MapHelper.img/mark/헤네시스"]);
  calls.length = 0;
  assert.deepEqual(mapTitleArt(props({ info: props({ mapMark: "None" }) }), reader), {
    streetName: "",
    mapName: "",
  });
  assert.deepEqual(calls, []);
  const missing = { at: () => undefined } as unknown as ArtReader;
  assert.throws(
    () => mapTitleArt(props({ info: props({ mapMark: "requested" }) }), missing),
    /mapMark canvas cannot be read/,
  );
});
test("4F9AD0 strict vital targets, including EXP label; no permanent numbers over gauges", () => {
  const self = { hp: 12, mp: 8, exp: 7, expToNext: 15 },
    totals = { maxHp: 50, maxMp: 30 };
  assert.equal(statusVitalText(5, 536, self, totals), "HP : 12 / 50");
  assert.equal(statusVitalText(11, 583, self, totals), "EXP : 7 / 15");
  assert.equal(statusVitalText(4, 536, self, totals), undefined);
  assert.equal(statusVitalText(5, 535, self, totals), undefined);
  assert.equal(statusVitalText(11, 590, self, totals), undefined);
});
test("PE 5BCEC0 / 511E20: seven original positions and VK keys; right/bottom are exclusive", () => {
  assert.deepEqual(
    QUICK_SLOTS.map((s) => s.key),
    ["Shift", "Insert", "Home", "PageUp", "Delete", "End", "PageDown"],
  );
  for (let i = 0; i < 7; i++) {
    const s = QUICK_SLOTS[i];
    assert.equal(quickSlotAt(s.x, s.y), i);
    assert.equal(quickSlotAt(s.x + 31, s.y + 31), i);
    assert.notEqual(quickSlotAt(s.x + 32, s.y + 32), i);
  }
  assert.equal(quickSlotAt(750, 480), -1);
});
test("463DF0 and 512570: only 200/201/202, unique ID bindings, aggregate count, lowest slot use", () => {
  for (const id of [2000000, 2010000, 2020000]) assert.equal(quickItemAllowed(id), true);
  for (const id of [2030000, 2070000, 1302000, 2000000.5, NaN])
    assert.equal(quickItemAllowed(id), false);
  const original = [2000000, null, null, null, null, null, null];
  const bound = bindQuickItem(original, 3, 2000000)!;
  assert.deepEqual(bound, [null, null, null, 2000000, null, null, null]);
  assert.equal(original[0], 2000000, "no mutation of caller/profile");
  assert.equal(bindQuickItem(original, 7, 2000000), undefined);
  const items = [
    { slot: 8, itemId: 2000000, quantity: 4 },
    { slot: 2, itemId: 2000000, quantity: 3 },
    { slot: 1, itemId: 2000001, quantity: 9 },
  ];
  const state = quickItemState({ tabs: [{ tab: 2, items }] }, 2000000);
  assert.equal(state.quantity, 7);
  assert.equal(state.item?.slot, 2);
  assert.deepEqual(quickItemState(undefined, 2000000), { quantity: 0, item: undefined });
});
test("local quickslot profiles are owner scoped, corrupt/blocked storage cannot abort field entry", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  assert.equal(quickItemProfile(storage, "a:1").bind(2, 2000000), true);
  assert.equal(quickItemProfile(storage, "a:1").values()[2], 2000000);
  assert.equal(quickItemProfile(storage, "b:1").values()[2], null);
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(quickItemProfile(blocked, "a").bind(0, 2000000), true);
});

test("CUIStatusBar: the 392 window, its three plates and five buttons with exclusive edges", () => {
  assert.equal(STATUS_BAR.y, 392);
  assert.deepEqual(
    [STATUS_BAR.panel, STATUS_BAR.chat, STATUS_BAR.keys].map((p) => [p.x, p.y]),
    [
      [0, 392],
      [243, 573],
      [689, 464],
    ],
  );
  assert.equal(STATUS_BAR.gauges, STATUS_GAUGES, "the bar fills the HUD's own troughs");
  assert.deepEqual(
    STATUS_BAR.buttons.map((b) => [b.name, b.x, b.y, b.w, b.h, b.action]),
    [
      ["BtItem", 9, 7, 36, 35, "inventory"],
      ["BtEquip", 9, 43, 36, 35, "equip"],
      ["BtStat", 38, 67, 36, 35, "stat"],
      ["BtSkill", 9, 91, 36, 35, "skill"],
      ["BtMenu", 192, 91, 38, 17, "menu"],
    ],
  );
  // y is relative to the window, so the surface row is 392 + button.y; right and bottom exclude.
  const at = (x: number, y: number) => statusBarButtonAt(x, y)?.name;
  assert.equal(at(9, 399), "BtItem");
  assert.equal(at(44, 433), "BtItem");
  assert.equal(at(8, 399), undefined);
  assert.equal(at(45, 399), undefined);
  assert.equal(at(9, 398), undefined, "one pixel above the window's first button");
  assert.equal(at(9, 435), "BtEquip", "392 + 43");
  assert.equal(at(192, 483), "BtMenu");
  assert.equal(at(229, 483), "BtMenu");
  assert.equal(at(230, 483), undefined);
  assert.equal(at(192, 500), undefined, "BtMenu is 17 high, not 35");
  // BtEquip covers 435..469 and BtSkill 483..517, so x=9 has a real 13px gap between them.
  assert.equal(at(9, 475), undefined, "the gap between BtEquip and BtSkill");
  assert.equal(at(400, 500), undefined);
});

test("every button face is preloaded once per state, so a hover never waits on a fetch", () => {
  const asked: string[] = [];
  preloadStatusBar((path) => asked.push(path));
  // Five bar buttons plus BtChat, which the bar's own list does not hit-test but does paint.
  assert.equal(asked.length, 18);
  assert.equal(asked[0], "UI/StatusBar.img/BtItem/normal/0");
  assert.equal(asked[1], "UI/StatusBar.img/BtItem/mouseOver/0");
  assert.equal(asked[2], "UI/StatusBar.img/BtItem/pressed/0");
  assert.equal(asked.at(-1), "UI/StatusBar.img/BtChat/pressed/0");
  assert.deepEqual(
    asked.filter((p) => p.includes("BtStat")),
    [
      "UI/StatusBar.img/BtStat/normal/0",
      "UI/StatusBar.img/BtStat/mouseOver/0",
      "UI/StatusBar.img/BtStat/pressed/0",
    ],
  );
});

test("jobNameOf reads the native table exactly, then the 100s root, then 초보자", () => {
  assert.equal(jobNameOf(0), "초보자");
  assert.equal(jobNameOf(112), "영웅", "an exact id wins over the root");
  assert.equal(jobNameOf(199), "검사", "an id with no entry falls back to its 100s root");
  assert.equal(jobNameOf(311), "레인저");
  assert.equal(jobNameOf(900), "초보자", "no table entry at all");
});

test("status text is plain black 12px Gulim, top-aligned, right-aligned only when asked", () => {
  const calls: Record<string, unknown>[] = [];
  const ctx = {
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    fillText: (...args: unknown[]) => calls.push({ ...ctx, args }),
  };
  statusText(ctx as unknown as CanvasRenderingContext2D, "Lv.7", 54, 508);
  statusText(ctx as unknown as CanvasRenderingContext2D, "검사", 136, 508, "right");
  assert.deepEqual(
    calls.map((c) => [c.font, c.textAlign, c.textBaseline, c.fillStyle, c.args]),
    [
      ["12px 'Gulim', '굴림', 'KMSCJK', sans-serif", "left", "top", "#000000", ["Lv.7", 54, 508]],
      ["12px 'Gulim', '굴림', 'KMSCJK', sans-serif", "right", "top", "#000000", ["검사", 136, 508]],
    ],
  );
});

test("4FA5E0: one source pixel stretched to the integer fill, and nothing at all when empty", () => {
  const draws: unknown[][] = [];
  const ctx = { drawImage: (...args: unknown[]) => draws.push(args) };
  const image = (ready: boolean) => () =>
    ({ ready, img: { tag: "gauge" } }) as unknown as { ready: boolean; img: HTMLImageElement };
  // 163 px trough, 40 of 200 -> 32 px; the source column is 1 px wide and the trough's own height.
  drawStatusGauge(ctx as unknown as CanvasRenderingContext2D, image(true), "hp", 40, 200);
  assert.deepEqual(draws, [[{ tag: "gauge" }, 0, 0, 1, 16, 49, 535, 32, 16]]);
  draws.length = 0;
  drawStatusGauge(ctx as unknown as CanvasRenderingContext2D, image(true), "exp", 10, 0);
  assert.equal(draws.length, 0, "a zero maximum is not a full bar");
  drawStatusGauge(ctx as unknown as CanvasRenderingContext2D, image(true), "hp", 0, 200);
  assert.equal(draws.length, 0, "an empty bar draws nothing, not a 1px sliver");
  drawStatusGauge(ctx as unknown as CanvasRenderingContext2D, image(false), "mp", 5, 10);
  assert.equal(draws.length, 0, "an unloaded sheet is skipped whole");
  drawStatusGauge(ctx as unknown as CanvasRenderingContext2D, image(true), "mp", 200, 200);
  assert.deepEqual(
    draws,
    [[{ tag: "gauge" }, 0, 0, 1, 16, 49, 554, 163, 16]],
    "full is the whole trough",
  );
});

test("47D110 name plate: A0 black, transparent 1px corners, text 2px inside, centred on x", () => {
  const log: unknown[][] = [];
  const ctx = {
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    save: () => log.push(["save"]),
    restore: () => log.push(["restore"]),
    measureText: (text: string) => ({ width: text.length * 6.5 }),
    fillRect: (...args: unknown[]) => log.push(["rect", ctx.fillStyle, ...args]),
    fillText: (...args: unknown[]) => log.push(["text", ctx.fillStyle, ...args]),
  };
  drawNamePlate(ctx as unknown as CanvasRenderingContext2D, "멋진모험가", 100.4, 200.6);
  // "멋진모험가" is 5 glyphs -> 32.5 -> ceil 33 + 5 = 38 wide; left = 100 - 19, top = 201 + 2.
  const w = 38;
  assert.deepEqual(log, [
    ["save"],
    ["rect", "rgba(0,0,0,0.6274509803921569)", 82, 203, 36, 16],
    ["rect", "rgba(0,0,0,0.6274509803921569)", 81, 204, 1, 14],
    ["rect", "rgba(0,0,0,0.6274509803921569)", 81 + w - 1, 204, 1, 14],
    ["text", "#ffffff", "멋진모험가", 83, 205],
    ["restore"],
  ]);
  assert.equal(ctx.font, "12px 'Gulim', '굴림', 'KMSCJK', sans-serif");
  assert.equal(ctx.textBaseline, "top");
  log.length = 0;
  // NPCs pass #ffff20; an absent name paints nothing at all - not an empty plate.
  drawNamePlate(ctx as unknown as CanvasRenderingContext2D, "루미너스", 10, 20, "#ffff20");
  assert.equal(log.find((entry) => entry[0] === "text")?.[1], "#ffff20");
  log.length = 0;
  drawNamePlate(ctx as unknown as CanvasRenderingContext2D, undefined, 10, 20);
  drawNamePlate(ctx as unknown as CanvasRenderingContext2D, "", 10, 20);
  assert.deepEqual(log, []);
});

test("the whisper field is a 79x17 plate on the chat bar, clipped, reading 모두에게 when empty", () => {
  assert.deepEqual(
    [WHISPER_FIELD.x, WHISPER_FIELD.y, WHISPER_FIELD.width, WHISPER_FIELD.height],
    [245, 578, 79, 17],
    "bar-local (245,186) with the bar's origin at y=392",
  );
  assert.deepEqual([WHISPER_FIELD.textX, WHISPER_FIELD.textY], [246, 581]);
  assert.equal(WHISPER_FIELD.everyone, "모두에게");
  const log: unknown[][] = [];
  const ctx = {
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    save: () => log.push(["save"]),
    restore: () => log.push(["restore"]),
    beginPath: () => log.push(["beginPath"]),
    rect: (...args: unknown[]) => log.push(["rect", ...args]),
    clip: () => log.push(["clip"]),
    fillRect: (...args: unknown[]) => log.push(["fillRect", ctx.fillStyle, ...args]),
    fillText: (...args: unknown[]) => log.push(["text", ctx.fillStyle, ...args]),
  };
  drawWhisperRecipient(ctx as unknown as CanvasRenderingContext2D, undefined);
  assert.deepEqual(log, [
    ["save"],
    ["fillRect", "#315573", 245, 578, 79, 17],
    ["beginPath"],
    ["rect", 245, 578, 79, 17],
    ["clip"],
    ["text", "#ffffff", "모두에게", 246, 581],
    ["restore"],
  ]);
  assert.equal(ctx.font, "12px 'Gulim', '굴림', 'KMSCJK', sans-serif");
  assert.equal(ctx.textBaseline, "top");
  // An empty string is the same as no recipient: the field never goes blank.
  log.length = 0;
  drawWhisperRecipient(ctx as unknown as CanvasRenderingContext2D, "");
  assert.equal(log.find((entry) => entry[0] === "text")?.[2], "모두에게");
  log.length = 0;
  drawWhisperRecipient(ctx as unknown as CanvasRenderingContext2D, "멋진모험가");
  assert.equal(log.find((entry) => entry[0] === "text")?.[2], "멋진모험가");
});

test("BtChat is a 38x17 face at page (65,483) - the bar's own row - with three sprite states", () => {
  assert.deepEqual(
    [MESSENGER_BUTTON.x, MESSENGER_BUTTON.y, MESSENGER_BUTTON.width, MESSENGER_BUTTON.height],
    [65, 483, 38, 17],
  );
  assert.equal(messengerButtonAt(65, 483), true);
  assert.equal(messengerButtonAt(102, 499), true);
  assert.equal(messengerButtonAt(64, 483), false);
  assert.equal(messengerButtonAt(103, 483), false, "right edge is exclusive");
  assert.equal(messengerButtonAt(65, 500), false, "17 high, not 35");
  // BtChat is NOT one of the five buttons this page hit-tests - but the native rectangles do
  // overlap: `sub_4F6B70` creates 1002 BtStat at (38, 67) 36x35 and 1004 BtChat at (65, 91) 38x17,
  // so bar-local x 65..74 / y 91..102 (page 483..494) is inside both. Which control the original's
  // hit test returns there is not established; the page has always let the click reach BtChat
  // first, and this test only records that the overlap exists.
  assert.equal(statusBarButtonAt(50, 480)?.name, "BtStat", "a point only BtStat owns");
  assert.equal(statusBarButtonAt(70, 490)?.name, "BtStat", "BtStat reaches into BtChat's corner");
  assert.equal(messengerButtonAt(70, 490), true, "and BtChat owns the same pixel");
  assert.equal(statusBarButtonAt(75, 490), undefined, "past BtStat's right edge it is BtChat only");
  assert.equal(messengerButtonAt(75, 490), true);
  const drawn: { image: unknown; x: number; y: number }[] = [];
  const asked: string[] = [];
  const ctx = {
    drawImage: (image: unknown, x: number, y: number) => drawn.push({ image, x, y }),
  };
  const image = (path: string) => {
    asked.push(path);
    return { ready: true, img: path as unknown as HTMLImageElement };
  };
  const paint = (pressed: boolean, hover: boolean) => {
    drawn.length = 0;
    asked.length = 0;
    drawMessengerButton(ctx as unknown as CanvasRenderingContext2D, image, pressed, hover);
    return drawn[0];
  };
  assert.deepEqual(paint(false, false), {
    image: "UI/StatusBar.img/BtChat/normal/0",
    x: 65,
    y: 483,
  });
  assert.deepEqual(paint(false, true), {
    image: "UI/StatusBar.img/BtChat/mouseOver/0",
    x: 65,
    y: 483,
  });
  // A press shows even when the pointer has left the button, which is how the page has always
  // drawn this one - BtChat is toggled by its own hover/pressed pair, not CCtrlButton's.
  assert.deepEqual(paint(true, false), {
    image: "UI/StatusBar.img/BtChat/pressed/0",
    x: 65,
    y: 483,
  });
  assert.deepEqual(paint(true, true), {
    image: "UI/StatusBar.img/BtChat/pressed/0",
    x: 65,
    y: 483,
  });
});

test("4FC440: a quick-slot icon is anchored by its origin, and a skill icon lives under its job block", () => {
  const slot = QUICK_SLOTS[0];
  assert.deepEqual(quickSlotIconOrigin(slot, { ox: 8, oy: 32 }), { x: slot.x - 8, y: slot.y });
  assert.deepEqual(
    quickSlotIconOrigin(slot, { ox: 0, oy: 0 }),
    { x: slot.x, y: slot.y + 32 },
    "an origin at the top left pushes the icon down by the slot's own height",
  );
  // A missing origin is the skill branch's default: ox 0, oy 32, so the icon sits flush with the
  // slot's top edge instead of being centred in it.
  assert.deepEqual(quickSlotIconOrigin(slot, undefined), { x: slot.x, y: slot.y });
  assert.deepEqual(quickSlotIconOrigin(slot, {}), { x: slot.x, y: slot.y });
  assert.equal(skillIconPath(1001003), "Skill/100.img/skill/1001003/icon");
  assert.equal(skillIconPath(3001004), "Skill/300.img/skill/3001004/icon");
  assert.equal(skillIconPath(999), "Skill/0.img/skill/999/icon", "the trunc, not a round");
});
