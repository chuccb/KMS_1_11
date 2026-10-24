/** Read-only, explicit target. Real screenshot pixels, all fixed resolutions, DPR-only change and
 * small-viewport scrolling. Diagnostic stripes affect this isolated title page only, never art.
 */
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { browserOrigin, launchBrowser, readOnlyBrowserPage } from "./browser.ts";
import { RESOLUTION_OPTIONS } from "../../client/display.ts";
async function measure(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.getElementById("view"),
      overlay = document.getElementById("game-ui"),
      scroll = document.getElementById("game-viewport");
    if (!(canvas instanceof HTMLCanvasElement) || !overlay || !scroll)
      throw new Error("Missing display schema");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No output context");
    const cursor = getComputedStyle(canvas).cursor.match(/url\("([^\"]+)"\)\s+([\d.]+)dppx/);
    if (!cursor) throw new Error("Native cursor is missing its physical bitmap density");
    const bitmap = await createImageBitmap(await (await fetch(cursor[1]!)).blob()),
      cursorSize = [bitmap.width, bitmap.height];
    bitmap.close();
    const r = canvas.getBoundingClientRect(),
      ui = overlay.getBoundingClientRect();
    return {
      dpr: devicePixelRatio,
      cursor: { size: cursorSize, density: Number(cursor[2]) },
      width: r.width,
      height: r.height,
      left: r.left,
      top: r.top,
      resolutionScale: canvas.width / 800,
      resolution: canvas.dataset.resolution,
      ui: [ui.left, ui.top, ui.width, ui.height],
      backing: [canvas.width, canvas.height],
      smoothing: ctx.imageSmoothingEnabled,
      scroll: [scroll.scrollLeft, scroll.scrollTop],
      overflow:
        scroll.scrollWidth > scroll.clientWidth || scroll.scrollHeight > scroll.clientHeight,
    };
  });
}
async function pump(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener("kms-probe-frame-done", () => resolve(), { once: true });
        window.dispatchEvent(new Event("kms-probe-frame"));
      }),
  );
}
async function stripes(page: Page) {
  const layout = await measure(page),
    option = RESOLUTION_OPTIONS.find(({ id }) => id === layout.resolution);
  assert.ok(option, `Known fixed resolution: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.backing, [option.width, option.height]);
  assert.ok(Math.abs(layout.width * layout.dpr - option.width) < 0.03);
  assert.ok(Math.abs(layout.height * layout.dpr - option.height) < 0.03);
  assert.equal(layout.smoothing, false);
  assert.deepEqual(layout.cursor.size, [24, 23]);
  assert.ok(Math.abs(layout.cursor.density - layout.dpr) < 1e-5);
  assert.ok(Math.abs(layout.width / layout.height - 4 / 3) < 0.0001);
  assert.ok(
    Math.abs(layout.ui[0] - layout.left) < 0.03 &&
      Math.abs(layout.ui[1] - layout.top) < 0.03 &&
      Math.abs(layout.ui[2] - layout.width) < 0.05,
  );
  await page.evaluate(() => {
    const canvas = document.getElementById("view");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("No output");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No context");
    for (let x = 0; x < canvas.width; x++) {
      ctx.fillStyle = x % 2 ? "#fff" : "#000";
      ctx.fillRect(x, 0, 1, canvas.height);
    }
  });
  const png = await page.screenshot();
  // Start inside the visible canvas. The scroll origin is snapped to the shared CSS/device grid.
  const left = Math.max(0, Math.round(layout.left * layout.dpr)),
    top = Math.max(0, Math.round(layout.top * layout.dpr)) + 10;
  const row = await page.evaluate(
    async ({ encoded, left, top, count }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
      );
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
          ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No screenshot context");
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(left, top, count, 1).data;
        return Array.from({ length: count }, (_, i) => data[i * 4]);
      } finally {
        bitmap.close();
      }
    },
    { encoded: png.toString("base64"), left, top, count: 32 },
  );
  assert.deepEqual(
    [...new Set(row)].sort((a, b) => a - b),
    [0, 255],
    `No interpolated gray pixels: ${JSON.stringify(layout)}`,
  );
  const sourceOffset = Math.round(left - layout.left * layout.dpr);
  for (let i = 0; i < row.length; i++)
    assert.equal(
      row[i],
      Math.floor(i + sourceOffset) % 2 ? 255 : 0,
      "One screenshot physical pixel per source pixel, including scroll",
    );
  return layout;
}
export async function probeDisplay(target: string) {
  const origin = browserOrigin(target),
    browser = await launchBrowser(),
    results = [];
  try {
    for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 3]) {
      const page = await browser.newPage({
          viewport: { width: 1001, height: 801 },
          deviceScaleFactor: dpr,
        }),
        errors: string[] = [];
      try {
        page.on("pageerror", (error) => errors.push(error.message));
        const traffic = await readOnlyBrowserPage(page, origin);
        await page.addInitScript(() => {
          const raf = window.requestAnimationFrame.bind(window);
          let frame: FrameRequestCallback | undefined;
          window.requestAnimationFrame = (callback) => {
            if (callback.name === "frame") {
              frame = callback;
              return 1;
            }
            return raf(callback);
          };
          window.addEventListener("kms-probe-frame", () =>
            raf((now) => {
              frame?.(now);
              window.dispatchEvent(new Event("kms-probe-frame-done"));
            }),
          );
        });
        await page.goto(origin);
        await page.waitForFunction(() => document.documentElement.dataset.clientState === "ready");
        await page.waitForFunction(() =>
          document.getElementById("view")?.classList.contains("native-cursor-ready"),
        );
        await pump(page);
        const layouts = [];
        for (const { id } of RESOLUTION_OPTIONS) {
          await page.locator("#view-scale").selectOption(id, { force: true });
          await pump(page);
          layouts.push(await stripes(page));
        }
        await page.locator("#view-scale").selectOption("1024x768", { force: true });
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.clientState === "ready");
        await page.waitForFunction(() =>
          document.getElementById("view")?.classList.contains("native-cursor-ready"),
        );
        assert.equal((await measure(page)).resolution, "1024x768");
        await page.locator("#view-scale").selectOption("800x600", { force: true });
        await page.setViewportSize({ width: 401, height: 301 });
        await pump(page);
        assert.deepEqual((await measure(page)).backing, [800, 600]);
        if (dpr < 2) {
          assert.equal((await measure(page)).overflow, true);
          await page.evaluate(() => {
            const scroll = document.getElementById("game-viewport");
            if (!scroll) throw new Error("No scroll surface");
            scroll.scrollLeft = 64;
            scroll.scrollTop = 64;
          });
          await page.waitForTimeout(80);
          await stripes(page);
          await page.evaluate(() => {
            const scroll = document.getElementById("game-viewport");
            if (!scroll) throw new Error("No scroll surface");
            scroll.scrollLeft = 1e9;
            scroll.scrollTop = 1e9;
          });
          await page.waitForTimeout(80);
          await stripes(page);
        }
        if (dpr === 1) {
          await page.setViewportSize({ width: 1203, height: 903 });
          await page.locator("#view-scale").selectOption("1600x1200", { force: true });
          await pump(page);
          const session = await page.context().newCDPSession(page);
          try {
            await session.send("Emulation.setDeviceMetricsOverride", {
              width: 1203,
              height: 903,
              deviceScaleFactor: 1.25,
              mobile: false,
            });
            await pump(page);
            await page.waitForFunction(
              () =>
                devicePixelRatio === 1.25 &&
                document.getElementById("view")?.getBoundingClientRect().width === 1280,
            );
            const layout = await measure(page);
            assert.equal(layout.resolution, "1600x1200");
            assert.deepEqual(layout.backing, [1600, 1200]);
            assert.equal(layout.overflow, true);
            assert.deepEqual(layout.cursor.size, [24, 23]);
            assert.ok(Math.abs(layout.cursor.density - 1.25) < 1e-5);
          } finally {
            await session.detach();
          }
        }
        assert.deepEqual(errors, []);
        assert.equal(traffic.socketAttempts, 0);
        results.push({ dpr, layouts, errors });
      } finally {
        await page.close();
      }
    }
    return results;
  } finally {
    await browser.close();
  }
}
if (import.meta.main)
  console.log(JSON.stringify(await probeDisplay(browserOrigin(process.argv[2])), null, 2));
