import { PacketReader, PacketWriter } from "./packet.ts";
/** CWvsApp 55CDE0: opcode0x13, type0, CP949 string -> [공지사항] text, StatusBar font5.
 * Center notices (type1 -> 52BBE0) deliberately remain unsupported here, not fake modal dialogs.
 */
export const SYSTEM_NOTICE_OPCODE = 0x13;
export function readSystemNotice(reader: PacketReader): { text: Uint8Array } {
  if (reader.readByte() !== 0) throw new RangeError("only type0 chat notices are implemented");
  return { text: reader.readStringBytes() };
}
export function encodeSystemNotice(text: Uint8Array): Uint8Array {
  const writer = new PacketWriter(text.length + 4);
  writer.writeByte(SYSTEM_NOTICE_OPCODE);
  writer.writeByte(0);
  writer.writeStringBytes(text);
  return writer.toBytes();
}
