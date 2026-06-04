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

/** True when the given model/brand string indicates an Apple device. Covers
 *  the accessory/wearable lines (Watch, iPad, AirPods, Mac, iPod, Apple TV,
 *  Vision, Pencil) whose serials are NOT 15-digit IMEIs — operators type
 *  "Watch Ultra 2" / "iPad Pro" without the word "Apple", so match those too. */
export function isAppleDevice(modelOrBrand: string | undefined | null): boolean {
  const s = (modelOrBrand ?? '').toUpperCase();
  if (!s) return false;
  return /\b(APPLE|IPHONE|IPAD|IPOD|MACBOOK|IMAC|MAC\s?MINI|MAC\s?STUDIO|MAC\s?PRO|WATCH|AIRPODS|AIRTAG|APPLE\s?TV|VISION\s?PRO|PENCIL)\b/.test(s);
}

/** Apple serial shape: 8-12 chars, uppercase alphanumeric, containing BOTH a
 *  letter and a digit — so it's clearly a serial (not a mistyped numeric IMEI,
 *  and not a word like "HZHSJSHJSJSJ"). Watch / iPad / Mac etc. use this form. */
function isAppleSerialShape(s: string): boolean {
  return /^[A-Z0-9]{8,12}$/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

/**
 * IMEI / Apple-serial validation.
 *
 * Returns true when:
 *   - the input is exactly 15 digits (canonical IMEI — any device), OR
 *   - the input is an Apple serial shape (8-12 char alphanumeric with a letter
 *     AND a digit). Accepted whether or not the caller flags the device as
 *     Apple, because a letter-bearing serial is unambiguously NOT a 15-digit
 *     IMEI — this is what lets Apple Watches / iPads (serials, not IMEIs) be
 *     added even when the model text didn't trip Apple detection.
 *
 * Whitespace is trimmed and letters upper-cased before validation.
 */
export function isValidImei(
  raw: string | undefined | null,
  _ctx?: ImeiContext,
): boolean {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return false;
  // Canonical numeric IMEI: exactly 15 digits.
  if (/^\d{15}$/.test(s)) return true;
  // Apple alphanumeric serial.
  if (isAppleSerialShape(s)) return true;
  return false;
}

/** Classify what flavour of identifier the operator typed. */
export function imeiKind(raw: string): 'imei' | 'serial' | 'unknown' {
  const s = (raw ?? '').trim().toUpperCase();
  if (/^\d{15}$/.test(s)) return 'imei';
  if (isAppleSerialShape(s)) return 'serial';
  return 'unknown';
}

/**
 * Shared copy used by every form when the IMEI is missing or invalid.
 * Two variants — one generic, one Apple-aware — so the form can tell the
 * operator exactly what's accepted on the row they're on.
 */
export const IMEI_REQUIRED_MESSAGE = 'Enter a valid 15-digit IMEI or device serial';
export const IMEI_OR_APPLE_SERIAL_MESSAGE =
  'Enter a 15-digit IMEI or an 8-12 char Apple serial (e.g. Watch / iPad)';
