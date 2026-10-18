/** Manual minimap regression. Explicit disposable fixture only; importing never runs it. */
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
export async function probeMinimap(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = browserFixture(args, env, false);

  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  try {
    await mkdir(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(45000);
    const errors: string[] = [],
      httpErrors: [number, string][] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push([r.status(), r.url()]);
    });
    await page.addInitScript(installBrowserObservation);
    await fixtureLogin(page, options.origin, options.account);
    await page.locator("#world-list button").first().click();
    await page.click("#world-connect");
    await page.locator("#character-list button").first().click();
    await page.click("#character-enter");
    await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "field"));
    const command = async (text: string) => {
      await page.fill("#say", text);
      await page.press("#say", "Enter");
    };
    const enter = async (id: number) => {
      const before = await page.evaluate(
        () => window.__kmsProbe.messages.filter((m) => m.t === "field").length,
      );
      await command(`/map ${id}`);
      await page.waitForFunction(
        ({ id, before }) => {
          const fields = window.__kmsProbe.messages.filter((m) => m.t === "field");
          return fields.length > before && fields.at(-1)?.mapId === id;
        },
        { id, before },
      );
    };
    if (
      (await page.evaluate(() => window.__kmsProbe.messages.findLast((m) => m.t === "field")))
        ?.mapId !== 1000000
    )
      await enter(1000000);
    await page.waitForFunction(
      () =>
        window.__kmsProbe.miniBlits.some((b) => b.src.includes("/001000000.img/")) &&
        window.__kmsProbe.miniMarks.length > 0,
    );
    const mini = page.locator("#minimap-window");
    assert.equal(await mini.isVisible(), true);
    const initial = await probeBox(mini);
    assert.deepEqual([initial.width, initial.height], [257, 113]);
    const mark0 = await page.evaluate(() => window.__kmsProbe.miniMarks.at(-2));
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1000);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(650);
    const mark1 = await page.evaluate(() => window.__kmsProbe.miniMarks.at(-2));
    assert.ok(mark0 && mark1);
    assert.ok(mark1[0] > mark0[0], "local yellow marker follows the real player");
    await page.keyboard.press("m");
    assert.equal(await mini.isVisible(), false);
    await page.keyboard.press("m");
    assert.equal(await mini.isVisible(), true);
    await page.mouse.move(initial.x + 100, initial.y + 40);
    await page.mouse.down();
    await page.mouse.move(initial.x + 180, initial.y + 80, { steps: 8 });
    await page.mouse.up();
    const dragged = await probeBox(mini);
    assert.deepEqual([dragged.x - initial.x, dragged.y - initial.y], [80, 40]);
    const saved = await page.evaluate((): unknown =>
      JSON.parse(localStorage.getItem("kms111.minimap") ?? "null"),
    );
    assert.deepEqual(saved, { x: 88, y: 48, shown: true });
    // Canvas inventory is drawn over the map; its click area must not be swallowed by the minimap's drag overlay.
    await page.keyboard.press("i");
    await page.mouse.move(dragged.x + 40, dragged.y + 25);
    await page.waitForTimeout(200);
    const covered = await mini.evaluate((e) => e.style.pointerEvents);
    assert.equal(covered, "none");
    await page.keyboard.press("i");

    await page.screenshot({
      path: fileURLToPath(new URL("minimap-native-amherst.png", output)),
      clip: await probeBox(page.locator("#view")),
    });
    await enter(100000000);
    await page.waitForFunction(() =>
      window.__kmsProbe.miniBlits.some((b) => b.src.includes("/100000000.img/")),
    );
    const wide = await probeBox(mini);
    assert.deepEqual([wide.width, wide.height], [216, 99]);
    await page.screenshot({
      path: fileURLToPath(new URL("minimap-native-henesys.png", output)),
      clip: await probeBox(page.locator("#view")),
    });
    await enter(101000000);
    await page.waitForFunction(() =>
      window.__kmsProbe.miniBlits.some((b) => b.src.includes("/101000000.img/")),
    );
    const tall = await probeBox(mini);
    assert.deepEqual([tall.width, tall.height], [185, 125]);
    await enter(20001);
    await page.waitForTimeout(800);
    assert.equal(
      await mini.isVisible(),
      false,
      "original map has no miniMap node; do not draw an invented fallback",
    );
    await enter(1000000);
    await page.waitForFunction(
      () => !document.querySelector("#minimap-window")?.classList.contains("hidden"),
    );
    assert.equal((await probeBox(mini)).x, dragged.x, "drag position survives map changes");
    const blits = await page.evaluate(() => window.__kmsProbe.miniBlits);
    for (const b of blits) {
      assert.equal(b.args[2], b.args[6]);
      assert.equal(b.args[3], b.args[7]);
    }
    await assertProbePackets(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    console.log(
      "REAL NATIVE MINIMAP / LIVE YELLOW MARK / M / DRAG / CANVAS UI OCCLUSION / WIDE & TALL CROP / ABSENT MAP / 1:1 BLITS OK",
      JSON.stringify({
        initial,
        dragged,
        wide,
        tall,
        saved,
        mark0,
        mark1,
        blits: blits.length,
        errors,
        httpErrors,
      }),
    );
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probeMinimap(process.argv.slice(2));
