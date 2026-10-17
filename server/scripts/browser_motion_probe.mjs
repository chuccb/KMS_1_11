/** Real-browser regression against a running world. Optional external Playwright installation.
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs
 * CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node server/scripts/browser_motion_probe.mjs 8495
 * Without those variables, uses installed `playwright` and its default Chromium.
 * Uses the configured admin account; screenshots go into ignored generated/validation/.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  // Capture the viewport crop directly: locator.screenshot waits for stable RAF layout while
  // software-rendered continuous game frames may starve that wait under a concurrent test suite.
  const screenshot = async (name) => page.screenshot({ path: fileURLToPath(new URL(name, output)), clip: await page.locator('#view').boundingBox() });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.probeAudio = [];
    const Context = window.AudioContext;
    if (Context) window.AudioContext = class extends Context {
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          window.probeAudio.push({ loop: source.loop, duration: source.buffer?.duration, rate: source.buffer?.sampleRate,
            energy: source.buffer?.getChannelData(0).some((sample) => Math.abs(sample) > 0.001), state: this.state });
          return start(...args);
        };
        return source;
      }
    };
    window.probeMessages = [];
    window.probeSent = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          try { window.probeMessages.push(JSON.parse(event.data)); } catch { /* non-JSON */ }
        });
      }
      send(data) {
        try { window.probeSent.push({ at: performance.now(), ...JSON.parse(data) }); } catch { /* non-JSON */ }
        super.send(data);
      }
    };
  });
  await page.goto(`http://127.0.0.1:${process.argv[2] ?? '8495'}/`);
  await page.click('#title-continue');
  await page.fill('#user', process.env.BROWSER_ACCOUNT ?? 'admin');
  await page.fill('#pass', process.env.BROWSER_PASSWORD ?? 'admin');
  await page.click('#login');
  await page.locator('#world-list button').first().click();
  await page.click('#world-connect');
  await page.waitForFunction(() => window.probeMessages.some((m) => m.t === 'characters'));
  if (await page.locator('#character-list button').count() === 0) {
    await page.click('#character-new');
    await page.fill('#new-name', process.env.BROWSER_NAME ?? 'Hero');
    await page.click('#create');
  }
  await page.locator('#character-list button').first().click();
  await page.click('#character-enter');
  await page.waitForFunction(() => window.probeMessages.some((m) => m.t === 'field'));
  await page.waitForTimeout(4000); // preload the archive images; no synthetic scene injection
  const output = new URL('../../generated/validation/', import.meta.url);
  await mkdir(output, { recursive: true });
  await screenshot('map-before.png');
  await page.keyboard.press('Escape');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(300);
  const jumpStart = await page.evaluate(() => window.probeSent.length);
  await page.keyboard.down('Alt');
  await page.waitForTimeout(150);
  await page.keyboard.up('Alt');
  await screenshot('map-jump.png');
  await page.waitForTimeout(1200);
  await screenshot('map-after.png');
  const { moves, jump, mob } = await page.evaluate((start) => ({
    moves: window.probeSent.filter((m) => m.t === 'move'),
    jump: window.probeSent.slice(start).filter((m) => m.t === 'move'),
    mob: window.probeMessages.find((m) => m.t === 'mob-move'),
  }), jumpStart);
  assert.deepEqual(errors, [], 'no browser exceptions');
  assert.ok(moves.some((m) => m.vx === 125 && (m.action & ~1) === 0), 'original walking baseline');
  assert.ok(jump.some((m) => m.vy < 0 && m.foothold === 0 && (m.action & ~1) === 70), 'ascending jump');
  assert.ok(jump.some((m) => m.vy > 0 && m.foothold === 0), 'falling jump');
  assert.ok(jump.at(-1).foothold > 0 && jump.at(-1).vy === 0, 'landed on a real foothold');
  assert.ok(mob?.path?.elements?.some((e) => e.duration > 100), 'mob path duration survives the bridge');
  if (process.argv.includes('--climb')) {
    // First Amherst map: real rope 3 at x=718, WZ y=97..273. Walk there, do not inject position.
    const x = () => page.evaluate(() => window.probeSent.findLast((m) => m.t === 'move')?.x ?? -91);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => (window.probeSent.findLast((m) => m.t === 'move')?.x ?? -91) >= 560, null, { timeout: 20000 });
    // The original ground has a 60px upward wall at x=591: jump it, don't assert walking through it.
    await page.keyboard.down('Alt'); await page.waitForTimeout(350); await page.keyboard.up('Alt');
    await page.waitForFunction(() => (window.probeSent.findLast((m) => m.t === 'move')?.x ?? -91) >= 704, null, { timeout: 20000 });
    await page.keyboard.up('ArrowRight'); await page.waitForTimeout(400);
    for (let i = 0; i < 15 && Math.abs((await x()) - 718) > 4; i++) {
      const current = await x();
      const key = current < 718 ? 'ArrowRight' : 'ArrowLeft';
      const distance = Math.abs(current - 718);
      const ms = Math.min(180, distance < 15 ? Math.sqrt(distance / 1925) * 1000 : (distance - 4.18) * 8);
      // Browser-local key pulses avoid DevTools round-trip latency holding a 50ms tap for 200ms.
      // These are normal input events through the game's handlers, never position/state injection.
      await page.evaluate(async ({ key, ms }) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, ms));
        window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      }, { key, ms });
      await page.waitForTimeout(350);
    }
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1000); await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(300);
    const hanging = await page.evaluate(() => window.probeSent.findLast((m) => m.t === 'move'));
    assert.equal(hanging.action & ~1, 74, `attached to a real rope: ${JSON.stringify(hanging)}`);
    assert.equal(hanging.vy, 0, 'rope stops moving without Up/Down');
    assert.equal(hanging.x, 718);
    await screenshot('map-rope-fixed.png');
    await page.waitForTimeout(500);
    const stopped = await page.evaluate(() => window.probeSent.findLast((m) => m.t === 'move'));
    assert.equal(stopped.y, hanging.y, 'holding still must not slide');
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => {
      const m=window.probeSent.findLast(m=>m.t==='move');return m?.foothold===277&&m.y===95;
    },null,{timeout:6000});
    await page.waitForTimeout(2000); // Keep Up held after reaching the REAL top, then release it.
    await page.keyboard.up('ArrowUp'); await page.waitForTimeout(1500);
    const top=await page.evaluate(()=>window.probeSent.findLast(m=>m.t==='move'));
    assert.deepEqual([top.x,top.y,top.foothold,top.vy],[718,95,277,0]);
    await screenshot('map-rope-top-fixed.png');
    console.log('REAL ROPE TOP / HELD UP / RELEASED STABILITY OK',JSON.stringify(top));
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('Alt');
    await page.waitForTimeout(200); await page.keyboard.up('Alt'); await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(800);
    console.log('REAL ROPE ATTACH / CLIMB / STOP / JUMP OK', JSON.stringify(hanging));
  }
  const audio = await page.evaluate(() => window.probeAudio);
  assert.ok(audio.some((a) => a.loop && a.duration > 60 && a.energy && a.state === 'running'), 'native BGM decoded and started in a running AudioContext');
  assert.ok(audio.some((a) => !a.loop && a.duration < 0.2 && a.energy), 'native Jump/UI effect decoded and started separately');
  console.log('REAL AUDIO DECODE / PLAYBACK OK', JSON.stringify(audio));
  console.log(JSON.stringify({ moves: moves.length, jump: jump.map(({ x, y, vy, foothold, action }) => ({ x, y, vy, foothold, action })), mobDuration: mob.path.elements[0].duration, errors, screenshots: fileURLToPath(output) }, null, 2));
  console.log('REAL BROWSER MOTION OK');
} finally {
  await browser.close();
}
