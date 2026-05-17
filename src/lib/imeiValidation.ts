/**
 * Shared IMEI / Apple serial validation.
 *
 * Project rule: every component that creates or edits a single physical
 * unit MUST require an IMEI (or Apple alphanumeric serial — same field).
 * The only exception is SHS (Supplier Holding Stock) where the supplier
 * holds the stock and the IMEI doesn't exist yet — IMEIs get captured at
 * receive time.
 *
 * Historical bugs this fixes:
 *   - Many forms used `imei.length < 14` or `imei.length === 15` length
 *     gates. Apple alphanumeric serials (e.g. `NL6CMQCYTD`) are 10 chars
 *     and were rejected. Use {@link isValidImei} instead.
 *
 * Use {@link isValidImei} for permissive non-empty checks (any operator
 * input ≥ 5 chars is accepted to allow legacy / odd serials). Use
 * {@link imeiKind} when you need to discriminate the shape for display.
 */

/** Permissive validator — used on every non-SHS submit gate. */
export function isValidImei(raw: string | undefined | null): boolean {
  const s = (raw ?? '').trim();
  if (s.length === 0) return false;
  // Numeric IMEI: 15 digits (some legacy 14, GSMA spec allows up to 17).
  if (/^\d{14,17}$/.test(s)) return true;
  // Apple alphanumeric serial: typically 10-12 chars, uppercase letters + digits.
  if (/^[A-Z0-9]{8,16}$/.test(s.toUpperCase())) return true;
  // Allow anything non-empty 5+ chars for edge cases (operator override).
  return s.length >= 5;
}

/** Classify what flavour of identifier the operator typed. */
export function imeiKind(raw: string): 'imei' | 'serial' | 'unknown' {
  const s = (raw ?? '').trim();
  if (/^\d{14,17}$/.test(s)) return 'imei';
  if (/^[A-Z0-9]{8,16}$/.test(s.toUpperCase()) && /[A-Z]/i.test(s)) return 'serial';
  return 'unknown';
}

/**
 * Shared copy used by every non-SHS form when the IMEI is missing.
 * Centralised so the validation message is identical across the app.
 */
export const IMEI_REQUIRED_MESSAGE = 'IMEI or serial number is required';
