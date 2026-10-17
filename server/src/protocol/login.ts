/**
 * Login-stage packets (client -> server), decoded.
 *
 * These are the first things a server sees from a 2003 client, so they are the natural first
 * slice of the schema. Every layout below is taken from the function that *builds* the packet on
 * the client side, which is the strongest evidence available without a live server
 * (docs/protocol/FINDINGS.md 4.5, 4.9).
 *
 *   0x01  sub_4D0B20        [u16 n]id bytes [u16 n]pw bytes   - sub_430230 appends each string
 *   0x02  sub_54DFC0        [u8 worldIndex]                   - CWorldSelect
 *   0x03  sub_431620(1000)  [u32 characterId]                 - CCharSelect "enter the game"
 *   0x04  sub_43A410        [u32 value]                       - right after the 211-byte handshake
 *   0x05  sub_42FD30        [u16 n]name bytes                 - CUINewChar "create"
 *   0x06  sub_431620(1002)  [string name][u32 x10]            - name check + appearance
 *   0x07  sub_431620(1001)  [u32 characterId]                 - CCharSelect "delete"
 *   0x08  sub_43B280        [u32 value]                       - echo: the client resends what it got
 *
 * Which of these a packet means depends on the stage the client is in (docs/protocol/FINDINGS.md
 * 4.9): 0x04 is a handshake reply on a fresh socket and a name-check reply from CCharSelect, and
 * 0x06 is a name check here while the server's 0x06 is a delete result.
 *
 * Unknown opcodes are returned as `unknown` instead of being dropped or thrown away: the protocol
 * is still being mapped, and a server that silently discards a packet cannot be debugged.
 */
import { PacketReader, PacketUnderflowError, PacketWriter } from "./packet.ts";

export const CLIENT_OPCODE = {
  loginRequest: 0x01,
  worldSelect: 0x02,
  selectCharacter: 0x03,
  handshakeReply: 0x04,
  createCharacter: 0x05,
  checkName: 0x06,
  deleteCharacter: 0x07,
  echoReply: 0x08,
} as const;

/** How many `u32` appearance ids the 0x06 request appends after the name (`sub_431620(1002)`). */
export const CHECK_NAME_APPEARANCE_WORDS = 10;

export interface LoginRequestPacket {
  kind: "login-request";
  opcode: typeof CLIENT_OPCODE.loginRequest;
  username: string;
  password: string;
}

export interface WorldSelectPacket {
  kind: "world-select";
  opcode: typeof CLIENT_OPCODE.worldSelect;
  worldId: number;
}

export interface SelectCharacterPacket {
  kind: "select-character";
  opcode: typeof CLIENT_OPCODE.selectCharacter;
  characterId: number;
}

export interface CreateCharacterPacket {
  kind: "create-character";
  opcode: typeof CLIENT_OPCODE.createCharacter;
  name: string;
}

/**
 * The 0x06 request: a name the user typed plus the look of the currently selected character and the
 * dialog's own choices, as ten `u32` ids. The client only sends it once the character list is
 * loaded, and it expects the answer as opcode 0x04 (`string name, s8 result`).
 */
export interface CheckNamePacket {
  kind: "check-name";
  opcode: typeof CLIENT_OPCODE.checkName;
  name: string;
  appearance: number[];
}

export interface DeleteCharacterPacket {
  kind: "delete-character";
  opcode: typeof CLIENT_OPCODE.deleteCharacter;
  characterId: number;
}

export interface HandshakeReplyPacket {
  kind: "handshake-reply";
  opcode: typeof CLIENT_OPCODE.handshakeReply;
  value: number;
}

export interface EchoReplyPacket {
  kind: "echo";
  opcode: typeof CLIENT_OPCODE.echoReply;
  value: number;
}

export interface UnknownPacket {
  kind: "unknown";
  opcode: number;
  body: Uint8Array;
}

export type ClientPacket =
  | LoginRequestPacket
  | WorldSelectPacket
  | SelectCharacterPacket
  | CreateCharacterPacket
  | CheckNamePacket
  | DeleteCharacterPacket
  | HandshakeReplyPacket
  | EchoReplyPacket
  | UnknownPacket;

/** Decodes one client packet body (opcode included) from the login stage. */
export function decodeClientPacket(body: Uint8Array): ClientPacket {
  const reader = new PacketReader(body);
  const opcode = reader.readByte();
  switch (opcode) {
    case CLIENT_OPCODE.loginRequest:
      return { kind: "login-request", opcode, username: reader.readAsciiString(), password: reader.readAsciiString() };
    case CLIENT_OPCODE.worldSelect:
      return { kind: "world-select", opcode, worldId: reader.readByte() };
    case CLIENT_OPCODE.selectCharacter:
      return { kind: "select-character", opcode, characterId: reader.readU32() };
    case CLIENT_OPCODE.handshakeReply:
      return { kind: "handshake-reply", opcode, value: reader.readU32() };
    case CLIENT_OPCODE.createCharacter:
      return { kind: "create-character", opcode, name: reader.readAsciiString() };
    case CLIENT_OPCODE.checkName: {
      const name = reader.readAsciiString();
      const appearance: number[] = [];
      for (let i = 0; i < CHECK_NAME_APPEARANCE_WORDS; i++) appearance.push(reader.readU32());
      return { kind: "check-name", opcode, name, appearance };
    }
    case CLIENT_OPCODE.deleteCharacter:
      return { kind: "delete-character", opcode, characterId: reader.readU32() };
    case CLIENT_OPCODE.echoReply:
      return { kind: "echo", opcode, value: reader.readU32() };
    default:
      return { kind: "unknown", opcode, body: body.slice(reader.offset) };
  }
}

/** Re-encodes a client packet body. Used by tests and by a rewritten client (ADR-004 oracle). */
export function encodeClientPacket(packet: ClientPacket): Uint8Array {
  const writer = new PacketWriter(64);
  writer.writeByte(packet.opcode);
  switch (packet.kind) {
    case "login-request":
      writer.writeAsciiString(packet.username).writeAsciiString(packet.password);
      break;
    case "world-select":
      writer.writeByte(packet.worldId);
      break;
    case "select-character":
      writer.writeU32(packet.characterId);
      break;
    case "delete-character":
      writer.writeU32(packet.characterId);
      break;
    case "handshake-reply":
    case "echo":
      writer.writeU32(packet.value);
      break;
    case "create-character":
      writer.writeAsciiString(packet.name);
      break;
    case "check-name":
      if (packet.appearance.length !== CHECK_NAME_APPEARANCE_WORDS) {
        throw new RangeError(
          `the 0x06 request always carries ${CHECK_NAME_APPEARANCE_WORDS} appearance words, got ${packet.appearance.length}`,
        );
      }
      writer.writeAsciiString(packet.name);
      for (const word of packet.appearance) writer.writeU32(word);
      break;
    case "unknown":
      writer.writeBytes(packet.body);
      break;
  }
  return writer.toBytes();
}

export { PacketUnderflowError };

/**
 * Best-effort human-readable summary of a decrypted client packet.
 *
 * Never throws and returns undefined for opcodes that are not mapped yet: a truncated or unknown
 * packet must still land in a trace/log rather than being swallowed by the describer.
 * Credentials are reported by length, not by value - traces get committed and shared.
 */
export function describeClientPacket(body: Uint8Array): string | undefined {
  if (body.length === 0) return undefined;
  try {
    const packet = decodeClientPacket(body);
    switch (packet.kind) {
      case "login-request":
        return `login-request user=${packet.username.length}B pass=${packet.password.length}B`;
      case "world-select":
        return `world-select worldId=${packet.worldId}`;
      case "select-character":
        return `select-character id=${packet.characterId}`;
      case "delete-character":
        return `delete-character id=${packet.characterId}`;
      case "create-character":
        return `create-character name=${packet.name.length}B`;
      case "check-name":
        return `check-name name=${packet.name.length}B appearance=[${packet.appearance.join(",")}]`;
      case "handshake-reply":
        return `handshake-reply value=0x${(packet.value >>> 0).toString(16)}`;
      case "echo":
        return `echo value=0x${(packet.value >>> 0).toString(16)}`;
      case "unknown":
        return undefined;
    }
  } catch {
    return "unparsable (truncated or not a client packet)";
  }
}
