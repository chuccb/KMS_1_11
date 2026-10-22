/**
 * The 800x600 UI buffer is upscaled onto the same output as the world, and nothing verified that
 * upscale pixel-for-pixel until now. This drives both passes through the production surface with a
 * worst-case opaque pattern and compares the **final screenshot** against the crisp backing store -
 * the same standard `zoom-display-browser.test.ts` sets for the world.
 *
 * It also covers the default `pixel` (auto) mode and the `wide` lens, which that test never
 * exercises, and it asserts the integer-pixel invariant the whole display policy rests on: every
 * device-pixel block of one source pixel must be uniform. A non-uniform block means a source pixel
 * was resampled - which is the blur this project refuses to ship.
 */
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
import "./fixtures/display-ui-surface.ts";

const PAGE =
  '<!doctype html><link rel="stylesheet" href="/style.css"><div id="game-viewport">' +
  '<div id="game-stage"><canvas id="view"></canvas><div id="game-ui"></div></div></div>' +
  '<select id="view-scale" class="hidden"></select>' +
  '<script type="module">import{installDisplayUiSurface}from"/fixture.js";installDisplayUiSurface();</script>';

test(
  "the UI pass is upscaled as whole pixels: final screenshot preserves the world AND the 800x600 UI",
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
      entrypoints: [resolve(import.meta.dirname, "fixtures/display-ui-surface.ts")],
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
          return new Response(PAGE, { headers: { "content-type": "text/html" } });
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
      const evidence: {
        dpr: number;
        mode: DisplayMode;
        lens: LensMode;
        deviceScale: number;
        differences: number;
        nonUniform: number;
      }[] = [];
      for (const dpr of [1, 1.5, 2]) {
        const page = await browser.newPage({ deviceScaleFactor: dpr }),
          errors: string[] = [];
        try {
          page.on("pageerror", (error) => errors.push(error.message));
          const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
          await page.setViewportSize({
            width: Math.ceil(3400 / dpr),
            height: Math.ceil(2600 / dpr),
          });
          await page.goto(`http://127.0.0.1:${server.port}`);
          await page.waitForFunction(() => !!window.displayUiSurface);
          for (const mode of ["pixel", "pixel-1", "pixel-2"] satisfies DisplayMode[]) {
            for (const lens of ["wide", "normal", "detail"] satisfies LensMode[]) {
              const result: Awaited<ReturnType<Window["displayUiSurface"]["paint"]>> =
                await page.evaluate((input) => window.displayUiSurface.paint(input), {
                  mode,
                  lens,
                  background,
                  tile,
                });
              const screenshot = await page.screenshot();
              const comparison = await page.evaluate(
                async (input) => {
                  const decode = async (url: string) =>
                    createImageBitmap(await (await fetch(url)).blob());
                  const source = await decode(input.source),
                    screen = await decode(input.screen);
                  try {
                    const a = new OffscreenCanvas(source.width, source.height).getContext("2d"),
                      b = new OffscreenCanvas(screen.width, screen.height).getContext("2d");
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
                      nonUniform = 0;
                    for (let i = 0; i < expected.length; i++)
                      if (expected[i] !== actual[i]) differences++;
                    // One source pixel is exactly k x k device pixels; every one must be uniform.
                    const k = input.k,
                      w = source.width;
                    for (let by = 0; by + k <= source.height; by += k)
                      for (let bx = 0; bx + k <= w; bx += k) {
                        const i0 = (by * w + bx) * 4;
                        outer: for (let dy = 0; dy < k; dy++)
                          for (let dx = 0; dx < k; dx++) {
                            const i = ((by + dy) * w + bx + dx) * 4;
                            for (let c = 0; c < 4; c++)
                              if (actual[i + c] !== actual[i0 + c]) {
                                nonUniform++;
                                break outer;
                              }
                          }
                      }
                    return { differences, nonUniform };
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
                  k: result.deviceScale,
                },
              );
              assert.deepEqual(result.smoothing, [false, false], "nearest-neighbour everywhere");
              assert.equal(result.cssRendering, "pixelated");
              const { png, ...shape } = result;
              assert.ok(png.startsWith("data:image/png;base64,"));
              evidence.push({
                dpr,
                mode,
                lens,
                deviceScale: shape.deviceScale,
                ...comparison,
              });
            }
          }
          await page.evaluate(() => window.displayUiSurface.dispose());
          assert.deepEqual(errors, []);
          assert.equal(guard.socketAttempts, 0);
        } finally {
          await page.close();
        }
      }
      console.log(`DISPLAY_UI_EVIDENCE ${JSON.stringify(evidence)}`);
      // Guard against the matrix silently shrinking: a passing subset proves nothing.
      assert.equal(evidence.length, 27, "3 DPRs x 3 display modes x 3 lenses");
      assert.ok(
        evidence.every((row) => row.differences === 0 && row.nonUniform === 0),
        "every source pixel must reach the screen as one uniform block of whole device pixels",
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
