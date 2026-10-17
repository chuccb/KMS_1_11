/**
 * Packet cipher + key schedule of the 2003 KMS 1.11 client.
 *
 * EVIDENCE (all addresses are in MapleStory.exe.c, this repository)
 * -----------------------------------------------------------------
 * decrypt   sub_4A1B90(packet, key)          : body[i] = swapNibbles(key ^ body[i])
 * encrypt   sub_4A2030(..., a4 = &state, a6 = key)
 *             hdr u16[0] = magic ^ HIWORD(state)     (only when a state exists)
 *             hdr u16[1] = body length
 *             body[j]   = key ^ swapNibbles(plain[j])
 * key       = LOBYTE(state)  (read *before* the state advances)
 * schedule  state = (state * 214013 + 2531011) mod 2^32   -- MSVC rand() LCG constants
 *             send state at CClientSocket+120 (sub_43AD50 : `[esi+78h]`)
 *             recv state at CClientSocket+124 (sub_43AFA0 : `[edi+7Ch]`)
 * Both states are seeded from the two u32 values carried by the 211-byte handshake packet.
 *
 * THE TWO MAGIC CONSTANTS ARE NOT THE SAME (measured, twice, in the .lst):
 *   client -> server  header = 0x00D3 ^ HIWORD(state)
 *     sub_43AD50 pushes 0D3h into sub_4A2030 (MapleStory.exe.lst 0043AD75), which computes
 *     `HIWORD(state) ^ 0xD3` and stores it as the packet's first word (004A20F7-004A2113).
 *     Every client send goes through this one path (login, char select, game).
 *   server -> client  header = 0xFF2C ^ HIWORD(state)
 *     The client's receive path sub_43AFA0 requires it exactly:
 *        mov ecx, [edi+7Ch] / shr ecx,10h / xor cx,[edi+6Eh] / cmp cx,0FF2Ch   (0043AFF9)
 *     and disconnects (sub_43AC20 -> AVCDisconnectException) when it does not match.
 * 0xFF2C is ~0xD3, so the two constants look like one constant that got complemented on one
 * side. It does not matter why: the client's check is what the server has to satisfy, so a
 * server MUST send 0xFF2C and MUST accept 0xD3. Getting this wrong is a silent disconnect.
 *
 * Because swapNibbles is self-inverse, encrypt/decrypt are exact inverses:
 *   swapNibbles(key ^ (key ^ swapNibbles(plain))) === plain
 */
export const LCG_MULTIPLIER = 214013;
export const LCG_INCREMENT = 2531011;

/** Header magic the client writes; a server must accept exactly this from a client. */
export const CLIENT_SEND_MAGIC = 0x00d3;
/** Header magic the client verifies on packets it receives; a server must send exactly this. */
export const SERVER_SEND_MAGIC = 0xff2c; // = ~0x00d3, see the note above

export type Direction = "c2s" | "s2c";

/** Magic constant for the given wire direction (`c2s` = client sends). */
export function magicFor(direction: Direction): number {
  return direction === "c2s" ? CLIENT_SEND_MAGIC : SERVER_SEND_MAGIC;
}

export function nextState(state: number): number {
  // (state * 214013 + 2531011) mod 2^32, kept in unsigned 32-bit arithmetic.
  return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

export function swapNibbles(byte: number): number {
  return ((byte << 4) | (byte >> 4)) & 0xff;
}

export function keyByteOf(state: number): number {
  return state & 0xff;
}

/** header u16[0] for a session packet: magic ^ HIWORD(state) */
export function headerMagicOf(state: number, magic: number = CLIENT_SEND_MAGIC): number {
  return (magic ^ ((state >>> 16) & 0xffff)) & 0xffff;
}

export function encryptBody(plain: Uint8Array, state: number): Uint8Array {
  const key = keyByteOf(state);
  const out = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) out[i] = (key ^ swapNibbles(plain[i]!)) & 0xff;
  return out;
}

export function decryptBody(cipher: Uint8Array, state: number): Uint8Array {
  const key = keyByteOf(state);
  const out = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) out[i] = (swapNibbles(key ^ cipher[i]!) ) & 0xff;
  return out;
}

/** One cipher state plus its advance rule. */
export class CipherState {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0;
  }

  get raw(): number {
    return this.value;
  }

  /** read the current key byte / header magic without advancing */
  keyByte(): number {
    return keyByteOf(this.value);
  }

  /** header u16[0] this state produces for the given direction's magic */
  headerMagic(magic: number = CLIENT_SEND_MAGIC): number {
    return headerMagicOf(this.value, magic);
  }

  encrypt(plain: Uint8Array): Uint8Array {
    const out = encryptBody(plain, this.value);
    this.advance();
    return out;
  }

  decrypt(cipher: Uint8Array): Uint8Array {
    const out = decryptBody(cipher, this.value);
    this.advance();
    return out;
  }

  /** advance without touching a packet (e.g. to mirror the peer) */
  advance(): void {
    this.value = nextState(this.value);
  }
}
