/** Decode every original Sound leaf/alias in real Chromium, not a fake AudioContext.
 * Start the WZ-enabled server, then:
 * PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROMIUM_EXECUTABLE=/path/to/chromium \
 *   node server/scripts/browser_audio_probe.mjs 8495
 * Optional external browser tooling only; no runtime package dependency or generated asset commit.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WzArchive } from '../src/wz/archive.ts';
import { WzNode } from '../src/wz/img.ts';
const archive = WzArchive.open(fileURLToPath(new URL('../../Data.wz', import.meta.url)));
const paths = [];
function walk(node, path) {
  if (node.kind === 'raw' || node.kind === 'uol') paths.push(path);
  else for (const e of node.props) if (e.value instanceof WzNode) walk(e.value, `${path}/${e.name}`);
}
for (const image of archive.images.filter((i) => i.path.startsWith('Sound/'))) {
  for (const e of archive.objects(image.path)[0].props) if (e.value instanceof WzNode) walk(e.value, `${image.path}/${e.name}`);
}
const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${process.argv[2] ?? '8495'}/`);
  const result = await page.evaluate(async (paths) => {
    const context = new AudioContext(), errors = [];
    let decoded = 0, silent = 0;
    for (const path of paths) {
      try {
        const response = await fetch(`/api/audio/${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!buffer.getChannelData(0).some((v) => Math.abs(v) > 0.0001)) silent++;
        decoded++;
      } catch (e) { errors.push({ path, message: e.message }); }
    }
    await context.close();
    return { decoded, silent, errors };
  }, paths);
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.decoded, 150);
  assert.equal(result.silent, 0);
  assert.deepEqual(result.errors, []);
  console.log('ALL 150 ORIGINAL SOUNDS DECODE OK');
} finally {
  await browser.close();
}
