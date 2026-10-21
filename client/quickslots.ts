export interface QuickItem {
  itemId: number;
  slot: number;
  quantity?: number;
}
export interface QuickInventory {
  tabs: { tab: number; items: QuickItem[] }[];
}
export interface QuickSkillBinding {
  kind: "skill";
  skillId: number;
}
export type QuickBinding = number | QuickSkillBinding | null;
export interface QuickStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
import { activeSkill } from "./active-skills.ts";
import { SLOT_SIZE } from "./slot.ts";
/** Seven original slots: PE 5BCEC0 / 4FC960 / 4FC9F0 and 511E20's VK dispatch table.
 * Ctrl attacks and Alt jumps; neither is one of these seven configurable slots.
 */
export const QUICK_SLOTS: readonly { key: string; x: number; y: number }[] = Object.freeze([
  { key: "Shift", x: 753, y: 490 },
  { key: "Insert", x: 692, y: 527 },
  { key: "Home", x: 728, y: 527 },
  { key: "PageUp", x: 764, y: 527 },
  { key: "Delete", x: 692, y: 564 },
  { key: "End", x: 728, y: 564 },
  { key: "PageDown", x: 764, y: 564 },
]);
export function quickSlotAt(x: number, y: number): number {
  return QUICK_SLOTS.findIndex(
    (s) => x >= s.x && x < s.x + SLOT_SIZE && y >= s.y && y < s.y + SLOT_SIZE,
  );
}

/** 4FC440: a quick-slot icon is anchored by its origin, NOT centred - left = slot.x - originX,
 * top = slot.y + SLOT_SIZE - originY (`n245 = v41 - v46 + 32`, `MapleStory.exe.c:257805`). The
 * SLOT_SIZE is the slot's own height, so an icon whose origin sits at the usual `oy = 32` bottom
 * lands flush with the slot's top edge. */
export function quickSlotIconOrigin(
  slot: { x: number; y: number },
  icon: { ox?: number; oy?: number } | undefined,
): { x: number; y: number } {
  return { x: slot.x - (icon?.ox ?? 0), y: slot.y + SLOT_SIZE - (icon?.oy ?? SLOT_SIZE) };
}

/** The skill icon the bar asks for: `Skill/<job block>.img/skill/<id>/icon`. */
export function skillIconPath(skillId: number): string {
  return `Skill/${Math.trunc(skillId / 10000)}.img/skill/${skillId}/icon`;
}
export function quickItemAllowed(id: unknown): boolean {
  return (
    typeof id === "number" &&
    Number.isInteger(id) &&
    [200, 201, 202].includes(Math.floor(id / 10000))
  );
}
export const quickSkillAllowed = (binding: unknown): binding is QuickSkillBinding =>
  !!binding &&
  typeof binding === "object" &&
  "kind" in binding &&
  binding.kind === "skill" &&
  "skillId" in binding &&
  typeof binding.skillId === "number" &&
  !!activeSkill(binding.skillId);
const allowed = (binding: unknown): binding is Exclude<QuickBinding, null> =>
  quickItemAllowed(binding) || quickSkillAllowed(binding);
const same = (a: unknown, b: unknown) =>
  a === b || (quickSkillAllowed(a) && quickSkillAllowed(b) && a.skillId === b.skillId);
/** 463DF0: binding by template ID, remove duplicates, no inventory move/consumption packet. */
export function bindQuickItem(
  bindings: readonly QuickBinding[],
  index: number,
  itemId: Exclude<QuickBinding, null>,
): QuickBinding[] | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= 7 || !allowed(itemId)) return undefined;
  return Array.from({ length: 7 }, (_, i) =>
    i === index ? itemId : same(bindings[i], itemId) ? null : (bindings[i] ?? null),
  );
}
/** Native status->status rebind replaces the destination; it does NOT swap bindings. */
export function moveQuickItem(
  bindings: readonly QuickBinding[],
  from: number,
  to: number,
  expected: QuickBinding = bindings[from],
): QuickBinding[] | undefined {
  if (
    !Number.isInteger(from) ||
    from < 0 ||
    from >= 7 ||
    !allowed(expected) ||
    !same(bindings[from], expected)
  )
    return undefined;
  return bindQuickItem(bindings, to, expected);
}
/** 463F10: clear the template binding, never move/throw away its bag stack. */
export function clearQuickItem(
  bindings: readonly QuickBinding[],
  index: number,
  expected: QuickBinding = bindings[index],
): QuickBinding[] | undefined {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 7 ||
    !allowed(expected) ||
    !same(bindings[index], expected)
  )
    return undefined;
  return Array.from({ length: 7 }, (_, i) =>
    same(bindings[i], expected) ? null : (bindings[i] ?? null),
  );
}
/** 4FC180 sums ALL matching USE stacks; 512570 uses the first positive bag slot. */
export function quickItemState(
  inventory: QuickInventory | undefined,
  itemId: number,
): { quantity: number; item: QuickItem | undefined } {
  if (!quickItemAllowed(itemId)) return { quantity: 0, item: undefined };
  const items = inventory?.tabs?.find((t) => t.tab === 2)?.items ?? [];
  let quantity = 0,
    first;
  for (const item of items) {
    if (
      item.itemId !== itemId ||
      !(item.slot > 0) ||
      !(item.quantity !== undefined && item.quantity > 0)
    )
      continue;
    quantity += item.quantity;
    if (!first || item.slot < first.slot) first = item;
  }
  return { quantity, item: first };
}
/** Local browser profile replaces native CConfig's local registry, NOT a character migration. */
export function quickItemProfile(
  storage: QuickStorage | undefined,
  owner: string,
): {
  values(): QuickBinding[];
  bind(index: number, itemId: Exclude<QuickBinding, null>): boolean;
  move(from: number, to: number, expected?: QuickBinding): boolean;
  clear(index: number, expected?: QuickBinding): boolean;
} {
  const key = `kms111.quickItems.${owner}`;
  let bindings: QuickBinding[] = Array<QuickBinding>(7).fill(null);
  try {
    const saved: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (Array.isArray(saved))
      for (let i = 0; i < 7; i++) {
        if (allowed(saved[i]) && !bindings.some((b) => same(b, saved[i]))) bindings[i] = saved[i];
      }
  } catch {} // A blocked or corrupt profile must never prevent entering the field.
  const save = (next: QuickBinding[] | undefined) => {
    if (!next) return false;
    bindings = next;
    try {
      storage?.setItem(key, JSON.stringify(bindings));
    } catch {}
    return true;
  };
  return {
    values: () => [...bindings],
    move(from, to, expected = bindings[from]) {
      return save(moveQuickItem(bindings, from, to, expected));
    },
    clear(index, expected = bindings[index]) {
      return save(clearQuickItem(bindings, index, expected));
    },
    bind(index, itemId) {
      return save(bindQuickItem(bindings, index, itemId));
    },
  };
}
