/** Manual selection regression. Explicit disposable fixture only; importing never runs it. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.ts";
import {
  assertProbePackets,
  browserFixture,
  fixtureLogin,
  type ProbeEnvironment,
} from "./browser-fixture.ts";
import { installBrowserObservation } from "./browser-observation.ts";
export async function probeSelection(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = browserFixture(args, env, true);
  const other = options.other;
  assert.ok(other);

  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  try {
    await mkdir(output, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors: string[] = [],
      httpErrors: [number, string][] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && /\/api\/(png|avatar)/.test(r.url()))
        httpErrors.push([r.status(), r.url()]);
    });
    // Read-only observation of the real module; no injected movement, positions, terrain or messages.
    await page.route("**/main.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          "\nwindow.__kmsGameObservation = () => ({camera: {...camera}, mobs: [...mobs.values()], arts: [...mobArts.entries()]});",
      });
    });
    await page.addInitScript(installBrowserObservation);
    await fixtureLogin(page, options.origin, options.account);
    await page.locator("#world-list button").first().waitFor();
    assert.equal(await page.locator("#world-connect").isDisabled(), true);
    await page.locator("#world-list button").first().click();
    assert.equal(
      await page.evaluate(() => window.__kmsProbe.sent.some((m) => m.t === "world")),
      false,
    );
    await page.waitForTimeout(1500);
    await page
      .locator("#view")
      .screenshot({ path: fileURLToPath(new URL("world-select-native.png", output)) });
    await page.click("#world-connect");
    await page.locator("#character-list button").first().waitFor();
    await page.locator("#character-list button").first().click();
    assert.equal(
      await page.evaluate(() => window.__kmsProbe.sent.some((m) => m.t === "character")),
      false,
    );
    assert.equal(await page.locator("#character-delete").isDisabled(), false);
    await page.waitForTimeout(2000);
    await page
      .locator("#view")
      .screenshot({ path: fileURLToPath(new URL("character-select-native.png", output)) });
    assert.equal(
      await page.evaluate(() =>
        window.__kmsProbe.draws.some(
          (d) =>
            d.src.includes("/api/avatar.png") &&
            d.src.includes("stance=walk1") &&
            d.src.includes("flip=1"),
        ),
      ),
      true,
      "native preview actions 2/4 have right-facing bit zero",
    );
    assert.equal(
      await page.evaluate(
        () => [...document.fonts].find((f) => f.family.replaceAll('"', "") === "KMSCJK")?.status,
      ),
      "loaded",
    );
    const charRecord = await page.evaluate(
      () => window.__kmsProbe.messages.find((m) => m.t === "characters")?.characters[0],
    );
    assert.ok(charRecord);
    assert.equal(typeof charRecord.str, "number");
    await page.click("#character-enter");
    await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "field"));
    await page.waitForTimeout(3000);
    const walk = async (direction: string, flip: number) => {
      await page.keyboard.down(direction);
      await page.waitForTimeout(650);
      const state = await page.evaluate(() => ({
        move: window.__kmsProbe.sent.filter((m) => m.t === "move").at(-1),
        avatar: window.__kmsProbe.draws
          .filter((d) => d.src.includes("/api/avatar.png") && d.src.includes("stance=walk"))
          .at(-1),
      }));
      assert.ok(state.move);
      assert.equal(state.move.action & 1, direction === "ArrowLeft" ? 1 : 0);
      assert.ok(state.avatar, "a real walk frame was drawn");
      assert.equal(new URL(state.avatar.src, "http://test").searchParams.get("flip"), String(flip));
      await page.locator("#view").screenshot({
        path: fileURLToPath(
          new URL(`facing-${direction === "ArrowLeft" ? "left" : "right"}.png`, output),
        ),
      });
      await page.keyboard.up(direction);
      await page.waitForTimeout(250);
      return state;
    };
    const right = await walk("ArrowRight", 1),
      left = await walk("ArrowLeft", 0);
    // Match actual WZ draws to live mobs by template, origin and current camera position.
    await page.waitForTimeout(1200);
    const mobs = await page.evaluate(() => {
      const state = window.__kmsProbe.game();
      const arts = new Map(state.arts);
      const matches = [];
      for (const draw of window.__kmsProbe.draws.filter((d) => d.src.includes("/api/png/Mob/"))) {
        const path = draw.src.slice(draw.src.indexOf("/api/png/") + 9);
        for (const mob of state.mobs) {
          const frames = Object.values(arts.get(mob.templateId) ?? {}).flat();
          const frame = frames.find((f) => f.path === path);
          if (!frame) continue;
          const x = draw.matrix.a < 0 ? draw.matrix.e : draw.args[0] + frame.ox;
          const y = draw.matrix.a < 0 ? draw.matrix.f : draw.args[1] + frame.oy;
          if (
            Math.abs(x - (mob.x - state.camera.x)) <= 1 &&
            Math.abs(y - (mob.y - state.camera.y)) <= 1
          ) {
            matches.push({
              id: mob.mobId,
              facing: mob.facing,
              mirrored: draw.matrix.a < 0,
              walking: mob.walking,
            });
            break;
          }
        }
      }
      return { matches, moves: window.__kmsProbe.messages.filter((m) => m.t === "mob-move") };
    });
    assert.ok(mobs.matches.length >= 3, JSON.stringify(mobs.matches));
    for (const mob of mobs.matches)
      assert.equal(mob.mirrored, mob.facing === 0, `mob ${mob.id} faces its logical direction`);
    assert.ok(
      mobs.moves.some((m) =>
        m.path?.elements.every((e) => e.x === m.path?.originX && e.y === m.path?.originY),
      ),
      "original idle decisions are broadcast",
    );
    assert.ok(
      mobs.moves.some((m) => m.path?.elements.some((e) => e.x !== m.path?.originX)),
      "walking decisions are broadcast",
    );
    await assertProbePackets(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    // An empty account must not auto-enter an absent slot or require a user to discover a hidden form.
    await fixtureLogin(page, options.origin, other);
    await page.locator("#world-list button").first().click();
    await page.click("#world-connect");
    await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "characters"));
    assert.equal(await page.locator("#character-list button").count(), 0);
    assert.equal(await page.locator("#character-enter").isDisabled(), true);
    assert.equal(await page.locator("#character-new").isDisabled(), false);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => window.__kmsProbe.sent.some((m) => m.t === "character")),
      false,
    );
    await page.waitForTimeout(1200);
    await page
      .locator("#view")
      .screenshot({ path: fileURLToPath(new URL("character-select-empty.png", output)) });
    await page.click("#character-new");
    await page.click("#native-ok");
    assert.equal(await page.locator("#new-character").isVisible(), true);
    await page.click("#create-cancel");
    assert.equal(await page.locator("#new-character").isVisible(), false);
    await assertProbePackets(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    console.log(
      JSON.stringify(
        {
          status: "BROWSER SELECTION/FACING PASS",
          character: charRecord.name,
          right: right.move,
          left: left.move,
          visibleMobs: mobs.matches,
          mobPackets: mobs.moves.length,
          errors,
          httpErrors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probeSelection(process.argv.slice(2));
