/**
 * Trace decoding: turns a JSONL capture back into readable session packets.
 *
 * This is the other half of ADR-004 (the original client is the oracle). A raw capture is
 * useless without the cipher, so `kms111-rebuild decode` replays a trace through the same
 * model the client uses:
 *
 *   1. a 211-byte handshake opens the session and carries the two LCG seeds,
 *   2. every following packet is `u16 header + u16 bodyLength + body`, body encrypted,
 *   3. the header is `0xD3 ^ HIWORD(state)` and doubles as a self-check: if our state ever
 *      drifts, the header stops matching and we say so instead of printing garbage.
 *
 * Evidence: sub_43A410 (handshake + first framing), sub_4A1940 (assembler),
 * sub_4A1B90 (decrypt), sub_43AFA0 (packet loop that reads the +124 receive state).
 */
import { CipherState, headerMagicOf, magicFor, type Direction } from "../protocol/cipher.ts";
import { HANDSHAKE_BODY_BYTES, HANDSHAKE_TOTAL_BYTES, decodeHandshake } from "../protocol/session.ts";
import { toHex } from "../protocol/frame.ts";
import { describeClientPacket } from "../protocol/login.ts";
import { describeFieldPacket } from "../protocol/field.ts";

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
  /** u16 read off the wire */
  header: number;
  /** u16 the cipher state predicts, or undefined when the direction is not keyed yet */
  expectedHeader?: number;
  headerOk: boolean;
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
  /** the seeds a handshake in the trace assigned, from the client's point of view */
  handshake?: { clientSendSeed: number; clientRecvSeed: number; bodyHex: string };
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

    // The opening packet is plaintext and defines the keys for everything after it. The harness
    // marks it `handshake`; a raw 211-byte `frame` is treated the same way.
    const isHandshake = raw.length === HANDSHAKE_TOTAL_BYTES && (record.kind === "handshake" || record.kind === "frame");
    if (isHandshake) {
      const parsed = decodeHandshake(raw);
      const sendSeed = record.seeds?.sendSeed ?? parsed.sendSeed;
      const recvSeed = record.seeds?.recvSeed ?? parsed.recvSeed;
      // `sendSeed` seeds the receiver's send state; the receiver is the other end.
      const clientSendSeed = record.dir === "s2c" ? sendSeed : recvSeed;
      const clientRecvSeed = record.dir === "s2c" ? recvSeed : sendSeed;
      handshake = { clientSendSeed, clientRecvSeed, bodyHex: toHex(parsed.body) };
      c2sSeed = clientSendSeed;
      s2cSeed = clientRecvSeed;
      c2sState = new CipherState(c2sSeed);
      s2cState = new CipherState(s2cSeed);
      packets.push({
        ...base,
        bodyLength: HANDSHAKE_BODY_BYTES,
        bodyHex: toHex(parsed.body),
        expectedHeader: HANDSHAKE_TOTAL_BYTES,
        headerOk: base.header === HANDSHAKE_TOTAL_BYTES,
        note: `handshake sent by ${record.dir}: receiver (${record.dir === "s2c" ? "client" : "server"}) seeded`,
      });
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
    const decoded = record.dir === "c2s" ? describeClientPacket(plain) : describeFieldPacket(plain);
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
    const op = packet.opcode === undefined ? "" : ` op=0x${packet.opcode.toString(16).padStart(2, "0")}`;
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
    if (packet.bodyHex) lines.push(`    ${packet.bodyHex.slice(0, 240)}${packet.bodyHex.length > 240 ? "..." : ""}`);
    if (packet.note) lines.push(`    // ${packet.note}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
