import { describe, it, expect } from 'vitest';
import { validateIMEI, formatIMEI, maskIMEI, getTAC } from '../lib/imeiUtils';

// Known-valid IMEIs (pass Luhn check)
const VALID_IMEI   = '353209102768686'; // real unit from client data
const VALID_IMEI_2 = '357883401512577'; // real unit from client data
// Known-invalid IMEI (last digit tampered)
const INVALID_IMEI = '353209102768687';

describe('validateIMEI', () => {
  it('returns true for a known-valid 15-digit IMEI', () => {
    expect(validateIMEI(VALID_IMEI)).toBe(true);
  });

  it('returns true for a second known-valid IMEI', () => {
    expect(validateIMEI(VALID_IMEI_2)).toBe(true);
  });

  it('returns false when Luhn check fails', () => {
    expect(validateIMEI(INVALID_IMEI)).toBe(false);
  });

  it('returns false for a 14-digit number', () => {
    expect(validateIMEI('35320910276868')).toBe(false);
  });

  it('returns false for a 16-digit number', () => {
    expect(validateIMEI('3532091027686860')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(validateIMEI('')).toBe(false);
  });

  it('strips non-digit characters before validating', () => {
    // Space-formatted IMEI should still validate
    expect(validateIMEI('353209 102768 686')).toBe(true);
  });

  it('returns false for an all-zeros IMEI', () => {
    expect(validateIMEI('000000000000000')).toBe(false);
  });

  it('returns false for alphabetic input', () => {
    expect(validateIMEI('NL6CMQCYTD')).toBe(false);
  });
});

describe('formatIMEI', () => {
  it('formats a 15-digit IMEI as XX-XXXXXX-XXXXXX-X', () => {
    expect(formatIMEI(VALID_IMEI)).toBe('35-320910-276868-6');
  });

  it('returns the original string unchanged if not 15 digits', () => {
    expect(formatIMEI('NL6CMQCYTD')).toBe('NL6CMQCYTD');
  });

  it('strips non-digit characters before formatting', () => {
    expect(formatIMEI('353209 102768 686')).toBe('35-320910-276868-6');
  });
});

describe('maskIMEI', () => {
  it('shows only the last 4 digits, masking the rest', () => {
    const result = maskIMEI(VALID_IMEI);
    expect(result).toMatch(/^•+8686$/);
    expect(result.slice(-4)).toBe('8686');
  });

  it('returns input unchanged if shorter than 4 chars', () => {
    expect(maskIMEI('123')).toBe('123');
  });

  it('masks a tablet serial number correctly', () => {
    const result = maskIMEI('NL6CMQCYTD');
    expect(result).toMatch(/^•+CYTD$/);
  });
});

describe('getTAC', () => {
  it('returns the first 8 digits (Type Allocation Code)', () => {
    expect(getTAC(VALID_IMEI)).toBe('35320910');
  });

  it('returns first 8 digits from a different IMEI', () => {
    expect(getTAC(VALID_IMEI_2)).toBe('35788340');
  });

  it('returns empty string for an empty input', () => {
    expect(getTAC('')).toBe('');
  });
});
