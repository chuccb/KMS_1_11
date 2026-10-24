/**
 * U16 framing helpers for captured streams.
 *
 * Generic framed capture helper. `U16LengthFramer` below is deliberately separate from the
 * session greeting parser in `session.ts`: its default convention counts the prefix itself, while
 * the greeting's prefix counts the payload bytes after it. Do not use this helper to parse the
 * greeting. The subsequent encrypted session framing uses `HeaderDeframer` below.
 */
export const MAX_FRAME_BYTES = 1460; // receive buffer size used by the client

export interface U16LengthFramerOptions {
  /** Whether this generic frame's declared length includes its 2-byte prefix (default: true). */
  lengthIncludesHeader?: boolean;
  /** frames larger than this are rejected (evidence: 1460 receive buffer) */
  maxFrameBytes?: number;
}

export interface Frame {
  /** number of bytes the frame occupies on the wire, header included */
  wireLength: number;
  /** payload bytes (everything after the 2-byte length field) */
  payload: Uint8Array;
  /** the raw wire bytes of this frame */
  raw: Uint8Array;
}

export class FramingError extends Error {}

export class U16LengthFramer {
  private readonly lengthIncludesHeader: boolean;
  readonly maxFrameBytes: number;

  constructor(options: U16LengthFramerOptions = {}) {
    this.lengthIncludesHeader = options.lengthIncludesHeader ?? true;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  }

  encode(payload: Uint8Array): Uint8Array {
    const total = payload.length + 2;
    if (total > this.maxFrameBytes) {
      throw new FramingError(
        `frame of ${total} bytes exceeds the client receive buffer (${this.maxFrameBytes})`,
      );
    }
    if (total > 0xffff) throw new FramingError("frame too large for u16 length prefix");
    // Keep this generic encoder aligned with the matching deframer's configured convention.
    const declared = this.lengthIncludesHeader ? total : payload.length;
    const out = new Uint8Array(total);
    out[0] = declared & 0xff;
    out[1] = (declared >>> 8) & 0xff;
    out.set(payload, 2);
    return out;
  }
}

/**
 * Streaming decoder. Feed it whatever `recv()` returned; it yields complete frames and
 * keeps the remainder buffered.
 */
export class U16LengthDeframer {
  private readonly lengthIncludesHeader: boolean;
  readonly maxFrameBytes: number;
  private buf: Uint8Array = new Uint8Array(0);

  constructor(options: U16LengthFramerOptions = {}) {
    this.lengthIncludesHeader = options.lengthIncludesHeader ?? true;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  }

  get bufferedBytes(): number {
    return this.buf.length;
  }

  push(chunk: Uint8Array): Frame[] {
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    const frames: Frame[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const declared = this.buf[0] | (this.buf[1] << 8);
      const wireLength = this.lengthIncludesHeader ? declared : declared + 2;
      if (wireLength < 2 || wireLength > this.maxFrameBytes) {
        throw new FramingError(
          `declared length ${declared} is outside 2..${this.maxFrameBytes} (byte offset 0)`,
        );
      }
      if (this.buf.length < wireLength) break;
      const raw = this.buf.slice(0, wireLength);
      frames.push({ wireLength, payload: raw.slice(2), raw });
      this.buf = this.buf.slice(wireLength);
    }
    return frames;
  }
}

/**
 * Little-endian packet reader.
 *
 * Only the integer primitives are implemented: field ORDER and meanings are still
 * unknown (see docs/protocol/FINDINGS.md). Adding string/vector helpers before a live
 * capture would be guessing.
 */
export class PacketReader {
  private readonly data: Uint8Array;
  private pos = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  u8(): number {
    this.need(1);
    return this.data[this.pos++];
  }

  u16(): number {
    this.need(2);
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }

  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  u32(): number {
    this.need(4);
    const d = this.data;
    const p = this.pos;
    const v = (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16)) + d[p + 3] * 0x1000000;
    this.pos += 4;
    return v >>> 0;
  }

  i32(): number {
    return this.u32() | 0;
  }

  private need(n: number): void {
    if (this.remaining < n) throw new FramingError(`need ${n} bytes, have ${this.remaining}`);
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new FramingError("hex string has an odd length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * General session framing: `u16 header` + `u16 bodyLength` + body, total = bodyLength + 4.
 *
 * EVIDENCE: sub_4A1940 assembles 4 bytes, stores u16@0 and u16@2, and completes the packet
 * once `filled >= (u16@2) + 4`. sub_4A1B90 decrypts starting at data+4 for (u16@2) bytes, so
 * the 4-byte header is plaintext. This is the established post-handshake packet framing and
 * is separate from the target short greeting; the u16-total helper above is only a legacy
 * capture utility.
 */
export interface RawPacket {
  /** u16 at offset 0 (plaintext; obfuscated magic for session packets) */
  header: number;
  /** u16 at offset 2 - length of the body that follows */
  bodyLength: number;
  body: Uint8Array;
  raw: Uint8Array;
}

export class HeaderDeframer {
  private readonly maxPacketBytes: number;
  private buf: Uint8Array = new Uint8Array(0);

  constructor(maxPacketBytes = MAX_FRAME_BYTES) {
    this.maxPacketBytes = maxPacketBytes;
  }

  get bufferedBytes(): number {
    return this.buf.length;
  }

  push(chunk: Uint8Array): RawPacket[] {
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    const packets: RawPacket[] = [];
    for (;;) {
      if (this.buf.length < 4) break;
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const header = view.getUint16(0, true);
      const bodyLength = view.getUint16(2, true);
      const total = bodyLength + 4;
      if (total > this.maxPacketBytes) {
        throw new FramingError(`body length ${bodyLength} exceeds the ${this.maxPacketBytes} cap`);
      }
      if (this.buf.length < total) break;
      const raw = this.buf.slice(0, total);
      packets.push({ header, bodyLength, body: raw.slice(4), raw });
      this.buf = this.buf.slice(total);
    }
    return packets;
  }
}
