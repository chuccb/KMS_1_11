/**
 * The NPCs of one field: the ones the map's `life` list asks for, and the packets that put them
 * there.
 *
 * An NPC is **not** server-driven the way a mob is (`game/mobs.ts`): it has no hit points, no patrol
 * and no state the server has to keep in step, because the client owns everything an NPC does -
 * standing still and animating. What the server owns is *which* NPCs exist in the field, which is
 * exactly what `0x39` says (FINDINGS 4.19): `life` entries of type `n` become one packet each, and
 * the client does the rest. So this module is small on purpose.
 *
 * The one thing that *can* be said about an NPC after it exists is `0x3B` (FINDINGS 4.28): `flag = 1`
 * tells the client to **walk that NPC itself** (`sub_499760(vecctrl, 1)` moves it inside bounds the
 * client already has and re-picks a destination every 4-12 s of its own), `flag = 0` stops it. There
 * is no timer on this side and nothing to keep in step - which is why the walk here is a *policy*
 * (`walk`, turned on and off with `setWalking`) instead of a simulation. Which NPCs the 2003 server
 * walked is not located, so the default is nobody: the mechanism is the client's, the choice is ours.
 *
 * The template check is the one thing worth doing carefully: `Npc/<7-digit id>.img` has to exist,
 * because the client builds the NPC from it (`sub_49CB30` -> `sub_498A20`). A `life` entry whose id
 * has no image is skipped and reported, instead of being sent as a packet that would make the client
 * look up a file that is not there - the same rule `game/mobs.ts` applies to mobs.
 *
 * ONE OBJECT PER FIELD (`game/world.ts`): the ids are the field's own, handed out once, and every
 * player in the map is sent the same packets - `enterPackets` is the snapshot a joining player gets.
 */
import type { WzArchive } from "../wz/archive.ts";
import { asText, infoOf } from "../wz/props.ts";
import { npcImagePath } from "../wz/paths.ts";
import {
  encodeNpcEnterField,
  encodeNpcLeaveField,
  encodeNpcState,
  type NpcEnterField,
} from "../protocol/npc.ts";
import type { LifeSpawn } from "./map.ts";

/** What the server knows about an NPC kind, straight out of `Npc/<id>.img`. */
export interface NpcTemplate {
  templateId: number;
  /** `info.name` (the Korean name the client shows, e.g. 헤네시스). */
  name: string;
}

/** One NPC standing in the field. */
export interface NpcEntry {
  /** The `0x39`/`0x3A`/`0x3B` pool key; unique inside the field, handed out from 1. */
  npcId: number;
  /** `life.id`, i.e. which `Npc/<id>.img` the client draws. */
  templateId: number;
  /** `info.name` when the template can be read, else `""`. */
  name: string;
  x: number;
  y: number;
  facing: number;
  /** `true` while the NPC is in the client's pool (i.e. between `0x39` and `0x3A`). */
  present: boolean;
  /**
   * The `0x3B` flag as the client reads it: `true` means "you walk this one" (FINDINGS 4.28). The
   * wire field is a bit of the NPC's state byte, so what this field is *named* is the meaning.
   */
  walking: boolean;
}

/**
 * `Npc/<id>.img -> info.name`, or `undefined` when the image does not exist.
 *
 * A map's `life` list is *the map's* promise that the file is there, so a miss is a data problem
 * worth reporting - the caller decides what to do about it, this function only reads.
 */
export function npcTemplateFrom(archive: WzArchive, templateId: number): NpcTemplate | undefined {
  const path = npcImagePath(templateId);
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  const info = infoOf(root);
  return { templateId, name: asText(info.name) };
}

/** Caches `npcTemplateFrom` per id, the way `mobTemplateProvider` does for mobs. */
export function npcTemplateProvider(archive: WzArchive): (templateId: number) => NpcTemplate | undefined {
  const cache = new Map<number, NpcTemplate | undefined>();
  return (templateId: number) => {
    if (!cache.has(templateId)) cache.set(templateId, npcTemplateFrom(archive, templateId));
    return cache.get(templateId);
  };
}

/**
 * `--npc-walk` -> the `walk` predicate of one field: `none` (the default, and what an absent
 * argument means) walks nobody, `all` walks every NPC of every map, and anything else is a
 * comma-separated list of `Npc/<id>.img` template ids (`1012000,2003`).
 *
 * A word that is neither is a `RangeError`, not a silent "nobody walks": a typo in a policy should be
 * seen while the server is starting, the way a bad `--mob-speed` is. This is a server choice either
 * way (§4.28): the client only implements "walk" and "stop".
 */
export function npcWalkPolicy(spec: string | undefined): (templateId: number) => boolean {
  const text = (spec ?? "none").trim().toLowerCase();
  if (text === "" || text === "none") return () => false;
  if (text === "all") return () => true;
  const ids = new Set<number>();
  for (const token of text.split(",")) {
    const id = Number(token.trim());
    if (!Number.isInteger(id) || id < 0) {
      throw new RangeError(`--npc-walk: "${token.trim()}" is neither none, all, nor a template id`);
    }
    ids.add(id);
  }
  return (templateId) => ids.has(templateId);
}

export interface NpcFieldOptions {
  /** The `life` entries of type `n` of one map (`MapData.npcs`), in map order. */
  spawns: readonly LifeSpawn[];
  /** Template lookup; a miss drops that spawn (the client has no image for it). */
  template?: (templateId: number) => NpcTemplate | undefined;
  /**
   * Which of the map's NPCs the **client** should walk (`0x3B` flag 1; FINDINGS 4.28). Called once
   * per NPC, at spawn.
   *
   * The predicate takes the `life` template id, not the pool id, because that is what a map or a
   * command line names (`Npc/<id>.img`); the pool ids this field hands out are internal.
   * `npcWalkPolicy` builds it from `--npc-walk`. Absent means nobody walks.
   */
  walk?: (templateId: number) => boolean;
  /** One line per event; defaults to nothing. */
  log?(line: string): void;
}

/**
 * The NPCs of one field.
 *
 * Nothing here *simulates* an NPC: it stands where the map put it, and once `0x3B` said so the
 * client walks it. The three packets are the whole vocabulary the client has (`0x39` create/refresh,
 * `0x3A` remove, `0x3B` walk on/off), so the API is those three plus the bookkeeping that keeps
 * `npcs` in step with what the client was told.
 */
export class NpcField {
  /** Every spawned NPC, in the order the map's `life` list gives them. */
  readonly npcs: NpcEntry[] = [];
  private nextNpcId = 1;
  private readonly options: NpcFieldOptions;

  // A plain field, not a parameter property: `erasableSyntaxOnly` (i.e. Node's type stripping) does
  // not accept the shorthand, so the module would not load at all.
  constructor(options: NpcFieldOptions) {
    this.options = options;
  }

  /**
   * Builds the NPCs and returns the `0x39` packets for them, in map order.
   *
   * The ids are handed out from 1 per field: the client keys them in its own pool (`CMobPool` and
   * `CNpcPool` are separate, so an NPC id may equal a mob id - the two are looked up in different
   * maps). A spawn whose template has no `Npc/<id>.img` is skipped with a log line: sending it
   * would make the client load a file that does not exist.
   */
  spawnPackets(): Uint8Array[] {
    this.spawnAll();
    return this.enterPackets();
  }

  /**
   * Puts the map's `life` list into this field, with no packets at all.
   *
   * A field spawns its NPCs once, when it comes up (`FieldInstance`'s constructor) and never again:
   * calling this twice would hand the *same* map entry a second id, and the client would end up with
   * two NPCs standing on each other.
   */
  spawnAll(): void {
    for (const spawn of this.options.spawns) this.spawn(spawn);
  }

  /**
   * How many NPCs the client has been told to walk (`0x3B` flag 1). One line for the field log, the
   * same shape `MobField.walking` has.
   */
  get walking(): number {
    return this.npcs.filter((entry) => entry.present && entry.walking).length;
  }

  /**
   * The **full** `0x39` for every NPC that is present - what a player who has just entered the map
   * needs, and the same bodies `spawnPackets` produced for the first one.
   *
   * The short form (`refreshPacket`) is not what a joining player gets: it carries no template and no
   * position, and only means something to a client whose pool already has that id (`sub_49F6C0` ends
   * the packet as soon as the id is known).
   */
  enterPackets(): Uint8Array[] {
    const packets: Uint8Array[] = [];
    for (const entry of this.npcs) {
      if (!entry.present) continue;
      packets.push(this.enterPacket(entry));
      // The walk state rides behind the create, in that order: the flag is a bit on a pool entry, so
      // the client has to have the id first (`sub_49F260` would *create* an unknown one in that
      // state, which is not what a spawn means). Repeating it is harmless - the client leaves an id
      // that is already walking alone.
      if (entry.walking) packets.push(encodeNpcState(entry.npcId, true));
    }
    return packets;
  }

  /** Adds one NPC to the field (no packet - see `enterPacket`). */
  private spawn(spawn: LifeSpawn): NpcEntry | undefined {
    const template = this.options.template?.(spawn.templateId);
    if (this.options.template !== undefined && template === undefined) {
      this.options.log?.(
        `npc: ${spawn.templateId} is in the map's life list but has no Npc/*.img - not spawned`,
      );
      return undefined;
    }
    const entry: NpcEntry = {
      npcId: this.nextNpcId++,
      templateId: spawn.templateId,
      name: template?.name ?? "",
      x: spawn.x,
      y: spawn.y,
      facing: spawn.facing & 1,
      present: true,
      walking: this.options.walk?.(spawn.templateId) === true,
    };
    this.npcs.push(entry);
    return entry;
  }

  /** The `0x39` for one entry. The full body: the client has never seen this id. */
  private enterPacket(entry: NpcEntry): Uint8Array {
    const field: NpcEnterField = {
      npcId: entry.npcId,
      templateId: entry.templateId,
      x: entry.x,
      y: entry.y,
      facing: entry.facing,
      lookupKey: 0,
      pointX: 0,
      pointY: 0,
    };
    return encodeNpcEnterField(field);
  }

  /**
   * The `0x39` that only refreshes an id the client already has (`sub_49F6C0`): five bytes, no
   * template and no position. Refreshing is all it can do - a client that has never seen the id
   * would create an NPC out of the id alone.
   */
  refreshPacket(npcId: number): Uint8Array | undefined {
    const entry = this.byId(npcId);
    if (entry === undefined) return undefined;
    return encodeNpcEnterField({ npcId: entry.npcId, templateId: undefined, x: 0, y: 0, facing: 0 });
  }

  /** One NPC by its id, or `undefined`. */
  byId(npcId: number): NpcEntry | undefined {
    return this.npcs.find((entry) => entry.npcId === npcId);
  }

  get present(): number {
    return this.npcs.filter((entry) => entry.present).length;
  }

  /**
   * Tells the client to walk this NPC, or to stop walking it (`0x3B`), and returns the packet - or
   * `undefined` when the id is unknown or already in that state (the client does nothing either
   * time, so a packet would only be noise), or when the NPC is not in the field.
   *
   * Creating through `0x3B` is possible (`sub_49F260` builds an unknown id in that state) and not
   * offered here: an NPC is created by `0x39`, which is the packet that carries its template and
   * position.
   */
  setWalking(npcId: number, on: boolean): Uint8Array | undefined {
    const entry = this.byId(npcId);
    if (entry === undefined || !entry.present) return undefined;
    if (entry.walking === on) return undefined; // already in that state: no packet, like the client
    entry.walking = on;
    return encodeNpcState(npcId, on);
  }

  /**
   * Removes an NPC (`0x3A`) and returns the packet, or `undefined` for an unknown/absent id.
   *
   * The entry stays in `npcs` with `present = false` rather than being spliced out, so an id is
   * never handed out twice in one field's lifetime - the client's pool is keyed by it.
   */
  remove(npcId: number): Uint8Array | undefined {
    const entry = this.byId(npcId);
    if (entry === undefined || !entry.present) return undefined;
    entry.present = false;
    entry.walking = false;
    return encodeNpcLeaveField(npcId);
  }
}
