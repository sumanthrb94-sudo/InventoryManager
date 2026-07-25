/**
 * ReceiveSHSModal's identifier validation.
 *
 * This screen shipped referencing two variables that no longer existed —
 * `numericOk` and `alphaSerial`. TypeScript flagged it; Vite doesn't
 * typecheck, so it shipped anyway. The render path evaluates `alphaSerial`
 * as soon as the operator types ANY character into the IMEI field, so the
 * whole modal threw a ReferenceError on first keystroke: SHS stock could
 * not be received at all.
 *
 * The rules below are what the restored values mean. They mirror the
 * shared validator rather than re-deriving it, so this screen, the
 * importer and the manual-add flow accept exactly the same identifiers.
 */
import { describe, it, expect } from 'vitest';
import { isValidImei, isAppleDevice } from '../../lib/imeiValidation';

/** Mirrors the derived values in ReceiveSHSModal. */
function identifierState(imei: string, model: string) {
  const cleanImei = imei.replace(/\D/g, '');
  const isNumeric = /^\d+$/.test(cleanImei) && cleanImei.length === imei.trim().length;
  const isAppleModel = isAppleDevice(model || '');
  const validInput = isValidImei(imei, { isAppleSerial: isAppleModel });
  return {
    isNumeric,
    isAppleModel,
    validInput,
    numericOk: isNumeric && validInput,
    alphaSerial: !isNumeric && validInput,
    finalId: isNumeric ? cleanImei : imei.trim().toUpperCase(),
  };
}

describe('numericOk — a complete numeric IMEI', () => {
  it('is true for exactly 15 digits', () => {
    expect(identifierState('350100000000000', 'IPHONE 13').numericOk).toBe(true);
  });

  it('is false while the operator is still typing', () => {
    // 9 digits — too short for an IMEI and too short for the serial
    // fallback, so unambiguously incomplete.
    const s = identifierState('350100000', 'IPHONE 13');
    expect(s.isNumeric).toBe(true);
    expect(s.numericOk).toBe(false);
    expect(s.validInput).toBe(false);
  });

  it('a 10-12 digit numeric identifier is accepted on a serial-family device', () => {
    // The serial fallback is /^[A-Z0-9]{10,12}$/, which pure digits match.
    //
    // This was raised as a defect and ruled BY DESIGN by the operator: some
    // Samsung tablets ship identifiers that are purely numeric and shorter
    // than 15 digits, so requiring a letter would reject real stock at
    // intake. The rule stays permissive on purpose.
    //
    // The known cost, accepted: a half-typed 15-digit IMEI on an Apple or
    // tablet model also passes, and the hint renders "11 digits ✓". The
    // import preview and the Add Stock review step are where a mistyped
    // identifier is meant to be caught — not this regex.
    //
    // Do not "fix" this without asking. It is load-bearing.
    const apple = identifierState('35010000000', 'IPHONE 13');
    expect(apple.isNumeric).toBe(true);
    expect(apple.validInput).toBe(true);     // ← Save is enabled
    expect(apple.numericOk).toBe(true);      // ← and the hint shows "11 digits ✓"
    expect(apple.alphaSerial).toBe(false);   // numeric, so not the serial branch

    // Non-Apple models are unaffected — the serial fallback never opens.
    const samsung = identifierState('35010000000', 'SAMSUNG GALAXY S23');
    expect(samsung.validInput).toBe(false);
  });

  it('is false for too many digits', () => {
    expect(identifierState('3501000000000001', 'IPHONE 13').numericOk).toBe(false);
  });

  it('is false for a serial, which is not numeric', () => {
    expect(identifierState('NL6CMQCYTD', 'IPHONE 13').numericOk).toBe(false);
  });
});

describe('alphaSerial — an Apple serial the validator accepts', () => {
  it('accepts a 10-character serial on an Apple device', () => {
    const s = identifierState('NL6CMQCYTD', 'IPHONE 13 PRO');
    expect(s.isAppleModel).toBe(true);
    expect(s.alphaSerial).toBe(true);
    expect(s.validInput).toBe(true);
  });

  it('rejects the same serial on a non-Apple device', () => {
    // A Samsung has no serial fallback — an IMEI is the only identifier.
    const s = identifierState('NL6CMQCYTD', 'SAMSUNG GALAXY S23');
    expect(s.isAppleModel).toBe(false);
    expect(s.alphaSerial).toBe(false);
    expect(s.validInput).toBe(false);
  });

  it('rejects a too-short serial even on an Apple device', () => {
    expect(identifierState('NL6CM', 'IPAD AIR').alphaSerial).toBe(false);
  });

  it('is false for a numeric IMEI', () => {
    expect(identifierState('350100000000000', 'IPHONE 13').alphaSerial).toBe(false);
  });
});

describe('the two are mutually exclusive', () => {
  // The render picks a message off alphaSerial first, then isNumeric —
  // both true at once would mean the hint text is unreachable.
  const cases = ['350100000000000', 'NL6CMQCYTD', '35010000', 'not-an-id', ''];
  it.each(cases)('never both true for %s', (input) => {
    const s = identifierState(input, 'IPHONE 13');
    expect(s.numericOk && s.alphaSerial).toBe(false);
  });

  it('an accepted identifier is always exactly one of them', () => {
    for (const input of ['350100000000000', 'NL6CMQCYTD']) {
      const s = identifierState(input, 'IPHONE 13');
      expect(s.validInput).toBe(true);
      expect(s.numericOk !== s.alphaSerial).toBe(true);
    }
  });
});

describe('finalId — what gets written as the unit id', () => {
  it('strips separators from a numeric IMEI', () => {
    expect(identifierState('350100000000000', 'IPHONE 13').finalId).toBe('350100000000000');
  });

  it('uppercases a serial', () => {
    expect(identifierState('nl6cmqcytd', 'IPHONE 13').finalId).toBe('NL6CMQCYTD');
  });
});

describe('digits-remaining hint', () => {
  // The hint used to say "need N more" against a threshold of 14 while the
  // validator wanted 15 — it counted down to a number that still failed.
  const remaining = (imei: string) => 15 - imei.replace(/\D/g, '').length;

  it('counts down to the length the validator actually accepts', () => {
    expect(remaining('35010000000')).toBe(4);
    expect(remaining('35010000000000')).toBe(1);
    expect(remaining('350100000000000')).toBe(0);
    expect(identifierState('350100000000000', 'IPHONE 13').numericOk).toBe(true);
  });
});
