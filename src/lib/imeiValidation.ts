/**
 * Shared IMEI / alphanumeric-serial validation.
 *
 * Per ops rule (tightened 2026-05-17, broadened 2026-06-10):
 *   - Strict cellular phones → MUST be 15 digits, numeric only. No
 *                              letters, no punctuation, no spaces.
 *   - Device families that commonly use alphanumeric serials
 *     (Apple anything, Samsung Galaxy Tab / Watch / Buds, laptops, etc)
 *                            → 15-digit IMEI OR alphanumeric serial
 *                              (10-12 chars, uppercase A-Z + digits).
 *
 * Callers pass `{ isAppleSerial: true }` when the model is known to be
 * one of those serial-using device families. Use {@link isAppleDevice}
 * to derive it from the model/brand string.
 *
 * Function names retain the historical "Apple" framing for caller
 * compatibility — the semantic was always "accepts alphanumeric serial"
 * even when only Apple devices fell into that bucket.
 *
 * Historical context: the previous validator had a final
 * `return s.length >= 5` escape hatch that accepted ANYTHING ≥5 chars.
 * Gibberish like "Hzhsjshjsjsjsj" got through; that hatch is removed.
 */

export interface ImeiContext {
  /** True when the unit's model is one of the serial-friendly device
   *  families — unlocks the 10-12 char alphanumeric serial format
   *  alongside the 15-digit IMEI form. Default false (IMEI-only). */
  isAppleSerial?: boolean;
}

/** True when the given model/brand string indicates a device family
 *  that commonly identifies units by an alphanumeric serial (10-12
 *  chars, uppercase A-Z + digits) instead of — or in addition to —
 *  a 15-digit IMEI. Covers:
 *    - Apple anything (iPhone / iPad / MacBook / Apple Watch / iMac / AirPods)
 *    - Samsung Galaxy Tab (both WiFi and LTE variants — Samsung
 *      issues alphanumeric serials like R8YWA0ALDFT alongside the
 *      IMEI on cellular models, and WiFi-only tablets have no IMEI
 *      at all so the serial is the only identifier)
 *    - Tablets generally — anything TAB / TABLET / SLATE
 *    - Smartwatches (any WATCH — Samsung Galaxy Watch LTE etc) and
 *      wireless earbuds (BUDS / PODS).
 *    - Laptops (anything BOOK — MacBook, ZBook, IdeaBook, etc).
 *  The function name is historical; the semantic is "device that
 *  legitimately uses an alphanumeric serial as a primary ID". */
export function isAppleDevice(modelOrBrand: string | undefined | null): boolean {
  const s = (modelOrBrand ?? '').toUpperCase();
  if (!s) return false;
  // The TAB alternative is intentionally NOT anchored at the end so it
  // also matches operator SKU strings where Tab + series + digit are one
  // unbroken word (e.g. `ASI-SG-TABA8-32GB-BK-EX`, `ASI-SG-TABS9-256-EX`).
  // Without this, the orphan-add flow's SKU-derived model `TABA8` failed
  // the alphanumeric-serial unlock and rejected Amazon serials like
  // `r8ywa0aldft` — one tablet per import landing on the No-Inventory
  // badge instead of auto-adding. Other alternatives keep their trailing
  // word boundary so short fragments (e.g. WATCH inside WATCHED) still
  // don't false-positive.
  //
  // WIFI / WI-FI is a positive signal too: WiFi-only devices have no
  // cellular radio and therefore no 15-digit IMEI — only a serial. This
  // catches "Galaxy A11 Plus WiFi" and similar tablet variants the
  // operator labels by their radio config rather than by a TAB keyword.
  //
  // Earbuds and watches carry their generation FUSED to the name — Galaxy
  // Buds2, Buds3 Pro, AirPods4, Galaxy Watch6 — so `\bBUDS\b` never matched
  // them and the serial unlock silently failed: no IMEI exists on those
  // devices, so intake was impossible. This is the same fused-token problem
  // TAB[A-Z0-9]* was already special-cased for; the fix was never carried
  // across. A trailing \d* (digits only, not [A-Z0-9]*) is deliberately
  // narrow — BOOK[A-Z0-9]* would swallow BOOKCASE.
  //
  // Samsung TABLET MODEL CODES are the last resort, and the reason this
  // clause exists at all: every rule above depends on a PROSE word surviving
  // in the model string, and prose is exactly what gets lost. Field case —
  // three Galaxy Tab A 10.1 units whose stored model had decayed to
  // "(10.1)(T580)". No TAB token left, so the serial unlock never fired and
  // the validator demanded a 15-digit IMEI from a Wi-Fi-only tablet that has
  // never had one. The model code is the part that survives mangling, so
  // match it directly.
  //
  // SM-T### / SM-X### / SM-P### are Samsung's tablet lines (T = Tab A/S
  // older, X = Tab A8 onwards and Tab S8+, P = Tab S Lite / pen models).
  // Phones use A/G/N/S/F prefixes and are deliberately NOT matched here —
  // a phone has a real IMEI and must keep failing the 15-digit check.
  // The optional SM- prefix and trailing letter cover "SM-T580" and
  // "X206B" as written on the box.
  return /\b(APPLE|IPHONE|IPAD|MACBOOK|IMAC|TABLET|SLATE|BOOK|WIFI|WI-FI)\b|\b(AIRPODS|BUDS|PODS|WATCH)\d*\b|\bTAB[A-Z0-9]*\b|\b(?:SM-)?[TXP]\d{3}[A-Z]?\b/.test(s);
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
  // Alphanumeric serial — only when the caller said this device family uses
  // one. Note the character class permits an ALL-DIGIT 10-12 char value.
  //
  // That is deliberate and confirmed with the operator, not an oversight:
  // some Samsung tablets ship identifiers that are purely numeric and
  // shorter than 15 digits. Requiring at least one letter would read as
  // "tighter validation" but would reject real stock at the door.
  //
  // The cost is understood and accepted: a half-typed 15-digit IMEI on an
  // Apple or tablet model passes this check. The preview screens are where
  // that gets caught — not here.
  if (ctx?.isAppleSerial && /^[A-Z0-9]{10,12}$/.test(s)) return true;
  return false;
}

/**
 * Permissive identifier validation for the orphan-add path (auto-create
 * inventory from a sale that already exists). Accepts a 15-digit IMEI OR
 * a 10-12 char alphanumeric serial unconditionally — no model-family
 * detection required. The justification: by the time this runs, the
 * marketplace has already accepted the order and exchanged money. We
 * trust the identifier the marketplace gave us instead of re-applying
 * the strict "device must be Tab/iPad/Watch" gate that exists to catch
 * operator typos during manual stock entry.
 *
 * Use ONLY in addSoldUnitFromSale and similar auto-reconciliation paths.
 * The manual stock-add flow (`addUnitManual`) keeps the strict
 * `isValidImei` gate so a fat-finger doesn't sneak garbage into inventory.
 *
 * Field-confirmed regression this fixes: tablet SKUs with fused-token
 * model strings (e.g. TABA8 — no boundary between TAB and A8) failed
 * isAppleDevice, the alphanumeric-serial unlock never fired, and one
 * tablet per import landed on the orange No-Inventory badge instead of
 * auto-adding. Future SKU patterns (new device families, new operator
 * conventions) won't break this path either.
 */
export function isValidImeiOrSerial(raw: string | undefined | null): boolean {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return false;
  if (/^\d{15}$/.test(s)) return true;
  if (/^[A-Z0-9]{10,12}$/.test(s)) return true;
  return false;
}

/** Classify what flavour of identifier the operator typed. */
export function imeiKind(raw: string): 'imei' | 'serial' | 'unknown' {
  const s = (raw ?? '').trim().toUpperCase();
  if (/^\d{15}$/.test(s)) return 'imei';
  if (/^[A-Z0-9]{10,12}$/.test(s) && /[A-Z]/.test(s)) return 'serial';
  return 'unknown';
}

/** Plain-English placeholders an operator writes in an IMEI cell to mean
 *  "there genuinely is no IMEI here" (a charger, SIM pins, etc. entered on
 *  a phone/tablet marketplace sheet instead of the app's own no-IMEI
 *  accessory flow) — as distinct from a mistyped/truncated REAL IMEI,
 *  which is garbled digits, not an English word, and must still block
 *  import for a manual fix. Deliberately a narrow, explicit allowlist
 *  rather than a fuzzy "doesn't look like an IMEI" heuristic: it must only
 *  ever catch a human deliberately saying "no IMEI", never a real typo. */
const PLACEHOLDER_IMEI_TEXT = new Set([
  'GENERIC', 'N/A', 'NA', 'NONE', 'NIL', 'TBD', 'UNKNOWN', '-', '--',
  'NOT APPLICABLE', 'NOT MENTIONED IN APP', 'NOT MENTIONED', 'NO IMEI',
]);

/** True when `raw` is one of the known no-IMEI placeholder phrases above. */
export function isPlaceholderImeiText(raw: string | undefined | null): boolean {
  const s = (raw ?? '').trim().toUpperCase();
  return s !== '' && PLACEHOLDER_IMEI_TEXT.has(s);
}

/**
 * Shared copy used by every form when the IMEI is missing or invalid.
 * Two variants — one generic, one Apple-aware — so the form can tell the
 * operator exactly what's accepted on the row they're on.
 */
export const IMEI_REQUIRED_MESSAGE = 'Enter a valid 15-digit IMEI';
export const IMEI_OR_APPLE_SERIAL_MESSAGE =
  'Enter a valid 15-digit IMEI or 10-12 char alphanumeric serial';
