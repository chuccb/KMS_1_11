/** Real Chromium + original WZ PNGs + production reward modules on an isolated component page.
 * This is NOT a game/login/manual acceptance probe: no credentials, sockets, actors or saves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive, footholdSegments } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { DropField } from "../src/game/drops.ts";
import { nonEquipSlot } from "../src/protocol/itemslot.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { readDropAppear, type DropAppear } from "../src/protocol/drop.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";
import { mesoFramePath } from "../../client/drop-renderer.ts";
import type { RewardFixtureInput } from "./fixtures/drop-render-browser.ts";

test("real reward PNG bottoms touch authoritative WZ FH at DPR1/2; fixed money frames, continuous hop/pickup, alpha/error/loading/culling", async () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const segments = footholdSegments(archive.objects("Map/Map/101000000.img")[0]);
  const floor = [...segments.values()].find((f) => f.x2 - f.x1 > 100 && f.y1 !== f.y2);
  assert.ok(floor);
  const field = new DropField({ footholds: segments }),
    x = Math.trunc((floor.x1 + floor.x2) / 2),
    y = Math.round(floor.y1 + ((x - floor.x1) * (floor.y2 - floor.y1)) / (floor.x2 - floor.x1));
  const entry = field.dropFromPlayer(
    { slot: nonEquipSlot(4000019, 1), count: 1, x, y: y - 5, foothold: 0 },
    0,
  );
  const body = readDropAppear(new PacketReader(field.appearPacket(entry), 1));
  const support = segments.get(entry.foothold);
  assert.ok(support);
  assert.ok(
    Math.abs(
      body.y -
        (support.y1 +
          ((body.x - support.x1) * (support.y2 - support.y1)) / (support.x2 - support.x1)),
    ) <= 0.5,
  );
  const camera = { x: body.x - 200.25, y: body.y - 300.25 };
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dirname, "fixtures/drop-render-browser.ts")],
    target: "browser",
    format: "esm",
  });
  assert.equal(build.success, true);
  const script = await build.outputs[0]!.text();
  const art = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    art: artProviderOf(archive),
    itemCatalog: itemCatalogOf(archive),
  });
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (request.method !== "GET")
        return new Response("Fixture accepts GET only", { status: 405 });
      if (url.pathname === "/")
        return new Response(
          '<!doctype html><html><body><script type="module">import {installRewardFixture} from "/fixture.js";installRewardFixture();</script></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      if (url.pathname === "/fixture.js")
        return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (/^\/api\/(item\/\d+|png\/[^/]+)$/.test(url.pathname))
        return fetch(`http://127.0.0.1:${art.port}${url.pathname}`);
      return new Response("Not a game endpoint", { status: 404 });
    },
  });
  const browser = await launchBrowser().catch(async (error: unknown) => {
    server.stop(true);
    await art.close();
    throw error;
  });
  try {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ deviceScaleFactor: dpr }),
        page = await context.newPage();
      try {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const guard = await readOnlyBrowserPage(page, `http://127.0.0.1:${server.port}`);
        await page.goto(`http://127.0.0.1:${server.port}`);
        await page.waitForFunction(() => !!window.rewardFixture);
        const render = (drop: DropAppear, now = 1000, extra: Partial<RewardFixtureInput> = {}) =>
          page.evaluate((input) => window.rewardFixture.render(input), {
            drop,
            now,
            camera,
            ...extra,
          });
        const pending = await render({ ...body, money: true, value: 1 }, 0, { wait: false });
        assert.equal(pending.painted, false);
        assert.equal(pending.draw, undefined, "No placeholder when a real PNG is pending");
        for (const id of [4000019, 2000000, 1302000, 1452000]) {
          const result = await render({ ...body, value: id });
          assert.equal(result.painted, true);
          assert.ok(result.draw);
          assert.equal(result.draw.y + result.draw.height, 300);
          assert.equal(result.opaqueBottom, 300);
          assert.equal(result.draw.x + Math.trunc(result.draw.width / 2), 200);
          assert.equal(result.pose?.y, body.y);
        }
        for (const amount of [1, 50, 100, 1000])
          for (let frame = 0; frame < 4; frame++) {
            const now = frame * 140,
              result = await render({ ...body, money: true, value: amount }, now, { alpha: 0.6 });
            assert.equal(result.painted, true);
            assert.ok(result.draw);
            assert.equal(result.draw.path, `/api/png/${mesoFramePath(amount, now)}`);
            assert.equal(result.draw.y + result.draw.height, 300);
            assert.equal(result.opaqueBottom, 300);
            assert.equal(result.draw.x + Math.trunc(result.draw.width / 2), 200);
            assert.equal(result.alpha, 0.6);
          }
        const flying = { ...body, kind: 1, mobId: 1, mobX: body.x - 40, mobY: body.y - 80 };
        const before = await render(flying, 419.9999),
          rest = await render(flying, 420);
        assert.ok(before.pose && rest.pose);
        assert.ok(Math.abs(before.pose.y - rest.pose.y) < 0.001);
        assert.equal(rest.draw!.y + rest.draw!.height, 300);
        const transient = { ...flying, kind: 0 },
          transientEnd = await render(transient, 420),
          transientGuard = await render({ ...transient, animationStartOffset: 10000 }, 13001);
        assert.equal(transientEnd.pose, undefined, "browser removes kind 0 at animation state 3");
        assert.equal(transientEnd.painted, false);
        assert.equal(
          transientGuard.pose,
          undefined,
          "the offset-aware native cleanup guard is honored",
        );
        const hopping = await render(flying, 100),
          pickup = await render(flying, 100, {
            pickup: { at: 100, id: 9, taker: { x: body.x + 100, y: body.y } },
            alpha: 0.6,
          });
        assert.deepEqual([pickup.pose?.x, pickup.pose?.y], [hopping.pose?.x, hopping.pose?.y]);
        assert.equal(pickup.alpha, 0.6);
        const fade = await render(flying, 230, {
          pickup: { at: 100, id: 9, taker: { x: body.x + 100, y: body.y } },
          alpha: 0.6,
        });
        assert.equal(fade.draw?.alpha, 0.375);
        assert.equal(fade.alpha, 0.6);
        const gone = await render(flying, 360, { pickup: { at: 100, id: 9 } });
        assert.equal(gone.painted, false);
        assert.equal(gone.pose, undefined);
        const culled = await render(body, 1000, { camera: { x: body.x - 2000, y: body.y - 2000 } });
        assert.equal(culled.painted, false);
        const failure = await render(body, 1000, { throwDraw: true, alpha: 0.6 });
        assert.match(failure.error ?? "", /Deliberate fixture/);
        assert.equal(failure.alpha, 0.6);
        const missing = await render({ ...body, value: 9999998 });
        assert.equal(missing.painted, false);
        assert.equal(missing.draw, undefined);
        assert.deepEqual(errors, []);
        assert.equal(guard.socketAttempts, 0);
      } finally {
        await context.close();
      }
    }
    assert.ok(requests.some((path) => path.includes("/api/png/")));
    assert.ok(requests.every((path) => path.startsWith("GET ")));
    assert.ok(!requests.some((path) => /\/(ws|login|world|character|save)(\b|\/)/.test(path)));
  } finally {
    try {
      await browser.close();
    } finally {
      server.stop(true);
      await art.close();
    }
  }
});
