/**
 * The supplier near-miss check.
 *
 * The importer creates any supplier name it has not seen, so a typo becomes a
 * real supplier and splits that supplier's purchase history in two with nothing
 * to show for it. This flags the resemblance instead.
 *
 * The hard requirement is NOT sensitivity — it is that the operator's actual
 * supplier list produces no warnings at all. A check that fires on names they
 * use every day gets ignored, and an ignored warning is worse than none: it
 * trains the eye to skip the exact panel the real one will appear in.
 */
import { describe, it, expect } from 'vitest';
import {
  boundedEditDistance, findSupplierNearMiss, findSupplierNearMisses,
} from '../../lib/supplierNearMiss';

/** The operator's real suppliers, from their all-time inventory report. */
const REAL = ['MHL', 'NANAK', 'IMAX', 'NIHAL', 'MOBILE KIT', 'RR STOCK', 'ABC', 'BUNTY'];

describe('no false positives on the real supplier list', () => {
  it.each(REAL)('%s does not flag any of the others', (name) => {
    // Every one of these is a supplier in daily use. If uploading a file
    // containing them warned about any other, the panel would be noise from
    // the first import onwards.
    const others = REAL.filter(n => n !== name);
    expect(findSupplierNearMiss(name, others)).toBeNull();
  });

  it('a file naming only known suppliers produces no warnings', () => {
    expect(findSupplierNearMisses(REAL, REAL)).toEqual([]);
  });

  it('NANAK and NIHAL stay apart', () => {
    // Both 5 letters, both start with N, and they look alike at a glance —
    // the pair most likely to trip a careless threshold. Three of the five
    // characters differ, which is a different supplier, not a slip.
    expect(boundedEditDistance('nanak', 'nihal', 3)).toBe(3);
    expect(findSupplierNearMiss('NANAK', ['NIHAL'])).toBeNull();
  });
});

describe('catching the typo it exists for', () => {
  it('flags a doubled letter', () => {
    const hit = findSupplierNearMiss('NIHAAL', REAL);
    expect(hit?.match).toBe('NIHAL');
    expect(hit?.kind).toBe('typo');
    expect(hit?.distance).toBe(1);
  });

  it.each([
    ['NIHAL ', 'NIHAL'],        // trailing space
    ['nihal', 'NIHAL'],         // casing
    ['NIHALL', 'NIHAL'],        // doubled last letter
    ['NIHL', 'NIHAL'],          // dropped letter
    ['NHIAL', 'NIHAL'],         // transposed
    ['BUNTYY', 'BUNTY'],
    ['NANNAK', 'NANAK'],
  ])('%s → %s', (typed, expected) => {
    const hit = findSupplierNearMiss(typed, REAL);
    // Casing and trailing space are not new suppliers at all — the importer
    // folds both before it ever asks — so those return null rather than a
    // warning. Everything else is a genuine near miss.
    if (typed.trim().toLowerCase() === expected.toLowerCase()) {
      expect(hit, `${typed} is the same supplier, not a near miss`).toBeNull();
    } else {
      expect(hit?.match, `${typed} should resemble ${expected}`).toBe(expected);
    }
  });

  it('flags spacing and punctuation as its own kind', () => {
    // Strongest signal there is: the same letters in the same order, differing
    // only in how they were spaced. Worth wording differently from a typo.
    for (const typed of ['MOBILEKIT', 'MOBILE-KIT', 'Mobile Kit.']) {
      const hit = findSupplierNearMiss(typed, REAL);
      expect(hit?.match, typed).toBe('MOBILE KIT');
      expect(hit?.kind, typed).toBe('punctuation');
      expect(hit?.distance, typed).toBe(0);
    }
  });

  it('prefers the closest existing supplier when several are near', () => {
    const hit = findSupplierNearMiss('NIHAL2', ['NIHAL', 'NIHALXY', 'MHL']);
    expect(hit?.match).toBe('NIHAL');
  });
});

describe('what it deliberately stays quiet about', () => {
  it('says nothing about a name that is genuinely new', () => {
    // The common case. A real new supplier must not be nagged about.
    for (const name of ['PHONEBOX DIRECT', 'TECHTRADE GLOBAL', 'ZYX WHOLESALE']) {
      expect(findSupplierNearMiss(name, REAL), name).toBeNull();
    }
  });

  it('says nothing about very short names', () => {
    // At two characters or fewer, every name is one edit from every other and
    // the check has no information left to offer.
    expect(findSupplierNearMiss('AB', ['AC', 'AD'])).toBeNull();
  });

  it('needs a bigger difference before flagging a long name', () => {
    // One character in a three-letter name is a third of it; in a sixteen
    // letter name it is a rounding error, so longer names get more tolerance.
    expect(findSupplierNearMiss('MOBILE WHOLESALF LTD', ['MOBILE WHOLESALE LTD'])?.distance).toBe(1);
    expect(findSupplierNearMiss('MOBILE WHOLESALF LTF', ['MOBILE WHOLESALE LTD'])?.distance).toBe(2);
  });

  it('does not compare new names against each other', () => {
    // Two new suppliers resembling each other are far more often two real
    // companies than one typed twice, and there is no correct action to offer.
    expect(findSupplierNearMisses(['ALPHA TRADE', 'ALPHA TRADF'], REAL)).toEqual([]);
  });

  it('ignores an empty or punctuation-only name', () => {
    expect(findSupplierNearMiss('', REAL)).toBeNull();
    expect(findSupplierNearMiss('--', REAL)).toBeNull();
  });
});

describe('boundedEditDistance', () => {
  it('abandons the comparison once it is past the cap', () => {
    // The cap is what makes this safe to run over every new name against every
    // existing supplier; the return value only has to be "more than max".
    expect(boundedEditDistance('abcdefgh', 'zyxwvuts', 1)).toBeGreaterThan(1);
  });

  it('charges an adjacent transposition one, not two', () => {
    // The commonest typing slip there is. Plain Levenshtein calls this 2,
    // which puts it outside a five-letter name's tolerance.
    expect(boundedEditDistance('nhial', 'nihal', 2)).toBe(1);
    expect(boundedEditDistance('bunty', 'buntty', 2)).toBe(1);
  });

  it('measures the ordinary cases', () => {
    expect(boundedEditDistance('nihal', 'nihal', 2)).toBe(0);
    expect(boundedEditDistance('nihal', 'nihaal', 2)).toBe(1);
    expect(boundedEditDistance('nihal', 'nihl', 2)).toBe(1);
    expect(boundedEditDistance('', 'abc', 5)).toBe(3);
  });
});
