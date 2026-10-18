import {validNpcRequest} from "../../../client/npcbehavior.mjs";
import {encodeNpcState,encodeNpcIdle,type NpcIdle} from "../protocol/npc.ts";
/**
 * The world: the maps the server is simulating, and the players standing in them.
 *
 * This is the module ADR-001 was written for. Until now every connection owned its own monsters,
 * its own NPCs and its own drops (`MobField`, `NpcField`, `DropField` - each created per session),
 * which is exactly one player per field: a second player in the same map would see a full set of
 * monsters that only they could hit. `FieldInstance` moves that ownership to the **map**: one object
 * per map id, alive as long as the server runs, holding the monsters (with their hit points), the
 * NPCs, the loot on the ground and the players in it.
 *
 * A connection is therefore a *view*: it implements `FieldMember` (an id, a name, an avatar list, a
 * place to write) and the field fans every world packet out to its members. Nothing in this module
 * knows about sockets, ciphers or sessions - `member.send` is the only way out - which is what keeps
 * it testable without a network (`test/world.test.ts` drives it with fake members).
 *
 * Which packets are world facts is not a guess; it is what the client does with them (FINDINGS 4.24):
 *
 *   `0x1c`/`0x1d`/`0x22`  another user entered / left / moved (`CUserPool`; the client skips the
 *                          entry whose id is its own, `sub_51CFE0`) - facts about the field
 *   `0x2f`/`0x30`/`0x31`/`0x33`/`0x34`/`0x35`  a mob appeared / is leaving / is (not) there / is
 *                          walking / took a hit / changed animation (`CMobPool`) - facts about the mob
 *   `0x43`/`0x44`          a drop is on the ground / is gone (`CRewardPool`) - facts about the loot
 *   `0x39`/`0x3a`/`0x3b`   an NPC is there / is gone / changed state (`CNpcPool`) - facts about the NPC
 *
 * The packets that are *not* here are the ones addressed to one player: `0x0b` (that player's
 * inventory), `0x0d` (their stats), `0x11` (what they picked up), `0x16` (their own field entry),
 * `0x4a`/`0x47` (the window they alone have open).
 */
import {
  encodeDropRemove,
  DROP_REMOVE_KIND,
} from "../protocol/drop.ts";
import {
  encodeUserEnterField,
  encodeUserLeaveField,
  encodeUserMove,
} from "../protocol/field.ts";
import type { MovePath } from "../protocol/movepath.ts";
import { footholdUnderPoint } from "../wz/archive.ts";
import { DropField, type DropEntry, type DropFieldOptions, type DropPolicy } from "./drops.ts";
import type { ItemSlot } from "../protocol/itemslot.ts";
import type { MapData, MapPortal } from "./map.ts";
import { MobField, type MobFieldOptions, type MobTemplate } from "./mobs.ts";
import { NpcField, type NpcTemplate } from "./npcs.ts";

/**
 * Where a player is, as far as the field knows.
 *
 * `foothold` is the id of the segment under them (`FootholdSegment.id`, the same key `life.fh` and
 * the `CMovePath` element use), or absent when the map's geometry does not place them on one. The
 * client looks the id up in its own foothold tree (`sub_485400`) and does without a foothold when it
 * is unknown - a wrong id is not a crash, but the right one is the difference between a remote user
 * standing on the platform and hovering.
 */
export interface FieldPosition {
  x: number;
  y: number;
  foothold?: number;
  /** Last reported movement byte, including facing; never an attack action id. */
  action?: number;
}

/**
 * One player, as the field sees them.
 *
 * `FieldSession` in `net/loginserver.ts` is the only real implementation; tests use a fake. `send`
 * writes one *plain* packet to that player's client (the implementation encrypts for its own
 * connection), which is what lets the field fan a packet out without knowing about ciphers.
 */
export interface FieldMember {
  /** The character id: the key the client's `CUserPool` stores this user under. */
  readonly characterId: number;
  /** The name shown over the head (`0x1C`'s name string). */
  readonly name: string;
  /**
   * The face the client draws this user with - `0x1C`'s first u32, stored at `CUser+68`
   * (`CharacterData.appearanceA`; `lookOf` fills the starter face in when a character has none).
   */
  readonly face: number;
  /**
   * The item ids the client draws the avatar from (`0x1C`'s list, terminated by 0 on the wire).
   * Zero never appears in it: the client stops reading at the first 0 (`sub_45F340`).
   *
   * Mutable, and *not* owned by the field: a player who equips something replaces it (`0x28`,
   * `handleChangeSlot`), and the field reads it whenever it builds a `0x1C` - for the players who are
   * already in the map as well as for a player who joins later.
   */
  avatarItems: number[];
  /** Optional for fixtures; live sessions expose current HP>0 without the field owning character stats. */
  readonly combatAlive?:boolean;
  /** Where the player is. The field fills it in at spawn and updates it on every `0x22` it sends. */
  at?: FieldPosition;
  /**
   * When this player last moved (or entered the field). A drop can only be taken by a player who has
   * moved since it appeared - "walking onto it" - which is what keeps a throw-away from landing on
   * the thrower's own feet and coming straight back (`DropField.reachable`).
   */
  lastMoveAt?: number;
  send(packet: Uint8Array): void;
}

export interface FieldInstanceOptions {
  /** The map this field simulates (`game/map.ts`). */
  map: MapData;
  /** Mob stats (`Mob/<id>.img -> info`); without it mobs cannot be hurt or walk by template speed. */
  mobTemplate?: (templateId: number) => MobTemplate | undefined;
  /** `Npc/<id>.img`; without it every NPC of the map is spawned unnamed. */
  npcTemplate?: (templateId: number) => NpcTemplate | undefined;
  /** Legacy --npc-walk opt-in for movable/data-off NPC controllers. Stationary archive-backed
   * NPCs are controlled independently for idle speech/actions. This does not force walking.
   */
  npcWalk?: (templateId: number) => boolean;
  /** Mob walking speed at 100%, in px/s. Defaults to `PATROL_SPEED_PX_PER_SEC`. */
  mobSpeedPxPerSecond?: number;
  /** How long a killed mob stays away, in ms. Defaults to `MOB_RESPAWN_MS`. */
  mobRespawnMs?: number;
  /** What a killed monster leaves behind. Defaults to `defaultDropPolicy`. */
  dropPolicy?: DropPolicy;
  /** How long a drop lies on the ground, in ms. Defaults to `DROP_LIFETIME_MS`. */
  dropLifetimeMs?: number;
  /** Horizontal/vertical reach of a pickup, in px. Server choices (`game/drops.ts`). */
  pickupRangeX?: number;
  pickupRangeY?: number;
  /** How far from the monster a drop may land, in px. Defaults to `DROP_SPREAD_PX`. */
  dropSpreadPx?: number;
  log?(line: string): void;
}

/**
 * One map, simulated: its monsters, its NPCs, its drops and the players in it.
 *
 * The field outlives the players: an empty field keeps its state (a killed monster still comes back,
 * loot still expires) so that a player who logs out and in again finds the same map - which is what
 * "the server owns the world" means here. It is created on the first join of its map id and never
 * removed (`FieldRegistry`), so nothing has to be rebuilt on the next login either.
 */
export class FieldInstance<M extends FieldMember = FieldMember> {
  /**
   * The map this field simulates, as it was read out of `Data.wz`.
   *
   * Kept because the field is where the questions about a map are asked - which portal leads where
   * (`portal`), where a player enters (`spawnAt`) - and because a field that only remembered its id
   * would need the archive again for every one of them.
   */
  readonly map: MapData;
  readonly mapId: number;
  readonly mobs: MobField;
  readonly npcs: NpcField;
  /** Reconstruction policy: first available member controls each NPC, not every viewer. */
  private readonly npcControllers=new Map<number,number>();
  private readonly npcReportAt=new Map<number,number>();
  readonly drops: DropField;
  private readonly members = new Map<number, M>();
  private readonly spawnPoint: FieldPosition;
  private readonly log?: (line: string) => void;

  constructor(options: FieldInstanceOptions) {
    this.map = options.map;
    this.mapId = options.map.id;
    this.log = options.log;
    this.spawnPoint = spawnPointOf(options.map);
    this.mobs = new MobField({
      behavior: "roam",
      map: options.map,
      ...(options.map.footholdSegments !== undefined ? { footholds: options.map.footholdSegments } : {}),
      ...(options.mobTemplate !== undefined ? { template: options.mobTemplate } : {}),
      ...(options.mobSpeedPxPerSecond !== undefined ? { speedPxPerSecond: options.mobSpeedPxPerSecond } : {}),
      ...(options.mobRespawnMs !== undefined ? { respawnMs: options.mobRespawnMs } : {}),
    } satisfies MobFieldOptions);
    this.npcs = new NpcField({
      spawns: options.map.npcs,
      ...(options.npcTemplate !== undefined ? { template: options.npcTemplate } : {}),
      ...(options.npcWalk !== undefined ? { walk: options.npcWalk } : {}),
      log: (line) => this.log?.(line),
    });
    // The map's NPCs exist as soon as the field does (their ids are the field's, not a session's).
    this.npcs.spawnAll();
    this.drops = new DropField({
      ...(options.map.footholdSegments !== undefined ? { footholds: options.map.footholdSegments } : {}),
      ...(options.dropPolicy !== undefined ? { policy: options.dropPolicy } : {}),
      ...(options.dropLifetimeMs !== undefined ? { lifetimeMs: options.dropLifetimeMs } : {}),
      ...(options.pickupRangeX !== undefined ? { pickupRangePx: options.pickupRangeX } : {}),
      ...(options.pickupRangeY !== undefined ? { pickupRangeY: options.pickupRangeY } : {}),
      ...(options.dropSpreadPx !== undefined ? { spreadPx: options.dropSpreadPx } : {}),
    } satisfies DropFieldOptions);
    this.log?.(
      `world: map ${options.map.id} (${options.map.name || options.map.imagePath}) is up - ` +
        `spawned ${this.mobs.mobs.length} mobs ` +
        `(${this.mobs.walking} walking), ${this.npcs.present} NPCs ` +
        `(${this.npcs.walking} legacy controller requests)`,
    );
  }

  /** The players in the field, in the order they arrived. */
  get memberList(): readonly M[] {
    return [...this.members.values()];
  }

  get memberCount(): number {
    return this.members.size;
  }

  member(characterId: number): M | undefined {
    return this.members.get(characterId);
  }

  /**
   * Where the map puts a player who has not moved yet, and the foothold under it.
   *
   * This is also the place the field *tells the others* a fresh player is standing, so getting it
   * right is what keeps a newly seen remote user on the platform instead of in midair.
   */
  spawnAt(portalIndex?: number): FieldPosition {
    return portalIndex === undefined ? { ...this.spawnPoint } : spawnPointOf(this.map, portalIndex);
  }

  /**
   * The portal of this map with that name, or `undefined` when the map has none.
   *
   * The name is the client's own: it is the `pn` of the portal the mouse was over when the player
   * clicked (`sub_5124C0`/`sub_512510` send it in `0x0D`, FINDINGS 4.11.6), so this lookup is what
   * turns "the player used a portal" into "the player goes to map N". The comparison ignores case -
   * the names are map data, the client's own comparison is not located, and a case difference is the
   * difference between a working portal and a teleport that silently does nothing.
   */
  portal(name: string): MapPortal | undefined {
    const wanted = name.toLowerCase();
    return this.map.portals.find((entry) => entry.name.toLowerCase() === wanted);
  }

  /**
   * A player enters the field: they get the world as it stands, and everyone gets an `0x1C`.
   *
   * The snapshot is what makes a *late* joiner see the same map as an early one: the monsters that
   * are up (`0x2F`), the NPCs (`0x39`, the full body - a client that has never seen the id needs the
   * template and the position, `sub_49F6C0`), and the loot already on the ground (`0x43`, the same
   * packet that announced it). Then the players: the joiner is told about each of them and each of
   * them is told about the joiner.
   *
   * The joiner does **not** get an `0x1C` for themself - the client skips the entry whose id is its
   * own (`sub_51CFE0` compares against `CWvsApp`'s own character id) - and their own avatar arrived
   * inside the `0x16` `CharacterData` the caller sent first.
   */
  join(member: M): void {
    if (this.members.has(member.characterId)) {
      // The same character id twice in one field would make the client's pool keep one of them.
      this.log?.(`world: character ${member.characterId} is already in map ${this.mapId}; taking the new one`);
      this.leave(member.characterId);
    }
    if (member.at === undefined) member.at = this.spawnAt();
    // Standing here counts as having arrived: loot that was already on the ground is takeable now.
    if (member.lastMoveAt === undefined) member.lastMoveAt = Date.now();
    for (const packet of this.mobs.spawnPackets()) member.send(packet);
    for (const packet of this.mobs.resumePackets()) member.send(packet);
    for (const packet of this.npcs.enterPackets()) member.send(packet);
    for (const drop of this.drops.drops) member.send(this.drops.appearPacket(drop));
    for (const other of this.members.values()) {
      member.send(this.enterPacket(other));
      other.send(this.enterPacket(member));
    }
    this.members.set(member.characterId, member);
    this.assignNpcControllers();
    this.log?.(
      `world: "${member.name}" (${member.characterId}) entered map ${this.mapId} at ` +
        `(${member.at.x},${member.at.y}) - ${this.members.size} player(s), ${this.mobs.mobs.length} mobs, ` +
        `${this.npcs.present} NPCs, ${this.drops.drops.length} drops`,
    );
  }

  /** A player leaves (`0x1D` to the rest), or nothing when they were not in this field. */
  leave(characterId: number): void {
    const member = this.members.get(characterId);
    if (member === undefined) return;
    this.members.delete(characterId);
    this.assignNpcControllers();
    const packet = encodeUserLeaveField(characterId);
    for (const other of this.members.values()) other.send(packet);
    this.log?.(
      `world: "${member.name}" (${characterId}) left map ${this.mapId} - ` +
        `${this.members.size} player(s) left`,
    );
  }

  private assignNpcControllers(): void {
    for(const entry of this.npcs.npcs) {
      const oldId=this.npcControllers.get(entry.npcId);
      const owner=entry.present&&((entry.behavior!==undefined&&!entry.behavior.movable)||entry.walking)
        ? (oldId!==undefined&&this.members.has(oldId)?this.members.get(oldId):this.members.values().next().value)
        : undefined;
      if(oldId===owner?.characterId)continue;
      if(oldId!==undefined)this.members.get(oldId)?.send(encodeNpcState(entry.npcId,false));
      this.npcControllers.delete(entry.npcId);this.npcReportAt.delete(entry.npcId);
      if(owner) {
        this.npcControllers.set(entry.npcId,owner.characterId);
        owner.send(encodeNpcState(entry.npcId,true));
      }
    }
  }

  /** Revoke control before visibility removal so the native two-bit pool cannot retain a ghost. */
  removeNpc(npcId:number): boolean {
    const packet=this.npcs.remove(npcId);if(!packet)return false;
    this.assignNpcControllers();this.broadcast(packet);return true;
  }

  /** Transparent byte relay is an explicit server policy; original 2003 server rewriting is unknown.
   * Validate in SENDER index space, acknowledge sender too, and never manufacture a corrected +2.
   */
  reportNpcIdle(characterId:number,value:NpcIdle,now=Date.now()): boolean {
    const npc=this.npcs.npcs.find(npc=>npc.npcId===value.npcId&&npc.present);
    if(!this.members.has(characterId)||this.npcControllers.get(value.npcId)!==characterId||!npc?.behavior
      || (npc.behavior.movable!==Boolean(value.path))
      || !(validNpcRequest(npc.behavior,value.action,value.speech)
        || (value.path&&value.action===-1&&value.speech===-1)))return false;
    // Reconstruction anti-flood bound; natural client decisions are at least 4 seconds apart.
    if(now-(this.npcReportAt.get(value.npcId)??-Infinity)<250)return false;
    this.npcReportAt.set(value.npcId,now);
    const first=value.path?.elements[0];
    if(first){npc.x=first.x;npc.y=first.y;npc.facing=first.action&1;}
    this.broadcast(encodeNpcIdle(value));return true;
  }

  /**
   * A player moved (`0x0E` in, `0x22` out): the field remembers where they are and tells the rest.
   *
   * The path is relayed as the client wrote it: the other clients replay it themselves
   * (`CVecCtrlUser`), so the only thing the server changes is the id in front - the same id the
   * sender's own `0x0E` does not carry (their client knows who they are).
   */
  reportMove(characterId: number, path: MovePath): void {
    const member = this.members.get(characterId);
    if (member === undefined) return;
    const first = path.elements[0];
    if (first !== undefined) member.at = { ...member.at, x: first.x, y: first.y,
      foothold: first.foothold, action: first.action };
    // The same clock the tick uses: a pickup compares this against a drop's `bornAt`.
    member.lastMoveAt = Date.now();
    const packet = encodeUserMove({ characterId, path });
    for (const other of this.members.values()) {
      if (other.characterId !== characterId) other.send(packet);
    }
  }

  /** One world packet to every player (or to every player except one). */
  broadcast(packet: Uint8Array, exceptCharacterId?: number): void {
    for (const member of this.members.values()) {
      if (member.characterId === exceptCharacterId) continue;
      member.send(packet);
    }
  }

  /** Several world packets, in order, to everyone (a hit's `0x34` and `0x30`, say). */
  broadcastAll(packets: Iterable<Uint8Array>, exceptCharacterId?: number): void {
    for (const packet of packets) this.broadcast(packet, exceptCharacterId);
  }

  /**
   * A player throws something away (`0x17` with `toSlot = 0`, FINDINGS 4.36): the item is put on the
   * ground where they stand and the whole field - the thrower included - is told with the `0x43` that
   * has no monster in it (`DROP_KIND.placed`).
   *
   * The inventory side is the caller's: this only knows the thing on the ground, the same split the
   * monster loot has (a kill rolls here, `0x0B`/`0x11` belong to the session that takes it).
   */
  dropItem(member: M, slot: ItemSlot, count: number, now: number): DropEntry {
    const at = member.at ?? this.spawnAt();
    const entry = this.drops.dropFromPlayer({ slot, count, x: at.x, y: at.y }, now);
    for (const other of this.members.values()) other.send(this.drops.appearPacket(entry));
    this.log?.(
      `world: "${member.name}" dropped item ${slot.itemId} x${count} in map ${this.mapId} ` +
        `(drop ${entry.dropId} at ${entry.x},${entry.y})`,
    );
    return entry;
  }

  /** c2s0x1F: debit/persistence belong to the caller, appearance belongs to this shared field. */
  dropMesos(member: M, amount: number, now: number): DropEntry {
    const at = member.at ?? this.spawnAt();
    const entry = this.drops.dropMesosFromPlayer(
      { amount, x: at.x, y: at.y },
      now,
    );
    this.broadcast(this.drops.appearPacket(entry));
    this.log?.(
      `world: "${member.name}" dropped ${amount} mesos in map ${this.mapId} (drop ${entry.dropId})`,
    );
    return entry;
  }

  /** The `0x44` that takes a drop off the ground: `kind 2`, with the id of whoever took it. */
  broadcastDropTaken(dropId: number, characterId: number): void {
    this.broadcast(encodeDropRemove({ dropId, kind: DROP_REMOVE_KIND.taken, characterId }));
  }

  /**
   * The field's clock, one call per server tick (FINDINGS 4.24.3).
   *
   *   the mobs      one `0x33` per due leg - but only while somebody is watching, because a leg is a
   *                 promise to a client that it will be played; with nobody there the mobs simply
   *                 stand still instead of walking into a position no player has seen.
   *   the remnants  the corpse of a dead mob going (`0x31 flag 0`) and its respawn (`0x31 flag 1`)
   *                 are field bookkeeping and happen whether or not anyone is in the map, which is
   *                 what makes a monster killed by one player come back for the next one.
   *   the loot      a drop whose lifetime is up disappears (`0x44` kind 0).
   *
   * A player's own pickup is **not** here: what a pickup gives (a slot, mesos, an `0x11` notice)
   * belongs to the connection, so the session runs that itself and only the `0x44` is the field's.
   */
  tick(now: number): void {
    this.assignNpcControllers();
    if (this.members.size > 0) {
      const targets=[...this.members.values()].flatMap(m=>m.combatAlive!==false&&m.at?[{characterId:m.characterId,x:m.at.x,y:m.at.y}]:[]);
      for(const packet of this.mobs.attackPackets(now,targets))this.broadcast(packet);
      for (const packet of this.mobs.movePackets(now)) this.broadcast(packet);
    }
    for (const packet of this.mobs.lifecyclePackets(now)) this.broadcast(packet);
    for (const drop of this.drops.expired(now)) {
      this.broadcast(encodeDropRemove({ dropId: drop.dropId, kind: DROP_REMOVE_KIND.gone }));
      this.log?.(`world: drop ${drop.dropId} expired in map ${this.mapId}`);
    }
  }

  /**
   * The `0x1C` for one member: the body `CUserRemote::Init` reads (`sub_520680`).
   *
   * `face` is the one field of this packet that is this server's to fill and that the client really
   * draws: it is the user's face id (`CharacterData.appearanceA`), and 0 would leave the user
   * faceless. Three fields are the client's own shape, not this server's knowledge: `unknown64` (a
   * byte stored at `CUser+64`) and the two u32s after the face, which the client reads and drops
   * without storing. None of them is located, so all three go out as 0.
   * Movement action/foothold now retain the reported state, so a late join sees prone/rope/facing.
   * With no report, stand4 is the explicit server spawn policy, not an observed original server byte.
   */
  private enterPacket(member: M): Uint8Array {
    const at = member.at ?? this.spawnAt();
    return encodeUserEnterField({
      characterId: member.characterId,
      name: member.name,
      unknown64: 0,
      face: member.face,
      unknownA: 0,
      unknownB: 0,
      avatarItems: member.avatarItems,
      x: at.x,
      y: at.y,
      action: at.action ?? 4,
      foothold: at.foothold ?? 0,
    });
  }
}

export interface FieldRegistryOptions {
  /** The map source (`mapDataProvider(WzArchive)` is the real one). Without it there are no fields. */
  mapProvider?: (mapId: number) => MapData | undefined;
  mobTemplate?: (templateId: number) => MobTemplate | undefined;
  npcTemplate?: (templateId: number) => NpcTemplate | undefined;
  /** Which NPCs the client walks (`0x3B`; see `FieldInstanceOptions.npcWalk`). */
  npcWalk?: (templateId: number) => boolean;
  mobSpeedPxPerSecond?: number;
  mobRespawnMs?: number;
  dropPolicy?: DropPolicy;
  dropLifetimeMs?: number;
  pickupRangeX?: number;
  pickupRangeY?: number;
  dropSpreadPx?: number;
  log?(line: string): void;
}

/**
 * The fields that exist right now: one per map id, created on first use and kept.
 *
 * Keeping them is the point (see `FieldInstance`): a map's monsters and loot are the server's, not
 * the connection's. The size of this map is therefore the number of maps that have been visited, at
 * most the number of `Map/Map/*.img` files - not something that grows with time.
 */
export class FieldRegistry<M extends FieldMember = FieldMember> {
  private readonly options: FieldRegistryOptions;
  private readonly fields = new Map<number, FieldInstance<M>>();

  constructor(options: FieldRegistryOptions) {
    this.options = options;
  }

  /**
   * The field of this map, created if this is the first time it is asked for.
   *
   * `undefined` means the map itself is unknown (no `mapProvider`, or no `Map/Map/*.img` for that
   * id): there is nothing to simulate, and the caller decides what a connection in a map that does
   * not exist should do (today: it enters, and the server has no field to put it in).
   */
  of(mapId: number): FieldInstance<M> | undefined {
    const existing = this.fields.get(mapId);
    if (existing !== undefined) return existing;
    const map = this.options.mapProvider?.(mapId);
    if (map === undefined) return undefined;
    const instance = new FieldInstance<M>({
      map,
      ...(this.options.mobTemplate !== undefined ? { mobTemplate: this.options.mobTemplate } : {}),
      ...(this.options.npcTemplate !== undefined ? { npcTemplate: this.options.npcTemplate } : {}),
      ...(this.options.npcWalk !== undefined ? { npcWalk: this.options.npcWalk } : {}),
      ...(this.options.mobSpeedPxPerSecond !== undefined
        ? { mobSpeedPxPerSecond: this.options.mobSpeedPxPerSecond }
        : {}),
      ...(this.options.mobRespawnMs !== undefined ? { mobRespawnMs: this.options.mobRespawnMs } : {}),
      ...(this.options.dropPolicy !== undefined ? { dropPolicy: this.options.dropPolicy } : {}),
      ...(this.options.dropLifetimeMs !== undefined ? { dropLifetimeMs: this.options.dropLifetimeMs } : {}),
      ...(this.options.pickupRangeX !== undefined ? { pickupRangeX: this.options.pickupRangeX } : {}),
      ...(this.options.pickupRangeY !== undefined ? { pickupRangeY: this.options.pickupRangeY } : {}),
      ...(this.options.dropSpreadPx !== undefined ? { dropSpreadPx: this.options.dropSpreadPx } : {}),
      log: (line) => this.options.log?.(line),
    });
    this.fields.set(mapId, instance);
    return instance;
  }

  /** Every field that exists, in the order they were first entered. */
  instances(): readonly FieldInstance<M>[] {
    return [...this.fields.values()];
  }

  get size(): number {
    return this.fields.size;
  }
}

/** sub_511820: CharacterData+101 indexes non-type-3 portals; spawn feet at portal.y - 10.
 * Calls without an index retain the legacy/default sp helper used by world-only fixtures. */
function spawnPointOf(map: MapData, portalIndex?: number): FieldPosition {
  const nativePortal = portalIndex === undefined ? undefined : map.portals.filter(p => p.type !== 3)[portalIndex];
  const portal = nativePortal ??
    map.portals.find((entry) => entry.name.toLowerCase() === "sp") ??
    map.portals.find((entry) => entry.type === 0) ??
    map.portals[0];
  const x = portal?.x ?? 0;
  const y = (portal?.y ?? 0) - (portalIndex === undefined ? 0 : 10);
  const segments = map.footholdSegments;
  const segment = segments === undefined ? undefined : footholdUnderPoint(segments, x, y);
  return segment === undefined ? { x, y } : { x, y, foothold: segment.id };
}
