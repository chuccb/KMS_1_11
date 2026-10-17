/**
 * The drops of one field: what a killed monster leaves behind, where it lies, and when it goes away.
 *
 * WHY THIS IS SERVER-SIDE, ALL OF IT
 * ----------------------------------
 * A v1.11 client has no drop request and no pickup request: every send site in the binary passes a
 * *literal* opcode and the largest is `51` = `0x33` (FINDINGS 4.13.2), while the reward pool is
 * `0x42`..`0x45` in the server -> client direction (FINDINGS 4.18). So who gets what is this module's
 * decision, and the client only ever *shows* it: `0x43` makes a drop appear, `0x44` kind 2 makes it
 * fly to the taker (and plays the pickup sound on their own client), `0x0B` puts it in their
 * inventory, `0x11` prints the line in chat.
 *
 * WHAT IS EVIDENCE, WHAT IS A CHOICE
 * ----------------------------------
 * `Item/Etc/0400.img` is the junk table and it is *readable*: every entry is named after the monster
 * it comes from (`04000019 달팽이의 껍질` = "snail's shell", `04000022 스톤골렘의 돌조각` = "stone
 * golem's stone piece", `04000023 콜드아이의 꼬리` = "cold eye's tail"). `MOB_JUNK_DROP` below is that
 * pairing - the item names are the evidence, and the ids are the real children of that image. The
 * potions come from `Item/Consume/0200.img` and are handed out by level band, cheapest first by their
 * own `info.price` (25 / 80 / 100 / 160).
 *
 * What is *not* evidence, because it lived on the 2003 server and that server is gone: the rates, the
 * meso amounts, the lifetime, the drop spread and the pickup reach. There is no `drop` node anywhere
 * in `Data.wz` and no table in the client to read them from. They are therefore named constants with
 * one place to change, the same status as `PATROL_SPEED_PX_PER_SEC` in `game/mobs.ts`, and
 * `defaultDropPolicy` is replaceable wholesale (`DropFieldOptions.policy`).
 *
 * Every roll goes through `ClientRandom` - the client's *own* generator (`protocol/random.ts`), whose
 * seeds travel in `0x16`. A seeded field is reproducible in a test, and a field seeded from the seeds
 * it sends is running the same numbers the client would.
 */
import { ClientRandom } from "../protocol/random.ts";
import { DROP_KIND, encodeDropAppear, type DropAppear } from "../protocol/drop.ts";
import type { ItemSlot } from "../protocol/itemslot.ts";
import { footholdChain, footholdYAt, type FootholdSegment, type FootholdSegments } from "../wz/archive.ts";

/** Chance (out of 1000) that a killed monster leaves mesos. */
export const MESO_DROP_CHANCE_PER_MILLE = 600;

/** Upper bound of the meso roll: `1 + range(0, level * MESO_PER_LEVEL)`. */
export const MESO_PER_LEVEL = 3;

/** Chance (out of 1000) that a killed monster leaves its own junk item. */
export const MOB_JUNK_CHANCE_PER_MILLE = 300;

/** Chance (out of 1000) that a killed monster leaves a potion. */
export const MOB_POTION_CHANCE_PER_MILLE = 50;

/** How long a drop lies on the ground before it disappears (as `0x44` kind 0). */
export const DROP_LIFETIME_MS = 300_000;

/** How far from the monster a drop may land, in px. */
export const DROP_SPREAD_PX = 24;

/** How close a player has to be for the field to hand them a drop. */
export const PICKUP_RANGE_PX = 40;

/** How far above/below a player the field still considers them to be on the drop. */
export const PICKUP_RANGE_Y_PX = 60;

/**
 * The junk item each monster leaves behind, straight out of `Item/Etc/0400.img`.
 *
 * The pairing is read off the item names (the archive's own data, not a guess):
 * `04000019 달팽이의 껍질` (snail's shell) for `100100 달팽이` (snail), `04000016 빨간 달팽이의 껍질`
 * for `130101 빨간 달팽이` (red snail), `04000001 주황 버섯의 갓` (orange mushroom's cap) for
 * `1210102 주황버섯`, `04000023 콜드아이의 꼬리` for `4230100 콜드아이`, and so on. The monsters that
 * are missing here (the stumps, the small bat, the minotaur, the two test templates) have no item in
 * this build that names them: `04000003 나뭇가지` / `04000005 나뭇잎` would fit a stump, but nothing
 * in the data says which, so those monsters drop mesos (and, higher up, potions) only.
 */
export const MOB_JUNK_DROP: Readonly<Record<number, number>> = {
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
 * A **server choice**, like the odds: the four items and their names/prices are the archive's, the
 * bands are this repo's, and `test/drop.test.ts` pins them (red for the weakest monsters, then the
 * MP potion, then orange, then white for everything from level 35 up). The whole table is four
 * entries wide because there are exactly four town potions in this build - a `0500`/`0201` drop
 * would be a different, equally unproven decision (see ADR-007).
 */
export const POTION_BY_LEVEL: readonly { upToLevel: number; itemId: number }[] = [
  { upToLevel: 9, itemId: 2000000 }, // 빨간 포션 (hp 50, 25 mesos)
  { upToLevel: 19, itemId: 2000003 }, // 파란 포션 (mp 100, 100 mesos)
  { upToLevel: 34, itemId: 2000001 }, // 주황 포션 (hp 150, 80 mesos)
  { upToLevel: Infinity, itemId: 2000002 }, // 하얀 포션 (hp 300, 160 mesos)
];

/** The only thing a policy needs from a generator (`ClientRandom` has both). */
export interface RandomSource {
  /** A 32-bit value, as `sub_4619F0` returns it. */
  next(): number;
  /** `lo + next() % span`, as the client's `Random(span, lo)`. */
  range(lo: number, span: number): number;
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
  /** The foothold it died on, so the drop lands on the same ground and not beside it. */
  foothold: number;
}

/** What a player threw away: the item, how many of it, and where they stood. */
export interface DropThrow {
  /** The item that leaves the inventory, exactly as it was (`Item/*.img` or `Character/<type>/`). */
  slot: ItemSlot;
  /** How many left the slot; at least 1, and never more than the stack had. */
  count: number;
  /** Where the thrower stood: the drop's own landing spot. */
  x: number;
  y: number;
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
    const itemId = MOB_JUNK_DROP[source.templateId];
    if (itemId !== undefined) rolls.push({ itemId, count: 1 });
  }
  if (random.range(0, 1000) < MOB_POTION_CHANCE_PER_MILLE) {
    const band = POTION_BY_LEVEL.find((entry) => source.level <= entry.upToLevel) ?? POTION_BY_LEVEL[0]!;
    rolls.push({ itemId: band.itemId, count: 1 });
  }
  return rolls;
}

/**
 * One drop lying in a field.
 *
 * `kind` is the `0x43` shape this drop uses, and it is the drop's *history* rather than its state:
 * `fromMob` carries the monster block (and makes the client animate the item out of the monster),
 * `placed` has no such block at all - which is the only shape a player's throw-away can use
 * (`DROP_KIND.placed`).
 */
export interface DropEntry {
  /** The `0x43`/`0x44` pool key; unique inside the field, handed out from 1. */
  dropId: number;
  /** `DROP_KIND.fromMob` for a killed monster's loot, `DROP_KIND.placed` for a throw-away. */
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
  /** Where it lies. The client draws the icon 16 px above this y, so this is the ground line. */
  x: number;
  y: number;
  /** The monster it fell out of: the `0x43` block, and the start of the client's flight animation. */
  mobId: number;
  mobX: number;
  mobY: number;
  /** When it appeared, for `lifetimeMs`. */
  bornAt: number;
}

export interface DropFieldOptions {
  /** The map's footholds, so a drop lands on the ground under the monster and not beside it. */
  footholds?: FootholdSegments;
  /** The field's generator; a seeded `ClientRandom` makes a session reproducible in a test. */
  random?: RandomSource;
  /** Defaults to `defaultDropPolicy`. */
  policy?: DropPolicy;
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
  private readonly lifetimeMs: number;
  private readonly chains = new Map<number, FootholdSegment[]>();
  private nextDropId = 1;

  constructor(options: DropFieldOptions = {}) {
    this.options = options;
    this.random = options.random ?? new ClientRandom(0x5a17, 0x1d0f, 0x2b3c);
    this.policy = options.policy ?? defaultDropPolicy;
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
   * falling back to the monster's own y when the map has no footholds. The *monster's* position is
   * kept too: that is what `0x43` kind 0 sends, and what makes the client animate the drop out of the
   * monster instead of popping it into existence where it lands.
   */
  spawnFromDeath(source: DropSource, now: number): DropEntry[] {
    const spawned: DropEntry[] = [];
    const spread = this.options.spreadPx ?? DROP_SPREAD_PX;
    for (const roll of this.policy(source, this.random)) {
      const x = source.x + (spread > 0 ? this.random.range(-spread, 2 * spread + 1) : 0);
      const chain = this.chainOf(source.foothold);
      const ground = chain === undefined ? undefined : footholdYAt(chain, x);
      const entry: DropEntry = {
        dropId: this.nextDropId++,
        kind: DROP_KIND.fromMob,
        money: roll.money !== undefined,
        amount: roll.money ?? 0,
        itemId: roll.itemId ?? 0,
        count: roll.money !== undefined ? 1 : Math.max(1, roll.count ?? 1),
        x,
        y: ground ?? source.y,
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
      count: Math.max(1, source.count),
      slot: { ...source.slot },
      x: source.x,
      y: source.y,
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

  /** The `0x43` body of one drop: the monster block only for the kinds that carry it. */
  appearBody(entry: DropEntry): DropAppear {
    const body: DropAppear = {
      dropId: entry.dropId,
      kind: entry.kind,
      money: entry.money,
      value: entry.money ? entry.amount : entry.itemId,
      x: entry.x,
      y: entry.y,
    };
    if (entry.kind <= DROP_KIND.fromMobAlt) {
      body.mobId = entry.mobId;
      body.mobX = entry.mobX;
      body.mobY = entry.mobY;
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

  private chainOf(id: number): FootholdSegment[] | undefined {
    const footholds = this.options.footholds;
    if (footholds === undefined) return undefined;
    if (!this.chains.has(id)) this.chains.set(id, footholdChain(footholds, id));
    const chain = this.chains.get(id);
    return chain === undefined || chain.length === 0 ? undefined : chain;
  }
}
