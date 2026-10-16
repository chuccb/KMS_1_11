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
import { CipherState, headerMagicOf } from "../protocol/cipher.ts";
import { HANDSHAKE_BODY_BYTES, HANDSHAKE_TOTAL_BYTES, decodeHandshake } from "../protocol/session.ts";
import { toHex } from "../protocol/frame.ts";

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
  note?: string;
}

export interface DecodeOptions {
  /** receive-side LCG seed (client -> server), low byte is the key */
  recvSeed?: number;
  /** send-side LCG seed (server -> client) */
  sendSeed?: number;
}

export interface DecodeResult {
  packets: DecodedPacket[];
  /** seed adopted from a handshake found in the trace, if any */
  handshake?: { sendSeed: number; recvSeed: number; bodyHex: string };
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hiWord(value: number): number {
  return (value >>> 16) & 0xffff;
}

/**
 * Replays the framing records of a trace through the session cipher.
 *
 * Unframed records (`raw`, `framing-error`, `connect`) are skipped: a framing mismatch means the
 * trace is not (yet) a clean session, and the caller sees that as a missing packet rather than as
 * decoded garbage.
 */
export function decodeTrace(records: TraceRecord[], options: DecodeOptions = {}): DecodeResult {
  let recvSeed = options.recvSeed;
  let sendSeed = options.sendSeed;
  let recvState = recvSeed === undefined ? undefined : new CipherState(recvSeed);
  let sendState = sendSeed === undefined ? undefined : new CipherState(sendSeed);
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
    const isHandshake = record.kind === "handshake" || raw.length === HANDSHAKE_TOTAL_BYTES;
    if (isHandshake && raw.length === HANDSHAKE_TOTAL_BYTES) {
      const parsed = decodeHandshake(raw);
      const seeds = record.seeds ?? { sendSeed: parsed.sendSeed, recvSeed: parsed.recvSeed };
      handshake = { sendSeed: seeds.sendSeed, recvSeed: seeds.recvSeed, bodyHex: toHex(parsed.body) };
      recvState = new CipherState(seeds.recvSeed);
      sendState = new CipherState(seeds.sendSeed);
      packets.push({
        ...base,
        bodyLength: HANDSHAKE_BODY_BYTES,
        bodyHex: toHex(parsed.body),
        expectedHeader: HANDSHAKE_TOTAL_BYTES,
        headerOk: base.header === HANDSHAKE_TOTAL_BYTES,
        note: "handshake: 211 bytes, seeds adopted (sendSeed/recvSeed)",
      });
      continue;
    }
    if (record.kind !== "frame") continue; // connect / disconnect / server-info carry no payload

    const state = record.dir === "c2s" ? recvState : sendState;
    if (!state) {
      packets.push({ ...base, note: `no seed for ${record.dir}; pass --recv-seed / --send-seed` });
      continue;
    }
    const expectedHeader = state.headerMagic();
    const plain = state.decrypt(raw.slice(4));
    packets.push({
      ...base,
      expectedHeader,
      headerOk: base.header === expectedHeader,
      opcode: plain.length > 0 ? plain[0] : undefined,
      bodyHex: toHex(plain),
    });
  }

  return handshake ? { packets, handshake } : { packets };
}

/** `0xD3 ^ HIWORD(state)` for a raw seed - handy when reading a hex dump by hand. */
export function headerForSeed(seed: number): number {
  return headerMagicOf(seed);
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
    if (packet.bodyHex) lines.push(`    ${packet.bodyHex.slice(0, 240)}${packet.bodyHex.length > 240 ? "..." : ""}`);
    if (packet.note) lines.push(`    // ${packet.note}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
