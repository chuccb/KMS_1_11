/**
 * Login-stage packets (client -> server), decoded.
 *
 * These are the first things a server sees from a 2003 client, so they are the natural first
 * slice of the schema. Every layout below is taken from the function that *builds* the packet on
 * the client side, which is the strongest evidence available without a live server
 * (docs/protocol/FINDINGS.md 4.5).
 *
 *   0x01  sub_4D0B20   [u16 n]id bytes [u16 n]pw bytes   - sub_430230 appends each string
 *   0x02  sub_54DFC0   [u8 worldId]                       - CWorldSelect
 *   0x04  sub_43A410   [u32 value]                        - send right after the 211-byte handshake
 *   0x08  sub_43B280   [u32 value]                        - echo: the client resends what it got
 *
 * Unknown opcodes are returned as `unknown` instead of being dropped or thrown away: the protocol
 * is still being mapped, and a server that silently discards a packet cannot be debugged.
 */
import { PacketReader, PacketUnderflowError, PacketWriter } from "./packet.ts";

export const CLIENT_OPCODE = {
  loginRequest: 0x01,
  worldSelect: 0x02,
  handshakeReply: 0x04,
  echoReply: 0x08,
} as const;

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
    case CLIENT_OPCODE.handshakeReply:
      return { kind: "handshake-reply", opcode, value: reader.readU32() };
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
    case "handshake-reply":
    case "echo":
      writer.writeU32(packet.value);
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
