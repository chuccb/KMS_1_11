/** Manual portal regression. Explicit disposable fixture only; importing never runs it. */
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
export async function probePortal(args: readonly string[], env: ProbeEnvironment = process.env) {
  const flag = probeFlag(args, "--auto");
  const options = browserFixture(flag.args, env, false);

  const automatic = flag.enabled;

  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  try {
    await mkdir(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(installBrowserObservation);
    await fixtureLogin(page, options.origin, options.account);
    await page.locator("#world-list button").first().click();
    await page.click("#world-connect");
    await page.locator("#character-list button").first().click();
    await page.click("#character-enter");
    const field = async (id: number, index?: number) => {
      await page.waitForFunction(
        ({ id, index }) => {
          const f = window.__kmsProbe.messages.findLast((m) => m.t === "field");
          const move = window.__kmsProbe.sent.findLast((m) => m.t === "move");
          return (
            f?.mapId === id &&
            (index === undefined || f?.self.spawnPortal === index) &&
            !!move &&
            !!f &&
            move.at > f.at
          );
        },
        { id, index },
        { timeout: 60000 },
      );
      await page.waitForTimeout(650);
      const result = await page.evaluate(() => ({
        field: window.__kmsProbe.messages.findLast((m) => m.t === "field"),
        move: window.__kmsProbe.sent.findLast((m) => m.t === "move"),
      }));
      assert.ok(result.field && result.move);
      return { field: result.field, move: result.move };
    };
    const command = async (text: string) => {
      await page.fill("#say", text);
      await page.press("#say", "Enter");
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "",
        "command Enter exits chat instead of refocusing it",
      );
    };
    const lastMove = () =>
      page.evaluate(() => window.__kmsProbe.sent.findLast((m) => m.t === "move"));
    const walkTo = async (target: number) => {
      for (let i = 0; i < 24; i++) {
        const before = await lastMove();
        assert.ok(before);
        const distance = target - before.x;
        if (Math.abs(distance) <= 8) return;
        const key = distance > 0 ? "ArrowRight" : "ArrowLeft",
          ms = Math.min(1500, Math.max(35, (Math.abs(distance) / 125) * 1000 - 60));
        await page.evaluate(
          async ({ key, ms }) => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
            await new Promise((r) => setTimeout(r, ms));
            window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
          },
          { key, ms },
        );
        await page.waitForTimeout(350);
      }
      assert.fail(`walk did not reach ${target}: ${JSON.stringify(await lastMove())}`);
    };

    if (automatic) {
      const start = await field(105040200, 9);
      assert.ok(Math.abs(start.move.x - 887) < 1);
      await walkTo(985);
      await page.keyboard.down("ArrowDown");
      await page.keyboard.down("Alt");
      await page.waitForTimeout(120);
      await page.keyboard.up("Alt");
      await page.keyboard.up("ArrowDown");
      const arrival = await field(105040100, 16);
      assert.equal(arrival.move.x, 900);
      assert.ok(Math.abs(arrival.move.y + 1095) < 2);
      const sent = await page.evaluate(() =>
        window.__kmsProbe.sent.filter((m) => m.t === "portal"),
      );
      assert.equal(sent.length, 1);
      assert.equal(sent[0].name, "east00");
      await page.screenshot({
        path: fileURLToPath(new URL("portal-auto-native.png", output)),
        clip: await probeBox(page.locator("#view")),
      });
      console.log(
        "REAL TYPE-3 AUTO / AIRBORNE / NO UP / NATIVE TN OK",
        JSON.stringify({
          start: start.move,
          arrival: arrival.move,
          spawnPortal: arrival.field.self.spawnPortal,
          sent,
        }),
      );
    } else {
      await page.waitForFunction(
        () =>
          window.__kmsProbe.messages.some((m) => m.t === "field") &&
          window.__kmsProbe.sent.some((m) => m.t === "move"),
      );
      if (
        (await page.evaluate(() => window.__kmsProbe.messages.findLast((m) => m.t === "field")))
          ?.mapId !== 1000000
      )
        await command("/map 1000000");
      await field(1000000, 0);
      await walkTo(-391);
      await page.keyboard.down("ArrowUp");
      await field(50000, 2);
      await page.keyboard.up("ArrowUp");
      const there = await lastMove();
      assert.ok(there);
      assert.ok(Math.abs(there.x - 3041) < 2, "arrival must be east00, NOT sp at -183");
      await page.keyboard.down("ArrowUp");
      await field(1000000, 3);
      await page.keyboard.up("ArrowUp");
      console.log("REAL UP PORTAL / ROUND TRIP / NATIVE TN OK", JSON.stringify(there));
      await command("/map 1000001");
      await field(1000001, 0);
      await walkTo(1153);
      await page.keyboard.down("ArrowUp");
      await field(1000000, 1);
      await page.keyboard.up("ArrowUp");
      const hidden = await lastMove();
      assert.ok(hidden);
      assert.equal(hidden.x, -52);
      assert.ok(Math.abs(hidden.y + 385) < 15);
      // Type 1 is NOT automatic: leave the character standing in it for over the sender guard.
      const count = await page.evaluate(
        () => window.__kmsProbe.messages.filter((m) => m.t === "field").length,
      );
      await page.waitForTimeout(1000);
      assert.equal(
        await page.evaluate(() => window.__kmsProbe.messages.filter((m) => m.t === "field").length),
        count,
      );
      await page.keyboard.down("ArrowUp");
      await field(1000001, 5);
      await page.keyboard.up("ArrowUp");
      console.log("REAL HIDDEN TYPE-1 REQUIRES UP / TN INDEX OK", JSON.stringify(hidden));
      await command("/map 0");
      await field(0, 0);
      const zero = await lastMove();
      assert.ok(zero);
      assert.equal(zero.x, -206);
      await command("/where");
      await command("/maps 두갈래길");
      await command("/help");
      await page.waitForFunction(() =>
        document.querySelector("#chatbox")?.textContent?.includes("50000"),
      );
      await command("/map 123456789");
      await page.waitForFunction(() =>
        window.__kmsProbe.messages.some((m) => m.t === "chat" && m.text.includes("does not exist")),
      );
      assert.equal(
        (await page.evaluate(() => window.__kmsProbe.messages.findLast((m) => m.t === "field")))
          ?.mapId,
        0,
      );
      await command("/go 1000000");
      await field(1000000, 0);
      await page.screenshot({
        path: fileURLToPath(new URL("portal-roundtrip-native.png", output)),
        clip: await probeBox(page.locator("#view")),
      });
      console.log(
        "REAL MAP COMMAND / MAP ZERO / MAPS SEARCH / WHERE / MISSING MAP RECOVERY OK",
        JSON.stringify(zero),
      );
    }
    await assertProbePackets(page);
    assert.deepEqual(errors, []);
    const summary = await page.evaluate(() => ({
      fields: window.__kmsProbe.messages
        .filter((m) => m.t === "field")
        .map((m) => ({ map: m.mapId, index: m.self.spawnPortal })),
      portals: window.__kmsProbe.sent.filter((m) => m.t === "portal"),
      errors: window.__kmsProbe.messages.filter((m) => m.t === "error"),
    }));
    console.log("REAL BROWSER PORTAL OK", JSON.stringify({ ...summary, jsErrors: errors }));
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probePortal(process.argv.slice(2));
