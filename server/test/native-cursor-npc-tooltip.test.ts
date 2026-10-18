/** SOURCE ONLY — deliberately NOT executed/typechecked/browser-probed, 2026-10-18 / ADR-060. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { WzNode, type WzEntry } from "../src/wz/img.ts";
import { artReaderOf, type ArtReader } from "../src/game/wzart.ts";
import { npcArtOf, npcClickBounds } from "../src/game/sprites.ts";
import { cursorLayout, CURSOR_PATH } from "../../client/cursor.ts";
import { npcContains } from "../../client/pointer.ts";
import { tooltipPosition, tooltipRows, drawTooltipFrame } from "../../client/tooltip.ts";

const props = (...pairs: [string, unknown][]) =>
  new WzNode(
    "props",
    pairs.map(([name, value]) => ({ name, type: 9, value }) as WzEntry),
  );
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("553320 arrow hotspot and presentation scale; DPR must not be multiplied a second time", () => {
  const arrow = { width: 24, height: 23, ox: 0, oy: 0 };
  assert.equal(CURSOR_PATH, "UI/Basic.img/Cursor/arrow");
  assert.deepEqual(cursorLayout(arrow, 1), { width: 24, height: 23, x: 0, y: 0 });
  assert.deepEqual(cursorLayout(arrow, 2), { width: 48, height: 46, x: 0, y: 0 });
  assert.deepEqual(cursorLayout(arrow, 0.5), { width: 12, height: 12, x: 0, y: 0 });
  assert.equal(cursorLayout(arrow, 99).width, 128);
  assert.deepEqual(cursorLayout(arrow, NaN), cursorLayout(arrow, 1));
  assert.throws(() => cursorLayout({ ...arrow, width: 0 }));
  assert.throws(() => cursorLayout({ ...arrow, oy: NaN }));
  assert.deepEqual(cursorLayout({ ...arrow, ox: 5, oy: 7 }, 2), {
    width: 48,
    height: 46,
    x: 10,
    y: 14,
  });
});

test("49CBF0 dc defaults and explicit zero; 49A670 does not mirror or grow to sprite pixels", () => {
  const bounds = npcClickBounds({});
  assert.deepEqual(bounds, { left: -22, top: -65, right: 22, bottom: 0 });
  assert.deepEqual(npcClickBounds({ dcLeft: 0, dcTop: -130, dcRight: 80, dcBottom: 10 }), {
    left: 0,
    top: -130,
    right: 80,
    bottom: 10,
  });
  const npc = { x: 100, y: 200, facing: 1 };
  assert.ok(npcContains(npc, bounds, 78, 135));
  assert.ok(npcContains(npc, bounds, 121, 199));
  assert.equal(npcContains(npc, bounds, 122, 170), false);
  assert.equal(npcContains(npc, bounds, 100, 200), false);
  assert.equal(npcContains(npc, bounds, 77, 170), false);
  assert.equal(npcContains(npc, undefined, 100, 170), false);
});

test("40C020 linked action tables retain own info and own-only actions; cycles are bounded", () => {
  const nodes = new Map<string, WzNode>();
  const images = ["Npc/0000001.img", "Npc/0000002.img"];
  const frame = (path: string) => {
    nodes.set(path, props(["0", props()]));
    nodes.set(`${path}/0`, props());
  };
  nodes.set(images[0]!, props(["info", props()], ["stand", props()], ["smile", props()]));
  nodes.set(`${images[0]}/info`, props(["name", "own"], ["link", "2"], ["dcLeft", -41]));
  nodes.set(images[1]!, props(["info", props()], ["stand", props()], ["blink", props()]));
  nodes.set(`${images[1]}/info`, props(["name", "linked"], ["dcLeft", -99]));
  for (const [image, actions] of [
    [images[0], ["stand", "smile"]],
    [images[1], ["stand", "blink"]],
  ] as const)
    for (const action of actions) frame(`${image}/${action}`);
  const reader: ArtReader = {
    size: 0,
    clear() {},
    node: (path) => nodes.get(path),
    at: (path) =>
      path.endsWith("/0") && nodes.has(path)
        ? {
            width: 4,
            height: 8,
            ox: 1,
            oy: 7,
            z: 0,
            rgba: new Uint8Array(128),
            png: new Uint8Array(),
          }
        : undefined,
  };
  const art = npcArtOf(1, reader)!;
  assert.equal(art.name, "own");
  assert.equal(art.clickBounds.left, -41);
  assert.equal(art.actions.stand![0]!.path, `${images[1]}/stand/0`);
  assert.equal(art.actions.smile![0]!.path, `${images[0]}/smile/0`);
  assert.equal(art.actions.blink![0]!.path, `${images[1]}/blink/0`);
  assert.deepEqual(
    art.behavior.extraActions,
    [{ name: "blink", speak: [] }],
    "49CBF0 behavior root substitution differs from 40C020 own-only art merge",
  );
  nodes.set(`${images[1]}/info`, props(["link", "1"]));
  assert.equal(npcArtOf(1, reader), undefined);
});

test("502CE0 placement and browser long-description wrapping do not escape the 800x600 surface", () => {
  assert.deepEqual(tooltipPosition(790, 590, 100, 30), { x: 699, y: 569 });
  assert.deepEqual(tooltipPosition(-10, -20, 100, 30), { x: 0, y: 0 });
  assert.deepEqual(
    tooltipRows(["abcd\\nef\r\ng"], (s: string) => s.length, 2),
    ["ab", "cd", "ef", "g"],
  );
  assert.deepEqual(
    tooltipRows(["가나다"], (s: string) => s.length, 1),
    ["가", "나", "다"],
  );
  const calls: unknown[][] = [];
  const ctx = {
    fillStyle: "",
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    rect(...args: unknown[]) {
      calls.push(args);
    },
    fill(rule: string) {
      calls.push([rule]);
    },
  };
  drawTooltipFrame(ctx as unknown as CanvasRenderingContext2D, 0, 0, 100, 30, true);
  assert.equal(ctx.fillStyle, "rgba(0,0,64,0.6274509803921569)");
  assert.deepEqual(calls, [
    [1, 2, 1, 26],
    [98, 2, 1, 26],
    [2, 1, 96, 1],
    [2, 28, 96, 1],
    ["evenodd"],
  ]);
});

const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "shipped Basic.img has only arrow, and Robin owns its name and default dc bounds",
  { skip: !existsSync(data) },
  () => {
    const reader = artReaderOf(WzArchive.open(data))!;
    assert.deepEqual(
      reader.node("UI/Basic.img/Cursor")!.props.map((p) => p.name),
      ["arrow"],
    );
    const arrow = reader.at(CURSOR_PATH)!;
    assert.deepEqual([arrow.width, arrow.height, arrow.ox, arrow.oy], [24, 23, 0, 0]);
    const npc = npcArtOf(2003, reader)!;
    assert.equal(npc.name, "로빈");
    assert.deepEqual(npc.clickBounds, { left: -22, top: -65, right: 22, bottom: 0 });
  },
);

test("integration source keeps the cursor in its own plane and cancels interruptions without packets", () => {
  const main = source("../../client/main.js"),
    css = source("../../client/style.css");
  assert.match(main, /gameCursor\.resize\(layout\.scale\)/);
  assert.match(css, /\.native-cursor-ready \*/);
  assert.doesNotMatch(main, /canvas\.style\.cursor\s*=/);
  assert.doesNotMatch(main, /const NPC_BOX/);
  assert.match(main, /npcContains\(npc, npcMetadata/);
  assert.match(main, /drawName\(npcMetadata.*"#ffff20"/);
  assert.equal((main.match(/addEventListener\("mouseup", finishWindowPress\)/g) ?? []).length, 1);
  assert.match(main, /if \(control && control !== activation\) return/);
  const bridge = source("../src/net/webclient.ts");
  assert.match(bridge, /name: npc\.name/);
  assert.match(bridge, /clickBounds: npc\.clickBounds/);
  const pointer = source("../../client/pointer.ts");
  assert.match(pointer, /pointercancel/);
  assert.match(pointer, /visibilitychange/);
  assert.doesNotMatch(pointer, /dispatchEvent|send\(/);
});
