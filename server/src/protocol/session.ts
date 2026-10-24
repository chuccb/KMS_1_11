/**
 * Session framing for the KMS 1.11 reconstruction.
 *
 * VERIFIED SERVER-FIRST GREETING:
 *   sub_43A410 first receives exactly two bytes. It reads that little-endian u16 as the number
 *   of following payload bytes, resets its destination pointer to the buffer base, and receives
 *   that many bytes after the prefix. The payload begins with u16 version 0x00D3, then a u16
 *   counted-string length and those bytes, then client-send and client-receive u32 seeds.
 *   See MapleStory.exe.lst 0043A5DF-0043A674 and 0043A6C8-0043A774; the C decompilation is
 *   cross-checked against those pointer moves and recv lengths.
 *
 *   The client copies the counted string into a local ZXString and releases it without reading
 *   its content. A zero-length string is accepted by sub_418610, so encodeHandshake emits the
 *   minimal parser-valid greeting by default: 14 wire bytes, with payload length 12. This is the
 *   minimal form accepted by the checked client path, not a claim that the original server always
 *   chose an empty string or that every target build has been byte-for-byte captured.
 *
 * VERIFIED POST-HANDSHAKE FRAME:
 *   sub_4A1940 assembles the plaintext 4-byte header (`u16 magic`, `u16 bodyLength`) plus body;
 *   packet completion is `bodyLength + 4`. sub_4A1B90 decrypts only the body, and sub_43B170
 *   dispatches on its first byte.
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

/** Version value 0x00D3, read after the greeting's independent length prefix. */
export const HANDSHAKE_VERSION = CLIENT_VERSION;

/** The greeting prefix counts bytes after the two-byte prefix; the client buffer cap is 1460. */
export const MAX_HANDSHAKE_PAYLOAD_BYTES = 1460;
/** version u16 + string-length u16 + two seed u32 values; empty counted string. */
export const MIN_HANDSHAKE_PAYLOAD_BYTES = 12;
/** Prefix u16 + the minimum 12-byte payload. */
export const MIN_HANDSHAKE_WIRE_BYTES = 2 + MIN_HANDSHAKE_PAYLOAD_BYTES;
/** Minimal greeting is accepted by the client parser; the original server's string is not captured. */
export const DEFAULT_HANDSHAKE_BODY_BYTES = 0;

export interface Handshake {
  /** Client version read from payload offset 0; this client accepts exactly 0x00D3. */
  version: number;
  /** Counted bytes copied by the client into a temporary ZXString and then discarded. */
  body: Uint8Array;
  /** First u32 after the counted string; seeds CClientSocket+120, the client's send state. */
  sendSeed: number;
  /** Second u32 after the counted string; seeds CClientSocket+124, the client's receive state. */
  recvSeed: number;
  /** Bytes after the two seeds; retained by the parser because the client does not reject a tail. */
  trailing: Uint8Array;
}

/**
 * Encode the checked client's server-first greeting:
 *
 *   u16 payloadLength (bytes after this prefix)
 *   u16 version=0x00D3
 *   u16 bodyLength, body bytes
 *   u32 clientSendSeed, u32 clientRecvSeed
 *   optional trailing bytes (the checked parser consumes but does not inspect them)
 *
 * The default empty body yields a 14-byte minimal greeting. The `body` name is kept neutral: the
 * binary proves it is copied into a temporary string, but does not establish its server-side
 * semantic meaning or the exact value used by the original server.
 */
export function encodeHandshake(
  body: Uint8Array,
  clientSendSeed: number,
  clientRecvSeed: number,
  trailing: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const payloadLength = MIN_HANDSHAKE_PAYLOAD_BYTES + body.length + trailing.length;
  if (payloadLength > MAX_HANDSHAKE_PAYLOAD_BYTES) {
    throw new FramingError(
      `handshake payload of ${payloadLength} bytes exceeds the ${MAX_HANDSHAKE_PAYLOAD_BYTES}-byte client buffer`,
    );
  }

  const out = new Uint8Array(payloadLength + 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, payloadLength, true);
  view.setUint16(2, HANDSHAKE_VERSION, true);
  view.setUint16(4, body.length, true);
  out.set(body, 6);
  const sendSeedOffset = 6 + body.length;
  view.setUint32(sendSeedOffset, clientSendSeed >>> 0, true);
  view.setUint32(sendSeedOffset + 4, clientRecvSeed >>> 0, true);
  out.set(trailing, sendSeedOffset + 8);
  return out;
}

/**
 * Decode one complete server-first greeting using the byte accounting in sub_43A410.
 * The length prefix excludes its own two bytes and includes all bytes in the following payload.
 */
export function decodeHandshake(wire: Uint8Array): Handshake {
  if (wire.length < 2) {
    throw new FramingError(`handshake is missing its 2-byte length prefix (${wire.length} bytes)`);
  }
  const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
  const payloadLength = view.getUint16(0, true);
  if (payloadLength > MAX_HANDSHAKE_PAYLOAD_BYTES) {
    throw new FramingError(
      `handshake payload length ${payloadLength} exceeds the ${MAX_HANDSHAKE_PAYLOAD_BYTES}-byte client buffer`,
    );
  }
  const expectedWireLength = payloadLength + 2;
  if (wire.length !== expectedWireLength) {
    throw new FramingError(
      `handshake length prefix declares ${expectedWireLength} wire bytes, got ${wire.length}`,
    );
  }
  if (payloadLength < MIN_HANDSHAKE_PAYLOAD_BYTES) {
    throw new FramingError(
      `handshake payload must be at least ${MIN_HANDSHAKE_PAYLOAD_BYTES} bytes, got ${payloadLength}`,
    );
  }

  const version = view.getUint16(2, true);
  if (version !== HANDSHAKE_VERSION) {
    throw new FramingError(
      `handshake version is 0x${version.toString(16).padStart(4, "0")}, expected 0x${HANDSHAKE_VERSION.toString(16).padStart(4, "0")}`,
    );
  }
  const bodyLength = view.getUint16(4, true);
  const sendSeedOffset = 6 + bodyLength;
  const recvSeedOffset = sendSeedOffset + 4;
  const endOfSeeds = recvSeedOffset + 4;
  if (endOfSeeds > wire.length) {
    throw new FramingError(
      `handshake counted string (${bodyLength} bytes) leaves fewer than 8 bytes for the seeds`,
    );
  }

  return {
    version,
    body: wire.slice(6, sendSeedOffset),
    sendSeed: view.getUint32(sendSeedOffset, true),
    recvSeed: view.getUint32(recvSeedOffset, true),
    trailing: wire.slice(endOfSeeds),
  };
}

/** Largest encrypted body a single session packet may carry. */
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

/** What a session stream yields: one greeting, then packets. */
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
  /** Receive-side cipher state. Omit to parse a greeting before the first packet. */
  recvState?: CipherState;
  /** Parse a server-first greeting before the first packet. Defaults to true when no state is given. */
  expectHandshake?: boolean;
  /** Largest session packet, body + 4-byte header. */
  maxPacketBytes?: number;
  /**
   * Magic constant of the packets being decoded. Defaults to CLIENT_SEND_MAGIC because this
   * class is normally fed what a *client* sends; a client-side implementation decoding server
   * packets must pass SERVER_SEND_MAGIC.
   */
  expectedMagic?: number;
}

/**
 * Streaming session decoder: feed raw bytes, get the checked greeting and decrypted session bodies.
 *
 * Failure policy: a bad stream is recorded, never fatal. Completed packets are returned and the
 * reason the stream stopped is kept in `failure`, so an offline caller can preserve bytes already
 * understood before deciding how to handle the rest.
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

  /** True until the greeting has been consumed. */
  get awaitingHandshake(): boolean {
    return this.expectHandshake && this.recvState === undefined && this.failed === undefined;
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
      if (this.buf.length < 2) return events;
      const payloadLength = new DataView(this.buf.buffer, this.buf.byteOffset, 2).getUint16(
        0,
        true,
      );
      if (payloadLength < MIN_HANDSHAKE_PAYLOAD_BYTES) {
        this.failed = `handshake payload length ${payloadLength} is below the ${MIN_HANDSHAKE_PAYLOAD_BYTES}-byte minimum`;
        return events;
      }
      if (payloadLength > MAX_HANDSHAKE_PAYLOAD_BYTES) {
        this.failed =
          `handshake payload length ${payloadLength} exceeds the ` +
          `${MAX_HANDSHAKE_PAYLOAD_BYTES}-byte client buffer cap`;
        return events;
      }
      const total = payloadLength + 2;
      if (this.buf.length < total) return events;
      const raw = this.buf.slice(0, total);
      let handshake: Handshake;
      try {
        handshake = decodeHandshake(raw);
      } catch (error) {
        this.failed = `invalid handshake: ${(error as Error).message}`;
        return events;
      }
      this.recvState = new CipherState(handshake.recvSeed);
      this.buf = this.buf.slice(total);
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
      `greeting ${event.raw.length}B payload=${event.raw.length - 2}B version=0x${event.handshake.version.toString(16).padStart(4, "0")} ` +
      `sendSeed=0x${event.handshake.sendSeed.toString(16)} ` +
      `recvSeed=0x${event.handshake.recvSeed.toString(16)} body=${toHex(event.handshake.body)}` +
      (event.handshake.trailing.length > 0 ? ` trailing=${toHex(event.handshake.trailing)}` : "")
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
