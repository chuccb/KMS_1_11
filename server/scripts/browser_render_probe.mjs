/** Read-only render profiler; normal login on the disposable alt account, no movement/state injection. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.renderSamples = [];
    window.drawCount = 0;
    window.qaMessages = [];
    const W = window.WebSocket;
    window.WebSocket = class extends W {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            window.qaMessages.push(JSON.parse(e.data));
          } catch {}
        });
      }
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      window.drawCount++;
      return draw.apply(this, args);
    };
    const raf = window.requestAnimationFrame;
    let previous;
    window.requestAnimationFrame = (callback) =>
      raf((now) => {
        if (callback.name !== "frame") return callback(now);
        const begin = performance.now();
        window.drawCount = 0;
        callback(now);
        window.renderSamples.push({
          cpu: performance.now() - begin,
          interval: previous === undefined ? 0 : now - previous,
          draws: window.drawCount,
        });
        previous = now;
        if (window.renderSamples.length > 1000) window.renderSamples.shift();
      });
  });
  await page.goto(`http://127.0.0.1:${process.argv[2] ?? 8495}/`);
  await page.click("#title-continue");
  await page.fill("#user", process.env.BROWSER_ACCOUNT ?? "alt");
  await page.fill("#pass", process.env.BROWSER_PASSWORD ?? "alt");
  await page.click("#login");
  await page.locator("#world-list button").first().click();
  await page.click("#world-connect");
  await page.locator("#character-list button").first().click();
  await page.click("#character-enter");
  await page.waitForFunction(() =>
    window.qaMessages.some((m) => m.t === "field"),
  );
  await page.waitForTimeout(8000);
  await page.evaluate(() => (window.renderSamples = []));
  await page.waitForFunction(() => window.renderSamples.length >= 120, null, {
    polling: 200,
    timeout: 60000,
  });
  const samples = await page.evaluate(() => window.renderSamples.slice(-120));
  const stats = (key) => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    return {
      median: sorted[60],
      p95: sorted[114],
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    };
  };
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        samples: samples.length,
        cpuMs: stats("cpu"),
        frameIntervalMs: stats("interval"),
        draws: stats("draws"),
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
