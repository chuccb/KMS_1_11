import type { FameResult } from "../protocol/fame.ts";
/** Result names are Unicode here (protocol/fame retains its CP949 byte-string contract). */
export type FameFeedback = FameResult | { kind: "notFound" } | { kind: "cooldown" };
/** 55D7B0 compares a SIGNED 32-bit timeGetTime difference, not an epoch deadline.
 * 558FD0 initializes last = now - 300000 on entering the field UI, allowing the first request.
 * Reserve before writing: even a refused response or failed send does not refund native cooldown.
 */
export const FAME_REQUEST_INTERVAL = 300_000;
export class FameRequestClock {
  private last: number;
  private readonly now: () => number;
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.last = (now() - FAME_REQUEST_INTERVAL) >>> 0;
  }
  reset(): void {
    this.last = (this.now() - FAME_REQUEST_INTERVAL) >>> 0;
  }
  reserve(): boolean {
    const time = this.now() >>> 0;
    if (((time - this.last) | 0) < FAME_REQUEST_INTERVAL) return false;
    this.last = time;
    return true;
  }
}
