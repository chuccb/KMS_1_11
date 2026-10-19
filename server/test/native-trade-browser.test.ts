/**
 * Chromium component check of the exchange sheet: `sub_4D63C0` hit rects, the `sub_4D4960`
 * lock wash over the original `Trade/backgrnd` pixels, and `sub_481910`'s invitation box through
 * the shared production modal. Read-only GETs; no WebSocket, login, gameplay actor or save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser } from "../scripts/browser.ts";

test(
  "trade sheet hit rects, lock wash over original art, and the 481910 invite box in Chromium",
  {
    timeout: 120_000,
  },
  async () => {
    const art = artProviderOf(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dirname, "fixtures/trade-browser.ts")],
      target: "browser",
      format: "esm",
    });
    assert.equal(build.success, true);
    const script = await build.outputs[0]!.text();
    const index = await Bun.file(resolve(import.meta.dirname, "../../client/index.html")).text(),
      dialog = /<section\s+id="item-dialog"[\s\S]*?<\/section>/.exec(index);
    assert.ok(dialog, "the page uses the production modal markup");
    const css = await Bun.file(resolve(import.meta.dirname, "../../client/style.css")).text();
    const api = await startWebClient({ host: "127.0.0.1", port: 0, loginPort: 0, art });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method !== "GET") return new Response("GET only", { status: 405 });
        if (url.pathname === "/")
          return new Response(
            `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div style="position:relative;width:800px;height:600px"><canvas id="view" width="800" height="600"></canvas><div id="game-ui">${dialog[0]}</div></div><script type="module">import {installTradeFixture} from '/fixture.js';window.tradeFixture=installTradeFixture();</script></body></html>`,
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
        return new Response("no gameplay endpoints", { status: 404 });
      },
    });
    const browser = await launchBrowser().catch(async (error: unknown) => {
      server.stop(true);
      await api.close();
      throw error;
    });
    try {
      const context = await browser.newContext({
          deviceScaleFactor: 1,
          viewport: { width: 900, height: 700 },
        }),
        page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.waitForFunction(
        () => (window as never as { tradeFixture?: unknown }).tradeFixture,
      );
      await page.evaluate(() =>
        (window as never as { tradeFixture: { warm(): Promise<void> } }).tradeFixture.warm(),
      );

      // 1. sub_4D63C0's rects, in page coordinates, with the sheet at its centred home.
      const hits = await page.evaluate(() => {
        const f = (
          window as never as { tradeFixture: import("./fixtures/trade-browser.ts").TradeFixture }
        ).tradeFixture;
        const at = (dx: number, dy: number) => f.hit(f.at.x + dx, f.at.y + dy);
        return {
          mySlot1: at(295, 132),
          mySlot2: at(330, 132),
          mySlot8: at(330, 237),
          theirSlot1: at(14, 132),
          between: at(200, 132),
          trade: at(225, 270),
          coin: at(288, 278),
          close: at(322, 12),
          body: at(150, 250),
          outside: f.hit(f.at.x - 5, f.at.y - 5),
        };
      });
      assert.deepEqual(hits.mySlot1, { kind: "slot", side: "mine", roomSlot: 1, occupied: false });
      assert.deepEqual(hits.mySlot2, { kind: "slot", side: "mine", roomSlot: 2, occupied: false });
      assert.deepEqual(hits.mySlot8, { kind: "slot", side: "mine", roomSlot: 8, occupied: false });
      assert.deepEqual(hits.theirSlot1, {
        kind: "slot",
        side: "theirs",
        roomSlot: 1,
        occupied: false,
      });
      assert.deepEqual(hits.between, { kind: "body" });
      assert.deepEqual(hits.trade, { kind: "trade" });
      assert.deepEqual(hits.coin, { kind: "coin" });
      assert.deepEqual(hits.close, { kind: "close" });
      assert.deepEqual(hits.body, { kind: "body" });
      assert.equal(hits.outside, undefined);

      // 2. The lock wash: 50 % white over the sheet's own slot blue, my half only.
      const pixels = await page.evaluate(() => {
        const f = (
          window as never as { tradeFixture: import("./fixtures/trade-browser.ts").TradeFixture }
        ).tradeFixture;
        const room = {
          myIndex: 0,
          participants: new Map(),
          sides: [
            { offers: new Map(), mesos: 0, confirmed: true },
            { offers: new Map(), mesos: 0, confirmed: false },
          ],
          messages: [],
        };
        f.render(room as never);
        return {
          washed: f.pixel(f.at.x + 300, f.at.y + 200),
          plain: f.pixel(f.at.x + 20, f.at.y + 200),
        };
      });
      const close = (got: number[], want: number[]) =>
        got.length === 4 && got.every((channel, i) => Math.abs(channel - want[i]!) <= 2);
      assert.ok(close(pixels.washed, [221, 230, 238, 255]), `wash ${pixels.washed}`);
      assert.ok(close(pixels.plain, [187, 204, 221, 255]), `sheet ${pixels.plain}`);

      // 3. sub_481910's box: original wording, line breaks, and the Yes answer.
      const opened = await page.evaluate(() => {
        const f = (
          window as never as { tradeFixture: import("./fixtures/trade-browser.ts").TradeFixture }
        ).tradeFixture;
        return { opened: f.invite("상대이름"), question: f.question() };
      });
      assert.equal(opened.opened, true);
      assert.ok(opened.question.includes("'상대이름'님께서 1:1 교환을"), opened.question);
      assert.ok(opened.question.includes("요청에 응하시겠습니까?"), opened.question);
      await page.locator("#item-dialog-ok").click();
      const calls = await page.evaluate(() =>
        (
          window as never as { tradeFixture: import("./fixtures/trade-browser.ts").TradeFixture }
        ).tradeFixture.calls(),
      );
      assert.deepEqual(calls, [{ accept: "상대이름" }]);
      assert.deepEqual(errors, [], "no page errors");
      await context.close();
    } finally {
      await browser.close();
      server.stop(true);
      await api.close();
    }
  },
);
