/**
 * `CMovePath` - the movement description that rides in the user-move packet.
 *
 * EVIDENCE (MapleStory.exe.c, see docs/protocol/FINDINGS.md 4.11)
 * ---------------------------------------------------------------
 * Reader: `sub_4953A0(CMovePath* this, packet)` - called by `CVecCtrlUser::OnMove` (`sub_4967C0`,
 * itself the opcode 0x22 branch of `CUserPool::OnPacket` = `sub_51D590`). It reads, in order:
 *
 *   u16 -> *(this + 4)                        (word index 2 of a `_WORD*` = byte offset 4)
 *   u16 -> *(this + 6)
 *   u8  count, then `count` copies of a 16-byte element pushed onto the list at `this + 24`
 *
 * Element writes, exactly as the decompiler shows them (`v14` = the new element):
 *
 *   byte  *((_BYTE *)v14)      = u8            +0   (`sub_45DC40` - a plain u8 read)
 *   word  *((_WORD *)v14 + 1)  = u16           +2   ┐
 *   word  *((_WORD *)v14 + 2)  = u16           +4   │ all four via `sub_45DC80`, a plain u16 read
 *   word  *((_WORD *)v14 + 3)  = u16           +6   │
 *   word  *((_WORD *)v14 + 4)  = u16           +8   ┘
 *   byte  *((_BYTE *)v14 + 10) = u8            +10  (`sub_45DC40`)
 *   word  *((_WORD *)v14 + 6)  = u16           +12  (`sub_45DC80`)
 *   word  *((_WORD *)v14 + 7)  = u16           +14  (`sub_45DD80` - same plain u16 read)
 *
 * Those offsets are the *client's in-memory* struct, which is 16 bytes long with holes at +1 and
 * +11. The wire form has no holes: `CMovePath::Encode` (`sub_495620`, found via
 * `CVecCtrlUser::SendMove` = `sub_542C40`) appends `u16 originX, u16 originY, u8 count` and then,
 * per element, `sub_431DE0` + a store for exactly `attr, x, y, vx, vy, action, foothold, duration`
 * - 1+2+2+2+2+1+2+2 = **14 bytes**, with the list walk in between. So the decoder's `+2/+4/...`
 * offsets are struct offsets, not wire offsets, and an element is 14 bytes on the wire.
 *
 * One more confirmation comes from `sub_495880`, which decides whether the current element is
 * worth sending: it compares `element+2` with the live x, `element+4` with the live y, `element+6`
 * and `element+8` with 0, `element+12` with the live foothold and `element+10` with the live
 * action - the element copy the vecctrl plays back sits at `CMovePath + 32`, hence the
 * `vecctrl + 250/252/254/256/258/260` reads in `sub_485330` / `sub_499760`.
 *
 * WHAT THE FIELDS MEAN (two independent call sites settle it)
 * -----------------------------------------------------------
 * `CVecCtrl::Update` advances to the next element and calls vtable slot 46 (offset +184) with
 * `(vecctrl, 1, x, y, vx, vy, action, foothold)`:
 *
 *   sub_485330  `.c 140363`:  foothold = sub_485400(field, *(__int16 *)(v2 + 260))
 *                             call args = *(__int16 *)(v2 + 250), +252, +254, +256, *(u8*)(v2 + 258)
 *   sub_499760  `.c 162019`:  same pattern with `v5 + 250 .. +260`
 *
 * `v2` is the CVecCtrl (`user+52`); the embedded CMovePath starts at `vecctrl + 216`, and the
 * decoded element is copied to `CMovePath + 32` (`sub_4967C0`). Therefore
 * 250 - 216 - 32 = +2, 252 -> +4, 254 -> +6, 256 -> +8, 258 -> +10, 260 -> +12: the
 * argument order (arg2..arg7) maps to element offsets 2, 4, 6, 8, 10, 12.
 *
 * The enter-field packet (`CUserRemote::Init`, `sub_520680`) calls the same vtable slot with
 * `(vecctrl, 0, x, y, 0, 0, stance, foothold)` where x/y came from two u16s and stance from the
 * packet's u8 - so arg2/arg3 are the position, arg6 is the action/stance byte and arg7 is a
 * foothold id (`sub_485400(this_7, id)` = the field's foothold lookup).
 *
 * And the last u16? `CVecCtrlUser::OnMove` sums `*(__int16 *)(element + 14)` for every element of
 * the path into `CMovePath + 68` and compares the total against 1000/1100 ms (turning that into
 * the 30/33 the play-back uses), so +14 is the per-element **duration in ms**.
 *
 * -> element = { attr u8, x s16, y s16, vx s16, vy s16, action u8, foothold u16, duration u16 }
 *
 * `attr` (offset 0) is a bit field: 537B00 stages external force with 495D60(attr=2), which ORs
 * it into the current record. 4967C0 uses 1 for its synthetic stale-path record. The located
 * playback reads do not turn bit2 into a damage/emotion event; do not invent such a broadcast.
 * The browser retains bit2 until its existing 100ms snapshot is published (not native 30ms batching).
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** Bytes per move element on the wire (see the header: the 16-byte struct minus its two holes). */
export const MOVE_ELEMENT_BYTES = 14;

/** The u8 count field limits a path to 255 elements. */
export const MOVE_ELEMENT_LIMIT = 0xff;

/** One element of a move path. All integers are signed where the client signs them. */
export interface MoveElement {
  /** Attribute bits: 2 marks staged external force (537B00); 1 is the synthetic stale-path record. */
  attr: number;
  /**
   * Where this element starts. These four are `s16` on the wire in the sense that the client
   * reads them into `__int16` variables; the wire format itself is plain little-endian.
   */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The action/stance byte the vecctrl is put into for this element (arg6 of vtable slot 46). */
  action: number;
  /** Foothold id, looked up with the field's `sub_485400` before the vecctrl is moved. */
  foothold: number;
  /** Frame duration in ms; `CVecCtrlUser::OnMove` sums these into `CMovePath + 68`. */
  duration: number;
}

/** A whole `CMovePath` as it arrives in the user-move packet. */
export interface MovePath {
  /**
   * The two u16s in front of the element count. `CVecCtrlUser::OnMove` saves the CMovePath fields
   * at +4/+6 and restores them right after the decoder returns, so these are not the user's live
   * position; what they are for is not proven. The first element's x/y is the position the server
   * should trust (it is what the vecctrl is moved to).
   */
  originX: number;
  originY: number;
  elements: MoveElement[];
}

function toS16(value: number): number {
  return (value << 16) >> 16;
}

/** Reads one 16-byte element. */
function readElement(reader: PacketReader): MoveElement {
  const attr = reader.readByte();
  const x = toS16(reader.readU16());
  const y = toS16(reader.readU16());
  const vx = toS16(reader.readU16());
  const vy = toS16(reader.readU16());
  const action = reader.readByte();
  const foothold = reader.readU16();
  const duration = reader.readU16();
  return { attr, x, y, vx, vy, action, foothold, duration };
}

function writeElement(writer: PacketWriter, element: MoveElement): void {
  writer.writeByte(element.attr & 0xff);
  writer.writeU16(element.x & 0xffff);
  writer.writeU16(element.y & 0xffff);
  writer.writeU16(element.vx & 0xffff);
  writer.writeU16(element.vy & 0xffff);
  writer.writeByte(element.action & 0xff);
  writer.writeU16(element.foothold & 0xffff);
  writer.writeU16(element.duration & 0xffff);
}

/** Reads a `CMovePath` from the reader's current position (the opcode and user id are already gone). */
export function readMovePath(reader: PacketReader): MovePath {
  const originX = toS16(reader.readU16());
  const originY = toS16(reader.readU16());
  const count = reader.readByte();
  const elements: MoveElement[] = [];
  for (let i = 0; i < count; i += 1) elements.push(readElement(reader));
  return { originX, originY, elements };
}

/** Writes a `CMovePath`. Refuses a path the client could not have sent. */
export function writeMovePath(writer: PacketWriter, path: MovePath): void {
  if (path.elements.length > MOVE_ELEMENT_LIMIT) {
    throw new RangeError(`a move path carries at most ${MOVE_ELEMENT_LIMIT} elements, got ${path.elements.length}`);
  }
  writer.writeU16(path.originX & 0xffff);
  writer.writeU16(path.originY & 0xffff);
  writer.writeByte(path.elements.length);
  for (const element of path.elements) writeElement(writer, element);
}

/** The position a path starts from, i.e. where the vecctrl will be moved to first. */
export function pathStart(path: MovePath): { x: number; y: number } | undefined {
  const first = path.elements[0];
  return first === undefined ? undefined : { x: first.x, y: first.y };
}
