/**
 * PNG writer, so a decoded canvas can leave the program as a file.
 *
 * This exists because "the codec works" has to be checkable by eye: `wz png` writes every canvas of
 * an image into a folder and any viewer (including the browser client) can open the result. A
 * hand-rolled writer with no dependencies is ~60 lines, which is cheaper to keep than a package
 * that does one thing; `zlib` and `zlib.crc32` are in Node's standard library.
 *
 * Only what the pipeline needs: 8-bit RGBA, no interlacing, filter type 0 on every scanline (the
 * filter that makes the encoder trivial and costs the most bytes - fine for asset export, where the
 * alternative is writing five inverse filters that could each be subtly wrong).
 */
import { crc32, deflateSync } from "node:zlib";

import type { RgbaImage } from "./img.ts";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "latin1");
  tag.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([tag, data])) >>> 0, 8 + data.length);
  return out;
}

/** Encode an RGBA surface as a PNG. */
export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter method
  header[12] = 0; // no interlace

  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let row = 0; row < image.height; row++) {
    const at = row * (stride + 1);
    raw[at] = 0; // filter: none
    Buffer.from(image.data.buffer, image.data.byteOffset + row * stride, stride).copy(raw, at + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
