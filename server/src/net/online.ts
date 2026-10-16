/**
 * Who is online: one seat per account, shared by the login server and the game server.
 *
 * Why this exists at all: the 2003 client has a message for it. The login chain's result byte has a
 * value `7` that makes the client print **"현재 접속중인 아이디이거나,\r\n현재 서버점검중입니다."**
 * ("this id is currently connected, or the server is under maintenance") - read out of `.rdata`, see
 * `LOGIN_RESULT.alreadyConnected` and FINDINGS 4.8. The original server therefore refused a second
 * login on an account that was already in. Until this module, this server could not: two clients
 * logging into one account both got in, shared one `CharacterData` (the record the game server hands
 * out is the account table's own object, ADR-017), and would corrupt each other's exp and items.
 *
 * What a seat is **not**: it is not a character check. A seat is held per account -
 * `sub_4D0DB0`'s message talks about the id, and that is the stage where a player learns about it.
 * "This character is already in a field" is a different (and narrower) invariant, and it lives where
 * the character actually is: `GameEntryServer`'s session table.
 *
 * The seat is held by a *live session*, not by a login attempt:
 *
 *   - the login server claims it when `0x01` succeeds, and releases it when that socket closes;
 *   - the game server claims it when the character enters a field, and releases it on the same
 *     socket's close.
 *
 * Both, because the handoff between them is a new TCP connection (the `0x03` reply sends the client
 * elsewhere): either half alone would leave a gap - the login socket alone is not the session, and
 * the game socket alone does not exist yet while the player is on the character-select screen.
 *
 * A session that never notices its peer died is the failure mode this has to have an answer for,
 * because "still online" is what refuses the next login: `net/heartbeat.ts` is that answer (the
 * client's `0x08` echo, FINDINGS 4.2), and `OnlineAccounts.leave` is idempotent so a socket that is
 * closed twice cannot release somebody else's seat. `SeatKeeper` at the bottom of this file is the
 * per-server end of it: a seat and the heartbeat that keeps it honest, taken and given back together.
 */
import type { Socket } from "node:net";
import type { Heartbeat } from "./heartbeat.ts";

/** One live session's claim on the seat of an account. */
export interface OnlineSession {
  /** The account whose seat this session occupies. */
  readonly account: string;
  /**
   * Which half of the server the session is on. Both count: a player at the character-select screen
   * is as connected as one standing in a map.
   */
  readonly where: "login" | "game";
  /** `ip:port` of the peer, for the log line an operator reads when a login is refused. */
  readonly peer: string;
  /** When the seat was taken (`Date.now()`), so the log can say how long it has been held. */
  readonly since: number;
}

/** The seats, keyed by account name. */
export class OnlineAccounts {
  private readonly seats = new Map<string, Set<OnlineSession>>();

  /**
   * Takes a seat for `account`. Every call needs its own `leave`: the returned object *is* the
   * claim, and only that object can give the seat back.
   */
  enter(account: string, where: "login" | "game", peer: string, now = Date.now()): OnlineSession {
    const session: OnlineSession = { account, where, peer, since: now };
    let seats = this.seats.get(account);
    if (seats === undefined) this.seats.set(account, (seats = new Set()));
    seats.add(session);
    return session;
  }

  /** Gives a seat back. A session this table does not hold - already released, or never entered - is ignored. */
  leave(session: OnlineSession): void {
    const seats = this.seats.get(session.account);
    if (seats === undefined) return;
    seats.delete(session);
    if (seats.size === 0) this.seats.delete(session.account);
  }

  /** True while at least one live session holds this account. What `0x01` refuses on. */
  isOnline(account: string): boolean {
    return this.seats.has(account);
  }

  /** The sessions holding an account, oldest first. For logs and tests; empty when it is free. */
  sessionsOf(account: string): OnlineSession[] {
    return [...(this.seats.get(account) ?? [])].sort((a, b) => a.since - b.since);
  }

  /** How many accounts are online (not how many sessions - one account, one seat). */
  get size(): number {
    return this.seats.size;
  }
}

/**
 * `login 127.0.0.1:53123 (4s)` - who is holding the seat, in one line, for the refusal log.
 *
 * The operator's question when a player reports "it says I am already logged in" is *which*
 * connection is holding it and for how long, and every part of that answer is one of these fields.
 */
export function describeSessions(sessions: OnlineSession[], now = Date.now()): string {
  const age = (session: OnlineSession): string => `${Math.max(0, Math.round((now - session.since) / 1000))}s`;
  return sessions.map((session) => `${session.where} ${session.peer} (${age(session)})`).join(", ");
}

/** `ip:port` of a socket's peer. */
function peerOf(socket: Socket): string {
  return `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`;
}

export interface SeatKeeperOptions {
  online: OnlineAccounts;
  heartbeat: Heartbeat;
  /** Which half of the server is holding the seats - the login chain or a field. */
  where: "login" | "game";
}

/**
 * One server's end of the seats: takes them, gives them back, and starts the heartbeat that proves
 * they are worth holding.
 *
 * A seat and a heartbeat are one fact, so they are taken and given back in one place. The keeper is
 * also what makes a server's `close()` deterministic: the sockets' `close` events arrive whenever the
 * event loop gets to them, and a test that closes one server and starts another on the same
 * `OnlineAccounts` (or the same save) must not race those events - `releaseAll()` gives every seat
 * back before the caller returns.
 */
export class SeatKeeper {
  private readonly online: OnlineAccounts;
  private readonly heartbeat: Heartbeat;
  private readonly where: "login" | "game";
  private readonly held = new Map<Socket, OnlineSession>();

  constructor(options: SeatKeeperOptions) {
    this.online = options.online;
    this.heartbeat = options.heartbeat;
    this.where = options.where;
  }

  /**
   * Takes the account's seat for `socket`. `ping` sends one `0x08` to it - the heartbeat only calls
   * it for a session that has gone quiet.
   */
  claim(socket: Socket, account: string, ping: () => void): OnlineSession {
    const session = this.online.enter(account, this.where, peerOf(socket));
    this.held.set(socket, session);
    this.heartbeat.add(socket, `${this.where} ${peerOf(socket)}`, ping);
    return session;
  }

  /** Gives the seat back and stops the heartbeat. Safe to call for a socket that holds nothing. */
  release(socket: Socket): void {
    this.heartbeat.remove(socket);
    const session = this.held.get(socket);
    if (session === undefined) return;
    this.held.delete(socket);
    this.online.leave(session);
  }

  /** Gives back everything this keeper holds (a server's `close()`, before the sockets are cut). */
  releaseAll(): void {
    for (const socket of [...this.held.keys()]) this.release(socket);
  }

  /** How many sockets this server is holding seats for. For logs and tests. */
  get size(): number {
    return this.held.size;
  }
}
