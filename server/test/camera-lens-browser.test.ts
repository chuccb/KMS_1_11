/** Real browser component, original WZ PNG and production compositing/controls. Not LIVE gameplay. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";
import { LENS_MODES } from "../../client/camera-lens.ts";
import "./fixtures/lens-browser.ts";

test("pixel compositor keeps original drop PNG on ground, integer world stripes and unfaded UI for every clear size/lens", async () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const art = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    art: artProviderOf(archive),
    itemCatalog: itemCatalogOf(archive),
  });
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dirname, "fixtures/lens-browser.ts")],
    target: "browser",
    format: "esm",
  });
  assert.equal(build.success, true);
  const script = await build.outputs[0]!.text(),
    html = readFileSync(resolve(import.meta.dirname, "../../client/index.html"), "utf8");
  const panel = html.match(/<details id="camera-lab">[\s\S]*?<\/details>/)?.[0];
  assert.ok(panel);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/")
        return new Response(
          `<!doctype html><body>${panel}<script type="module">import{installLensFixture}from"/fixture.js";installLensFixture();</script>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url.pathname === "/fixture.js")
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (/^\/api\/(item\/4000019|png\/[^/]+)$/.test(url.pathname))
        return fetch(`http://127.0.0.1:${art.port}${url.pathname}`);
      return new Response("No game service", { status: 404 });
    },
  });
  const browser = await launchBrowser().catch(async (error: unknown) => {
    server.stop(true);
    await art.close();
    throw error;
  });
  try {
    const page = await browser.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForFunction(() => !!window.lensFixture);
    for (let uiScale = 1; uiScale <= 4; uiScale++)
      for (const { id: lens } of LENS_MODES) {
        const result = await page.evaluate((input) => window.lensFixture.paint(input), {
          uiScale,
          lens,
        });
        const k = result.viewport.pixelScale;
        assert.ok(result.runs.every((value, i) => value === (Math.floor(i / k) % 2 ? 255 : 0)));
        assert.equal(result.atGround, true);
        assert.equal(result.belowGround, false);
        assert.equal(
          result.nativePixelsExact,
          true,
          `${uiScale}x ${lens}: entire original PNG at its physical integer scale`,
        );
        assert.deepEqual(result.hud, [0, 255, 0, 255]);
        assert.equal(result.smoothing, false);
        assert.ok(result.buffer[0] <= 3200 && result.buffer[1] <= 2400);
      }
    for (const style of ["fade", "shutter"] as const) {
      const covered = await page.evaluate((input) => window.lensFixture.paint(input), {
        uiScale: 2,
        lens: "near" as const,
        cover: 1,
        style,
      });
      assert.ok(covered.runs.every((value) => value === 0));
      assert.deepEqual(covered.hud, [0, 255, 0, 255]);
    }
    const partial = await page.evaluate(() =>
      window.lensFixture.paint({ uiScale: 2, lens: "near", cover: 0.5 }),
    );
    assert.ok(partial.runs.some((value) => value >= 127 && value <= 128));
    const switched = await page.evaluate(() =>
      window.lensFixture.paint({ uiScale: 2, lens: "wide", cover: 0.5 }),
    );
    assert.ok(
      switched.runs.every((value) => value === 0),
      "A RAF-skipped peak still paints the geometry switch fully black",
    );
    const resumed = await page.evaluate(() =>
      window.lensFixture.paint({ uiScale: 2, lens: "wide", cover: 0.5 }),
    );
    assert.ok(resumed.runs.some((value) => value >= 127 && value <= 128));
    const expired = await page.evaluate(() =>
      window.lensFixture.paint({ uiScale: 2, lens: "detail", cover: 0 }),
    );
    assert.ok(
      expired.runs.some((value) => value === 255),
      "No stale cover after suspension skips the entire transition",
    );
    // Real native DOM controls and events, no FakeImage or injected gameplay/socket.
    await page.locator("summary").click();
    await page.locator("#camera-transition").selectOption("fade");
    await page.locator("#camera-lens").selectOption("near");
    let observation = await page.evaluate(() => window.lensFixture.sample(90, 2));
    assert.equal(observation.state.mode, "normal");
    assert.equal(observation.state.cover, 0.5);
    observation = await page.evaluate(() => window.lensFixture.sample(180, 2));
    assert.equal(observation.state.mode, "near");
    assert.equal(observation.state.cover, 1);
    await page.locator("#camera-closer").press("Space");
    observation = await page.evaluate(() => window.lensFixture.sample(600, 2));
    assert.equal(observation.state.mode, "detail");
    assert.equal(observation.worldKeys, 0);
    await page.locator("#camera-reset").click();
    observation = await page.evaluate(() => window.lensFixture.sample(601));
    assert.equal(observation.state.mode, "normal");
    assert.equal(observation.state.cover, 0);
    await page.locator("#camera-lens").focus();
    await page.keyboard.press("Escape");
    observation = await page.evaluate(() => window.lensFixture.sample(602));
    assert.equal(observation.closes, 1);
    assert.equal(observation.worldKeys, 0);
    assert.ok(observation.interactions > 0);
    await page.locator("summary").click();
    await page.locator("#camera-transition").selectOption("fade");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.querySelector<HTMLSelectElement>("#camera-transition")?.disabled,
    );
    await page.locator("#camera-lens").selectOption("near");
    observation = await page.evaluate(() => window.lensFixture.sample(603));
    assert.equal(observation.state.mode, "near");
    assert.equal(observation.state.cover, 0);
    assert.equal(await page.locator("#camera-replay").isDisabled(), true);
    assert.equal(await page.locator("#camera-transition").inputValue(), "fade");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(
      () => !document.querySelector<HTMLSelectElement>("#camera-transition")?.disabled,
    );
    await page.locator("#camera-lens").selectOption("detail");
    observation = await page.evaluate(() => window.lensFixture.sample(693));
    assert.equal(observation.state.cover, 0.5);
    await page.reload();
    await page.waitForFunction(() => !!window.lensFixture);
    assert.equal(await page.locator("#camera-lens").inputValue(), "detail");
    assert.equal(await page.locator("#camera-transition").inputValue(), "fade");
    observation = await page.evaluate(() => window.lensFixture.sample(0));
    assert.equal(observation.state.mode, "detail");
    assert.equal(observation.state.cover, 0, "Reload cannot inherit a stale blackout");
    await page.evaluate(() => window.lensFixture.dispose());
    const interactions = observation.interactions;
    await page.locator("#camera-lens").selectOption("wide", { force: true });
    observation = await page.evaluate(() => window.lensFixture.sample(1));
    assert.equal(observation.interactions, interactions);
    assert.equal(observation.state.mode, "detail");
    assert.equal(await page.evaluate(() => localStorage.getItem("kms111.cameraLens")), "detail");
    // Denied preference reads/writes remain session-usable in a real DOM, no auth/game service.
    await page.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem() {
            throw new Error("blocked");
          },
          setItem() {
            throw new Error("quota");
          },
        },
      }),
    );
    await page.reload();
    await page.waitForFunction(() => !!window.lensFixture);
    assert.equal(await page.locator("#camera-lens").inputValue(), "normal");
    await page.locator("summary").click();
    await page.locator("#camera-lens").selectOption("near");
    observation = await page.evaluate(() => window.lensFixture.sample(0));
    assert.equal(observation.state.mode, "near");
    await page.locator("#camera-reset").click();
    observation = await page.evaluate(() => window.lensFixture.sample(1));
    assert.equal(observation.state.mode, "normal");
    await page.evaluate(() => window.lensFixture.dispose());
    assert.deepEqual(errors, []);
    assert.equal(guard.socketAttempts, 0);
  } finally {
    try {
      await browser.close();
    } finally {
      server.stop(true);
      await art.close();
    }
  }
});
