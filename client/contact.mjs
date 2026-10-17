/** Native RECT contact helpers (5085E0, 485AA0, 491FF0, 511C60).
 * Not CShape2D or a replacement for the complete CVecCtrl collision solver.
 */
export function intersects(a, b) {
  return (
    !!a &&
    !!b &&
    a.left < b.right &&
    b.left < a.right &&
    a.top < b.bottom &&
    b.top < a.bottom
  );
}
function swept(rect, point, previous = point) {
  return {
    left: rect.left + Math.min(point.x, previous.x),
    top: rect.top + Math.min(point.y, previous.y),
    right: rect.right + Math.max(point.x, previous.x),
    bottom: rect.bottom + Math.max(point.y, previous.y),
  };
}
export function playerContactRect(point, previous = point) {
  return swept({ left: -22, top: -65, right: 22, bottom: 0 }, point, previous);
}
/** Missing/empty lt/rb is genuinely non-collidable. Never infer a RECT from canvas pixels. */
export function mobRect(frame, point, flip = false, previous = point) {
  const r = frame?.bounds;
  if (!r || r.left >= r.right || r.top >= r.bottom) return undefined;
  return swept(
    flip ? { left: -r.right, right: -r.left, top: r.top, bottom: r.bottom } : r,
    point,
    previous,
  );
}
/** 491FF0 shrinks the swept RECT, with a minimum centre +/-1. C division truncates to zero. */
export function mobContactRect(frame, point, flip = false, previous = point) {
  const r = mobRect(frame, point, flip, previous);
  if (!r) return undefined;
  const cx = Math.trunc((r.left + r.right) / 2),
    cy = Math.trunc((r.top + r.bottom) / 2);
  return {
    left: Math.min(r.left + 25, cx - 1),
    top: Math.min(r.top + 30, cy - 1),
    right: Math.max(r.right - 25, cx + 1),
    bottom: Math.max(r.bottom - 10, cy + 1),
  };
}
/** Relative DISPLACEMENT, not which side the mob's centre happens to occupy. */
export function contactImpulse(player, previousPlayer, mob, previousMob) {
  const dx = previousPlayer.x + mob.x - previousMob.x - player.x;
  const dy = previousPlayer.y + mob.y - previousMob.y - player.y;
  return { x: Math.sign(dx) * 270, y: dy > 0 ? 0 : -270 };
}
/** Used twice: accumulating pending external force (5114A0), then applying it (537B00). */
export function mergeImpulse(velocity, impulse) {
  if (impulse < 0 && velocity > impulse)
    return Math.max(impulse, velocity + impulse);
  if (impulse > 0 && velocity < impulse)
    return Math.min(impulse, velocity + impulse);
  return velocity;
}
/** Native signed 1500ms lock, ticked in 30ms quanta. MISS is negative and never changes tint.
 * Phase advances even at zero; negative lock preserves the previous (normally white) layer colour.
 */
export function contactClock() {
  let remaining = 0,
    phase = 0,
    accumulator = 0,
    tinted = false;
  return {
    reset() {
      remaining = phase = accumulator = 0;
      tinted = false;
    },
    accept(damage) {
      remaining = damage > 0 ? 1500 : -1500;
    },
    step(elapsed) {
      accumulator += Math.max(0, elapsed);
      const ticks = Math.floor(accumulator / 30);
      accumulator -= ticks * 30;
      const activeTicks = Math.min(ticks, 50);
      for (let i = 0; i < activeTicks; i++) {
        if (remaining >= 0) {
          phase++;
          tinted = remaining !== 0 && (phase & 3) < 2;
        }
        remaining -= Math.sign(remaining) * Math.min(30, Math.abs(remaining));
      }
      if (ticks > activeTicks) {
        phase += ticks - activeTicks;
        tinted = false;
      }
      return ticks > 0;
    },
    get ready() {
      return remaining === 0;
    },
    get tinted() {
      return tinted;
    },
    get remaining() {
      return remaining;
    },
  };
}
