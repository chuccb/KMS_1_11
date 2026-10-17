/** Real Chromium: native selection artwork/confirmation flow, facing, mob draw transforms.
 * Same external Playwright variables as browser_motion_probe.mjs. Uses alt, never admin. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const output = new URL('../../generated/validation/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [], httpErrors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && /\/api\/(png|avatar)/.test(r.url())) httpErrors.push([r.status(), r.url()]); });
  // Read-only observation of the real module; no injected movement, positions, terrain or messages.
  await page.route('**/main.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nwindow.__qa = () => ({camera: {...camera}, mobs: [...mobs.values()], arts: [...mobArts.entries()]});' });
  });
  await page.addInitScript(() => {
    window.qaSent = []; window.qaMessages = []; window.qaDraw = []; window.qaBlob = {};
    const Ws = window.WebSocket;
    window.WebSocket = class extends Ws {
      constructor(...args) { super(...args); this.addEventListener('message', (e) => { try { window.qaMessages.push(JSON.parse(e.data)); } catch {} }); }
      send(text) { try { window.qaSent.push(JSON.parse(text)); } catch {} super.send(text); }
    };
    const fetchOriginal = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args);
      if (String(args[0]).includes('/api/avatar.png')) {
        const blob = response.blob.bind(response);
        response.blob = async () => { const b = await blob(); b.qaQuery = String(args[0]); return b; };
      }
      return response;
    };
    const create = URL.createObjectURL;
    URL.createObjectURL = (blob) => { const url = create(blob); window.qaBlob[url] = blob.qaQuery; return url; };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => raf((now) => { window.qaDraw = []; callback(now); });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      const m = this.getTransform();
      window.qaDraw.push({ src: window.qaBlob[image.src] ?? decodeURIComponent(image.src ?? ''), args, matrix: { a: m.a, e: m.e, f: m.f } });
      return draw.call(this, image, ...args);
    };
  });
  await page.goto(`http://127.0.0.1:${process.argv[2] ?? 8495}/`);
  await page.click('#title-continue'); await page.fill('#user', 'alt'); await page.fill('#pass', 'alt'); await page.click('#login');
  await page.locator('#world-list button').first().waitFor();
  assert.equal(await page.locator('#world-connect').isDisabled(), true);
  await page.locator('#world-list button').first().click();
  assert.equal(await page.evaluate(() => window.qaSent.some((m) => m.t === 'world')), false);
  await page.waitForTimeout(1500);
  await page.locator('#view').screenshot({ path: fileURLToPath(new URL('world-select-native.png', output)) });
  await page.click('#world-connect');
  await page.locator('#character-list button').first().waitFor();
  await page.locator('#character-list button').first().click();
  assert.equal(await page.evaluate(() => window.qaSent.some((m) => m.t === 'character')), false);
  assert.equal(await page.locator('#character-delete').isDisabled(), false);
  await page.waitForTimeout(2000);
  await page.locator('#view').screenshot({ path: fileURLToPath(new URL('character-select-native.png', output)) });
  assert.equal(await page.evaluate(() => window.qaDraw.some((d) => d.src.includes('/api/avatar.png') && d.src.includes('stance=walk1') && d.src.includes('flip=1'))), true, 'native preview actions 2/4 have right-facing bit zero');
  assert.equal(await page.evaluate(() => [...document.fonts].find((f) => f.family.replaceAll('"', '') === 'KMSCJK')?.status), 'loaded');
  const charRecord = await page.evaluate(() => window.qaMessages.find((m) => m.t === 'characters').characters[0]);
  assert.equal(typeof charRecord.str, 'number');
  await page.click('#character-enter');
  await page.waitForFunction(() => window.qaMessages.some((m) => m.t === 'field'));
  await page.waitForTimeout(3000);
  const walk = async (direction, flip) => {
    await page.keyboard.down(direction); await page.waitForTimeout(650);
    const state = await page.evaluate(() => ({ move: window.qaSent.filter((m) => m.t === 'move').at(-1), avatar: window.qaDraw.filter((d) => d.src.includes('/api/avatar.png') && d.src.includes('stance=walk')).at(-1) }));
    assert.equal(state.move.action & 1, direction === 'ArrowLeft' ? 1 : 0);
    assert.ok(state.avatar, 'a real walk frame was drawn');
    assert.equal(new URL(state.avatar.src, 'http://test').searchParams.get('flip'), String(flip));
    await page.locator('#view').screenshot({ path: fileURLToPath(new URL(`facing-${direction === 'ArrowLeft' ? 'left' : 'right'}.png`, output)) });
    await page.keyboard.up(direction); await page.waitForTimeout(250);
    return state;
  };
  const right = await walk('ArrowRight', 1), left = await walk('ArrowLeft', 0);
  // Match actual WZ draws to live mobs by template, origin and current camera position.
  await page.waitForTimeout(1200);
  const mobs = await page.evaluate(() => {
    const state = window.__qa(); const arts = new Map(state.arts); const matches = [];
    for (const draw of window.qaDraw.filter((d) => d.src.includes('/api/png/Mob/'))) {
      const path = draw.src.slice(draw.src.indexOf('/api/png/') + 9);
      for (const mob of state.mobs) {
        const frames = Object.values(arts.get(mob.templateId) ?? {}).flat();
        const frame = frames.find((f) => f.path === path); if (!frame) continue;
        const x = draw.matrix.a < 0 ? draw.matrix.e : draw.args[0] + frame.ox;
        const y = draw.matrix.a < 0 ? draw.matrix.f : draw.args[1] + frame.oy;
        if (Math.abs(x - (mob.x - state.camera.x)) <= 1 && Math.abs(y - (mob.y - state.camera.y)) <= 1) {
          matches.push({ id: mob.mobId, facing: mob.facing, mirrored: draw.matrix.a < 0, walking: mob.walking });
          break;
        }
      }
    }
    return { matches, moves: window.qaMessages.filter((m) => m.t === 'mob-move') };
  });
  assert.ok(mobs.matches.length >= 3, JSON.stringify(mobs.matches));
  for (const mob of mobs.matches) assert.equal(mob.mirrored, mob.facing === 0, `mob ${mob.id} faces its logical direction`);
  assert.ok(mobs.moves.some((m) => m.path.elements.every((e) => e.x === m.path.originX && e.y === m.path.originY)), 'original idle decisions are broadcast');
  assert.ok(mobs.moves.some((m) => m.path.elements.some((e) => e.x !== m.path.originX)), 'walking decisions are broadcast');
  assert.deepEqual(errors, []); assert.deepEqual(httpErrors, []);
  // An empty account must not auto-enter an absent slot or require a user to discover a hidden form.
  await page.reload();
  await page.click('#title-continue'); await page.fill('#user', 'newbie'); await page.fill('#pass', 'newbie'); await page.click('#login');
  await page.locator('#world-list button').first().click(); await page.click('#world-connect');
  await page.waitForFunction(() => window.qaMessages.some((m) => m.t === 'characters'));
  assert.equal(await page.locator('#character-list button').count(), 0);
  assert.equal(await page.locator('#character-enter').isDisabled(), true);
  assert.equal(await page.locator('#character-new').isDisabled(), false);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.qaSent.some((m) => m.t === 'character')), false);
  await page.waitForTimeout(1200);
  await page.locator('#view').screenshot({ path: fileURLToPath(new URL('character-select-empty.png', output)) });
  await page.click('#character-new'); await page.click('#native-ok'); assert.equal(await page.locator('#new-character').isVisible(), true);
  await page.click('#create-cancel'); assert.equal(await page.locator('#new-character').isVisible(), false);
  assert.deepEqual(errors, []); assert.deepEqual(httpErrors, []);
  console.log(JSON.stringify({ status: 'BROWSER SELECTION/FACING PASS', character: charRecord.name, right: right.move, left: left.move,
    visibleMobs: mobs.matches, mobPackets: mobs.moves.length, errors, httpErrors }, null, 2));
} finally { await browser.close(); }
