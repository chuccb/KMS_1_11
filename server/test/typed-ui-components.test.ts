import { test } from "node:test";
import assert from "node:assert/strict";
import { systemMenu } from "../../client/systemmenu.ts";
import { itemDialogs } from "../../client/itemdialogs.ts";
import { npcDialogue } from "../../client/npcdialogue.ts";
import { reviveWindow, REVIVE_DELAY_MS } from "../../client/revive.ts";
import { characterDialogs } from "../../client/creation.ts";
import { soundSettings, SOUND_DEFAULTS } from "../../client/systemsettings.ts";
import type { QuestReply } from "../src/protocol/quest.ts";
import { uiFixture, fixtureEvent } from "./helpers/ui-fixture.ts";
import { statWindow } from "../../client/statwindow.ts";
import { gameElements } from "../../client/game-dom.ts";
const audio = { effect() {} };

test("typed settings controls keep sound/game drafts separate, preview immediately, cancel and persist explicitly", () => {
  const f = uiFixture();
  try {
    let settings = { ...SOUND_DEFAULTS },
      minimap = true,
      quits = 0;
    const menu = systemMenu({
      ctx: f.ctx,
      image: f.image,
      point: (event) => ({ x: event.clientX, y: event.clientY }),
      audio: {
        ...audio,
        applySettings(value: unknown) {
          settings = soundSettings(value);
        },
        get settings() {
          return { ...settings };
        },
      },
      canOpen: () => true,
      onOpen() {},
      onQuit() {
        quits++;
      },
      onGameSettings(value) {
        minimap = value.minimap;
      },
    });
    const sound = () => {
      assert.equal(menu.open(), true);
      f.menuButton("系統設定").click();
    };
    sound();
    f.menuButton("背景音樂音量").focus();
    f.key("ArrowLeft");
    assert.equal(settings.bgm, 14);
    assert.equal(settings.effects, 15);
    f.menuButton("背景音樂靜音").click();
    assert.equal(settings.bgmMuted, true);
    f.menuButton("取消並還原").click();
    assert.deepEqual(settings, SOUND_DEFAULTS);
    assert.equal(f.storage.getItem("kms111.soundSettings"), null);
    sound();
    f.menuButton("背景音樂音量").focus();
    f.key("End");
    f.menuButton("確定並保存").click();
    assert.equal(settings.bgm, 19);
    assert.deepEqual(JSON.parse(f.storage.getItem("kms111.soundSettings")!), {
      ...SOUND_DEFAULTS,
      bgm: 19,
    });
    assert.equal(menu.open(), true);
    f.menuButton("遊戲設定（小地圖／悄悄話）").click();
    f.menuButton("顯示小地圖").click();
    assert.equal(minimap, false);
    f.menuButton("取消並還原").click();
    assert.equal(minimap, true);
    assert.equal(settings.bgm, 19);
    assert.equal(menu.open(), true);
    f.menuButton("遊戲設定（小地圖／悄悄話）").click();
    f.menuButton("顯示小地圖").click();
    f.menuButton("確定並保存").click();
    assert.equal(menu.gameSettings.minimap, false);
    menu.setMiniMap(true);
    assert.equal(menu.gameSettings.minimap, true);
    assert.equal(menu.open(), true);
    f.menuButton("離開目前連線並回到登入畫面").click();
    assert.equal(quits, 1);
  } finally {
    f.restore();
  }
});

test("typed text/quantity/confirmation states validate their own value types and never accept on cancel", () => {
  const f = uiFixture();
  try {
    const accepted: (number | string)[] = [];
    let rejected = 0;
    const dialog = itemDialogs({ ctx: f.ctx, image: f.image, audio });
    dialog.text({
      text: "name",
      initial: "",
      validate: (value) => (value.length < 3 ? "too short" : undefined),
      accept: (value) => accepted.push(value),
      reject: () => rejected++,
    });
    f.get("item-quantity").value = "a";
    f.key("Enter");
    assert.equal(dialog.open, true);
    assert.equal(f.get("item-quantity").validationMessage, "too short");
    f.get("item-quantity").value = " hello ";
    f.key("Enter");
    assert.deepEqual([...accepted], ["hello"]);
    assert.equal(rejected, 0);
    assert.equal(dialog.open, false);
    dialog.quantity({
      text: "quantity",
      initial: 1,
      max: 5,
      accept: (value) => accepted.push(value),
    });
    f.get("item-quantity").value = "3.2";
    f.key("Enter");
    assert.equal(dialog.open, true);
    f.get("item-quantity").value = "2";
    f.key("Enter");
    assert.deepEqual([...accepted], ["hello", 2]);
    dialog.confirm({
      text: "delete?",
      accept: (value) => accepted.push(value),
      reject: () => rejected++,
    });
    assert.equal(f.document.activeElement, f.get("item-dialog-cancel"));
    f.key("Enter");
    assert.deepEqual([...accepted], ["hello", 2]);
    assert.equal(rejected, 1);
    dialog.confirm({ text: "delete?", accept: (value) => accepted.push(value) });
    f.get("item-dialog-ok").click();
    assert.deepEqual([...accepted], ["hello", 2, 1]);
  } finally {
    f.restore();
  }
});

test("fully initialized dialogue layout preserves menu replies, numeric validation and capped editor geometry", () => {
  const f = uiFixture();
  try {
    const replies: QuestReply[] = [];
    const dialog = npcDialogue({
      ctx: f.ctx,
      image: f.image,
      audio,
      point: (event) => ({ x: event.clientX, y: event.clientY }),
      onOpen() {},
      onReply: (reply) => replies.push(reply),
    });
    assert.equal(dialog.show(1, { kind: "menu", message: "#L1#One#l\n#L2#Two#l" }), true);
    dialog.draw();
    f.key("Enter");
    assert.deepEqual(replies, [{ kind: "menu", answer: 1, value: 1 }]);
    dialog.show(1, { kind: "askNumber", message: "1–5", defaultValue: 1, min: 1, max: 5 });
    f.get("dialogue-input").value = "99";
    f.key("Enter");
    assert.equal(dialog.open, true);
    assert.notEqual(f.get("dialogue-input").validationMessage, "");
    f.get("dialogue-input").value = "4";
    f.key("Enter");
    assert.deepEqual(replies[1], { kind: "askNumber", answer: 1, value: 4 });
    dialog.show(1, {
      kind: "askText",
      message: "original\n".repeat(60),
      defaultText: "",
      minLength: 0,
      maxLength: 12,
    });
    dialog.draw();
    f.key("PageDown");
    dialog.draw();
    for (const draw of f.draws)
      for (const value of draw.args)
        if (typeof value === "number") assert.equal(Number.isFinite(value), true, draw.kind);
    f.key("Escape");
    assert.deepEqual(replies[2], { kind: "askText", answer: 0 });
    dialog.show(1, { kind: "say", message: "original" });
    f.key("Escape");
    assert.deepEqual(replies[3], { kind: "say", answer: 255 });
  } finally {
    f.restore();
  }
});

test("revive observes authoritative HP and the strict 2200ms boundary; only emits a request, including timeout retry", () => {
  const f = uiFixture();
  try {
    const sent: { t: "revive" }[] = [];
    let opens = 0;
    const dialog = reviveWindow({
      ctx: f.ctx,
      image: f.image,
      send: (message) => sent.push(message),
      isInGame: () => true,
      onOpen: () => opens++,
    });
    f.time(100);
    dialog.receive({ t: "self", self: { hp: 0 } });
    dialog.draw(100 + REVIVE_DELAY_MS);
    assert.equal(dialog.open, false);
    f.time(101 + REVIVE_DELAY_MS);
    dialog.draw(101 + REVIVE_DELAY_MS);
    assert.equal(dialog.open, true);
    assert.equal(opens, 1);
    f.get("revive-ok").click();
    assert.equal(sent.length, 1);
    assert.equal(f.get("revive-ok").disabled, true);
    f.time(101 + REVIVE_DELAY_MS + 5001);
    dialog.draw(101 + REVIVE_DELAY_MS + 5001);
    f.get("revive-ok").click();
    assert.equal(sent.length, 2);
    dialog.receive({ t: "self", self: { hp: 1 } });
    assert.equal(dialog.open, false);
    assert.deepEqual(sent, [{ t: "revive" }, { t: "revive" }]);
  } finally {
    f.restore();
  }
});

test("creation checks the real catalogue shape and captures the confirmed character id, using mocked sends only", async () => {
  const f = uiFixture();
  try {
    const groups = Array.from({ length: 6 }, (_, index) => [
      { id: index + 100, name: `original-${index}` },
    ]);
    f.respond("/api/creation", { male: groups, female: groups, forbidden: [] });
    const sent: Parameters<Parameters<typeof characterDialogs>[0]["send"]>[0][] = [];
    let selected = { id: 1, name: "first" };
    const dialog = characterDialogs({
      ctx: f.ctx,
      image: f.image,
      avatar: () => ({ ...f.image("original"), dx: 0, dy: 0 }),
      send: (request) => sent.push(request),
      audio,
      busy() {},
      getSelected: () => selected,
      isCharacterStage: () => true,
    });
    await dialog.openCreate();
    assert.equal(dialog.open, true);
    f.get("native-ok").click();
    dialog.draw(0);
    f.get("new-name").value = "name";
    f.get("check-name").click();
    assert.equal(sent.length, 1);
    const check = sent[0];
    assert.equal(check.t, "check-name");
    assert.deepEqual(check, { t: "check-name", name: "name" });
    dialog.receive({ t: "name-checked", name: "name", result: 0 });
    f.get("native-ok").click();
    f.get("create-cancel").click();
    dialog.openDelete();
    selected = { id: 2, name: "second" };
    f.get("native-yes").click();
    assert.deepEqual(sent[1], { t: "delete-character", id: 1, confirmed: true });
  } finally {
    f.restore();
  }
});

test("stat window uses the actual HTML button as its drag surface without aborting application startup", () => {
  const f = uiFixture();
  try {
    assert.equal(f.get("stat-body").localName, "button");
    const panel = statWindow({
      ctx: f.ctx,
      image: f.image,
      audio,
      send() {},
      getSelf: () => undefined,
      isInGame: () => false,
      point: (event) => ({ x: event.clientX, y: event.clientY }),
      jobName: () => "",
      log() {},
    });
    panel.toggle(true);
    f.get("stat-body").dispatchEvent(fixtureEvent("mousedown", { clientX: 80, clientY: 80 }));
    f.window.dispatchEvent(fixtureEvent("mousemove", { clientX: 100, clientY: 110 }));
    f.window.dispatchEvent(fixtureEvent("mouseup"));
    assert.deepEqual(JSON.parse(f.storage.getItem("kms111.statAt")!), { x: 92, y: 102 });
    panel.toggle(false);
  } finally {
    f.restore();
  }
});

test("shared game DOM schema resolves actual HTML tags without unchecked main-entry casts", () => {
  const f = uiFixture();
  try {
    const { canvas, ui } = gameElements();
    assert.equal(canvas.id, "view");
    assert.equal(ui.connect.localName, "section");
    assert.equal(ui.characters.localName, "section");
    assert.equal(ui.chatLines.localName, "ol");
    assert.equal(ui.log.localName, "aside");
    assert.equal(ui.login.localName, "button");
    assert.equal(ui.user.localName, "input");
    assert.equal(Object.keys(ui).length, 22);
  } finally {
    f.restore();
  }
});
