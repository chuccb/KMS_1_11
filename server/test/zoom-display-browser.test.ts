/** Final screenshot, not just getImageData: real avatar/background/tile and production CSS. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";
import type { DisplayMode } from "../../client/display.ts";
import type { LensMode } from "../../client/camera-lens.ts";
import "./fixtures/zoom-display-browser.ts";

test(
  "final CSS/DPR screenshot preserves every composed avatar/background/tile pixel at normal, near and detail zoom",
  { timeout: 180000 },
  async () => {
    const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")),
      provider = artProviderOf(archive),
      map = provider.mapArt(100000000);
    assert.ok(map);
    const background = map.backs[0]?.path,
      tile = map.sprites.find((sprite) => sprite.kind === "tile")?.frames[0]?.path;
    assert.ok(background && tile);
    const art = await startWebClient({ host: "127.0.0.1", port: 0, loginPort: 0, art: provider });
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dirname, "fixtures/zoom-display-browser.ts")],
      target: "browser",
      format: "esm",
    });
    assert.equal(build.success, true);
    const script = await build.outputs[0]!.text(),
      css = readFileSync(resolve(import.meta.dirname, "../../client/style.css"), "utf8");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method !== "GET") return new Response("GET only", { status: 405 });
        if (url.pathname === "/")
          return new Response(
            '<!doctype html><link rel="stylesheet" href="/style.css"><div id="game-viewport"><div id="game-stage"><canvas id="view"></canvas><div id="game-ui"></div></div></div><select id="view-scale" class="hidden"></select><script type="module">import{installZoomScreen}from"/fixture.js";installZoomScreen();</script>',
            { headers: { "content-type": "text/html" } },
          );
        if (url.pathname === "/fixture.js")
          return new Response(script, { headers: { "content-type": "text/javascript" } });
        if (url.pathname === "/style.css")
          return new Response(css, { headers: { "content-type": "text/css" } });
        if (url.pathname.startsWith("/api/"))
          return fetch(`http://127.0.0.1:${art.port}${url.pathname}${url.search}`);
        return new Response("No game endpoint", { status: 404 });
      },
    });
    const browser = await launchBrowser().catch(async (error: unknown) => {
      server.stop(true);
      await art.close();
      throw error;
    });
    try {
      const evidence = [];
      for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 3]) {
        const page = await browser.newPage({ deviceScaleFactor: dpr }),
          errors: string[] = [];
        try {
          page.on("pageerror", (error) => errors.push(error.message));
          const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
          await page.goto(`http://127.0.0.1:${server.port}`);
          await page.waitForFunction(() => !!window.zoomScreen);
          for (const mode of ["pixel-1", "pixel-2"] satisfies DisplayMode[]) {
            const uiScale = mode === "pixel-1" ? 1 : 2;
            await page.setViewportSize({
              width: Math.ceil((800 * uiScale + 160) / dpr),
              height: Math.ceil((600 * uiScale + 160) / dpr),
            });
            for (const lens of ["normal", "near", "detail"] satisfies LensMode[]) {
              const result: Awaited<ReturnType<Window["zoomScreen"]["paint"]>> =
                await page.evaluate((input) => window.zoomScreen.paint(input), {
                  mode,
                  lens,
                  background,
                  tile,
                });
              const screenshot = await page.screenshot();
              const comparison: {
                differences: number;
                maxDifference: number;
                nonUniform: number;
                interiorDifferences: number;
              } = await page.evaluate(
                async (input) => {
                  const decode = async (url: string) =>
                    createImageBitmap(await (await fetch(url)).blob());
                  const source = await decode(input.source),
                    screen = await decode(input.screen);
                  try {
                    const sourceCanvas = new OffscreenCanvas(source.width, source.height),
                      screenCanvas = new OffscreenCanvas(screen.width, screen.height),
                      a = sourceCanvas.getContext("2d"),
                      b = screenCanvas.getContext("2d");
                    if (!a || !b) throw new Error("No screenshot decoder context");
                    a.drawImage(source, 0, 0);
                    b.drawImage(screen, 0, 0);
                    const expected = a.getImageData(0, 0, source.width, source.height).data,
                      actual = b.getImageData(
                        Math.round(input.left * input.dpr),
                        Math.round(input.top * input.dpr),
                        source.width,
                        source.height,
                      ).data;
                    let differences = 0,
                      maxDifference = 0,
                      nonUniform = 0,
                      interiorDifferences = 0;
                    for (let y = 0; y < source.height; y++)
                      for (let x = 0; x < source.width; x++)
                        for (let c = 0; c < 4; c++) {
                          const i = (y * source.width + x) * 4 + c,
                            difference = Math.abs(expected[i]! - actual[i]!);
                          if (difference) {
                            differences++;
                            if (x > 0 && y > 0 && x < source.width - 1 && y < source.height - 1)
                              interiorDifferences++;
                            maxDifference = Math.max(maxDifference, difference);
                          }
                          const start =
                            (Math.floor(y / input.k) * input.k * source.width +
                              Math.floor(x / input.k) * input.k) *
                              4 +
                            c;
                          if (expected[i] !== expected[start]) nonUniform++;
                        }
                    return { differences, maxDifference, nonUniform, interiorDifferences };
                  } finally {
                    source.close();
                    screen.close();
                  }
                },
                {
                  source: result.png,
                  screen: `data:image/png;base64,${screenshot.toString("base64")}`,
                  left: result.left,
                  top: result.top,
                  dpr: result.dpr,
                  k: result.pixelScale,
                },
              );
              assert.deepEqual(result.smoothing, [false, false]);
              assert.equal(result.cssRendering, "pixelated");
              assert.equal(result.filter, "none");
              assert.ok(result.avatar.opaque > 0);
              evidence.push({ dpr, uiScale, lens, ...comparison, avatar: result.avatar });
            }
          }
          await page.evaluate(() => window.zoomScreen.dispose());
          assert.deepEqual(errors, []);
          assert.equal(guard.socketAttempts, 0);
        } finally {
          await page.close();
        }
      }
      console.log(`ZOOM_SCREEN_EVIDENCE ${JSON.stringify(evidence)}`);
      assert.ok(
        evidence.every((row) => row.differences === 0 && row.nonUniform === 0),
        "Final screenshot must preserve every pixel including edges and integer world blocks",
      );
    } finally {
      try {
        await browser.close();
      } finally {
        server.stop(true);
        await art.close();
      }
    }
  },
);
