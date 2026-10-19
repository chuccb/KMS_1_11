import test from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import { readSystemNotice, encodeSystemNotice } from "../src/protocol/notice.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import {
  readFeedbackEvent,
  lootText,
  experienceText,
  screenMessagePool,
  nativeScreenAlpha,
  basicDialogLines,
  basicDialogTextY,
} from "../../client/feedback-data.ts";
import { gameFeedback, FEEDBACK_LIMITS, type FeedbackDialog } from "../../client/feedback.ts";
import { itemDialogs } from "../../client/itemdialogs.ts";
import { drawScreenMessages } from "../../client/feedback-renderer.ts";
import { uiFixture, fixtureEvent } from "./helpers/ui-fixture.ts";
import { beginDropPickup, createDropRecord } from "../../client/drop-presentation.ts";
const self = { characterId: 91, level: 1, exp: 10 };
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
function setup() {
  let now = 0,
    blocked = false,
    open = false,
    callback: { accept(n: number): void; reject(): void } | undefined;
  const chats: string[] = [],
    shown: string[] = [],
    errors: unknown[] = [],
    lookups = new Map<number, ReturnType<typeof deferred>>();
  const dialog: FeedbackDialog = {
    get open() {
      return open;
    },
    notice(options) {
      if (open) return false;
      open = true;
      shown.push(options.text);
      callback = options;
      return true;
    },
    close() {
      open = false;
      callback?.reject();
    },
  };
  const feedback = gameFeedback({
    dialog,
    now: () => now,
    blocked: () => blocked,
    chat: (text) => chats.push(text),
    onError: (error) => errors.push(error),
    item: (id) => {
      const task = deferred();
      lookups.set(id, task);
      return task.promise;
    },
  });
  return {
    feedback,
    chats,
    shown,
    errors,
    lookups,
    dialog,
    setTime(t: number) {
      now = t;
    },
    block(b: boolean) {
      blocked = b;
    },
    accept() {
      open = false;
      callback?.accept(1);
    },
  };
}
test("55CDE0: exact CP9490/1 bytes, every unknown type consumes its full string, every truncation fails", () => {
  for (let type = 0; type < 256; type++) {
    const text = encodeCp949("가나"),
      bytes = Uint8Array.of(type, 4, 0, ...text, 0x7f),
      reader = new PacketReader(bytes);
    assert.deepEqual(readSystemNotice(reader), { type, text });
    assert.equal(reader.remaining, 1);
    assert.equal(reader.readByte(), 0x7f);
    for (let n = 0; n < bytes.length - 1; n++)
      assert.throws(() => readSystemNotice(new PacketReader(bytes.slice(0, n))));
  }
  assert.equal(
    Buffer.from(encodeSystemNotice(encodeCp949("가나"), 1)).toString("hex"),
    "13010400b0a1b3aa",
  );
  assert.equal(
    Buffer.from(encodeSystemNotice(encodeCp949("hello"))).toString("hex"),
    "1300050068656c6c6f",
  );
});
test("strict JSON feedback projection rejects coercion, malformed unions and out-of-wire fields", () => {
  for (const value of [null, {}, [], { t: "unrelated" }])
    assert.equal(readFeedbackEvent(value), undefined);
  for (const notice of [
    { kind: "item", itemId: "1", count: 2 },
    { kind: "mesos", amount: -1 },
    { kind: "item", itemId: 1, count: NaN },
    { kind: "mesos", amount: 2 ** 32 },
    { kind: "unknown" },
  ])
    assert.throws(() => readFeedbackEvent({ t: "loot", notice }));
  for (const bad of [
    { t: "system-notice", text: "x" },
    { t: "system-notice", type: 2, text: "x" },
    { t: "system-notice", type: 1, text: {} },
    { t: "self", self: {} },
    { t: "field", self: { ...self, level: 0 } },
    { t: "self", self: { ...self, exp: "10" } },
    { t: "self", self: { ...self, characterId: 1.1 } },
    { t: "self", self: { ...self, level: 256 } },
  ])
    assert.throws(() => readFeedbackEvent(bad));
  assert.deepEqual(
    readFeedbackEvent({ t: "loot", notice: { kind: "mesos", amount: 0xffffffff }, ignored: true }),
    { t: "loot", notice: { kind: "mesos", amount: 0xffffffff } },
  );
});
test("55C130 exact Korean lines, signed%d bit patterns, singular0/1, absent names never become IDs", () => {
  assert.equal(lootText({ kind: "mesos", amount: 15 }), "메소를 얻었습니다 (+15)");
  assert.equal(lootText({ kind: "mesos", amount: 0xffffffff }), "메소를 얻었습니다 (+-1)");
  assert.equal(lootText({ kind: "rejected" }), "아이템을 더 이상 가질 수 없습니다");
  for (const count of [0, 1, 0xffffffff])
    assert.equal(lootText({ kind: "item", itemId: 1, count }, "가"), "아이템을 얻었습니다 (가)");
  assert.equal(
    lootText({ kind: "item", itemId: 1, count: 2 }, "가"),
    "아이템을 얻었습니다 (가 2개)",
  );
  for (const name of [undefined, ""])
    assert.equal(lootText({ kind: "item", itemId: 4000019, count: 5 }, name), undefined);
});
test("55BEB0 same-level positive EXP only; no initial, decrease, level transition or other character toast", () => {
  assert.equal(experienceText(self, { ...self, exp: 15 }), "경험치를 얻었습니다 (+5)");
  for (const before of [
    undefined,
    { ...self, exp: 15 },
    { ...self, exp: 20 },
    { ...self, level: 2 },
    { ...self, characterId: 92 },
  ])
    assert.equal(experienceText(before, { ...self, exp: 15 }), undefined);
});
test("4EB080/4EB440/4EBA30 six290x14 bottom-filled pool, rotation, stable expired slots, original-order late insertion", () => {
  const pool = screenMessagePool();
  pool.put({ order: 1, text: "1", at: 0 });
  assert.deepEqual(
    pool.rows(0).map((r) => [r.x, r.y, r.alpha]),
    [[504, 452, 1]],
  );
  for (let order = 2; order <= 6; order++)
    pool.put({ order, text: String(order), at: order * 1000 });
  assert.deepEqual(
    pool.rows(1000).map((r) => r.y),
    [382, 396, 410, 424, 438, 452],
  );
  assert.equal(pool.rows(6000)[0]?.alpha, 0);
  assert.equal(pool.rows(6000).length, 6);
  pool.put({ order: 7, text: "7", at: 6000 });
  assert.deepEqual(
    pool.rows(6000).map((r) => r.order),
    [2, 3, 4, 5, 6, 7],
  );
  pool.put({ order: 1, text: "stale", at: 0 });
  assert.deepEqual(
    pool.rows(6000).map((r) => r.order),
    [2, 3, 4, 5, 6, 7],
  );
  pool.put({ order: 5, text: "replacement", at: 100 });
  assert.equal(pool.rows(6000).length, 6);
  pool.clear();
  assert.deepEqual(pool.rows(6000), []);
});
test("Shape2D 10011030->10010AD0->10010C40 uses signed integer linear interpolation, not floating or hold-then-fade", () => {
  for (const [ms, alpha] of [
    [-1, 255],
    [0, 255],
    [1, 255],
    [24, 254],
    [3000, 128],
    [5999, 1],
    [6000, 0],
    [10000, 0],
  ])
    assert.equal(nativeScreenAlpha(ms!), alpha! / 255);
});
test("525880/52C4C0 explicit CRLF preserves empty rows, no word wrap; 14px centered line band", () => {
  assert.deepEqual(basicDialogLines(""), [""]);
  assert.deepEqual(basicDialogLines("a\r\nb\r\n"), ["a", "b", ""]);
  assert.deepEqual(basicDialogLines("a\nb"), ["a\nb"]);
  assert.equal(basicDialogLines("x".repeat(500)).length, 1);
  assert.deepEqual([1, 2, 3, 4].map(basicDialogTextY), [57, 50, 43, 37]);
});
test("feedback0 goes only to native notice chat, rewards/EXP only to screen pool; field seeds comparison", () => {
  const f = setup();
  f.feedback.receive({ t: "field", self });
  f.feedback.receive({ t: "self", self: { ...self, exp: 15 } });
  f.feedback.receive({ t: "system-notice", type: 0, text: "hello" });
  f.feedback.receive({ t: "loot", notice: { kind: "mesos", amount: 20 } });
  f.feedback.receive({ t: "loot", notice: { kind: "rejected" } });
  assert.deepEqual(f.chats, ["[공지사항] hello"]);
  assert.deepEqual(
    f.feedback.rows(0).map((r) => r.text),
    ["경험치를 얻었습니다 (+5)", "메소를 얻었습니다 (+20)", "아이템을 더 이상 가질 수 없습니다"],
  );
  f.feedback.receive({ t: "field", self: { ...self, exp: 0 } });
  assert.equal(f.feedback.rows(0).length, 3, "settled singleton screen rows survive field change");
  f.feedback.receive({ t: "self", self: { ...self, exp: 2 } });
  assert.equal(f.feedback.rows(0).at(-1)?.text, "경험치를 얻었습니다 (+2)");
  for (const t of ["login", "disconnect"]) {
    f.feedback.receive({ t });
    assert.deepEqual(f.feedback.rows(0), []);
  }
});
test("type1 queues behind existing modal/blockers, FIFO one-at-a-time, close/cancel and disconnect invalidate ownership", () => {
  const f = setup();
  f.dialog.notice({ text: "editor", accept() {}, reject() {} });
  for (const text of ["one", "two"]) f.feedback.receive({ t: "system-notice", type: 1, text });
  f.feedback.tick();
  assert.deepEqual(f.shown, ["editor"]);
  f.dialog.close();
  f.block(true);
  f.feedback.tick();
  assert.equal(f.shown.length, 1);
  f.block(false);
  f.feedback.tick();
  f.feedback.tick();
  assert.deepEqual(f.shown, ["editor", "one"]);
  f.accept();
  f.feedback.tick();
  assert.deepEqual(f.shown, ["editor", "one", "two"]);
  f.feedback.receive({ t: "disconnect" });
  assert.equal(f.dialog.open, false);
  f.feedback.tick();
  assert.equal(f.shown.length, 3);
  f.dialog.notice({ text: "unrelated", accept() {}, reject() {} });
  f.feedback.reset();
  assert.equal(f.dialog.open, true, "does not close another owner's modal");
});
test("notice queue has explicit browser-only bound; dispose cancels without opening next or accepting", () => {
  const f = setup();
  for (let n = 0; n < FEEDBACK_LIMITS.notices; n++)
    f.feedback.receive({ t: "system-notice", type: 1, text: String(n) });
  assert.throws(
    () => f.feedback.receive({ t: "system-notice", type: 1, text: "overflow" }),
    /overflow/,
  );
  f.feedback.tick();
  assert.equal(f.shown.length, 1);
  f.feedback.dispose();
  f.feedback.dispose();
  f.feedback.tick();
  assert.equal(f.dialog.open, false);
  assert.equal(f.shown.length, 1);
  assert.equal(f.feedback.receive({ t: "loot", notice: { kind: "rejected" } }), false);
});
test("async names resolve out of order in receive order, missing never shifts slots, original6000ms deadline is not restarted", async () => {
  const f = setup();
  for (const itemId of [1, 2, 3])
    f.feedback.receive({ t: "loot", notice: { kind: "item", itemId, count: 2 } });
  await settle();
  f.lookups.get(2)!.resolve({ name: "two" });
  f.lookups.get(3)!.resolve({ name: "" });
  await settle();
  assert.equal(f.feedback.rows(0).length, 1);
  f.setTime(3000);
  f.lookups.get(1)!.resolve({ name: "one" });
  await settle();
  assert.deepEqual(
    f.feedback.rows(3000).map((r) => r.text),
    ["아이템을 얻었습니다 (one 2개)", "아이템을 얻었습니다 (two 2개)"],
  );
  assert.equal(f.feedback.rows(3000)[0]?.at, 0);
  assert.equal(f.feedback.rows(3000)[0]?.alpha, 128 / 255);
  f.feedback.receive({ t: "loot", notice: { kind: "item", itemId: 4, count: 1 } });
  await settle();
  f.setTime(9000);
  f.lookups.get(4)!.resolve({ name: "late" });
  await settle();
  assert.equal(f.feedback.rows(9000).length, 2);
});
test("bounded pending names, failures, malformed metadata and lifecycle generations cannot resurrect stale field/account rows", async () => {
  const f = setup();
  for (let itemId = 1; itemId <= 7; itemId++)
    f.feedback.receive({ t: "loot", notice: { kind: "item", itemId, count: 1 } });
  await settle();
  assert.equal(f.lookups.has(1), false, "evicted before microtask never starts network");
  f.lookups.get(2)!.resolve({ name: 123 });
  f.lookups.get(3)!.reject(Error("network"));
  await settle();
  assert.deepEqual(f.feedback.rows(0), []);
  assert.equal(f.errors.length, 1);
  f.feedback.receive({ t: "field", self });
  for (const id of [4, 5, 6, 7]) f.lookups.get(id)!.resolve({ name: "old field" });
  await settle();
  assert.deepEqual(f.feedback.rows(0), []);
  f.feedback.receive({ t: "loot", notice: { kind: "item", itemId: 8, count: 1 } });
  await settle();
  f.feedback.dispose();
  f.lookups.get(8)!.resolve({ name: "old account" });
  await settle();
  assert.deepEqual(f.feedback.rows(0), []);
});
test("52B8B0 Notice/OK native center268,234 and button100,92; one target, Tab trap, repeat guard, native text/shadow, safe Escape/focus", () => {
  const f = uiFixture();
  try {
    let accepted = 0,
      rejected = 0;
    const sounds: string[] = [],
      paths: string[] = [];
    const dialog = itemDialogs({
      ctx: f.ctx,
      image: (path) => {
        paths.push(path);
        return f.image(path);
      },
      audio: {
        effect(path) {
          sounds.push(path);
        },
      },
    });
    f.get("item-quantity").focus();
    assert.equal(
      dialog.notice({
        text: "a\r\nb",
        accept() {
          accepted++;
        },
        reject() {
          rejected++;
        },
      }),
      true,
    );
    const ok = f.get("item-dialog-ok"),
      cancel = f.get("item-dialog-cancel");
    assert.equal(f.document.activeElement, ok);
    assert.equal(cancel.classList.contains("hidden"), true);
    assert.equal(ok.style.left, "368px");
    assert.equal(ok.style.top, "326px");
    assert.equal(
      dialog.confirm({
        text: "cannot steal",
        accept() {
          accepted++;
        },
      }),
      false,
    );
    f.key("Tab");
    assert.equal(f.document.activeElement, ok);
    f.window.dispatchEvent(fixtureEvent("keydown", { key: "Tab", shiftKey: true }));
    assert.equal(f.document.activeElement, ok);
    f.window.dispatchEvent(fixtureEvent("keydown", { key: "Enter", repeat: true }));
    assert.equal(accepted, 0);
    dialog.draw();
    assert.deepEqual(paths, ["UI/Basic.img/Notice/backgrnd", "UI/Basic.img/BtOK/mouseOver/0"]);
    assert.deepEqual(
      f.draws.filter((d) => d.kind === "fillText").map((d) => d.args),
      [
        ["a", 398, 285],
        ["a", 397, 284],
        ["b", 398, 299],
        ["b", 397, 298],
      ],
    );
    f.key("Enter");
    assert.equal(accepted, 1);
    assert.equal(dialog.open, false);
    assert.equal(f.document.activeElement, f.get("item-quantity"));
    dialog.notice({
      text: "cancel",
      accept() {
        accepted++;
      },
      reject() {
        rejected++;
      },
    });
    f.key("Escape");
    assert.equal(accepted, 1);
    assert.equal(rejected, 1);
    assert.deepEqual(sounds, ["UI/DlgNotice", "UI/DlgNotice"]);
  } finally {
    f.restore();
  }
});
test("52BE10 Yes/No exact native59/140 buttons, Y/N shortcuts, retains explicit cancel-first browser safety, editing hidden state reset", () => {
  const f = uiFixture();
  try {
    let accepted = 0,
      rejected = 0;
    const dialog = itemDialogs({ ctx: f.ctx, image: f.image, audio: { effect() {} } });
    dialog.notice({ text: "notice", accept() {} });
    dialog.close();
    dialog.confirm({
      text: "yes?",
      accept() {
        accepted++;
      },
      reject() {
        rejected++;
      },
    });
    assert.equal(f.get("item-dialog-cancel").classList.contains("hidden"), false);
    assert.equal(f.get("item-dialog-ok").style.left, "327px");
    assert.equal(f.get("item-dialog-cancel").style.left, "408px");
    assert.equal(f.document.activeElement, f.get("item-dialog-cancel"));
    f.key("y");
    assert.equal(accepted, 1);
    dialog.confirm({
      text: "no?",
      accept() {
        accepted++;
      },
      reject() {
        rejected++;
      },
    });
    f.key("N");
    assert.equal(accepted, 1);
    assert.equal(rejected, 1);
    dialog.quantity({ text: "qty", initial: 1, max: 5, accept() {} });
    assert.equal(f.get("item-quantity").classList.contains("hidden"), false);
    assert.equal(f.get("item-dialog-cancel").classList.contains("hidden"), false);
    dialog.close();
  } finally {
    f.restore();
  }
});
test("screen renderer clips native rows, shadow then foreground at right794; no expired paint", () => {
  const f = uiFixture();
  try {
    const pool = screenMessagePool();
    pool.put({ order: 1, text: "reward", at: 0 });
    drawScreenMessages(f.ctx, pool.rows(0));
    assert.deepEqual(
      f.draws.filter((d) => d.kind === "rect").map((d) => d.args),
      [[504, 452, 290, 14]],
    );
    assert.deepEqual(
      f.draws.filter((d) => d.kind === "fillText").map((d) => d.args),
      [
        ["reward", 795, 453],
        ["reward", 794, 452],
      ],
    );
    f.draws.length = 0;
    drawScreenMessages(f.ctx, pool.rows(6000));
    assert.equal(f.draws.length, 0);
  } finally {
    f.restore();
  }
});
test("4A95B0/0x44 pickup begins once; duplicate removals cannot replay self pickup sound", () => {
  const record = createDropRecord({ kind: 2, dropId: 1, money: true, value: 10, x: 50, y: 100 }, 0);
  assert.ok(record);
  assert.equal(beginDropPickup(record, 1, 91), true);
  assert.equal(beginDropPickup(record, 2, 91), false);
  assert.equal(record.takenAt, 1);
  assert.equal(record.takenBy, 91);
});

test("disposal/field/overflow/deadline before lookup microtask does not start stale I/O; synchronous loader errors remain observable", async () => {
  for (const end of ["dispose", "field", "deadline"] as const) {
    const f = setup();
    f.feedback.receive({ t: "loot", notice: { kind: "item", itemId: 1, count: 1 } });
    if (end === "dispose") f.feedback.dispose();
    else if (end === "field") f.feedback.receive({ t: "field", self });
    else f.setTime(6000);
    await settle();
    assert.equal(f.lookups.size, 0);
    assert.deepEqual(f.feedback.rows(6000), []);
  }
  const errors: unknown[] = [];
  const feedback = gameFeedback({
    now: () => 0,
    blocked: () => false,
    chat() {},
    onError: (error) => errors.push(error),
    item() {
      throw Error("sync loader");
    },
    dialog: {
      open: false,
      notice() {
        return false;
      },
      close() {},
    },
  });
  feedback.receive({ t: "loot", notice: { kind: "item", itemId: 1, count: 1 } });
  await settle();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /sync loader/);
  assert.deepEqual(feedback.rows(0), []);
});
