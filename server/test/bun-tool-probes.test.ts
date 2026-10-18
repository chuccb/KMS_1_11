import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { equipmentFixtureAccounts, writeEquipmentFixture } from "../scripts/equipment_fixture.ts";
import { browserOrigin } from "../scripts/browser.ts";
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

test("typed read-only audio probe decodes all 150 original Sound leaves and aliases without authentication", async () => {
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
});
