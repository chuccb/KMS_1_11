/**
 * Capture harness (ADR-004).
 *
 * Purpose: let the ORIGINAL 2003 client connect to us and record exactly what it sends,
 * so protocol knowledge stops being guesswork. This is deliberately the first server-side
 * deliverable: it makes no assumptions beyond framing, and when framing does not match it
 * falls back to dumping raw bytes instead of dropping data.
 *
 * Modes:
 *   session : the real client model. A 211-byte handshake opens the session and carries the two
 *             cipher seeds; every later packet is "u16 header + u16 bodyLength + body" with the
 *             body encrypted, and the header is checked against the state prediction.
 *   framed  : the same 4-byte header without the handshake (use when the seeds are known and the
 *             first packet is not a handshake).
 *   raw     : record one line per recv() chunk.
 *
 * Output: JSONL, one record per line, appended to `out` when given, otherwise printed to
 * stdout through the provided logger.
 */
import { createServer, type Server, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { HeaderDeframer, U16LengthFramer, toHex } from "../protocol/frame.ts";
import { describeClientPacket } from "../protocol/login.ts";
import { CipherState, CLIENT_SEND_MAGIC } from "../protocol/cipher.ts";
import {
  HANDSHAKE_BODY_BYTES,
  SessionDeframer,
  encodeHandshake,
  type SessionDeframerOptions,
} from "../protocol/session.ts";

export type CaptureDirection = "c2s" | "s2c";
export type CaptureKind =
  | "connect"
  | "disconnect"
  | "frame"
  | "handshake"
  | "raw"
  | "framing-error"
  | "server-info";

export interface CaptureRecord {
  /** ms since the capture started */
  t: number;
  /** monotonic sequence number */
  seq: number;
  /** connection id, 1-based */
  conn: number;
  dir: CaptureDirection;
  kind: CaptureKind;
  /** wire length in bytes (0 for connect/disconnect) */
  len: number;
  /** lowercase hex of the bytes */
  hex: string;
  /** u16 at offset 0 of a framed packet (0xD3 ^ HIWORD(state) for session packets) */
  header?: number;
  /** u16 at offset 2 of a framed packet (# of body bytes that follow) */
  bodyLength?: number;
  /** first body byte - the opcode, once the body has been decrypted */
  opcode?: number;
  /** decrypted body, lowercase hex (session mode only) */
  plainHex?: string;
  /** decoded meaning of a decrypted client packet, when it is one we have mapped */
  decoded?: string;
  /** true when the wire header matched 0xD3 ^ HIWORD(cipher state) */
  headerOk?: boolean;
  /** cipher seeds adopted from the handshake, lowercase hex without 0x */
  seeds?: { sendSeed: number; recvSeed: number };
  note?: string;
}

export type CaptureMode = "session" | "framed" | "raw";

/**
 * How the harness opens a session.
 *
 * The client does not speak first: sub_43A410 receives the 211-byte handshake and reads its two
 * seeds, so a capture that wants to see anything from the original client has to send it.
 * `auto` picks seeds here (recorded in the trace, so the capture stays self-consistent);
 * `off` waits for a client-sent handshake instead; an object pins the seeds (and optionally the
 * still-unknown 199-byte body) for a reproducible experiment.
 */
export type HandshakePolicy =
  | "auto"
  | "off"
  | { clientSendSeed?: number; clientRecvSeed?: number; body?: Uint8Array };

export interface CaptureServerOptions {
  port: number;
  host?: string;
  mode?: CaptureMode;
  /** file path for the JSONL trace; when omitted, records go to onRecord only */
  out?: string;
  /** called for every record (use for tests / custom sinks) */
  onRecord?: (record: CaptureRecord) => void;
  /** log connect/disconnect noise (default true) */
  logLifecycle?: boolean;
  /** session mode only: send the 211-byte handshake the client waits for (default "auto") */
  handshake?: HandshakePolicy;
}

export interface CaptureStartInfo {
  port: number;
  host: string;
  mode: CaptureMode;
}

export class CaptureServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly startedAt = Date.now();
  private seq = 0;
  private nextConn = 1;
  private readonly options: Required<Omit<CaptureServerOptions, "out" | "onRecord" | "handshake">> &
    Pick<CaptureServerOptions, "out" | "onRecord"> & { handshake: HandshakePolicy };

  constructor(options: CaptureServerOptions) {
    this.options = {
      host: options.host ?? "0.0.0.0",
      port: options.port,
      mode: options.mode ?? "session",
      logLifecycle: options.logLifecycle ?? true,
      handshake: options.handshake ?? "auto",
      out: options.out,
      onRecord: options.onRecord,
    };
  }

  get recordCount(): number {
    return this.seq;
  }

  async start(): Promise<CaptureStartInfo> {
    const server = createServer((socket) => this.handleConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : this.options.port;
    this.emit({
      conn: 0,
      dir: "s2c",
      kind: "server-info",
      len: 0,
      hex: "",
      note: `listening on ${this.options.host}:${port} mode=${this.options.mode}`,
    });
    return { port, host: this.options.host, mode: this.options.mode };
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handleConnection(socket: Socket): void {
    const conn = this.nextConn++;
    this.sockets.add(socket);
    const peer = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`;
    if (this.options.logLifecycle) {
      this.emit({ conn, dir: "c2s", kind: "connect", len: 0, hex: "", note: peer });
    }

    // Once a chunk cannot be decoded we never un-see it: from then on the connection is a raw
    // byte stream. This is what keeps an HTTP probe or a half-written stream from corrupting
    // the trace (verified against the sandbox preview proxy).
    let mismatch = false;
    const sessionDeframer =
      this.options.mode === "session" ? new SessionDeframer(this.openSession(socket, conn)) : undefined;
    const headerDeframer = this.options.mode === "framed" ? new HeaderDeframer() : undefined;

    socket.on("data", (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk);
      if (this.options.mode === "raw" || mismatch) {
        this.emitRaw(conn, bytes, mismatch ? "framing disabled after mismatch" : undefined);
        return;
      }
      try {
        if (sessionDeframer) {
          for (const event of sessionDeframer.push(bytes)) {
            if (event.kind === "handshake") {
              this.emit({
                conn,
                dir: "c2s",
                kind: "handshake",
                len: event.raw.length,
                hex: toHex(event.raw),
                bodyLength: event.handshake.body.length,
                seeds: { sendSeed: event.handshake.sendSeed, recvSeed: event.handshake.recvSeed },
                note: `seeds adopted: sendSeed=0x${event.handshake.sendSeed.toString(16)} recvSeed=0x${event.handshake.recvSeed.toString(16)}`,
              });
              continue;
            }
            // `hex` stays the RAW wire bytes: it is the evidence, and `decode` re-checks the
            // framing against it. The decrypted body goes in `plainHex`.
            this.emit({
              conn,
              dir: "c2s",
              kind: "frame",
              len: event.body.length + 4,
              hex: toHex(wireBytes(event.header, event.body)),
              header: event.header,
              bodyLength: event.body.length,
              opcode: event.opcode,
              plainHex: toHex(event.plain),
              decoded: describeClientPacket(event.plain),
              headerOk: event.headerOk,
              note: event.headerOk ? undefined : `header mismatch: expected 0x${event.expectedHeader.toString(16)}`,
            });
          }
          const failure = sessionDeframer.failure;
          if (failure !== undefined) throw new Error(failure);
        } else if (headerDeframer) {
          for (const packet of headerDeframer.push(bytes)) {
            this.emit({
              conn,
              dir: "c2s",
              kind: "frame",
              len: packet.raw.length,
              hex: toHex(packet.raw),
              header: packet.header,
              bodyLength: packet.bodyLength,
            });
          }
        }
      } catch (error) {
        mismatch = true;
        const note = error instanceof Error ? error.message : String(error);
        this.emit({
          conn,
          dir: "c2s",
          kind: "framing-error",
          len: bytes.length,
          hex: toHex(bytes),
          note,
        });
        this.emitRaw(conn, bytes, "raw dump of the failing chunk");
      }
    });

    socket.on("error", (error) => {
      this.emit({ conn, dir: "c2s", kind: "framing-error", len: 0, hex: "", note: `socket: ${error.message}` });
    });

    socket.on("close", () => {
      this.sockets.delete(socket);
      if (this.options.logLifecycle) {
        this.emit({ conn, dir: "c2s", kind: "disconnect", len: 0, hex: "", note: peer });
      }
    });
  }

  /**
   * Picks the session opening, sending the handshake when we are the side that speaks first.
   * Returns the deframer options: our receive state mirrors the client's send seed.
   */
  private openSession(socket: Socket, conn: number): SessionDeframerOptions {
    const policy = this.options.handshake;
    const pinned = typeof policy === "object" ? policy : {};
    const clientSendSeed = pinned.clientSendSeed ?? randomSeed();
    const clientRecvSeed = pinned.clientRecvSeed ?? randomSeed();

    if (policy === "off") {
      // Wait for a client-sent handshake instead (useful when replaying a stream, not the client).
      return {};
    }

    const body = pinned.body ?? new Uint8Array(HANDSHAKE_BODY_BYTES);
    const bytes = encodeHandshake(body, clientSendSeed, clientRecvSeed);
    socket.write(Buffer.from(bytes));
    this.emit({
      conn,
      dir: "s2c",
      kind: "handshake",
      len: bytes.length,
      hex: toHex(bytes),
      bodyLength: body.length,
      seeds: { sendSeed: clientSendSeed, recvSeed: clientRecvSeed },
      note:
        `sent by us: clientSendSeed=0x${hex32(clientSendSeed)} clientRecvSeed=0x${hex32(clientRecvSeed)}` +
        (pinned.body ? "; body from the caller" : "; body is 199 zero bytes (contents still unknown)"),
    });
    return {
      expectHandshake: false, // already consumed on the way out
      recvState: new CipherState(clientSendSeed), // the client will send with this seed
      expectedMagic: CLIENT_SEND_MAGIC,
    };
  }

  private emitRaw(conn: number, bytes: Uint8Array, note?: string): void {
    this.emit({ conn, dir: "c2s", kind: "raw", len: bytes.length, hex: toHex(bytes), note });
  }

  private emit(partial: Omit<CaptureRecord, "t" | "seq">): void {
    const record: CaptureRecord = { t: Date.now() - this.startedAt, seq: this.seq++, ...partial };
    this.options.onRecord?.(record);
  }
}

function randomSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** Rebuild the raw wire bytes from a decoded frame: u16 header + u16 bodyLength + body. */
function wireBytes(header: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint16(0, header, true);
  view.setUint16(2, body.length, true);
  out.set(body, 4);
  return out;
}

/** Framer used by tools/tests that need to *produce* client-looking traffic. */
export function makeFramer(): U16LengthFramer {
  return new U16LengthFramer();
}

/** Serialize records the way the CLI writes them (one JSON object per line). */
export function toJsonl(records: Iterable<CaptureRecord>): string {
  let out = "";
  for (const record of records) out += JSON.stringify(record) + "\n";
  return out;
}
