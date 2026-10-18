/** Real Chromium frame evidence. Default is GET-only title; field mode is an explicit manual fixture. */
import assert from "node:assert/strict";
import { launchBrowser, browserOrigin, readOnlyBrowserPage } from "./browser.ts";
import { installBrowserObservation } from "./browser-observation.ts";
import { assertProbePackets, fixtureValue, type ProbeEnvironment } from "./browser-fixture.ts";
import { fieldFixture, enterProbeField } from "./probe-field.ts";
import { analyzeFrame, frameLayers, type FrameLayer } from "./probe-frame.ts";

export function frameProbeOptions(args: readonly string[], env: ProbeEnvironment) {
  if (args.includes("--allow-state-changes"))
    return {
      kind: "field" as const,
      fixture: fieldFixture(args, env),
      layers: frameLayers(fixtureValue(env, "PROBE_FRAME_LAYERS")),
    };
  if (args.length !== 1)
    throw new Error(
      "Supply one explicit origin for GET-only title, or --allow-state-changes with an admitted manual field fixture",
    );
  return {
    kind: "title" as const,
    origin: browserOrigin(args[0]),
    layers: ["title"] satisfies FrameLayer[],
  };
}
export async function probeFrame(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = frameProbeOptions(args, env);
  const origin = options.kind === "field" ? options.fixture.origin : options.origin;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(30000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(installBrowserObservation);
    const guard = options.kind === "title" ? await readOnlyBrowserPage(page, origin) : undefined;
    if (options.kind === "field") await enterProbeField(page, options.fixture);
    else {
      await page.goto(origin);
      await page.waitForFunction(() => document.documentElement.dataset.clientState === "ready");
    }
    const deadline = performance.now() + 30000;
    let evidence: ReturnType<typeof analyzeFrame>;
    do {
      const state = await page.evaluate(() => ({
        draws: window.__kmsProbe.draws,
        dropped: window.__kmsProbe.droppedMessages,
      }));
      if (state.dropped) throw new Error("Probe history overflow; cannot certify frame context");
      evidence = analyzeFrame(state.draws, origin, options.layers);
      if (evidence) break;
      await page.waitForTimeout(50);
    } while (performance.now() < deadline);
    await assertProbePackets(page);
    assert.deepEqual(errors, [], "no browser exceptions");
    if (guard) assert.equal(guard.socketAttempts, 0, "title must never connect to a game");
    if (!evidence)
      throw new Error(
        `No single presented frame contains ${options.layers.join(",")}; no fake images or ground fallback accepted`,
      );
    return {
      stage: options.kind === "title" ? "read-only-title" : "manual-fixture-field",
      ...evidence,
      errors,
      socketAttempts: guard?.socketAttempts,
    };
  } finally {
    await browser.close();
  }
}
if (import.meta.main) console.log(JSON.stringify(await probeFrame(process.argv.slice(2)), null, 2));
