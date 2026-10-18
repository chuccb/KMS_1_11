/** Real Chromium instrumentation on a blank HTTP fixture + Playwright fake WebSocket only.
 * No game page, login/world services, accounts, saves or player input exist in this fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { launchBrowser } from "../scripts/browser.ts";
import { installBrowserObservation } from "../scripts/browser-observation.ts";
import {
  browserFixture,
  probeFlag,
  fixtureValue,
  probeBox,
  assertProbePackets,
  fixtureLogin,
} from "../scripts/browser-fixture.ts";

const environment = {
  PROBE_ACCOUNT: "disposable",
  PROBE_PASSWORD: "not-a-real-password",
  PROBE_ALT_ACCOUNT: "second-fixture",
  PROBE_ALT_PASSWORD: "also-not-a-real-password",
};
test("manual browser admission preserves explicit secrets, rejects implicit/duplicate targets, and validates every fixture role before launch", () => {
  assert.throws(() => browserFixture([], environment), /allow-state-changes/);
  assert.throws(() => browserFixture(["--allow-state-changes", "8595"], {}), /PROBE_ACCOUNT/);
  assert.throws(
    () => browserFixture(["--allow-state-changes", "8595"], { PROBE_ACCOUNT: "x" }),
    /PROBE_PASSWORD/,
  );
  assert.throws(
    () =>
      browserFixture(
        ["--allow-state-changes", "8595"],
        { PROBE_ACCOUNT: "x", PROBE_PASSWORD: "x" },
        true,
      ),
    /PROBE_ALT_ACCOUNT/,
  );
  assert.throws(
    () =>
      browserFixture(
        ["--allow-state-changes", "8595"],
        { ...environment, PROBE_ALT_ACCOUNT: environment.PROBE_ACCOUNT },
        true,
      ),
    /distinct/,
  );
  assert.throws(
    () => browserFixture(["--allow-state-changes", "--allow-state-changes", "8595"], environment),
    /allow-state-changes/,
  );
  assert.throws(
    () => browserFixture(["--allow-state-changes", "8595", "extra"], environment),
    /exactly/,
  );
  assert.throws(() => fixtureValue({}, "PROBE_NAME"), /PROBE_NAME/);
  assert.throws(() => fixtureValue({ PROBE_NAME: "  " }, "PROBE_NAME"), /PROBE_NAME/);
  assert.equal(fixtureValue({ PROBE_NAME: "NativeOne" }, "PROBE_NAME"), "NativeOne");
  const result = browserFixture(
    ["--allow-state-changes", "8595"],
    { ...environment, PROBE_PASSWORD: " a b " },
    true,
  );
  assert.equal(result.origin, "http://127.0.0.1:8595");
  assert.equal(result.account.password, " a b ", "Do not alter passwords by trimming");
  assert.equal(result.other?.user, "second-fixture");
  assert.equal(browserFixture(["8595", "--allow-state-changes"], environment).other, undefined);
});
test("all current/historical preview TCP and proxy targets stay protected; opt-in is not proof of isolation", () => {
  for (const port of [8495, 8496, 8497, 8515, 8516, 8517]) {
    for (const target of [
      String(port),
      `http://localhost:${port}`,
      `https://${port}-fixture.e2b.app`,
    ])
      assert.throws(
        () => browserFixture(["--allow-state-changes", target], environment),
        /Refusing/,
      );
  }
  for (const target of [
    "0",
    "65536",
    "https://user:secret@example.com",
    "https://example.com/ws",
    "https://example.com/?password=x",
  ])
    assert.throws(() => browserFixture(["--allow-state-changes", target], environment));
});
test("scenario flags are explicit, unique, order-independent and never absorb unrelated arguments", () => {
  assert.deepEqual(probeFlag(["8595", "--climb", "--allow-state-changes"], "--climb"), {
    args: ["8595", "--allow-state-changes"],
    enabled: true,
  });
  assert.deepEqual(probeFlag(["8595"], "--auto"), { args: ["8595"], enabled: false });
  assert.throws(() => probeFlag(["--auto", "--auto"], "--auto"), /Duplicate/);
  assert.throws(
    () =>
      browserFixture(
        probeFlag(["8595", "--auto", "--unknown", "--allow-state-changes"], "--auto").args,
        environment,
      ),
    /exactly/,
  );
});

test("serialized typed observations preserve real WebSocket, draw overloads, transforms, blob identity and audio; reject invalid data without suppressing delivery", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("<!doctype html><title>Observation fixture, not a game</title>", {
        headers: { "content-type": "text/html" },
      }),
  });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let connects = 0;
    await page.routeWebSocket("**/*", (socket) => {
      connects++;
      socket.onMessage((data) => socket.send(data)); // Pure local echo; never connectToServer.
    });
    await page.addInitScript(installBrowserObservation);
    await page.goto(`http://127.0.0.1:${server.port}`);
    const result = await page.evaluate(async () => {
      const source = new WebSocket(`ws://${location.host}/ws`);
      await new Promise<void>((resolve, reject) => {
        source.onopen = () => resolve();
        source.onerror = () => reject(new Error("Mock echo failed"));
      });
      const self = {
        str: 8,
        dex: 6,
        int: 6,
        luk: 5,
        ap: 6,
        spawnPortal: 0,
        avatarItems: [1302000],
      };
      const packets = [
        { t: "field", mapId: 1000000, self, at: -100 },
        { t: "self", self },
        { t: "characters", characters: [{ id: 1, name: "NativeOne", str: 8, luk: 5 }] },
        {
          t: "inventory",
          inventory: {
            worn: [{ slot: 1, itemId: 1002008, cuc: 2, ruc: 4, stats: { str: 3 } }],
            tabs: [{ tab: 2, items: [{ slot: 4, itemId: 2000000, quantity: 3 }] }],
          },
        },
        {
          t: "mob-move",
          path: { originX: 1, originY: 2, elements: [{ duration: 3000, x: 1, y: 2 }] },
        },
        { t: "user-look", avatarItems: [1002008] },
        { t: "create", appearance: [1, 2, 3, 4, 5, 6, 4, 5, 6, 10] },
        { t: "created", ok: true, id: 1 },
        { t: "deleted", ok: false },
        { t: "delete-character", id: 1 },
        { t: "name-checked", result: 0 },
        { t: "change-slot", count: -1 },
        { t: "portal", name: "sp" },
        { t: "chat", text: "fixture" },
        { t: "ability-result", changed: true },
        { t: "login", user: "redacted-by-observation", password: "never-retained" },
        { t: "world", index: 0 },
        { t: "character", id: 1 },
        { t: "ability-up", field: "str" },
        { t: "error", message: "fixture" },
        { t: "future-packet", extra: { value: 123 } },
        { t: "move", x: 1, y: 2, vx: 125, vy: 0, action: 0, foothold: 32 },
      ];
      const received: unknown[] = [];
      source.onmessage = (event: MessageEvent<unknown>) => received.push(event.data);
      for (const packet of packets) source.send(JSON.stringify(packet));
      for (const bad of [
        '{"t":"move","x":"wrong"}',
        '{"t":"self","self":{}}',
        '{"t":"inventory","inventory":{"worn":[{}],"tabs":[]}}',
        '{"t":"mob-move","path":{"originX":1,"originY":2,"elements":[{"duration":"wrong"}]}}',
        '{"t":"created","ok":"yes"}',
        "[]",
        "{bad",
      ])
        source.send(bad);
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 3000;
        function check() {
          if (received.length === packets.length + 7) resolve();
          else if (performance.now() > deadline) reject(new Error("Lost echo delivery"));
          else setTimeout(check, 5);
        }
        check();
      });
      source.close();
      const canvas = document.createElement("canvas");
      canvas.width = 257;
      canvas.height = 113;
      document.body.append(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      const original = document.createElement("canvas");
      original.width = 2;
      original.height = 2;
      const originalContext = original.getContext("2d");
      if (!originalContext) throw new Error("No source context");
      originalContext.fillStyle = "#ff0000";
      originalContext.fillRect(0, 0, 2, 2);
      const image = new Image();
      image.src = original.toDataURL();
      await image.decode();
      ctx.drawImage(image, 1, 2);
      ctx.drawImage(image, 4, 5, 2, 2);
      ctx.drawImage(image, 0, 0, 2, 2, 7, 8, 2, 2);
      ctx.setTransform(-1, 0, 0, 1, 20, 30);
      ctx.drawImage(image, 0, 0);
      ctx.resetTransform();
      ctx.fillStyle = "rgba(255,255,0,0.5)";
      ctx.fillRect(1, 2, 3, 4);
      ctx.fillText("observed", 10, 20, 100);
      const pixel = [...ctx.getImageData(4, 5, 1, 1).data];
      const blob = await (await fetch("/api/avatar.png?face=20000")).blob();
      const url = URL.createObjectURL(blob);
      URL.revokeObjectURL(url);
      // A revoked URL remains attributable in draw history, but is no longer active.
      const blobIdentity = window.__kmsProbe.blobSources[url];
      const context = new AudioContext();
      const audio = context.createBufferSource(),
        buffer = context.createBuffer(1, 100, 8000);
      buffer.getChannelData(0).fill(0.5);
      audio.buffer = buffer;
      audio.start();
      await context.close();
      return {
        sent: window.__kmsProbe.sent,
        messages: window.__kmsProbe.messages,
        invalid: window.__kmsProbe.invalid,
        delivered: received.length,
        args: window.__kmsProbe.draws.map((d) => d.args.length),
        transform: window.__kmsProbe.draws.at(-1)?.matrix,
        marks: window.__kmsProbe.miniMarks,
        text: window.__kmsProbe.texts.at(-1),
        pixel,
        blobIdentity,
        active: window.__kmsProbe.activeBlobs.size,
        audio: window.__kmsProbe.audio,
      };
    });
    assert.equal(connects, 1);
    assert.equal(result.delivered, 29, "Invalid observation must not alter real delivery");
    assert.equal(result.sent.length, 22);
    assert.deepEqual(
      result.sent.map((p) => p.t),
      result.messages.map((p) => p.t),
    );
    assert.equal(result.invalid.length, 14, "Each bad packet diagnosed in both directions");
    assert.ok(
      result.messages.every((p) => p.at >= 0),
      "Wire-provided timestamps do not override local observation time",
    );
    assert.equal(JSON.stringify(result.sent).includes("never-retained"), false);
    assert.deepEqual(result.args, [2, 4, 8, 2]);
    assert.deepEqual(result.transform, { a: -1, e: 20, f: 30 });
    assert.deepEqual(result.pixel, [255, 0, 0, 255]);
    assert.deepEqual(result.marks, [[1, 2, 3, 4]]);
    assert.deepEqual(result.text, { text: "observed", x: 10, y: 20 });
    assert.equal(result.blobIdentity, "/api/avatar.png?face=20000");
    assert.equal(result.active, 0);
    assert.equal(result.audio[0]?.energy, true);
    assert.equal(result.audio[0]?.duration, 0.0125);
    await assert.rejects(assertProbePackets(page), /Invalid probe observations/);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      await probeBox(page.locator("canvas").first()).then((b) => [b.width, b.height]),
      [257, 113],
    );
    await assert.rejects(probeBox(page.locator("title")), /visible element/);
    await page.evaluate(() => {
      window.__kmsProbe.invalid.length = 0;
    });
    await assertProbePackets(page);
  } finally {
    await browser.close();
    server.stop(true);
  }
});

test("readonly game snapshots validate every consumed field, independently bounded histories and duplicate installation fail visibly", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.addInitScript(installBrowserObservation);
    await page.goto("about:blank");
    await assert.rejects(
      page.evaluate(() => window.__kmsProbe.game()),
      /game observation/,
    );
    const snapshot = await page.evaluate(() => {
      window.__kmsGameObservation = () => ({
        camera: { x: 1, y: 2 },
        mobs: [{ mobId: 1, templateId: 100100, x: 3, y: 4, facing: 0, walking: true }],
        arts: [[100100, { stand: [{ path: "Mob/0100100.img/stand/0", ox: 5, oy: 6 }] }]],
      });
      return window.__kmsProbe.game();
    });
    assert.equal(snapshot.mobs[0]?.templateId, 100100);
    assert.equal(snapshot.arts[0]?.[1].stand[0]?.ox, 5);
    for (const value of [
      { camera: { x: "1", y: 2 }, mobs: [], arts: [] },
      { camera: { x: 1, y: 2 }, mobs: [{}], arts: [] },
      { camera: { x: 1, y: 2 }, mobs: [], arts: [[1, { stand: [{ path: 1, ox: 0, oy: 0 }] }]] },
    ]) {
      await page.evaluate((value) => {
        window.__kmsGameObservation = () => value;
      }, value);
      await assert.rejects(
        page.evaluate(() => window.__kmsProbe.game()),
        /observation/,
      );
    }
    const bounds = await page.evaluate(() => {
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No context");
      for (let i = 0; i < 5100; i++) {
        ctx.drawImage(canvas, 0, 0);
        ctx.fillText(String(i), 0, 0);
      }
      return {
        draws: window.__kmsProbe.draws.length,
        texts: window.__kmsProbe.texts.length,
        first: window.__kmsProbe.texts[0]?.text,
      };
    });
    assert.deepEqual(bounds, { draws: 5000, texts: 5000, first: "100" });
    await assert.rejects(page.evaluate(installBrowserObservation), /already installed/);
  } finally {
    await browser.close();
  }
});

test("fixture login routing does not forward cross-origin requests or sockets", async () => {
  // No server/game accounts: all same-origin HTTP is locally fulfilled; login controls are inert.
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const origin = "http://fixture.invalid";
    await page.route(`${origin}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><button id="title-continue">Continue</button><input id="user"><input id="pass"><button id="login">Inert fixture</button>',
      }),
    );
    await fixtureLogin(page, origin, { user: "fixture", password: "fixture" });
    const blocked = await page.evaluate(async () => {
      try {
        await fetch("http://outside.invalid/secret");
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(blocked, true);
    assert.equal(await page.locator("#user").inputValue(), "fixture");
    const closed = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const socket = new WebSocket("ws://outside.invalid/ws");
          socket.onclose = (event) => resolve(event.code);
        }),
    );
    assert.equal(closed, 1008);
    const destination = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response('<input id="user"><input id="pass">', {
          headers: { "content-type": "text/html" },
        }),
    });
    const redirect = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.redirect(`http://127.0.0.1:${destination.port}`),
    });
    try {
      const redirected = await browser.newPage();
      await assert.rejects(
        fixtureLogin(redirected, `http://127.0.0.1:${redirect.port}`, {
          user: "must-not-leave-fixture",
          password: "must-not-be-filled",
        }),
        /admitted fixture|ERR_FAILED|ERR_CONNECTION/,
      );
      if (new URL(redirected.url()).origin === `http://127.0.0.1:${destination.port}`)
        assert.equal(await redirected.locator("#user").inputValue(), "");
    } finally {
      redirect.stop(true);
      destination.stop(true);
    }
  } finally {
    await browser.close();
  }
});
