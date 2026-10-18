/** Manual stat regression. Explicit disposable fixture only; importing never runs it. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.ts";
import {
  assertProbePackets,
  browserFixture,
  fixtureLogin,
  probeBox,
  type ProbeEnvironment,
} from "./browser-fixture.ts";
import { installBrowserObservation } from "./browser-observation.ts";
export async function probeStat(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = browserFixture(args, env, false);

  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  const errors: string[] = [],
    httpErrors: [number, string][] = [],
    results = [];
  try {
    await mkdir(output, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1000, height: 800 },
    });
    await context.addInitScript(installBrowserObservation);
    async function login() {
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400) httpErrors.push([r.status(), r.url()]);
      });
      await fixtureLogin(page, options.origin, options.account);
      await page.locator("#world-list button").first().click();
      await page.click("#world-connect");
      await page.locator("#character-list button").first().click();
      await page.click("#character-enter");
      await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "field"));
      await page.waitForTimeout(1600);
      return page;
    }
    const page = await login();
    const self = await page.evaluate(
      () =>
        window.__kmsProbe.messages.findLast((m) => m.t === "self")?.self ??
        window.__kmsProbe.messages.find((m) => m.t === "field")?.self,
    );
    assert.ok(self);
    assert.deepEqual(
      [self.str, self.dex, self.int, self.luk, self.ap],
      [8, 6, 6, 5, 6],
      "requires fresh isolated six-AP fixture",
    );
    await page.keyboard.press("s");
    await page.locator("#stat-window").waitFor();
    await page.waitForFunction(() =>
      window.__kmsProbe.draws.some((p) => p.src.endsWith("/Stat/backgrnd")),
    );
    const geometry = await page.evaluate(() => {
      const windowElement = document.getElementById("stat-window"),
        view = document.getElementById("view");
      if (!windowElement || !view) throw new Error("Missing stat geometry");
      const r = windowElement.getBoundingClientRect(),
        c = view.getBoundingClientRect(),
        scale = c.width / 800;
      return {
        x: (r.x - c.x) / scale,
        y: (r.y - c.y) / scale,
        w: r.width / scale,
        h: r.height / scale,
      };
    });
    assert.deepEqual(geometry, { x: 72, y: 72, w: 176, h: 315 });
    for (const id of ["ap-maxHp", "ap-maxMp", "stat-detail"])
      assert.equal(await page.locator("#" + id).isDisabled(), true);
    let count = 0;
    for (const field of ["str", "dex", "int", "luk", "str", "str"]) {
      await page.locator("#ap-" + field).click();
      count++;
      await page.waitForFunction(
        (n) => window.__kmsProbe.messages.filter((m) => m.t === "ability-result").length >= n,
        count,
      );
      const ack = await page.evaluate(() =>
        window.__kmsProbe.messages.findLast((m) => m.t === "ability-result"),
      );
      assert.ok(ack);
      assert.equal(ack.changed, true);
      assert.equal(
        await page.locator("#ap-str").isDisabled(),
        count === 6,
        "native AP buttons stay visibly enabled while points remain; gating is in the sender",
      );
      await page.locator("#ap-dex").dispatchEvent("click");
      assert.equal(
        await page.evaluate(
          () => window.__kmsProbe.sent.filter((m) => m.t === "ability-up").length,
        ),
        count,
        "even synthetic clicks cannot bypass pending or cooldown",
      );
      if (count === 1) {
        await page.waitForTimeout(350);
        await page.screenshot({
          path: fileURLToPath(new URL("stat-ability-native.png", output)),
          clip: await probeBox(page.locator("#stat-window")),
        });
      }
      if (count < 6) await page.waitForTimeout(520);
    }
    const updated = await page.evaluate(
      () => window.__kmsProbe.messages.findLast((m) => m.t === "self")?.self,
    );
    assert.ok(updated);
    assert.deepEqual(
      [updated.str, updated.dex, updated.int, updated.luk, updated.ap],
      [11, 7, 7, 6, 0],
    );
    for (const field of ["str", "dex", "int", "luk"])
      assert.equal(await page.locator("#ap-" + field).isDisabled(), true);
    await page.waitForFunction(() =>
      document.getElementById("stat-values")?.textContent?.includes("STR 11"),
    );
    assert.match(
      (await page.locator("#stat-values").textContent()) ?? "",
      /STR 11 DEX 7 INT 7 LUK 6 AP 0/,
    );
    // Drag in CSS-scaled coordinates; keep the complete native window within 800x600.
    const r = await probeBox(page.locator("#stat-window")),
      scale = r.width / 176;
    await page.mouse.move(r.x + 30 * scale, r.y + 25 * scale);
    await page.mouse.down();
    await page.mouse.move(r.x + 110 * scale, r.y + 65 * scale, { steps: 5 });
    await page.mouse.up();
    const position = await page.evaluate((): unknown =>
      JSON.parse(localStorage.getItem("kms111.statAt") ?? "null"),
    );
    assert.deepEqual(position, { x: 152, y: 112 });
    await page.keyboard.press("Escape");
    await page.locator("#stat-window").waitFor({ state: "hidden" });
    // Also test the original status-menu path, not only the browser's S shortcut.
    const view = await probeBox(page.locator("#view"));
    await page.mouse.click(view.x + (56 * view.width) / 800, view.y + (475 * view.height) / 600);
    await page.locator("#stat-window").waitFor();
    await page.waitForTimeout(500);
    await page.waitForFunction(() => window.__kmsProbe.activeBlobs.size === 0);
    const screenshot = fileURLToPath(new URL("stat-field-native.png", output));
    await page.screenshot({ path: screenshot, clip: view });
    results.push({
      geometry,
      updated: {
        str: updated.str,
        dex: updated.dex,
        int: updated.int,
        luk: updated.luk,
        ap: updated.ap,
      },
      position,
      allocations: count,
      screenshot,
    });
    await assertProbePackets(page);
    await page.close();
    await new Promise((r) => setTimeout(r, 250));
    const again = await login();
    const saved = await again.evaluate(
      () => window.__kmsProbe.messages.find((m) => m.t === "field")?.self,
    );
    assert.ok(saved);
    assert.deepEqual(
      [saved.str, saved.dex, saved.int, saved.luk, saved.ap],
      [11, 7, 7, 6, 0],
      "allocation persists across a real reconnect",
    );
    await again.keyboard.press("s");
    await again.locator("#stat-window").waitFor();
    assert.deepEqual(
      await again.evaluate(() => ({
        x: parseFloat(document.getElementById("stat-window")?.style.left ?? "NaN"),
        y: parseFloat(document.getElementById("stat-window")?.style.top ?? "NaN"),
      })),
      position,
    );
    await again.click("#stat-close");
    await again.locator("#stat-window").waitFor({ state: "hidden" });
    await assertProbePackets(again);
    await context.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    console.log(
      JSON.stringify(
        { results, reconnect: true, blobUrlsReleased: true, errors, httpErrors },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probeStat(process.argv.slice(2));
