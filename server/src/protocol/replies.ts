/**
 * Login-chain replies (server -> client): the packets that walk a 2003 client from the login
 * screen to the game server.
 *
 * EVIDENCE (MapleStory.exe.c, see docs/protocol/FINDINGS.md 4.9)
 * --------------------------------------------------------------------
 * Server packets are routed by stage, not by one global table. `dword_5C212C` holds the current
 * stage object and `sub_43B170` calls `(**(stage+8))(stage+8, opcode, body)`, i.e. slot 0 of the
 * stage's `INetMsgHandler` subobject:
 *
 *   stage        OnPacket      handles                        sub-object
 *   CTitle       sub_4D0D70    0x01                           CUITitle
 *   CWorldSelect sub_54E210    0x02                           CUIWorldSelect
 *   CCharSelect  sub_431EE0    0x03 0x04 0x05 0x06            CUICharSelect / CUINewChar
 *   CField       sub_472770    0x15-0x52                      in game, FINDINGS 4.1
 *   CStage base  sub_4C2760    0x16
 *
 * So an opcode number means different things in different stages, and a request and its answer do
 * not always share a number (delete: request 0x07, answer 0x06).
 *
 * Result codes: `sub_4D0DB0` (0x01), `sub_54E250` (0x02) and `sub_432FB0` (0x03) all switch on
 * `u8 result` with the same ten messages, and all of them treat `0` as "parse the payload and move
 * on". `sub_4D0DB0` shows the switch as `switch (result + 1)`; the jump table `jpt_433024` in the
 * .lst confirms it: index 0 is result -1, and its default case covers results 0, 1 and >= 10.
 */
import { PacketWriter } from "./packet.ts";
import { writeCharacterData, type CharacterData } from "./chardata.ts";

/** Opcodes of the login stages, in both directions. Names say which direction each one is used in. */
export const LOGIN_OPCODE = {
  /** CTitle, both directions: request `string id, string pw`; reply `u8 result [+ world list]`. */
  login: 0x01,
  /** CWorldSelect, both directions: request `u8 worldIndex`; reply `u8 result [+ slots]`. */
  worldSelect: 0x02,
  /** CCharSelect: request `u32 characterId`; reply `u8 result [+ game server address]`. */
  selectCharacter: 0x03,
  /** Server only: the answer to a name check (`string name, s8 result`). No request opcode exists
   *  for it in this build - the check is requested with `checkName` below. */
  nameCheckResult: 0x04,
  /** CCharSelect: request `string name`; reply `u8 result [+ CharacterData]`. */
  createCharacter: 0x05,
  /** CCharSelect: request `string name` + the appearance to check; reply is `deleteResult`. */
  checkName: 0x06,
  /** Server only: the answer to a delete request (`u32 characterId, u8 flag`). */
  deleteResult: 0x06,
  /** CCharSelect: request `u32 characterId`. */
  deleteCharacter: 0x07,
} as const;

/**
 * The result byte of the 0x01 / 0x02 / 0x03 replies and the message each one shows (`sub_4D0DB0`).
 *
 * Only `ok` continues into the payload. The other values are grouped by message, exactly as the
 * client's switch groups them - a server that wants to say "wrong password" sends 4, not 3.
 */
export const LOGIN_RESULT = {
  /** Success: parse the payload and switch to the next stage. */
  ok: 0,
  /** "아이디 또는 비밀번호가 틀렸습니다." (aAi) - wrong id or password. */
  wrongCredentials: 2,
  /** Same message as 2; the client has two codes for it. */
  wrongCredentials2: 3,
  /** "잘못된 비밀번호입니다." (asc_5B3610) - wrong password. */
  wrongPassword: 4,
  /** "접속할 수 없는 아이디입니다." (aAi_0) - this id may not connect. */
  cannotConnect: 5,
  /** "이용에 제한이 있는 아이디입니다." (aO_2) - the id is restricted. */
  restricted: 6,
  /** "정지 당한 아이디이거나\r\n차단된 아이피입니다." (aAiI_0) - suspended id / blocked ip. */
  suspended: 7,
  /** Same message as 6. */
  restricted2: 8,
  /** Same message as 6. */
  restricted3: 9,
  /** Same message as 6 (this is the value 0 - 1, i.e. 255 as a signed byte). */
  systemError: 0xff,
} as const;

/** One entry of the world list that rides along in the 0x01 reply. */
export interface WorldEntry {
  name: string;
  /**
   * The client keeps this beside the name (`sub_4D0DB0` pushes both into a list it hands to
   * CWorldSelect). Its meaning is not located; the world the client asks for in 0x02 is the
   * *index* of the entry (`sub_54DFC0` sends one byte).
   */
  unknownId: number;
}

/** The three values the 0x01 reply leaves in `CWvsApp`. */
export interface LoginAccountInfo {
  /** `CWvsApp+0x04` (u32). Role unlocated, so it keeps its offset instead of a guess. */
  app4: number;
  /** `CWvsApp+0x08` (u8). Role unlocated. */
  app8: number;
  /**
   * `CWvsApp+0x09` (u8). `CUINewChar` reads it as `~value & 1` when the create dialog opens, so it
   * carries the account's gender bit.
   */
  app9: number;
}

/**
 * 0x01 reply (CTitle). On anything but `ok` this is a single byte.
 *
 * On success the client stores `app4`/`app8`/`app9` in CWvsApp, reads the world list and switches
 * to CWorldSelect with that list as the new stage's parameter (`sub_4C3460`).
 */
export function encodeLoginResult(
  result: number,
  payload?: { account: LoginAccountInfo; worlds: WorldEntry[] },
): Uint8Array {
  const writer = new PacketWriter(256);
  writer.writeByte(LOGIN_OPCODE.login);
  writer.writeByte(result & 0xff);
  if (result !== LOGIN_RESULT.ok) return writer.toBytes();
  if (!payload) throw new Error("a successful login reply needs the account info and the world list");
  if (payload.worlds.length > 0xff) throw new RangeError("the world count is a u8");
  writer.writeU32(payload.account.app4);
  writer.writeByte(payload.account.app8);
  writer.writeByte(payload.account.app9);
  writer.writeByte(payload.worlds.length);
  for (const world of payload.worlds) writer.writeAsciiString(world.name).writeU32(world.unknownId);
  return writer.toBytes();
}

/**
 * 0x02 reply (CWorldSelect): the character slots of the world the client picked.
 *
 * `sub_54E250` always fills exactly three slots: it reads until the packet's count, then zeroes the
 * rest. A server therefore sends `count` records and stops - it must not pad to three.
 */
export function encodeWorldSelectResult(result: number, characters: CharacterData[] = []): Uint8Array {
  const writer = new PacketWriter(512);
  writer.writeByte(LOGIN_OPCODE.worldSelect);
  writer.writeByte(result & 0xff);
  if (result !== LOGIN_RESULT.ok) return writer.toBytes();
  if (characters.length > 3) throw new RangeError("the client only keeps three character slots");
  writer.writeByte(characters.length);
  for (const character of characters) writeCharacterData(writer, character);
  return writer.toBytes();
}

/**
 * Turns "127.0.0.1" into the value whose little-endian bytes are 7F 00 00 01.
 *
 * `sub_432FB0` reads the u32 and stores it at sockaddr+4 with no `htonl`, so this one field is in
 * network order while every other integer in the protocol is little-endian.
 */
export function ipv4WireValue(dotted: string): number {
  const parts = dotted.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new RangeError(`"${dotted}" is not an IPv4 address`);
  }
  return ((parts[3]! << 24) | (parts[2]! << 16) | (parts[1]! << 8) | parts[0]!) >>> 0;
}

/** Where the client is told to go when a character is selected (0x03 reply). */
export interface GameServerRedirect {
  /** Dotted IPv4, written in network order (see `ipv4WireValue`). */
  ip: string;
  /** Host order; the client applies `htons` (`sub_432FB0`). */
  port: number;
  /**
   * Becomes `CWvsApp+0x14` (`.lst` store at `.text:00433196`) and comes back as the body of the
   * client's `0x04` packet on the new connection, right after the 211-byte handshake. That is what
   * makes the redirect useful: the game server learns which character just arrived.
   */
  token: number;
}

/**
 * 0x03 reply (CCharSelect): "this character enters the game at this address".
 *
 * `sub_432FB0` builds a sockaddr from ip/port and calls `sub_558BD0` - the same connect path the
 * 0x07 migration packet uses - stores the token in CWvsApp+0x14 and plays "GameIn".
 */
export function encodeSelectCharacterResult(result: number, redirect?: GameServerRedirect): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(LOGIN_OPCODE.selectCharacter);
  writer.writeByte(result & 0xff);
  if (result !== LOGIN_RESULT.ok) return writer.toBytes();
  if (!redirect) throw new Error("a successful character select needs the game server address");
  if (!Number.isInteger(redirect.port) || redirect.port < 0 || redirect.port > 0xffff) {
    throw new RangeError(`port ${redirect.port} does not fit a u16`);
  }
  writer.writeU32(ipv4WireValue(redirect.ip));
  writer.writeU16(redirect.port);
  writer.writeU32(redirect.token >>> 0);
  return writer.toBytes();
}

/** Result byte of the 0x04 reply (`sub_432430`). Signed: 0 = free, < 0 = error, > 0 = taken. */
export const NAME_CHECK_RESULT = {
  /** "캐릭터명 '%s'으로 생성하실 수 있습니다" - the name is free. */
  available: 0,
  /** "그 밖의 오류 ..." - the check itself failed (any negative value). */
  failed: -1,
  /** Any positive value; the client then shows the duplicate-name message. */
  taken: 1,
} as const;

/** 0x04 reply: the checked name echoed back, then a signed byte. */
export function encodeNameCheckResult(name: string, result: number): Uint8Array {
  if (!Number.isInteger(result) || result < -128 || result > 127) {
    throw new RangeError(`name-check result ${result} does not fit a signed byte`);
  }
  const writer = new PacketWriter(32);
  writer.writeByte(LOGIN_OPCODE.nameCheckResult);
  writer.writeAsciiString(name);
  writer.writeByte(result & 0xff);
  return writer.toBytes();
}

/**
 * 0x05 reply: the result of a create-character request, plus the created character.
 *
 * The client's request carries only the name (`sub_42FD30` sends opcode 5 and one string), so the
 * server has to remember the appearance from the preceding 0x06 request until the user confirms.
 */
export function encodeCreateCharacterResult(result: number, character?: CharacterData): Uint8Array {
  const writer = new PacketWriter(256);
  writer.writeByte(LOGIN_OPCODE.createCharacter);
  writer.writeByte(result & 0xff);
  if (result !== LOGIN_RESULT.ok) return writer.toBytes();
  if (!character) throw new Error("a successful create-character reply needs the new character");
  writeCharacterData(writer, character);
  return writer.toBytes();
}

/**
 * 0x06 reply: the answer to a delete request (which arrived as 0x07).
 *
 * `sub_432890` matches the id against the three slots and throws `CTerminateException
 * 570425350` when the flag is zero or the id is not on screen, so both the id and a non-zero flag
 * are required.
 */
export function encodeDeleteCharacterResult(characterId: number, flag: number): Uint8Array {
  if (flag === 0) {
    throw new Error("flag 0 makes the client throw CTerminateException (570425350); send 1 on success");
  }
  const writer = new PacketWriter(32);
  writer.writeByte(LOGIN_OPCODE.deleteResult);
  writer.writeU32(characterId >>> 0);
  writer.writeByte(flag & 0xff);
  return writer.toBytes();
}
