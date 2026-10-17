/** Native temporary-stat tail of 0x0D; PE 4C5DC0, 4C6310 and 4CBBD0.
 * Duration FIRST, mask SECOND (older notes had mistaken the duration for flags).
 * The source is ONE u8/u32 pair per application, not one pair per set bit.
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** Native order: value pairs at DWORD offsets 2,8,14,20,26,32,38,44,50,54,58,62. */
export const TEMPORARY_STAT_FIELDS = [
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "hands",
  "speed",
  "jump",
  "unknown200",
  "unknown400",
  "unknown800",
] as const;
export type TemporaryStatName = (typeof TEMPORARY_STAT_FIELDS)[number];
export interface TemporaryStatUpdate {
  /** WZ spec/time is already milliseconds: 2002001 = 180000, NOT 180000 seconds. */
  durationMs: number;
  values: Partial<Record<TemporaryStatName, number>>;
  /** 4CBBD0: nonzero selects the skill icon; zero selects the item icon. */
  sourceIsSkill: boolean;
  sourceId: number;
}
export function temporaryStatMask(
  values: TemporaryStatUpdate["values"],
): number {
  for (const name of Object.keys(values)) {
    if (!(TEMPORARY_STAT_FIELDS as readonly string[]).includes(name))
      throw new RangeError(`Unknown temporary stat ${name}`);
  }
  return TEMPORARY_STAT_FIELDS.reduce(
    (mask, key, i) => (values[key] === undefined ? mask : mask | (1 << i)),
    0,
  );
}
export function writeTemporaryStat(
  writer: PacketWriter,
  update?: TemporaryStatUpdate,
): void {
  if (!update) {
    writer.writeU32(0);
    return;
  }
  const { durationMs, values, sourceId } = update;
  if (
    !Number.isInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 0x7fffffff
  )
    throw new RangeError(
      "Temporary-stat duration must be a positive s32 millisecond interval",
    );
  if (!Number.isInteger(sourceId) || sourceId < 0 || sourceId > 0xffffffff)
    throw new RangeError("Temporary-stat source must fit u32");
  const mask = temporaryStatMask(values);
  writer.writeU32(durationMs).writeU32(mask);
  for (const key of TEMPORARY_STAT_FIELDS) {
    const value = values[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < -32768 || value > 32767)
      throw new RangeError(`Temporary stat ${key} must fit s16`);
    writer.writeU16(value);
  }
  writer.writeByte(update.sourceIsSkill ? 1 : 0).writeU32(sourceId);
}
export function readTemporaryStat(
  reader: PacketReader,
): TemporaryStatUpdate | undefined {
  const durationMs = reader.readU32();
  if (durationMs === 0) return undefined;
  const mask = reader.readU32();
  if ((mask & ~0xfff) !== 0)
    throw new RangeError(`Unknown temporary-stat mask 0x${mask.toString(16)}`);
  const values: TemporaryStatUpdate["values"] = {};
  TEMPORARY_STAT_FIELDS.forEach((key, i) => {
    if (mask & (1 << i)) values[key] = (reader.readU16() << 16) >> 16;
  });
  return {
    durationMs,
    values,
    sourceIsSkill: reader.readByte() !== 0,
    sourceId: reader.readU32(),
  };
}
