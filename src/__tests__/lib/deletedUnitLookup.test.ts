/**
 * The intake-side archive lookup.
 *
 * This runs on every IMEI an operator types or scans, and the answer is "no"
 * almost every time. So the tests that matter most here are the READ-COST
 * ones: a miss must be remembered, and two screens asking at once must not
 * become two queries. This app has already lost two days to a read quota
 * burning through by lunchtime — a per-keystroke query on the busiest screen
 * in the product is exactly how that happens again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DeletedUnitRecord } from '../../types';

const calls: string[] = [];
let rowsByImei: Record<string, any[]> = {};
let failNext = false;

vi.mock('../../lib/dbService', () => ({
  dbService: {
    async queryDeletedUnitsByImei(imei: string) {
      calls.push(imei);
      if (failNext) { failNext = false; throw new Error('network down'); }
      return rowsByImei[imei] ?? [];
    },
  },
}));

import {
  lookupDeletedUnit,
  lookupDeletedUnits,
  describeDeletion,
  formatDeletionDate,
  resetDeletedUnitLookupCache,
} from '../../lib/deletedUnitLookup';

function rec(over: Partial<DeletedUnitRecord> = {}): DeletedUnitRecord {
  return {
    id: 'del_1', imei: '350100000000000', unitId: 'u1', source: 'office',
    reason: 'QC failed — liquid damage', deletedAt: '2026-08-12T10:00:00.000Z',
    deletedBy: 'sai@inventorymanager.com', model: 'IPHONE 13',
    snapshot: {}, ownerId: 'shared',
    ...over,
  } as DeletedUnitRecord;
}

beforeEach(() => {
  calls.length = 0;
  rowsByImei = {};
  failNext = false;
  resetDeletedUnitLookupCache();
});

describe('lookupDeletedUnit', () => {
  it('finds the deletion for an IMEI', async () => {
    rowsByImei['350100000000000'] = [rec()];
    const found = await lookupDeletedUnit('350100000000000');
    expect(found?.reason).toBe('QC failed — liquid damage');
  });

  it('normalises before asking — a pasted zero-width space must still match', async () => {
    rowsByImei['350100000000000'] = [rec()];
    const found = await lookupDeletedUnit('\u200B350100000000000\u00A0 ');
    expect(found?.id).toBe('del_1');
    expect(calls).toEqual(['350100000000000']);
  });

  it('CACHES MISSES — the common case must not bill a read every time', async () => {
    expect(await lookupDeletedUnit('350100000000000')).toBeNull();
    expect(await lookupDeletedUnit('350100000000000')).toBeNull();
    expect(await lookupDeletedUnit('350100000000000')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('caches hits too', async () => {
    rowsByImei['350100000000000'] = [rec()];
    await lookupDeletedUnit('350100000000000');
    await lookupDeletedUnit('350100000000000');
    expect(calls).toHaveLength(1);
  });

  it('shares one in-flight query between concurrent askers', async () => {
    rowsByImei['350100000000000'] = [rec()];
    const [a, b, c] = await Promise.all([
      lookupDeletedUnit('350100000000000'),
      lookupDeletedUnit('350100000000000'),
      lookupDeletedUnit('350100000000000'),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('returns the NEWEST deletion when a unit was deleted, re-added and deleted again', async () => {
    rowsByImei['350100000000000'] = [
      rec({ id: 'del_old', deletedAt: '2026-06-01T09:00:00.000Z', reason: 'first removal' }),
      rec({ id: 'del_new', deletedAt: '2026-08-12T10:00:00.000Z', reason: 'second removal' }),
    ];
    const found = await lookupDeletedUnit('350100000000000');
    expect(found?.id).toBe('del_new');
  });

  it('ignores VOID records — the unit is still in stock', async () => {
    // A void record means the archive write landed but the delete failed.
    // Warning about it would be a permanent lie: the collection is
    // append-only, so the record never goes away.
    rowsByImei['350100000000000'] = [rec({ voided: true, voidedReason: 'delete failed' })];
    expect(await lookupDeletedUnit('350100000000000')).toBeNull();
  });

  it('prefers the newest NON-void record over a newer void one', async () => {
    rowsByImei['350100000000000'] = [
      rec({ id: 'del_void', deletedAt: '2026-09-01T00:00:00.000Z', voided: true }),
      rec({ id: 'del_real', deletedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect((await lookupDeletedUnit('350100000000000'))?.id).toBe('del_real');
  });

  it('returns null for a blank IMEI without querying', async () => {
    expect(await lookupDeletedUnit('')).toBeNull();
    expect(await lookupDeletedUnit(undefined)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('never throws, and does NOT cache a failure', async () => {
    // A network blip must not become a session-long "never deleted" answer.
    failNext = true;
    expect(await lookupDeletedUnit('350100000000000')).toBeNull();
    rowsByImei['350100000000000'] = [rec()];
    expect((await lookupDeletedUnit('350100000000000'))?.id).toBe('del_1');
    expect(calls).toHaveLength(2);
  });
});

describe('lookupDeletedUnits', () => {
  it('de-duplicates repeated IMEIs into one query each', async () => {
    rowsByImei['350100000000000'] = [rec()];
    const found = await lookupDeletedUnits([
      '350100000000000', '350100000000000', '350100000000001', '', undefined,
    ]);
    expect(calls.sort()).toEqual(['350100000000000', '350100000000001']);
    expect(found.get('350100000000000')?.id).toBe('del_1');
    expect(found.has('350100000000001')).toBe(false);
  });
});

describe('describeDeletion', () => {
  it('names the reason, the date and who did it', () => {
    const line = describeDeletion(rec());
    expect(line).toContain('Previously removed from inventory');
    expect(line).toContain('QC failed — liquid damage');
    expect(line).toContain('12 Aug 2026');
    expect(line).toContain('by sai@inventorymanager.com');
  });

  it('says "no reason recorded" rather than leaving a dangling separator', () => {
    // 139 existing deletions carry a reason like "." — the archive stores it
    // verbatim, so the renderer is where it has to be made readable.
    expect(describeDeletion(rec({ reason: '.' }))).toContain('(no reason recorded)');
    expect(describeDeletion(rec({ reason: '   ' }))).toContain('(no reason recorded)');
    expect(describeDeletion(rec({ reason: '' }))).not.toMatch(/·\s*·/);
  });
});

describe('formatDeletionDate', () => {
  it('renders a readable day', () => {
    expect(formatDeletionDate('2026-08-12T10:00:00.000Z')).toBe('12 Aug 2026');
  });
  it('passes unparseable input through rather than printing "Invalid Date"', () => {
    expect(formatDeletionDate('not-a-date')).toBe('not-a-date');
    expect(formatDeletionDate(undefined)).toBe('');
  });
});
