/**
 * Just enough RFC 6455 to let a browser talk to this server.
 *
 * The 2003 client speaks raw TCP, and a browser cannot. The smallest honest bridge is a WebSocket:
 * it is the only socket-shaped API every browser has, and it is a *framing* standard, not a
 * protocol - which is exactly the layer the browser is missing. Everything above it (the 2003
 * packets) stays the server's business, so this module deliberately does not touch them.
 *
 * SCOPE
 * -----
 * Implemented: the opening handshake's `Sec-WebSocket-Accept` computation, text and binary messages,
 * fragmentation, ping/pong, the closing handshake, and a cap on how large one message may be.
 * Not implemented, because nothing here needs it: extensions (`permessage-deflate` is never
 * negotiated), subprotocols, and the client side of the handshake. A server MUST NOT mask the frames
 * it sends and a client MUST mask the ones it sends; both rules are enforced rather than assumed.
 *
 * WHY NOT A LIBRARY: this repository is `"Zero runtime dependencies"` on purpose (package.json,
 * ADR-005's asset pipeline has the same rule). A WebSocket server is a few hundred lines of framing
 * with a very well-known test vector (RFC 6455 section 1.3's `dGhlIHNhbXBsZSBub25jZQ==` ->
 * `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`), which `test/websocket.test.ts` uses.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

/** The GUID every server appends to `Sec-WebSocket-Key` (RFC 6455 1.3). */
export const WS_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Opcodes this module knows. 3-7 and 11-15 are reserved and rejected. */
export const WS_OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

/** One browser message may not exceed this; the 2003 protocol's own frames are under 1.5 KB. */
export const WS_MAX_MESSAGE_BYTES = 1 << 20;

export class WebSocketError extends Error {}

/** True when the request asks to become a WebSocket (`Connection: Upgrade` + `Upgrade: websocket`). */
export function isWebSocketUpgrade(request: IncomingMessage): boolean {
  const upgrade = request.headers.upgrade;
  const connection = request.headers.connection ?? "";
  if (typeof upgrade !== "string" || upgrade.toLowerCase() !== "websocket") return false;
  return connection.split(",").some((part) => part.trim().toLowerCase() === "upgrade");
}

/** `Sec-WebSocket-Accept` for the client's key (RFC 6455 1.3, the one value a browser checks). */
export function acceptKey(key: string): string {
  return createHash("sha1")
    .update(key + WS_ACCEPT_GUID)
    .digest("base64");
}

/** The 101 response, or the reason this request cannot be upgraded. */
export function upgradeResponse(
  request: IncomingMessage,
): { ok: true; headers: string[] } | { ok: false; status: number; reason: string } {
  if (!isWebSocketUpgrade(request))
    return { ok: false, status: 400, reason: "not a websocket upgrade" };
  if (request.method !== "GET")
    return { ok: false, status: 405, reason: "the handshake must be a GET" };
  const version = request.headers["sec-websocket-version"];
  if (version !== "13")
    return { ok: false, status: 426, reason: `unsupported websocket version ${String(version)}` };
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string" || key.length === 0)
    return { ok: false, status: 400, reason: "no Sec-WebSocket-Key" };
  return {
    ok: true,
    headers: [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    ],
  };
}

/** A parsed frame. `payload` is already unmasked. */
export interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}

/**
 * Incremental frame parser. Bytes arrive in whatever chunks the kernel hands over, so the parser
 * keeps the remainder between calls; a frame is returned only when all of it is present.
 */
export class WsParser {
  private buffer: Uint8Array = new Uint8Array(0);
  readonly requireMask: boolean;
  readonly maxPayloadBytes: number;

  constructor(options: { requireMask?: boolean; maxPayloadBytes?: number } = {}) {
    this.requireMask = options.requireMask ?? true;
    this.maxPayloadBytes = options.maxPayloadBytes ?? WS_MAX_MESSAGE_BYTES;
  }

  push(chunk: Uint8Array): WsFrame[] {
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
    }
    const frames: WsFrame[] = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      const first = this.buffer[0]!;
      const second = this.buffer[1]!;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) break;
        length = (this.buffer[2]! << 8) | this.buffer[3]!;
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) break;
        const high =
          (this.buffer[2]! << 24) |
          (this.buffer[3]! << 16) |
          (this.buffer[4]! << 8) |
          this.buffer[5]!;
        const low =
          ((this.buffer[6]! << 24) |
            (this.buffer[7]! << 16) |
            (this.buffer[8]! << 8) |
            this.buffer[9]!) >>>
          0;
        if (high !== 0) throw new WebSocketError("frame payload above 4 GiB");
        length = low;
        offset = 10;
      }
      if ((first & 0x70) !== 0)
        throw new WebSocketError("reserved bits are set but no extension was negotiated");
      if (this.requireMask && !masked)
        throw new WebSocketError("a client frame must be masked (RFC 6455 5.1)");
      if (length > this.maxPayloadBytes) {
        throw new WebSocketError(`frame of ${length} bytes exceeds ${this.maxPayloadBytes}`);
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) break;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
      const start = offset + maskBytes;
      const payload = this.buffer.slice(start, start + length);
      if (mask !== undefined) {
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i & 3]!;
      }
      this.buffer = this.buffer.slice(start + length);
      frames.push({ fin, opcode, payload });
    }
    return frames;
  }
}

/** Encodes one server frame (never masked - a server that masked would be refused by the browser). */
export function encodeServerFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const length = payload.length;
  const headerBytes = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
  const out = new Uint8Array(headerBytes + length);
  out[0] = 0x80 | (opcode & 0x0f);
  if (length < 126) {
    out[1] = length;
  } else if (length <= 0xffff) {
    out[1] = 126;
    out[2] = (length >>> 8) & 0xff;
    out[3] = length & 0xff;
  } else {
    out[1] = 127;
    // Payloads this large cannot occur here (`maxPayloadBytes` is 1 MiB), but the field is still
    // written as the full 64-bit big-endian integer the RFC asks for.
    let left = length;
    for (let i = 9; i >= 2; i--) {
      out[i] = left % 256;
      left = Math.floor(left / 256);
    }
  }
  out.set(payload, headerBytes);
  return out;
}

export interface WebSocketHandlers {
  onMessage?(data: Uint8Array, binary: boolean): void;
  onClose?(reason: string): void;
}

/**
 * A server-side WebSocket: one TCP socket, messages in and out.
 *
 * Messages are reassembled from continuation frames before `onMessage` sees them, so a caller never
 * deals with fragments. Control frames are answered here (ping -> pong, close -> close + destroy),
 * which is what keeps a proxy from deciding the connection is dead.
 */
export class WebSocket {
  /** Called for every complete message. Assignable after construction, like the socket API. */
  onMessage: ((data: Uint8Array, binary: boolean) => void) | undefined;
  /** Called once when the connection ends, however it ends. */
  onClose: ((reason: string) => void) | undefined;
  private readonly socket: Socket;
  private readonly parser = new WsParser();
  private closed = false;
  private closeReason: string | undefined;
  /** The message being reassembled: fragments between a non-FIN data frame and its last one. */
  private fragments: Uint8Array[] = [];
  private fragmentOpcode = 0;

  constructor(raw: Duplex, handlers: WebSocketHandlers = {}) {
    // `http.Server`'s "upgrade" event hands out the underlying `net.Socket` typed as a `Duplex`;
    // everything used here (write/end/destroy/on/setNoDelay) is the socket's own API.
    const socket = raw as Socket;
    this.socket = socket;
    this.onMessage = handlers.onMessage;
    this.onClose = handlers.onClose;
    socket.setNoDelay(true);
    socket.on("data", (chunk) =>
      this.receive(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk)),
    );
    socket.on("error", (error) => this.finish((error as Error).message));
    socket.on("close", () => this.finish(this.closeReason ?? "the socket closed"));
    // A socket handed over by `http.Server`'s upgrade event has `allowHalfOpen = true`, so a browser
    // that vanishes without a closing handshake (a closed tab, a killed process) only produces
    // `end` - never `close`. Without this line the session behind it lives forever, and with it the
    // account's seat: the next login would be refused as "already online".
    socket.on("end", () => this.finish(this.closeReason ?? "the peer closed the connection"));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private receive(chunk: Uint8Array): void {
    let frames: WsFrame[];
    try {
      frames = this.parser.push(chunk);
    } catch (error) {
      this.fail(`protocol error: ${(error as Error).message}`, 1002);
      return;
    }
    for (const frame of frames) {
      if (frame.opcode === WS_OPCODE.ping) {
        if (!this.closed) this.socket.write(encodeServerFrame(WS_OPCODE.pong, frame.payload));
        continue;
      }
      if (frame.opcode === WS_OPCODE.pong) continue;
      if (frame.opcode === WS_OPCODE.close) {
        this.closeReason = "the peer closed the websocket";
        if (!this.closed) {
          this.closed = true;
          this.socket.write(encodeServerFrame(WS_OPCODE.close, frame.payload.slice(0, 2)));
          this.socket.end();
          this.onClose?.(this.closeReason);
        }
        return;
      }
      if (
        frame.opcode === WS_OPCODE.continuation ||
        frame.opcode === WS_OPCODE.text ||
        frame.opcode === WS_OPCODE.binary
      ) {
        if (frame.opcode !== WS_OPCODE.continuation) {
          if (this.fragments.length > 0) {
            this.fail("a new data frame started before the previous one finished", 1002);
            return;
          }
          this.fragmentOpcode = frame.opcode;
        } else if (this.fragments.length === 0) {
          this.fail("a continuation frame without a message to continue", 1002);
          return;
        }
        this.fragments.push(frame.payload);
        if (!frame.fin) continue;
        const total = this.fragments.reduce((sum, part) => sum + part.length, 0);
        if (total > WS_MAX_MESSAGE_BYTES) {
          this.fail(`message of ${total} bytes exceeds ${WS_MAX_MESSAGE_BYTES}`, 1009);
          return;
        }
        const message = new Uint8Array(total);
        let at = 0;
        for (const part of this.fragments) {
          message.set(part, at);
          at += part.length;
        }
        this.fragments = [];
        this.onMessage?.(message, this.fragmentOpcode === WS_OPCODE.binary);
        continue;
      }
      this.fail(`opcode 0x${frame.opcode.toString(16)} is reserved`, 1002);
      return;
    }
  }

  sendText(text: string): void {
    this.send(WS_OPCODE.text, new TextEncoder().encode(text));
  }

  sendBinary(bytes: Uint8Array): void {
    this.send(WS_OPCODE.binary, bytes);
  }

  private send(opcode: number, payload: Uint8Array): void {
    if (this.closed) return;
    this.socket.write(encodeServerFrame(opcode, payload));
  }

  /** Starts the closing handshake; the socket is destroyed after the peer answers (or at once). */
  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    const reasonBytes = new TextEncoder().encode(reason).slice(0, 123);
    const payload = new Uint8Array(2 + reasonBytes.length);
    payload[0] = (code >>> 8) & 0xff;
    payload[1] = code & 0xff;
    payload.set(reasonBytes, 2);
    this.socket.write(encodeServerFrame(WS_OPCODE.close, payload));
    this.socket.end();
    this.onClose?.(reason === "" ? `closed (${code})` : reason);
  }

  private fail(reason: string, code: number): void {
    this.close(code, reason.slice(0, 100));
  }

  /** The socket ended without a closing handshake (a dropped connection). */
  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onClose?.(reason);
  }
}
