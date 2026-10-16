/**
 * The monsters of one field: where they are, and what the server tells the client about them.
 *
 * A mob is **server-driven** here: the positions the client draws are the ones this module decides,
 * handed over as `0x33` legs (FINDINGS 4.16.1). The 2003 client narrates mobs on its own - it sends
 * actions (`0x2C` `sub_4885D0`), state (`0x2F` `sub_49A3C0`) and something about itself (`0x33`
 * `sub_55AF20`, a lone `u32` and a one-shot throttle) - but those numbers live in the *client's*
 * opcode space: none of them is the body of the packets here, and the `0x33` the client sends is not
 * a move (FINDINGS 4.13.2). So the code here is *gameplay*, not protocol: the packets it produces
 * are `protocol/mob.ts`'s `0x2F`/`0x33`/`0x30`/`0x31`/`0x34`.
 *
 * The world model is the map image itself, so the client cannot disagree with us:
 *
 *   `life`            one entry per spawn: template id, x/y, `fh` (foothold), `rx0`/`rx1` (the range
 *                     it is allowed to wander in)
 *   `foothold`        `foothold/<page>/<group>/<item = foothold id>` -> `{x1,y1,x2,y2,prev,next}`:
 *                     the item key *is* `life.fh`, and prev/next chain the segments into the
 *                     polyline the mob walks on
 *   `Mob/<id>.img`    `info` gives the mob's `speed` (a percentage offset: -30 = 70% of normal,
 *                     the client's own clamp is `clamp(0, 100 + speed, 130)` in `sub_48D080`),
 *                     `maxHP`, `level` and `exp`
 *
 * PATROL: a mob walks to the far end of its allowed range, then back, one leg per `0x33` (a leg is a
 * one-element `CMovePath`). The leg's *duration* is what sets the visual speed, because the client
 * simply plays the path it is sent - so `PATROL_SPEED_PX_PER_SEC` below is a server-side choice
 * (documented, not derived from the client: the original server picked it too, and the oracle run is
 * what will tune it). Everything else - the range, the ground, the relative speed - comes from the
 * map and the mob's own WZ entry.
 *
 * ONE OBJECT PER FIELD (`game/world.ts`, ADR-012): the ids, the positions and the hit points belong
 * to the map, not to a connection, so two players in the same map hit the same monster and see the
 * same `0x33` legs.
 *
 * DAMAGE AND DEATH: the packets are `protocol/mob.ts`'s 0x30/0x31/0x34 (that file has the client-side
 * evidence); the numbers behind them are here:
 *
 *   hp / mp    `Mob/<id>.img -> info.maxHP` / `info.maxMP`. The damage itself is whatever the
 *              attacking client reported in its 0x0F - a 2003 client computes its own damage and
 *              draws its own numbers (FINDINGS 4.13.1) - so the server's job is bookkeeping:
 *              subtract, clamp at 0, hand the mob's MP back (`0x34`, which is also what puts the mob
 *              into the state whose hit animation the client then plays) and, once the HP runs out,
 *              start the death sequence.
 *   dieMs      how long the corpse stays: the sum of the frames of the mob's own die action
 *              (`Mob/<id>.img/die1`, `delay` per frame, 180 ms when a frame has none - the client's
 *              own default in `sub_40B530`). `sub_486180` is the client function that adds them up,
 *              and it is also what the client's hit-animation timer uses.
 *   respawnMs  a *server* choice (`MOB_RESPAWN_MS`), like the patrol speed: nothing in the client
 *              says when a monster comes back, so this is the knob. The respawn uses `0x31 flag=1`
 *              rather than `0x2F` because that form makes the client flash the new mob
 *              (`sub_485330(mob, 1)`), which is what "a monster appears in front of you" looks like.
 *
 * A mob whose `Mob/<id>.img` is missing has no HP, no MP and no death length here, so it is left
 * alone - this server does not invent numbers for it. Every mob any shipped map spawns has an image.
 */
import { footholdChain, footholdRange, footholdSegmentAt, footholdYAt } from "../wz/archive.ts";
import type { FootholdSegment, FootholdSegments, WzArchive } from "../wz/archive.ts";
import {
  MOB_ACTION,
  encodeMobAppear,
  encodeMobEnterField,
  encodeMobLeaveDelayed,
  encodeMobMove,
  encodeMobRemove,
  encodeMobStat,
  mobActionByte,
  type MobEnterField,
} from "../protocol/mob.ts";
import { asNumber, entriesOf, infoOf } from "../wz/props.ts";
import { mobImagePath } from "../wz/paths.ts";
import type { LifeSpawn, MapData } from "./map.ts";

/** What the server needs to know about a mob kind, straight out of `Mob/<id>.img -> info`. */
export interface MobTemplate {
  templateId: number;
  /** `info.name` (the WZ string is the Korean name, e.g. 스포아). */
  name: string;
  level: number;
  maxHP: number;
  /** `info.maxMP`. What `0x34` carries (`mob+132` is the MP the attack picker spends). */
  maxMP: number;
  exp: number;
  /**
   * Walking speed as a percentage: `clamp(0, 100 + info.speed, 130)`, the client's own formula
   * (`sub_48D080`, `n130 = clamp(v72 + 100, 0, 130)`). 100 = normal, 130 = the cap, 0 = never moves.
   */
  speedPercent: number;
  /**
   * How long the mob's death animation lasts, in ms: the sum of the frames of the longest of its
   * `die1`/`die2`/`dieF` actions (`sub_486180` does the same sum on the client). `0` when the image
   * has no die action at all - then the client has nothing to play and the corpse can go at once.
   */
  dieMs: number;
}

/** Server-side walking speed for a mob at 100% (see the note at the top: a choice, not a constant). */
export const PATROL_SPEED_PX_PER_SEC = 60;

/** Longest single leg in ms; a long range is walked in short hops instead of one long glide. */
export const PATROL_MAX_LEG_MS = 3000;

/** How long a dead mob stays away before it is spawned again (a server choice, like the speed). */
export const MOB_RESPAWN_MS = 5000;

/**
 * The frame delay the client assumes when a frame has no `delay` of its own: `sub_40B530` loads the
 * mob action frames and falls back to `lVal = 180` (19949 in `MapleStory.exe.c`).
 */
export const MOB_FRAME_DELAY_MS = 180;

/** The die actions a mob image may have, in the order the client's action table names them. */
const MOB_DIE_ACTION_NAMES = ["die1", "die2", "dieF"] as const;

/**
 * The property list of a canvas frame.
 *
 * A frame is a `WzNode` of kind `canvas` whose `value` is the canvas record, so its own properties
 * (the `origin` vector, a `delay`, `lt`/`rb`) sit one level below the entry - unlike every other
 * node, where `props` is the entry's own list.
 */
function canvasEntriesOf(frame: unknown): { name: string; value: unknown }[] {
  const record = (frame as { value?: unknown } | null | undefined)?.value;
  return entriesOf(record);
}

/**
 * `true` for one frame of an action.
 *
 * A frame is a `canvas` entry, or a `uol` entry that points at one - `Mob/5130100.img/die1` ends with
 * a UOL instead of repeating the canvas, and the client resolves it into a real frame, so a frame
 * counter that only counted canvases would come up one short. Numbers (`zigzag`) and nested objects
 * are not frames.
 */
function isFrame(frame: unknown): boolean {
  const kind = (frame as { kind?: unknown } | null | undefined)?.kind;
  return kind === "canvas" || kind === "uol";
}

/**
 * One frame's `delay` in ms, with the client's own fallback when the frame does not say.
 *
 * Only a canvas carries properties, so a UOL frame always takes the fallback - which is what the
 * client does for a frame whose `delay` lookup comes back empty (`sub_40B530`, 19949: `lVal = 180`).
 */
function frameDelayMs(frame: unknown): number {
  const delay = canvasEntriesOf(frame).find((entry) => entry.name === "delay")?.value;
  return typeof delay === "number" ? delay : MOB_FRAME_DELAY_MS;
}

/**
 * How long the mob's death animation runs, from the image itself.
 *
 * The client picks the action at random (`13 + rand() % template+116`, `sub_485530`), so the length
 * to hold a corpse for is the longest of the die actions the image has.
 */
function dieAnimationMs(root: unknown): number {
  let longest = 0;
  for (const name of MOB_DIE_ACTION_NAMES) {
    const action = entriesOf(root).find((entry) => entry.name === name)?.value;
    if (action === undefined) continue;
    let total = 0;
    for (const frame of entriesOf(action)) if (isFrame(frame.value)) total += frameDelayMs(frame.value);
    longest = Math.max(longest, total);
  }
  return longest;
}

/** `Mob/<id>.img -> info`, or `undefined` when the archive has no such mob. */
export function loadMobTemplate(archive: WzArchive, templateId: number): MobTemplate | undefined {
  const path = mobImagePath(templateId);
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  if (root === undefined) return undefined;
  const props = infoOf(root);
  const speed = asNumber(props.speed, 0);
  return {
    templateId,
    name: typeof props.name === "string" ? props.name : "",
    level: asNumber(props.level),
    maxHP: asNumber(props.maxHP),
    maxMP: asNumber(props.maxMP),
    exp: asNumber(props.exp),
    speedPercent: Math.max(0, Math.min(130, 100 + speed)),
    dieMs: dieAnimationMs(root),
  };
}

/** A `templateId -> MobTemplate` cache around `loadMobTemplate`. */
export function mobTemplateProvider(
  archive: WzArchive | undefined,
): (templateId: number) => MobTemplate | undefined {
  const cache = new Map<number, MobTemplate | undefined>();
  return (templateId: number): MobTemplate | undefined => {
    if (archive === undefined) return undefined;
    if (!cache.has(templateId)) cache.set(templateId, loadMobTemplate(archive, templateId));
    return cache.get(templateId);
  };
}

/** One monster in a field. */
export interface FieldMob {
  /** Pool key inside the field; handed out by `MobField` (see FINDINGS 4.15). */
  mobId: number;
  templateId: number;
  template: MobTemplate | undefined;
  spawn: LifeSpawn;
  /** Where the mob is now (the end of the leg it is walking). */
  x: number;
  y: number;
  facing: number;
  /** The foothold the mob stands on (the segment that covers its x). */
  foothold: number;
  /** `+1` walking right, `-1` walking left. */
  direction: 1 | -1;
  /** ms timestamp the current leg ends at; 0 means "no leg in flight". */
  legEndsAt: number;
  /** The x range this mob may walk in: its foothold chain clipped by the spawn's `rx0`/`rx1`. */
  range: { x0: number; x1: number } | undefined;
  /** `true` while it is up; a dying mob is still on the client (`alive` goes false on the kill). */
  alive: boolean;
  /**
   * `info.maxHP`, or `undefined` for a mob whose image is missing - such a mob cannot be hurt, since
   * neither its HP nor its death animation would be known.
   */
  maxHp: number | undefined;
  hp: number | undefined;
  /** `info.maxMP`: what `0x34` reports. `undefined` for a mob without an image, like `maxHp`. */
  maxMp: number | undefined;
  /** ms timestamp the corpse is dropped at (`0x31 flag=0`); 0 while the mob is alive. */
  removeAt: number;
  /** ms timestamp the mob comes back at (`0x31 flag=1`); 0 while the mob is alive. */
  respawnAt: number;
  /** How many times it has died in this session (logs and tests; the client never sees it). */
  deaths: number;
}

export interface MobFieldOptions {
  map: MapData;
  /** The foothold geometry of the map (`WzArchive.footholdSegments`); without it nothing walks. */
  footholds?: FootholdSegments;
  template?: (templateId: number) => MobTemplate | undefined;
  /** Walking speed at 100% in px/s; defaults to `PATROL_SPEED_PX_PER_SEC`. */
  speedPxPerSecond?: number;
  /** Longest leg in ms; defaults to `PATROL_MAX_LEG_MS`. */
  maxLegMs?: number;
  /** How long a dead mob stays away; defaults to `MOB_RESPAWN_MS`. */
  respawnMs?: number;
}

/**
 * What one hit did to one mob, plus the packets that hit has to produce.
 *
 * `packets` is what the connection writes right away: the `0x34` that reports the mob's MP (and puts
 * it into the flash state its hit animation needs) and, on a kill, the `0x30` that starts the die
 * animation. The corpse disappears later - `MobField.lifecyclePackets` hands that packet out when the
 * animation is over.
 */
export interface MobDamage {
  mobId: number;
  templateId: number;
  damage: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  killed: boolean;
  /** ms the corpse will hold its last frame - the die animation's length; 0 when nothing died. */
  dieMs: number;
  /** ms until the mob is spawned again, from this hit; 0 when nothing died. */
  respawnMs: number;
  packets: Uint8Array[];
}

/** The monsters of one map, as this server knows them. */
export class MobField {
  readonly mobs: FieldMob[] = [];
  private readonly options: MobFieldOptions;
  private readonly chains = new Map<number, FootholdSegment[]>();
  private readonly speed: number;
  private readonly maxLegMs: number;
  private readonly respawnMs: number;

  constructor(options: MobFieldOptions) {
    this.options = options;
    this.speed = options.speedPxPerSecond ?? PATROL_SPEED_PX_PER_SEC;
    this.maxLegMs = options.maxLegMs ?? PATROL_MAX_LEG_MS;
    this.respawnMs = options.respawnMs ?? MOB_RESPAWN_MS;
    for (const [index, spawn] of options.map.mobs.entries()) {
      this.mobs.push(this.makeMob(index + 1, index, spawn));
    }
  }

  /** The number of mobs that will actually walk (the rest stand where the map put them). */
  get walking(): number {
    return this.mobs.filter((mob) => mob.alive && mob.range !== undefined && this.speedOf(mob) > 0).length;
  }

  /** The mob with this pool id, or `undefined` (the lookup `sub_492400` does on the client). */
  mob(mobId: number): FieldMob | undefined {
    return this.mobs.find((mob) => mob.mobId === mobId);
  }

  private makeMob(mobId: number, index: number, spawn: LifeSpawn): FieldMob {
    const template = this.options.template?.(spawn.templateId);
    const chain = this.chainOf(spawn.foothold);
    let range: { x0: number; x1: number } | undefined;
    let foothold = spawn.foothold;
    const bounds = chain === undefined ? undefined : footholdRange(chain);
    if (chain !== undefined && bounds !== undefined) {
      // The spawn's own `rx0`/`rx1` are the range the map allows; the chain is the ground that
      // exists. Walk only where both agree, and never outside the segment the mob spawns on.
      const x0 = Math.max(bounds.x0, spawn.rx0);
      const x1 = Math.min(bounds.x1, spawn.rx1);
      if (x1 - x0 >= 2) range = { x0, x1 };
    }
    const y = (chain === undefined ? undefined : footholdYAt(chain, spawn.x)) ?? spawn.y;
    const at = chain === undefined ? undefined : footholdSegmentAt(chain, spawn.x);
    if (at !== undefined) foothold = at.id;
    return {
      mobId,
      templateId: spawn.templateId,
      template,
      spawn,
      x: spawn.x,
      y,
      facing: spawn.facing & 1,
      foothold,
      direction: (spawn.facing & 1) === 1 ? -1 : 1,
      // Stagger the first leg so the spawn burst and the first move burst do not arrive together.
      legEndsAt: index * 250,
      range,
      alive: true,
      maxHp: template?.maxHP,
      hp: template?.maxHP,
      maxMp: template?.maxMP,
      removeAt: 0,
      respawnAt: 0,
      deaths: 0,
    };
  }

  /**
   * Apply one hit to one mob and return what it did, or `undefined` when the hit lands on nothing
   * (an id this field does not have, a mob that is already dying, or a mob with no image - whose HP
   * this server does not know, so it will not pretend to kill it).
   *
   * The damage is the attacking client's own number: a 2003 client rolls, applies and draws its
   * damage before reporting it (FINDINGS 4.13.1), so this server records what it is told - it does
   * not recompute a formula it has no evidence for.
   */
  applyDamage(mobId: number, damage: number, now: number): MobDamage | undefined {
    const mob = this.mob(mobId);
    if (mob === undefined || !mob.alive || mob.hp === undefined || mob.maxHp === undefined) return undefined;
    const maxMp = mob.maxMp ?? 0;
    const dealt = Math.max(0, Math.round(damage));
    mob.hp = Math.max(0, mob.hp - dealt);
    const killed = mob.hp === 0;
    const dieMs = killed ? mob.template?.dieMs ?? 0 : 0;
    const packets: Uint8Array[] = [encodeMobStat({ mobId, mp: maxMp })];
    if (killed) {
      mob.alive = false;
      mob.deaths += 1;
      mob.removeAt = now + dieMs;
      mob.respawnAt = mob.removeAt + this.respawnMs;
      // 0x30 last, so the die action is the one the mob ends up in: the attacker's client already
      // played its hit animation and its damage numbers by the time this arrives.
      packets.push(encodeMobLeaveDelayed({ mobId, delayMs: 0 }));
    }
    return {
      mobId,
      templateId: mob.templateId,
      damage: dealt,
      hp: mob.hp,
      maxHp: mob.maxHp,
      mp: maxMp,
      maxMp,
      killed,
      dieMs,
      respawnMs: killed ? this.respawnMs : 0,
      packets,
    };
  }

  /**
   * Everything the field wants to send at `now`: the walking legs, then the corpse removals and
   * respawns of the mobs that died. One call per timer tick, in one order, so a connection never has
   * to know which half a packet came from.
   */
  tickPackets(now: number): Uint8Array[] {
    return [...this.movePackets(now), ...this.lifecyclePackets(now)];
  }

  /**
   * The packets whose time has come: the corpse of a dead mob goes away once its die animation is
   * over, and the mob comes back as a `0x31 flag=1` (which makes the client flash it) after
   * `respawnMs`. Both timestamps were set by `applyDamage`.
   */
  lifecyclePackets(now: number): Uint8Array[] {
    const packets: Uint8Array[] = [];
    for (const mob of this.mobs) {
      if (mob.alive) continue;
      if (mob.removeAt !== 0 && now >= mob.removeAt) {
        mob.removeAt = 0;
        packets.push(encodeMobRemove(mob.mobId));
      }
      if (mob.respawnAt !== 0 && now >= mob.respawnAt) {
        mob.respawnAt = 0;
        this.resetToSpawn(mob, now);
        packets.push(this.appearPacket(mob));
      }
    }
    return packets;
  }

  /** Put a mob back where the map spawned it (the respawn half of `lifecyclePackets`). */
  private resetToSpawn(mob: FieldMob, now: number): void {
    const chain = this.chainOf(mob.spawn.foothold);
    mob.x = mob.spawn.x;
    mob.y = (chain === undefined ? undefined : footholdYAt(chain, mob.spawn.x)) ?? mob.spawn.y;
    const at = chain === undefined ? undefined : footholdSegmentAt(chain, mob.spawn.x);
    mob.foothold = at?.id ?? mob.spawn.foothold;
    mob.facing = mob.spawn.facing & 1;
    mob.direction = mob.facing === 1 ? -1 : 1;
    mob.legEndsAt = now;
    mob.hp = mob.maxHp;
    mob.alive = true;
  }

  private chainOf(id: number): FootholdSegment[] | undefined {
    const footholds = this.options.footholds;
    if (footholds === undefined) return undefined;
    if (!this.chains.has(id)) this.chains.set(id, footholdChain(footholds, id));
    const chain = this.chains.get(id);
    return chain === undefined || chain.length === 0 ? undefined : chain;
  }

  private speedOf(mob: FieldMob): number {
    // No template means no `info.speed`, i.e. an unknown mob: walk at the normal rate.
    const percent = mob.template?.speedPercent ?? 100;
    return (this.speed * percent) / 100;
  }

  /** The `0x2F` packets that put this field's monsters on screen, in map order. */
  spawnPackets(): Uint8Array[] {
    return this.mobs.filter((mob) => mob.alive).map((mob) => {
      const body: MobEnterField = {
        mobId: mob.mobId,
        templateId: mob.templateId,
        x: mob.x,
        y: mob.y,
        facing: mob.facing,
      };
      return encodeMobEnterField(body);
    });
  }

  /** One `0x31 flag=1` (mob appears) packet for a mob that is standing where it should. */
  appearPacket(mob: FieldMob): Uint8Array {
    return encodeMobAppear(mob.mobId, mob.templateId, {
      x: mob.x,
      y: mob.y,
      facing: mob.facing,
    });
  }

  /**
   * The `0x33` packets that are due at `now`: one leg per mob whose previous leg has ended.
   *
   * A leg is `(x, y, foothold, duration)` - the position the mob is walking to and how long it takes.
   * The client plays it and the mob ends up there, so the server only has to keep handing out legs;
   * a mob that reaches the end of its range turns around on the next leg. A dead mob gets none.
   */
  movePackets(now: number): Uint8Array[] {
    const packets: Uint8Array[] = [];
    for (const mob of this.mobs) {
      if (!mob.alive || mob.range === undefined || now < mob.legEndsAt) continue;
      const speed = this.speedOf(mob);
      if (speed <= 0) continue;
      const chain = this.chainOf(mob.foothold);
      if (chain === undefined) continue;

      const leg = this.planLeg(mob, chain, speed);
      if (leg === undefined) continue;
      mob.x = leg.targetX;
      mob.y = leg.targetY;
      mob.foothold = leg.foothold;
      mob.facing = leg.facing;
      mob.direction = leg.direction;
      mob.legEndsAt = now + leg.duration;

      packets.push(
        encodeMobMove(mob.mobId, {
          actionByte: mobActionByte(MOB_ACTION.move, leg.facing),
          value: 0,
          path: {
            originX: leg.fromX,
            originY: leg.fromY,
            elements: [
              {
                // The client's own path playback (`sub_485330`) never reads `attr`; the filler element
                // the client itself sends on a stale path uses 1. 0 is the neutral "walk" value.
                attr: 0,
                x: leg.targetX,
                y: leg.targetY,
                // `sub_495880` only considers an element worth sending when vx/vy are zero, i.e. a
                // path element is a position snapshot, not a velocity.
                vx: 0,
                vy: 0,
                action: mobActionByte(MOB_ACTION.move, leg.facing),
                foothold: leg.foothold,
                duration: leg.duration,
              },
            ],
          },
        }),
      );
    }
    return packets;
  }

  /** Where the next leg goes: the far end of the range, or as far as one leg may last. */
  private planLeg(
    mob: FieldMob,
    chain: FootholdSegment[],
    speed: number,
  ): {
    fromX: number;
    fromY: number;
    targetX: number;
    targetY: number;
    foothold: number;
    facing: number;
    direction: 1 | -1;
    duration: number;
  } | undefined {
    const range = mob.range;
    if (range === undefined) return undefined;
    let direction = mob.direction;
    let end = direction > 0 ? range.x1 : range.x0;
    if (Math.abs(end - mob.x) < 1) {
      // Standing on the end it was walking to: turn around and walk back (this is the whole patrol -
      // a mob that reached the edge of its range does not stop there).
      direction = direction > 0 ? -1 : 1;
      end = direction > 0 ? range.x1 : range.x0;
    }
    const distance = Math.abs(end - mob.x);
    const reachable = (speed * this.maxLegMs) / 1000;
    const step = Math.min(distance, reachable);
    if (step < 1) return undefined;
    const targetX = Math.round(mob.x + Math.sign(end - mob.x) * step);
    const targetY = footholdYAt(chain, targetX);
    const segment = footholdSegmentAt(chain, targetX);
    if (targetY === undefined || segment === undefined) return undefined;
    const duration = Math.max(1, Math.min(0xffff, Math.round((step / speed) * 1000)));
    return {
      fromX: Math.round(mob.x),
      fromY: Math.round(mob.y),
      targetX,
      targetY,
      foothold: segment.id,
      // 0 = facing right, 1 = facing left (`CMob::Init` keeps only bit 0).
      facing: direction > 0 ? 0 : 1,
      direction,
      duration,
    };
  }
}
