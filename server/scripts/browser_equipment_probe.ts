/** Manual equipment regression. Explicit disposable fixture only; importing never runs it. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { launchBrowser } from "./browser.ts";
import {
  assertProbePackets,
  browserFixture,
  fixtureLogin,
  probeBox,
  type ProbeEnvironment,
} from "./browser-fixture.ts";
import { installBrowserObservation, type ProbeInventory } from "./browser-observation.ts";
export async function probeEquipment(args: readonly string[], env: ProbeEnvironment = process.env) {
  const options = browserFixture(args, env, true);
  const other = options.other;
  assert.ok(other);

  const browser = await launchBrowser();
  const output = new URL("../../generated/validation/", import.meta.url);

  const errors: string[] = [],
    httpErrors: [number, string][] = [];
  try {
    await mkdir(output, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1000, height: 800 },
    });
    await context.addInitScript(installBrowserObservation);
    const page = await context.newPage(),
      watch = await context.newPage();
    let observerAvatarRequested = false;
    watch.on("request", (r) => {
      if (r.url().includes("/api/avatar.png") && r.url().includes("1002019"))
        observerAvatarRequested = true;
    });
    for (const p of [page, watch]) {
      p.setDefaultTimeout(60000);
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("response", (r) => {
        if (r.status() >= 400) httpErrors.push([r.status(), r.url()]);
      });
    }
    const login = async (p: Page, account: typeof options.account) => {
      await fixtureLogin(p, options.origin, account);
      await p.locator("#world-list button").first().click();
      await p.click("#world-connect");
      await p.locator("#character-list button").first().click();
      await p.click("#character-enter");
      await p.waitForFunction(() => window.__kmsProbe.messages.some((m) => m.t === "inventory"));
    };
    await login(watch, other);
    await login(page, options.account);
    const coords = async (x: number, y: number) => {
      const r = await probeBox(page.locator("#view"));
      return { x: r.x + (x * r.width) / 800, y: r.y + (y * r.height) / 600 };
    };
    const click = async (x: number, y: number, n = 1) => {
      const p = await coords(x, y);
      await page.mouse.click(p.x, p.y, { clickCount: n, delay: 40 });
    };
    const drag = async (x: number, y: number, tx: number, ty: number) => {
      const a = await coords(x, y),
        b = await coords(tx, ty);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
    };
    const inventory = async () => {
      const result = await page.evaluate(
        () => window.__kmsProbe.messages.findLast((m) => m.t === "inventory")?.inventory,
      );
      assert.ok(result);
      return result;
    };
    const bag = (i: ProbeInventory, tab = 1) => {
      const row = i.tabs.find((t) => t.tab === tab);
      assert.ok(row);
      return row.items;
    };
    const wait = async () => page.waitForTimeout(550);
    const until = async (fn: () => boolean | undefined) => page.waitForFunction(fn);
    const changes = () =>
      page.evaluate(() => window.__kmsProbe.sent.filter((m) => m.t === "change-slot").length);
    const move = async (fn: () => Promise<void>) => {
      const before = await page.evaluate(
        () => window.__kmsProbe.messages.filter((m) => m.t === "inventory").length,
      );
      await wait();
      await fn();
      await page.waitForFunction(
        (n) => window.__kmsProbe.messages.filter((m) => m.t === "inventory").length > n,
        before,
      );
    };
    await page.keyboard.press("i");
    await click(24 + 18, 24 + 64);
    await page.keyboard.press("e");
    assert.deepEqual(
      await page
        .locator("#equip-window")
        .evaluate((e) => [parseFloat(e.style.left), parseFloat(e.style.top)]),
      [48, 48],
    );
    await drag(48 + 20, 48 + 25, 300 + 20, 30 + 25);
    assert.deepEqual(
      await page.evaluate((): unknown =>
        JSON.parse(localStorage.getItem("kms111.equipAt") ?? "null"),
      ),
      { x: 300, y: 30 },
    );
    // Repeatable fixture: undo ONLY this probe's exact prior final state via normal gestures.
    const prior = await inventory();
    if (
      prior.worn.find((x) => x.slot === 1)?.itemId === 1002008 &&
      bag(prior).find((x) => x.slot === 5)?.itemId === 1002019 &&
      bag(prior, 2).find((x) => x.slot === 4)?.quantity === 3
    ) {
      await move(() => drag(300 + 39 + 16, 30 + 55 + 16, 46, 120));
      await move(() => drag(46, 155, 81, 120));
      await click(24 + 53, 24 + 64);
      await move(() => drag(151, 120, 46, 120));
      await click(24 + 18, 24 + 64);
    }
    const baseline = await changes();
    await move(() => drag(46, 120, 46, 155));
    let i = await inventory();
    assert.equal(bag(i).find((x) => x.slot === 5)?.itemId, 1002008);
    assert.equal(
      bag(i).some((x) => x.slot === 1),
      false,
    );
    await move(() => drag(46, 155, 81, 120));
    i = await inventory();
    assert.equal(bag(i).find((x) => x.slot === 2)?.itemId, 1002008);
    assert.equal(bag(i).find((x) => x.slot === 5)?.itemId, 1002019);
    await move(() => click(81, 120, 2));
    await until(() =>
      window.__kmsProbe.messages
        .findLast((m) => m.t === "self")
        ?.self.avatarItems.includes(1002008),
    );
    await watch.waitForFunction(() =>
      window.__kmsProbe.messages.some(
        (m) => m.t === "user-look" && m.avatarItems?.includes(1002008),
      ),
    );
    i = await inventory();
    assert.deepEqual(
      [
        i.worn.find((x) => x.slot === 1)?.stats?.str,
        i.worn.find((x) => x.slot === 1)?.cuc,
        i.worn.find((x) => x.slot === 1)?.ruc,
      ],
      [3, 2, 4],
    );
    const beforeReject = await changes();
    await wait();
    await click(116, 120, 2);
    await page.waitForTimeout(700);
    assert.equal(await changes(), beforeReject, "high-level item rejected in client, never sent");
    await move(() => drag(300 + 39 + 16, 30 + 55 + 16, 81, 155));
    i = await inventory();
    assert.equal(
      i.worn.some((x) => x.slot === 1),
      false,
    );
    assert.equal(bag(i).find((x) => x.slot === 6)?.itemId, 1002008);
    await move(() => drag(81, 155, 300 + 39 + 16, 30 + 55 + 16));
    i = await inventory();
    assert.equal(i.worn.find((x) => x.slot === 1)?.itemId, 1002008);
    await move(() => click(46, 155, 2));
    i = await inventory();
    assert.equal(i.worn.find((x) => x.slot === 1)?.itemId, 1002019);
    assert.equal(bag(i).find((x) => x.slot === 5)?.itemId, 1002008);
    await move(() => click(46, 155, 2));
    i = await inventory();
    assert.equal(i.worn.find((x) => x.slot === 1)?.stats?.str, 3);
    await click(24 + 53, 24 + 64);
    await move(() => drag(46, 120, 151, 120));
    i = await inventory();
    assert.equal(bag(i, 2).find((x) => x.slot === 4)?.quantity, 3);
    const beforeCancel = await changes();
    await drag(151, 120, 650, 400);
    await page.waitForTimeout(300);
    assert.equal(
      await changes(),
      beforeCancel,
      "status-panel region cancels; actual field drop is a separate operation",
    );
    const a = await coords(151, 120),
      b = await coords(190, 140);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await changes(), beforeCancel);
    const windowDraw = await page.evaluate(() =>
      window.__kmsProbe.draws.findLast(
        (m) => m.src.endsWith("/Item/backgrnd") && m.args.length === 2,
      ),
    );
    assert.deepEqual(windowDraw?.args, [24, 24], "item drag never moves the whole window");

    await page.screenshot({
      path: fileURLToPath(new URL("equipment-native-owner.png", output)),
      clip: await probeBox(page.locator("#view")),
    });
    await watch.screenshot({
      path: fileURLToPath(new URL("equipment-native-observer.png", output)),
      clip: await probeBox(watch.locator("#view")),
    });
    const sent = await page
      .evaluate(() => window.__kmsProbe.sent.filter((m) => m.t === "change-slot"))
      .then((all) => all.slice(baseline));
    assert.equal(sent.length, 8);
    for (const s of sent) assert.equal(s.count, -1);
    await login(page, options.account);
    i = await inventory();
    assert.equal(i.worn.find((x) => x.slot === 1)?.itemId, 1002008);
    assert.equal(i.worn.find((x) => x.slot === 1)?.cuc, 2);
    assert.equal(bag(i, 2).find((x) => x.slot === 4)?.quantity, 3);
    await page.keyboard.press("e");
    assert.deepEqual(
      await page
        .locator("#equip-window")
        .evaluate((e) => [parseFloat(e.style.left), parseFloat(e.style.top)]),
      [300, 30],
    );
    await page.click("#equip-close");
    assert.equal(await page.locator("#equip-window").isVisible(), false);
    await click(27, 449);
    assert.equal(
      await page.locator("#equip-window").isVisible(),
      true,
      "original EQUIP status button",
    );
    assert.equal(
      observerAvatarRequested,
      true,
      "observer renders a composed avatar with the changed equip, not only a socket event",
    );
    await assertProbePackets(page);
    await assertProbePackets(watch);
    assert.deepEqual(errors, []);
    assert.deepEqual(httpErrors, []);
    console.log(
      "REAL BAG MOVE / SWAP / DOUBLE-CLICK EQUIP / DRAG UNEQUIP / REPLACE / INSTANCE STATS / REQUIREMENT REFUSAL / OWNER & OBSERVER LOOK / CANCEL / RELOGIN & POSITION PERSISTENCE OK",
      JSON.stringify({ sent, observerAvatarRequested, errors, httpErrors }),
    );
  } finally {
    await browser.close();
  }
}
if (import.meta.main) await probeEquipment(process.argv.slice(2));
