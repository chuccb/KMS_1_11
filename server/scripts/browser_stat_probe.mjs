/** Real browser + normal encrypted TCP path, on an ISOLATED ability fixture (six AP) only. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const port = Number(process.argv[2] ?? 8595);
if (port === 8495)
  throw new Error("Refusing live characters: use an isolated ability fixture.");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const output = new URL("../../generated/validation/", import.meta.url);
await mkdir(output, { recursive: true });
const errors = [],
  httpErrors = [],
  results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
  });
  await context.addInitScript(() => {
    window.qaSent = [];
    window.qaMessages = [];
    window.qaDraw = [];
    window.qaActiveBlobs = new Set();
    const Ws = window.WebSocket;
    window.WebSocket = class extends Ws {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            window.qaMessages.push(JSON.parse(e.data));
          } catch {}
        });
      }
      send(data) {
        try {
          window.qaSent.push(JSON.parse(data));
        } catch {}
        super.send(data);
      }
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.qaActiveBlobs.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.qaActiveBlobs.delete(url);
      return revoke(url);
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      window.qaDraw.push(decodeURIComponent(image.src ?? ""));
      if (window.qaDraw.length > 5000) window.qaDraw.splice(0, 1000);
      return draw.call(this, image, ...args);
    };
  });
  async function login() {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push([r.status(), r.url()]);
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.click("#title-continue");
    await page.fill("#user", process.env.BROWSER_ACCOUNT??"ability");
    await page.fill("#pass", process.env.BROWSER_PASSWORD??"ability");
    await page.click("#login");
    await page.locator("#world-list button").first().click();
    await page.click("#world-connect");
    await page.locator("#character-list button").first().click();
    await page.click("#character-enter");
    await page.waitForFunction(() =>
      window.qaMessages.some((m) => m.t === "field"),
    );
    await page.waitForTimeout(1600);
    return page;
  }
  const page = await login();
  const self = await page.evaluate(
    () =>
      window.qaMessages.findLast((m) => m.t === "self")?.self ??
      window.qaMessages.find((m) => m.t === "field").self,
  );
  assert.deepEqual(
    [self.str, self.dex, self.int, self.luk, self.ap],
    [8, 6, 6, 5, 6],
    "requires fresh isolated six-AP fixture",
  );
  await page.keyboard.press("s");
  await page.locator("#stat-window").waitFor();
  await page.waitForFunction(() =>
    window.qaDraw.some((p) => p.endsWith("/Stat/backgrnd")),
  );
  const geometry = await page.evaluate(() => {
    const r = document.getElementById("stat-window").getBoundingClientRect(),
      c = document.getElementById("view").getBoundingClientRect(),
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
      (n) =>
        window.qaMessages.filter((m) => m.t === "ability-result").length >= n,
      count,
    );
    const ack = await page.evaluate(() =>
      window.qaMessages.findLast((m) => m.t === "ability-result"),
    );
    assert.equal(ack.changed, true);
    assert.equal(
      await page.locator("#ap-str").isDisabled(),
      count === 6,
      "native AP buttons stay visibly enabled while points remain; gating is in the sender",
    );
    await page.locator("#ap-dex").dispatchEvent("click");
    assert.equal(
      await page.evaluate(
        () => window.qaSent.filter((m) => m.t === "ability-up").length,
      ),
      count,
      "even synthetic clicks cannot bypass pending or cooldown",
    );
    if (count === 1) {
      await page.waitForTimeout(350);
      const r = await page.locator("#view").boundingBox();
      await page.screenshot({
        path: fileURLToPath(new URL("stat-ability-native.png", output)),
        clip: {
          x: r.x + (20 * r.width) / 800,
          y: r.y + (35 * r.width) / 800,
          width: (176 * r.width) / 800,
          height: (315 * r.width) / 800,
        },
      });
    }
    if (count < 6) await page.waitForTimeout(520);
  }
  const updated = await page.evaluate(
    () => window.qaMessages.findLast((m) => m.t === "self").self,
  );
  assert.deepEqual(
    [updated.str, updated.dex, updated.int, updated.luk, updated.ap],
    [11, 7, 7, 6, 0],
  );
  for (const field of ["str", "dex", "int", "luk"])
    assert.equal(await page.locator("#ap-" + field).isDisabled(), true);
  await page.waitForFunction(() =>
    document.getElementById("stat-values").textContent.includes("STR 11"),
  );
  assert.match(
    await page.locator("#stat-values").textContent(),
    /STR 11 DEX 7 INT 7 LUK 6 AP 0/,
  );
  // Drag in CSS-scaled coordinates; keep the complete native window within 800x600.
  const r = await page.locator("#stat-window").boundingBox(),
    scale = r.width / 176;
  await page.mouse.move(r.x + 30 * scale, r.y + 25 * scale);
  await page.mouse.down();
  await page.mouse.move(r.x + 110 * scale, r.y + 65 * scale, { steps: 5 });
  await page.mouse.up();
  const position = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("kms111.statAt")),
  );
  assert.deepEqual(position, { x: 152, y: 112 });
  await page.keyboard.press("Escape");
  await page.locator("#stat-window").waitFor({ state: "hidden" });
  // Also test the original status-menu path, not only the browser's S shortcut.
  const view = await page.locator("#view").boundingBox();
  await page.mouse.click(
    view.x + (56 * view.width) / 800,
    view.y + (475 * view.height) / 600,
  );
  await page.locator("#stat-window").waitFor();
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.qaActiveBlobs.size === 0);
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
  await page.close();
  await new Promise((r) => setTimeout(r, 250));
  const again = await login();
  const saved = await again.evaluate(
    () => window.qaMessages.find((m) => m.t === "field").self,
  );
  assert.deepEqual(
    [saved.str, saved.dex, saved.int, saved.luk, saved.ap],
    [11, 7, 7, 6, 0],
    "allocation persists across a real reconnect",
  );
  await again.keyboard.press("s");
  await again.locator("#stat-window").waitFor();
  assert.deepEqual(
    await again.evaluate(() => ({
      x: parseFloat(document.getElementById("stat-window").style.left),
      y: parseFloat(document.getElementById("stat-window").style.top),
    })),
    position,
  );
  await again.click("#stat-close");
  await again.locator("#stat-window").waitFor({ state: "hidden" });
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
