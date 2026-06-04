import { describe, it, expect } from 'vitest';
import { isValidImei, isAppleDevice, imeiKind } from '../lib/imeiValidation';

describe('isValidImei', () => {
  it('accepts a canonical 15-digit IMEI', () => {
    expect(isValidImei('353209102768686')).toBe(true);
  });

  it('accepts Apple-style serials (8-12 alphanumeric, letter + digit) — Watch / iPad', () => {
    expect(isValidImei('F2LMQ1AB12')).toBe(true);   // 10 char
    expect(isValidImei('C02XK1ABJGH5')).toBe(true); // 12 char
    expect(isValidImei('GX9K7L2M')).toBe(true);     // 8 char
  });

  it('accepts an Apple serial even WITHOUT the isApple flag (model not detected)', () => {
    // The whole point: a Watch/iPad serial must validate even if the model text
    // never tripped Apple detection.
    expect(isValidImei('F2LMQ1AB12', { isAppleSerial: false })).toBe(true);
  });

  it('rejects gibberish words (all letters) and wrong-length numbers', () => {
    expect(isValidImei('HZHSJSHJSJSJ')).toBe(false); // all letters
    expect(isValidImei('ABCDEFGHIJ')).toBe(false);   // all letters, 10 char
    expect(isValidImei('35320910276868')).toBe(false); // 14 digits
    expect(isValidImei('3532091027686861')).toBe(false); // 16 digits
    expect(isValidImei('')).toBe(false);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isValidImei('  f2lmq1ab12  ')).toBe(true);
  });
});

describe('isAppleDevice', () => {
  it('detects Watch / iPad even without the word "Apple"', () => {
    expect(isAppleDevice('Watch Ultra 2')).toBe(true);
    expect(isAppleDevice('iPad Pro 11')).toBe(true);
    expect(isAppleDevice('Apple Watch Series 9')).toBe(true);
    expect(isAppleDevice('AirPods Pro')).toBe(true);
    expect(isAppleDevice('MacBook Air')).toBe(true);
  });

  it('does not flag non-Apple devices', () => {
    expect(isAppleDevice('Samsung Galaxy S22')).toBe(false);
    expect(isAppleDevice('')).toBe(false);
  });
});

describe('imeiKind', () => {
  it('classifies IMEIs and serials', () => {
    expect(imeiKind('353209102768686')).toBe('imei');
    expect(imeiKind('F2LMQ1AB12')).toBe('serial');
    expect(imeiKind('???')).toBe('unknown');
  });
});
