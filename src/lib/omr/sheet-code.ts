/**
 * Sheet identification. Every printed sheet gets a random 10-character code
 * (no 0/1/O/I to avoid misreading when typed by hand). The QR code encodes
 * `ZG1:<code>`; the same code is printed as text under the QR.
 */

export const SHEET_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SHEET_CODE_LENGTH = 10;
const PREFIX = "ZG1:";
const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;

export function generateSheetCode(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(SHEET_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < SHEET_CODE_LENGTH; i++) {
    // 256 is a multiple of 32, so modulo introduces no bias.
    out += SHEET_CODE_ALPHABET[bytes[i]! % SHEET_CODE_ALPHABET.length];
  }
  return out;
}

function defaultRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

export function isValidSheetCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function encodeSheetPayload(code: string): string {
  if (!isValidSheetCode(code)) throw new Error("invalid sheet code");
  return PREFIX + code;
}

/** Accepts a QR payload or a manually typed code; returns the normalized code or null. */
export function parseSheetPayload(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();
  if (s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  s = s.replace(/[\s-]/g, "");
  return isValidSheetCode(s) ? s : null;
}

/** Human-friendly rendering: ABCDE-FGHJK */
export function formatSheetCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
