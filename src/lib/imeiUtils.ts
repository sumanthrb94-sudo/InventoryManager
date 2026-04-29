/**
 * IMEI Utilities — Luhn algorithm validation + formatting
 * Used by every agency-grade device tracking system.
 */

/** Validate IMEI using the Luhn algorithm (ISO/IEC 7812) */
export function validateIMEI(imei: string): boolean {
  const digits = imei.replace(/\D/g, '');
  if (digits.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = parseInt(digits[i], 10);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Format IMEI as XX-XXXXXX-XXXXXX-X for display */
export function formatIMEI(imei: string): string {
  const d = imei.replace(/\D/g, '');
  if (d.length !== 15) return imei;
  return `${d.slice(0,2)}-${d.slice(2,8)}-${d.slice(8,14)}-${d.slice(14)}`;
}

/** Mask IMEI for privacy — show last 4 digits only */
export function maskIMEI(imei: string): string {
  const d = imei.replace(/\D/g, '');
  if (d.length < 4) return imei;
  return `${'•'.repeat(d.length - 4)}${d.slice(-4)}`;
}

/** Derive TAC (Type Allocation Code) — first 8 digits identify device model */
export function getTAC(imei: string): string {
  return imei.replace(/\D/g, '').slice(0, 8);
}
