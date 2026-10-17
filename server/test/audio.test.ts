import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WzArchive } from '../src/wz/archive.ts';
import { WzNode } from '../src/wz/img.ts';
import { audioProviderOf, decodeSound } from '../src/game/audio.ts';
import { artReaderOf } from '../src/game/wzart.ts';
const path = fileURLToPath(new URL('../../Data.wz', import.meta.url));
const archive = existsSync(path) ? WzArchive.open(path) : null;
const needs = { skip: !archive };

test('all original Sound images, including UOL sound aliases, resolve to native MP3/PCM', needs, () => {
  const provider = audioProviderOf(archive!);
  let count = 0;
  const walk = (node: WzNode, path: string) => {
    if (node.kind === 'raw' || node.kind === 'uol') {
      const sound = provider(path);
      assert.ok(sound, path);
      assert.ok(sound.data.length > 0, path);
      assert.ok(sound.durationMs > 0, path);
      assert.ok(sound.sampleRate >= 11025, path);
      count++;
    } else for (const e of node.props) if (e.value instanceof WzNode) walk(e.value, `${path}/${e.name}`);
  };
  for (const image of archive!.images.filter((i) => i.path.startsWith('Sound/'))) {
    for (const e of archive!.objects(image.path)[0]!.props) if (e.value instanceof WzNode) walk(e.value, `${image.path}/${e.name}`);
  }
  assert.equal(count, 150, "92 stored sounds + 58 UOL sound aliases");
  for (const image of archive!.images.filter((i) => i.path.startsWith('Map/Map/'))) {
    const info = archive!.objects(image.path)[0]!.props.find((p) => p.name === 'info')?.value;
    const bgm = info instanceof WzNode ? info.get('bgm') : undefined;
    if (typeof bgm !== 'string' || !bgm) continue;
    const [file, ...nodes] = bgm.split('/');
    assert.ok(provider(`Sound/${file}.img/${nodes.join('/')}`), `${image.path}: ${bgm}`);
  }
});
test('MP3 payloads are original bytes, without WZ headers, transcoding or padding', needs, () => {
  const reader = artReaderOf(archive!)!;
  const provider = audioProviderOf(archive!);
  for (const path of ['Sound/Game.img/Jump', 'Sound/UI.img/BtMouseClick', 'Sound/Bgm00.img/RestNPeace', 'Sound/BgmUI.img/Title']) {
    const raw = reader.node(path)!.value as Uint8Array;
    const asset = provider(path)!;
    assert.equal(asset.contentType, 'audio/mpeg');
    assert.deepEqual(asset.data, raw.subarray(raw.length - asset.data.length));
    assert.equal(asset.data[0], 0xff, 'original MPEG frame sync');
    assert.equal(provider(path), asset, 'process cache');
  }
});
test('PCM NxLogo gets a valid RIFF/WAVE wrapper with unchanged sample bytes', needs, () => {
  const asset = audioProviderOf(archive!)('Sound/BgmUI.img/NxLogo')!;
  const bytes = Buffer.from(asset.data);
  assert.equal(asset.contentType, 'audio/wav');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(asset.sampleRate, 44100);
  assert.equal(asset.channels, 2);
  assert.equal(bytes.readUInt16LE(20), 1);
});
test('malformed bodies and unsupported sound flags fail explicitly', () => {
  assert.throws(() => decodeSound(new Uint8Array()));
  assert.throws(() => decodeSound(new Uint8Array([1, 0, 0])));
  assert.throws(() => decodeSound(new Uint8Array([0, 0x80, 0])));
});
test('audio lookup cannot become a filesystem or arbitrary archive endpoint', needs, () => {
  const provider = audioProviderOf(archive!);
  for (const p of ['../Data.wz', 'Sound/Game.img/../../etc/passwd', 'Character/00002000.img/stand1/0/body', 'Sound/Unknown.img/no', 'Sound/Game.img/Unknown']) assert.equal(provider(p), undefined, p);
});
