/** PE 55D320: c2s 30 decimal, u32 id/u8 level/u8 count/u32[count] user IDs.
 * 0x1D is SP, and 0x1F is a merchant request (55D5F0), NOT skill cancellation.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
export const CLIENT_SKILL_USE_OPCODE = 0x1e;
export interface ClientSkillUse {
  skillId: number;
  level: number;
  targets: number[];
}
export function readClientSkillUse(reader: PacketReader): ClientSkillUse {
  const skillId = reader.readU32(),
    level = reader.readByte(),
    count = reader.readByte();
  if (count > 6) throw new RangeError("skill recipient count exceeds native party size");
  const targets = Array.from({ length: count }, () => reader.readU32());
  if (reader.remaining) throw new RangeError("trailing skill-use bytes");
  return { skillId, level, targets };
}
export function encodeClientSkillUse(value: ClientSkillUse): Uint8Array {
  if (
    !Number.isInteger(value.skillId) ||
    value.skillId <= 0 ||
    value.skillId > 0xffffffff ||
    !Number.isInteger(value.level) ||
    value.level < 1 ||
    value.level > 255 ||
    value.targets.length > 6 ||
    value.targets.some((id) => !Number.isInteger(id) || id <= 0 || id > 0xffffffff)
  )
    throw new RangeError("invalid skill use");
  const writer = new PacketWriter(8 + 4 * value.targets.length);
  writer.writeByte(CLIENT_SKILL_USE_OPCODE);
  writer.writeU32(value.skillId);
  writer.writeByte(value.level);
  writer.writeByte(value.targets.length);
  for (const id of value.targets) writer.writeU32(id);
  return writer.toBytes();
}
