/** Browser counterpart of losing native capture. Interruptions cancel presentation drags/presses,
 * never synthesize a click, inventory packet, or modal acceptance. Do not dispatch fake blur events.
 */
export function releaseOnInterrupt(release) {
  window.addEventListener('blur', release);
  window.addEventListener('pointercancel', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
}

/** CNpcPool 49F1F0 -> CNpc 49A670: translated NpcAttribute dc rectangle, NOT sprite bounds,
 * alpha hit testing, or a mirrored rectangle. Win32 PtInRect excludes the right/bottom edges.
 */
export function npcContains(npc, bounds, x, y) {
  return bounds !== undefined && x >= npc.x + bounds.left && x < npc.x + bounds.right &&
    y >= npc.y + bounds.top && y < npc.y + bounds.bottom;
}
