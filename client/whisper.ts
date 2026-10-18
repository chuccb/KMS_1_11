/** 4F8940 -> 524A00(name, null, null): ASCII letters/digits or KS Hangul pairs,
 * byte length 4..12, fewer than four literal I/l; recipient cannot equal self (ASCII casefold).
 * Passing null skips the NEW-character forbidden-word list, just as the original call does.
 */
let hangul: Set<string> | undefined;
function nativeHangul() {
  if (hangul) return hangul;
  hangul = new Set();
  try {
    const decoder = new TextDecoder("euc-kr", { fatal: true });
    for (let lead = 0xb0; lead <= 0xc8; lead++)
      for (let trail = 0xa1; trail <= 0xfe; trail++) {
        try {
          const text = decoder.decode(Uint8Array.of(lead, trail));
          if (text.length === 1) hangul.add(text);
        } catch {} // Undefined code-page pairs are not names.
      }
  } catch {} // An unavailable decoder must not silently accept unrepresentable characters.
  return hangul;
}
export function whisperNameError(value: unknown, selfName: string = ""): string | undefined {
  const name = String(value).trim();
  let bytes = 0;
  for (const c of name) {
    if (/^[A-Za-z0-9]$/.test(c)) bytes++;
    else if (nativeHangul().has(c)) bytes += 2;
    else return "잘못된 아이디입니다.";
  }
  if (bytes < 4 || bytes > 12 || (name.match(/[Il]/g) ?? []).length >= 4)
    return "잘못된 아이디입니다.";
  const fold = (s: string) => s.replace(/[A-Z]/g, (c: string) => c.toLowerCase());
  if (fold(name) === fold(selfName)) return "자신에게는 귓속말을 할 수 없습니다.";
  return undefined;
}
