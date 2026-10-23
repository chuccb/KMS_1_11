/**
 * The drops of one field: what a killed monster leaves behind, where it lies, and when it goes away.
 *
 * SERVER-OWNED WORLD STATE, WITH DISTINCT CLIENT INPUTS
 * ----------------------------------------------------
 * The client does send player-initiated drop inputs: `0x17 toSlot = 0` throws an item and c2s `0x1F`
 * throws mesos. It has no request to pick up a ground drop, and no request that selects monster loot.
 * The `CRewardPool` packets `0x43`/`0x44` are server -> client (FINDINGS §4.18): this module owns the
 * field's ground records, the repo's monster-loot policy, pickup eligibility/ownership and expiry.
 * `0x43` makes a drop appear; `0x44 kind 2` makes it fly to the taker (and plays the pickup sound on
 * their own client); `0x0B` puts an item in inventory; `0x11` prints the gain notice. Player item/meso
 * throw inputs are decoded and validated separately before creating placed (`kind 2`) field drops.
 *
 * WHAT THE ARCHIVE DOES AND DOES NOT PROVE
 * ----------------------------------------
 * `Item/Etc/0400.img` contains named item assets, not monster-to-item drop records. The read-only,
 * per-image traversal in `tools/audit-drop-evidence.ts` finds 28 `Mob/*.img` templates, no drop-like
 * property under their `info` nodes, and only `Sound/Game.img[0]/DropItem` among archive-wide
 * drop/loot/meso/money/expiry/lifetime/chance property names. The item names can motivate a policy
 * association, but they do not prove what any monster drops. `MOB_JUNK_ITEM_BY_TEMPLATE_ID` and
 * `POTION_BY_LEVEL` are this repository's explicit choices; their item ids and names are checked
 * against WZ, while their associations and level bands are not recovered original-server data.
 *
 * The rates, meso formula, lifetime, spread, and pickup reach also lived on the missing 2003 server.
 * They remain named, replaceable repository policy (`DropFieldOptions.policy` and field options), not
 * claims about original behavior. The native executable does establish the client packet lifecycle:
 * kind 1 is used here for persistent monster drops, kind 0 is transient client-owned animation, and
 * the trailing signed s16 is an animation-start offset. See FINDINGS §4.18 and ADR-155.
 *
 * Server loot has its own cryptographically secure random source, independent of the client's `0x16`
 * streams. `DropFieldOptions.random` is injectable for deterministic tests and explicit deployments;
 * no client seed, damage stream, or client PRNG state controls which loot this server selects.
 */
import { randomInt } from "node:crypto";
import { DROP_KIND, encodeDropAppear, type DropAppear } from "../protocol/drop.ts";
import type { ItemSlot } from "../protocol/itemslot.ts";
import type { FootholdSegments } from "../wz/archive.ts";
import { DropLandingIndex, type DropOrigin } from "./drop-landing.ts";

/** Repository policy: chance (out of 1000) that a killed monster leaves mesos. */
export const MESO_DROP_CHANCE_PER_MILLE = 600;

/** Repository policy: upper bound of the meso roll, `1 + range(0, level * MESO_PER_LEVEL)`. */
export const MESO_PER_LEVEL = 3;

/** Repository policy: chance (out of 1000) to roll a configured junk-item candidate. */
export const MOB_JUNK_CHANCE_PER_MILLE = 300;

/** Repository policy: chance (out of 1000) that a killed monster leaves a potion. */
export const MOB_POTION_CHANCE_PER_MILLE = 50;

/** Repository policy for the signed `0x43` animation-start offset; not a recovered server value. */
export const DROP_ANIMATION_START_OFFSET_MS = 0;

/**
 * Repository policy: time a server-owned ground drop lasts before `0x44 kind 0` removes it.
 * This 300-second field lifetime is unrelated to the client's kind-0 animation cleanup guard (3 s).
 */
export const DROP_LIFETIME_MS = 300_000;

/** Repository policy: how far from the monster a drop may land, in px. */
export const DROP_SPREAD_PX = 24;

/** Repository policy: how close a player has to be for the field to hand them a drop. */
export const PICKUP_RANGE_PX = 40;

/** Repository policy: vertical reach for a pickup, in px. */
export const PICKUP_RANGE_Y_PX = 60;

/**
 * Repository policy candidates for a mob's ordinary item drop, keyed by `Mob/*.img` template id.
 *
 * This is not an extracted WZ table. The per-image audit finds no drop table or drop-like field in
 * the 28 Mob images. IDs and displayed names resolve to `Mob/*.img/info/name` and
 * `Item/Etc/0400.img/<itemId>/info/name`, but those names alone do not prove a monster-to-item
 * association (especially across related mob families). The seven unmapped templates are deliberate:
 * Stump, Dark Stump, Axe Stump, Dark Axe Stump, Yoyo, Small Bat, and Minotaur. Do not infer an
 * original drop from this policy map.
 */
export const MOB_JUNK_ITEM_BY_TEMPLATE_ID: Readonly<Record<number, number>> = {
  100100: 4000019, // 달팽이 -> 달팽이의 껍질
  100101: 4000000, // 파란 달팽이 -> 파란 달팽이의 껍질
  130101: 4000016, // 빨간 달팽이 -> 빨간 달팽이의 껍질
  120100: 4000011, // 스포아 -> 버섯의 포자
  1210102: 4000001, // 주황버섯 -> 주황 버섯의 갓
  1110100: 4000012, // 초록버섯 -> 초록 버섯의 갓
  2220100: 4000009, // 파란 버섯 -> 파란 버섯의 갓
  2110200: 4000015, // 뿔버섯 -> 뿔버섯의 갓
  2230101: 4000008, // 좀비 버섯 -> 죽은 자의 부적
  210100: 4000004, // 슬라임 -> 물컹물컹한 액체
  1120100: 4000006, // 옥토퍼스 -> 옥토퍼스의 다리
  1210100: 4000002, // 돼지 -> 돼지의 리본
  1210101: 4000017, // 리본 돼지 -> 돼지의 머리
  2230102: 4000020, // 와일드보어 -> 와일드보어의 송곳니
  3210100: 4000020, // 파이어보어 -> the same tusk (the item names the family)
  2230100: 4000007, // 이블아이 -> 이블아이의 꼬리
  3230100: 4000013, // 커즈아이 -> 커즈아이의 꼬리
  4230100: 4000023, // 콜드아이 -> 콜드아이의 꼬리
  4130100: 4000014, // 카파 드레이크 -> 드레이크의 머리뼈
  5130100: 4000014, // 드레이크 -> 드레이크의 머리뼈
  5130101: 4000022, // 스톤골렘 -> 스톤골렘의 돌조각
};

/**
 * Which potion a monster of a given level may leave, out of `Item/Consume/0200.img`:
 * `02000000 빨간 포션` (hp 50, price 25), `02000003 파란 포션` (mp 100, price 100),
 * `02000001 주황 포션` (hp 150, price 80), `02000002 하얀 포션` (hp 300, price 160).
 *
 * A **repository choice**, like the odds: these four items' names/prices are in the archive, while
 * the level bands and their association with mob levels are policy (pinned in `drop.test.ts`). This
 * table is not an exhaustive WZ consumable list or evidence of the original server's potion drops.
 * Choosing another category such as `0500`/`0201` would be a different, equally unproven policy.
 */
export const POTION_BY_LEVEL: readonly { upToLevel: number; itemId: number }[] = [
  { upToLevel: 9, itemId: 2000000 }, // 빨간 포션 (hp 50, 25 mesos)
  { upToLevel: 19, itemId: 2000003 }, // 파란 포션 (mp 100, 100 mesos)
  { upToLevel: 34, itemId: 2000001 }, // 주황 포션 (hp 150, 80 mesos)
  { upToLevel: Infinity, itemId: 2000002 }, // 하얀 포션 (hp 300, 160 mesos)
];

/** The random operations used by server-side loot policy; this is not the client's `0x16` stream. */
export interface RandomSource {
  /** One unsigned 32-bit value. */
  next(): number;
  /** For positive `span`, an integer in `[lo, lo + span)`; for zero, one raw value. */
  range(lo: number, span: number): number;
}

/** A fresh field-local source, independent of all client seeds and client-side random streams. */
function createServerDropRandom(): RandomSource {
  const next = () => randomInt(0, 0x1_0000_0000);
  return {
    next,
    range(lo, span) {
      if (!Number.isInteger(lo) || !Number.isInteger(span) || span < 0) {
        throw new RangeError(`invalid loot random range: lo=${lo}, span=${span}`);
      }
      return span === 0 ? next() : lo + randomInt(span);
    },
  };
}

/** The monster a drop came out of. */
export interface DropSource {
  /** Its id inside the field: the `0x43` lookup key for the drop's own flight animation. */
  mobId: number;
  /** `Mob/<id>.img`, i.e. which monster it is. */
  templateId: number;
  /** `info/name` (Korean, e.g. `달팽이`). */
  name: string;
  /** `info/level`; scales the meso roll. */
  level: number;
  /** Where it died; the drop lands near here. */
  x: number;
  y: number;
  /** Last support hint; airborne origins still select the first actual floor below. */
  foothold: number;
}

/** What a player threw away: the item, how many of it, and where they stood. */
export interface DropThrow extends DropOrigin {
  /** The item that leaves the inventory, exactly as it was (`Item/*.img` or `Character/<type>/`). */
  slot: ItemSlot;
  /** How many left the slot; zero is a real depleted 207 set, never more than the stack had. */
  count: number;
}

/** One thing a monster leaves behind. `money` and `itemId` are alternatives, as in `0x43`. */
export interface DropRoll {
  /** An amount of mesos. */
  money?: number;
  /** An item id that exists in the client's `Item/*.img` (or it renders as nothing). */
  itemId?: number;
  /** Stack size; 1 when omitted. */
  count?: number;
}

/** Decides a monster's loot. Called once per kill with the field's generator. */
export type DropPolicy = (source: DropSource, random: RandomSource) => DropRoll[];

/** The shipped policy: mesos, the monster's own junk item, and a potion - one roll each. */
export function defaultDropPolicy(source: DropSource, random: RandomSource): DropRoll[] {
  const rolls: DropRoll[] = [];
  if (random.range(0, 1000) < MESO_DROP_CHANCE_PER_MILLE) {
    const span = Math.max(1, Math.round(source.level * MESO_PER_LEVEL));
    rolls.push({ money: 1 + random.range(0, span) });
  }
  if (random.range(0, 1000) < MOB_JUNK_CHANCE_PER_MILLE) {
    const itemId = MOB_JUNK_ITEM_BY_TEMPLATE_ID[source.templateId];
    if (itemId !== undefined) rolls.push({ itemId, count: 1 });
  }
  if (random.range(0, 1000) < MOB_POTION_CHANCE_PER_MILLE) {
    const band =
      POTION_BY_LEVEL.find((entry) => source.level <= entry.upToLevel) ?? POTION_BY_LEVEL[0]!;
    rolls.push({ itemId: band.itemId, count: 1 });
  }
  return rolls;
}

/**
 * One drop lying in a field.
 *
 * `kind` is the `0x43` shape this drop uses. `fromMob` carries the monster block and sets the
 * client's no-local-cleanup flag, so this server's persistent monster loot waits for `0x44`; `placed`
 * has no monster block and starts at its ground point. The client also understands transient kind 0,
 * but the server does not use it for persistent ground entries.
 */
export interface DropEntry {
  /** The `0x43`/`0x44` pool key; unique inside the field, handed out from 1. */
  dropId: number;
  /** `DROP_KIND.fromMob` for persistent monster loot; `DROP_KIND.placed` for a throw-away. */
  kind: number;
  /**
   * The item itself, for a drop a player threw: the ground keeps the object rather than only its id,
   * so picking it back up gives back the same weapon (scrolls and all). A monster's loot has no
   * template - there is no item yet, only a roll (`spawnFromDeath`).
   */
  slot?: ItemSlot;
  /** `true` = `amount` mesos, `false` = `itemId`. */
  money: boolean;
  /** Meso amount (`money`), else 0. */
  amount: number;
  /** Item id (`!money`), else 0. */
  itemId: number;
  /** Stack size of the item; 1 for mesos. */
  count: number;
  /** Authoritative ground point; never an icon origin or a death animation height. */
  x: number;
  y: number;
  /** Real supporting floor; 0 only when the map has no usable ground. Not sent in 0x43. */
  foothold: number;
  /** The monster it fell out of: the `0x43` block, and the start of the client's flight animation. */
  mobId: number;
  mobX: number;
  mobY: number;
  /** When it appeared, for `lifetimeMs`. */
  bornAt: number;
}

export interface DropFieldOptions {
  /** Real ground for all rewards: monster loot, player items and mesos. */
  footholds?: FootholdSegments;
  /** Field-local loot random source; omitted means a fresh server-side crypto source. */
  random?: RandomSource;
  /** Defaults to `defaultDropPolicy`. */
  policy?: DropPolicy;
  /** Defaults to the repository's zero-offset policy (`DROP_ANIMATION_START_OFFSET_MS`). */
  animationStartOffsetMs?: number;
  /** Defaults to `DROP_LIFETIME_MS`. */
  lifetimeMs?: number;
  /** Defaults to `DROP_SPREAD_PX`. */
  spreadPx?: number;
  /** Defaults to `PICKUP_RANGE_PX` / `PICKUP_RANGE_Y_PX`. */
  pickupRangePx?: number;
  pickupRangeY?: number;
}

/**
 * The drops of one field.
 *
 * One per map, owned by the field (`game/world.ts`, ADR-012), so a drop any player sees is the same
 * drop: `dropId` is the field's key, and the `0x44` that takes one away names whoever took it. Nothing
 * here knows about players or packets beyond the three encoders: the caller decides when a drop
 * appears, whether the player at `(x, y)` has it, and what to do with the gain.
 */
export class DropField {
  readonly drops: DropEntry[] = [];
  private readonly options: DropFieldOptions;
  private readonly random: RandomSource;
  private readonly policy: DropPolicy;
  private readonly animationStartOffsetMs: number;
  private readonly lifetimeMs: number;
  private readonly landing: DropLandingIndex;
  private nextDropId = 1;

  constructor(options: DropFieldOptions = {}) {
    this.options = options;
    this.landing = new DropLandingIndex(options.footholds);
    this.random = options.random ?? createServerDropRandom();
    this.policy = options.policy ?? defaultDropPolicy;
    this.animationStartOffsetMs = options.animationStartOffsetMs ?? DROP_ANIMATION_START_OFFSET_MS;
    if (
      !Number.isInteger(this.animationStartOffsetMs) ||
      this.animationStartOffsetMs < -32768 ||
      this.animationStartOffsetMs > 32767
    ) {
      throw new RangeError(
        `drop animation offset must be a signed s16, got ${this.animationStartOffsetMs}`,
      );
    }
    this.lifetimeMs = options.lifetimeMs ?? DROP_LIFETIME_MS;
  }

  /** The drop with this id, or `undefined` (the lookup `0x44` does on the client). */
  drop(dropId: number): DropEntry | undefined {
    return this.drops.find((drop) => drop.dropId === dropId);
  }

  /**
   * Roll a monster's loot and put it on the ground where it died.
   *
   * The drop's x is spread by `spreadPx` (several drops from one kill should not sit on one pixel,
   * and the client animates each of them separately anyway), and its y is the foothold under that x -
   * projecting to a real floor edge over a void. Only a floorless map retains an unresolved y.
   * The *monster's* position is kept too: `0x43` kind 1 sends it so the client animates the drop out
   * of the monster, while the client cleanup flag keeps this ground entry until a server `0x44`.
   */
  spawnFromDeath(source: DropSource, now: number): DropEntry[] {
    const spawned: DropEntry[] = [];
    const spread = this.options.spreadPx ?? DROP_SPREAD_PX;
    for (const roll of this.policy(source, this.random)) {
      const x = source.x + (spread > 0 ? this.random.range(-spread, 2 * spread + 1) : 0);
      const ground = this.landing.resolve(source, x);
      const entry: DropEntry = {
        dropId: this.nextDropId++,
        kind: DROP_KIND.fromMob,
        money: roll.money !== undefined,
        amount: roll.money ?? 0,
        itemId: roll.itemId ?? 0,
        count: roll.money !== undefined ? 1 : Math.max(1, roll.count ?? 1),
        ...ground,
        mobId: source.mobId,
        mobX: source.x,
        mobY: source.y,
        bornAt: now,
      };
      this.drops.push(entry);
      spawned.push(entry);
    }
    return spawned;
  }

  /**
   * Put an item on the ground where the player stands: the throw-away half of the inventory window
   * (`0x17` with `toSlot = 0`, FINDINGS 4.36).
   *
   * No spread and no monster: the packet is the drop's own position, `kind = DROP_KIND.placed`, and
   * the client simply draws it there. The inventory side (how much left the slot) is the caller's -
   * this module only knows the thing on the ground.
   */
  dropFromPlayer(source: DropThrow, now: number): DropEntry {
    const entry: DropEntry = {
      dropId: this.nextDropId++,
      kind: DROP_KIND.placed,
      money: false,
      amount: 0,
      itemId: source.slot.itemId,
      count: source.count, // zero is a real depleted 207 set, not one free charge
      slot: { ...source.slot },
      ...this.landing.resolve(source),
      // No monster block is written for this kind, so the three fields are only here to keep the
      // record's shape the same for every drop.
      mobId: 0,
      mobX: source.x,
      mobY: source.y,
      bornAt: now,
    };
    this.drops.push(entry);
    return entry;
  }

  /** Player money is a placed reward too, not a fake item or a character-specific visual. */
  dropMesosFromPlayer(source: DropOrigin & { amount: number }, now: number): DropEntry {
    const entry: DropEntry = {
      dropId: this.nextDropId++,
      kind: DROP_KIND.placed,
      money: true,
      amount: source.amount,
      itemId: 0,
      count: 1,
      ...this.landing.resolve(source),
      mobId: 0,
      mobX: source.x,
      mobY: source.y,
      bornAt: now,
    };
    this.drops.push(entry);
    return entry;
  }

  /** The `0x43` body of one drop, including the animation offset for monster-shaped kinds. */
  appearBody(entry: DropEntry): DropAppear {
    const body: DropAppear = {
      dropId: entry.dropId,
      kind: entry.kind,
      money: entry.money,
      value: entry.money ? entry.amount : entry.itemId,
      x: entry.x,
      y: entry.y,
    };
    if (entry.kind <= DROP_KIND.fromMob) {
      body.mobId = entry.mobId;
      body.mobX = entry.mobX;
      body.mobY = entry.mobY;
      body.animationStartOffset = this.animationStartOffsetMs;
    }
    return body;
  }

  /** The `0x43` packet of one drop. */
  appearPacket(entry: DropEntry): Uint8Array {
    return encodeDropAppear(this.appearBody(entry));
  }

  /**
   * The drop a player standing at `(x, y)` can take: the nearest one inside the reach, or `undefined`
   * when there is none. "Nearest" is what makes a pile come off one item at a time, in the order the
   * player walked into it.
   *
   * `movedAt` is when that player last moved (or entered the field), and only a drop that was already
   * lying there then can be walked onto. That rule is what makes the two cases work at once: a
   * throw-away lands on the thrower's own feet and must not come back on the next tick, and a monster
   * killed at a player's feet leaves its loot to be *stepped* on. A drop that appears under a player
   * who is standing still is therefore not taken until they move - which is also what gives the client
   * time to draw the item flying out of the monster first.
   */
  reachable(x: number, y: number, movedAt: number): DropEntry | undefined {
    const rangeX = this.options.pickupRangePx ?? PICKUP_RANGE_PX;
    const rangeY = this.options.pickupRangeY ?? PICKUP_RANGE_Y_PX;
    let best: DropEntry | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const drop of this.drops) {
      if (drop.bornAt > movedAt) continue;
      const dx = Math.abs(drop.x - x);
      const dy = Math.abs(drop.y - y);
      if (dx > rangeX || dy > rangeY) continue;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = drop;
      }
    }
    return best;
  }

  /** Remove a drop from the field (the caller has already decided the player takes it). */
  take(entry: DropEntry): DropEntry | undefined {
    const index = this.drops.indexOf(entry);
    if (index < 0) return undefined;
    this.drops.splice(index, 1);
    return entry;
  }

  /** The drops whose lifetime is up: they are removed here, the caller sends their `0x44` kind 0. */
  expired(now: number): DropEntry[] {
    const gone = this.drops.filter((drop) => now - drop.bornAt >= this.lifetimeMs);
    for (const drop of gone) this.take(drop);
    return gone;
  }
}
