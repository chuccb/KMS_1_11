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
 * The template check is the one thing worth doing carefully: `Npc/<7-digit id>.img` has to exist,
 * because the client builds the NPC from it (`sub_49CB30` -> `sub_498A20`). A `life` entry whose id
 * has no image is skipped and reported, instead of being sent as a packet that would make the client
 * look up a file that is not there - the same rule `game/mobs.ts` applies to mobs.
 *
 * ONE FIELD PER CONNECTION: like `MobField` and `DropField`, the ids are this object's own. Two
 * players in one map would each see their own copy, with their own ids (ADR-001's shared world is
 * the step that changes this).
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
  /** The `0x3B` flag: the NPC's second state (FINDINGS 4.19.3). */
  secondState: boolean;
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

export interface NpcFieldOptions {
  /** The `life` entries of type `n` of one map (`MapData.npcs`), in map order. */
  spawns: readonly LifeSpawn[];
  /** Template lookup; a miss drops that spawn (the client has no image for it). */
  template?: (templateId: number) => NpcTemplate | undefined;
  /** One line per event; defaults to nothing. */
  log?(line: string): void;
}

/**
 * The NPCs of one field.
 *
 * Nothing here moves them: an NPC stands where the map put it. The three packets are the whole
 * vocabulary the client has (`0x39` create/refresh, `0x3A` remove, `0x3B` second state), so the API
 * is those three plus the bookkeeping that keeps `npcs` in step with what the client was told.
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
    const packets: Uint8Array[] = [];
    for (const spawn of this.options.spawns) {
      const entry = this.spawn(spawn);
      if (entry === undefined) continue;
      packets.push(this.enterPacket(entry));
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
      secondState: false,
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

  /** The `0x39` that only refreshes a live id - what a second player would be sent. */
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
   * Turns the NPC's second state on/off (`0x3B`) and returns the packet, or `undefined` when the id
   * is unknown (there is nothing to toggle, and creating through `0x3B` would build the NPC in its
   * second state - `0x39` is the honest way to create one).
   */
  setSecondState(npcId: number, on: boolean): Uint8Array | undefined {
    const entry = this.byId(npcId);
    if (entry === undefined || !entry.present) return undefined;
    if (entry.secondState === on) return undefined; // already in that state: no packet, like the client
    entry.secondState = on;
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
    entry.secondState = false;
    return encodeNpcLeaveField(npcId);
  }
}
