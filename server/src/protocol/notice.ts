import { PacketReader, PacketWriter } from "./packet.ts";
/** 55CDE0 always reads type AND CP949 string. 0 goes to StatusBar font5; 1 opens
 * CUtilDlg1000 (52BBE0 -> 52C320), NOT a banner. Other type values consume text but do nothing.
 */
export const SYSTEM_NOTICE_OPCODE = 0x13;
export interface SystemNotice {
  type: number;
  text: Uint8Array;
}
export function readSystemNotice(reader: PacketReader): SystemNotice {
  const type = reader.readByte(),
    text = reader.readStringBytes();
  return { type, text };
}
export function encodeSystemNotice(text: Uint8Array, type: 0 | 1 = 0): Uint8Array {
  if (type !== 0 && type !== 1)
    throw new RangeError("Only chat0 and notice-dialog1 are supported send types");
  const writer = new PacketWriter(text.length + 4);
  writer.writeByte(SYSTEM_NOTICE_OPCODE);
  writer.writeByte(type);
  writer.writeStringBytes(text);
  return writer.toBytes();
}
