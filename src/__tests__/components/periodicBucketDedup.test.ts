/**
 * Locks the periodic-table de-duplication fix against the operator's
 * 2026-06-20 audit. Five same-displayed-but-split tiles were flagged:
 *
 *   Galaxy S23 128GB — "GALAXY S23"  (8 units) + "S23"          (1 unit)
 *   Galaxy A32 64GB  — "A32"        (110 u)   + "GALAXY A32"    (200 u)
 *   Galaxy A16 128GB — "Galaxy A16" (1 u)     + "A16"           (1 u)
 *   Galaxy A15 128GB — "GALAXY A15" (1 u)     + "Galaxy A15"    (1 u)
 *   X Cover 64GB     — "X COVER 5"  (3 u)     + "X COVER PRO 4G"(3 u)  ← legit different SKU
 *
 * Cause for #1-4: parseBrandModelStorage preserves the raw model token, so
 * "GALAXY S23" and "S23" both passed through with their original strings.
 * The bucket key (model|storage|tag) was therefore case-sensitive AND
 * prefix-sensitive, producing two buckets for the same physical product.
 *
 * Cause for #5: the model strings are genuinely different ("X COVER 5" vs
 * "X COVER PRO 4G"). The buckets ARE distinct; only the tile label
 * (shortCode) collapsed both to "X COVER" because the 8-char cap chopped
 * the distinguishing suffix.
 *
 * Fix verified by these tests:
 *   - normalizeBucketModel collapses GALAXY/Galaxy/(none) prefix + casing
 *   - normalizeBucketModel preserves variant suffixes so XCover 5 / Pro 4G
 *     keep their distinct keys
 *   - shortCode strips the "X COVER" prefix the same way it strips Galaxy /
 *     Tab / iPhone, so the variant suffix surfaces on the tile
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBucketModel,
  shortCode,
} from '../../components/PeriodicInventory';

describe('normalizeBucketModel — false-duplicate audit', () => {
  it('collapses Galaxy/SAMSUNG/casing variants of the SAME product', () => {
    // S23 pair (8 + 1)
    expect(normalizeBucketModel('GALAXY S23')).toBe(normalizeBucketModel('S23'));
    // A32 pair (110 + 200)
    expect(normalizeBucketModel('A32')).toBe(normalizeBucketModel('GALAXY A32'));
    // A16 pair (1 + 1)
    expect(normalizeBucketModel('Galaxy A16')).toBe(normalizeBucketModel('A16'));
    // A15 pair (1 + 1) — pure casing difference
    expect(normalizeBucketModel('GALAXY A15')).toBe(normalizeBucketModel('Galaxy A15'));
    // The "Samsung Galaxy" double prefix also folds in
    expect(normalizeBucketModel('Samsung Galaxy S23')).toBe(normalizeBucketModel('S23'));
  });

  it('keeps VARIANT suffixes distinct (XCover 5 vs Pro 4G are different SKUs)', () => {
    expect(normalizeBucketModel('X Cover 5'))
      .not.toBe(normalizeBucketModel('X Cover Pro 4G'));
    expect(normalizeBucketModel('Galaxy S21'))
      .not.toBe(normalizeBucketModel('Galaxy S21 FE'));
    expect(normalizeBucketModel('Galaxy S24'))
      .not.toBe(normalizeBucketModel('Galaxy S24 Ultra'));
  });

  it('returns lowercased + whitespace-collapsed output', () => {
    expect(normalizeBucketModel('  GALAXY   A15  ')).toBe('a15');
    expect(normalizeBucketModel('Samsung   Galaxy   S22')).toBe('s22');
  });
});

describe('shortCode — XCover label disambiguation', () => {
  it('compresses "X COVER" → "XC" so the variant suffix surfaces without colliding with the tile count', () => {
    // Bare digit "5" was misread by the operator as the unit count
    // (corner badge of the tile is also a number). "XC5" reads as a
    // model code: mixed letters + digits + no leading space.
    expect(shortCode('X COVER 5')).toBe('XC5');
    expect(shortCode('X Cover 5')).toBe('XC5');
    expect(shortCode('X COVER PRO 4G')).toBe('XCPRO 4G');
    expect(shortCode('X Cover Pro 4G')).toBe('XCPro 4G');
  });

  it('still strips Galaxy / Samsung / iPhone / Tab prefixes (regression guard)', () => {
    expect(shortCode('Galaxy S24 Ultra')).toBe('S24U');
    expect(shortCode('iPhone 15')).toBe('15');
    expect(shortCode('Tab A9+')).toBe('A9+');
  });
});
