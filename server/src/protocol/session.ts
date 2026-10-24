/**
 * Session framing for the KMS 1.11 reconstruction.
 *
 * VERIFIED POST-HANDSHAKE FRAME:
 *   sub_4A1940 assembles the plaintext 4-byte header (`u16 magic`, `u16 bodyLength`) plus body;
 *   packet completion is `bodyLength + 4`. sub_4A1B90 decrypts only the body, and sub_43B170
 *   dispatches on its first byte.
 *
 * TARGET GREETING CORRECTION (2026-10-24):
 *   The target s2c greeting begins with an independent 2-byte length, followed by
 *   `u16 version = 0x00D3`. Its wire size is in the teens; 211 is the version, not the byte count.
 *   Do not infer a 211-byte target greeting from ADR-139/165 or from the constant name below.
 *
 * ARCHIVED-EXE DISCREPANCY:
 *   The checked MapleStory.exe hash is `f67eb6901ddd509933f78959714d16bbf9b0cbaa7870977a442bbc5896261f58`.
 *   Its sub_43A410 listing uses the first u16 it reads both as a receive count and in the 0xD3
 *   comparison, and treats the next u16 as a copy length. That path does not show the target's
 *   leading length followed by version layout. The binary/stage/offset mismatch is unresolved;
 *   it does not override the target greeting correction.
 *
 * LEGACY IMPLEMENTATION WARNING:
 *   The constants and encoder below still implement the old 211-byte model (u16 211, u16 199,
 *   body, two seeds). They are not yet the target short-greeting implementation. The associated
 *   tests only pin the legacy encoder/decoder shape; they do not validate the official greeting.
 *   The 199-byte block and current seed offsets are likewise legacy assumptions.
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

/** Version value 0x00D3. It is not the target greeting's wire length. */
export const HANDSHAKE_VERSION = CLIENT_VERSION;

/** Opaque body size in the legacy encoder only; not established for the target greeting. */
export const LEGACY_HANDSHAKE_BODY_BYTES = HANDSHAKE_VERSION - 4 - 8; // legacy 199-byte model

/** Wire size emitted by the legacy encoder; the official target greeting is short. */
export const LEGACY_HANDSHAKE_TOTAL_BYTES = 4 + LEGACY_HANDSHAKE_BODY_BYTES + 8; // legacy 211-byte model

export interface SessionPacket {
  /** u16 at offset 0 (obfuscated magic for session packets) */
  header: number;
  /** wire bytes of the body (encrypted form) */
  body: Uint8Array;
  /** body after decryption (=== body for handshake packets) */
  plain: Uint8Array;
}

export interface LegacyHandshake {
  body: Uint8Array;
  sendSeed: number;
  recvSeed: number;
}

/**
 * Build the current legacy 211-byte handshake model; this is not the target short greeting.
 * `clientSendSeed` and `clientRecvSeed` are placed in the legacy body tail using the offsets
 * inferred from the checked EXE path. The target greeting's exact seed offsets remain unresolved.
 */
export function encodeLegacyHandshake(
  body: Uint8Array,
  clientSendSeed: number,
  clientRecvSeed: number,
): Uint8Array {
  if (body.length !== LEGACY_HANDSHAKE_BODY_BYTES) {
    throw new FramingError(
      `handshake body must be ${LEGACY_HANDSHAKE_BODY_BYTES} bytes, got ${body.length}`,
    );
  }
  const out = new Uint8Array(LEGACY_HANDSHAKE_TOTAL_BYTES);
  out[0] = LEGACY_HANDSHAKE_TOTAL_BYTES & 0xff;
  out[1] = (LEGACY_HANDSHAKE_TOTAL_BYTES >>> 8) & 0xff;
  out[2] = body.length & 0xff;
  out[3] = (body.length >>> 8) & 0xff;
  out.set(body, 4);
  const view = new DataView(out.buffer);
  // tail layout from sub_43A410: u32 at 4+bodyLength, then u32 at 8+bodyLength
  view.setUint32(4 + body.length, clientSendSeed >>> 0, true);
  view.setUint32(8 + body.length, clientRecvSeed >>> 0, true);
  return out;
}

export function decodeLegacyHandshake(wire: Uint8Array): LegacyHandshake {
  if (wire.length !== LEGACY_HANDSHAKE_TOTAL_BYTES) {
    throw new FramingError(
      `handshake must be ${LEGACY_HANDSHAKE_TOTAL_BYTES} bytes, got ${wire.length}`,
    );
  }
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  const total = view.getUint16(0, true);
  if (total !== LEGACY_HANDSHAKE_TOTAL_BYTES) {
    throw new FramingError(
      `handshake total field is ${total}, expected ${LEGACY_HANDSHAKE_TOTAL_BYTES}`,
    );
  }
  const bodyLength = view.getUint16(2, true);
  if (bodyLength !== LEGACY_HANDSHAKE_BODY_BYTES) {
    throw new FramingError(
      `handshake body length is ${bodyLength}, expected ${LEGACY_HANDSHAKE_BODY_BYTES}`,
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
  | { kind: "handshake"; handshake: LegacyHandshake; raw: Uint8Array }
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
  /** Receive-side cipher state. Omit to use the current legacy 211-byte opening model. */
  recvState?: CipherState;
  /** Parse the current legacy 211-byte model before the first packet; not the target short greeting. */
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
 * Streaming session decoder: feed raw bytes, get the legacy handshake model and decrypted bodies.
 *
 * The opening-handshake parser still expects the legacy 211-byte shape; it does not yet parse the
 * target short `[u16 length][u16 version=0x00D3]` greeting.
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
      if (this.buf.length < LEGACY_HANDSHAKE_TOTAL_BYTES) return events;
      const raw = this.buf.slice(0, LEGACY_HANDSHAKE_TOTAL_BYTES);
      const handshake = decodeLegacyHandshake(raw);
      this.recvState = new CipherState(handshake.recvSeed);
      this.buf = this.buf.slice(LEGACY_HANDSHAKE_TOTAL_BYTES);
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
