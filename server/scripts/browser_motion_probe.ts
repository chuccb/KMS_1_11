/** Manual motion regression. Explicit disposable fixture only; importing never runs it. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.ts";
import {
  assertProbePackets,
  browserFixture,
  fixtureLogin,
  probeBox,
  probeFlag,
  type ProbeEnvironment,
} from "./browser-fixture.ts";
import { installBrowserObservation } from "./browser-observation.ts";
export async function probeMotion(args: readonly string[], env: ProbeEnvironment = process.env) {
  const flag = probeFlag(args, "--climb");
  const options = browserFixture(flag.args, env, false);

  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  try {
    await mkdir(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    // Capture the viewport crop directly: locator.screenshot waits for stable RAF layout while
    // software-rendered continuous game frames may starve that wait under a concurrent test suite.
    const screenshot = async (name: string) =>
      page.screenshot({
        path: fileURLToPath(new URL(name, output)),
        clip: await probeBox(page.locator("#view")),
      });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(installBrowserObservation);
    await fixtureLogin(page, options.origin, options.account);
    await page.locator("#world-list button").first().click();
    await page.click("#world-connect");
    await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "characters"));
    assert.ok(
      await page.locator("#character-list button").count(),
      "Seed a native character in the disposable fixture first",
    );
    await page.locator("#character-list button").first().click();
    await page.click("#character-enter");
    await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "field"));
    await page.waitForTimeout(4000); // preload the archive images; no synthetic scene injection

    await screenshot("map-before.png");
    await page.keyboard.press("Escape");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1000);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(300);
    const jumpStart = await page.evaluate(() => window.__kmsProbe.sent.length);
    await page.keyboard.down("Alt");
    await page.waitForTimeout(150);
    await page.keyboard.up("Alt");
    await screenshot("map-jump.png");
    await page.waitForTimeout(1200);
    await screenshot("map-after.png");
    const { moves, jump, mob } = await page.evaluate(
      (start) => ({
        moves: window.__kmsProbe.sent.filter((m) => m.t === "move"),
        jump: window.__kmsProbe.sent.slice(start).filter((m) => m.t === "move"),
        mob: window.__kmsProbe.messages.find((m) => m.t === "mob-move"),
      }),
      jumpStart,
    );
    await assertProbePackets(page);
    assert.deepEqual(errors, [], "no browser exceptions");
    // 508FC0 movement table: walk=2, jump=6, rope=16 (before facing bit).
    // Body/avatar actions 35/36/37 must NOT be doubled onto the movement wire.
    assert.ok(
      moves.some((m) => m.vx === 125 && (m.action & ~1) === 2),
      "original walking baseline",
    );
    assert.ok(
      jump.some((m) => m.vy < 0 && m.foothold === 0 && (m.action & ~1) === 6),
      "ascending jump",
    );
    assert.ok(
      jump.some((m) => m.vy > 0 && m.foothold === 0),
      "falling jump",
    );
    const landed = jump.at(-1);
    assert.ok(landed && landed.foothold > 0 && landed.vy === 0, "landed on a real foothold");
    assert.ok(
      mob?.path?.elements?.some((e) => e.duration > 100),
      "mob path duration survives the bridge",
    );
    if (flag.enabled) {
      // First Amherst map: real rope 3 at x=718, WZ y=97..273. Walk there, do not inject position.
      const x = () =>
        page.evaluate(() => window.__kmsProbe.sent.findLast((m) => m.t === "move")?.x ?? -91);
      await page.keyboard.down("ArrowRight");
      await page.waitForFunction(
        () => (window.__kmsProbe.sent.findLast((m) => m.t === "move")?.x ?? -91) >= 560,
        null,
        { timeout: 20000 },
      );
      // The original ground has a 60px upward wall at x=591: jump it, don't assert walking through it.
      await page.keyboard.down("Alt");
      await page.waitForTimeout(350);
      await page.keyboard.up("Alt");
      await page.waitForFunction(
        () => (window.__kmsProbe.sent.findLast((m) => m.t === "move")?.x ?? -91) >= 704,
        null,
        { timeout: 20000 },
      );
      await page.keyboard.up("ArrowRight");
      await page.waitForTimeout(400);
      for (let i = 0; i < 15 && Math.abs((await x()) - 718) > 4; i++) {
        const current = await x();
        const key = current < 718 ? "ArrowRight" : "ArrowLeft";
        const distance = Math.abs(current - 718);
        const ms = Math.min(
          180,
          distance < 15 ? Math.sqrt(distance / 1925) * 1000 : (distance - 4.18) * 8,
        );
        // Browser-local key pulses avoid DevTools round-trip latency holding a 50ms tap for 200ms.
        // These are normal input events through the game's handlers, never position/state injection.
        await page.evaluate(
          async ({ key, ms }) => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, ms));
            window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
          },
          { key, ms },
        );
        await page.waitForTimeout(350);
      }
      await page.keyboard.down("ArrowUp");
      await page.waitForTimeout(1000);
      await page.keyboard.up("ArrowUp");
      await page.waitForTimeout(300);
      const hanging = await page.evaluate(() =>
        window.__kmsProbe.sent.findLast((m) => m.t === "move"),
      );
      assert.ok(hanging);
      assert.equal(hanging.action & ~1, 16, `attached to a real rope: ${JSON.stringify(hanging)}`);
      assert.equal(hanging.vy, 0, "rope stops moving without Up/Down");
      assert.equal(hanging.x, 718);
      await screenshot("map-rope-fixed.png");
      await page.waitForTimeout(500);
      const stopped = await page.evaluate(() =>
        window.__kmsProbe.sent.findLast((m) => m.t === "move"),
      );
      assert.ok(stopped);
      assert.equal(stopped.y, hanging.y, "holding still must not slide");
      await page.keyboard.down("ArrowUp");
      await page.waitForFunction(
        () => {
          const m = window.__kmsProbe.sent.findLast((m) => m.t === "move");
          return m?.foothold === 277 && m.y === 95;
        },
        null,
        { timeout: 6000 },
      );
      await page.waitForTimeout(2000); // Keep Up held after reaching the REAL top, then release it.
      await page.keyboard.up("ArrowUp");
      await page.waitForTimeout(1500);
      const top = await page.evaluate(() => window.__kmsProbe.sent.findLast((m) => m.t === "move"));
      assert.ok(top);
      assert.deepEqual([top.x, top.y, top.foothold, top.vy], [718, 95, 277, 0]);
      await screenshot("map-rope-top-fixed.png");
      console.log("REAL ROPE TOP / HELD UP / RELEASED STABILITY OK", JSON.stringify(top));
      await page.keyboard.down("ArrowRight");
      await page.keyboard.down("Alt");
      await page.waitForTimeout(200);
      await page.keyboard.up("Alt");
      await page.keyboard.up("ArrowRight");
      await page.waitForTimeout(800);
      console.log("REAL ROPE ATTACH / CLIMB / STOP / JUMP OK", JSON.stringify(hanging));
    }
    const audio = await page.evaluate(() => window.__kmsProbe.audio);
    assert.ok(
      audio.some((a) => a.loop && (a.duration ?? 0) > 60 && a.energy && a.state === "running"),
      "native BGM decoded and started in a running AudioContext",
    );
    assert.ok(
      audio.some((a) => !a.loop && (a.duration ?? Infinity) < 0.2 && a.energy),
      "native Jump/UI effect decoded and started separately",
    );
    console.log("REAL AUDIO DECODE / PLAYBACK OK", JSON.stringify(audio));
    console.log(
      JSON.stringify(
        {
          moves: moves.length,
          jump: jump.map(({ x, y, vy, foothold, action }) => ({ x, y, vy, foothold, action })),
          mobDuration: mob?.path?.elements[0]?.duration,
          errors,
          screenshots: fileURLToPath(output),
        },
        null,
        2,
      ),
    );
    await assertProbePackets(page);
    assert.deepEqual(errors, [], "including climb/audio callbacks");
    console.log("REAL BROWSER MOTION OK");
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probeMotion(process.argv.slice(2));
