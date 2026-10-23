/** Application-specific JSON still needs per-kind field checks beyond these transport envelopes. */
export type ClientRequestEnvelope = Readonly<Record<string, unknown> & { t: string }>;
export type ServerEventEnvelope = Readonly<Record<string, unknown> & { t: string }>;

// WebSocket.OPEN is the browser API's standard readyState value; keep the transport injectable.
const WEBSOCKET_OPEN_STATE = 1;

/** A WebSocket surface small enough to exercise deterministically without opening a real socket. */
export interface ClientWebSocket extends EventTarget {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ClientWebSocketHandlers {
  open(): void;
  error(): void;
  close(): void;
  message(message: ServerEventEnvelope): void;
  malformedMessage(text: string): void;
}

export interface ClientWebSocketTransportOptions {
  createSocket(url: string): ClientWebSocket;
  onNotOpen(messageType: string): void;
}

function isServerEventEnvelope(value: unknown): value is ServerEventEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.hasOwn(value, "t") && typeof (value as { t?: unknown }).t === "string";
}

/**
 * Owns the browser's same-origin WebSocket generation, JSON envelope and send-ready checks.
 * Replaced sockets are fenced before they are closed, so their late events cannot affect the new
 * session. This validates only JSON plus the top-level `t` discriminator; event payloads remain the
 * responsibility of the event handlers.
 */
export function clientWebSocketTransport({
  createSocket,
  onNotOpen,
}: ClientWebSocketTransportOptions) {
  let current: ClientWebSocket | undefined;

  function connect(url: string, handlers: ClientWebSocketHandlers): void {
    const previous = current;
    const connection = createSocket(url);
    current = connection;
    previous?.close();

    connection.addEventListener("open", () => {
      if (current === connection) handlers.open();
    });
    connection.addEventListener("error", () => {
      if (current === connection) handlers.error();
    });
    connection.addEventListener("close", () => {
      if (current === connection) handlers.close();
    });
    connection.addEventListener("message", (event) => {
      if (current !== connection) return;
      const text = String((event as MessageEvent).data);
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        handlers.malformedMessage(text);
        return;
      }
      if (!isServerEventEnvelope(value)) {
        handlers.malformedMessage(text);
        return;
      }
      handlers.message(value);
    });
  }

  function send(message: ClientRequestEnvelope): boolean {
    const socket = current;
    if (!socket || socket.readyState !== WEBSOCKET_OPEN_STATE) {
      onNotOpen(message.t);
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  function close(code: number, reason: string): void {
    current?.close(code, reason);
  }

  return {
    connect,
    send,
    close,
    get open(): boolean {
      return current?.readyState === WEBSOCKET_OPEN_STATE;
    },
  };
}
