/** Explicit disposable-fixture keyboard playthrough. No raw protocol sends, teleport or default account. */
import type { Keyboard } from "playwright-core";
import { launchBrowser } from "./browser.ts";
import { installBrowserObservation } from "./browser-observation.ts";
import { fixtureValue, assertProbePackets, type ProbeEnvironment } from "./browser-fixture.ts";
import { fieldFixture, enterProbeField } from "./probe-field.ts";
import { playCycle, readPlayPlan, type PlayStep } from "./probe-play.ts";

export function playProbeOptions(args: readonly string[], env: ProbeEnvironment) {
  const fixture = fieldFixture(args, env);
  return { ...fixture, planPath: fixtureValue(env, "PROBE_PLAY_PLAN") };
}
/** Release every successfully held key on success AND failure, even if another key-up fails. */
export async function holdPlayKeys(
  keyboard: Pick<Keyboard, "down" | "up">,
  step: Extract<PlayStep, { kind: "hold" }>,
  wait: (ms: number) => Promise<void>,
) {
  const held: string[] = [],
    errors: unknown[] = [];
  try {
    for (const key of step.keys) {
      await keyboard.down(key);
      held.push(key);
    }
    await wait(step.durationMs);
  } catch (error) {
    errors.push(error);
  }
  for (const key of held.reverse()) {
    try {
      await keyboard.up(key);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Play input failed; all held-key releases were attempted");
}
export async function probePlay(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = playProbeOptions(args, env);
  const file = Bun.file(options.planPath);
  if (!(await file.exists()) || file.size === 0 || file.size > 65536)
    throw new Error("Play plan must be an existing nonempty JSON file <=65536 bytes");
  const value: unknown = await file.json(),
    plan = readPlayPlan(value);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(30000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(installBrowserObservation);
    await enterProbeField(page, options);
    await page.locator("#view").focus();
    const after = await page.evaluate(() => window.__kmsProbe.sequence);
    let cursor = after;
    for (const step of plan.steps) {
      const status = await page.evaluate(() => ({
        sequence: window.__kmsProbe.sequence,
        dropped: window.__kmsProbe.droppedMessages,
      }));
      if (status.dropped) throw new Error("Play history overflow; cannot certify a partial trace");
      await assertProbePackets(page);
      if (step.kind === "hold") {
        cursor = Math.max(cursor, status.sequence);
        await holdPlayKeys(page.keyboard, step, (ms) => page.waitForTimeout(ms));
      } else {
        await page.waitForFunction(
          ({ after, event }) =>
            window.__kmsProbe.messages.some(
              (packet) => packet.sequence > after && packet.t === event,
            ),
          { after: cursor, event: step.event },
          { timeout: step.timeoutMs },
        );
        const found = await page.evaluate(
          ({ after, event }) =>
            window.__kmsProbe.messages.find(
              (packet) => packet.sequence > after && packet.t === event,
            )?.sequence,
          { after: cursor, event: step.event },
        );
        if (found === undefined) throw new Error("Awaited event left the bounded history");
        cursor = found;
      }
    }
    await assertProbePackets(page);
    const state = await page.evaluate(() => ({
      messages: window.__kmsProbe.messages,
      dropped: window.__kmsProbe.droppedMessages,
    }));
    if (state.dropped) throw new Error("Play history overflow");
    if (errors.length) throw new Error(`Browser exceptions: ${errors.join("; ")}`);
    const evidence = playCycle(state.messages, plan, options.characterId, after);
    if (!evidence)
      throw new Error(
        "No correlated fresh hit/death/drop/self-pickup/notice and item-inventory or meso-wallet increase; scenario not certified",
      );
    return { stage: "manual-fixture-play", ...evidence, steps: plan.steps.length, errors };
  } finally {
    await browser.close();
  }
}
if (import.meta.main) console.log(JSON.stringify(await probePlay(process.argv.slice(2)), null, 2));
