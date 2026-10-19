/** Isolated original-WZ component integration; no WS, login, actor action or save. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";

test("CUIContextMenu real four PNGs89x96/111, font/alpha/state, mouse/keyboard shield, disabled gaps, focus/lifecycle/stale warm at DPR1/2 with0WS", async () => {
  const art = artProviderOf(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dirname, "fixtures/player-menu-browser.ts")],
    target: "browser",
    format: "esm",
  });
  assert.ok(build.success);
  const script = await build.outputs[0]!.text(),
    css = await Bun.file(resolve(import.meta.dirname, "../../client/style.css")).text();
  const api = await startWebClient({ host: "127.0.0.1", port: 0, loginPort: 0, art }),
    requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (request.method !== "GET") return new Response("GET only", { status: 405 });
      if (url.pathname === "/")
        return new Response(
          `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;display:block"><div style="position:relative;width:800px;height:600px"><canvas id="surface" width="800" height="600"></canvas><div id="game-ui"></div><button id="outside" style="position:absolute;left:700px;top:500px">outside</button></div><script type="module">import {installPlayerMenuFixture} from '/fixture.js';window.playerMenuFixture=installPlayerMenuFixture();</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url.pathname === "/fixture.js")
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/style.css")
        return new Response(css, { headers: { "content-type": "text/css" } });
      if (/^\/api\/png\/[^/]+$/.test(url.pathname))
        return fetch(`http://127.0.0.1:${api.port}${url.pathname}`);
      if (url.pathname === "/fonts/kms-cjk.woff2")
        return new Response(
          Bun.file(resolve(import.meta.dirname, "../../client/fonts/kms-cjk.woff2")),
          { headers: { "content-type": "font/woff2" } },
        );
      return new Response("No transport/gameplay endpoint", { status: 404 });
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
        page.setDefaultTimeout(5000);
        const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
        await page.goto(`http://127.0.0.1:${server.port}`);
        await page.waitForFunction(() => !!window.playerMenuFixture);
        assert.equal(await page.evaluate(() => window.playerMenuFixture.warm()), true);
        await page.locator("#outside").focus();
        assert.equal(await page.evaluate(() => window.playerMenuFixture.show()), true);
        let state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, true);
        assert.equal(state.active, "player-menu");
        assert.deepEqual(state.state?.layout, { x: 300, y: 304, width: 89, height: 96 });
        assert.deepEqual(state.before, state.after, "restores canvas alpha/font/fill/smoothing");
        assert.deepEqual(
          state.draws.map((d) => [d.path, d.x, d.y, d.width, d.height]),
          [
            ["/api/png/UI/UIWindow.img/ContextMenu/0", 308, 304, 81, 3],
            ["/api/png/UI/UIWindow.img/ContextMenu/1", 308, 307, 81, 15],
            ["/api/png/UI/UIWindow.img/ContextMenu/2", 308, 322, 81, 15],
            ["/api/png/UI/UIWindow.img/ContextMenu/2", 308, 337, 81, 15],
            ["/api/png/UI/UIWindow.img/ContextMenu/2", 308, 352, 81, 15],
            ["/api/png/UI/UIWindow.img/ContextMenu/2", 308, 367, 81, 15],
            ["/api/png/UI/UIWindow.img/ContextMenu/3", 300, 382, 89, 18],
          ],
        );
        assert.deepEqual(
          state.texts.map((t) => [t.text, t.x, t.y, t.color]),
          [
            ["상대이름", 313, 309, "#ffffff"],
            ["개인정보", 313, 324, "#404040"],
            ["인기도 +", 313, 339, "#000000"],
            ["인기도 -", 313, 354, "#000000"],
            ["귓속말", 313, 369, "#000000"],
            ["교환신청", 313, 384, "#404040"],
          ],
        );
        assert.equal(await page.locator('[data-action="info"]:disabled').count(), 1);
        assert.equal(await page.locator('[data-action="trade"]:disabled').count(), 1);
        const before = await page.evaluate(() => window.playerMenuFixture.pixel(383, 345));
        await page.mouse.move(320, 344);
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.state?.selected, 2);
        assert.equal(state.texts[2]?.color, "#ffffff");
        const after = await page.evaluate(() => window.playerMenuFixture.pixel(383, 345));
        for (let channel = 0; channel < 3; channel++)
          assert.ok(
            Math.abs(after[channel]! - before[channel]! / 2) <= 1,
            `native black alpha128 channel${channel}`,
          );
        await page.mouse.click(320, 344, { button: "right" });
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, true, "52E6F0 ignores right-button clicks inside capture");
        assert.equal(state.actions.length, 0);
        // Native sticky highlight remains on gaps, but disabled/gap release NEVER sends an old action.
        await page.mouse.move(302, 350);
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.state?.selected, 2);
        await page.mouse.click(320, 328);
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false);
        assert.equal(state.actions.length, 0);
        assert.equal(state.canvasClicks, 0);
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.mouse.click(320, 344);
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false);
        assert.deepEqual(
          state.actions.map((a) => a.action),
          ["fameUp"],
        );
        await page.locator("#outside").click();
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.outside, 1, "normal next click is not swallowed");
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.mouse.click(720, 510);
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false);
        assert.equal(state.outside, 1, "dismissal does not click through");
        await page.locator("#outside").click();
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.outside, 2);
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.deepEqual(
          state.actions.map((a) => a.action),
          ["fameUp", "fameDown"],
        );
        assert.equal(state.keys, 0);
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.mouse.click(720, 510, { button: "right" });
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false, "outside right-button cancels capture");
        await page.evaluate(() => window.playerMenuFixture.show(true));
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.state?.layout.height, 111);
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.actions.at(-1)?.action, "invite");
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Enter");
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.actions.at(-1)?.action, "whisper");
        await page.evaluate(() => window.playerMenuFixture.verified(false));
        await page.evaluate(() => window.playerMenuFixture.show(true));
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.state?.rows.at(-1)?.enabled, false);
        assert.equal(await page.locator('[data-action="invite"]:disabled').count(), 1);
        const actionCount = state.actions.length;
        await page.mouse.click(320, 388);
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(
          state.actions.length,
          actionCount,
          "unverified native world's disabled invite sends nothing",
        );
        await page.evaluate(() => window.playerMenuFixture.verified(true));
        await page.locator("#outside").focus();
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.keyboard.press("Escape");
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.active, "outside");
        assert.equal(state.open, false);
        assert.equal(await page.evaluate(() => window.playerMenuFixture.stale()), false);
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.evaluate(() => window.playerMenuFixture.blocked(true));
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false);
        await page.evaluate(() => window.playerMenuFixture.blocked(false));
        await page.evaluate(() => window.playerMenuFixture.show());
        await page.evaluate(() => window.playerMenuFixture.valid(false));
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false);
        await page.evaluate(() => window.playerMenuFixture.valid(true));
        await page.evaluate(() => window.playerMenuFixture.show(false, 799, 0));
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.deepEqual(state.state?.layout, { x: 711, y: 0, width: 89, height: 96 });
        // Real DOM focus transition (Element.focus), not a fabricated window blur event.
        await page.locator("#outside").focus();
        state = await page.evaluate(() => window.playerMenuFixture.paint());
        assert.equal(state.open, false);
        assert.deepEqual(state.errors, []);
        assert.deepEqual(errors, []);
        assert.equal(state.canvasClicks, 0);
        assert.equal(guard.socketAttempts, 0);
      } finally {
        await context.close();
      }
    }
    assert.ok(requests.some((request) => request.includes("ContextMenu%2F0")));
    assert.ok(requests.every((request) => request.startsWith("GET ")));
  } finally {
    await browser.close();
    server.stop(true);
    await api.close();
  }
});
