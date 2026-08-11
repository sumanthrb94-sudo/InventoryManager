/**
 * sanitiseFsIdSegment — the Firestore document-id scrub.
 *
 * This had no direct test for its whole life. It was defined inside
 * salesImport.ts and only ever exercised incidentally, through import
 * round-trip suites that asserted on the resulting sale ids.
 *
 * When the importers were deleted (2026-08) this function had to move out
 * first, because recordSale / recordBulkSales still depend on it for every
 * sale written from the app. A hand-retyped move silently widened the
 * character class to `[/\\ -]`, which replaces every SPACE and HYPHEN — so
 * `206-5248339-8852336` would have become `206_5248339_8852336` and every
 * sale id in the app would have changed shape without a single test failing.
 *
 * Hence this file. The point of it is the negative cases: what must SURVIVE.
 */
import { describe, it, expect } from 'vitest';
import { sanitiseFsIdSegment } from '../../lib/firestoreIds';

describe('sanitiseFsIdSegment', () => {
  it('replaces the Firestore path separator, which is the whole reason it exists', () => {
    // A `/` left in an id splits one document reference into several path
    // segments and Firestore rejects the write with "must have an even
    // number of segments".
    expect(sanitiseFsIdSegment('AMZ/123')).toBe('AMZ_123');
    expect(sanitiseFsIdSegment('a/b/c')).toBe('a_b_c');
  });

  it('replaces backslashes and ASCII control characters', () => {
    expect(sanitiseFsIdSegment('AMZ\\123')).toBe('AMZ_123');
    // Written as \u escapes on purpose: a literal control character in the
    // source is invisible in a diff and turns the file binary to git.
    expect(sanitiseFsIdSegment('AMZ\u0000123')).toBe('AMZ_123');
    expect(sanitiseFsIdSegment('AMZ\u001f123')).toBe('AMZ_123');
    expect(sanitiseFsIdSegment('AMZ\u007f123')).toBe('AMZ_123');
    expect(sanitiseFsIdSegment('AMZ\tABC')).toBe('AMZ_ABC');
  });

  it('LEAVES HYPHENS ALONE — a real marketplace order number is hyphenated', () => {
    // The common case, and the one a widened character class destroys.
    expect(sanitiseFsIdSegment('206-5248339-8852336')).toBe('206-5248339-8852336');
  });

  it('leaves spaces, dots and colons alone', () => {
    expect(sanitiseFsIdSegment('ORDER 123')).toBe('ORDER 123');
    expect(sanitiseFsIdSegment('v1.2.3')).toBe('v1.2.3');
    expect(sanitiseFsIdSegment('2026-08-11T09:15:00')).toBe('2026-08-11T09:15:00');
  });

  it('trims the ends but not the middle', () => {
    expect(sanitiseFsIdSegment('  AMZ-1  ')).toBe('AMZ-1');
    expect(sanitiseFsIdSegment('AMZ 1')).toBe('AMZ 1');
  });

  it('survives null and undefined rather than throwing', () => {
    expect(sanitiseFsIdSegment(null as unknown as string)).toBe('');
    expect(sanitiseFsIdSegment(undefined as unknown as string)).toBe('');
    expect(sanitiseFsIdSegment('')).toBe('');
  });

  it('is idempotent — scrubbing an already-clean id changes nothing', () => {
    const clean = '206-5248339-8852336';
    expect(sanitiseFsIdSegment(sanitiseFsIdSegment(clean))).toBe(clean);
  });
});
