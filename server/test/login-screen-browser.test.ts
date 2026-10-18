/** Real DOM/canvas with original WZ art. Screen callbacks record intent; no game socket can open. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";
import "./fixtures/login-screen-browser.ts";

const characters = [1, 2, 3].map((id) => ({
  id,
  name: `Fixture${id}`,
  job: 0,
  level: 1,
  str: 4,
  dex: 4,
  int: 4,
  luk: 13,
  face: 20000,
  hair: 30000,
  items: [1040002, 1060002, 1072001, 1302000],
}));
const worlds = Array.from({ length: 10 }, (_, index) => ({
  name: `World${index}`,
  unknownId: index === 1 ? 0xffffffff : index * 100,
}));

test(
  "strict login UI retains native paintings, modal/input ownership, selection/pending and disposal without authentication",
  { timeout: 120000 },
  async () => {
    const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
    const art = await startWebClient({
      host: "127.0.0.1",
      port: 0,
      loginPort: 0,
      art: artProviderOf(archive),
    });
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dirname, "fixtures/login-screen-browser.ts")],
      target: "browser",
      format: "esm",
    });
    assert.equal(build.success, true);
    const script = await build.outputs[0]!.text();
    const html = readFileSync(resolve(import.meta.dirname, "../../client/index.html"), "utf8")
      .replace('<script type="module" src="./startup.ts"></script>', "")
      .replace(
        '<script type="module" src="./main.js"></script>',
        '<script type="module">import{installLoginFixture}from"/fixture.js";installLoginFixture();</script>',
      );
    assert.equal(html.includes('src="./main.js"'), false);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method !== "GET") return new Response("GET only", { status: 405 });
        if (url.pathname === "/ws") return new Response("No game transport", { status: 403 });
        if (url.pathname === "/")
          return new Response(html, { headers: { "content-type": "text/html" } });
        if (url.pathname === "/fixture.js")
          return new Response(script, { headers: { "content-type": "text/javascript" } });
        return fetch(`http://127.0.0.1:${art.port}${url.pathname}${url.search}`);
      },
    });
    const browser = await launchBrowser().catch(async (error: unknown) => {
      server.stop(true);
      await art.close();
      throw error;
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const origin = `http://127.0.0.1:${server.port}`,
        guard = await readOnlyBrowserPage(page, origin);
      await page.addInitScript(() =>
        localStorage.setItem("kms111.loginUser", "remembered-fixture"),
      );
      await page.goto(origin);
      await page.waitForFunction(() => !!window.loginFixture);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "title-continue");
      assert.equal(await page.locator("#user").inputValue(), "remembered-fixture");
      assert.equal(await page.locator("#remember-user").isChecked(), true);
      assert.equal(await page.locator("#pass").inputValue(), "");
      await page.evaluate(() => window.loginFixture.readyPaint());
      const initial = await page.evaluate(() => ({
        draws: window.loginFixture.draws,
        texts: window.loginFixture.texts,
      }));
      assert.ok(
        initial.draws.some(
          (draw) =>
            draw.path === "UI/Login.img/Title/backgrnd" && draw.coordinates.join() === "0,0",
        ),
      );
      assert.ok(
        initial.draws.some(
          (draw) =>
            draw.path === "UI/Login.img/Title/menu" && draw.coordinates.join() === "302,358",
        ),
      );
      assert.ok(
        initial.texts.some(
          (text) =>
            text.text === "Ver. 1.11" && text.x === 796 && text.y === 584 && text.align === "right",
        ),
      );
      // Exact original background pixels in the unobscured title area, not a replacement test texture.
      assert.equal(
        await page.evaluate(async () => {
          const image = new Image();
          image.src = `/api/png/${encodeURIComponent("UI/Login.img/Title/backgrnd")}`;
          await image.decode();
          const expected = new OffscreenCanvas(800, 200),
            reference = expected.getContext("2d");
          const view = document.getElementById("view");
          if (!reference || !(view instanceof HTMLCanvasElement))
            throw new Error("Expected real canvas");
          reference.drawImage(image, 0, 0);
          const actual = view.getContext("2d")!.getImageData(0, 0, 800, 200).data,
            pixels = reference.getImageData(0, 0, 800, 200).data;
          return actual.every((value, index) => value === pixels[index]);
        }),
        true,
      );
      await page.locator("#title-continue").click();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "pass");
      await page.evaluate(() => window.loginFixture.readyPaint());
      assert.ok(
        await page.evaluate(() =>
          window.loginFixture.draws.some(
            (draw) =>
              draw.path === "UI/Login.img/Title/loginDlg" && draw.coordinates.join() === "247,215",
          ),
        ),
      );
      await page.locator("#user").focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "login-cancel");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "user");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "pass");
      await page.locator("#pass").fill("fixture-only-secret");
      await page.keyboard.press("Enter");
      await page.locator("#login").evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Expected button");
        button.click();
      });
      assert.equal(await page.evaluate(() => window.loginFixture.connections), 1);
      for (const id of ["login", "user", "pass", "login-cancel"])
        assert.equal(await page.locator(`#${id}`).isDisabled(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#connect").isVisible(), true);
      await page.evaluate(() => {
        window.loginFixture.screen.rememberAccount();
        window.loginFixture.screen.setLoginPending(false);
      });
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).sort()), [
        "kms111.loginUser",
      ]);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#pass").inputValue(), "");
      assert.equal(await page.locator("#connect").isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "title-continue");

      // Explicit component state, not a login reply or a character/world operation on any server.
      await page.evaluate((rows) => {
        window.loginFixture.screen.replaceWorlds(rows);
        window.loginFixture.show("worlds");
      }, worlds);
      assert.equal(await page.locator("#world-list button").count(), 6);
      assert.equal(await page.locator("#world-connect").isDisabled(), true);
      await page.locator("#world-list button").nth(1).click();
      assert.equal(
        await page.locator("#world-connect").isDisabled(),
        true,
        "signed -1 is unavailable",
      );
      await page.locator("#world-list").dispatchEvent("wheel", { deltaY: 100 });
      assert.equal(await page.locator("#world-list button").first().textContent(), "World1");
      await page.locator("#world-list button").nth(1).click();
      assert.equal(
        await page.locator("#world-list button").nth(1).getAttribute("aria-pressed"),
        "true",
      );
      await page.evaluate(() => window.loginFixture.readyPaint());
      assert.ok(
        await page.evaluate(() =>
          window.loginFixture.texts.some((text) => text.text === "접속불가"),
        ),
      );
      const beforeRequests = await page.evaluate(() => window.loginFixture.requests.length);
      await page.evaluate(() => {
        const editor = document.createElement("input");
        editor.id = "isolated-editor";
        document.body.append(editor);
        editor.focus();
      });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.loginFixture.requests.length), beforeRequests);
      await page.locator("#isolated-editor").evaluate((element) => element.remove());
      await page.locator("#world-connect").focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await page.evaluate(() => window.loginFixture.requests), [
        { t: "world", index: 2 },
      ]);
      assert.equal(await page.locator("#character-enter").isDisabled(), true);
      assert.equal(await page.locator("#character-new").isDisabled(), true);

      await page.evaluate((rows) => window.loginFixture.screen.replaceCharacters(rows), characters);
      assert.equal(await page.locator("#character-list button").count(), 3);
      assert.equal(await page.locator("#character-new").isDisabled(), true);
      await page.evaluate(() => window.loginFixture.readyPaint());
      assert.deepEqual(
        await page.evaluate(() =>
          window.loginFixture.poses.map(({ id, stance }) => ({ id, stance })),
        ),
        [
          { id: 1, stance: "walk1" },
          { id: 2, stance: "stand1" },
          { id: 3, stance: "stand1" },
        ],
      );
      assert.equal(
        await page.evaluate(
          () => window.loginFixture.draws.filter((draw) => draw.path.startsWith("avatar:")).length,
        ),
        3,
      );
      assert.ok(
        await page.evaluate(() =>
          window.loginFixture.texts.some(
            (text) => text.text === "Fixture1" && text.x === 253 && text.y === 388,
          ),
        ),
      );
      assert.deepEqual(
        await page.evaluate(() => window.loginFixture.preloaded),
        characters.map((character) => character.items),
      );
      await page.locator("#character-list button").first().focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.evaluate(() => window.loginFixture.screen.selectedCharacter?.id), 2);
      await page.evaluate(() => window.loginFixture.setModal(true));
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.loginFixture.screen.selectedCharacter?.id), 2);
      assert.equal(await page.evaluate(() => window.loginFixture.requests.length), 1);
      await page.evaluate(() => {
        window.loginFixture.setModal(false);
        window.loginFixture.setLab(true);
      });
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.loginFixture.screen.selectedCharacter?.id), 2);
      await page.evaluate(() => window.loginFixture.setLab(false));
      await page.locator("#character-enter").focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await page.evaluate(() => window.loginFixture.requests), [
        { t: "world", index: 2 },
        { t: "character", id: 2 },
      ]);
      assert.equal(await page.locator("#character-delete").isDisabled(), true);
      await page.evaluate(
        (rows) => window.loginFixture.screen.replaceCharacters(rows),
        [characters[1], characters[0]],
      );
      assert.equal(await page.evaluate(() => window.loginFixture.screen.selectedCharacter?.id), 2);
      await page.locator("#character-new").click();
      await page.locator("#character-delete").click();
      assert.deepEqual(
        await page.evaluate(() => [window.loginFixture.creates, window.loginFixture.deletes]),
        [1, 1],
      );
      assert.equal(
        await page.evaluate(() => window.loginFixture.screen.replaceCharacters([{ id: 99 }])),
        false,
      );
      assert.equal(await page.evaluate(() => window.loginFixture.screen.selectedCharacter?.id), 2);
      await page.evaluate(() => window.loginFixture.screen.setSelectionPending(false));
      assert.equal(await page.locator("#character-enter").isDisabled(), true);
      assert.match((await page.locator("#character-status").textContent()) ?? "", /無效角色清單/);
      await page.evaluate(() => {
        window.loginFixture.screen.hidePanels();
      });
      assert.equal(await page.evaluate(() => window.loginFixture.screen.stage), "game");
      assert.equal(await page.locator("#bar").isVisible(), true);
      await page.evaluate((rows) => {
        window.loginFixture.screen.replaceWorlds(rows);
        window.loginFixture.show("worlds");
        window.loginFixture.dispose();
      }, worlds);
      const beforeDispose = await page.evaluate(() => ({
        requests: window.loginFixture.requests.length,
        effects: window.loginFixture.effects.length,
      }));
      await page.locator("#world-list button").first().click();
      await page.keyboard.press("Enter");
      assert.deepEqual(
        await page.evaluate(() => ({
          requests: window.loginFixture.requests.length,
          effects: window.loginFixture.effects.length,
        })),
        beforeDispose,
      );
      assert.deepEqual(errors, []);
      assert.equal(guard.socketAttempts, 0);

      const privatePage = await browser.newPage();
      const privateGuard = await readOnlyBrowserPage(privatePage, origin);
      await privatePage.addInitScript(() =>
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("Storage denied");
          },
        }),
      );
      await privatePage.goto(origin);
      await privatePage.waitForFunction(() => !!window.loginFixture);
      await privatePage.evaluate(() => window.loginFixture.screen.rememberAccount());
      assert.equal(await privatePage.evaluate(() => window.loginFixture.screen.stage), "title");
      assert.equal(privateGuard.socketAttempts, 0);
    } finally {
      await browser.close();
      server.stop(true);
      await art.close();
    }
  },
);
