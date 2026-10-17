/** sub_55D140 sends 29 + u32 id. CWvsApp case14 -> sub_55B6A0 reads ack,u16 count,(u32 id,s32 level)*.
 * A nonzero ack releases the native gate; level<=0 removes the skill. No expiry/master-level fields.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
export const SKILL_REQUEST_OPCODE = 0x1d;
export const SKILL_UPDATE_OPCODE = 0x0e;
export interface SkillChange {
  skillId: number;
  level: number;
}
export interface SkillUpdate {
  ack: boolean;
  changes: SkillChange[];
}
export function encodeSkillRequest(skillId: number): Uint8Array {
  if (!Number.isInteger(skillId) || skillId <= 0 || skillId > 0x7fffffff)
    throw new RangeError("invalid skill id");
  return new PacketWriter(5)
    .writeByte(SKILL_REQUEST_OPCODE)
    .writeU32(skillId)
    .toBytes();
}
export function readSkillRequest(reader: PacketReader): number {
  const skillId = reader.readU32();
  if (!reader.exhausted)
    throw new Error("skill request must contain exactly one u32 id");
  return skillId;
}
export function encodeSkillUpdate(update: SkillUpdate): Uint8Array {
  if (update.changes.length > 0xffff)
    throw new RangeError("too many skill changes");
  const writer = new PacketWriter()
    .writeByte(SKILL_UPDATE_OPCODE)
    .writeByte(update.ack ? 1 : 0)
    .writeU16(update.changes.length);
  for (const change of update.changes) {
    if (
      !Number.isInteger(change.skillId) ||
      change.skillId < 0 ||
      change.skillId > 0xffffffff ||
      !Number.isInteger(change.level) ||
      change.level < -0x80000000 ||
      change.level > 0x7fffffff
    )
      throw new RangeError("invalid skill update");
    writer.writeU32(change.skillId).writeU32(change.level >>> 0);
  }
  return writer.toBytes();
}
export function readSkillUpdate(reader: PacketReader): SkillUpdate {
  const ack = reader.readByte() !== 0,
    count = reader.readU16(),
    changes: SkillChange[] = [];
  for (let i = 0; i < count; i++)
    changes.push({ skillId: reader.readU32(), level: reader.readU32() | 0 });
  if (!reader.exhausted) throw new Error("trailing skill-update bytes");
  return { ack, changes };
}
export function describeSkillRequest(skillId: number): string {
  return `0x1d skill-up: skillId=${skillId}`;
}

export function describeSkillUpdate(update: SkillUpdate): string {
  return `0x0e skills: ack=${update.ack ? 1 : 0} ${update.changes.map((c) => `${c.skillId}=${c.level}`).join(", ")}`;
}
