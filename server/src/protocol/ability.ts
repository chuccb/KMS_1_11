/** CUIStat::OnButtonClicked sub_4F2D70 -> sub_55CF60: c2s 27, one u32 stat mask.
 * Not attack: melee is c2s 0x0F. MaxHP/MaxMP masks are located but their server growth is not. */
import { PacketReader, PacketWriter } from "./packet.ts";
export const ABILITY_REQUEST_OPCODE = 0x1b;
export const ABILITY_MASK = {
  str: 0x40,
  dex: 0x80,
  int: 0x100,
  luk: 0x200,
  maxHp: 0x800,
  maxMp: 0x2000,
} as const;
export type BaseAbility = "str" | "dex" | "int" | "luk";
export function encodeAbilityRequest(field: BaseAbility): Uint8Array {
  const mask = ABILITY_MASK[field];
  if (mask === undefined || !["str", "dex", "int", "luk"].includes(field))
    throw new Error("unsupported base ability");
  return new PacketWriter(5)
    .writeByte(ABILITY_REQUEST_OPCODE)
    .writeU32(mask)
    .toBytes();
}
export function readAbilityRequest(reader: PacketReader): number {
  const mask = reader.readU32();
  if (!reader.exhausted)
    throw new Error("AP request must contain exactly one u32 mask");
  return mask;
}

export function describeAbilityRequest(mask: number): string {
  const field = Object.entries(ABILITY_MASK).find(
    ([, value]) => value === mask,
  )?.[0];
  return `0x1b AP request: ${field ?? "unsupported"} mask=0x${mask.toString(16)}`;
}
