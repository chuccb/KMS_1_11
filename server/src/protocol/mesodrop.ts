/** Original CUIItem coin button: 4DAF70 -> 55D5F0, opcode31 + u32 amount.
 * Sender checks HP, CWvsApp pending and 200ms. Server bounds follow the native input dialog.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
export const MESO_DROP_OPCODE = 0x1f;
export const MESO_DROP_MIN = 10;
export const MESO_DROP_MAX = 50_000;
export const MESO_DROP_INTERVAL_MS = 200;
export function encodeMesoDrop(amount: number): Uint8Array {
  if (!Number.isInteger(amount) || amount < MESO_DROP_MIN || amount > MESO_DROP_MAX)
    throw new RangeError("meso drop must be an integer from 10 through 50000");
  return new PacketWriter(5).writeByte(MESO_DROP_OPCODE).writeU32(amount).toBytes();
}
export function readMesoDrop(reader: PacketReader): number {
  const amount = reader.readU32();
  if (!reader.exhausted) throw new Error("meso drop must contain exactly one u32");
  return amount;
}
export function describeMesoDrop(amount: number): string {
  return `0x1f drop ${amount} mesos`;
}
