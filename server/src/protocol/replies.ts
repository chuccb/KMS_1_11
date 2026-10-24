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

/** Server -> client login-stage replies; c2s request opcodes live in `protocol/login.ts`. */
export const LOGIN_OPCODE = {
  loginResult: 0x01,
  worldSelectResult: 0x02,
  selectCharacterResult: 0x03,
  /** Answer to c2s 0x05 (`string name`): `string name, s8 availability`. */
  nameCheckResult: 0x04,
  /** Answer to c2s 0x06 (`string name` + ten appearance words): result + CharacterData. */
  createCharacterResult: 0x05,
  /** Answer to c2s 0x07 (`u32 characterId`): echoed id + non-zero flag. */
  deleteCharacterResult: 0x06,
  /**
   * Both directions: a `u32` the receiver sends straight back (FINDINGS 4.2). The client's
   * dispatcher (`sub_43B170`) handles it *before* the current stage, so it works at any point of a
   * connection - which is why `net/heartbeat.ts` uses it to ask "are you still there?".
   */
  echo: 0x08,
} as const;

/**
 * The result byte of the 0x01 / 0x02 / 0x03 replies, with the message each value makes the client
 * show.
 *
 * ⚠️ The strings below were **read out of the binary** (`.rdata`; `aAi`, `aAi_0`, `aO_2`, `aAiI_0`
 * are just Hex-Rays' names for the string constants) - and they are not what the symbol names
 * suggest, so an earlier version of this file had four of the eight meanings wrong:
 *
 *   - `aAi`   = "지워지거나 접속 중지된 아이디입니다." - the id was **erased**, or its connection was
 *               stopped. It is *not* "wrong id or password" (that id would be `aAi_0` below).
 *   - `aAi_0` = "등록되지 않은 아이디입니다." - the id is not registered (what a login with an unknown
 *               account wants).
 *   - `aO_2`  = "시스템 오류로 접속 할 수 없습니다." - a plain system error, the client's generic
 *               failure.
 *   - `aAiI_0`= "현재 접속중인 아이디이거나,\r\n현재 서버점검중입니다." - the id is **currently
 *               connected**, or the server is under maintenance.
 *
 * `7` is the one this server will want next: it is the client's own "already connected" message, so
 * refusing a second login for an account that is already in a field is a state the 2003 client was
 * built to display (FINDINGS 4.8, §6). Only `ok` continues into the payload, and the three handlers
 * that read this byte (`sub_4D0DB0` login, `sub_54E250` world, `sub_432FB0` character) group the
 * codes identically - so a code means the same thing wherever it is sent. The one packet in the login
 * chain that **does not** use 0 for success is the create-character reply, see
 * `encodeCreateCharacterResult`.
 *
 * The `.c` is CP949: grepping it for Korean text that was typed as UTF-8 in this repo finds nothing
 * and *looks* like proof of absence. Use `tools/kstr.py`, or decode the file first.
 */
export const LOGIN_RESULT = {
  /** Success: parse the payload and switch to the next stage. */
  ok: 0,
  /** "지워지거나 접속 중지된 아이디입니다." (aAi) - the id was erased or its connection stopped. */
  erasedOrStopped: 2,
  /** Same message as 2; the client has two codes for it. */
  erasedOrStopped2: 3,
  /** "잘못된 패스워드입니다." (asc_5B3610) - wrong password. */
  wrongPassword: 4,
  /** "등록되지 않은 아이디입니다." (aAi_0) - no such id. */
  notRegistered: 5,
  /** "현재 접속중인 아이디이거나,\r\n현재 서버점검중입니다." (aAiI_0) - already connected, or in
   *  maintenance. The code to answer a second login with once this server tracks who is in a field. */
  alreadyConnected: 7,
  /** "시스템 오류로 접속 할 수 없습니다." (aO_2) - a system error; the generic failure. */
  systemError: 0xff,
  /** Same message as `systemError`; the client's switch has four codes for one string. */
  systemError6: 6,
  /** Same message as `systemError`. */
  systemError8: 8,
  /** Same message as `systemError`. */
  systemError9: 9,
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
  writer.writeByte(LOGIN_OPCODE.loginResult);
  writer.writeByte(result & 0xff);
  if (result !== LOGIN_RESULT.ok) return writer.toBytes();
  if (!payload)
    throw new Error("a successful login reply needs the account info and the world list");
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
export function encodeWorldSelectResult(
  result: number,
  characters: CharacterData[] = [],
): Uint8Array {
  const writer = new PacketWriter(512);
  writer.writeByte(LOGIN_OPCODE.worldSelectResult);
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
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
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
   * client's first `0x04` packet on the new connection, after the server greeting.
   *
   * It is not an opaque ticket: `CUserPool`'s enter-field handler (`sub_51CFE0`, FINDINGS 4.11.3)
   * compares the id of the user that just entered the field against `CWvsApp+0x14` to recognise
   * itself, so this value *is* the client's own character id. Send the same id the game server
   * will use for that character.
   */
  characterId: number;
}

/**
 * 0x03 reply (CCharSelect): "this character enters the game at this address".
 *
 * `sub_432FB0` builds a sockaddr from ip/port and calls `sub_558BD0` - the same connect path the
 * 0x07 migration packet uses - stores the id in CWvsApp+0x14 and plays "GameIn".
 */
export function encodeSelectCharacterResult(
  result: number,
  redirect?: GameServerRedirect,
): Uint8Array {
  const writer = new PacketWriter(32);
  writer.writeByte(LOGIN_OPCODE.selectCharacterResult);
  writer.writeByte(result & 0xff);
  if (result !== LOGIN_RESULT.ok) return writer.toBytes();
  if (!redirect) throw new Error("a successful character select needs the game server address");
  if (!Number.isInteger(redirect.port) || redirect.port < 0 || redirect.port > 0xffff) {
    throw new RangeError(`port ${redirect.port} does not fit a u16`);
  }
  writer.writeU32(ipv4WireValue(redirect.ip));
  writer.writeU16(redirect.port);
  writer.writeU32(redirect.characterId >>> 0);
  return writer.toBytes();
}

/**
 * Result byte of the 0x04 reply (`sub_432430`). Signed: 0 = free, < 0 = error, > 0 = taken.
 *
 * The client's own three messages (`.rdata`): free -> "캐릭터이름 '%s'는\r\n 사용하실 수 있습니다",
 * taken -> "캐릭터이름 '%s'는\r\n 이미 사용중 입니다", error -> "알 수 없는 오류로\r\n 캐릭터이름
 * 중복 확인에 실패했습니다".
 */
export const NAME_CHECK_RESULT = {
  /** The name is free. */
  available: 0,
  /** The check itself failed (any negative value) - the client's "unknown error" line. */
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
 * The result byte of the 0x05 reply (`sub_4329A0`): the one packet in the login chain where **0 is
 * the failure**.
 *
 * The client reads one byte and, only when it is non-zero *and* it has a free character slot, reads a
 * whole `CharacterData` into that slot. On any other value it prints "알 수 없는 오류로\r\n 캐릭터
 * 생성에 실패했습니다" ("character creation failed due to an unknown error") - it has no second
 * message for this reply, so *why* creation failed is a server log line, not wire data. That is also
 * why this encoder takes the record instead of a code: "success" and "a record follows" are the same
 * fact, and 0 is not a success value here the way it is in the 0x01/0x02/0x03 replies.
 *
 * The exact non-zero value the 2003 server sent is not in the client (nothing looks at it but
 * zero-ness), so this build sends 1.
 */
export const CREATE_CHARACTER_RESULT = {
  /** "알 수 없는 오류로\r\n 캐릭터 생성에 실패했습니다" - nothing follows. */
  failed: 0,
  /** Any non-zero value; a whole `CharacterData` follows. */
  created: 1,
} as const;

/**
 * 0x08: the heartbeat, in either direction (`sub_43B280` - read a `u32`, send it back).
 *
 * The server sends this to a session that has gone quiet, and the client's echo is the proof that
 * the connection is still alive (`net/heartbeat.ts`). The value carries no meaning to the client -
 * it is echoed verbatim and nothing else reads it - so callers pass a counter to keep our own traces
 * readable.
 */
export function encodeEcho(value: number): Uint8Array {
  const writer = new PacketWriter(8);
  writer.writeByte(LOGIN_OPCODE.echo);
  writer.writeU32(value >>> 0);
  return writer.toBytes();
}

/**
 * 0x05 reply to the c2s 0x06 create request: the created character, or - with no argument - the
 * client's generic failure. The request itself carries the name and all ten appearance/stat words.
 */
export function encodeCreateCharacterResult(character?: CharacterData): Uint8Array {
  const writer = new PacketWriter(256);
  writer.writeByte(LOGIN_OPCODE.createCharacterResult);
  writer.writeByte(
    character === undefined ? CREATE_CHARACTER_RESULT.failed : CREATE_CHARACTER_RESULT.created,
  );
  if (character === undefined) return writer.toBytes();
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
    throw new Error(
      "flag 0 makes the client throw CTerminateException (570425350); send 1 on success",
    );
  }
  const writer = new PacketWriter(32);
  writer.writeByte(LOGIN_OPCODE.deleteCharacterResult);
  writer.writeU32(characterId >>> 0);
  writer.writeByte(flag & 0xff);
  return writer.toBytes();
}
