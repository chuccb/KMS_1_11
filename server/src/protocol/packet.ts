/**
 * Field codec for session packet bodies.
 *
 * EVIDENCE (MapleStory.exe.c / .lst, see docs/protocol/FINDINGS.md 4.4)
 * --------------------------------------------------------------------
 * write byte    sub_4A1EA0(&buf, byte, 0)   starts a packet; its first byte is the opcode
 * write n bytes sub_431DE0(&buf, n)         reserves n bytes, the caller fills them in
 * write string  sub_430230 -> sub_4303C0    `u16 length` then the raw bytes, no NUL, no escape
 * read byte     sub_45DC40(&dst, p, avail)  copies 1 byte, returns 1, throws ZException(38) when
 *                                           the packet is exhausted
 * read n bytes  handlers read *(u32*)(p+cursor) directly, after their own bounds check
 *
 * The client never pads or aligns: every field sits right after the previous one, little-endian.
 * A body that runs out of bytes is a hard error on the client (it throws), so it is a hard error
 * here as well - a parser that returns undefined would hide exactly the bug we want to find.
 */

/** Thrown when a packet ends in the middle of a field. The client throws ZException(38). */
export class PacketUnderflowError extends Error {
  readonly code = 38;
  constructor(need: number, have: number) {
    super(`packet underflow: needed ${need} more byte(s), ${have} left (client throws ZException 38)`);
    this.name = "PacketUnderflowError";
  }
}

/** Maximum length a `u16` length prefix can express. */
export const MAX_STRING_BYTES = 0xffff;

/** Builds a packet body. Field order is the whole contract; keep encoders next to their opcode. */
export class PacketWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(capacity = 64) {
    this.buf = new Uint8Array(Math.max(8, capacity));
  }

  get length(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buf.subarray(0, this.len), 0);
    this.buf = grown;
  }

  writeByte(value: number): this {
    this.ensure(1);
    this.buf[this.len++] = value & 0xff;
    return this;
  }

  writeU16(value: number): this {
    this.ensure(2);
    this.buf[this.len++] = value & 0xff;
    this.buf[this.len++] = (value >>> 8) & 0xff;
    return this;
  }

  writeU32(value: number): this {
    this.ensure(4);
    this.buf[this.len++] = value & 0xff;
    this.buf[this.len++] = (value >>> 8) & 0xff;
    this.buf[this.len++] = (value >>> 16) & 0xff;
    this.buf[this.len++] = (value >>> 24) & 0xff;
    return this;
  }

  writeBytes(bytes: Uint8Array): this {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
    return this;
  }

  /** `u16 length` + raw bytes. This is the only string encoding proven on the wire (sub_4303C0). */
  writeStringBytes(bytes: Uint8Array): this {
    if (bytes.length > MAX_STRING_BYTES) {
      throw new RangeError(`string of ${bytes.length} bytes cannot fit a u16 length prefix`);
    }
    return this.writeU16(bytes.length).writeBytes(bytes);
  }

  /**
   * Convenience for the byte-string case, which is what the login packet uses (sub_4D0B20 builds
   * its two strings as ANSI/byte strings). Beyond ASCII, latin1 cannot represent every character,
   * so this throws instead of silently mangling: UTF-16 bodies are not proven yet.
   */
  writeAsciiString(text: string): this {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 0xff) throw new RangeError(`character U+${code.toString(16)} is not a byte string char`);
      bytes[i] = code;
    }
    return this.writeStringBytes(bytes);
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Reads a packet body left to right. Every read is bounds-checked, like sub_45DC40. */
export class PacketReader {
  private readonly buf: Uint8Array;
  private pos = 0;

  constructor(bytes: Uint8Array, offset = 0) {
    this.buf = bytes;
    this.pos = offset;
  }

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.remaining < n) throw new PacketUnderflowError(n, this.remaining);
  }

  readByte(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  readU16(): number {
    this.need(2);
    const value = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return value;
  }

  readU32(): number {
    this.need(4);
    const value =
      (this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8) | (this.buf[this.pos + 2]! << 16)) +
      this.buf[this.pos + 3]! * 0x1000000;
    this.pos += 4;
    return value >>> 0;
  }

  readBytes(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** `u16 length` + that many bytes: `length` counts BYTES, not characters (sub_4303C0). */
  readStringBytes(): Uint8Array {
    return this.readBytes(this.readU16());
  }

  readAsciiString(): string {
    const bytes = this.readStringBytes();
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
  }

  /** True when the body is fully consumed - the cheap "did the parse make sense" assertion. */
  get exhausted(): boolean {
    return this.pos === this.buf.length;
  }
}

/**
 * One opcode: the body's first byte. The dispatcher (sub_43B170) consumes exactly this byte before
 * handing the rest of the packet to a handler.
 */
export function readOpcode(body: Uint8Array): number {
  if (body.length === 0) throw new PacketUnderflowError(1, 0);
  return body[0]!;
}
