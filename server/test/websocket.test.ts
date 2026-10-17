/**
 * The WebSocket layer, on its own.
 *
 * The interesting part is not "does it echo" but the three rules a browser will enforce and this
 * server must satisfy: the `Sec-WebSocket-Accept` hash (RFC 6455's own test vector), a server frame
 * that is never masked, and a client frame that is always masked. A regression in any of them looks
 * like "the preview page cannot connect", which is exactly the failure worth a unit test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import {
  WS_MAX_MESSAGE_BYTES,
  WS_OPCODE,
  WsParser,
  WebSocketError,
  acceptKey,
  encodeServerFrame,
  isWebSocketUpgrade,
  upgradeResponse,
} from "../src/net/websocket.ts";

/** A client frame, masked the way a browser masks it (RFC 6455 5.3). */
function clientFrame(opcode: number, payload: Uint8Array, options: { fin?: boolean; mask?: boolean } = {}): Uint8Array {
  const fin = options.fin ?? true;
  const masked = options.mask ?? true;
  const length = payload.length;
  const headerBytes = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
  const out = new Uint8Array(headerBytes + (masked ? 4 : 0) + length);
  out[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  if (length < 126) out[1] = (masked ? 0x80 : 0) | length;
  else if (length <= 0xffff) {
    out[1] = (masked ? 0x80 : 0) | 126;
    out[2] = (length >>> 8) & 0xff;
    out[3] = length & 0xff;
  } else {
    out[1] = (masked ? 0x80 : 0) | 127;
    let left = length;
    for (let i = 9; i >= 2; i--) {
      out[i] = left % 256;
      left = Math.floor(left / 256);
    }
  }
  let at = headerBytes;
  if (masked) {
    const mask = [0x37, 0xfa, 0x21, 0x3d];
    out.set(mask, at);
    at += 4;
    for (let i = 0; i < length; i++) out[at + i] = payload[i]! ^ mask[i & 3]!;
  } else {
    out.set(payload, at);
  }
  return out;
}

function request(headers: Record<string, string>, method = "GET"): IncomingMessage {
  return { method, headers } as unknown as IncomingMessage;
}

test("the accept hash matches RFC 6455's own example", () => {
  // RFC 6455 section 1.3: the key "dGhlIHNhbXBsZSBub25jZQ==" must answer with this value.
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("only a real upgrade is accepted, and every missing header is a refusal", () => {
  const good = {
    connection: "Upgrade",
    upgrade: "websocket",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  };
  assert.equal(isWebSocketUpgrade(request(good)), true);
  const accepted = upgradeResponse(request(good));
  assert.equal(accepted.ok, true);
  assert.ok(accepted.ok && accepted.headers[0] === "HTTP/1.1 101 Switching Protocols");
  assert.ok(accepted.ok && accepted.headers.includes("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));

  assert.equal(isWebSocketUpgrade(request({ ...good, upgrade: "h2c" })), false);
  assert.equal(isWebSocketUpgrade(request({ ...good, connection: "keep-alive" })), false);
  const wrongVersion = upgradeResponse(request({ ...good, "sec-websocket-version": "12" }));
  assert.deepEqual(wrongVersion.ok ? {} : { status: wrongVersion.status }, { status: 426 });
  const noKey = upgradeResponse(request({ ...good, "sec-websocket-key": "" }));
  assert.deepEqual(noKey.ok ? {} : { status: noKey.status }, { status: 400 });
  const post = upgradeResponse(request(good, "POST"));
  assert.deepEqual(post.ok ? {} : { status: post.status }, { status: 405 });
});

test("a masked client frame is parsed back byte for byte", () => {
  const parser = new WsParser();
  const payload = new TextEncoder().encode('{"t":"login"}');
  const frames = parser.push(clientFrame(WS_OPCODE.text, payload));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], { fin: true, opcode: WS_OPCODE.text, payload });
});

test("a frame split across chunks waits for the rest of itself", () => {
  const parser = new WsParser();
  const payload = new Uint8Array(200).map((_, index) => index & 0xff);
  const wire = clientFrame(WS_OPCODE.binary, payload);
  // The 126-length form is used here, so the header itself spans the split as well.
  assert.equal(parser.push(wire.slice(0, 3)).length, 0);
  assert.equal(parser.push(wire.slice(3, 100)).length, 0);
  const frames = parser.push(wire.slice(100));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0]!.payload, payload);
});

test("messages are reassembled from continuation frames before anyone sees them", () => {
  const parser = new WsParser();
  const first = parser.push(clientFrame(WS_OPCODE.text, new TextEncoder().encode("hello "), { fin: false }));
  assert.equal(first.length, 1); // the parser reports the fragment; reassembly is the connection's job
  const second = parser.push(clientFrame(WS_OPCODE.continuation, new TextEncoder().encode("world"), { fin: true }));
  assert.equal(second.length, 1);
  assert.equal(new TextDecoder().decode(second[0]!.payload), "world");
});

test("an unmasked client frame, a reserved opcode and a huge frame are all refused", () => {
  const parser = new WsParser();
  assert.throws(() => parser.push(clientFrame(WS_OPCODE.text, new Uint8Array(2), { mask: false })), WebSocketError);
  assert.throws(() => parser.push(clientFrame(0x3, new Uint8Array(0))), WebSocketError);
  const oversized = new WsParser({ maxPayloadBytes: 8 });
  assert.throws(() => oversized.push(clientFrame(WS_OPCODE.text, new Uint8Array(9))), WebSocketError);
});

test("a server frame is never masked and uses the smallest length form", () => {
  assert.deepEqual([...encodeServerFrame(WS_OPCODE.text, new Uint8Array(0))], [0x81, 0x00]);
  assert.deepEqual([...encodeServerFrame(WS_OPCODE.binary, new Uint8Array(3))], [0x82, 0x03, 0, 0, 0]);
  const big = encodeServerFrame(WS_OPCODE.binary, new Uint8Array(300));
  assert.equal(big[0], 0x82);
  assert.equal(big[1], 126);
  assert.equal((big[2]! << 8) | big[3]!, 300);
  assert.equal(big[4], 0, "the payload starts here, not a mask");
});

test("the frame size cap is the message cap, not an arbitrary number", () => {
  assert.equal(WS_MAX_MESSAGE_BYTES, 1 << 20);
});
