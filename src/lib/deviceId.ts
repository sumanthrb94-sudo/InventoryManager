// Device-ID validation, normalization and formatting.
//
// Single source of truth for every IMEI / serial check in the app.
// Industry-grade ruleset:
//
//   • IMEI         — 15 digits, Luhn-valid (3GPP TS 23.003 / ISO IEC 7812)
//   • IMEISV       — 16 digits, no checksum (last 2 = software version)
//   • MEID hex     — 14 hex characters (CDMA / 3GPP2)
//   • Apple serial — 8–14 alphanumeric uppercase (covers legacy 11/12-char
//                    factory codes + post-2021 randomized serials)
//   • Generic      — 6–17 alphanumeric uppercase (fallback for other OEMs;
//                    Samsung, Google Pixel, Huawei, etc.)
//
// Anything outside these is rejected with a human-readable reason. All
// validators accept formatted input (spaces, dashes, dots, underscores
// are stripped before checking). Storage normalization upper-cases
// non-numeric IDs and preserves digit-only IMEIs verbatim (leading
// zeros included).

export type DeviceIdKind =
  | 'imei'
  | 'imeisv'
  | 'meid_hex'
  | 'apple_serial'
  | 'serial'
  | 'empty'
  | 'invalid';

export interface DeviceIdClassification {
  kind: DeviceIdKind;
  valid: boolean;
  /** Cleaned form ready for storage / comparison. */
  normalized: string;
  /** Human-readable reason when `valid === false`. */
  reason?: string;
  /** Short label for UI badges (e.g. "IMEI ✓", "Apple Serial"). */
  label?: string;
}

// Industry-spec bounds — exported so UI hints stay in sync with the
// validator and tests reference one place.
export const IMEI_LEN          = 15;
export const IMEISV_LEN        = 16;
export const MEID_HEX_LEN      = 14;
export const APPLE_SERIAL_MIN  = 8;
export const APPLE_SERIAL_MAX  = 14;
export const SERIAL_MIN        = 6;
export const SERIAL_MAX        = 17;

const STRIP_SEPARATORS = /[\s\-_.]+/g;

function cleanRaw(s: string): string {
  return (s || '').replace(STRIP_SEPARATORS, '').trim();
}

function digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '');
}

function isAllSameChar(s: string): boolean {
  return s.length > 0 && s.split('').every(c => c === s[0]);
}

// ── IMEI ─────────────────────────────────────────────────────────────────────

/**
 * Validate an IMEI per 3GPP TS 23.003 + ISO/IEC 7812 (Luhn).
 *
 * Strips separators before validating, so the formatted display form
 * (XX-XXXXXX-XXXXXX-X) is also accepted.
 */
export function validateIMEI(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length !== IMEI_LEN) return false;
  // All-same-digit values can be Luhn-valid but are not real IMEIs;
  // reject the entire family rather than just all-zeros.
  if (isAllSameChar(d)) return false;
  let sum = 0;
  for (let i = 0; i < IMEI_LEN; i++) {
    let n = d.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

// ── IMEISV ───────────────────────────────────────────────────────────────────

/**
 * Validate an IMEISV (IMEI + Software Version) — 16 digits, no checksum.
 * The first 14 are the IMEI body (no Luhn check digit), the last 2 are
 * the software version.
 */
export function validateIMEISV(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length !== IMEISV_LEN) return false;
  if (isAllSameChar(d)) return false;
  return true;
}

// ── MEID hex ─────────────────────────────────────────────────────────────────

/**
 * Validate a 14-character hex MEID (CDMA, 3GPP2).
 * Decimal 18-digit MEIDs are uncommon on modern devices and intentionally
 * not auto-detected — pass them as a generic serial instead if needed.
 */
export function validateMEIDHex(raw: string): boolean {
  const c = cleanRaw(raw).toUpperCase();
  if (c.length !== MEID_HEX_LEN) return false;
  if (!/^[0-9A-F]+$/.test(c)) return false;
  if (isAllSameChar(c)) return false;
  return true;
}

// ── Apple serial ─────────────────────────────────────────────────────────────

/**
 * Validate an Apple-style serial.
 *
 * - Legacy (≤ 2021): 11–12 alphanumeric (factory + week-year + unique).
 * - Randomized (2021+): variable 8–14 alphanumeric uppercase.
 *
 * Apple does not publish a checksum, so structural validation is the
 * tightest test available.
 */
export function validateAppleSerial(raw: string): boolean {
  const c = cleanRaw(raw).toUpperCase();
  if (c.length < APPLE_SERIAL_MIN || c.length > APPLE_SERIAL_MAX) return false;
  if (!/^[A-Z0-9]+$/.test(c)) return false;
  // Must contain at least one letter — pure-digit strings of length 8–14
  // are not Apple serials (they'd already be caught by the IMEI branch
  // if they were the right length).
  if (!/[A-Z]/.test(c)) return false;
  if (isAllSameChar(c)) return false;
  return true;
}

// ── Generic serial fallback ──────────────────────────────────────────────────

/**
 * Generic alphanumeric serial — catches Samsung, Pixel, Huawei, etc.
 * Slightly wider bounds than Apple (6–17 chars) so older Samsung 11-char
 * serials and longer Pixel codes both fit.
 */
export function validateGenericSerial(raw: string): boolean {
  const c = cleanRaw(raw).toUpperCase();
  if (c.length < SERIAL_MIN || c.length > SERIAL_MAX) return false;
  if (!/^[A-Z0-9]+$/.test(c)) return false;
  // Must contain at least one letter; otherwise it's a numeric ID and
  // should have been validated as an IMEI/IMEISV.
  if (!/[A-Z]/.test(c)) return false;
  if (isAllSameChar(c)) return false;
  return true;
}

// ── Normalization & classification ───────────────────────────────────────────

/**
 * Strip separators and upper-case non-numeric inputs. Numeric inputs are
 * returned digits-only with leading zeros preserved.
 */
export function normalizeDeviceId(raw: string): string {
  const c = cleanRaw(raw);
  if (!c) return '';
  if (/^\d+$/.test(c)) return c;
  return c.toUpperCase();
}

/**
 * Classify a raw user-entered device ID. Returns `{ kind, valid,
 * normalized, reason, label }` — drive UI badges, save guards and
 * duplicate checks from this single result.
 */
export function classifyDeviceId(raw: string): DeviceIdClassification {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { kind: 'empty', valid: false, normalized: '', reason: 'Required' };
  }
  const cleaned = cleanRaw(trimmed);
  if (!cleaned) {
    return { kind: 'empty', valid: false, normalized: '', reason: 'Required' };
  }
  const numeric = /^\d+$/.test(cleaned);

  if (numeric) {
    if (cleaned.length === IMEI_LEN) {
      if (validateIMEI(cleaned)) {
        return { kind: 'imei', valid: true, normalized: cleaned, label: 'IMEI' };
      }
      return {
        kind: 'invalid',
        valid: false,
        normalized: cleaned,
        reason: 'IMEI checksum failed (Luhn)',
      };
    }
    if (cleaned.length === IMEISV_LEN) {
      if (validateIMEISV(cleaned)) {
        return { kind: 'imeisv', valid: true, normalized: cleaned, label: 'IMEISV' };
      }
      return {
        kind: 'invalid',
        valid: false,
        normalized: cleaned,
        reason: 'IMEISV invalid (all-same digits)',
      };
    }
    return {
      kind: 'invalid',
      valid: false,
      normalized: cleaned,
      reason: cleaned.length < IMEI_LEN
        ? `${cleaned.length} digits — IMEI needs ${IMEI_LEN}`
        : `${cleaned.length} digits — IMEI is ${IMEI_LEN}, IMEISV is ${IMEISV_LEN}`,
    };
  }

  const up = cleaned.toUpperCase();

  if (validateMEIDHex(up)) {
    return { kind: 'meid_hex', valid: true, normalized: up, label: 'MEID' };
  }
  if (validateAppleSerial(up)) {
    return { kind: 'apple_serial', valid: true, normalized: up, label: 'Apple Serial' };
  }
  if (validateGenericSerial(up)) {
    return { kind: 'serial', valid: true, normalized: up, label: 'Serial' };
  }

  let reason = 'Contains invalid characters';
  if (!/^[A-Z0-9]+$/.test(up)) {
    reason = 'Contains characters that are not letters or digits';
  } else if (up.length < SERIAL_MIN) {
    reason = `${up.length} chars — too short (need at least ${SERIAL_MIN})`;
  } else if (up.length > SERIAL_MAX) {
    reason = `${up.length} chars — too long (max ${SERIAL_MAX})`;
  } else if (!/[A-Z]/.test(up)) {
    reason = 'Serial must contain at least one letter';
  } else if (isAllSameChar(up)) {
    reason = 'All-same characters — not a real serial';
  }
  return { kind: 'invalid', valid: false, normalized: up, reason };
}

/** Convenience: true iff input is a valid IMEI / IMEISV / serial. */
export function isValidDeviceId(raw: string): boolean {
  return classifyDeviceId(raw).valid;
}

// ── Formatting & display ─────────────────────────────────────────────────────

/** Format a 15-digit IMEI as XX-XXXXXX-XXXXXX-X. Pass-through otherwise. */
export function formatIMEI(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length !== IMEI_LEN) return raw;
  return `${d.slice(0, 2)}-${d.slice(2, 8)}-${d.slice(8, 14)}-${d.slice(14)}`;
}

/** Format any classified device ID for display. */
export function formatDeviceId(raw: string): string {
  if (!raw) return '';
  const c = classifyDeviceId(raw);
  if (c.kind === 'imei') return formatIMEI(c.normalized);
  return c.normalized || raw;
}

/** Privacy mask — keeps the last 4 characters visible. */
export function maskIMEI(s: string): string {
  if ((s || '').length < 4) return s || '';
  return `${'•'.repeat(s.length - 4)}${s.slice(-4)}`;
}

export const maskDeviceId = maskIMEI;

/** Type Allocation Code — first 8 digits of the IMEI. */
export function getTAC(raw: string): string {
  return digitsOnly(raw).slice(0, 8);
}
