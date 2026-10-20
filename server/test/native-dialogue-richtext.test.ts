/** ADR-063 Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawSimpleTooltip } from "../../client/tooltip.ts";
import {
  dialogueRuns,
  dialogueSelections,
  dialoguePlainText,
  dialogueLayout,
  dialogueAssetKey,
} from "../../client/npcdialogue-layout.ts";
import { dialogueAssets } from "../../client/dialogue-assets.ts";
import { dialogueExample } from "../../client/dialogue-examples.ts";
import { questReplyFor } from "../src/client/questreply.ts";

const measure = (s: string) => Array.from(s).length * 6;
const facts = new Map([
  [
    "item:2000000",
    {
      name: "빨간 포션",
      icon: { path: "Item/Consume/0200.img/02000000/info/icon", width: 27, height: 30 },
    },
  ],
  [
    "item:1302000",
    {
      name: "검",
      icon: { path: "Character/Weapon/01302000.img/info/icon", width: 31, height: 30 },
    },
  ],
  [
    "skill:1000000",
    {
      name: "HP 회복력 향상",
      icon: { path: "Skill/100.img/skill/1000000/icon", width: 32, height: 32 },
    },
  ],
]);
const resolve = (run: { kind: string; id: number }) => facts.get(dialogueAssetKey(run));
const response = (id: number) => new Response(JSON.stringify({ id, ...facts.get(`item:${id}`) }));

test("534FA0/5338A0: ## escapes, icon records inherit selection, `#l` closes even mid-word, unknown macros remain literal", () => {
  const message = "##L99#literal #L42##r#i2000000##s1000000# text#l #h #t1302000#";
  const runs = dialogueRuns(message);
  const icons = runs.filter((r: { kind?: string }) => r.kind);
  assert.deepEqual(
    icons.map((r) => [r.kind, r.id, r.selection, r.color]),
    [
      ["item", 2000000, 42, "r"],
      ["skill", 1000000, 42, "r"],
    ],
  );
  assert.deepEqual([...dialogueSelections(message)], [42]);
  // The native lexer (534A80 emits '#', 534FA0's default emits the macro char) turns `#literal`
  // into the record "#l" + text "iteral", and the walker's dispatch (sub_5338A0) strcmps WHOLE
  // records: "#k"/"#r"/"#g"/"#b"/"#e"/"#n"/"#l" are exact-match commands - "#l" sets selection
  // -1 unconditionally, mid-word or not, open selection or not - and renders nothing. Only
  // records that match no dispatch ("#h", "#t", the lone "#" of an escape) paint literally.
  assert.match(dialoguePlainText(runs, resolve), /^#L99iteral /);
  assert.match(dialoguePlainText(runs, resolve), /빨간 포션HP 회복력 향상/);
  assert.match(dialoguePlainText(runs, resolve), /#h #t1302000#/);
  // The closing `#l` after " text" strips selection inheritance from everything after it.
  assert.equal(
    runs.find((r) => r.text.includes("#h"))?.selection,
    undefined,
    "records after the closing #l no longer inherit selection 42",
  );
  assert.deepEqual([...dialogueSelections("#L12##l")], [], "no materialized selectable record");
  assert.deepEqual([...dialogueSelections("#L12#\r\n#l")], [], "newline is not a clickable record");
});

test("reply validation cannot manufacture a menu choice out of an escaped #L", () => {
  const body = { kind: "menu" as const, message: "##L99#literal #L42##i2000000#x#l" };
  assert.throws(() => questReplyFor(body, 1, { value: 99 }), /not offered/);
  assert.deepEqual(questReplyFor(body, 1, { value: 42 }), { kind: "menu", answer: 1, value: 42 });
  assert.throws(
    () => questReplyFor({ kind: "menu", message: "#L12##l" }, 1, { value: 12 }),
    /not offered/,
  );
});

test("5359B0/535A60: mixed 30px/16px/32px records share one bottom, not one top", () => {
  const layout = dialogueLayout(
    { kind: "menu", message: "#L42##i1302000#X#s1000000##l" },
    measure,
    resolve,
  );
  assert.deepEqual(
    layout.pieces.map((p: { x: number; y: number; width: number; height: number }) => [
      p.x,
      p.y,
      p.width,
      p.height,
    ]),
    [
      [8, 10, 31, 30],
      [39, 24, 6, 16],
      [45, 8, 32, 32],
    ],
  );
  assert.equal(layout.textHeight, 50);
  assert.equal(layout.height, 108);
  assert.equal(layout.width, 322);
  assert.ok(layout.pieces.every((p) => p.selection === 42));
  assert.equal(layout.pieces[0].image, "Character/Weapon/01302000.img/info/icon");
});

test("an icon wraps as one record; its actual height participates in scroll geometry", () => {
  const layout = dialogueLayout(
    { kind: "menu", message: "x".repeat(44) + "#s1000000#" },
    measure,
    resolve,
  );
  assert.deepEqual(
    layout.pieces.map((p: { x: number; y: number; height: number }) => [p.x, p.y, p.height]),
    [
      [8, 8, 16],
      [8, 26, 32],
    ],
  );
  assert.equal(layout.textHeight, 68);
  const long = dialogueLayout(dialogueExample("rich"), measure, resolve);
  assert.equal(long.scrolling, true);
  assert.equal(long.visibleHeight, 240);
  assert.equal(long.maxScroll, Math.floor((long.textHeight - 240) / 8));
});

test("wrap measures complete shaped substrings, not the sum of glyph widths", () => {
  const shaped = (s: string) => s.length * 6 - (s.match(/AV/g)?.length ?? 0) * 2;
  const layout = dialogueLayout({ kind: "say", message: "AV".repeat(25) }, shaped);
  assert.equal(layout.pieces.length, 1);
  assert.equal(layout.pieces[0].width, 250);
});

test("5338A0 hanging . and ,; 535520 trims only continuation whitespace, not explicit indentation", () => {
  for (const mark of [".", ","]) {
    const layout = dialogueLayout({ kind: "say", message: "x".repeat(47) + mark + "z" }, measure);
    assert.equal(layout.pieces[0].text, "x".repeat(47) + mark);
    assert.equal(layout.pieces[0].width, 288);
    assert.equal(layout.pieces[1].text, "z");
  }
  const trim = dialogueLayout({ kind: "say", message: "x".repeat(47) + "  next" }, measure);
  assert.equal(trim.pieces[1].text, "next");
  const indent = dialogueLayout({ kind: "say", message: "  x\r\n  y" }, measure);
  assert.deepEqual(
    indent.pieces.map((p: { text: string }) => p.text),
    ["  x", "  y"],
  );
  assert.equal(dialogueLayout({ kind: "say", message: "" }, measure).textHeight, 0);
});

test("missing resource facts do not draw an invented icon, raw icon, or literal markup placeholder", () => {
  const missing = dialogueLayout({ kind: "menu", message: "#L42##i2147483647##l" }, measure);
  assert.equal(missing.pieces.length, 0);
  assert.equal(
    dialoguePlainText(dialogueRuns("#i2147483647#")),
    "item 2147483647",
    "aria fallback only",
  );
});

test("operator rich pages are explicitly read-only, with sparse and icon-only choices", () => {
  for (const kind of ["rich", "richMenu"] as const)
    assert.match(dialogueExample(kind).message, /UI PREVIEW - not an NPC quest/);
  const body = dialogueExample("richMenu"),
    layout = dialogueLayout(body, measure, resolve);
  assert.deepEqual([...dialogueSelections(body.message)], [10, 20, 42, 84]);
  const onlyIcons = layout.pieces.filter((p) => p.selection === 84);
  assert.equal(onlyIcons.length, 2);
  assert.ok(onlyIcons.every((p: { image?: string }) => p.image));
  assert.equal(dialogueExample("rich").unknownB, 0, "one page, not the two-page say preview");
});

test("asset loader deduplicates per page, caches successes, and preloads the normal canvas path", async () => {
  let reads = 0;
  const paths: string[] = [];
  const assets = dialogueAssets({
    fetch: async () => {
      reads++;
      return response(2000000);
    },
    image: (path: string) => {
      paths.push(path);
    },
  });
  const runs = dialogueRuns("#i2000000##i2000000#");
  const first = await assets.load(runs, new AbortController().signal);
  assert.equal(first.size, 1);
  assert.equal(reads, 1);
  await assets.load(runs, new AbortController().signal);
  assert.equal(reads, 1);
  assert.deepEqual(paths, [
    facts.get("item:2000000")!.icon.path,
    facts.get("item:2000000")!.icon.path,
  ]);
});

test("asset loader rejects id/path/size mismatches and iconRaw-only facts; failures can retry", async () => {
  for (const info of [
    { id: 2000001, ...facts.get("item:2000000") },
    { id: 2000000, name: "raw", iconRaw: facts.get("item:2000000")!.icon },
    { id: 2000000, icon: { path: "Skill/100.img/skill/1000000/icon", width: 32, height: 32 } },
    { id: 2000000, icon: { path: "Item/test", width: 0, height: 32 } },
  ]) {
    let reads = 0;
    const assets = dialogueAssets({
      fetch: async () => {
        reads++;
        return new Response(JSON.stringify(info));
      },
      image: () => assert.fail("invalid icon preloaded"),
    });
    const runs = dialogueRuns("#i2000000#");
    assert.equal((await assets.load(runs, new AbortController().signal)).size, 0);
    assert.equal((await assets.load(runs, new AbortController().signal)).size, 0);
    assert.equal(reads, 2);
  }
});

test("an aborted metadata read cannot poison the next open with a cached rejected promise", async () => {
  let reads = 0;
  const assets = dialogueAssets({
    image: () => undefined,
    fetch: async (_url: unknown, options?: RequestInit) => {
      if (++reads === 1)
        await new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(new Error("closed")), {
            once: true,
          }),
        );
      return response(2000000);
    },
  });
  const first = new AbortController(),
    runs = dialogueRuns("#i2000000#");
  const pending = assets.load(runs, first.signal);
  first.abort();
  assert.equal((await pending).size, 0);
  assert.equal((await assets.load(runs, new AbortController().signal)).size, 1);
  assert.equal(reads, 2);
});

test("closing during PNG preloading releases the modal resource wait without creating a stale result", async () => {
  let reached!: () => void;
  const imageStarted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const assets = dialogueAssets({
    fetch: async () => response(2000000),
    image: () => {
      reached();
      return { loading: new Promise(() => {}), ready: false };
    },
  });
  const controller = new AbortController();
  const pending = assets.load(dialogueRuns("#i2000000#"), controller.signal);
  await imageStarted;
  controller.abort();
  assert.equal((await pending).size, 0);
});

test("metadata requests are bounded and a small cross-page cache evicts old successes", async () => {
  let active = 0,
    peak = 0,
    reads = 0;
  const assets = dialogueAssets({
    capacity: 2,
    concurrency: 2,
    image: () => undefined,
    fetch: async (url: unknown) => {
      reads++;
      active++;
      peak = Math.max(active, peak);
      await Promise.resolve();
      active--;
      const id = Number(String(url).split("/").at(-1));
      return new Response(
        JSON.stringify({
          id,
          name: String(id),
          icon: { path: `Item/${id}/icon`, width: 27, height: 30 },
        }),
      );
    },
  });
  const runs = dialogueRuns("#i1##i2##i3##i4#");
  assert.equal((await assets.load(runs, new AbortController().signal)).size, 4);
  assert.equal(peak, 2);
  assert.equal(reads, 4);
  await assets.load(dialogueRuns("#i1#"), new AbortController().signal);
  assert.equal(reads, 5);
});

test("500F50 name tip uses whole-font height, +8/+6 padding, and 799/599 screen boundary", () => {
  const textCalls: unknown[][] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    rect() {},
    clip() {},
    measureText() {
      return { width: 24, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 };
    },
    fillText(...args: unknown[]) {
      textCalls.push(args);
    },
  };
  drawSimpleTooltip(ctx as unknown as CanvasRenderingContext2D, 790, 590, "name");
  assert.deepEqual(textCalls, [["name", 771, 583]]);
});

test("modal source keeps stale-page guards, input preservation, one Tab stop per selection, and cleanup", () => {
  const source = readFileSync(new URL("../../client/npcdialogue.ts", import.meta.url), "utf8");
  assert.match(source, /current\s*!==\s*c\s*\|\|\s*c\.abort\.signal\.aborted/);
  assert.match(source, /c\?\.abort\.abort\(\)/);
  assert.match(source, /element\.tabIndex\s*=\s*seen\.has\(piece\.selection\)\s*\?\s*-1\s*:\s*0/);
  assert.match(source, /c\.scroll\s*=\s*Math\.max\(0,\s*Math\.min\(c\.maxScroll,\s*c\.scroll\)\)/);
  assert.match(source, /if\s*\(current\s*===\s*c\)\s*applyLayout\(c\)/);
  assert.match(source, /piece\.height\s*-\s*1,\s*piece\.width,\s*1/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});
