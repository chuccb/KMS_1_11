/**
 * The heartbeat, over real sockets.
 *
 * There is no way to test "the client answered" without a peer, so every test here builds a socket
 * pair and plays the client: the code under test watches the *server* end, the test answers - or
 * refuses to - on the other. That is the same shape as the real thing, where the thing answering is
 * `sub_43B280`'s unconditional echo (FINDINGS 4.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { Heartbeat } from "../src/net/heartbeat.ts";

interface Pair {
  /** The end the heartbeat watches - a `Map` key, and the thing it destroys. */
  server: net.Socket;
  /** The other end: the test's "client". */
  client: net.Socket;
  close(): Promise<void>;
}

async function socketPair(): Promise<Pair> {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", () => resolve()));
  const accepted = new Promise<net.Socket>((resolve) => listener.once("connection", resolve));
  const client = net.connect((listener.address() as net.AddressInfo).port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", reject);
  });
  const server = await accepted;
  server.on("error", () => {});
  client.on("error", () => {});
  // Both ends read. A paused socket keeps the peer's FIN behind the unread bytes in its buffer, so
  // the buffered pings of a dropped session would never turn into an `end`/`close` event - which is
  // exactly the event these tests assert on (and the reason a real server always has a reader).
  server.resume();
  client.resume();
  return {
    server,
    client,
    close: async () => {
      client.destroy();
      server.destroy();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
}

/** Waits until `check()` is true, or fails the test. */
async function until(check: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a session that answers every ping is never dropped", async (t) => {
  const pair = await socketPair();
  t.after(() => pair.close());
  const log: string[] = [];
  let pings = 0;
  const heartbeat = new Heartbeat({ intervalMs: 25, log: (line) => log.push(line) });
  t.after(() => heartbeat.close());

  // The heartbeat writes the ping on the watched (server) socket; the test's client is the peer that
  // receives it and answers. `note()` is what the real server's data handler does when the echo
  // lands - here the test plays that handler, because both ends live in one process.
  pair.client.on("data", (chunk) => {
    pings += 1;
    heartbeat.note(pair.server);
    pair.client.write(Buffer.from([chunk[0] ?? 8]));
  });
  heartbeat.add(pair.server, "test", () => pair.server.write(Buffer.from([8])));
  await until(() => pings >= 3, "three pings and three answers");
  assert.equal(heartbeat.watching, 1);
  assert.equal(pair.server.destroyed, false, "a session that answers is still connected");
  assert.deepEqual(log, [], "nothing to say about a session that answers");
});

test("a silent session is pinged and then dropped, which is what frees its account", async (t) => {
  const pair = await socketPair();
  t.after(() => pair.close());
  // A loaded test runner may skip a 20ms interval entirely. Timeout is elapsed time, not a
  // guaranteed number of callbacks; drive the clock deterministically while keeping real sockets.
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  const log: string[] = [];
  let pings = 0;
  const heartbeat = new Heartbeat({ intervalMs: 20, log: (line) => log.push(line) });
  t.after(() => heartbeat.close());

  const peerSawItGo = new Promise<void>((resolve) => pair.client.once("close", () => resolve()));
  heartbeat.add(pair.server, "test 127.0.0.1:1", () => {
    pings += 1;
    pair.server.write(Buffer.from([8]));
  });
  t.mock.timers.tick(20);
  assert.equal(pings, 1);
  assert.equal(pair.server.destroyed, false);
  t.mock.timers.tick(20);
  assert.equal(pings, 2);
  assert.equal(pair.server.destroyed, false);
  t.mock.timers.tick(20);
  assert.equal(pair.server.destroyed, true);
  assert.equal(pings, 2, "two scheduled pings, then drop without another ping");
  assert.equal(heartbeat.watching, 0, "a dropped session stops being watched");
  // The log line says how long it was quiet and how often it was asked - both in the unit the
  // interval is in, so a test's 20 ms and a server's 30 s read the same way.
  assert.match(log.join("\n"), /heartbeat: test 127\.0\.0\.1:1 sent nothing for \d+ ms \(pinged every 20 ms\)/);
  assert.match(log.join("\n"), /dropping the connection/);
  // The other end sees the connection go: that is the whole point of destroying the socket - every
  // `close` handler on our side runs as if the client had said goodbye, and the peer is told.
  await peerSawItGo;
});

test("any packet is proof of life, so a busy player is never pinged", async (t) => {
  const pair = await socketPair();
  t.after(() => pair.close());
  let pings = 0;
  const heartbeat = new Heartbeat({ intervalMs: 30 });
  t.after(() => heartbeat.close());
  heartbeat.add(pair.server, "test", () => {
    pings += 1;
  });

  // "The client" sends a byte every 10 ms and never answers anything - a player walking around. Every
  // arriving packet is what the server's data handler would note.
  const sender = setInterval(() => {
    heartbeat.note(pair.server);
    pair.client.write(Buffer.from([0x0e]));
  }, 10);
  await new Promise((resolve) => setTimeout(resolve, 150));
  clearInterval(sender);
  assert.equal(pings, 0, "a session that keeps talking is never asked");
  assert.equal(pair.server.destroyed, false);
});

test("watching stops when the session is removed, and closing drops every session", async (t) => {
  const pair = await socketPair();
  t.after(() => pair.close());
  const heartbeat = new Heartbeat({ intervalMs: 20 });
  heartbeat.add(pair.server, "test", () => {});
  assert.equal(heartbeat.watching, 1);
  heartbeat.remove(pair.server);
  assert.equal(heartbeat.watching, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(pair.server.destroyed, false, "a removed session is nobody's business any more");

  heartbeat.add(pair.server, "test", () => {});
  heartbeat.close();
  assert.equal(heartbeat.watching, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(pair.server.destroyed, false, "close() forgets, it does not destroy");
});

test("interval 0 means no timer and no bookkeeping", async (t) => {
  const pair = await socketPair();
  t.after(() => pair.close());
  const heartbeat = new Heartbeat({ intervalMs: 0 });
  let pings = 0;
  heartbeat.add(pair.server, "test", () => {
    pings += 1;
  });
  assert.equal(heartbeat.watching, 0);
  heartbeat.note(pair.server);
  heartbeat.remove(pair.server);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(pings, 0);
  assert.equal(pair.server.destroyed, false);
  heartbeat.close();
});
