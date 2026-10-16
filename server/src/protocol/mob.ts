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
 * What the opcode names itself (0x2E "mob enter" family, 0x31 move, 0x32-0x36 lookups) comes from
 * FINDINGS 4.12 and is *not* implemented: only 0x2F has a byte-exact layout, so only 0x2F is
 * encoded here.
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** `CMobPool` opcodes with a located handler (`sub_492330`). */
export const MOB_OPCODE = {
  /**
   * `CMobPool` 0x2F (`sub_4924A0`): mob enter field. Body below, in `MobEnterField` order.
   */
  enterField: 0x2f,
  /** `CMobPool` 0x30 (`sub_4926B0`): `u32 mobId` + `s16`; the pair is queued for later processing. */
  queueMobEvent: 0x30,
  /** `CMobPool` 0x31 (`sub_4927B0`): `u8 flag` + `u32 mobId`, then a `CMovePath` (4.11.5). */
  move: 0x31,
} as const;

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

function writeS16(writer: PacketWriter, value: number): void {
  writer.writeU16(value & 0xffff);
}

function readS16(reader: PacketReader): number {
  return (reader.readU16() << 16) >> 16;
}

/** Encode one `0x2F` packet, opcode byte included (the convention `encodeSetField` uses). */
export function encodeMobEnterField(body: MobEnterField): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(MOB_OPCODE.enterField);
  writer.writeU32(body.mobId >>> 0);
  writer.writeU32(body.templateId >>> 0);
  writeS16(writer, body.x);
  writeS16(writer, body.y);
  writer.writeByte(body.facing & 0xff);
  writer.writeU16(body.unknownA ?? 0);
  writer.writeU16(body.unknownB ?? 0);
  let flags = 0;
  const channels: (MobChannel | undefined)[] = body.channels ?? [];
  for (let i = 0; i < MOB_CHANNEL_COUNT; i++) {
    if (channels[i] !== undefined) flags |= 1 << i;
  }
  writer.writeU32(flags >>> 0);
  for (let i = 0; i < MOB_CHANNEL_COUNT; i++) {
    const channel = channels[i];
    if (channel === undefined) continue;
    writeS16(writer, channel.index);
    writeS16(writer, channel.delay);
  }
  return writer.toBytes();
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
  const flags = reader.readU32();
  const body: MobEnterField = { mobId, templateId, x, y, facing, unknownA, unknownB };
  if (flags !== 0) {
    // Dense on purpose: a sparse array would make `channels.map(...)` and JSON.stringify skip the
    // gaps, and the gaps are exactly the channels the client switched off.
    const channels: (MobChannel | undefined)[] = [];
    for (let i = 0; i < MOB_CHANNEL_COUNT; i++) {
      channels.push((flags & (1 << i)) === 0 ? undefined : { index: readS16(reader), delay: readS16(reader) });
    }
    body.channels = channels;
  }
  return body;
}

/** One line describing a `0x2F` packet body, for logs and `decode`. */
export function describeMobEnterField(body: MobEnterField): string {
  const channels = (body.channels ?? []).filter((channel) => channel !== undefined).length;
  return (
    `mobId=${body.mobId} template=${body.templateId} at (${body.x},${body.y}) ` +
    `facing=${body.facing & 1} animChannels=${channels}`
  );
}
