/** Native decoded images + production compositor; all sockets blocked, no login/game services. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { artProviderOf } from "../src/game/art.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";
import { installBrowserObservation } from "../scripts/browser-observation.ts";
import { analyzeFrame, type FrameLayer } from "../scripts/probe-frame.ts";
import { probeFrame } from "../scripts/frame_probe.ts";
import "./fixtures/frame-evidence-browser.ts";

test(
  "real WZ background/tile/NPC/avatar/item/meso blits must reach view in one named RAF; offscreen, split, alpha0 and unpresented draws fail",
  { timeout: 60000 },
  async () => {
    const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")),
      provider = artProviderOf(archive),
      map = provider.mapArt(100000000);
    const background = map?.backs[0]?.path,
      tile = map?.sprites.find((sprite) => sprite.kind === "tile")?.frames[0]?.path,
      npc = provider.npc(2003)?.actions.stand[0]?.path;
    assert.ok(background && tile && npc);
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dirname, "fixtures/frame-evidence-browser.ts")],
      target: "browser",
      format: "esm",
    });
    assert.equal(build.success, true);
    const script = await build.outputs[0]!.text(),
      paths = { background, tile, npc };
    const art = await startWebClient({
      host: "127.0.0.1",
      port: 0,
      loginPort: 0,
      art: provider,
      itemCatalog: itemCatalogOf(archive),
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method !== "GET" || url.pathname === "/ws")
          return new Response("No game", { status: 403 });
        if (url.pathname === "/")
          return new Response(
            `<canvas id="view"></canvas><script type="module">import{installFrameEvidence}from"/fixture.js";await installFrameEvidence(${JSON.stringify(paths)});</script>`,
            { headers: { "content-type": "text/html" } },
          );
        if (url.pathname === "/fixture.js")
          return new Response(script, { headers: { "content-type": "text/javascript" } });
        return fetch(`http://127.0.0.1:${art.port}${url.pathname}${url.search}`);
      },
    });
    const browser = await launchBrowser().catch(async (error: unknown) => {
      server.stop(true);
      await art.close();
      throw error;
    });
    try {
      const page = await browser.newPage(),
        origin = `http://127.0.0.1:${server.port}`;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const guard = await readOnlyBrowserPage(page, origin);
      await page.addInitScript(installBrowserObservation);
      await page.goto(origin);
      await page
        .waitForFunction(() => !!window.frameEvidenceFixture, undefined, { timeout: 5000 })
        .catch(() => {
          throw new Error(`Native frame fixture did not initialize: ${errors.join("; ")}`);
        });
      const layers: FrameLayer[] = [
        "background",
        "tile",
        "avatar",
        "npc",
        "item-drop",
        "meso-drop",
      ];
      const snapshot = () => page.evaluate(() => window.__kmsProbe.draws);
      await page.evaluate((layers) => window.frameEvidenceFixture.paint(layers), layers);
      const complete = analyzeFrame(await snapshot(), origin, layers);
      assert.ok(complete);
      assert.equal(complete.layers.length, 6);
      assert.equal(complete.frame, 1);
      for (const mode of [
        "outside",
        "transparent",
        "unpresented",
        "cleared",
        "reset",
        "resized",
      ] as const) {
        await page.evaluate(({ layers, mode }) => window.frameEvidenceFixture.paint(layers, mode), {
          layers,
          mode,
        });
        assert.equal(analyzeFrame(await snapshot(), origin, layers), undefined, mode);
      }
      await page.evaluate(() => window.frameEvidenceFixture.paint(["background", "tile"]));
      await page.evaluate(() =>
        window.frameEvidenceFixture.paint(["avatar", "npc", "item-drop", "meso-drop"]),
      );
      assert.equal(
        analyzeFrame(await snapshot(), origin, layers),
        undefined,
        "prior RAF assets must not leak into the latest frame",
      );
      const outOfFrame = await page.evaluate(async () => {
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        if (!ctx) throw Error("No context");
        const before = window.__kmsProbe.draws.length;
        let threw = false;
        try {
          Reflect.apply(ctx.drawImage, ctx, [canvas]);
        } catch {
          threw = true;
        }
        if (!threw || window.__kmsProbe.draws.length !== before)
          throw Error("Failed native draw was recorded");
        await new Promise<void>((resolve) =>
          requestAnimationFrame(function unrelated() {
            ctx.drawImage(canvas, 0, 0);
            resolve();
          }),
        );
        return window.__kmsProbe.draws.at(-1)?.frame;
      });
      assert.equal(outOfFrame, 0, "unrelated RAF must not inherit the last game frame");
      const observations = await page.evaluate(() => ({
        invalid: window.__kmsProbe.invalid,
        sequence: window.__kmsProbe.sequence,
        dropped: window.__kmsProbe.droppedMessages,
      }));
      assert.deepEqual(observations, { invalid: [], sequence: 0, dropped: 0 });
      assert.deepEqual(errors, []);
      assert.equal(guard.socketAttempts, 0);
      // Exercise the migrated tool on the complete, actual client: safe title-only path, not field admission.
      const title = await probeFrame([`http://127.0.0.1:${art.port}`], {});
      assert.equal(title.stage, "read-only-title");
      assert.ok(title.layers.includes("title"));
      assert.equal(title.socketAttempts, 0);
    } finally {
      await browser.close();
      server.stop(true);
      await art.close();
    }
  },
);
