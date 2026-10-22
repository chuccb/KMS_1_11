/**
 * Session framing for the 2003 KMS 1.11 protocol.
 *
 * EVIDENCE
 * --------
 * assembler  sub_4A1940  : accumulates 4 bytes, then reads
 *                            u16 at 0 -> packet+14   (header magic, unchecked there)
 *                            u16 at 2 -> packet+16   (body length)
 *                          and declares the packet complete when
 *                            filled >= bodyLength + 4      (total = bodyLength + 4)
 *            sub_4A1860  : copies the assembled bytes into a packet object
 * decrypt    sub_4A1B90  : body only -- it starts at data+4 and spans bodyLength
 *                          => the 4-byte header is PLAINTEXT, the body is encrypted
 * dispatcher sub_43B170  : opcode = body[0] (one byte), cursor starts right after the header
 *
 * handshake  sub_43A410  : the very first packet is read raw and its u16 at 0 must equal 211
 *                            u16 at 0 = the client version (ADR-139), *used as the byte count*
 *                            u16 at 2 = body length
 *                            body[bodyLength]
 *                            u32 sendSeed, u32 recvSeed
 *                          211 = 4 + bodyLength + 8  =>  bodyLength = 199
 *                          The body cannot be encrypted with the session cipher because the
 *                          cipher state arrives inside this same packet (state unverified).
 *
 * WHY THE VERSION IS ALSO THE LENGTH (ADR-139)
 * --------------------------------------------
 * `sub_43A410` reads the handshake in two steps (MapleStory.exe.c 66345-66370): it recv()s 2
 * bytes, takes that u16 as a *total*, and loops recv()ing until it has that many bytes
 * (`while (v17 - (char*)v15 != v16)`, and it refuses a value above the 1460 buffer
 * (`cmp ecx, eax; ja`)). Only then does it compare the very same u16 against 0xD3:
 *   < 211 -> CTerminateException -> "wrong VERSION of the client, reinstall" (see cipher.ts)
 *   > 211 -> CPatchException carrying (expected 211, got N)                  (see cipher.ts)
 * So one wire field does both jobs, and they cannot disagree: the packet must be 211 bytes long
 * *and* say 211. That is why the body is not a free payload - changing its length would change
 * the version the client demands. See `HANDSHAKE_VERSION` below.
 *
 * The 199-byte body is parsed but never used: `sub_418610(&v56, ...)` copies it into a local
 * byte array (MapleStory.exe.c 66393), and the only later reference to that local is the
 * refcount release at the end of the function (MapleStory.exe.lst 0043A884). The client reads
 * nothing from it, so a server may fill it with anything - this server sends zeros.
 */
import {
  CipherState,
  CLIENT_SEND_MAGIC,
  CLIENT_VERSION,
  SERVER_SEND_MAGIC,
  magicFor,
  type Direction,
} from "./cipher.ts";
import { FramingError, toHex } from "./frame.ts";

/**
 * The version the handshake's first u16 must carry (`cmp ax, 0D3h`, 0043A76E).
 *
 * The client reads exactly that many bytes, so the version *is* the packet length: the two are
 * the same number on the wire, and nothing else in the handshake can be resized without also
 * changing which client is allowed to connect. `HANDSHAKE_TOTAL_BYTES` below is therefore not an
 * independent constant - it is this one, spelled as a byte count.
 */
export const HANDSHAKE_VERSION = CLIENT_VERSION;

/** The opaque block the client copies and then ignores: `version - header - two seeds`. */
export const HANDSHAKE_BODY_BYTES = HANDSHAKE_VERSION - 4 - 8; // 199

/** Total wire bytes of the handshake: u16 version, u16 body length, body, u32 send, u32 recv. */
export const HANDSHAKE_TOTAL_BYTES = 4 + HANDSHAKE_BODY_BYTES + 8; // 211 === HANDSHAKE_VERSION

export interface SessionPacket {
  /** u16 at offset 0 (obfuscated magic for session packets) */
  header: number;
  /** wire bytes of the body (encrypted form) */
  body: Uint8Array;
  /** body after decryption (=== body for handshake packets) */
  plain: Uint8Array;
}

export interface Handshake {
  body: Uint8Array;
  sendSeed: number;
  recvSeed: number;
}

/**
 * Build the 211-byte handshake the client expects on connect.
 * `clientSendSeed` seeds the client's SEND state (CClientSocket+120) and
 * `clientRecvSeed` seeds its RECEIVE state (+124); a server should pick these and mirror
 * them (server recv = client send, server send = client recv).
 *
 * The first u16 carries `HANDSHAKE_VERSION`, which the client also reads as the byte count - so
 * the packet it produces is always exactly `HANDSHAKE_VERSION` bytes long.
 */
export function encodeHandshake(
  body: Uint8Array,
  clientSendSeed: number,
  clientRecvSeed: number,
): Uint8Array {
  if (body.length !== HANDSHAKE_BODY_BYTES) {
    throw new FramingError(
      `handshake body must be ${HANDSHAKE_BODY_BYTES} bytes, got ${body.length}`,
    );
  }
  const out = new Uint8Array(HANDSHAKE_TOTAL_BYTES);
  out[0] = HANDSHAKE_TOTAL_BYTES & 0xff;
  out[1] = (HANDSHAKE_TOTAL_BYTES >>> 8) & 0xff;
  out[2] = body.length & 0xff;
  out[3] = (body.length >>> 8) & 0xff;
  out.set(body, 4);
  const view = new DataView(out.buffer);
  // tail layout from sub_43A410: u32 at 4+bodyLength, then u32 at 8+bodyLength
  view.setUint32(4 + body.length, clientSendSeed >>> 0, true);
  view.setUint32(8 + body.length, clientRecvSeed >>> 0, true);
  return out;
}

export function decodeHandshake(wire: Uint8Array): Handshake {
  if (wire.length !== HANDSHAKE_TOTAL_BYTES) {
    throw new FramingError(`handshake must be ${HANDSHAKE_TOTAL_BYTES} bytes, got ${wire.length}`);
  }
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  const total = view.getUint16(0, true);
  if (total !== HANDSHAKE_TOTAL_BYTES) {
    throw new FramingError(`handshake total field is ${total}, expected ${HANDSHAKE_TOTAL_BYTES}`);
  }
  const bodyLength = view.getUint16(2, true);
  if (bodyLength !== HANDSHAKE_BODY_BYTES) {
    throw new FramingError(
      `handshake body length is ${bodyLength}, expected ${HANDSHAKE_BODY_BYTES}`,
    );
  }
  return {
    body: wire.slice(4, 4 + bodyLength),
    sendSeed: view.getUint32(4 + bodyLength, true),
    recvSeed: view.getUint32(8 + bodyLength, true),
  };
}

/** Largest body a single packet may carry; bigger payloads are split by the sender (sub_4A2030). */
export const MAX_BODY_BYTES = 1456;

/**
 * Encode one session packet: `u16 header` + `u16 bodyLength` + encrypted body.
 *
 * `direction` picks the header magic and defaults to `s2c` because the normal caller is a server
 * replying to a client. See cipher.ts: the two directions really do use different constants.
 */
export function encodeSessionPacket(
  plainBody: Uint8Array,
  sendState: CipherState,
  direction: Direction = "s2c",
): Uint8Array {
  if (plainBody.length > MAX_BODY_BYTES) {
    throw new FramingError(
      `body of ${plainBody.length} bytes exceeds the ${MAX_BODY_BYTES}-byte packet limit; split it first`,
    );
  }
  const total = plainBody.length + 4;
  const headerMagic = sendState.headerMagic(magicFor(direction)); // read the state before encrypt advances it
  const encrypted = sendState.encrypt(plainBody);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, headerMagic, true);
  view.setUint16(2, plainBody.length, true);
  out.set(encrypted, 4);
  return out;
}

/** What a session stream yields: one handshake, then packets. */
export type SessionEvent =
  | { kind: "handshake"; handshake: Handshake; raw: Uint8Array }
  | {
      kind: "packet";
      header: number;
      /** u16 the cipher state predicted for this packet; a mismatch means the stream is off. */
      expectedHeader: number;
      headerOk: boolean;
      body: Uint8Array;
      plain: Uint8Array;
      /** opcode = plain[0], the byte the dispatcher (sub_43B170) switches on */
      opcode?: number;
    };

export interface SessionDeframerOptions {
  /**
   * Receive-side cipher state. Omit when the session opens with a 211-byte handshake, which
   * carries the seeds (the normal case for a client connection).
   */
  recvState?: CipherState;
  /** Parse a 211-byte handshake before the first packet. Defaults to true without `recvState`. */
  expectHandshake?: boolean;
  /** Largest acceptable packet, body + 4-byte header. The client's receive buffer is 1460. */
  maxPacketBytes?: number;
  /**
   * Magic constant of the packets being decoded. Defaults to CLIENT_SEND_MAGIC because this
   * class is normally fed what a *client* sends; a client-side implementation decoding server
   * packets must pass SERVER_SEND_MAGIC.
   */
  expectedMagic?: number;
}

/**
 * Streaming session decoder: feed raw bytes, get the handshake and decrypted bodies.
 *
 * Failure policy: a bad stream is *recorded*, never fatal. Completed packets are returned and the
 * reason the stream stopped is kept in `failure`, so a caller that is sniffing an unknown peer can
 * fall back to dumping raw bytes without losing what it already understood.
 */
export class SessionDeframer {
  private buf = new Uint8Array(0);
  private recvState: CipherState | undefined;
  private readonly expectHandshake: boolean;
  private readonly maxPacketBytes: number;
  private readonly expectedMagic: number;
  private failed: string | undefined;

  constructor(options: SessionDeframerOptions = {}) {
    this.recvState = options.recvState;
    this.expectHandshake = options.expectHandshake ?? options.recvState === undefined;
    this.maxPacketBytes = options.maxPacketBytes ?? 1460;
    this.expectedMagic = options.expectedMagic ?? CLIENT_SEND_MAGIC;
  }

  /** Reason the stream stopped being decodable, if any. */
  get failure(): string | undefined {
    return this.failed;
  }

  get bufferedBytes(): number {
    return this.buf.length;
  }

  /** True until the handshake has been consumed. */
  get awaitingHandshake(): boolean {
    return this.expectHandshake && this.recvState === undefined;
  }

  push(chunk: Uint8Array): SessionEvent[] {
    if (this.failed !== undefined) return [];
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }

    const events: SessionEvent[] = [];
    if (this.expectHandshake && this.recvState === undefined) {
      if (this.buf.length < HANDSHAKE_TOTAL_BYTES) return events;
      const raw = this.buf.slice(0, HANDSHAKE_TOTAL_BYTES);
      const handshake = decodeHandshake(raw);
      this.recvState = new CipherState(handshake.recvSeed);
      this.buf = this.buf.slice(HANDSHAKE_TOTAL_BYTES);
      events.push({ kind: "handshake", handshake, raw });
    }

    const state = this.recvState;
    if (!state) {
      this.failed = "no cipher state: session did not start with a handshake";
      return events;
    }

    for (;;) {
      if (this.buf.length < 4) break;
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const header = view.getUint16(0, true);
      const bodyLength = view.getUint16(2, true);
      const total = bodyLength + 4;
      if (total > this.maxPacketBytes) {
        // Stop here instead of throwing: the packets already parsed above stay valid.
        this.failed = `body length ${bodyLength} exceeds the ${this.maxPacketBytes} cap`;
        break;
      }
      if (this.buf.length < total) break;
      const expectedHeader = state.headerMagic(this.expectedMagic);
      const body = this.buf.slice(4, total);
      const plain = state.decrypt(body);
      events.push({
        kind: "packet",
        header,
        expectedHeader,
        headerOk: header === expectedHeader,
        body,
        plain,
        ...(plain.length > 0 ? { opcode: plain[0]! } : {}),
      });
      this.buf = this.buf.slice(total);
    }
    return events;
  }
}

/** Human-readable rendering of a session packet: opcode = body[0]. */
export function describePacket(event: SessionEvent): string {
  if (event.kind === "handshake") {
    return (
      `handshake ${event.raw.length}B sendSeed=0x${event.handshake.sendSeed.toString(16)} ` +
      `recvSeed=0x${event.handshake.recvSeed.toString(16)} body=${toHex(event.handshake.body)}`
    );
  }
  const opcode =
    event.opcode === undefined ? "--" : "0x" + event.opcode.toString(16).padStart(2, "0");
  return (
    `header=0x${event.header.toString(16).padStart(4, "0")} opcode=${opcode} body=${toHex(event.plain)}` +
    (event.headerOk ? "" : ` !! expected header 0x${event.expectedHeader.toString(16)}`)
  );
}

export { CLIENT_SEND_MAGIC, SERVER_SEND_MAGIC, magicFor };
