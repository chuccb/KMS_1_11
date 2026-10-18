/**
 * The seats: one account, one live session (ADR-018).
 *
 * The interesting part is not the happy path - it is what a second claim, a double release and a
 * release of somebody else's seat do, because those are the three ways a seat can outlive or
 * overwrite the session it belongs to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "node:net";

import { OnlineAccounts, SeatKeeper, describeSessions } from "../src/net/online.ts";
import { Heartbeat } from "../src/net/heartbeat.ts";

test("an account is online while a session holds it, and free again when it is given back", () => {
  const online = new OnlineAccounts();
  assert.equal(online.size, 0);
  assert.equal(online.isOnline("admin"), false);
  assert.deepEqual(online.sessionsOf("admin"), []);

  const first = online.enter("admin", "login", "127.0.0.1:53123", 1_000);
  assert.equal(online.isOnline("admin"), true);
  assert.equal(online.size, 1);
  assert.deepEqual(online.sessionsOf("admin"), [first]);
  assert.equal(first.account, "admin");
  assert.equal(first.where, "login");
  assert.equal(first.peer, "127.0.0.1:53123");
  assert.equal(first.since, 1_000);

  // A second session on the same account (the login connection and the field one, or two clients):
  // the seat is taken until the *last* of them is gone.
  const second = online.enter("admin", "game", "127.0.0.1:53140", 2_000);
  assert.equal(online.size, 1, "one account, one seat");
  assert.deepEqual(
    online.sessionsOf("admin").map((session) => session.where),
    ["login", "game"],
    "oldest first",
  );

  online.leave(first);
  assert.equal(online.isOnline("admin"), true, "the field session still holds it");
  online.leave(second);
  assert.equal(online.isOnline("admin"), false);
  assert.equal(online.size, 0);
  assert.deepEqual(online.sessionsOf("admin"), []);
});

test("giving a seat back twice, or somebody else's, changes nothing", () => {
  const online = new OnlineAccounts();
  const mine = online.enter("admin", "game", "127.0.0.1:1", 0);
  const stranger = { account: "admin", where: "login" as const, peer: "127.0.0.1:2", since: 0 };

  online.leave(mine);
  online.leave(mine); // the socket's close handler and `SeatKeeper.releaseAll` can both run
  online.leave(stranger); // never entered
  assert.equal(online.isOnline("admin"), false);

  // And a *different* account's seat is never touched by a release of the same object twice.
  const other = online.enter("guest", "login", "127.0.0.1:3", 0);
  online.leave(mine);
  assert.equal(online.isOnline("guest"), true);
  online.leave(other);
});

test("the refusal log says which session holds the seat, and for how long", () => {
  const online = new OnlineAccounts();
  online.enter("admin", "login", "10.0.0.9:53123", 60_000);
  online.enter("admin", "game", "10.0.0.9:53140", 87_000);
  assert.equal(
    describeSessions(online.sessionsOf("admin"), 92_000),
    "login 10.0.0.9:53123 (32s), game 10.0.0.9:53140 (5s)",
  );
  assert.equal(describeSessions([]), "");
});

test("a seat keeper claims, watches and releases together", async (t) => {
  const online = new OnlineAccounts();
  // A long interval: this test is about the bookkeeping, and a watcher that never ticks cannot drop
  // anything. The sockets are doubles because the keeper only ever reads `remoteAddress`/`remotePort`
  // from them (the heartbeat keys its map by them).
  const heartbeat = new Heartbeat({ intervalMs: 60_000 });
  t.after(() => heartbeat.close());
  const keeper = new SeatKeeper({ online, heartbeat, where: "game" });
  const socket = { remoteAddress: "10.0.0.9", remotePort: 53140 } as unknown as Socket;

  keeper.claim(socket, "admin", () => {});
  assert.equal(online.isOnline("admin"), true);
  assert.equal(online.sessionsOf("admin")[0]?.peer, "10.0.0.9:53140");
  assert.equal(keeper.size, 1);
  assert.equal(
    heartbeat.watching,
    1,
    "a seat nobody can prove is alive is a seat that locks a player out",
  );

  keeper.release(socket);
  assert.equal(online.isOnline("admin"), false);
  assert.equal(keeper.size, 0);
  assert.equal(heartbeat.watching, 0);
  keeper.release(socket); // idempotent: the close handler and `releaseAll` may both run

  // Two sockets, two seats, and `releaseAll` gives both back (a server's `close()`).
  const second = { remoteAddress: "10.0.0.9", remotePort: 53141 } as unknown as Socket;
  keeper.claim(socket, "admin", () => {});
  keeper.claim(second, "guest", () => {});
  assert.equal(online.size, 2);
  keeper.releaseAll();
  assert.equal(online.size, 0);
  assert.equal(heartbeat.watching, 0);
});
