/** Seven original slots: PE 5BCEC0 / 4FC960 / 4FC9F0 and 511E20's VK dispatch table.
 * Ctrl attacks and Alt jumps; neither is one of these seven configurable slots.
 */
export const QUICK_SLOTS = Object.freeze([
  { key: 'Shift', x: 753, y: 490 },
  { key: 'Insert', x: 692, y: 527 },
  { key: 'Home', x: 728, y: 527 },
  { key: 'PageUp', x: 764, y: 527 },
  { key: 'Delete', x: 692, y: 564 },
  { key: 'End', x: 728, y: 564 },
  { key: 'PageDown', x: 764, y: 564 },
]);
export function quickSlotAt(x, y) {
  return QUICK_SLOTS.findIndex(s => x >= s.x && x < s.x + 32 && y >= s.y && y < s.y + 32);
}
export function quickItemAllowed(id) {
  return Number.isInteger(id) && [200, 201, 202].includes(Math.floor(id / 10000));
}
/** 463DF0: binding by template ID, remove duplicates, no inventory move/consumption packet. */
export function bindQuickItem(bindings, index, itemId) {
  if (!Number.isInteger(index) || index < 0 || index >= 7 || !quickItemAllowed(itemId)) return undefined;
  return Array.from({length: 7}, (_, i) => i === index ? itemId : bindings[i] === itemId ? null : bindings[i] ?? null);
}
/** Native status->status rebind replaces the destination; it does NOT swap bindings. */
export function moveQuickItem(bindings, from, to, expected = bindings[from]) {
  if (!Number.isInteger(from) || from < 0 || from >= 7 || !quickItemAllowed(expected)
      || bindings[from] !== expected) return undefined;
  return bindQuickItem(bindings, to, expected);
}
/** 463F10: clear the template binding, never move/throw away its bag stack. */
export function clearQuickItem(bindings, index, expected = bindings[index]) {
  if (!Number.isInteger(index) || index < 0 || index >= 7 || !quickItemAllowed(expected)
      || bindings[index] !== expected) return undefined;
  return Array.from({length:7}, (_,i) => bindings[i] === expected ? null : bindings[i] ?? null);
}
/** 4FC180 sums ALL matching USE stacks; 512570 uses the first positive bag slot. */
export function quickItemState(inventory, itemId) {
  if (!quickItemAllowed(itemId)) return { quantity: 0, item: undefined };
  const items = inventory?.tabs?.find(t => t.tab === 2)?.items ?? [];
  let quantity = 0, first;
  for (const item of items) {
    if (item.itemId !== itemId || !(item.slot > 0) || !(item.quantity > 0)) continue;
    quantity += item.quantity;
    if (!first || item.slot < first.slot) first = item;
  }
  return { quantity, item: first };
}
/** Local browser profile replaces native CConfig's local registry, NOT a character migration. */
export function quickItemProfile(storage, owner) {
  const key = `kms111.quickItems.${owner}`;
  let bindings = Array(7).fill(null);
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (Array.isArray(saved)) for (let i=0; i<7; i++) {
      if (quickItemAllowed(saved[i]) && !bindings.includes(saved[i])) bindings[i] = saved[i];
    }
  } catch {} // A blocked or corrupt profile must never prevent entering the field.
  const save = (next) => {
    if (!next) return false;
    bindings = next;
    try { storage?.setItem(key, JSON.stringify(bindings)); } catch {}
    return true;
  };
  return {
    values: () => [...bindings],
    move(from, to, expected = bindings[from]) { return save(moveQuickItem(bindings, from, to, expected)); },
    clear(index, expected = bindings[index]) { return save(clearQuickItem(bindings, index, expected)); },
    bind(index, itemId) {
      return save(bindQuickItem(bindings, index, itemId));
    },
  };
}
