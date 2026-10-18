/** Read-only original Sound leaf/alias decoding in Chromium. Never authenticates or writes a save.
 * bun server/scripts/browser_audio_probe.ts <web-port|http(s)://origin>
 * Uses pinned browser tooling; CHROMIUM_EXECUTABLE can select an installed Chromium.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { WzNode } from "../src/wz/img.ts";
import { browserOrigin, launchBrowser } from "./browser.ts";

export function originalSoundPaths(archive: WzArchive): string[] {
  const paths: string[] = [];
  function walk(node: WzNode, path: string) {
    if (node.kind === "raw" || node.kind === "uol") paths.push(path);
    else
      for (const entry of node.props)
        if (entry.value instanceof WzNode) walk(entry.value, `${path}/${entry.name}`);
  }
  for (const image of archive.images.filter((image) => image.path.startsWith("Sound/"))) {
    const root = archive.objects(image.path)[0];
    assert.ok(root, `Original sound image root missing: ${image.path}`);
    for (const entry of root.props)
      if (entry.value instanceof WzNode) walk(entry.value, `${image.path}/${entry.name}`);
  }
  return paths;
}
export async function decodeOriginalSounds(target: string, paths: string[]) {
  const origin = browserOrigin(target);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    let socketAttempts = 0;
    await page.routeWebSocket("**/*", (socket) => {
      socketAttempts++;
      socket.close({ code: 1008, reason: "Read-only audio probe does not authenticate" });
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      return new URL(request.url()).origin === origin && request.method() === "GET"
        ? route.continue()
        : route.abort();
    });
    // Establish the same origin without starting the game's render/audio loops. This probe
    // measures real decodeAudioData, not UI animation performance or authentication.
    await page.route(`${origin}/`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Read-only original sound validation</title>",
      }),
    );
    await page.goto(origin);
    const result = await page.evaluate(async (paths) => {
      const context = new AudioContext();
      const errors: { path: string; message: string }[] = [];
      let decoded = 0,
        silent = 0;
      try {
        for (const path of paths) {
          try {
            const response = await fetch(`/api/audio/${encodeURIComponent(path)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            if (!buffer.getChannelData(0).some((value) => Math.abs(value) > 0.0001)) silent++;
            decoded++;
          } catch (error) {
            errors.push({ path, message: error instanceof Error ? error.message : String(error) });
          }
        }
      } finally {
        await context.close();
      }
      return { decoded, silent, errors };
    }, paths);
    assert.equal(socketAttempts, 0, "Audio probe must never attempt authentication");
    return result;
  } finally {
    await browser.close();
  }
}
if (import.meta.main) {
  if (process.argv.length !== 3) throw new Error("Supply exactly one web port or http(s) origin");
  const archive = WzArchive.open(fileURLToPath(new URL("../../Data.wz", import.meta.url)));
  const result = await decodeOriginalSounds(
    browserOrigin(process.argv[2]),
    originalSoundPaths(archive),
  );
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.decoded, 150);
  assert.equal(result.silent, 0);
  assert.deepEqual(result.errors, []);
  console.log("ALL 150 ORIGINAL SOUNDS DECODE OK (read-only; no authentication)");
}
