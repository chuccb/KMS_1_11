/** Real Chromium on equipment_fixture.mjs ONLY. Never accepts the production port. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const port = +(process.argv[2] ?? 8595);
if (port === 8495) throw new Error("Refusing production characters");
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
const errors = [],
  httpErrors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
  });
  await context.addInitScript(() => {
    window.qaSent = [];
    window.qaMessages = [];
    window.qaDraw = [];
    const WS = WebSocket;
    window.WebSocket = class extends WS {
      constructor(...a) {
        super(...a);
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
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (img, ...args) {
      if (img?.src) {
        const src = decodeURIComponent(img.src);
        if (src.endsWith("/Item/backgrnd") || src.endsWith("/Equip/backgrnd")) {
          window.qaDraw.push({ src, args });
          if (window.qaDraw.length > 200) window.qaDraw.shift();
        }
      }
      return draw.call(this, img, ...args);
    };
  });
  const page = await context.newPage(),
    watch = await context.newPage();
  let observerAvatarRequested=false;
  watch.on("request",r=>{if(r.url().includes("/api/avatar.png")&&r.url().includes("1002019"))observerAvatarRequested=true;});
  for (const p of [page, watch]) {
    p.setDefaultTimeout(60000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("response", (r) => {
      if (r.status() >= 400) httpErrors.push([r.status(), r.url()]);
    });
  }
  const login = async (p, user) => {
    await p.goto(`http://127.0.0.1:${port}/`);
    await p.click("#title-continue");
    await p.fill("#user", user);
    await p.fill("#pass", user);
    await p.click("#login");
    await p.locator("#world-list button").first().click();
    await p.click("#world-connect");
    await p.locator("#character-list button").first().click();
    await p.click("#character-enter");
    await p.waitForFunction(() =>
      window.qaMessages.some((m) => m.t === "inventory"),
    );
  };
  await login(watch, "watch");
  await login(page, "gear");
  const coords = async (x, y) => {
    const r = await page.locator("#view").boundingBox();
    return { x: r.x + (x * r.width) / 800, y: r.y + (y * r.height) / 600 };
  };
  const click = async (x, y, n = 1) => {
    const p = await coords(x, y);
    await page.mouse.click(p.x, p.y, { clickCount: n, delay: 40 });
  };
  const drag = async (x, y, tx, ty) => {
    const a = await coords(x, y),
      b = await coords(tx, ty);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  const inventory = () =>
    page.evaluate(
      () => window.qaMessages.findLast((m) => m.t === "inventory").inventory,
    );
  const bag = (i, tab = 1) => i.tabs.find((t) => t.tab === tab).items;
  const wait = async () => page.waitForTimeout(550);
  const until = async (fn) => page.waitForFunction(fn);
  const changes = () =>
    page.evaluate(
      () => window.qaSent.filter((m) => m.t === "change-slot").length,
    );
  const move = async (fn) => {
    const before = await page.evaluate(
      () => window.qaMessages.filter((m) => m.t === "inventory").length,
    );
    await wait();
    await fn();
    await page.waitForFunction(
      (n) => window.qaMessages.filter((m) => m.t === "inventory").length > n,
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
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kms111.equipAt")),
    ),
    { x: 300, y: 30 },
  );
  // Repeatable fixture: undo ONLY this probe's exact prior final state via normal gestures.
  const prior=await inventory();
  if(prior.worn.find(x=>x.slot===1)?.itemId===1002008&&bag(prior).find(x=>x.slot===5)?.itemId===1002019&&bag(prior,2).find(x=>x.slot===4)?.quantity===3){
    await move(()=>drag(300+39+16,30+55+16,46,120));
    await move(()=>drag(46,155,81,120));
    await click(24+53,24+64);await move(()=>drag(151,120,46,120));await click(24+18,24+64);
  }
  const baseline=await changes();
  await move(() => drag(46, 120, 46, 155));
  let i = await inventory();
  assert.equal(bag(i).find((x) => x.slot === 5).itemId, 1002008);
  assert.equal(
    bag(i).some((x) => x.slot === 1),
    false,
  );
  await move(() => drag(46, 155, 81, 120));
  i = await inventory();
  assert.equal(bag(i).find((x) => x.slot === 2).itemId, 1002008);
  assert.equal(bag(i).find((x) => x.slot === 5).itemId, 1002019);
  await move(() => click(81, 120, 2));
  await until(() =>
    window.qaMessages
      .findLast((m) => m.t === "self")
      ?.self.avatarItems.includes(1002008),
  );
  await watch.waitForFunction(() =>
    window.qaMessages.some(
      (m) => m.t === "user-look" && m.avatarItems?.includes(1002008),
    ),
  );
  i = await inventory();
  assert.deepEqual(
    [
      i.worn.find((x) => x.slot === 1).stats.str,
      i.worn.find((x) => x.slot === 1).cuc,
      i.worn.find((x) => x.slot === 1).ruc,
    ],
    [3, 2, 4],
  );
  const beforeReject = await changes();
  await wait();
  await click(116, 120, 2);
  await page.waitForTimeout(700);
  assert.equal(
    await changes(),
    beforeReject,
    "high-level item rejected in client, never sent",
  );
  await move(() => drag(300 + 39 + 16, 30 + 55 + 16, 81, 155));
  i = await inventory();
  assert.equal(
    i.worn.some((x) => x.slot === 1),
    false,
  );
  assert.equal(bag(i).find((x) => x.slot === 6).itemId, 1002008);
  await move(() => drag(81, 155, 300 + 39 + 16, 30 + 55 + 16));
  i = await inventory();
  assert.equal(i.worn.find((x) => x.slot === 1).itemId, 1002008);
  await move(() => click(46, 155, 2));
  i = await inventory();
  assert.equal(i.worn.find((x) => x.slot === 1).itemId, 1002019);
  assert.equal(bag(i).find((x) => x.slot === 5).itemId, 1002008);
  await move(() => click(46, 155, 2));
  i = await inventory();
  assert.equal(i.worn.find((x) => x.slot === 1).stats.str, 3);
  await click(24 + 53, 24 + 64);
  await move(() => drag(46, 120, 151, 120));
  i = await inventory();
  assert.equal(bag(i, 2).find((x) => x.slot === 4).quantity, 3);
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
    window.qaDraw.findLast(
      (m) => m.src.endsWith("/Item/backgrnd") && m.args.length === 2,
    ),
  );
  assert.deepEqual(
    windowDraw.args,
    [24, 24],
    "item drag never moves the whole window",
  );
  const out = new URL("../../generated/validation/", import.meta.url);
  await mkdir(out, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL("equipment-native-owner.png", out)),
    clip: await page.locator("#view").boundingBox(),
  });
  await watch.screenshot({
    path: fileURLToPath(new URL("equipment-native-observer.png", out)),
    clip: await watch.locator("#view").boundingBox(),
  });
  const sent = await page.evaluate(() =>
    window.qaSent.filter((m) => m.t === "change-slot"),
  ).then(all=>all.slice(baseline));
  assert.equal(sent.length, 8);
  for (const s of sent) assert.equal(s.count, -1);
  await login(page, "gear");
  i = await inventory();
  assert.equal(i.worn.find((x) => x.slot === 1).itemId, 1002008);
  assert.equal(i.worn.find((x) => x.slot === 1).cuc, 2);
  assert.equal(bag(i, 2).find((x) => x.slot === 4).quantity, 3);
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
  assert.equal(observerAvatarRequested,true,"observer renders a composed avatar with the changed equip, not only a socket event");
  assert.deepEqual(errors, []);
  assert.deepEqual(httpErrors, []);
  console.log(
    "REAL BAG MOVE / SWAP / DOUBLE-CLICK EQUIP / DRAG UNEQUIP / REPLACE / INSTANCE STATS / REQUIREMENT REFUSAL / OWNER & OBSERVER LOOK / CANCEL / RELOGIN & POSITION PERSISTENCE OK",
    JSON.stringify({ sent, observerAvatarRequested, errors, httpErrors }),
  );
} finally {
  await browser.close();
}
