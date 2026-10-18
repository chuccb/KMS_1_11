/** ADR-064 Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import {
  TOOLTIP_FONTS,
  tooltipAnchor,
  nativeTooltipRows,
  nativeItemTooltip,
  nativeSkillTooltip,
  nativeEquipmentTooltip,
  nativeTooltipRenderer,
  type TooltipPlan,
} from "../../client/tooltip.ts";

const metrics = { width: (s: string) => Array.from(s).length * 6, height: () => 13 };
const basic = { level: 10, str: 20, dex: 4, int: 4, luk: 4 };
const facts = {
  name: "검",
  desc: "not an equipment footer",
  icon: { path: "Character/Weapon/01302000.img/info/icon", width: 31, height: 30, ox: 0, oy: 30 },
  requirements: { level: 10, str: 20, dex: 0, int: 0, luk: 0, job: 1 },
  equipment: { ruc: 7, stats: { pad: 17, str: 50 } },
};
const texts = (p: TooltipPlan) => p.commands.filter((c) => c.kind === "text").map((c) => c.text);
const images = (p: TooltipPlan) => p.commands.filter((c) => c.kind === "image");

test("503AF0 keeps the overflow character, one hanging punctuation, trims each row and consumes unknown escapes", () => {
  assert.deepEqual(nativeTooltipRows("  AB CD.", metrics.width, 18), ["AB C", "D."]);
  assert.deepEqual(nativeTooltipRows("ABCD, E", metrics.width, 18), ["ABCD,", "E"]);
  assert.deepEqual(nativeTooltipRows("A\\n\\n\t B\\\\C\\xD\\", metrics.width, 999), ["A", "B\\CD"]);
  assert.deepEqual(nativeTooltipRows("", metrics.width, 178), []);
  assert.deepEqual(nativeTooltipRows("가나다라마", metrics.width, 18), ["가나다라", "마"]);
});

test("native caller anchors are not a universal pointer +(20,20)", () => {
  for (const source of ["inventory", "equip", "skill"])
    assert.deepEqual(tooltipAnchor(source, 21, 33), { x: 21, y: 53 });
  assert.deepEqual(tooltipAnchor("shop", 21, 33), { x: 21, y: 33 });
  assert.deepEqual(tooltipAnchor("quick", 21, 33), { x: 21, y: -95 });
});

test("502780 keeps its 290x116 type4 plan, doubled normal icon and archive description only", () => {
  const p = nativeItemTooltip(
    {
      ...facts,
      name: "빨간 포션",
      desc: "HP\\n회복",
      icon: { path: "normal", width: 27, height: 30, ox: -3, oy: 30 },
    },
    metrics,
  )!;
  assert.deepEqual([p.type, p.width, p.height, p.separator], [4, 290, 116, -1]);
  assert.deepEqual(texts(p), ["빨간 포션", "HP", "회복"]);
  const icon = images(p)[0]!;
  assert.deepEqual(
    [icon.path, icon.x, icon.y, icon.width, icon.height],
    ["normal", 22, 38, 54, 60],
  );
  assert.ok(
    p.commands.some(
      (c) => c.kind === "rect" && c.x === 14 && c.y === 32 && c.width === 68 && c.height === 68,
    ),
  );
  assert.equal(nativeItemTooltip({}, metrics), undefined, "no invented Item ID label");
});

test("5029A0 current/next/max sections, runtime row pitch and long hs widen instead of wrapping", () => {
  const skill = {
    name: "Skill",
    desc: "Description",
    maxLevel: 2,
    icon: { path: "normal", width: 32, height: 32, ox: 0, oy: 32 },
    levels: [
      { level: 1, hs: "One" },
      { level: 2, hs: "Two" },
    ],
  };
  const zero = nativeSkillTooltip(skill, 0, metrics)!,
    one = nativeSkillTooltip(skill, 1, metrics)!,
    max = nativeSkillTooltip(skill, 2, metrics)!;
  assert.deepEqual([zero.type, zero.width, zero.height, zero.separator], [5, 290, 162, 114]);
  assert.deepEqual(texts(zero), ["Skill", "Description", "[다음레벨 1]", "One"]);
  assert.deepEqual(texts(one), [
    "Skill",
    "Description",
    "[현재레벨 1]",
    "One",
    "[다음레벨 2]",
    "Two",
  ]);
  assert.equal(one.height, 196);
  assert.equal(max.height, 162);
  assert.deepEqual(texts(max), ["Skill", "Description", "[현재레벨 2]", "Two"]);
  assert.deepEqual(
    images(one).map((c) => [c.x, c.y, c.width, c.height]),
    [[16, 34, 64, 64]],
  );
  const wide = nativeSkillTooltip(
    { ...skill, levels: [{ level: 1, hs: "x".repeat(60) }] },
    0,
    metrics,
  )!;
  assert.equal(wide.width, 380);
  assert.equal(wide.height, 162);
});

test("5014C0 uses signed positive instance stats in original order, never WZ fallback for zero/absent stats", () => {
  const p = nativeEquipmentTooltip(
    facts,
    {
      itemId: 1302000,
      cuc: 3,
      ruc: 1,
      stats: { pad: 0, str: 2, dex: 65535, mdd: 5, jump: 0, craft: 4 },
    },
    basic,
    metrics,
  )!;
  assert.equal(p.type, 3);
  assert.equal(p.separator, 128);
  assert.equal(p.height, 142 + 5 * 17);
  assert.deepEqual(texts(p).slice(-5), [
    "무기분류 : 한손검",
    "STR : +2",
    "마법방어력 : +5",
    "손재주 : +4",
    "업그레이드 가능 횟수 : 1",
  ]);
  const title = p.commands.find((c) => c.kind === "text")!;
  assert.equal(title.kind, "text");
  if (title.kind === "text") {
    assert.equal(title.text, "검 (+3)");
    assert.equal(title.font, 3);
  }
  assert.ok(
    !texts(p).some(
      (t) =>
        t.includes("+17") ||
        t.includes("+50") ||
        t.includes("-1") ||
        t.includes("not an equipment"),
    ),
  );
  assert.equal(nativeEquipmentTooltip(facts, { itemId: 1302000 }, basic, metrics), undefined);
  assert.equal(
    nativeEquipmentTooltip(facts, { itemId: 1302000, stats: {} }, undefined, metrics),
    undefined,
    "wait for actual BasicStat",
  );
  const bought = nativeEquipmentTooltip(facts, { itemId: 1302000 }, basic, metrics, {
    template: true,
  })!;
  assert.ok(texts(bought).includes("공격력 : +17"));
  assert.ok(texts(bought).includes("STR : +50"));
  const claw = nativeEquipmentTooltip(facts, { itemId: 1472000, stats: {} }, basic, metrics)!;
  assert.ok(!texts(claw).some((t) => t.startsWith("무기분류")), "no invented final switch case47");
});

test("title gender and +20 width come from the native ID digit and actual CUC byte", () => {
  const male = nativeEquipmentTooltip(facts, { itemId: 1000000, stats: {} }, basic, metrics)!;
  assert.equal(texts(male)[0], "검 (남)");
  assert.equal(
    texts(
      nativeEquipmentTooltip(facts, { itemId: 1001000, stats: {}, cuc: 2 }, basic, metrics)!,
    )[0],
    "검 (+2여)",
  );
  const wide = nativeEquipmentTooltip(
    { ...facts, name: "X".repeat(50) },
    { itemId: 1302000, stats: {} },
    basic,
    metrics,
  )!;
  assert.equal(wide.width, 320, "not the decompiler DWORD* +5 misread as five pixels");
});

test("five independent effective BasicStat comparisons, actual digit widths and item job mask colors", () => {
  const p = nativeEquipmentTooltip(
    facts,
    { itemId: 1302000, stats: {} },
    { ...basic, level: 9, str: 20 },
    metrics,
  )!;
  const imgs = images(p);
  const label = imgs.find((c) => c.path.endsWith("/reqLEV"))!;
  assert.match(label.path, /Cannot/);
  assert.deepEqual([label.x, label.y, label.width, label.height], [96, 35, 45, 7]);
  assert.match(
    imgs.find((c) => c.path.endsWith("/reqSTR"))!.path,
    /\/Can\//,
    "STR20 includes worn bonus and passes independently",
  );
  const digits = imgs.filter((c) => c.y === 35 && !c.path.includes("/req"));
  assert.deepEqual(
    digits.map((c) => [c.path.split("/").at(-1), c.x, c.width]),
    [
      ["1", 146, 3],
      ["0", 150, 5],
    ],
  );
  const jobs = p.commands.flatMap((c) =>
    c.kind === "text" && c.y === 110 ? [[c.text, c.font]] : [],
  );
  assert.deepEqual(jobs, [
    ["초보자   ", 7],
    ["전사   ", 4],
    ["마법사   ", 7],
    ["궁수   ", 7],
    ["도적   ", 7],
  ]);
  const all = nativeEquipmentTooltip(
    { ...facts, requirements: { ...facts.requirements, job: 0 } },
    { itemId: 1302000, stats: {} },
    basic,
    metrics,
  )!;
  assert.ok(all.commands.every((c) => c.kind !== "text" || c.y !== 110 || c.font === 4));
});

test("shared painter measures once per plan/height, invalidates on font arrival, uses normal assets and updates stationary level", () => {
  const calls: unknown[][] = [],
    handlers = new Map<string, () => void>();
  let measures = 0;
  const ctx: any = {
    font: "",
    fillStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    rect() {},
    clip() {},
    translate(...a: unknown[]) {
      calls.push(["translate", ...a]);
    },
    fill() {},
    fillRect() {},
    fillText(...a: unknown[]) {
      calls.push(["text", ...a]);
    },
    drawImage(...a: unknown[]) {
      calls.push(["image", ...a]);
    },
    measureText(text: string) {
      measures++;
      return { width: text.length * 6, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 };
    },
  };
  const g = globalThis as any,
    old = g.document;
  g.document = {
    fonts: { addEventListener: (name: string, fn: () => void) => handlers.set(name, fn) },
  };
  try {
    const renderer = nativeTooltipRenderer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      image: (path) => ({ ready: true, img: path as unknown as CanvasImageSource }),
    });
    const skill = {
      name: "Skill",
      maxLevel: 2,
      levels: [
        { level: 1, hs: "One" },
        { level: 2, hs: "Two" },
      ],
    };
    renderer.skill(798, 598, skill, 0);
    assert.ok(calls.some((c) => c[0] === "translate" && c[1] === 509 && c[2] === 437));
    const measured = measures;
    renderer.skill(798, 598, skill, 0);
    assert.equal(measures, measured, "stationary cached hover reuses width and layout");
    calls.length = 0;
    renderer.skill(5, 5, skill, 1);
    assert.ok(calls.some((c) => c[0] === "text" && c[1] === "[현재레벨 1]"));
    renderer.item(0, 0, facts, { itemId: 1302000, stats: {} }, basic);
    assert.ok(
      calls.some(
        (c) => c[0] === "image" && c[1] === facts.icon.path && c.at(-2) === 62 && c.at(-1) === 60,
      ),
    );
    const before = measures;
    handlers.get("loadingdone")!();
    renderer.skill(0, 0, skill, 0);
    assert.ok(measures > before);
  } finally {
    g.document = old;
  }
  assert.equal(TOOLTIP_FONTS[3].color, "#ff8a18");
  assert.equal(TOOLTIP_FONTS[7].color, "#f20303");
});

const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "actual archive Can/Cannot canvases, nonfixed digit1, icon origins and skill hs catalogue",
  { skip: !existsSync(data) },
  () => {
    const wz = WzArchive.open(data),
      reader = artReaderOf(wz)!,
      items = itemCatalogOf(wz)!,
      skills = skillCatalogOf(wz);
    for (const mode of ["Can", "Cannot"]) {
      for (const name of ["LEV", "STR", "DEX", "INT", "LUK"]) {
        const a = reader.at(`UI/UIWindow.img/ToolTip/Equip/${mode}/req${name}`)!;
        assert.deepEqual([a.width, a.height, a.ox, a.oy], [45, 7, 0, 0]);
      }
      for (let n = 0; n < 10; n++) {
        const a = reader.at(`UI/UIWindow.img/ToolTip/Equip/${mode}/${n}`)!;
        assert.deepEqual([a.width, a.height, a.ox, a.oy], n === 1 ? [3, 7, -1, 0] : [5, 7, 0, 0]);
      }
    }
    const potion = items.info(2000000)!.icon!;
    assert.deepEqual([potion.width, potion.height, potion.ox, potion.oy], [27, 30, -3, 30]);
    assert.deepEqual(skills.info(1000000)!.icon, {
      path: "Skill/100.img/skill/1000000/icon",
      width: 32,
      height: 32,
      ox: 0,
      oy: 32,
    });
    assert.equal(skills.info(1000000)!.levels[0]!.hs.length > 0, true);
  },
);

test("integration source removes fabricated price/quantity, re-hits live instances, resolves level and keeps viewer non-authoritative", () => {
  const source = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../../client/${name}`, import.meta.url)), "utf8");
  const main = source("main.js"),
    skill = source("skills.ts"),
    viewer = source("tooltip-preview.ts");
  assert.doesNotMatch(main, /function itemTooltipLines|drawTextTooltip|nativeBasis\(\)/);
  assert.match(main, /const shopHit = shopWindowAt/);
  assert.match(main, /const bagHit = inventoryWindowAt/);
  assert.match(
    main,
    /nativeTips\.item\(at\.x, at\.y, itemInfo\.get\(item\.itemId\), item, nativeBasis\?\.basic/,
  );
  assert.match(main, /shopWindowAt\(x, y\)\?\.kind === 'buy-row'/);
  assert.match(main, /npcDialog\.preview \|\| tooltipViewer\.open/);
  assert.match(skill, /level = learned\.get\(s\.id\) \?\? 0/);
  assert.match(skill, /tooltipRenderer\.skill/);
  assert.doesNotMatch(skill, /drawTextTooltip/);
  assert.doesNotMatch(viewer, /\bsend\s*\(|localStorage|WebSocket|\.stats\.[a-z]+\s*=/);
  assert.match(viewer, /current !== c \|\| c\.abort\.signal\.aborted/);
  assert.match(viewer, /current\.abort\.abort\(\)/);
});
