// A suggested password is 25 symbols drawn from 36 (lowercase letters and digits) with the
// browser's cryptographic random source, about 129 bits of entropy, shown in groups of five.
// Knowing how it is made does not help an attacker: the strength is the randomness, not the
// method, and Argon2id sits on top of it before anything is derived from it.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const SUGGESTED_LENGTH = 25;

export function generatePassword(length = SUGGESTED_LENGTH): string {
  const out: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // Skip values that would bias the modulo: 252 is the largest multiple of 36 under 256.
      if (b >= 252) continue;
      out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join("").replace(/(.{5})(?=.)/g, "$1-");
}
