/**
 * normalizeBucketModel — the doubled-brand bucket split.
 *
 * WHAT WENT WRONG IN PRODUCTION
 *
 * Stock Alerts listed one phone as two reorder candidates:
 *
 *   Samsung GALAXY S22 128GB          1 sold · NIHAL
 *   Samsung SAMSUNG GALAXY S22 128GB  3 sold · NANAK / MHL
 *
 * Same handset, same storage, same £140 buy price, split 1 and 3 instead of
 * 4. The doubled "Samsung SAMSUNG" in the second label is the tell.
 *
 * skuBucketKey builds its key from `${brand} ${model}`, and some units carry
 * the brand inside `model` too. normalizeBucketModel stripped the leading
 * brand exactly once, so:
 *
 *   "Samsung" + "GALAXY S22"          -> "s22"
 *   "Samsung" + "SAMSUNG GALAXY S22"  -> "samsung galaxy s22"
 *
 * Two keys, two buckets. The periodic table did not show the split because it
 * canonicalises against the admin model catalogue instead, which is also why
 * the two screens disagreed on how many SKUs were out of stock.
 *
 * The fix strips repeatedly. These tests are mostly about what must NOT
 * happen as a result — a greedy strip that eats a real model name would be a
 * worse bug than the one being fixed.
 */
import { describe, it, expect } from 'vitest';
import { normalizeBucketModel } from '../../lib/modelStorage';

describe('normalizeBucketModel collapses a doubled brand', () => {
  it('the production case: both spellings of the S22 reach one key', () => {
    const withPrefix = normalizeBucketModel('Samsung SAMSUNG GALAXY S22');
    const without = normalizeBucketModel('Samsung GALAXY S22');
    expect(withPrefix).toBe(without);
    expect(withPrefix).toBe('s22');
  });

  it('handles the other repeats the same data set produced', () => {
    expect(normalizeBucketModel('Samsung SAMSUNG GALAXY S23 Ultra')).toBe('s23 ultra');
    expect(normalizeBucketModel('Samsung SAMSUNG GALAXY A35')).toBe('a35');
    expect(normalizeBucketModel('Apple APPLE IPHONE 8')).toBe('iphone 8');
  });

  it('is idempotent — normalising an already-normal key changes nothing', () => {
    const once = normalizeBucketModel('Samsung SAMSUNG GALAXY S22');
    expect(normalizeBucketModel(once)).toBe(once);
  });
});

describe('normalizeBucketModel does not over-strip', () => {
  it('keeps a model that is only a brand word, rather than emptying it', () => {
    // The separator requirement is what protects these: with nothing after the
    // brand there is no match, so the string survives. An empty key would
    // collapse every such unit into one meaningless bucket.
    expect(normalizeBucketModel('Samsung')).toBe('samsung');
    expect(normalizeBucketModel('Galaxy')).toBe('galaxy');
    expect(normalizeBucketModel('Apple')).toBe('apple');
  });

  it('keeps the model token order for distinct variants', () => {
    expect(normalizeBucketModel('Galaxy X Cover 5')).toBe('x cover 5');
    expect(normalizeBucketModel('Galaxy X Cover Pro 4G')).toBe('x cover pro 4g');
    expect(normalizeBucketModel('Galaxy X Cover 5'))
      .not.toBe(normalizeBucketModel('Galaxy X Cover Pro 4G'));
  });

  it('leaves a brand word that is not at the start alone', () => {
    // "Tab A" must not lose anything, and an interior word is never a prefix.
    expect(normalizeBucketModel('Galaxy Tab A9')).toBe('tab a9');
    expect(normalizeBucketModel('iPad Apple Pencil Edition')).toBe('ipad apple pencil edition');
  });

  it('still separates genuinely different phones', () => {
    expect(normalizeBucketModel('Samsung GALAXY S22'))
      .not.toBe(normalizeBucketModel('Samsung GALAXY S23'));
    expect(normalizeBucketModel('Samsung SAMSUNG GALAXY S22'))
      .not.toBe(normalizeBucketModel('Samsung SAMSUNG GALAXY S22 Ultra'));
  });

  it('survives blanks and stray whitespace', () => {
    expect(normalizeBucketModel('')).toBe('');
    expect(normalizeBucketModel(null as unknown as string)).toBe('');
    expect(normalizeBucketModel('  Samsung   GALAXY   S22  ')).toBe('s22');
  });
});
