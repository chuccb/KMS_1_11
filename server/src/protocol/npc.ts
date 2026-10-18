/**
 * The NPC pool: the packets that put an NPC on a field, take it away, and change its state.
 *
 * This is the `CNpcPool` range of the field (`0x38`..`0x41`), the same shape as `CMobPool`
 * (`protocol/mob.ts`): an object pool with a ZMap keyed by the object id, and the enter packet
 * carrying the template id *only for an id the pool does not have yet*, followed by the body that
 * places the NPC. All of it is **server -> client**: an NPC exists because the server said so.
 * The client can report idle action/speech with 0x2F (49A3C0), or send a *click* (`0x33`, `sub_55AF20`; the same packet the shop
 * opens on, FINDINGS 4.22) - the click carries the pool id this file hands out, and the server then
 * answers with a shop (`0x4A`) or a dialog (`0x47`, FINDINGS 4.23).
 *
 * EVIDENCE (MapleStory.exe.c)
 * ---------------------------
 * `sub_472770` (121118-121200) sends `0x38`..`0x41` to `sub_49F560(0x5C2050, opcode, packet)`
 * (the global's constructor is `sub_49F020`). `sub_49F560` (168299-168317) dispatches:
 *
 *   `0x39` -> `sub_49F6C0`   an NPC appears    (168400-168475)
 *   `0x3A` -> `sub_49F810`   an NPC goes away  (168478-168595)
 *   `0x3B` -> `sub_49F970`   an NPC state flag (168598-168631)
 *   `0x3C`..`0x40` -> `sub_49F5B0` (168320-168340), which reads a `u32` id, looks it up, and for
 *                    `0x3D` *only* calls `sub_49A280(npc, packet)`; `0x3C`/`0x3E`/`0x3F`/`0x40` read
 *                    the id and do nothing else.
 *
 * `0x39` (`sub_49F6C0`), field for field:
 *
 *   u32 npcId        the pool key. `sub_492C00`-style ZMap lookup (`__ROR4__(id,5) % this[3]`).
 *                    **A hit ends the packet**: the NPC's `+24` byte gets bit 0 set and nothing else
 *                    is read - the same "a known id is a refresh" rule as `0x2F`.
 *   --- only while the id is unknown:
 *   u32 templateId   `sub_49CB30(id)` (165481-165518) is a cached template lookup; the template is
 *                    built from `Npc/%07d.img` (`sub_411E50` at 20269), then `sub_498A20` constructs
 *                    the NPC object from it.
 *   s16 x, s16 y     `sub_498CF0` (161467-161990): stored at `npc+32`/`npc+33` **and** `npc+30`/
 *                    `npc+31` - the "current" pair the `0x2F` body also builds.
 *   u8  facing       `npc+20`.
 *   u16 lookupKey    `sub_489800(pool + 25, &key, &out)`: a ZMap lookup whose result is handed to the
 *                    vecctrl's vtable slot 184 as its last argument; **a miss is handled** (the code
 *                    falls back to a zeroed value), which is the path this server takes.
 *   s16 pointX, s16 pointY   `npc+16`/`npc+17`: a pair handed to `sub_540400` (the vecctrl builder).
 *                    Nothing in the located code names it, so this server sends 0 - the same
 *                    treatment `0x2F`'s two lookup `u16`s get.
 *
 * There is **no animation block** in this packet: the body has exactly six fields (the reader calls
 * in `sub_498CF0` are 2x `sub_45DC80`, `sub_45DC40`, `sub_45DC80`, 2x `sub_45DC80`), against the
 * mob's `0x2F`, which carries a 7-channel animation block. Wire length: `1 + 4` = **5 bytes** for a
 * known id, `1 + 4 + 4 + 2 + 2 + 1 + 2 + 2 + 2` = **20 bytes** for a new one.
 *
 * `0x3A` (`sub_49F810`): `u32 npcId` -> clear bit 0 of `+24`; the entry is unlinked and freed only
 * when the whole byte becomes 0 (bit 1 belongs to `0x3B`). Wire: **5 bytes**.
 *
 * `0x3B` (`sub_49F970`): `u8 flag` + `u32 npcId`, **both read unconditionally**:
 *
 *   flag != 0 -> `sub_49F260` (168057-168116): bit 1 set + `sub_499760(vecctrl, 1)`. For an unknown
 *                id it creates the NPC exactly like `0x39` but with `+24 = 2` and then calls the same
 *                `sub_499760(..., 1)`.
 *   flag == 0 -> `sub_49F380` (168119-168228): bit 1 cleared + `sub_499760(vecctrl, 0)`.
 *
 * The flag enables/disables this client's CVecCtrl/controller (499760), NOT a movement command.
 * It arms rand()%8000+4000 and resets in-flight state. Stationary NPCs use it for idle speech/actions
 * too (499D60 -> 49A0C0 -> 49A3C0). Only templates with move append CMovePath to 0x2F/0x3D.
 * 49A0C0 / 49A280 disagree about extra-action indices; see docs/NATIVE_NPC_BEHAVIOR.md.
 *
 * Wire: **6 bytes** for an id the pool already has; for an unknown id the `flag != 0` branch reads the
 * *same* tail `0x39` does (templateId + the six fields), so that form is 21 bytes including its additional flag byte. This server
 * always creates with `0x39` and only toggles known ids, which is why `encodeNpcState` has no "create"
 * form - inventing one without a caller would be dead code with a guessed field meaning.
 */
import { PacketReader, PacketWriter } from "./packet.ts";
import {readMovePath,writeMovePath,type MovePath} from "./movepath.ts";

/** The `CNpcPool` opcodes with a located handler (`sub_49F560`). */
export const NPC_OPCODE = {
  /** `0x39`: an NPC appears (`sub_49F6C0`); a known id only refreshes it. */
  enterField: 0x39,
  /** `0x3A`: an NPC goes away (`sub_49F810`). */
  leaveField: 0x3a,
  /** `0x3B`: the NPC's second state on/off (`sub_49F970`). */
  stateToggle: 0x3b,
  /** `0x3D`: the one opcode of `0x3C`..`0x40` that reads more than the id (`sub_49A280`). */
  update: 0x3d,
} as const;

/** One `0x39` (NPC appears). A known id is a refresh: `templateId` and the body are absent. */
export interface NpcEnterField {
  npcId: number;
  /** Only written for an unknown id; the client's own pool decides which form it is. */
  templateId?: number;
  x: number;
  y: number;
  /** 0 = right, 1 = left (the map's `life.f`), the same meaning the mob body gives it. */
  facing: number;
  /**
   * `u16` looked up in a ZMap on the client; a miss is handled, so 0 is the "nothing here" value
   * this server sends (the `0x2F` body's two `u16`s are the same story).
   */
  lookupKey?: number;
  /** `s16` pair (`npc+16`/`npc+17`); nothing located names it, so 0 means "not stated". */
  pointX?: number;
  pointY?: number;
}

function writeSigned16(writer: PacketWriter, value: number): void {
  writer.writeU16(value & 0xffff);
}

function readSigned16(reader: PacketReader): number {
  return (reader.readU16() << 16) >> 16;
}

/** Encode one `0x39`, opcode byte included. */
export function encodeNpcEnterField(npc: NpcEnterField): Uint8Array {
  const writer = new PacketWriter(24);
  writer.writeByte(NPC_OPCODE.enterField);
  writer.writeU32(npc.npcId >>> 0);
  if (npc.templateId === undefined) return writer.toBytes();
  writer.writeU32(npc.templateId >>> 0);
  writeSigned16(writer, npc.x);
  writeSigned16(writer, npc.y);
  writer.writeByte(npc.facing & 1);
  writer.writeU16((npc.lookupKey ?? 0) & 0xffff);
  writeSigned16(writer, npc.pointX ?? 0);
  writeSigned16(writer, npc.pointY ?? 0);
  return writer.toBytes();
}

/**
 * Read one `0x39` body (no opcode byte). `known` says whether the reader should expect the tail:
 * the client's own pool is the only thing that knows, so a caller replaying a capture has to say.
 */
export function readNpcEnterField(reader: PacketReader, known: boolean): NpcEnterField {
  const npcId = reader.readU32();
  if (known) return { npcId, x: 0, y: 0, facing: 0 };
  const templateId = reader.readU32();
  const x = readSigned16(reader);
  const y = readSigned16(reader);
  const facing = reader.readByte();
  const lookupKey = reader.readU16();
  const pointX = readSigned16(reader);
  const pointY = readSigned16(reader);
  return { npcId, templateId, x, y, facing, lookupKey, pointX, pointY };
}

/** One line describing a `0x39`, for logs and `decode`. */
export function describeNpcEnterField(npc: NpcEnterField): string {
  if (npc.templateId === undefined) return `npcId=${npc.npcId} (known id: refresh only)`;
  return (
    `npcId=${npc.npcId} template=${npc.templateId} at (${npc.x},${npc.y}) facing=${npc.facing} ` +
    `lookupKey=${npc.lookupKey ?? 0}`
  );
}

/** Encode one `0x3A` (NPC goes away), opcode byte included. */
export function encodeNpcLeaveField(npcId: number): Uint8Array {
  const writer = new PacketWriter(5);
  writer.writeByte(NPC_OPCODE.leaveField);
  writer.writeU32(npcId >>> 0);
  return writer.toBytes();
}

/** Read the `u32` id of a `0x3A`/`0x3C`..`0x40` body (no opcode byte). */
export function readNpcId(reader: PacketReader): number {
  return reader.readU32();
}

/**
 * Encode one `0x3B`, opcode byte included. `on` = "you control this NPC" (NATIVE_NPC_BEHAVIOR); the flag
 * comes before the id, and the id has to be in the client's pool already (`0x39` first).
 *
 * The known-id form only: the client's create branch is the same tail `0x39` carries, and a server
 * that wants an NPC should say so with `0x39` (`sub_49F260` sets `+24 = 2` directly, i.e. the NPC
 * would be born in its second state - not what a spawn wants).
 */
export function encodeNpcState(npcId: number, on: boolean): Uint8Array {
  const writer = new PacketWriter(6);
  writer.writeByte(NPC_OPCODE.stateToggle);
  writer.writeByte(on ? 1 : 0);
  writer.writeU32(npcId >>> 0);
  return writer.toBytes();
}

/** Read one `0x3B` body (no opcode byte): the flag comes **before** the id. Known ids only. */
export function readNpcState(reader: PacketReader): { npcId: number; on: boolean } {
  const on = reader.readByte() !== 0;
  return { npcId: reader.readU32(), on };
}


/** 49A3C0: u8 opcode2F, u32 npcId, signed action, signed speech, then CMovePath ONLY if the template has move. */
export const CLIENT_NPC_IDLE_OPCODE=0x2f;
export interface NpcIdle {npcId:number;action:number;speech:number;path?:MovePath}
function writeNpcIdle(opcode:number,value:NpcIdle): Uint8Array {
  const out=new PacketWriter(7);out.writeByte(opcode);out.writeU32(value.npcId>>>0);
  out.writeByte(value.action&255);out.writeByte(value.speech&255);
  if(value.path)writeMovePath(out,value.path);return out.toBytes();
}
export const encodeClientNpcIdle=(value:NpcIdle):Uint8Array=>writeNpcIdle(CLIENT_NPC_IDLE_OPCODE,value);
export const encodeNpcIdle=(value:NpcIdle):Uint8Array=>writeNpcIdle(NPC_OPCODE.update,value);
/** 49A280 explicitly sign-extends both bytes. 0xFF is -1, NOT action 255. */
export function readNpcIdle(reader:PacketReader, movable=false): NpcIdle {
  const value:NpcIdle={npcId:reader.readU32(),action:(reader.readByte()<<24)>>24,speech:(reader.readByte()<<24)>>24};
  if(movable)value.path=readMovePath(reader);return value;
}
