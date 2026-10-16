/**
 * Packet cipher + key schedule of the 2003 KMS 1.11 client.
 *
 * EVIDENCE (all addresses are in MapleStory.exe.c, this repository)
 * -----------------------------------------------------------------
 * decrypt   sub_4A1B90(packet, key)          : body[i] = swapNibbles(key ^ body[i])
 * encrypt   sub_4A2030(..., a4 = &state, a6 = key)
 *             hdr u16[0] = 0xD3 ^ HIWORD(state)      (only when a state exists)
 *             hdr u16[1] = body length
 *             body[j]   = key ^ swapNibbles(plain[j])
 * key       = LOBYTE(state)  (read *before* the state advances)
 * schedule  state = (state * 214013 + 2531011) mod 2^32   -- MSVC rand() LCG constants
 *             send state at CClientSocket+120 (sub_43AD50 : `this + 30`)
 *             recv state at CClientSocket+124 (sub_43AFA0 : `this + 31`)
 * Both states are seeded from the two u32 values carried by the 211-byte handshake packet.
 *
 * Because swapNibbles is self-inverse, encrypt/decrypt are exact inverses:
 *   swapNibbles(key ^ (key ^ swapNibbles(plain))) === plain
 */
export const LCG_MULTIPLIER = 214013;
export const LCG_INCREMENT = 2531011;
export const HEADER_MAGIC = 0xd3; // 211

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

/** header u16[0] for a session packet: 0xD3 ^ HIWORD(state) */
export function headerMagicOf(state: number): number {
  return (HEADER_MAGIC ^ ((state >>> 16) & 0xffff)) & 0xffff;
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

  headerMagic(): number {
    return headerMagicOf(this.value);
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
