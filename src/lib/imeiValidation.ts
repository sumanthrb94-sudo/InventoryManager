/**
 * Shared IMEI / Apple serial validation.
 *
 * Per ops rule (tightened 2026-05-17):
 *   - Non-Apple devices  → MUST be 15 digits, numeric only. No letters,
 *                          no punctuation, no spaces. (14 and 16-17 digit
 *                          edge cases are no longer accepted — they were
 *                          letting random strings through.)
 *   - Apple devices      → 15-digit IMEI OR Apple alphanumeric serial
 *                          (10-12 chars, uppercase A-Z + digits only).
 *
 * Callers MUST pass `{ isAppleSerial: true }` when the unit is known to be
 * an Apple device (iPhone / iPad / MacBook / Apple Watch). Use the
 * {@link isAppleDevice} helper to derive it from a model or brand string.
 *
 * Historical context: the previous validator had a final
 * `return s.length >= 5` escape hatch that accepted ANYTHING ≥5 chars.
 * The user reported gibberish like "Hzhsjshjsjsjsj" being accepted; that
 * escape hatch is removed.
 */

export interface ImeiContext {
  /** True when the unit is an Apple device — unlocks the 10-12 char serial
   *  format alongside the 15-digit IMEI form. Default false (IMEI-only). */
  isAppleSerial?: boolean;
}

/** True when the given model/brand string indicates an Apple device. */
export function isAppleDevice(modelOrBrand: string | undefined | null): boolean {
  const s = (modelOrBrand ?? '').toUpperCase();
  if (!s) return false;
  return /\b(APPLE|IPHONE|IPAD|MACBOOK|APPLE WATCH|IMAC|AIRPODS)\b/.test(s);
}

/**
 * Strict IMEI / Apple serial validation.
 *
 * Returns true only when:
 *   - the input is exactly 15 digits (canonical IMEI), OR
 *   - context says the device is Apple AND the input is 10-12 uppercase
 *     alphanumeric characters (Apple serial format).
 *
 * Whitespace is trimmed before validation. Letters are upper-cased so
 * Apple serials typed in any case still match.
 */
export function isValidImei(
  raw: string | undefined | null,
  ctx?: ImeiContext,
): boolean {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return false;
  // Canonical numeric IMEI: exactly 15 digits.
  if (/^\d{15}$/.test(s)) return true;
  // Apple alphanumeric serial — only when caller said the device is Apple.
  if (ctx?.isAppleSerial && /^[A-Z0-9]{10,12}$/.test(s)) return true;
  return false;
}

/** Classify what flavour of identifier the operator typed. */
export function imeiKind(raw: string): 'imei' | 'serial' | 'unknown' {
  const s = (raw ?? '').trim().toUpperCase();
  if (/^\d{15}$/.test(s)) return 'imei';
  if (/^[A-Z0-9]{10,12}$/.test(s) && /[A-Z]/.test(s)) return 'serial';
  return 'unknown';
}

/**
 * Shared copy used by every form when the IMEI is missing or invalid.
 * Two variants — one generic, one Apple-aware — so the form can tell the
 * operator exactly what's accepted on the row they're on.
 */
export const IMEI_REQUIRED_MESSAGE = 'Enter a valid 15-digit IMEI';
export const IMEI_OR_APPLE_SERIAL_MESSAGE =
  'Enter a valid 15-digit IMEI or 10-12 char Apple serial';
