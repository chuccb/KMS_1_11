/**
 * "Is that client still there?" - asked with the one packet the 2003 client is guaranteed to answer.
 *
 * A TCP connection does not die when the peer disappears: pull an Ethernet cable out and the socket
 * stays open on this side, with writes happily accepted into the send buffer, until the OS gives up
 * retransmitting (minutes). For a server that counts sessions (see `net/online.ts`) that is the
 * worst kind of bug, because the *stale* session is what refuses a player's next login - the
 * message would say "you are already connected" about a client that no longer exists.
 *
 * The client has the answer built in. `0x08` is `[u32]` and its handler is an unconditional echo:
 *
 *   - `sub_43B170` (the client's packet dispatcher) handles `0x07` and `0x08` **before** it looks at
 *     the current stage - `case 8: sub_43B280(this, packet)` - so this works in a field, at
 *     character select and at the title screen alike (FINDINGS 4);
 *   - `sub_43B280` reads a `u32` and sends `[0x08][that u32]` back, with no conditions and no state
 *     (FINDINGS 4.2).
 *
 * So the server's question is a ping and the answer is an ordinary packet: **any packet from the
 * client proves it is alive** (`note`), and a session that has been quiet for a whole interval gets
 * asked (`ping`). A session that has been quiet for `timeoutMs` - pinged and still silent - is not
 * there any more, and its socket is destroyed, which makes every `close` handler run exactly as if
 * the client had said goodbye.
 *
 * Two things this deliberately does not do: it does not know the protocol (the caller passes the
 * `ping` closure, because only the caller holds the session's cipher state) and it does not know
 * what a session *means* (the `label` is a string for the log). And the ping value itself is
 * meaningless on purpose: the client echoes it verbatim and nothing reads it, so the caller sends a
 * counter just to make our own traces readable - what the 2003 server put there is not in the client
 * (ADR-018).
 */
import type { Socket } from "node:net";

/**
 * The default ping interval: 30 s, i.e. a dropped session frees its account within ~90 s.
 *
 * The number is **our choice**, not the 2003 server's - the interval is not in the client (it only
 * answers), so nothing can be read out of the binary (ADR-018). 30 s keeps an idle connection's
 * traffic at two packets per minute, and a real disconnect is noticed before a player has finished
 * clicking back to the login screen.
 */
export const DEFAULT_PING_MS = 30_000;

/** `140 ms` / `90 s` - a test's interval and a server's read the same way in the log. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

interface Watched {
  readonly label: string;
  readonly ping: () => void;
  /** The last moment the client said anything at all. */
  lastSeen: number;
}

export interface HeartbeatOptions {
  /**
   * How often a session that has been quiet for that long is asked. **0 turns the mechanism off**
   * (nothing is watched, no timer runs) - what a caller that does not want a timer passes.
   */
  intervalMs: number;
  /** Drop a session that has been quiet this long. Defaults to three intervals: two pings, then out. */
  timeoutMs?: number;
  /** One line per dropped session (never one per ping: an idle server would drown in its own log). */
  log?(line: string): void;
}

export class Heartbeat {
  private readonly options: HeartbeatOptions;
  private readonly watched = new Map<Socket, Watched>();
  private readonly timer: NodeJS.Timeout | undefined;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  constructor(options: HeartbeatOptions) {
    this.options = options;
    this.intervalMs = Math.max(0, Math.floor(options.intervalMs));
    this.timeoutMs = options.timeoutMs ?? this.intervalMs * 3;
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => this.tick(), this.intervalMs);
    }
  }

  /**
   * Starts watching a socket. The `ping` closure sends one `0x08` to it; it is only ever called for
   * a session that has been quiet, so a busy player never receives one.
   */
  add(socket: Socket, label: string, ping: () => void): void {
    if (this.intervalMs === 0) return;
    this.watched.set(socket, { label, ping, lastSeen: Date.now() });
  }

  /** The client said something - any packet, not just the echo. It is alive. */
  note(socket: Socket): void {
    const session = this.watched.get(socket);
    if (session !== undefined) session.lastSeen = Date.now();
  }

  /** Stops watching (the socket's `close` handler; the timer must not outlive the session). */
  remove(socket: Socket): void {
    this.watched.delete(socket);
  }

  /** How many sessions are being watched. For tests and for a caller that wants to log its state. */
  get watching(): number {
    return this.watched.size;
  }

  /** Stops the timer and forgets every session. A closed server must not keep the process alive. */
  close(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.watched.clear();
  }

  /**
   * One interval: ask the quiet, drop the silent.
   *
   * The drop is decided *before* the ping so a session can never be pinged and destroyed in the same
   * tick, and it is logged with the label - the operator needs to know whose connection was not
   * answering, because that is the account whose seat is about to be freed.
   */
  private tick(): void {
    const now = Date.now();
    for (const [socket, session] of this.watched) {
      const quiet = now - session.lastSeen;
      if (quiet >= this.timeoutMs) {
        this.watched.delete(socket);
        this.options.log?.(
          `heartbeat: ${session.label} sent nothing for ${duration(quiet)} ` +
            `(pinged every ${duration(this.intervalMs)}), dropping the connection`,
        );
        socket.destroy();
        continue;
      }
      if (quiet >= this.intervalMs) {
        try {
          session.ping();
        } catch (error) {
          this.options.log?.(`heartbeat: ping to ${session.label} failed: ${(error as Error).message}`);
        }
      }
    }
  }
}
