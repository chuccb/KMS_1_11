/**
 * The mob packets: what the server sends so a monster appears on screen.
 *
 * EVIDENCE (MapleStory.exe.c, FINDINGS 4.12/4.12.1)
 * ------------------------------------------------
 * `CField`'s dispatcher routes opcodes 0x2E-0x37 to `CMobPool` (`sub_492330`, 153810-153828),
 * which is where 0x2F lives. `sub_4924A0` (153923-154040) is the **mob enter field** handler:
 *
 *   1. `u32 mobId` - the pool key. `sub_492C00` looks it up; a hit means the mob already exists,
 *      so the client just marks `[mob+112] = 1` (refresh) and returns: a second 0x2F for the same
 *      id carries no fields at all.
 *   2. `u32 templateId` - only read when the id is new. `sub_48CFA0` maps it to a template,
 *      `sub_4848E0` builds the `CMob`, then `CMob::Init` (`sub_484ED0`, 140135-140341) reads the
 *      rest of the packet:
 *        `s16 x`, `s16 y`   -> mob+368/+372 (and the same values at +360/+364). `sub_485AA0`'s hit
 *                              test adds +368/+372 to its rectangles, so these are the position.
 *        `u8  facing`       -> mob+272; only bit 0 matters (`& 1` picks between the +292/+308
 *                              boxes), i.e. 0 = right, 1 = left.
 *        `u16`, `u16`       -> both are only fed to `sub_489800` (144274-144314, a ZMap find).
 *                              The result's `+32` field goes to `sub_53D310` together with
 *                              `*(template+24)`; nothing is stored on the mob, so these are not
 *                              state. **Their meaning is still open** - see FINDINGS 4.15 - but a
 *                              lookup *miss* is handled by the client itself (it substitutes a
 *                              zeroed record), so sending 0 is a legal packet.
 *        animation block    -> `sub_4C6CE0` (206484-206700): a `u32` of channel flags, then, for
 *                              every set bit, `s16 index` and `s16 delay` (the delay is multiplied
 *                              by the channel's 100 ms tick and stored as an end time). Channels
 *                              are bits 1, 2, 4, 8, 0x10, 0x20, 0x40 and land at mob+176, +188,
 *                              +200, +212, +224, +236, +248.
 *
 * Length checks are `ZException(38)` on the client (`sub_45DC40`/`sub_45DC80`), the same contract
 * `PacketReader` enforces here.
 *
 * MOB MOVE (0x33)
 * ---------------
 * `sub_4927B0` is the 0x31 handler; the move comes from `sub_492380` (`sub_492330` case `'3'`),
 * which reads a `u32 mobId` (`sub_492400` = pool lookup by id) and then calls `sub_488BC0(mob, p)`.
 * Its disassembly (`.text:0x488BC0`, verified against `MapleStory.exe.lst`) is:
 *
 *   cmp  [esi+74h], 1            ; mob+116 == 1 -> return, the packet is not even read
 *   u8  byte1                    ; only used for the state at the end: mob+116 = byte1 ? -3 : -2
 *   u8  byte2                    ; `test dl, dl; jl` -> bit 7 set means "keep the current animation"
 *   u32 value                    ; not optional: read before the branch, before the path
 *   if byte2 >= 0:
 *     facing = byte2 & 1, action = byte2 >> 1
 *     if not (mob+276 (old action) in 10..12 and action in 7..9):
 *       mob+272 = (mob+272 & ~1) | facing ; mob+276 = action ; sub_485DA0(mob)  (re-bind to foothold)
 *     if action in 10..12 -> sub_488E30(mob, action, facing, value)     (attack actions get the u32)
 *     else if action in 7..9 -> mob+280 = now + sub_486180(mob, action)  (hit actions get a duration)
 *   CMovePath (sub_4967C0 -> sub_4953A0, the same decoder as 0x22/0x0E)
 *   mob+116 = byte1 ? -3 : -2
 *
 * The action indices are the client's own (`CMob::GetAction` -> `sub_485400`, a hash lookup by index):
 * `sub_40B530` + 0x156 allocates a `CActionMan::MOBACTIONENTRY` and names the action with
 * `(&off_5B20FC)[index]`, and `.data:0x5B20FC` is the 16-entry table `MOB_ACTION_NAMES` below
 * (`MapleStory.exe.lst` line 773757, entries 0x5B20FC..0x5B2138). The hit/attack/die ranges in
 * `sub_488BC0`/`sub_485530` (13 + rand() % template+116) line up with that table.
 *
 * 0x32/0x36 read a `u32 mobId` and do nothing.
 *
 * DAMAGE AND DEATH (0x30 / 0x31 / 0x34)
 * -------------------------------------
 * A 2003 mob is hurt on the client's word: the *attacker's* client computes the damage, draws the
 * numbers (it queues one `CMob::DAMAGEINFO` per target in the attack sender `sub_512F90` and prints
 * them from the mob's own update) and reports the whole swing in 0x0F (`field.ts`, FINDINGS 4.13.1).
 * The server's half of the loop is three packets, and all three say "the state of this mob changed":
 *
 *  0x34 `u32 mobId` + `u16`   (`sub_488D90`) The value lands in `mob+132`, whose only reader is the
 *                            mob's attack picker (`sub_487D10`): it is compared against every attack's
 *                            MP cost - `Mob/<id>.img/attack<i>/info/conMP`, parsed into the entry's
 *                            `+16` by `sub_48E360` (149654/149678, `p_yBottom_4[3]`/`[4]`) - and the
 *                            attacks the mob cannot afford are skipped. `mob+132` is therefore the
 *                            mob's **MP**, and this is the packet that tells a client what a mob may
 *                            use. The handler also moves `mob+116` (the mob's state): 1 -> 5,
 *                            2 -> 4, 3 -> 5, and every other value calls `sub_485330(mob, 1)`, which
 *                            switches flash on and sets the state to4. ADR-075 corrects the old
 *                            blanket-flinch interpretation: 487A30 also requires positive damage
 *                            >= info.pushed, no active hit window, and the local attacker. Then
 *                            4885D0 uses the supplied hit action7..9 and replaces its movement path.
 *                            The reconstructed server now broadcasts this reaction in0x33 so all
 *                            browsers share one path (server policy, not a recovered original server).
 *
 *  0x30 `u32 mobId` + `s16 delay` (`sub_4926B0`) A non-negative delay queues `(mobId, now + delay)`
 *                            in the pool's timed queue; when that expires (`sub_492100`) the pool
 *                            calls `sub_491AB0(pool, mobId, 1)` -> `sub_485530`, which flushes the
 *                            mob's pending damage numbers and then plays a die action:
 *                            `mob+276 = 13 + rand() % template+116`, `template+116` being the number
 *                            of die actions the mob's image has (see the counters note below). Every
 *                            mob in this `Data.wz` has exactly one (`die1`), so the action is always
 *                            13. A *negative* delay removes the mob at once (`sub_491AB0(..., 0)`)
 *                            but refuses while the sprite is busy (`sub_485520` = frames left), so a
 *                            die animation in flight is never cut short. **0x30 alone does not unlink
 *                            the mob** - the corpse stays in the pool until 0x31 says otherwise, which
 *                            is why dying is two packets.
 *
 *  0x31 `u8 flag` + `u32 mobId` (`sub_4927B0`) `flag == 0` -> `sub_491830`: the mob is removed (the
 *                            flash is switched off first if the sprite is busy, then the pool entry
 *                            is unlinked once `mob+112` is clear). `flag != 0` -> `sub_491630`: a
 *                            known mob is merely refreshed, an unknown one is created from the rest
 *                            of the packet - a `u32 templateId` followed by *exactly* the body of
 *                            0x2F, since both go through `CMob::Init` - and the new mob gets
 *                            `sub_485330(mob, 1)`, i.e. the flash. That is the "a monster appears in
 *                            front of you" packet (and it leaves the mob flinch-ready).
 *
 * The counters the two handlers use are per-mob-image, not per-action: `template+108` = the number of
 * `attack<i>` infos, `template+112` = the number of hit actions (`hit1`/`hit2`/`hitF`, which is where
 * the attack packet's `hitAnimation` comes from: `7 + rand() % that`), `template+116` = the number of
 * die actions. All three are read off `Mob/<id>.img`'s own children by `game/mobs.ts`.
 *
 * So one kill looks like: 0x30 (the die animation starts now) -> wait out `dieMs` (the sum of the die
 * action's frame delays, the client's own `sub_486180`) -> 0x31 flag=0 (the corpse disappears). Both
 * timers live in `game/mobs.ts`; the lengths come from the mob's image, and the frame delay the
 * client assumes when a frame has no `delay` property is 180 ms (`sub_40B530`, 19949: `lVal = 180`).
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import { readMovePath, writeMovePath, type MovePath } from "./movepath.ts";

/** `CMobPool` opcodes with a located handler (`sub_492330`). */
export const MOB_OPCODE = {
  /**
   * `CMobPool` 0x2F (`sub_4924A0`): mob enter field. Body below, in `MobEnterField` order.
   */
  enterField: 0x2f,
  /**
   * `CMobPool` 0x30 (`sub_4926B0`): `u32 mobId` + `s16 delayMs`. `delayMs >= 0` puts the mob in the
   * pool's timed queue (`sub_492100`) so it starts dying - i.e. plays a die action - when the timer
   * runs out; a negative `delayMs` removes it at once (unless its die animation is still running).
   * The mob is *not* unlinked by this packet: `presence` does that.
   */
  leaveDelayed: 0x30,
  /**
   * `CMobPool` 0x31 (`sub_4927B0`): `u8 flag` + `u32 mobId`. `flag == 0` removes the mob;
   * `flag != 0` refreshes a known mob, or creates an unknown one from a `u32 templateId` plus the
   * body of 0x2F (and flashes it, `sub_485330(mob, 1)`).
   */
  presence: 0x31,
  /**
   * `CMobPool` 0x33 (`sub_492380` -> `sub_488BC0`): the mob moves - `u32 mobId` + `MobMove`.
   */
  move: 0x33,
  /**
   * `CMobPool` 0x34 (`sub_492380` -> `sub_488D90`): `u32 mobId` + `u16 mp`. The value is the mob's
   * MP (its only reader compares it against the attacks' `conMP`); it also pushes the mob into the
   * flash state that lets the client replay its hit animation.
   */
  stat: 0x34,
  /**
   * `CMobPool` 0x35 (`sub_492380` case '5' -> `sub_488E10`): `u32 mobId` + the animation block.
   *
   * `sub_488E10` is three lines - `sub_4C6CE0(mob + 136, packet, timeGetTime())` - and `CMob::Init`
   * hands the same function its `mob + 136` (`sub_484ED0`, 4.12.1), so this packet is **the animation
   * block on its own**: a `u32` of channel flags and, per set bit, `s16 index` + `s16 delay`.
   *
   * That makes it the server's "play this action on that mob" packet, for the clients that are not
   * driving the mob themselves - the animation the block switches on is the same seven channels
   * `0x2F` sets at spawn. An unknown `mobId` returns before anything is read.
   */
  anim: 0x35,
  /** `CMobPool` 0x32/0x36 (`sub_492380` default): `u32 mobId`, then nothing. Effectively unused. */
  unusedLookup: 0x32,
} as const;

/**
 * Mob action indices, as the client names them.
 *
 * `sub_485400(mob, index)` looks the index up in the mob's action map; the map is filled by
 * `sub_40B530`, which allocates a `CActionMan::MOBACTIONENTRY` and takes the name from the table at
 * `.data:0x5B20FC` - that table is what is spelled out here, in order. Only the actions a mob's own
 * WZ image actually has exist for any given mob (`Mob/0120100.img` has move/stand/hit1/die1), and
 * `Mob/<id>.img -> info.speed` decides whether it walks at all.
 */
export const MOB_ACTION_NAMES = [
  "move", "stand", "jump", "magic", "throw", "ball1", "ball2",
  "hit1", "hit2", "hitF", "attack1", "attack2", "attackF", "die1", "die2", "dieF",
] as const;

/** The action indices above, by name (bit 7 of the action byte is not part of the index). */
export const MOB_ACTION = {
  move: 0, stand: 1, jump: 2, magic: 3, throw: 4, ball1: 5, ball2: 6,
  hit1: 7, hit2: 8, hitF: 9, attack1: 10, attack2: 11, attackF: 12,
  die1: 13, die2: 14, dieF: 15,
} as const;

/** Bit 7 of `0x33`'s action byte: keep the animation the mob is playing instead of switching. */
export const MOB_ACTION_KEEP = 0x80;

/** The action a `0x33` action byte selects, or `undefined` when bit 7 says "keep". */
export function mobActionName(actionByte: number): string | undefined {
  if ((actionByte & MOB_ACTION_KEEP) !== 0) return undefined;
  return MOB_ACTION_NAMES[(actionByte >> 1) & 0x0f];
}

/** Build the action byte of `0x33` from an action index and a facing (`0` = right, `1` = left). */
export function mobActionByte(actionIndex: number, facing: number, keep = false): number {
  return ((actionIndex << 1) | (facing & 1)) | (keep ? MOB_ACTION_KEEP : 0);
}

/** One animation channel of the `sub_4C6CE0` block: an index and a delay in 100 ms ticks. */
export interface MobChannel {
  index: number;
  /** Units of 100 ms (`sub_4C6CE0` stores `timeGetTime() + 100 * delay`). */
  delay: number;
}

/**
 * The body of one `0x2F` (mob enter field) packet.
 *
 * `channels[i]`, when set, switches on bit `1 << i` of the flag word; gaps are allowed (an
 * undefined entry just leaves its bit clear), and channels beyond index 6 have no bit on the
 * client, so they are dropped instead of silently corrupting the packet.
 *
 * `readMobEnterField` returns a dense array of `MOB_CHANNEL_COUNT` entries whenever the flag word
 * is non-zero (and no `channels` at all when it is zero), so the gaps are visible to callers.
 */
export interface MobEnterField {
  /** Pool key, unique inside the field. Server-chosen: nothing in the client requires a range. */
  mobId: number;
  /** `Mob/0120100.img` -> 1210100, i.e. the id from the WZ `life` list. */
  templateId: number;
  x: number;
  y: number;
  /** `u8`, only bit 0 is read: 0 = right, 1 = left. */
  facing: number;
  /** First `u16` of the two lookup-only fields. Meaning open; 0 is a handled miss. */
  unknownA?: number;
  /** Second `u16` of the two lookup-only fields. Meaning open; 0 is a handled miss. */
  unknownB?: number;
  /** Animation channels; index `i` is flag bit `1 << i` (7 channels exist). */
  channels?: (MobChannel | undefined)[];
}

/** Number of animation channels the client's flag word has room for (`sub_4C6CE0`). */
export const MOB_CHANNEL_COUNT = 7;

/** `0x31` flag: the mob is (still) there. An unknown id is created from the rest of the packet. */
export const MOB_PRESENCE_KEEP = 1;

/** `0x31` flag: the mob is gone (`sub_491830`). */
export const MOB_PRESENCE_REMOVE = 0;

/** The tail both spawn forms share: everything after `mobId` and (for 0x31) `templateId`. */
export type MobSpawnTail = Omit<MobEnterField, "mobId" | "templateId">;

function writeS16(writer: PacketWriter, value: number): void {
  writer.writeU16(value & 0xffff);
}

function readS16(reader: PacketReader): number {
  return (reader.readU16() << 16) >> 16;
}

/** The `CMob::Init` body of `0x2F` and of `0x31 flag != 0` - the same bytes, read by one function. */
function writeMobSpawnTail(writer: PacketWriter, body: MobSpawnTail): void {
  writeS16(writer, body.x);
  writeS16(writer, body.y);
  writer.writeByte(body.facing & 0xff);
  writer.writeU16(body.unknownA ?? 0);
  writer.writeU16(body.unknownB ?? 0);
  writeMobChannels(writer, body.channels);
}

/** The `sub_4C6CE0` block: a `u32` of channel flags, then `s16 index` + `s16 delay` per set bit. */
function writeMobChannels(writer: PacketWriter, channels: (MobChannel | undefined)[] | undefined): void {
  let flags = 0;
  const list: (MobChannel | undefined)[] = channels ?? [];
  for (let i = 0; i < MOB_CHANNEL_COUNT; i++) {
    if (list[i] !== undefined) flags |= 1 << i;
  }
  writer.writeU32(flags >>> 0);
  for (let i = 0; i < MOB_CHANNEL_COUNT; i++) {
    const channel = list[i];
    if (channel === undefined) continue;
    writeS16(writer, channel.index);
    writeS16(writer, channel.delay);
  }
}

/** Read a `sub_4C6CE0` block. Returns `undefined` when the flag word is 0 (no channels at all). */
function readMobChannels(reader: PacketReader): (MobChannel | undefined)[] | undefined {
  const flags = reader.readU32();
  if (flags === 0) return undefined;
  // Dense on purpose: the gaps are the channels the client switched off (see `MobEnterField`).
  const channels: (MobChannel | undefined)[] = [];
  for (let i = 0; i < MOB_CHANNEL_COUNT; i++) {
    channels.push((flags & (1 << i)) === 0 ? undefined : { index: readS16(reader), delay: readS16(reader) });
  }
  return channels;
}

/** The body of one `0x35` (mob animation) packet: the field entry's animation block, nothing else. */
export interface MobAnim {
  /** Pool key; an id the client does not know makes the packet a no-op (the handler returns early). */
  mobId: number;
  /** Channel `i` is flag bit `1 << i`; `undefined` leaves that channel alone. */
  channels?: (MobChannel | undefined)[];
}

/** Encode one `0x35` packet, opcode byte included. */
export function encodeMobAnim(body: MobAnim): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(MOB_OPCODE.anim);
  writer.writeU32(body.mobId >>> 0);
  writeMobChannels(writer, body.channels);
  return writer.toBytes();
}

/** Read the fields of a `0x35` body (no opcode byte; the reader must sit at `mobId`). */
export function readMobAnim(reader: PacketReader): MobAnim {
  const mobId = reader.readU32();
  const channels = readMobChannels(reader);
  return channels === undefined ? { mobId } : { mobId, channels };
}

/** Encode one `0x2F` packet, opcode byte included (the convention `encodeSetField` uses). */
export function encodeMobEnterField(body: MobEnterField): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(MOB_OPCODE.enterField);
  writer.writeU32(body.mobId >>> 0);
  writer.writeU32(body.templateId >>> 0);
  writeMobSpawnTail(writer, body);
  return writer.toBytes();
}

/**
 * Encode one `0x31 flag != 0` packet: a monster appears.
 *
 * The tail is byte-for-byte the body of `0x2F`: `sub_491630` reads `u32 templateId` and then calls
 * `CMob::Init` on the rest of the packet. It ends with `sub_485330(mob, 1)` (the flash) and sets the
 * mob's state to 4, so a mob that arrives this way is already in the state its hit animation needs
 * (see the header). Use it for respawns; `0x2F` is the form for the batch a field entry sends.
 */
export function encodeMobAppear(mobId: number, templateId: number, tail: MobSpawnTail): Uint8Array {
  const writer = new PacketWriter(40);
  writer.writeByte(MOB_OPCODE.presence);
  writer.writeByte(MOB_PRESENCE_KEEP);
  writer.writeU32(mobId >>> 0);
  writer.writeU32(templateId >>> 0);
  writeMobSpawnTail(writer, tail);
  return writer.toBytes();
}

/** Encode one `0x31 flag == 0` packet: this mob is gone (the corpse of a dead one included). */
export function encodeMobRemove(mobId: number): Uint8Array {
  const writer = new PacketWriter(8);
  writer.writeByte(MOB_OPCODE.presence);
  writer.writeByte(MOB_PRESENCE_REMOVE);
  writer.writeU32(mobId >>> 0);
  return writer.toBytes();
}

/** Encode one `0x30` packet: the mob starts dying `delayMs` from now. */
export function encodeMobLeaveDelayed(body: MobLeaveDelayed): Uint8Array {
  const writer = new PacketWriter(8);
  writer.writeByte(MOB_OPCODE.leaveDelayed);
  writer.writeU32(body.mobId >>> 0);
  writeS16(writer, body.delayMs);
  return writer.toBytes();
}

/** Encode one `0x34` packet: the mob's MP (and, with it, "this mob is in its flash state"). */
export function encodeMobStat(body: MobStat): Uint8Array {
  const writer = new PacketWriter(8);
  writer.writeByte(MOB_OPCODE.stat);
  writer.writeU32(body.mobId >>> 0);
  writer.writeU16(body.mp & 0xffff);
  return writer.toBytes();
}

/** The body of one `0x30` (mob leave, delayed) packet. */
export interface MobLeaveDelayed {
  /** Pool key, the same id `0x2F` handed out. */
  mobId: number;
  /**
   * ms until the die animation starts. `0` = now, which is what a kill wants; a negative value means
   * "remove it at once" instead (`sub_491AB0(..., 0)`), which the client skips while the mob is still
   * animating.
   */
  delayMs: number;
}

/** The body of one `0x34` (mob stat) packet. */
export interface MobStat {
  mobId: number;
  /**
   * The mob's MP, `u16` - `sub_488D90` stores it in `mob+132`, the value the attack picker compares
   * against each attack's `conMP`. Nothing in the client reads it as HP.
   */
  mp: number;
}

/** Read the `0x31` header: the flag and the mob id. The tail is only there for an unknown id. */
export function readMobPresence(reader: PacketReader): { flag: number; mobId: number } {
  const flag = reader.readByte();
  const mobId = reader.readU32();
  return { flag, mobId };
}

/** Read the fields of a `0x30` body (no opcode byte; the reader must sit at `mobId`). */
export function readMobLeaveDelayed(reader: PacketReader): MobLeaveDelayed {
  const mobId = reader.readU32();
  return { mobId, delayMs: readS16(reader) };
}

/** Read the fields of a `0x34` body (no opcode byte; the reader must sit at `mobId`). */
export function readMobStat(reader: PacketReader): MobStat {
  const mobId = reader.readU32();
  return { mobId, mp: reader.readU16() };
}

/** Read the fields of a `0x2F` body (no opcode byte; `PacketReader` must sit at `mobId`). */
export function readMobEnterField(reader: PacketReader): MobEnterField {
  const mobId = reader.readU32();
  const templateId = reader.readU32();
  const x = readS16(reader);
  const y = readS16(reader);
  const facing = reader.readByte();
  const unknownA = reader.readU16();
  const unknownB = reader.readU16();
  const body: MobEnterField = { mobId, templateId, x, y, facing, unknownA, unknownB };
  const channels = readMobChannels(reader);
  if (channels !== undefined) body.channels = channels;
  return body;
}

/**
 * The body of one `0x33` (mob move) packet: everything `sub_488BC0` reads after the mob id.
 *
 * `value` is only handed to `sub_488E30` and only for the attack actions (10..12); for a walking or
 * standing mob nothing reads it, so 0 is the value to send (see the header for the disassembly).
 */
export interface MobMove {
  /** `u8`: only the sign matters - bit 7 set means "keep the animation that is running". */
  actionByte: number;
  /**
   * `u32`, open meaning: it reaches `sub_488E30(mob, action, facing, value)` for attack actions only.
   * The field itself is *not* optional - it is read before the branch, before the path.
   */
  value: number;
  /** The path this mob is walking (`CMovePath`, 4.11.5). One element is one leg. */
  path: MovePath;
}

/** Encode one `0x33` packet, opcode byte included. */
export function encodeMobMove(mobId: number, body: MobMove): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(MOB_OPCODE.move);
  writer.writeU32(mobId >>> 0);
  writer.writeByte(body.actionByte & 0xff);
  writer.writeU32(body.value >>> 0);
  writeMovePath(writer, body.path);
  return writer.toBytes();
}

/** Read the fields of a `0x33` body (no opcode byte; the reader must sit at `mobId`). */
export function readMobMove(reader: PacketReader): { mobId: number; body: MobMove } {
  const mobId = reader.readU32();
  const actionByte = reader.readByte();
  const value = reader.readU32();
  const path = readMovePath(reader);
  return { mobId, body: { actionByte, value, path } };
}

/**
 * One line describing a `0x35` packet body, for logs and `decode`.
 *
 * The channel *names* are not proven (the client keeps them as plain `(index, delay)` pairs), so the
 * index is printed as the number it is.
 */
export function describeMobAnim(body: MobAnim): string {
  const channels = (body.channels ?? [])
    .map((channel, index) => (channel === undefined ? undefined : `${index}=(${channel.index},${channel.delay})`))
    .filter((text): text is string => text !== undefined);
  return `mobId=${body.mobId} channels=${channels.length === 0 ? "none" : channels.join(" ")}`;
}

/** One line describing a `0x33` packet body, for logs and `decode`. */
export function describeMobMove(mobId: number, body: MobMove): string {
  const action = mobActionName(body.actionByte) ?? "keep";
  const facing = body.actionByte & 1;
  const first = body.path.elements[0];
  const where = first === undefined ? "no path" : `-> (${first.x},${first.y}) in ${first.duration}ms`;
  return (
    `mobId=${mobId} action=${action}(${(body.actionByte >> 1) & 0x0f}) facing=${facing} ` +
    `legs=${body.path.elements.length} ${where}`
  );
}

/** One line describing a `0x2F` packet body, for logs and `decode`. */
export function describeMobEnterField(body: MobEnterField): string {
  const channels = (body.channels ?? []).filter((channel) => channel !== undefined).length;
  return (
    `mobId=${body.mobId} template=${body.templateId} at (${body.x},${body.y}) ` +
    `facing=${body.facing & 1} animChannels=${channels}`
  );
}

/** One line describing a `0x30` packet body, for logs and `decode`. */
export function describeMobLeaveDelayed(body: MobLeaveDelayed): string {
  const when = body.delayMs < 0 ? "removed at once" : `the die animation starts in ${body.delayMs}ms`;
  return `mobId=${body.mobId} leave: ${when}`;
}

/** One line describing a `0x31` header, for logs and `decode`. */
export function describeMobPresence(flag: number, mobId: number): string {
  return `mobId=${mobId} presence=${flag === MOB_PRESENCE_REMOVE ? "removed" : "kept (created if unknown)"}`;
}

/** One line describing a `0x34` packet body, for logs and `decode`. */
export function describeMobStat(body: MobStat): string {
  return `mobId=${body.mobId} mp=${body.mp}`;
}
