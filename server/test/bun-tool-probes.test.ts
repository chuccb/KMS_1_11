import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { equipmentFixtureAccounts, writeEquipmentFixture } from "../scripts/equipment_fixture.ts";
import { browserOrigin, launchBrowser, readOnlyBrowserPage } from "../scripts/browser.ts";
import { probeDisplay } from "../scripts/browser_display_probe.ts";
import { profileRender } from "../scripts/browser_render_probe.ts";
import { artProviderOf } from "../src/game/art.ts";
import { decodeOriginalSounds, originalSoundPaths } from "../scripts/browser_audio_probe.ts";
import { readSave } from "../src/game/save.ts";
import { isRecord } from "../../client/resource-validation.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { audioProviderOf } from "../src/game/audio.ts";
import { startWebClient } from "../src/net/webclient.ts";

const root = resolve(import.meta.dirname, "../..");

test("browser CLI requires an explicit credential-free HTTP origin and rejects ambiguous or unsafe targets", () => {
  assert.equal(browserOrigin("8515"), "http://127.0.0.1:8515");
  assert.equal(browserOrigin("https://8515-example.e2b.app/"), "https://8515-example.e2b.app");
  for (const input of [
    undefined,
    "",
    "0",
    "65536",
    "file:///tmp/a",
    "ws://localhost:8515",
    "https://user:pass@localhost/",
    "http://localhost/path",
    "http://localhost/?a=1",
    "http://localhost/#fragment",
  ]) {
    assert.throws(() => browserOrigin(input), `Invalid target: ${String(input)}`);
  }
});

test("equipment fixture data is typed and isolated; writing is exclusive and cannot escape via symlink", () => {
  const accounts = equipmentFixtureAccounts();
  assert.equal(accounts.size, 5);
  assert.equal(accounts.get("gear")?.characters[0].stats.name, "GearHero");
  assert.equal(accounts.get("stat")?.characters[0].stats.ap, 6);
  const base = resolve(root, "generated/validation");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "typed-fixture-test-"));
  const outside = mkdtempSync(resolve(root, "generated/outside-fixture-test-"));
  try {
    const path = join(directory, "new.json");
    assert.equal(writeEquipmentFixture(path), path);
    const bytes = readFileSync(path);
    assert.equal(readSave(bytes.toString()).size, 5);
    assert.throws(() => writeEquipmentFixture(path), /EEXIST/);
    assert.deepEqual(readFileSync(path), bytes, "existing fixture must never be replaced");
    const escape = join(outside, "must-not-create.json");
    assert.throws(() => writeEquipmentFixture(escape), /explicit NEW/);
    assert.equal(existsSync(escape), false);
    assert.throws(() => writeEquipmentFixture(join(directory, "wrong.txt")), /explicit NEW/);
    symlinkSync(outside, join(directory, "link"), "dir");
    assert.throws(() => writeEquipmentFixture(join(directory, "link", "escape.json")), /escapes/);
    assert.equal(existsSync(join(outside, "escape.json")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("Bun-native PNG compression instrumentation counts actual work and cache reuse in a separate process", async () => {
  const child = Bun.spawn([process.execPath, "server/scripts/art_perf_probe.ts"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(status, 0, stdout + stderr);
  const report: unknown = JSON.parse(stdout);
  assert.ok(isRecord(report));
  assert.equal(report.mapPngCompressions, 0);
  assert.equal(report.avatarPngCompressions, 3);
  assert.equal(report.cachedPngReused, true);
  assert.ok(typeof report.sprites === "number" && report.sprites > 0);
});

test(
  "typed read-only audio probe decodes all 150 original Sound leaves and aliases without authentication",
  // Real Chromium + 150 real WZ Sound decodes: bun's 5s unit-test default was never sized for
  // this (an abort here also cascades "Target closed" into the next browser test's launch).
  { timeout: 60000 },
  async () => {
    const archive = WzArchive.open(resolve(root, "Data.wz"));
    const paths = originalSoundPaths(archive);
    assert.equal(paths.length, 150);
    const server = await startWebClient({
      host: "127.0.0.1",
      port: 0,
      loginPort: 0,
      audio: audioProviderOf(archive),
    });
    try {
      const result = await decodeOriginalSounds(`http://127.0.0.1:${server.port}`, paths);
      assert.equal(result.decoded, 150);
      assert.equal(result.silent, 0);
      assert.deepEqual(result.errors, []);
    } finally {
      await server.close();
    }
  },
);

test(
  "typed display probe verifies seven DPRs, four fixed resolutions, one-to-one pixels, HUD alignment and saved resolution without login",
  { timeout: 60000 },
  async () => {
    const archive = WzArchive.open(resolve(root, "Data.wz"));
    const server = await startWebClient({
      host: "127.0.0.1",
      port: 0,
      loginPort: 0,
      art: artProviderOf(archive),
    });
    try {
      const results = await probeDisplay(`http://127.0.0.1:${server.port}`);
      assert.deepEqual(
        results.map((result) => result.dpr),
        [1, 1.1, 1.25, 1.5, 1.75, 2, 3],
      );
      assert.ok(results.every((result) => !result.errors.length));
    } finally {
      await server.close();
    }
  },
);

test(
  "typed title profiler counts actual canvas blits over 120 real frames with all WebSockets blocked",
  { timeout: 60000 },
  async () => {
    const archive = WzArchive.open(resolve(root, "Data.wz"));
    const server = await startWebClient({
      host: "127.0.0.1",
      port: 0,
      loginPort: 0,
      art: artProviderOf(archive),
    });
    try {
      const result = await profileRender(`http://127.0.0.1:${server.port}`);
      assert.equal(result.stage, "read-only-title");
      assert.equal(result.samples, 120);
      assert.ok(result.draws.mean > 0);
      assert.deepEqual(result.errors, []);
    } finally {
      await server.close();
    }
  },
);

test(
  "typed avatar image cache decodes real packed WZ PNG and preserves pixels after blob URL revocation",
  { timeout: 60000 },
  async () => {
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dirname, "helpers/image-cache-browser.ts")],
      target: "browser",
      format: "esm",
    });
    assert.equal(build.success, true, build.logs.join("\n"));
    const js = await build.outputs[0].text();
    const archive = WzArchive.open(resolve(root, "Data.wz"));
    const server = await startWebClient({
      host: "127.0.0.1",
      port: 0,
      loginPort: 0,
      art: artProviderOf(archive),
    });
    try {
      const browser = await launchBrowser();
      try {
        const origin = `http://127.0.0.1:${server.port}`,
          page = await browser.newPage(),
          errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const traffic = await readOnlyBrowserPage(page, origin);
        await page.route(`${origin}/`, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<!doctype html><body><script type="module" src="/fixture-image.js"></script>',
          }),
        );
        await page.route(`${origin}/fixture-image.js`, (route) =>
          route.fulfill({ contentType: "application/javascript", body: js }),
        );
        await page.goto(origin);
        await page.waitForFunction(
          () => document.documentElement.dataset.fixtureState !== undefined,
        );
        assert.equal(
          await page.locator("html").getAttribute("data-fixture-state"),
          "ready",
          await page.locator("body").innerText(),
        );
        assert.equal(traffic.socketAttempts, 0);
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
      }
    } finally {
      // Launch failures or a rejecting browser.close must still release the independent HTTP fixture.
      await server.close();
    }
  },
);
