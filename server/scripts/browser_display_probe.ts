/** Read-only real Chromium layout/device-pixel probe. No accounts, login or game input.
 * Diagnostic stripes exist only in this page's canvas and are never shipped as game art.
 * bun server/scripts/browser_display_probe.ts <explicit-web-port|http(s)://origin>
 */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { browserOrigin, launchBrowser, readOnlyBrowserPage } from "./browser.ts";

async function measure(page: Page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("view"),
      overlay = document.getElementById("game-ui");
    if (!(canvas instanceof HTMLCanvasElement) || !overlay)
      throw new Error("Missing display schema");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing 2D context");
    const r = canvas.getBoundingClientRect(),
      ui = overlay.getBoundingClientRect();
    return {
      dpr: devicePixelRatio,
      width: r.width,
      height: r.height,
      left: r.left,
      top: r.top,
      deviceScale: (r.width * devicePixelRatio) / 800,
      mode: canvas.dataset.displayMode,
      ui: [ui.left, ui.top, ui.width, ui.height],
      backing: [canvas.width, canvas.height],
      smoothing: context.imageSmoothingEnabled,
    };
  });
}
async function selectMode(page: Page, mode: "pixel" | "native" | "fit") {
  await page.locator("#view-scale").selectOption(mode, { force: true });
}
async function ready(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.clientState === "ready",
    undefined,
    { timeout: 10_000 },
  );
}
export async function probeDisplay(target: string) {
  const origin = browserOrigin(target),
    browser = await launchBrowser();
  const results = [];
  try {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const page = await browser.newPage({
        viewport: { width: 1001, height: 801 },
        deviceScaleFactor: dpr,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const traffic = await readOnlyBrowserPage(page, origin);
      await page.addInitScript(() => {
        const nativeRAF = window.requestAnimationFrame.bind(window);
        let frame: FrameRequestCallback | undefined;
        window.requestAnimationFrame = (callback) => {
          if (callback.name === "frame") {
            frame = callback;
            return 1;
          }
          return nativeRAF(callback);
        };
        // Hold title drawing while inspecting stripes. The explicit DPR phase then pumps one
        // REAL title frame: no synthetic resize, game login, input or player state injection.
        window.addEventListener("kms-probe-frame", () =>
          nativeRAF((now) => {
            frame?.(now);
            window.dispatchEvent(new Event("kms-probe-frame-done"));
          }),
        );
      });
      await page.goto(origin);
      await ready(page);
      const layout = await measure(page),
        unit = Math.round(layout.deviceScale);
      assert.ok(Math.abs(layout.deviceScale - unit) < 0.001);
      assert.deepEqual(layout.backing, [800, 600]);
      assert.equal(layout.smoothing, false);
      assert.ok(Math.abs(layout.left * dpr - Math.round(layout.left * dpr)) < 0.04);
      assert.ok(Math.abs(layout.top * dpr - Math.round(layout.top * dpr)) < 0.04);
      assert.ok(
        Math.abs(layout.ui[0] - layout.left) < 0.02 &&
          Math.abs(layout.ui[1] - layout.top) < 0.02 &&
          Math.abs(layout.ui[2] - layout.width) < 0.03,
      );
      await page.evaluate(() => {
        const canvas = document.getElementById("view");
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Expected canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Expected 2D context");
        for (let x = 0; x < 800; x++) {
          ctx.fillStyle = x % 2 ? "#fff" : "#000";
          ctx.fillRect(x, 0, 1, 600);
        }
      });
      const png = await page.screenshot();
      const row = await page.evaluate(
        async ({ encoded, left, top, count }) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
          );
          try {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
              ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Expected screenshot 2D context");
            ctx.drawImage(bitmap, 0, 0);
            const pixels = ctx.getImageData(left, top, count, 1).data;
            return Array.from({ length: count }, (_, i) => pixels[i * 4]);
          } finally {
            bitmap.close();
          }
        },
        {
          encoded: png.toString("base64"),
          left: Math.round(layout.left * dpr),
          top: Math.round(layout.top * dpr) + 10 * unit,
          count: 32 * unit,
        },
      );
      assert.deepEqual(
        [...new Set(row)].sort((a, b) => a - b),
        [0, 255],
        "No interpolated gray pixels",
      );
      for (let i = 0; i < row.length; i++)
        assert.equal(
          row[i],
          Math.floor(i / unit) % 2 ? 255 : 0,
          "Uniform device pixels per source column",
        );
      await selectMode(page, "fit");
      assert.deepEqual(
        await page.evaluate(() => {
          const canvas = document.getElementById("view");
          if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Expected canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Expected context");
          return [...ctx.getImageData(1, 0, 1, 1).data];
        }),
        [255, 255, 255, 255],
        "Presentation changes must not clear the canvas",
      );
      const fit = await measure(page);
      assert.ok(Math.abs(fit.width - 1001) < 0.02);
      assert.equal(fit.mode, "fit");
      await page.reload();
      await ready(page);
      assert.equal((await measure(page)).mode, "fit");
      await selectMode(page, "native");
      assert.equal((await measure(page)).width, 800);
      await selectMode(page, "pixel");
      await page.setViewportSize({ width: 1203, height: 903 });
      const resized = await measure(page);
      assert.ok(Math.abs(resized.deviceScale - Math.round(resized.deviceScale)) < 0.001);
      if (dpr === 1) {
        const session = await page.context().newCDPSession(page);
        try {
          // Observe a real title frame before and after a DPR-only change. The app's typed
          // display refresh handles engines that change DPR without media-query events.
          await page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                window.addEventListener("kms-probe-frame-done", () => resolve(), { once: true });
                window.dispatchEvent(new Event("kms-probe-frame"));
              }),
          );
          await session.send("Emulation.setDeviceMetricsOverride", {
            width: 1203,
            height: 903,
            deviceScaleFactor: 1.25,
            mobile: false,
          });
          await page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                window.addEventListener("kms-probe-frame-done", () => resolve(), { once: true });
                window.dispatchEvent(new Event("kms-probe-frame"));
              }),
          );
          await page
            .waitForFunction(
              () =>
                devicePixelRatio === 1.25 &&
                document.getElementById("view")?.getBoundingClientRect().width === 640,
              undefined,
              { polling: 50, timeout: 5000 },
            )
            .catch(async (error: unknown) => {
              throw new Error(
                `DPR change did not update display: ${JSON.stringify(await measure(page))}`,
                { cause: error },
              );
            });
        } finally {
          await session.detach();
        }
      }
      assert.deepEqual(errors, []);
      assert.equal(traffic.socketAttempts, 0, "Display probe must never open a game connection");
      results.push({ dpr, layout, unit, shades: [...new Set(row)], fitWidth: fit.width, errors });
      await page.close();
    }
    return results;
  } finally {
    await browser.close();
  }
}
if (import.meta.main)
  console.log(JSON.stringify(await probeDisplay(browserOrigin(process.argv[2])), null, 2));
