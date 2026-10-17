/** sub_4A4740: non-auto portals, grounded Up, RECT [-20,20) x [-50,50).
 * sub_4A47D0 / sub_5124C0: type 3 automatic, RECT [-50,50) squared, every update.
 * Native searches last-loaded first. Screen-pointer clicking is a separate browser affordance. */
export function movementPortal(portals, body, up = false) {
  if (!body) return;
  for (const automatic of [true, false]) {
    if (!automatic && (!up || !body.grounded || body.ladder)) continue;
    for (let i = portals.length - 1; i >= 0; i--) {
      const p = portals[i];
      if ((p.type === 3) !== automatic || p.type === 0 || !p.name || !(p.toMapId >= 0) || p.toMapId === 999999999) continue;
      const radius = automatic ? 50 : 20, dx = body.x - p.x, dy = body.y - p.y;
      if (dx >= -radius && dx < radius && dy >= -50 && dy < 50) return p;
    }
  }
}
/** CharacterData+101 indexes the non-type-3 array, not the WZ numeric node name. */
export function arrivalPortal(map, index = 0) {
  const portals = map.portals.filter(p => p.type !== 3);
  return portals[index] ?? portals.find(p => p.name === 'sp') ?? portals[0];
}
