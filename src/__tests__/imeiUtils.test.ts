import { describe, it, expect } from 'vitest';
import { validateIMEI, formatIMEI, maskIMEI, getTAC } from '../lib/imeiUtils';

// Known-valid IMEIs (pass Luhn check, real device data)
const VALID_IMEI   = '353209102768686';
const VALID_IMEI_2 = '357883401512577';
// Tampered IMEI — last digit off by one (Luhn fails)
const INVALID_IMEI = '353209102768687';

// ── validateIMEI ─────────────────────────────────────────────────────────────
describe('validateIMEI', () => {
  it('returns true for a known-valid 15-digit IMEI', () => {
    expect(validateIMEI(VALID_IMEI)).toBe(true);
  });

  it('returns true for a second known-valid IMEI', () => {
    expect(validateIMEI(VALID_IMEI_2)).toBe(true);
  });

  it('returns false when Luhn check fails (tampered last digit)', () => {
    expect(validateIMEI(INVALID_IMEI)).toBe(false);
  });

  it('returns false for a 14-digit number (too short)', () => {
    expect(validateIMEI('35320910276868')).toBe(false);
  });

  it('returns false for a 16-digit number (too long)', () => {
    expect(validateIMEI('3532091027686860')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(validateIMEI('')).toBe(false);
  });

  it('strips spaces and dashes before validating (formatted IMEI input)', () => {
    expect(validateIMEI('353209 102768 686')).toBe(true);
    expect(validateIMEI('35-320910-276868-6')).toBe(true);
  });

  it('returns false for an all-zeros IMEI (Luhn passes but not a real IMEI)', () => {
    expect(validateIMEI('000000000000000')).toBe(false);
  });

  it('returns false for alphabetic tablet serials (not 15 digits after stripping)', () => {
    expect(validateIMEI('NL6CMQCYTD')).toBe(false);
  });

  it('returns false for alphanumeric serial even if long enough', () => {
    expect(validateIMEI('ABCDE12345FGHIJ')).toBe(false);
  });
});

// ── formatIMEI ───────────────────────────────────────────────────────────────
describe('formatIMEI', () => {
  it('formats a 15-digit IMEI as XX-XXXXXX-XXXXXX-X', () => {
    expect(formatIMEI(VALID_IMEI)).toBe('35-320910-276868-6');
  });

  it('formats the second valid IMEI correctly', () => {
    expect(formatIMEI(VALID_IMEI_2)).toBe('35-788340-151257-7');
  });

  it('returns the original string unchanged if not exactly 15 numeric digits', () => {
    expect(formatIMEI('NL6CMQCYTD')).toBe('NL6CMQCYTD');
  });

  it('strips spaces then formats (space-formatted IMEI input)', () => {
    expect(formatIMEI('353209 102768 686')).toBe('35-320910-276868-6');
  });

  it('returns short input unchanged', () => {
    expect(formatIMEI('1234')).toBe('1234');
  });
});

// ── maskIMEI ─────────────────────────────────────────────────────────────────
describe('maskIMEI', () => {
  it('shows only the last 4 digits of a numeric IMEI, masks the rest with bullets', () => {
    const result = maskIMEI(VALID_IMEI);
    expect(result.slice(-4)).toBe('8686');
    expect(result.length).toBe(VALID_IMEI.length);
    expect(result).toMatch(/^•+8686$/);
  });

  it('masks a tablet serial (alphanumeric) correctly — works on raw string, not stripped digits', () => {
    const result = maskIMEI('NL6CMQCYTD');
    expect(result.slice(-4)).toBe('CYTD');
    expect(result.length).toBe('NL6CMQCYTD'.length);
    expect(result).toMatch(/^•+CYTD$/);
  });

  it('returns input unchanged if shorter than 4 characters', () => {
    expect(maskIMEI('123')).toBe('123');
    expect(maskIMEI('ab')).toBe('ab');
    expect(maskIMEI('')).toBe('');
  });

  it('returns input unchanged if exactly 3 characters (boundary)', () => {
    expect(maskIMEI('abc')).toBe('abc');
  });

  it('masks a 4-character input leaving 0 bullets', () => {
    const result = maskIMEI('1234');
    expect(result).toBe('1234'); // 0 bullets + '1234' — nothing to mask
  });

  it('masks a 5-character input correctly', () => {
    const result = maskIMEI('12345');
    expect(result).toBe('•2345');
  });

  it('mask length equals input length', () => {
    const input  = VALID_IMEI;
    const result = maskIMEI(input);
    expect(result.length).toBe(input.length);
  });
});

// ── getTAC ────────────────────────────────────────────────────────────────────
describe('getTAC', () => {
  it('returns the first 8 digits — the Type Allocation Code', () => {
    expect(getTAC(VALID_IMEI)).toBe('35320910');
  });

  it('returns TAC from a second valid IMEI', () => {
    expect(getTAC(VALID_IMEI_2)).toBe('35788340');
  });

  it('returns empty string for an empty input', () => {
    expect(getTAC('')).toBe('');
  });

  it('strips non-digit chars before extracting TAC', () => {
    expect(getTAC('35-320910-276868-6')).toBe('35320910');
  });

  it('returns fewer than 8 chars if input has fewer than 8 digits', () => {
    expect(getTAC('12345')).toBe('12345');
  });
});
