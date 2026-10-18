/** Manual creation regression. Explicit disposable fixture only; importing never runs it. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.ts";
import {
  assertProbePackets,
  browserFixture,
  fixtureLogin,
  probeBox,
  fixtureValue,
  type ProbeEnvironment,
} from "./browser-fixture.ts";
import { installBrowserObservation } from "./browser-observation.ts";
import { isCreationCatalog } from "../../client/ui-resource-validation.ts";
export async function probeCreation(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = browserFixture(args, env, true);
  const other = options.other;
  assert.ok(other);

  const maleName = fixtureValue(env, "PROBE_NAME"),
    femaleName = fixtureValue(env, "PROBE_ALT_NAME");
  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  const errors: string[] = [],
    httpErrors: [number, string][] = [],
    results = [];
  try {
    await mkdir(output, { recursive: true });
    for (const { account, name, gender } of [
      { account: options.account, name: maleName, gender: 0 },
      { account: other, name: femaleName, gender: 1 },
    ]) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 800 } }),
        page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400) httpErrors.push([r.status(), r.url()]);
      });
      await page.addInitScript(installBrowserObservation);
      await fixtureLogin(page, options.origin, account);
      await page.locator("#world-list button").first().click();
      await page.click("#world-connect");
      await page.waitForFunction(() =>
        window.__kmsProbe.messages.some((m) => m.t === "characters"),
      );
      assert.equal(await page.locator("#character-delete").isDisabled(), true);
      await page.click("#character-new");
      await page.click("#native-ok");
      await page.locator("#new-name").waitFor();
      const pos = await page.evaluate(() => {
        const input = document.getElementById("new-name")?.getBoundingClientRect(),
          dialog = document.getElementById("new-character")?.getBoundingClientRect();
        const view = document.getElementById("view");
        if (!input || !dialog || !view) throw new Error("Missing creation geometry");
        const scale = view.getBoundingClientRect().width / 800;
        return {
          dx: (input.x - dialog.x) / scale,
          dy: (input.y - dialog.y) / scale,
          w: dialog.width / scale,
          h: dialog.height / scale,
        };
      });
      assert.deepEqual(pos, { dx: 110, dy: 143, w: 260, h: 424 });
      await page.fill("#new-name", name);
      await page.click("#create");
      assert.equal(
        await page.evaluate(() => window.__kmsProbe.sent.some((m) => m.t === "create")),
        false,
        "OK must require a checked current name",
      );
      await page.click("#native-ok");
      if (!gender) {
        await page.fill("#new-name", "abc");
        await page.click("#check-name");
        await page.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "error"));
        await page.click("#native-ok");
        await page.fill("#new-name", name);
      }
      await page.click("#check-name");
      await page.waitForFunction(() =>
        window.__kmsProbe.messages.some((m) => m.t === "name-checked" && m.result === 0),
      );
      await page.click("#native-ok");
      await page.fill("#new-name", name + "1");
      await page.click("#create");
      assert.equal(
        await page.evaluate(() => window.__kmsProbe.sent.some((m) => m.t === "create")),
        false,
        "editing invalidates availability",
      );
      await page.click("#native-ok");
      await page.fill("#new-name", name);
      await page.click("#check-name");
      await page.waitForFunction(
        () => window.__kmsProbe.messages.filter((m) => m.t === "name-checked").length === 2,
      );
      await page.click("#native-ok");
      const catalog: unknown = await (
        await page.request.get(`${options.origin}/api/creation`)
      ).json();
      assert.ok(isCreationCatalog(catalog));
      const groups = gender ? catalog.female : catalog.male;
      for (let i = 0; i < 6; i++) {
        await page.click(`#create-combo-${i}`);
        assert.equal(await page.locator("#creation-options button").count(), groups[i].length);
        await page.locator("#creation-options button").last().click();
      }
      const expected = groups.map((g) => {
        const last = g.at(-1);
        assert.ok(last);
        return last.id;
      });
      await page.click("#roll-dice");
      await page.waitForFunction(() => {
        const roll = document.getElementById("roll-dice");
        return roll instanceof HTMLButtonElement && !roll.disabled;
      });
      await page
        .waitForFunction(
          ([face, hair]) =>
            window.__kmsProbe.draws.some(
              (d) =>
                d.src.includes("/api/avatar.png") &&
                d.src.includes(`face=${face}`) &&
                d.src.includes(`hair=${hair}`),
            ),
          expected,
        )
        .catch(async (error) => {
          console.log(
            "PREVIEW DEBUG",
            JSON.stringify({
              expected,
              errors,
              httpErrors,
              state: await page.evaluate(() => ({
                draw: window.__kmsProbe.draws,
                texts: window.__kmsProbe.texts,
                messages: window.__kmsProbe.messages,
                sent: window.__kmsProbe.sent,
                blob: window.__kmsProbe.blobSources,
              })),
            }),
          );
          await page.screenshot({ path: fileURLToPath(new URL("creation-debug.png", output)) });
          throw error;
        });
      await page.waitForFunction(() =>
        window.__kmsProbe.draws.some((d) => d.src.includes("CharSelect/newDlg")),
      );
      const shownDice = await page.evaluate(() =>
        [381, 401, 421, 441].map((y) =>
          Number(window.__kmsProbe.texts.find((t) => t.x === 348 && t.y === y)?.text),
        ),
      );
      assert.equal(
        shownDice.reduce((a, b) => a + b, 0),
        25,
      );
      await page.screenshot({
        path: fileURLToPath(new URL(`creation-${gender}-native.png`, output)),
        clip: await probeBox(page.locator("#view")),
      });
      await page.click("#create");
      await page.waitForFunction(() =>
        window.__kmsProbe.messages.some((m) => m.t === "created" && m.ok),
      );
      const state = await page.evaluate(() => ({
        sent: window.__kmsProbe.sent.find((m) => m.t === "create"),
        created: window.__kmsProbe.messages.find((m) => m.t === "created"),
        characters: window.__kmsProbe.messages.filter((m) => m.t === "characters").at(-1)
          ?.characters,
      }));
      assert.ok(state.sent && state.created && state.characters?.length);
      assert.deepEqual(state.sent.appearance.slice(0, 6), expected);
      assert.deepEqual(state.sent.appearance.slice(6), shownDice);
      assert.equal(state.characters[0].name, name);
      assert.equal(state.characters[0].str, shownDice[0]);
      assert.equal(state.characters[0].luk, shownDice[3]);
      assert.equal(await page.locator("#character-dialogs").isVisible(), false);
      // Cancel is entirely local, then confirm exactly one real delete packet.
      await page.click("#character-delete");
      await page.click("#native-no");
      assert.equal(
        await page.evaluate(() => window.__kmsProbe.sent.some((m) => m.t === "delete-character")),
        false,
      );
      await page.click("#character-delete");
      await page.waitForFunction(() =>
        window.__kmsProbe.draws.some((d) => d.src.includes("YesNo/backgrnd")),
      );
      await page.screenshot({
        path: fileURLToPath(new URL(`deletion-${gender}-native.png`, output)),
        clip: await probeBox(page.locator("#view")),
      });
      await page.click("#native-yes");
      await page.waitForFunction(() =>
        window.__kmsProbe.messages.some((m) => m.t === "deleted" && m.ok),
      );
      const deletion = await page.evaluate(() =>
        window.__kmsProbe.sent.filter((m) => m.t === "delete-character"),
      );
      assert.equal(deletion.length, 1);
      assert.equal(deletion[0].id, state.created.id);
      assert.equal(await page.locator("#character-delete").isDisabled(), true);
      assert.equal(await page.locator("#character-new").isDisabled(), false);
      results.push({
        user: account.user,
        gender,
        name,
        appearance: state.sent.appearance,
        createdId: state.created.id,
        deletePackets: deletion.length,
      });
      await assertProbePackets(page);
      await context.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    console.log(JSON.stringify({ results, errors, httpErrors }, null, 2));
    console.log("REAL NATIVE CREATION / DICE / CP949 / CONFIRMED DELETION OK");
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probeCreation(process.argv.slice(2));
