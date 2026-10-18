/** ADR-064 Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { tooltipPreview } from "../../client/tooltip-preview.ts";

/** A source fixture, not a browser. fetch is manually resolved; no network and no game sender. */
test("read-only viewer aborts stale modes, never substitutes an instance, traps focus and clears on close/blur", async () => {
  const g = globalThis as any,
    prior = { document: g.document, window: g.window, fetch: g.fetch };
  const elements = new Map<string, any>();
  const doc: any = {
    hidden: false,
    activeElement: undefined,
    listeners: new Map(),
    addEventListener(name: string, fn: any) {
      this.listeners.set(name, fn);
    },
    getElementById: (id: string) => elements.get(id),
  };
  class Element {
    children: any[] = [];
    listeners = new Map<string, any>();
    attributes = new Map<string, string>();
    textContent = "";
    isConnected = true;
    hiddenParent = false;
    classList = { add: (_s: string) => {}, remove: (_s: string) => {} };
    addEventListener(name: string, fn: any) {
      this.listeners.set(name, fn);
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    append(child: any) {
      this.children.push(child);
    }
    contains(node: any): boolean {
      return node === this || this.children.some((child) => child.contains(node));
    }
    focus() {
      doc.activeElement = this;
    }
    blur() {
      if (doc.activeElement === this) doc.activeElement = undefined;
    }
    closest() {
      return this.hiddenParent ? this : undefined;
    }
    fire(name: string, event: any = {}) {
      this.listeners.get(name)?.(event);
    }
  }
  for (const id of [
    "tooltip-preview",
    "tooltip-preview-status",
    "tooltip-preview-choices",
    "tooltip-preview-close",
    "test-tools-toggle",
  ])
    elements.set(id, new Element());
  const root = elements.get("tooltip-preview"),
    status = elements.get("tooltip-preview-status"),
    group = elements.get("tooltip-preview-choices");
  root.children.push(group, elements.get("tooltip-preview-close"));
  doc.createElement = () => new Element();
  const windowHandlers = new Map<string, any>();
  const pending: { url: string; signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const calls: any[][] = [];
  let opens = 0,
    closes = 0;
  g.document = doc;
  g.window = { addEventListener: (name: string, fn: any) => windowHandlers.set(name, fn) };
  g.fetch = (url: string, options: { signal: AbortSignal }) =>
    new Promise((resolve) => pending.push({ url, signal: options.signal, resolve }));
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const answer = (index: number, data: unknown) =>
    pending[index]!.resolve({ ok: true, json: async () => data });
  const basic = { level: 20, str: 30, dex: 4, int: 4, luk: 4 };
  let instance: any = { itemId: 1302000, stats: { pad: 0 }, ruc: 0, cuc: 0 };
  const original = JSON.stringify(instance);
  const equipment = {
    id: 1302001,
    name: "톱",
    requirements: { level: 10, str: 0, dex: 0, int: 0, luk: 0, job: 8 },
    equipment: { ruc: 7, stats: { pad: 27 } },
  };
  const skill = {
    id: 1000000,
    name: "HP 회복력 향상",
    maxLevel: 16,
    levels: [
      { level: 1, hs: "one" },
      { level: 16, hs: "max" },
    ],
  };
  const button = (name: string) => group.children.find((node: any) => node.textContent === name);
  try {
    const hiddenOpener = new Element();
    hiddenOpener.hiddenParent = true;
    doc.activeElement = hiddenOpener;
    const viewer = tooltipPreview({
      renderer: {
        item: (...args: any[]) => calls.push(["item", ...args]),
        skill: (...args: any[]) => calls.push(["skill", ...args]),
        clear() {},
      },
      point: (e) => ({ x: e.clientX, y: e.clientY }),
      getBasic: () => basic,
      getInstance: () => instance,
      onOpen: () => {
        opens++;
      },
      onClose: () => {
        closes++;
      },
    });
    assert.equal(viewer.show("item"), true);
    assert.equal(opens, 1);
    assert.equal(viewer.show("skill0"), false);
    assert.equal(pending[0]!.url, "/api/item/2000000");
    viewer.draw();
    assert.equal(calls.length, 0);
    button("技能 0 級").fire("click");
    assert.equal(pending[0]!.signal.aborted, true);
    assert.equal(pending[1]!.url, "/api/skills/100");
    answer(0, { name: "STALE" });
    await settle();
    viewer.draw();
    assert.equal(calls.length, 0);
    answer(1, { books: [{ skills: [skill] }] });
    await settle();
    viewer.draw();
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ["skill", 400, 210]);
    assert.equal(calls.at(-1)?.at(-1), 0);
    assert.match(status.textContent, /不是角色已學等級/);
    button("技能 MAX").fire("click");
    answer(2, { books: [{ skills: [skill] }] });
    await settle();
    viewer.draw();
    assert.equal(calls.at(-1)?.at(-1), 16);
    button("持有裝備快照").fire("click");
    assert.equal(pending[3]!.url, "/api/item/1302000");
    answer(3, { ...equipment, id: 1302000 });
    await settle();
    viewer.draw();
    assert.equal(calls.at(-1)?.[4], instance);
    assert.deepEqual(calls.at(-1)?.at(-1), { template: false });
    assert.equal(calls.at(-1)?.[4].stats.pad, 0, "no WZ27 rescue for actual PAD0");
    instance = undefined;
    const requests = pending.length;
    button("持有裝備快照").fire("click");
    await settle();
    assert.equal(pending.length, requests);
    assert.match(status.textContent, /不會用 WZ 模板冒充/);
    button("需求比較值 0").fire("click");
    answer(4, equipment);
    await settle();
    viewer.draw();
    assert.deepEqual(calls.at(-1)?.[5], { level: 0, str: 0, dex: 0, int: 0, luk: 0 });
    assert.equal(basic.str, 30);
    assert.deepEqual(calls.at(-1)?.at(-1), { template: true });
    button("合成 CUC=3 標題").fire("click");
    answer(5, equipment);
    await settle();
    viewer.draw();
    assert.deepEqual(calls.at(-1)?.[4], { itemId: 1302001, stats: { pad: 27 }, ruc: 7, cuc: 3 });
    assert.deepEqual(calls.at(-1)?.at(-1), { template: false });
    assert.match(status.textContent, /不模擬卷軸/);
    assert.deepEqual(equipment.equipment, { ruc: 7, stats: { pad: 27 } });
    assert.equal(original, '{"itemId":1302000,"stats":{"pad":0},"ruc":0,"cuc":0}');
    root.focus();
    const key = (key: string, shiftKey = false) => ({
      key,
      shiftKey,
      preventDefault() {},
      stopPropagation() {},
    });
    root.fire("keydown", key("Tab", true));
    assert.equal(doc.activeElement, elements.get("tooltip-preview-close"));
    root.fire("keydown", key("Tab"));
    assert.equal(doc.activeElement, group.children[0]);
    calls.length = 0;
    windowHandlers.get("blur")();
    viewer.draw();
    assert.equal(calls.length, 0);
    root.fire("mousemove", { clientX: 700, clientY: 580 });
    viewer.draw();
    assert.deepEqual(calls.at(-1)?.slice(1, 3), [700, 600]);
    doc.hidden = true;
    doc.listeners.get("visibilitychange")();
    calls.length = 0;
    viewer.draw();
    assert.equal(calls.length, 0);
    root.fire("keydown", key("Escape"));
    assert.equal(viewer.open, false);
    assert.equal(closes, 1);
    assert.equal(
      doc.activeElement,
      elements.get("test-tools-toggle"),
      "hidden QA opener must not retain focus",
    );
    assert.equal(viewer.show("equipment"), true);
    const last = pending.length - 1;
    viewer.close(false);
    assert.equal(pending[last]!.signal.aborted, true);
    answer(last, equipment);
    await settle();
    viewer.draw();
    assert.equal(calls.length, 0, "late response cannot revive a closed viewer");
    assert.equal(closes, 2);
  } finally {
    g.document = prior.document;
    g.window = prior.window;
    g.fetch = prior.fetch;
  }
});
