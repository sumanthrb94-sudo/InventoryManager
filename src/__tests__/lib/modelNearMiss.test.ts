/**
 * The near-miss check for MODEL names, and specifically the thing that makes it
 * different from the supplier one: a model catalogue is full of names that are
 * one character apart on purpose.
 *
 * The list below is a real-shaped catalogue. The load-bearing requirement is
 * the last block — no two GENUINE entries may flag each other. A check that
 * reports the S23 as a misspelling of the S24 will be ignored within a week,
 * and an ignored warning is a missing warning.
 */

import { describe, it, expect } from 'vitest';
import { findModelNearMiss } from '../../lib/modelNearMiss';

const CATALOG = [
  'iPhone 13',
  'iPhone 14',
  'iPhone 15 Pro Max',
  'iPhone SE',
  'iPhone XR',
  'Galaxy S23 Ultra',
  'Galaxy S24 Ultra',
  'Galaxy A54',
  'Galaxy A55',
  'Galaxy Z Fold 5',
  'Galaxy Z Flip 5',
  'Pixel 7',
  'Pixel 7a',
  'Redmi Note 12',
];

describe('findModelNearMiss — catches the typo', () => {
  it('flags a transposition, which is the commonest way to mistype', () => {
    const hit = findModelNearMiss('iPhoen 13', CATALOG);
    expect(hit).toMatchObject({ match: 'iPhone 13', kind: 'typo', distance: 1 });
  });

  it('flags a substitution inside the letters', () => {
    const hit = findModelNearMiss('Galaxy S24 Ultna', CATALOG);
    expect(hit).toMatchObject({ match: 'Galaxy S24 Ultra', kind: 'typo' });
  });

  it('flags a dropped letter', () => {
    const hit = findModelNearMiss('Redmi Nte 12', CATALOG);
    expect(hit).toMatchObject({ match: 'Redmi Note 12', kind: 'typo' });
  });

  it('reports spacing differences as punctuation, not as a typo', () => {
    // normalizeBucketModel folds repeated whitespace but not spaces
    // themselves, so this really does miss the catalogue.
    const hit = findModelNearMiss('iPhone13', CATALOG);
    expect(hit).toMatchObject({ match: 'iPhone 13', kind: 'punctuation', distance: 0 });
  });

  it('is case-insensitive about it', () => {
    const hit = findModelNearMiss('IPHOEN 13', CATALOG);
    expect(hit?.match).toBe('iPhone 13');
  });

  it('returns the candidate exactly as it was typed, for the message', () => {
    const hit = findModelNearMiss('  iPhoen 13  ', CATALOG);
    expect(hit?.candidate).toBe('  iPhoen 13  ');
  });
});

describe('findModelNearMiss — stays quiet when it should', () => {
  it('says nothing about a model that is actually in the catalogue', () => {
    expect(findModelNearMiss('iPhone 13', CATALOG)).toBeNull();
    expect(findModelNearMiss('  galaxy s24 ultra ', CATALOG)).toBeNull();
  });

  it('says nothing about a genuinely unrelated name', () => {
    expect(findModelNearMiss('Nokia 3310', CATALOG)).toBeNull();
    expect(findModelNearMiss('Motorola Edge 50 Pro', CATALOG)).toBeNull();
  });

  it('says nothing on an empty or punctuation-only name', () => {
    expect(findModelNearMiss('', CATALOG)).toBeNull();
    expect(findModelNearMiss('   ', CATALOG)).toBeNull();
    expect(findModelNearMiss('---', CATALOG)).toBeNull();
  });

  it('says nothing when there is no catalogue to compare against', () => {
    expect(findModelNearMiss('iPhoen 13', [])).toBeNull();
  });
});

describe('the digit-token guard — a generation is not a typo', () => {
  // This is the whole reason this module is not just findSupplierNearMiss.
  // Every pair below is ONE edit apart and both sides are real products.
  const generations: Array<[string, string]> = [
    ['iPhone 14', 'iPhone 13'],
    ['Galaxy S24 Ultra', 'Galaxy S23 Ultra'],
    ['Galaxy A55', 'Galaxy A54'],
    ['Pixel 7a', 'Pixel 7'],
  ];

  for (const [candidate, wouldHaveMatched] of generations) {
    it(`does not report ${candidate} as a misspelling of ${wouldHaveMatched}`, () => {
      // Take the candidate out of the catalogue so it is genuinely "unknown"
      // — which is the state a held row is in — and confirm that even then
      // the check refuses to point at the adjacent generation.
      const without = CATALOG.filter(m => m !== candidate);
      const hit = findModelNearMiss(candidate, without);
      expect(hit?.match).not.toBe(wouldHaveMatched);
    });
  }

  it('still catches a typo outside the generation token', () => {
    const hit = findModelNearMiss('Galxy A54 Ultra', ['Galaxy A54 Ultra', 'Galaxy A55 Ultra']);
    expect(hit?.match).toBe('Galaxy A54 Ultra');
  });

  it('accepts the blind spot: a typo INSIDE the generation token is not caught', () => {
    // "S244" could be a fumbled "S24" or a model this catalogue has not seen.
    // Nothing in the string distinguishes the two, and guessing wrong is how
    // the S23 gets reported as a misspelling of the S24. The row is still
    // HELD — it is only the suggestion that is withheld, and the operator
    // still has the catalogue picker.
    expect(findModelNearMiss('Galaxy S244 Ultra', CATALOG)).toBeNull();
  });

  /** The one crack the guard leaves open, and why it is safe: a transposition
   *  cannot change WHICH digits are present, only their order, and no two real
   *  phones are digit-anagrams of each other. There is no iPhone 41. */
  it('catches a transposition of the generation digits', () => {
    expect(findModelNearMiss('iPhone 41', CATALOG)?.match).toBe('iPhone 14');
    expect(findModelNearMiss('iPhone 31', CATALOG)?.match).toBe('iPhone 13');
    expect(findModelNearMiss('Galaxy S42 Ultra', CATALOG)?.match).toBe('Galaxy S24 Ultra');
  });

  it('does not treat a wholesale digit reshuffle as a transposition', () => {
    // Same characters, but more than one swap apart — at that point it is not
    // a slip, and pretending to know what was meant is a guess.
    expect(findModelNearMiss('Redmi Note 21', ['Redmi Note 12'])?.match).toBe('Redmi Note 12');
    expect(findModelNearMiss('Model 4321', ['Model 1234'])).toBeNull();
  });

  it('treats a storage size as generation-bearing too', () => {
    // 128GB and 256GB are one substitution apart and both are real.
    const hit = findModelNearMiss('Galaxy S24 128GB', ['Galaxy S24 256GB']);
    expect(hit).toBeNull();
  });
});

describe('no two genuine catalogue entries flag each other', () => {
  // The tuning requirement. If this fails, the check is producing noise on
  // correct data and will be ignored — which converts every false positive
  // into a false negative.
  for (const entry of CATALOG) {
    it(`${entry} is not reported as a misspelling of anything else`, () => {
      const others = CATALOG.filter(m => m !== entry);
      expect(findModelNearMiss(entry, others)).toBeNull();
    });
  }
});
