/** Chromium component-only integration with ORIGINAL WZ PNGs and real modal keyboard/mouse.
 * Read-only GET allowlist; no WebSocket, login, gameplay actor, account or save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";

test("native Notice/YesNo PNGs,264x132 center,65x24 controls, CRLF/shadow, FIFO/editor/focus/Tab/Escape/mouse shield, rewards/alpha/state at DPR1/2 without WS", async () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")),
    art = artProviderOf(archive),
    items = itemCatalogOf(archive);
  assert.ok(art.reader);
  assert.ok(items);
  const background = art.reader.at("UI/Basic.img/Notice/backgrnd");
  assert.ok(background && "width" in background);
  assert.deepEqual([background.width, background.height], [264, 132]);
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dirname, "fixtures/feedback-browser.ts")],
    target: "browser",
    format: "esm",
  });
  assert.equal(build.success, true);
  const script = await build.outputs[0]!.text();
  const index = await Bun.file(resolve(import.meta.dirname, "../../client/index.html")).text(),
    match = /<section\s+id="item-dialog"[\s\S]*?<\/section>/.exec(index);
  assert.ok(match, "Uses actual production modal markup");
  const css = await Bun.file(resolve(import.meta.dirname, "../../client/style.css")).text();
  const api = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    art,
    itemCatalog: items,
  });
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (request.method !== "GET") return new Response("GET only", { status: 405 });
      if (url.pathname === "/")
        return new Response(
          `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div style="position:relative;width:800px;height:600px"><canvas width="800" height="600"></canvas><div id="game-ui">${match[0]}</div><button id="outside" style="position:absolute;left:10px;top:10px">outside</button></div><script type="module">import {installFeedbackFixture} from '/fixture.js';window.feedbackFixture=installFeedbackFixture();</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url.pathname === "/fixture.js")
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/style.css")
        return new Response(css, { headers: { "content-type": "text/css" } });
      if (/^\/api\/(item\/\d+|png\/[^/]+)$/.test(url.pathname))
        return fetch(`http://127.0.0.1:${api.port}${url.pathname}`);
      if (url.pathname === "/fonts/kms-cjk.woff2")
        return new Response(
          Bun.file(resolve(import.meta.dirname, "../../client/fonts/kms-cjk.woff2")),
          { headers: { "content-type": "font/woff2" } },
        );
      return new Response("No gameplay endpoints", { status: 404 });
    },
  });
  const browser = await launchBrowser().catch(async (error: unknown) => {
    server.stop(true);
    await api.close();
    throw error;
  });
  try {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({
          deviceScaleFactor: dpr,
          viewport: { width: 900, height: 700 },
        }),
        page = await context.newPage();
      try {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
        await page.goto(`http://127.0.0.1:${server.port}`);
        await page.waitForFunction(() => !!window.feedbackFixture);
        await page.evaluate(() => window.feedbackFixture.warm());
        await page.locator("#outside").focus();
        await page.evaluate(() => {
          const f = window.feedbackFixture;
          f.receive({ t: "system-notice", type: 1, text: "a\r\nb" });
          f.receive({ t: "system-notice", type: 1, text: "second" });
        });
        const first = await page.evaluate(() => window.feedbackFixture.paint());
        assert.equal(first.open, true);
        assert.equal(first.active, "item-dialog-ok");
        assert.deepEqual(first.ok, { x: 368, y: 326, width: 65, height: 24 });
        assert.equal(first.cancelHidden, true);
        assert.equal(first.cancelDisabled, true);
        assert.deepEqual(first.chat, []);
        assert.deepEqual(
          first.draws.map((d) => [d.path, d.x, d.y, d.width, d.height]),
          [
            ["/api/png/UI/Basic.img/Notice/backgrnd", 268, 234, 264, 132],
            ["/api/png/UI/Basic.img/BtOK/mouseOver/0", 368, 326, 65, 24],
          ],
        );
        assert.deepEqual(
          first.texts.map((t) => [t.text, t.y, t.color]),
          [
            ["a", 285, "#ffffff"],
            ["a", 284, "#000000"],
            ["b", 299, "#ffffff"],
            ["b", 298, "#000000"],
          ],
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator("#item-dialog-ok").evaluate((e) => e === document.activeElement),
          true,
        );
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await page.locator("#item-dialog-ok").evaluate((e) => e === document.activeElement),
          true,
        );
        await page.mouse.click(15, 15);
        assert.equal((await page.evaluate(() => window.feedbackFixture.paint())).outsideClicks, 0);
        const restore = await page.evaluate(() => window.feedbackFixture.restoration("dialog"));
        assert.match(restore.error ?? "", /Injected/);
        assert.deepEqual([restore.alpha, restore.x, restore.y], [0.6, 7, 11]);
        await page.keyboard.press("Enter");
        const second = await page.evaluate(() => window.feedbackFixture.paint());
        assert.equal(second.open, true);
        assert.equal(second.texts.find((t) => t.color === "#000000")?.text, "second");
        await page.keyboard.press("Escape");
        assert.equal((await page.evaluate(() => window.feedbackFixture.paint())).open, false);
        assert.equal(
          await page.locator("#outside").evaluate((e) => e === document.activeElement),
          true,
        );
        await page.evaluate(() => {
          const f = window.feedbackFixture;
          f.quantity();
          f.receive({ t: "system-notice", type: 1, text: "after editor" });
          f.paint();
        });
        assert.equal(
          await page.locator("#item-quantity").evaluate((e) => e === document.activeElement),
          true,
        );
        await page.keyboard.press("Enter");
        assert.equal(
          (await page.evaluate(() => window.feedbackFixture.paint())).texts.some(
            (t) => t.text === "after editor",
          ),
          true,
        );
        await page.evaluate(() => {
          window.feedbackFixture.reset();
          window.feedbackFixture.confirm();
        });
        const yesno = await page.evaluate(() => window.feedbackFixture.paint());
        assert.equal(yesno.active, "item-dialog-cancel");
        assert.deepEqual(
          yesno.draws.map((d) => [d.x, d.y]),
          [
            [268, 234],
            [327, 326],
            [408, 326],
          ],
        );
        await page.keyboard.press("N");
        assert.equal((await page.evaluate(() => window.feedbackFixture.paint())).open, false);
        await page.evaluate(() => {
          const f = window.feedbackFixture;
          f.receive({ t: "system-notice", type: 0, text: "chat only" });
          for (let amount = 1; amount <= 7; amount++)
            f.receive({ t: "loot", notice: { kind: "mesos", amount } });
        });
        const rows = await page.evaluate(() => window.feedbackFixture.paint());
        assert.equal(rows.rows.length, 6);
        assert.deepEqual(
          rows.rows.map((r) => r.y),
          [382, 396, 410, 424, 438, 452],
        );
        assert.equal(rows.rows[0]?.text, "메소를 얻었습니다 (+2)");
        assert.deepEqual(rows.chat, ["[공지사항] chat only"]);
        await page.evaluate(() => window.feedbackFixture.time(3000));
        const half = await page.evaluate(() => window.feedbackFixture.paint());
        assert.equal(half.rows[0]?.alpha, 128 / 255);
        // Canvas stores alpha as a floating value, but it must represent native128/255 (not .5).
        assert.ok(Math.abs(half.texts[0]!.alpha - 128 / 255) < 1e-7);
        assert.equal(half.texts[0]?.color, "#000000");
        assert.equal(half.texts[1]?.color, "#ffffff");
        assert.equal(half.texts[0]?.x, 795);
        assert.equal(half.texts[1]?.x, 794);
        const screenRestore = await page.evaluate(() =>
          window.feedbackFixture.restoration("screen"),
        );
        assert.match(screenRestore.error ?? "", /Injected/);
        assert.deepEqual([screenRestore.alpha, screenRestore.x, screenRestore.y], [0.6, 7, 11]);
        await page.evaluate(() => window.feedbackFixture.time(6000));
        assert.equal((await page.evaluate(() => window.feedbackFixture.paint())).texts.length, 0);
        await page.evaluate(() => {
          const f = window.feedbackFixture;
          f.reset();
          f.receive({ t: "loot", notice: { kind: "item", itemId: 4000019, count: 2 } });
        });
        const originalName: string | undefined = items.info(4000019)?.name;
        assert.ok(originalName);
        await page.waitForFunction(
          (name) =>
            window.feedbackFixture
              .paint()
              .rows.some((r) => r.text === `아이템을 얻었습니다 (${name} 2개)`),
          originalName,
        );
        assert.equal(
          (await page.evaluate(() => window.feedbackFixture.paint())).sounds.some((s) =>
            s.includes("PickUpItem"),
          ),
          false,
          "reward notification alone is not pickup audio",
        );
        assert.equal(guard.socketAttempts, 0);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.stop(true);
    await api.close();
  }
  assert.equal(
    requests.some((r) => r.includes("/ws") || !r.startsWith("GET ")),
    false,
  );
  assert.ok(requests.some((r) => decodeURIComponent(r).includes("Notice/backgrnd")));
});
