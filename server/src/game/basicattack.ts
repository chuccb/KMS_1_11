/** Basic attacks only. Native selectors: 427F60 / 427FE0; ammo scan: 511630.
 * Skill costs, Soul Arrow and multi-shot must not be inferred from this one-round path.
 */
import type { CharacterItems } from "../protocol/chardata.ts";
import {
  INVENTORY_OP,
  INVENTORY_TAB,
  type InventoryChange,
} from "../protocol/inventory.ts";
import type { ArtReader } from "./wzart.ts";
import { frameNames, nodeRecord, vectorOf } from "./wzart.ts";
import { spriteFrames, type SpriteFrame } from "./sprites.ts";

/** Attack action ids, NOT the movement action byte. 43FC80 aliases 24..26 to swingO1..3. */
export const BASIC_ATTACK_STANCES: Readonly<Record<number, string>> = {
  5: "swingO1",
  6: "swingO2",
  7: "swingO3",
  9: "swingT1",
  10: "swingT2",
  11: "swingT3",
  13: "swingP1",
  14: "swingP2",
  16: "stabO1",
  17: "stabO2",
  19: "stabT1",
  20: "stabT2",
  22: "shoot1",
  23: "shoot2",
  24: "swingO1",
  25: "swingO2",
  26: "swingO3",
};
// PE VA 005B2144: seven groups, two rows/group, six u32/row; normal rows only.
const MELEE_ACTIONS: Readonly<Record<number, readonly number[]>> = {
  1: [5, 6, 7, 16, 17],
  2: [10, 13, 14, 19, 20],
  3: [9, 11],
  4: [9, 19],
  5: [9, 10, 11, 16, 17],
  6: [6],
  7: [16, 17],
};
// PE VA 005B2294: seven groups, two rows/group, four u32/row.
const SHOOT_ACTIONS: Readonly<Record<number, readonly number[]>> = {
  3: [22],
  4: [23],
  7: [24, 25, 26],
};
export interface BasicAttackAction {
  action: number;
  stance: string;
  /** Already scaled per-frame with integer division by 8 (508700). */
  delays: number[];
  /** Unscaled delays, so a relayed buffed speed does not round an already rounded value. */
  baseDelays: number[];
  /** Native left-facing Afterimage/0 hit rectangle, when the archive supplies it. */
  bounds?: { left: number; top: number; right: number; bottom: number };
  /** Afterimage/0/<stance>/<body frame>/<effect frame>; never the inventory icon. */
  effects: Record<string, SpriteFrame[]>;
}
export interface BasicAttackProfile {
  weaponId: number;
  group: number;
  speed: number;
  melee: BasicAttackAction[];
  shoot: BasicAttackAction[];
}
export type BasicAttackProvider = (
  weaponId: number,
) => BasicAttackProfile | undefined;

export function basicAttackProvider(reader: ArtReader): BasicAttackProvider {
  const cache = new Map<number, BasicAttackProfile | undefined>();
  return (weaponId) => {
    if (cache.has(weaponId)) return cache.get(weaponId);
    if (
      !Number.isInteger(weaponId) ||
      weaponId < 1300000 ||
      weaponId >= 1500000
    )
      return undefined;
    const weapon = `Character/Weapon/${String(weaponId).padStart(8, "0")}.img`;
    const info = nodeRecord(reader.node(`${weapon}/info`));
    const group = typeof info.attack === "number" ? info.attack : 0;
    // The native weapon loader defaults missing attackSpeed to 3, then 4BE8B0 clamps 0..6.
    const speed = Math.max(
      0,
      Math.min(
        6,
        typeof info.attackSpeed === "number" ? Math.trunc(info.attackSpeed) : 3,
      ),
    );
    const actionsOf = (ids: readonly number[]): BasicAttackAction[] =>
      ids.flatMap((action) => {
        const stance = BASIC_ATTACK_STANCES[action];
        if (!stance || !reader.node(`${weapon}/${stance}`)) return [];
        const body = `Character/00002000.img/${stance}`;
        const frames = frameNames(reader.node(body));
        const delays = frames.map(
          (frame) => nodeRecord(reader.node(`${body}/${frame}`)).delay,
        );
        if (
          frames.length === 0 ||
          delays.some((delay) => typeof delay !== "number" || delay <= 0)
        )
          return [];
        const effect =
          typeof info.afterImage === "string"
            ? `Character/Afterimage/${info.afterImage}.img/0/${stance}`
            : undefined;
        const boundsNode: Record<string, unknown> =
          effect === undefined ? {} : nodeRecord(reader.node(effect));
        const lt = vectorOf(boundsNode.lt),
          rb = vectorOf(boundsNode.rb);
        const effects: Record<string, SpriteFrame[]> = {};
        if (effect !== undefined)
          for (const frame of frames) {
            const pictures = spriteFrames(reader, effect, frame, []);
            if (pictures.length > 0) effects[frame] = pictures;
          }
        return [
          {
            action,
            stance,
            baseDelays: delays as number[],
            delays: (delays as number[]).map((delay) =>
              Math.trunc((delay * (speed + 5)) / 8),
            ),
            ...(lt && rb
              ? {
                  bounds: {
                    left: lt[0],
                    top: lt[1],
                    right: rb[0],
                    bottom: rb[1],
                  },
                }
              : {}),
            effects,
          },
        ];
      });
    const profile =
      MELEE_ACTIONS[group] === undefined
        ? undefined
        : {
            weaponId,
            group,
            speed,
            melee: actionsOf(MELEE_ACTIONS[group]!),
            shoot: actionsOf(SHOOT_ACTIONS[group] ?? []),
          };
    cache.set(weaponId, profile);
    return profile;
  };
}

export function isCompatibleAmmo(weaponId: number, itemId: number): boolean {
  switch (Math.trunc(weaponId / 10000)) {
    case 145:
      return Math.trunc(itemId / 1000) === 2060;
    case 146:
      return Math.trunc(itemId / 1000) === 2061;
    case 147:
      return Math.trunc(itemId / 10000) === 207;
    default:
      return false;
  }
}
/** USE slots in numeric order, not Map insertion order; skip zero-charge stars. */
export function firstBasicAmmo(
  items: CharacterItems | undefined,
): { slot: number; itemId: number } | undefined {
  const weaponId = items?.worn.get(11)?.itemId ?? 0;
  const inventory = items?.inventories[INVENTORY_TAB.consume - 1];
  if (!inventory) return undefined;
  for (let slot = 1; slot <= inventory.capacity; slot++) {
    const item = inventory.items.get(slot);
    if (
      item?.kind === "nonequip" &&
      item.quantity >= 1 &&
      isCompatibleAmmo(weaponId, item.itemId)
    )
      return { slot, itemId: item.itemId };
  }
  return undefined;
}
/** Validate before touching the record. The relay must keep itemId even when the last arrow clears. */
export function spendBasicAmmo(
  items: CharacterItems,
  slot: number,
): { itemId: number; change: InventoryChange } | undefined {
  const selected = firstBasicAmmo(items);
  if (!selected || selected.slot !== slot) return undefined;
  const inventory = items.inventories[INVENTORY_TAB.consume - 1]!;
  const item = inventory.items.get(slot);
  if (item?.kind !== "nonequip") return undefined;
  const quantity = item.quantity - 1;
  const clear = quantity === 0 && Math.trunc(item.itemId / 10000) !== 207;
  if (clear) inventory.items.delete(slot);
  else inventory.items.set(slot, { ...item, quantity });
  return {
    itemId: selected.itemId,
    change: clear
      ? { op: INVENTORY_OP.clear, inventory: INVENTORY_TAB.consume, slot }
      : {
          op: INVENTORY_OP.put,
          inventory: INVENTORY_TAB.consume,
          slot,
          item: { ...item, quantity },
        },
  };
}

/** 41BC80 loads the item's own bullet canvases; 207 icons are not projectiles. */
export function basicProjectileFrames(
  reader: ArtReader,
  itemId: number,
): SpriteFrame[] {
  if (![206, 207].includes(Math.trunc(itemId / 10000))) return [];
  const padded = String(itemId).padStart(8, "0");
  return spriteFrames(
    reader,
    `Item/Consume/${padded.slice(0, 4)}.img/${padded}`,
    "bullet",
    [],
  );
}
