/**
 * Capture harness (ADR-004).
 *
 * Purpose: let the ORIGINAL 2003 client connect to us and record exactly what it sends,
 * so protocol knowledge stops being guesswork. This is deliberately the first server-side
 * deliverable: it makes no assumptions beyond framing, and when framing does not match it
 * falls back to dumping raw bytes instead of dropping data.
 *
 * Modes:
 *   framed : decode with U16LengthFramer, record one line per frame (+ opcode candidate)
 *   raw    : record one line per recv() chunk
 *
 * Output: JSONL, one record per line, appended to `out` when given, otherwise printed to
 * stdout through the provided logger.
 */
import { createServer, type Server, type Socket } from "node:net";
import { U16LengthFramer, U16LengthDeframer, FramingError, toHex } from "../protocol/frame.ts";

export type CaptureDirection = "c2s" | "s2c";
export type CaptureKind = "connect" | "disconnect" | "frame" | "raw" | "framing-error" | "server-info";

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
  /** first u16 of the payload, if any - a *candidate* opcode, not confirmed */
  opcodeCandidate?: number;
  note?: string;
}

export interface CaptureServerOptions {
  port: number;
  host?: string;
  mode?: "framed" | "raw";
  /** file path for the JSONL trace; when omitted, records go to onRecord only */
  out?: string;
  /** called for every record (use for tests / custom sinks) */
  onRecord?: (record: CaptureRecord) => void;
  /** log connect/disconnect noise (default true) */
  logLifecycle?: boolean;
}

export interface CaptureStartInfo {
  port: number;
  host: string;
  mode: "framed" | "raw";
}

export class CaptureServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly startedAt = Date.now();
  private seq = 0;
  private nextConn = 1;
  private readonly options: Required<Omit<CaptureServerOptions, "out" | "onRecord">> &
    Pick<CaptureServerOptions, "out" | "onRecord">;

  constructor(options: CaptureServerOptions) {
    this.options = {
      host: options.host ?? "0.0.0.0",
      port: options.port,
      mode: options.mode ?? "framed",
      logLifecycle: options.logLifecycle ?? true,
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

    const framer = new U16LengthDeframer();
    // In framed mode, remember the bytes of a frame we failed to decode so that a framing
    // mismatch loses nothing: we still emit them as raw.
    let mismatch = false;

    socket.on("data", (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk);
      if (this.options.mode === "raw" || mismatch) {
        this.emitRaw(conn, bytes, mismatch ? "framing disabled after mismatch" : undefined);
        return;
      }
      try {
        for (const frame of framer.push(bytes)) {
          const reader = frame.payload.length >= 2;
          const opcodeCandidate = reader ? frame.payload[0] | (frame.payload[1] << 8) : undefined;
          this.emit({
            conn,
            dir: "c2s",
            kind: "frame",
            len: frame.wireLength,
            hex: toHex(frame.raw),
            opcodeCandidate,
          });
        }
      } catch (error) {
        mismatch = true;
        const note = error instanceof FramingError ? error.message : String(error);
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

  private emitRaw(conn: number, bytes: Uint8Array, note?: string): void {
    this.emit({ conn, dir: "c2s", kind: "raw", len: bytes.length, hex: toHex(bytes), note });
  }

  private emit(partial: Omit<CaptureRecord, "t" | "seq">): void {
    const record: CaptureRecord = { t: Date.now() - this.startedAt, seq: this.seq++, ...partial };
    this.options.onRecord?.(record);
  }
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
