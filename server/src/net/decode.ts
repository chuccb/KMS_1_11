/**
 * Trace decoding: turns a JSONL capture back into readable session packets.
 *
 * This is the other half of ADR-004 (the original client is the oracle). A raw capture is
 * useless without the cipher, so `kms111-rebuild decode` replays the checked greeting followed by
 * session frames:
 *
 *   1. the u16 prefix counts the bytes after itself; the payload holds version 0x00D3, a counted
 *      byte string, and two LCG seeds (MapleStory.exe.lst 0043A5DF-0043A774),
 *   2. every following packet is `u16 header + u16 bodyLength + encrypted body`,
 *   3. the header is checked against the direction magic and cipher state.
 *
 * Evidence for the post-greeting frame/cipher remains sub_4A1940 (assembler), sub_4A1B90
 * (decrypt), and sub_43AFA0 (receive state).
 */
import { CipherState, headerMagicOf, magicFor, type Direction } from "../protocol/cipher.ts";
import { HANDSHAKE_VERSION, decodeHandshake } from "../protocol/session.ts";
import { toHex } from "../protocol/frame.ts";
import { describeClientPacket } from "../protocol/login.ts";
import { describeClientFieldPacket, describeFieldPacket } from "../protocol/field.ts";

/** The subset of a capture record this module needs; `CaptureRecord` satisfies it. */
export interface TraceRecord {
  t?: number;
  conn?: number;
  dir: "c2s" | "s2c";
  kind: string;
  len: number;
  hex?: string;
  header?: number;
  bodyLength?: number;
  opcode?: number;
  plainHex?: string;
  headerOk?: boolean;
  /** cipher seeds as the harness adopted them from the handshake */
  seeds?: { sendSeed: number; recvSeed: number };
  note?: string;
}

export interface DecodedPacket {
  t: number;
  conn: number;
  dir: "c2s" | "s2c";
  /** wire length in bytes */
  len: number;
  /** u16 at wire offset 0: session header for frames, payload length for greetings. */
  header: number;
  /** u16 the cipher state predicts, or undefined when the direction is not keyed yet */
  expectedHeader?: number;
  headerOk: boolean;
  /** Session-frame body size; for a greeting, the counted-string byte length. */
  bodyLength: number;
  /** first decrypted body byte - the opcode the dispatcher (sub_43B170) switches on */
  opcode?: number;
  /** decrypted body bytes */
  bodyHex: string;
  /** raw (still encrypted) bytes, for evidence dumps */
  rawHex: string;
  /** decoded meaning when the opcode is mapped (client packets only) */
  decoded?: string;
  note?: string;
}

export interface DecodeOptions {
  /**
   * Cipher seed for client -> server packets (the state the *client sends* with, i.e. the
   * `sendSeed` a handshake assigned to the client). Only needed when the trace has no handshake.
   */
  c2sSeed?: number;
  /** Cipher seed for server -> client packets (the client's receive state). */
  s2cSeed?: number;
}

export interface DecodeResult {
  packets: DecodedPacket[];
  /** Parsed greeting fields and the seeds assigned from the client's point of view. */
  handshake?: {
    version: number;
    payloadLength: number;
    clientSendSeed: number;
    clientRecvSeed: number;
    bodyHex: string;
    trailingHex: string;
  };
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Replays the framing records of a trace through the session cipher.
 *
 * States are keyed by WIRE DIRECTION, never by "our side": a c2s packet is always encrypted with
 * the client's send state and an s2c packet with the client's receive state, whichever end
 * produced the trace. A handshake assigns `sendSeed` to its RECEIVER's send state and `recvSeed`
 * to that receiver's receive state, so which direction it seeds depends on who sent it - that is
 * exactly where a first version of this function got it backwards.
 *
 * Unframed records (`raw`, `framing-error`, `connect`) are skipped: a framing mismatch means the
 * trace is not (yet) a clean session, and the caller sees that as a missing packet rather than as
 * decoded garbage.
 */
export function decodeTrace(records: TraceRecord[], options: DecodeOptions = {}): DecodeResult {
  let c2sSeed = options.c2sSeed;
  let s2cSeed = options.s2cSeed;
  let c2sState = c2sSeed === undefined ? undefined : new CipherState(c2sSeed);
  let s2cState = s2cSeed === undefined ? undefined : new CipherState(s2cSeed);
  const packets: DecodedPacket[] = [];
  let handshake: DecodeResult["handshake"];

  for (const record of records) {
    if (!record.hex) continue;
    const raw = fromHex(record.hex);
    // Read the header off the bytes, not off the harness' decoded fields: the hex *is* the
    // evidence, and a recorded field could have come from a different framing assumption.
    const view = raw.length >= 4 ? new DataView(raw.buffer, raw.byteOffset, 4) : undefined;
    const base: DecodedPacket = {
      t: record.t ?? 0,
      conn: record.conn ?? 0,
      dir: record.dir,
      len: raw.length,
      header: view ? view.getUint16(0, true) : (record.header ?? 0),
      bodyLength: view ? view.getUint16(2, true) : Math.max(0, raw.length - 4),
      bodyHex: "",
      rawHex: record.hex,
      headerOk: true,
    };

    const prefixLength =
      raw.length >= 2 ? new DataView(raw.buffer, raw.byteOffset, 2).getUint16(0, true) : -1;
    const hasGreetingShape =
      raw.length >= 6 &&
      prefixLength + 2 === raw.length &&
      new DataView(raw.buffer, raw.byteOffset + 2, 2).getUint16(0, true) === HANDSHAKE_VERSION;
    const isHandshake =
      record.kind === "handshake" || (record.kind === "frame" && hasGreetingShape);
    if (isHandshake) {
      try {
        const parsed = decodeHandshake(raw);
        // The seeds are decoded from raw hex, not copied from optional trace metadata. For a
        // server -> client greeting they directly name the client's send/receive states; when
        // direction is reversed, those roles invert at the receiver.
        const clientSendSeed = record.dir === "s2c" ? parsed.sendSeed : parsed.recvSeed;
        const clientRecvSeed = record.dir === "s2c" ? parsed.recvSeed : parsed.sendSeed;
        handshake = {
          version: parsed.version,
          payloadLength: prefixLength,
          clientSendSeed,
          clientRecvSeed,
          bodyHex: toHex(parsed.body),
          trailingHex: toHex(parsed.trailing),
        };
        c2sSeed = clientSendSeed;
        s2cSeed = clientRecvSeed;
        c2sState = new CipherState(c2sSeed);
        s2cState = new CipherState(s2cSeed);
        const metadataMismatch =
          record.seeds !== undefined &&
          (record.seeds.sendSeed !== parsed.sendSeed || record.seeds.recvSeed !== parsed.recvSeed);
        packets.push({
          ...base,
          bodyLength: parsed.body.length,
          bodyHex: toHex(parsed.body),
          headerOk: true,
          note:
            `greeting version=0x${parsed.version.toString(16).padStart(4, "0")}; ` +
            `length prefix counts ${prefixLength} following payload bytes; ` +
            `seeds assigned to ${record.dir === "s2c" ? "client" : "server"}` +
            (parsed.trailing.length > 0
              ? `; ignored trailing=${parsed.trailing.length} bytes`
              : "") +
            (metadataMismatch
              ? "; trace seed metadata differs from raw greeting (raw bytes used)"
              : ""),
        });
      } catch (error) {
        packets.push({
          ...base,
          headerOk: false,
          note: `invalid greeting: ${(error as Error).message}`,
        });
      }
      continue;
    }
    if (record.kind !== "frame") continue; // connect / disconnect / server-info carry no payload

    const state = record.dir === "c2s" ? c2sState : s2cState;
    if (!state) {
      packets.push({ ...base, note: `no seed for ${record.dir}; pass --c2s-seed / --s2c-seed` });
      continue;
    }
    // The magic is direction-tied: the client writes 0xD3 and verifies 0xFF2C (cipher.ts).
    const expectedHeader = state.headerMagic(magicFor(record.dir));
    const plain = state.decrypt(raw.slice(4));
    // Server -> client packets are answered by the *stage* dispatcher, so they can only be named
    // when the opcode is in the field range (0x15-0x52). Login replies (0x01-0x06) belong to
    // CTitle/CWorldSelect/CCharSelect, which is exactly why `describeFieldPacket` returns undefined
    // for them instead of mislabelling them as a CField subsystem.
    const decoded =
      record.dir === "c2s"
        ? (describeClientPacket(plain) ?? describeClientFieldPacket(plain))
        : describeFieldPacket(plain);
    packets.push({
      ...base,
      expectedHeader,
      headerOk: base.header === expectedHeader,
      opcode: plain.length > 0 ? plain[0] : undefined,
      bodyHex: toHex(plain),
      ...(decoded ? { decoded } : {}),
    });
  }

  return handshake ? { packets, handshake } : { packets };
}

/** `magic ^ HIWORD(seed)` - handy when reading a hex dump by hand. */
export function headerForSeed(seed: number, direction: Direction = "s2c"): number {
  return headerMagicOf(seed, magicFor(direction));
}

export function formatDecoded(packets: DecodedPacket[]): string {
  const lines: string[] = [];
  for (const packet of packets) {
    const op =
      packet.opcode === undefined ? "" : ` op=0x${packet.opcode.toString(16).padStart(2, "0")}`;
    const check =
      packet.expectedHeader === undefined
        ? ""
        : packet.headerOk
          ? ""
          : `  !! header mismatch (wire 0x${packet.header.toString(16)}, expected 0x${packet.expectedHeader.toString(16)})`;
    lines.push(
      `conn=${packet.conn} ${packet.dir} len=${String(packet.len).padStart(5)} body=${String(packet.bodyLength).padStart(5)}${op}${check}`,
    );
    if (packet.decoded) lines.push(`    -> ${packet.decoded}`);
    if (packet.bodyHex)
      lines.push(`    ${packet.bodyHex.slice(0, 240)}${packet.bodyHex.length > 240 ? "..." : ""}`);
    if (packet.note) lines.push(`    // ${packet.note}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
