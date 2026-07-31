/**
 * The import's error banner has to tell two failures apart, because the right
 * response to each is the opposite of the other.
 *
 * An ordinary failure — a rejected write, a missing field, a bad row — means
 * "fix the cause and press Load again". A quota exhaustion means "pressing
 * Load again will fail identically AND spend the next day's allowance". The
 * operator hit the second one and, shown only Google's raw text, retried
 * repeatedly. That is the loop this guard exists to break.
 *
 * The strings below are the genuine article: the first is copied verbatim from
 * the failure the operator hit on 2026-07-31 against the AI Studio-provisioned
 * database, which is a free-tier database whose caps hold even with billing
 * enabled on the project.
 */
import { describe, it, expect } from 'vitest';
import { isQuotaError } from '../../components/SalesReportImport';

const REAL_QUOTA_ERROR =
  "Quota limit exceeded. Retry after quota limits are reset or enable billing for this "
  + "project to avoid quota checks. Cause - Quota exceeded for quota metric 'Free daily read "
  + "units per project (free tier database)' and limit 'Free daily read units per project "
  + "(free tier database) per day' of service 'firestore.googleapis.com' for consumer "
  + "'project_number:203142040541'. This database cannot exceed free quota limits even when "
  + "a billing instrument is enabled. — failed while restoring returns.";

describe('isQuotaError', () => {
  it('recognises the exact failure the operator hit', () => {
    expect(isQuotaError(REAL_QUOTA_ERROR)).toBe(true);
  });

  it('recognises the gRPC status name, which is how some SDK paths surface it', () => {
    expect(isQuotaError('FirebaseError: RESOURCE_EXHAUSTED: quota metric exceeded')).toBe(true);
    expect(isQuotaError('failed-precondition? no: resource-exhausted')).toBe(true);
  });

  it('recognises the short form without the "limit" wording', () => {
    expect(isQuotaError('Quota exceeded for quota metric ...')).toBe(true);
  });

  it.each([
    'Missing or insufficient permissions.',
    'Save failed. Check connection.',
    'Unit 355864341213049 not found.',
    'IMEI 355864341213049 is already in inventory.',
    'Import failed during write — failed while creating / patching inventory units.',
    '',
  ])('does not misread an ordinary failure as a quota problem: %s', msg => {
    // A false positive is costly the other way round: it would tell the
    // operator to stop and wait until tomorrow over a fixable one-row error.
    expect(isQuotaError(msg)).toBe(false);
  });
});
