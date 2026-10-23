import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientWebSocketTransport,
  type ServerEventEnvelope,
  type ClientWebSocket,
  type ClientWebSocketHandlers,
} from "../../client/websocket-transport.ts";

class FakeSocket extends EventTarget implements ClientWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly closeCalls: { code: number | undefined; reason: string | undefined }[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  fail(): void {
    this.dispatchEvent(new Event("error"));
  }

  receive(data: string): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const notOpen: string[] = [];
  const transport = clientWebSocketTransport({
    createSocket(url) {
      assert.equal(url, "wss://game.example/ws");
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onNotOpen: (messageType) => notOpen.push(messageType),
  });
  return { sockets, notOpen, transport };
}

function handlers(
  events: string[],
  messages: ServerEventEnvelope[] = [],
  malformed: string[] = [],
): ClientWebSocketHandlers {
  return {
    open: () => events.push("open"),
    error: () => events.push("error"),
    close: () => events.push("close"),
    message: (message) => messages.push(message),
    malformedMessage: (text) => malformed.push(text),
  };
}

test("transport gates sends until open and serializes one JSON request", () => {
  const { sockets, notOpen, transport } = setup();
  assert.equal(transport.open, false);
  assert.equal(transport.send({ t: "login", user: "demo", password: "demo" }), false);
  assert.deepEqual(notOpen, ["login"]);

  const events: string[] = [];
  transport.connect("wss://game.example/ws", handlers(events));
  const [socket] = sockets;
  assert.ok(socket);
  socket.open();
  assert.deepEqual(events, ["open"]);
  assert.equal(transport.open, true);
  assert.equal(transport.send({ t: "world", world: 0 }), true);
  assert.deepEqual(socket.sent, ['{"t":"world","world":0}']);
});

test("transport accepts JSON object envelopes and rejects malformed or undiscriminated values", () => {
  const { sockets, transport } = setup();
  const messages: ServerEventEnvelope[] = [];
  const malformed: string[] = [];
  transport.connect("wss://game.example/ws", handlers([], messages, malformed));
  const [socket] = sockets;
  assert.ok(socket);

  socket.receive('{"t":"field","mapId":100000000}');
  for (const text of ["{", "null", "[]", "{}", '{"t":3}']) socket.receive(text);

  assert.deepEqual(messages, [{ t: "field", mapId: 100000000 }]);
  assert.deepEqual(malformed, ["{", "null", "[]", "{}", '{"t":3}']);
});

test("replaced socket events are fenced and the previous socket is closed", () => {
  const { sockets, transport } = setup();
  const oldEvents: string[] = [];
  const newEvents: string[] = [];
  const oldMessages: ServerEventEnvelope[] = [];
  const newMessages: ServerEventEnvelope[] = [];
  transport.connect("wss://game.example/ws", handlers(oldEvents, oldMessages));
  const oldSocket = sockets[0];
  assert.ok(oldSocket);
  oldSocket.open();

  transport.connect("wss://game.example/ws", handlers(newEvents, newMessages));
  const newSocket = sockets[1];
  assert.ok(newSocket);
  assert.deepEqual(oldSocket.closeCalls, [{ code: undefined, reason: undefined }]);

  oldSocket.open();
  oldSocket.fail();
  oldSocket.receive('{"t":"stale"}');
  assert.deepEqual(oldEvents, ["open"]);
  assert.deepEqual(oldMessages, []);

  newSocket.open();
  newSocket.receive('{"t":"current"}');
  assert.deepEqual(newEvents, ["open"]);
  assert.deepEqual(newMessages, [{ t: "current" }]);
});

test("only the active socket reports errors and close events", () => {
  const { sockets, transport } = setup();
  const oldEvents: string[] = [];
  const activeEvents: string[] = [];
  transport.connect("wss://game.example/ws", handlers(oldEvents));
  const oldSocket = sockets[0];
  assert.ok(oldSocket);
  transport.connect("wss://game.example/ws", handlers(activeEvents));
  const activeSocket = sockets[1];
  assert.ok(activeSocket);

  oldSocket.fail();
  oldSocket.close();
  activeSocket.fail();
  activeSocket.close();
  assert.deepEqual(oldEvents, []);
  assert.deepEqual(activeEvents, ["error", "close"]);
  assert.equal(transport.open, false);
});

test("explicit return-to-title close preserves its code and reason", () => {
  const { sockets, transport } = setup();
  const events: string[] = [];
  transport.connect("wss://game.example/ws", handlers(events));
  const [socket] = sockets;
  assert.ok(socket);
  socket.open();

  transport.close(1000, "return to title");
  assert.deepEqual(socket.closeCalls, [{ code: 1000, reason: "return to title" }]);
  assert.deepEqual(events, ["open", "close"]);
  assert.equal(transport.open, false);
});
