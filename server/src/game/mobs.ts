/**
 * The monsters of one field: where they are, and what the server tells the client about them.
 *
 * A mob in this game is **server-driven** - there is no "mob moved" packet on the client -> server
 * side (FINDINGS 4.5 lists all 39 senders; nothing in the 0x2E-0x37 family appears), so the positions
 * the client draws are the ones this module decides. That is why the code here is *gameplay*, not
 * protocol: the packets it produces are `0x2F` (`protocol/mob.ts`) and `0x33` (the move).
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
 * ONE FIELD PER CONNECTION: this class owns its ids and its positions, so two players in the same map
 * today each get their own copy of the monsters (ADR-001's shared world is a later step: whoever owns
 * a `MobField` per map also owns the mob's hit points, which do not exist here yet).
 */
import { footholdChain, footholdRange, footholdSegmentAt, footholdYAt } from "../wz/archive.ts";
import type { FootholdSegment, FootholdSegments, WzArchive } from "../wz/archive.ts";
import {
  MOB_ACTION,
  encodeMobEnterField,
  encodeMobMove,
  mobActionByte,
  type MobEnterField,
} from "../protocol/mob.ts";
import { mobImagePath } from "../wz/paths.ts";
import type { LifeSpawn, MapData } from "./map.ts";

/** What the server needs to know about a mob kind, straight out of `Mob/<id>.img -> info`. */
export interface MobTemplate {
  templateId: number;
  /** `info.name` (the WZ string is the Korean name, e.g. 스포아). */
  name: string;
  level: number;
  maxHP: number;
  exp: number;
  /**
   * Walking speed as a percentage: `clamp(0, 100 + info.speed, 130)`, the client's own formula
   * (`sub_48D080`, `n130 = clamp(v72 + 100, 0, 130)`). 100 = normal, 130 = the cap, 0 = never moves.
   */
  speedPercent: number;
}

/** Server-side walking speed for a mob at 100% (see the note at the top: a choice, not a constant). */
export const PATROL_SPEED_PX_PER_SEC = 60;

/** Longest single leg in ms; a long range is walked in short hops instead of one long glide. */
export const PATROL_MAX_LEG_MS = 3000;

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/** `Mob/<id>.img -> info`, or `undefined` when the archive has no such mob. */
export function loadMobTemplate(archive: WzArchive, templateId: number): MobTemplate | undefined {
  const path = mobImagePath(templateId);
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  if (root === undefined) return undefined;
  const info = root.props.find((entry) => entry.name === "info")?.value;
  const props: Record<string, unknown> = {};
  if (info !== undefined && typeof info === "object" && info !== null && "props" in info) {
    for (const entry of (info as { props: { name: string; value: unknown }[] }).props) {
      props[entry.name] = entry.value;
    }
  }
  const speed = asNumber(props.speed, 0);
  return {
    templateId,
    name: typeof props.name === "string" ? props.name : "",
    level: asNumber(props.level),
    maxHP: asNumber(props.maxHP),
    exp: asNumber(props.exp),
    speedPercent: Math.max(0, Math.min(130, 100 + speed)),
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
}

/** The monsters of one map, as this server knows them. */
export class MobField {
  readonly mobs: FieldMob[] = [];
  private readonly options: MobFieldOptions;
  private readonly chains = new Map<number, FootholdSegment[]>();
  private readonly speed: number;
  private readonly maxLegMs: number;

  constructor(options: MobFieldOptions) {
    this.options = options;
    this.speed = options.speedPxPerSecond ?? PATROL_SPEED_PX_PER_SEC;
    this.maxLegMs = options.maxLegMs ?? PATROL_MAX_LEG_MS;
    for (const [index, spawn] of options.map.mobs.entries()) {
      this.mobs.push(this.makeMob(index + 1, index, spawn));
    }
  }

  /** The number of mobs that will actually walk (the rest stand where the map put them). */
  get walking(): number {
    return this.mobs.filter((mob) => mob.range !== undefined && this.speedOf(mob) > 0).length;
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
    };
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
    return this.mobs.map((mob) => {
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

  /**
   * The `0x33` packets that are due at `now`: one leg per mob whose previous leg has ended.
   *
   * A leg is `(x, y, foothold, duration)` - the position the mob is walking to and how long it takes.
   * The client plays it and the mob ends up there, so the server only has to keep handing out legs;
   * a mob that reaches the end of its range turns around on the next leg.
   */
  movePackets(now: number): Uint8Array[] {
    const packets: Uint8Array[] = [];
    for (const mob of this.mobs) {
      if (mob.range === undefined || now < mob.legEndsAt) continue;
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
