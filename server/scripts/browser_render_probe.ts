/** Real-browser CPU/frame/draw profiler. Default: title only, GET-only and zero WebSockets.
 * Manual field profiling requires explicit origin, --allow-state-changes and PROBE_ACCOUNT/PASSWORD.
 * Login/logout may mutate a fixture even without keyboard movement; never use a player save.
 */
import assert from "node:assert/strict";
import { browserOrigin, launchBrowser, readOnlyBrowserPage } from "./browser.ts";
import { browserProbeOptions, fixtureBrowserOrigin, type ProbeAccount } from "./probe-options.ts";
export interface RenderSample {
  cpu: number;
  interval: number;
  draws: number;
}
declare global {
  interface Window {
    /** Initialized only by this tool's addInitScript, never required by production. */
    kmsRenderProbe?: { samples: RenderSample[]; draws: number; fieldSeen: boolean };
  }
}
export function sampleStats(samples: readonly RenderSample[], key: keyof RenderSample) {
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample[key]) || sample[key] < 0))
    throw new Error("Expected nonempty finite nonnegative render samples");
  const sorted = samples.map((sample) => sample[key]).sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}
export async function profileRender(target: string, account?: ProbeAccount) {
  const origin = account ? fixtureBrowserOrigin(target) : browserOrigin(target),
    browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const traffic = account ? undefined : await readOnlyBrowserPage(page, origin);
    await page.addInitScript(() => {
      const samples: RenderSample[] = [];
      const state = { samples, draws: 0, fieldSeen: false };
      window.kmsRenderProbe = state;
      const WS = window.WebSocket;
      window.WebSocket = class extends WS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("message", (event: MessageEvent<unknown>) => {
            if (typeof event.data !== "string") return;
            try {
              const message: unknown = JSON.parse(event.data);
              if (message && typeof message === "object" && "t" in message && message.t === "field")
                state.fieldSeen = true;
            } catch {
              /* A parse error is still owned by the real client; this observer never repairs it. */
            }
          });
        }
      };
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = new Proxy(draw, {
        apply(target, receiver: unknown, args: unknown[]) {
          state.draws++;
          Reflect.apply(target, receiver, args);
        },
      });
      const raf = window.requestAnimationFrame.bind(window);
      let previous: number | undefined;
      window.requestAnimationFrame = (callback) =>
        raf((now) => {
          if (callback.name !== "frame") return callback(now);
          const begin = performance.now();
          state.draws = 0;
          callback(now);
          state.samples.push({
            cpu: performance.now() - begin,
            interval: previous === undefined ? 0 : now - previous,
            draws: state.draws,
          });
          previous = now;
          if (state.samples.length > 1000) state.samples.shift();
        });
    });
    await page.goto(origin);
    await page.waitForFunction(() => document.documentElement.dataset.clientState === "ready");
    if (account) {
      await page.click("#title-continue");
      await page.fill("#user", account.user);
      await page.fill("#pass", account.password);
      await page.click("#login");
      await page.locator("#world-list button").first().click();
      await page.click("#world-connect");
      await page.locator("#character-list button").first().click();
      await page.click("#character-enter");
      await page.waitForFunction(() => window.kmsRenderProbe?.fieldSeen === true);
    }
    await page.waitForTimeout(8000);
    await page.evaluate(() => {
      if (!window.kmsRenderProbe) throw new Error("Profiler not initialized");
      window.kmsRenderProbe.samples.length = 0;
    });
    await page.waitForFunction(
      () => (window.kmsRenderProbe?.samples.length ?? 0) >= 120,
      undefined,
      { polling: 200, timeout: 60_000 },
    );
    const samples = await page.evaluate(() => window.kmsRenderProbe?.samples.slice(-120) ?? []);
    assert.equal(samples.length, 120);
    assert.deepEqual(errors, []);
    if (traffic) assert.equal(traffic.socketAttempts, 0, "Title profiler must never authenticate");
    return {
      stage: account ? "manual-fixture-field" : "read-only-title",
      samples: samples.length,
      cpuMs: sampleStats(samples, "cpu"),
      frameIntervalMs: sampleStats(samples, "interval"),
      draws: sampleStats(samples, "draws"),
      errors,
    };
  } finally {
    await browser.close();
  }
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--allow-state-changes")) {
    const options = browserProbeOptions(args, process.env);
    console.log(JSON.stringify(await profileRender(options.origin, options.account), null, 2));
  } else {
    if (args.length !== 1)
      throw new Error("Supply one explicit origin for read-only title profiling");
    console.log(JSON.stringify(await profileRender(browserOrigin(args[0])), null, 2));
  }
}
