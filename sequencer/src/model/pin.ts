// The PIN of a show locked for the service, as the show file keeps it: not the digits but a hash
// of them ('h1:' and 14 hex digits), so reading the file (or a shared copy of it) doesn't tell the
// PIN. Staff-proofing, not security: three to eight digits are found by trying them all in a moment
// whichever way they're kept; the file just doesn't say it in plain text.
const SALT = 'luxdmx-pin:';

// (cyrb53: a small, quick, well-spread 53-bit string hash)
function cyrb53(s: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const pinHash = (pin: string) => `h1:${cyrb53(SALT + pin.trim()).toString(16).padStart(14, '0')}`;
export const isPinHash = (v: string) => /^h1:[0-9a-f]{14}$/.test(v);
// is `typed` the PIN kept as `kept`? (a hash; or the digits themselves, as a show from before kept them)
export function pinMatches(kept: string | undefined, typed: string): boolean {
  if (!kept) return false;
  return isPinHash(kept) ? kept === pinHash(typed) : kept === typed.trim();
}
