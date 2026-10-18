import {npcBehaviorOf, type NpcBehavior} from "./sprites.ts";
import {artReaderOf, type ArtReader} from "./wzart.ts";
/** NPC visibility and template metadata. FieldInstance owns controller designation and relay.
 * 0x3B is NOT a walk command: stationary NPCs need it for idle speech/actions too.
 * --npc-walk / walking / setWalking are retained LEGACY API names for explicit controller requests;
 * they do not prove movement. See NATIVE_NPC_BEHAVIOR.md / ADR-062 (corrects FINDINGS 4.28).
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
  /** Archive-backed idle data; omitted by legacy/data-off fixtures, not fabricated. */
  behavior?: NpcBehavior;
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
  behavior?: NpcBehavior;
  /** Legacy --npc-walk opt-in controller request, NOT observed motion or actual ownership. */
  walking: boolean;
}

/**
 * `Npc/<id>.img -> info.name`, or `undefined` when the image does not exist.
 *
 * A map's `life` list is *the map's* promise that the file is there, so a miss is a data problem
 * worth reporting - the caller decides what to do about it, this function only reads.
 */
export function npcTemplateFrom(archive: WzArchive, templateId: number, reader?: ArtReader): NpcTemplate | undefined {
  const path = npcImagePath(templateId);
  if (!archive.has(path)) return undefined;
  const root = archive.objects(path)[0];
  const info = infoOf(root);
  const art=reader??artReaderOf(archive);
  const behavior=art?npcBehaviorOf(templateId,art):undefined;
  return { templateId, name: asText(info.name),...(behavior?{behavior}:{}) };
}

/** Caches `npcTemplateFrom` per id, the way `mobTemplateProvider` does for mobs. */
export function npcTemplateProvider(archive: WzArchive): (templateId: number) => NpcTemplate | undefined {
  const cache = new Map<number, NpcTemplate | undefined>();
  const reader=artReaderOf(archive);
  return (templateId: number) => {
    if (!cache.has(templateId)) cache.set(templateId, npcTemplateFrom(archive, templateId,reader));
    return cache.get(templateId);
  };
}

/** Legacy --npc-walk: explicit controller requests for templates, NOT a force-walk command. */
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
  /** Legacy opt-in controller predicate; FieldInstance separately enables stationary idle behavior. */
  walk?: (templateId: number) => boolean;
  /** One line per event; defaults to nothing. */
  log?(line: string): void;
}

/**
 * The NPCs of one field.
 *
 * Nothing here *simulates* an NPC: it stands where the map put it, and once `0x3B` said so the
 * client presents it. 0x39/0x3A manage visibility; FieldInstance controls 0x3B ownership and 0x3D
 * action/speech relay. This class retains visibility bookkeeping and legacy request helpers, keeping
 * `npcs` in step with what the client was told.
 */
export class NpcField {
  /** Every spawned NPC, in the order the map's `life` list gives them. */
  readonly npcs: NpcEntry[] = [];
  private nextNpcId = 1;
  private spawned=false;
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
   * repeated calls are ignored, rather than handing the same spawn a second pool id.
   */
  spawnAll(): void {
    if(this.spawned)return;this.spawned=true;
    for (const spawn of this.options.spawns) this.spawn(spawn);
  }

  /**
   * How many NPCs have a LEGACY explicit controller request; NOT actual moving NPCs.
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
      ...(template?.behavior?{behavior:template.behavior}:{}),
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
   * Legacy controller request helper, not a walking command (`0x3B`), and returns the packet - or
   * `undefined` when the id is unknown or already in that state (the client does nothing either
   * time, so a packet would only be noise), or when the NPC is not in the field.
   *
   * Creating through `0x3B` is possible (`sub_49F260` builds an unknown id in that state) and not
   * offered here: an NPC is created by `0x39`, which is the packet that carries its template and
   * position.
   */
  // Legacy isolated codec helper. Do NOT broadcast its returned flag to all FieldInstance members:
  // real field ownership is assigned/reconciled by FieldInstance, separately from this request bit.
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
