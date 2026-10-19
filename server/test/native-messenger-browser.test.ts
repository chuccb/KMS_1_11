/**
 * Chromium component check of the messenger sheet: `sub_4E0FF0`'s hit rects, `sub_4E1320`'s
 * sixteen-row log on the shared CCtrlScrollBar, `sub_4DFB50`'s member column and `sub_4E14E0`'s
 * typing row over the original `Messenger/backgrnd` pixels, and `sub_4E1BB0`'s invitation box
 * through the shared production modal. Read-only GETs; no WebSocket, login, gameplay actor or save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser } from "../scripts/browser.ts";

test(
  "messenger sheet hit rects, member column, typing row and the 4E1BB0 invite box in Chromium",
  {
    timeout: 120_000,
  },
  async () => {
    const art = artProviderOf(WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")));
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dirname, "fixtures/messenger-browser.ts")],
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
            `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div style="position:relative;width:800px;height:600px"><canvas id="view" width="800" height="600"></canvas><div id="game-ui">${dialog[0]}</div></div><script type="module">import {installMessengerFixture} from '/fixture.js';window.messengerFixture=installMessengerFixture();</script></body></html>`,
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
        () => (window as never as { messengerFixture?: unknown }).messengerFixture,
      );
      await page.evaluate(() =>
        (
          window as never as { messengerFixture: { warm(): Promise<void> } }
        ).messengerFixture.warm(),
      );
      await page.waitForTimeout(600); // the member avatars resolve through /api/png

      // 1. sub_4E0FF0's rects plus the sheet body, in page coordinates at the (500,50) home.
      const hits = await page.evaluate(() => {
        const f = (
          window as never as {
            messengerFixture: import("./fixtures/messenger-browser.ts").MessengerFixture;
          }
        ).messengerFixture;
        const at = (dx: number, dy: number) => f.hit(f.at.x + dx, f.at.y + dy);
        f.render(f.room(35)); // the scrollbar's zones only act once rows exist (max > 1)
        return {
          close: at(158, 15),
          edit: at(20, 290),
          scrollUp: at(184, 62),
          scrollDown: at(184, 270),
          body: at(100, 200),
          outside: f.hit(f.at.x - 5, f.at.y - 5),
        };
      });
      assert.deepEqual(hits.close, { kind: "close" });
      assert.deepEqual(hits.edit, { kind: "edit" });
      assert.deepEqual(hits.scrollUp, { kind: "scroll", zone: "prev" });
      assert.deepEqual(hits.scrollDown, { kind: "scroll", zone: "next" });
      assert.deepEqual(hits.body, { kind: "body" });
      assert.equal(hits.outside, undefined);

      // 2. sub_4E1320's log on the shared CCtrlScrollBar: 5 help + 35 chat = 40 wrapped rows
      //    pin the view at the
      //    bottom (max 25, thumbTop 194), and scrolling back to the top repaints the first row.
      const bar = await page.evaluate(() => {
        const f = (
          window as never as {
            messengerFixture: import("./fixtures/messenger-browser.ts").MessengerFixture;
          }
        ).messengerFixture;
        const room = f.room(35);
        const zone = (v: number) => f.hit(f.at.x + 184, f.at.y + 58 + v);
        // A strip across the first painted log row (top-baseline y 63, glyphs to ~74).
        const firstRow = () => {
          const cells: string[] = [];
          for (let dx = 0; dx < 160; dx += 2)
            cells.push(f.pixel(f.at.x + 12 + dx, f.at.y + 68).join());
          return cells.join("|");
        };
        f.render(room); // pinned at the bottom: max = 40-15 = 25, thumbTop = 12 + 182 = 194
        const pinned = {
          max: f.scroll.max,
          pos: f.scroll.pos,
          thumbTop: f.scroll.thumbTop(),
          thumb: zone(199),
          aboveThumb: zone(100),
          pixels: firstRow(),
        };
        f.scroll.by(-24); // back to the top: the thumb parks under the up arrow
        f.render(room);
        const top = { pos: f.scroll.pos, thumbTop: f.scroll.thumbTop(), pixels: firstRow() };
        return { pinned, top };
      });
      assert.equal(bar.pinned.max, 25);
      assert.equal(bar.pinned.pos, 24);
      assert.equal(bar.pinned.thumbTop, 194);
      assert.deepEqual(bar.pinned.thumb, { kind: "scroll", zone: "thumb" });
      assert.deepEqual(bar.pinned.aboveThumb, { kind: "scroll", zone: "pageUp" });
      assert.equal(bar.top.pos, 0);
      assert.equal(bar.top.thumbTop, 12);
      assert.notEqual(bar.pinned.pixels, bar.top.pixels, "the log repaints from scroll.pos");

      // 3. sub_4DFB50's member column (names at local 202,105+98s) and sub_4E14E0's typing row:
      //    both differ from the same sheet with an empty room / no typing cell.
      const members = await page.evaluate(() => {
        const f = (
          window as never as {
            messengerFixture: import("./fixtures/messenger-browser.ts").MessengerFixture;
          }
        ).messengerFixture;
        const strip = (x: number, y: number, width: number) => {
          const cells: string[] = [];
          for (let dx = 0; dx < width; dx += 2)
            cells.push(f.pixel(f.at.x + x + dx, f.at.y + y).join());
          return cells.join("|");
        };
        const empty = f.state;
        empty.openLocal();
        f.render(empty.room);
        const blank = { name: strip(202, 110, 30), typing: strip(11, 322, 120) };
        f.render(f.room(3, 0)); // slot 0 ("갑") is typing
        const withMembers = { name: strip(202, 110, 30), typing: strip(11, 322, 120) };
        f.render(f.room(3)); // same room, nobody typing
        const idle = { typing: strip(11, 322, 120) };
        return { blank, withMembers, idle };
      });
      assert.notEqual(members.blank.name, members.withMembers.name, "member names paint");
      assert.notEqual(members.blank.typing, members.withMembers.typing, "typing row paints");
      assert.notEqual(members.idle.typing, members.withMembers.typing, "typing row clears");

      // 4. sub_4E1BB0's invitation box through the shared production modal.
      const invite = await page.evaluate(() => {
        const f = (
          window as never as {
            messengerFixture: import("./fixtures/messenger-browser.ts").MessengerFixture;
          }
        ).messengerFixture;
        return { opened: f.invite("정", 42), question: f.question() };
      });
      assert.equal(invite.opened, true);
      assert.ok(invite.question.includes("정"), invite.question);
      assert.ok(invite.question.includes("초청"), invite.question);
      await page.click("#item-dialog-ok");
      const calls = await page.evaluate(() => {
        const f = (
          window as never as {
            messengerFixture: import("./fixtures/messenger-browser.ts").MessengerFixture;
          }
        ).messengerFixture;
        return f.calls();
      });
      assert.deepEqual(calls, [{ accept: 42 }]);

      assert.deepEqual(errors, [], "no page errors");
    } finally {
      await browser.close();
      server.stop(true);
      await api.close();
    }
  },
);
