/** Original Sound_DX8 bodies, without transcoding or replacement recordings.
 * Sound_DX8.dll serializes flag, compact payload size/duration, DirectShow media type,
 * a byte-sized WAVEFORMATEX, then the exact audio payload. PCM needs a RIFF wrapper;
 * format 0x55 is already MPEG layer III and is served byte-for-byte.
 */
import type { WzArchive } from "../wz/archive.ts";
import { artReaderOf } from "./wzart.ts";

export interface AudioAsset {
  data: Uint8Array;
  contentType: "audio/mpeg" | "audio/wav";
  durationMs: number;
  sampleRate: number;
  channels: number;
}
export type AudioProvider = (path: string) => AudioAsset | undefined;
const MEDIA = Buffer.from(
  "0283eb36e44f52ce119f530020af0ba7708beb36e44f52ce119f530020af0ba7700001819f580556c3ce11bf0100aa0055595a",
  "hex",
);

export function decodeSound(raw: Uint8Array): AudioAsset {
  const b = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  let at = 0;
  const compact = () => {
    if (at >= b.length) throw new Error("short sound header");
    const first = b.readInt8(at++);
    if (first !== -128) return first;
    if (at + 4 > b.length) throw new Error("short sound integer");
    const value = b.readInt32LE(at);
    at += 4;
    return value;
  };
  if (b[at++] !== 0) throw new Error("unsupported sound flag");
  const size = compact(),
    durationMs = compact();
  if (size <= 0 || durationMs < 0 || !b.subarray(at, at + MEDIA.length).equals(MEDIA))
    throw new Error("invalid sound media header");
  at += MEDIA.length;
  const formatSize = b[at++];
  if (formatSize < 18 || at + formatSize + size !== b.length)
    throw new Error("invalid sound body lengths");
  const format = b.subarray(at, at + formatSize);
  at += formatSize;
  const tag = format.readUInt16LE(0),
    channels = format.readUInt16LE(2),
    sampleRate = format.readUInt32LE(4);
  if (
    18 + format.readUInt16LE(16) !== formatSize ||
    channels < 1 ||
    channels > 2 ||
    sampleRate === 0
  )
    throw new Error("invalid WAVEFORMATEX");
  const payload = b.subarray(at);
  if (tag === 0x55)
    return { data: payload, contentType: "audio/mpeg", durationMs, sampleRate, channels };
  if (tag !== 1) throw new Error(`unsupported sound codec ${tag}`);
  const data = Buffer.alloc(12 + 8 + formatSize + 8 + size + (size & 1));
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(formatSize, 16);
  format.copy(data, 20);
  const chunk = 20 + formatSize;
  data.write("data", chunk);
  data.writeUInt32LE(size, chunk + 4);
  payload.copy(data, chunk + 8);
  return { data, contentType: "audio/wav", durationMs, sampleRate, channels };
}

/** Accept original sound paths, never arbitrary filesystem paths. Resolve real UOL aliases too. */
export function audioProviderOf(archive: WzArchive): AudioProvider {
  const reader = artReaderOf(archive);
  const cache = new Map<string, AudioAsset | undefined>();
  return (path) => {
    if (!/^Sound\/[A-Za-z0-9]+\.img\/[A-Za-z0-9_/-]+$/.test(path) || path.includes(".."))
      return undefined;
    if (cache.has(path)) return cache.get(path);
    let node = reader?.node(path);
    // Some item Use aliases target a sound-family property container, not its leaf.
    if (node?.kind === "props") node = reader?.node(`${path}/${path.split("/").at(-1)}`);
    let asset: AudioAsset | undefined;
    if (node?.kind === "raw" && node.value instanceof Uint8Array) asset = decodeSound(node.value);
    cache.set(path, asset);
    return asset;
  };
}
