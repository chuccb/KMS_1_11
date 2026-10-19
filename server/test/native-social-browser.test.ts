/** Chromium component-only integration with ORIGINAL WZ PNGs and real modal keyboard/mouse.
 * Read-only GET allowlist; no WebSocket, login, gameplay actor, account or save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";

test("native social edit and owned Yes/No lifecycle: original HTML/PNG, IME, focus, ShiftEnter, private consumption, membership/cancel/busy at DPR1/2 with0WS", async () => {
  const art = artProviderOf(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dirname, "fixtures/social-browser.ts")],
    target: "browser",
    format: "esm",
  });
  assert.equal(build.success, true);
  const script = await build.outputs[0]!.text();
  const index = await Bun.file(resolve(import.meta.dirname, "../../client/index.html")).text(),
    match = /<section\s+id="item-dialog"[\s\S]*?<\/section>/.exec(index);
  assert.ok(match, "Uses actual production modal markup");
  const edit = /<input\s+id="say"[\s\S]*?\/>/.exec(index);
  assert.ok(edit);
  const css = await Bun.file(resolve(import.meta.dirname, "../../client/style.css")).text();
  const api = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    art,
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
          `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div style="position:relative;width:800px;height:600px"><canvas id="view" width="800" height="600"></canvas><div id="game-ui">${match[0]}<div class="chat-edit">${edit[0]}</div></div><button id="outside" style="position:absolute;left:10px;top:10px">outside</button></div><script type="module">import {installSocialFixture} from '/fixture.js';window.socialFixture=installSocialFixture();</script></body></html>`,
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
        page.on("pageerror", (e) => errors.push(e.message));
        const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
        await page.goto(`http://127.0.0.1:${server.port}`);
        await page.waitForFunction(() => !!window.socialFixture);
        await page.evaluate(() => window.socialFixture.warm());
        // Use real edit key dispatch, not calling the parser in place of the component.
        await page.locator("#say").focus();
        await page.locator("#say").fill("/귓속말 상대이름 비밀내용");
        await page.locator("#say").dispatchEvent("keydown", { key: "Enter", isComposing: true });
        assert.equal(await page.locator("#say").inputValue(), "/귓속말 상대이름 비밀내용");
        await page.keyboard.press("Enter");
        assert.ok(
          (await page.evaluate(() => window.socialFixture.calls())).some(
            (c) => typeof c === "object" && c !== null && "private" in c,
          ),
        );
        assert.notEqual(await page.evaluate(() => document.activeElement?.id), "say");
        await page.locator("#say").focus();
        await page.locator("#say").fill("/파티정보");
        await page.keyboard.press("Shift+Enter");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "say");
        await page.locator("#say").fill("/교환 OtherUser");
        await page.keyboard.press("Shift+Enter");
        await page.locator("#say").fill("/unknown private");
        await page.keyboard.press("Shift+Enter");
        assert.equal(
          (await page.evaluate(() => window.socialFixture.calls())).some(
            (c) => typeof c === "object" && c !== null && "public" in c,
          ),
          false,
        );
        await page.locator("#say").fill("public line");
        await page.keyboard.press("Shift+Enter");
        await page.keyboard.press("ArrowLeft");
        assert.notEqual(await page.evaluate(() => document.activeElement?.id), "say");
        await page.evaluate(() => window.socialFixture.offer(7));
        let state = await page.evaluate(() => window.socialFixture.paint());
        assert.equal(state.open, true);
        assert.equal(
          state.question,
          "'상대이름'님이 파티에 초대했습니다.\r\n파티에 가입하시겠습니까?",
        );
        await page.evaluate(() => window.socialFixture.membership());
        state = await page.evaluate(() => window.socialFixture.paint());
        assert.equal(state.open, false);
        await page.evaluate(() => {
          window.socialFixture.notice();
          window.socialFixture.membership();
        });
        assert.equal(
          (await page.evaluate(() => window.socialFixture.paint())).open,
          true,
          "membership update does not close another owner's notice",
        );
        await page.evaluate(() => window.socialFixture.close());
        await page.evaluate(() => window.socialFixture.offer(8));
        await page.locator("#item-dialog-ok").click();
        assert.ok(
          (await page.evaluate(() => window.socialFixture.calls())).some(
            (c) =>
              typeof c === "object" &&
              c !== null &&
              "reply" in c &&
              c.reply === 8 &&
              "accepted" in c &&
              c.accepted === true,
          ),
        );
        await page.evaluate(() => window.socialFixture.offer(9));
        await page.keyboard.press("Escape");
        assert.equal((await page.evaluate(() => window.socialFixture.paint())).open, false);
        await page.evaluate(() => {
          window.socialFixture.deny();
          window.socialFixture.offer(10);
        });
        assert.equal((await page.evaluate(() => window.socialFixture.paint())).open, false);
        assert.deepEqual(errors, []);
        assert.equal(guard.socketAttempts, 0);
      } finally {
        await context.close();
      }
    }
    assert.ok(requests.every((r) => r.startsWith("GET ")));
    assert.ok(requests.some((r) => r.includes("/api/png/")));
  } finally {
    await browser.close();
    server.stop(true);
    await api.close();
  }
});
