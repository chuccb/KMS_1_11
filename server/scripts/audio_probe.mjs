import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, soundPath, spatialVolume } from '../../client/audio.mjs';
const tick = () => new Promise((r) => setImmediate(r));
function fixture(fetch) {
  const sources = [], gains = [], requests = [];
  const context = {
    destination: {}, resume: async () => {},
    createGain() { const g = { gain: { value: 1 }, connect() {} }; gains.push(g); return g; },
    async decodeAudioData(data) { return { data, length: 100, numberOfChannels: 2 }; },
    createBufferSource() { const s = { starts: 0, stops: 0, connect(to) { this.output = to; }, disconnect() {}, start() { this.starts++; }, stop() { this.stops++; } }; sources.push(s); return s; },
  };
  const errors = [];
  const audio = createAudio({ createContext: () => context, onError: (e) => errors.push(e), fetch: async (url) => { requests.push(url); return fetch ? fetch(url) : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; } });
  return { audio, sources, gains, requests, errors };
}
test('BGM waits for a user gesture; looping uses the original map sound path', async () => {
  const f = fixture(); f.audio.setBgm('Bgm00/RestNPeace'); await tick();
  assert.equal(f.requests.length, 0);
  await f.audio.unlock(); await tick();
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0].loop, true);
  assert.equal(f.sources[0].starts, 1);
  assert.equal(decodeURIComponent(f.requests[0]), '/api/audio/Sound/Bgm00.img/RestNPeace');
});
test('re-entering a map with the same BGM does not restart it', async () => {
  const f = fixture(); f.audio.setBgm('Bgm00/RestNPeace'); await f.audio.unlock(); await tick();
  f.audio.setBgm('Bgm00/RestNPeace'); await tick();
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0].stops, 0);
});
test('jump/UI effects overlap music on a separate gain; cache prevents repeated fetch/decode', async () => {
  const f = fixture(); f.audio.setBgm('BgmUI/Title'); await f.audio.unlock(); await tick();
  await f.audio.effect('Game/Jump'); await f.audio.effect('Game/Jump');
  assert.equal(f.requests.length, 2); assert.equal(f.sources.length, 3);
  assert.equal(f.sources[0].stops, 0);
  assert.notEqual(f.sources[0].output, f.sources[1].output);
});
test('mute and independent volumes silence both buses, then restore their values', async () => {
  const f = fixture(); await f.audio.unlock(); f.audio.setVolumes(0.3, 0.8);
  f.audio.setMuted(true); await f.audio.effect('Game/Jump');
  assert.deepEqual(f.gains.map((g) => g.gain.value), [0, 0]); assert.equal(f.requests.length, 0);
  f.audio.setMuted(false); assert.deepEqual(f.gains.map((g) => g.gain.value), [0.3, 0.8]);
});
test('late music decode from an earlier map cannot replace the current map music', async () => {
  let finish;
  const f = fixture((url) => url.includes('Slow') ? new Promise((r) => { finish = r; }) : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  await f.audio.unlock(); f.audio.setBgm('Bgm00/Slow'); await tick();
  f.audio.setBgm('Bgm01/Fast'); await tick();
  finish({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }); await tick();
  assert.equal(f.sources.length, 1); assert.equal(f.audio.bgm, 'Sound/Bgm01.img/Fast');
});
test('unavailable browser audio is a no-op, not a game-breaking exception', async () => {
  const audio = createAudio({ createContext: () => undefined }); audio.setBgm('BgmUI/Title');
  await audio.unlock(); await audio.effect('UI/BtMouseClick'); audio.setMuted(true); audio.stop();
});
test('a missing sound reports once and does not crash the game', async () => {
  const f = fixture(() => ({ ok: false, status: 404 })); await f.audio.unlock();
  await f.audio.effect('Game/Missing'); await f.audio.effect('Game/Missing');
  assert.equal(f.errors.length, 1); assert.equal(f.sources.length, 0);
});
test('original sound paths are not rewritten into guessed filenames', () => {
  assert.equal(soundPath(''), undefined);
  assert.equal(soundPath('BgmUI/Title'), 'Sound/BgmUI.img/Title');
  assert.equal(soundPath('Sound/Mob.img/0100100/Die'), 'Sound/Mob.img/0100100/Die');
});

test('original spatial attenuation has a 250px near field and a 40% floor', () => {
  assert.equal(spatialVolume(0, 0, { x: 0, y: 0 }), 1);
  assert.equal(spatialVolume(500, 0, { x: 0, y: 0 }), .79);
  assert.equal(spatialVolume(1001, 0, { x: 0, y: 0 }), .4);
  assert.equal(spatialVolume(0, 0, undefined), .4);
});
