import { describe, it, expect } from 'vitest';
import type { ReturnEvent, ReturnEventType } from '../types';
import {
  normalizeImei,
  compareEventsNewestFirst,
  groupReturnEventsByImei,
  unitReturnTimeline,
  latestReturnEvent,
  countEventsOfType,
  backToInventoryCount,
  dispositionCounts,
} from '../lib/returnsLifecycle';

// ── Factory ─────────────────────────────────────────────────────────────────
let seq = 0;
function makeEvent(overrides: Partial<ReturnEvent> = {}): ReturnEvent {
  seq += 1;
  return {
    id: overrides.id ?? `ret-${seq}`,
    imei: overrides.imei ?? '353209102768686',
    unitId: overrides.unitId ?? 'unit-1',
    type: overrides.type ?? 'restocked',
    date: overrides.date ?? '2026-01-01',
    comment: overrides.comment,
    supplierId: overrides.supplierId,
    supplierName: overrides.supplierName,
    actorUid: overrides.actorUid ?? 'uid-admin',
    actorEmail: overrides.actorEmail ?? 'admin@inventorymanager.com',
    createdAt: overrides.createdAt ?? `2026-01-01T00:00:0${seq % 10}.000Z`,
    ownerId: 'shared',
  };
}

// ── normalizeImei ─────────────────────────────────────────────────────────────
describe('normalizeImei', () => {
  it('trims and upper-cases', () => {
    expect(normalizeImei('  abc123  ')).toBe('ABC123');
  });
  it('maps blank/nullish to a stable sentinel', () => {
    expect(normalizeImei('')).toBe('(no-imei)');
    expect(normalizeImei(null)).toBe('(no-imei)');
    expect(normalizeImei(undefined)).toBe('(no-imei)');
  });
});

// ── Single unit returned to inventory 5 times — the headline scenario ─────────
describe('a unit sold & returned-to-inventory 5 times keeps a full dated history', () => {
  const IMEI = '999000000000001';
  // 5 distinct return-to-inventory ("restocked") events on 5 dates, supplied
  // out of order to prove sorting is by date, not insertion order.
  const dates = ['2026-03-10', '2026-01-05', '2026-05-22', '2026-02-14', '2026-04-01'];
  const events = dates.map((d, i) =>
    makeEvent({ id: `r${i}`, imei: IMEI, type: 'restocked', date: d, comment: `return #${i + 1}` }),
  );

  it('counts exactly 5 back-to-inventory returns for the IMEI', () => {
    expect(backToInventoryCount(events, IMEI)).toBe(5);
    expect(countEventsOfType(events, IMEI, 'restocked')).toBe(5);
  });

  it('builds a chronological (oldest→newest) timeline of all 5 returns', () => {
    const timeline = unitReturnTimeline(events, IMEI);
    expect(timeline.map(e => e.date)).toEqual([
      '2026-01-05', '2026-02-14', '2026-03-10', '2026-04-01', '2026-05-22',
    ]);
  });

  it('reports the latest return event correctly', () => {
    expect(latestReturnEvent(events, IMEI)?.date).toBe('2026-05-22');
  });

  it('groups under one IMEI bucket, newest-first', () => {
    const grouped = groupReturnEventsByImei(events);
    expect(grouped).toHaveLength(1);
    const [imei, bucket] = grouped[0];
    expect(imei).toBe(IMEI);
    expect(bucket.map(e => e.date)).toEqual([
      '2026-05-22', '2026-04-01', '2026-03-10', '2026-02-14', '2026-01-05',
    ]);
  });
});

// ── Mixed lifecycle: sold → returned → restocked → … → sent to supplier ───────
describe('mixed multi-disposition lifecycle for one IMEI', () => {
  const IMEI = '111111111111111';
  const events = [
    makeEvent({ imei: IMEI, type: 'restocked',        date: '2026-01-10' }),
    makeEvent({ imei: IMEI, type: 'sent_to_repair',   date: '2026-02-10' }),
    makeEvent({ imei: IMEI, type: 'repair_complete',  date: '2026-02-20' }),
    makeEvent({ imei: IMEI, type: 'restocked',        date: '2026-03-01' }),
    makeEvent({ imei: IMEI, type: 'sent_to_supplier', date: '2026-04-01' }),
  ];

  it('tallies dispositions per type', () => {
    expect(dispositionCounts(events, IMEI)).toEqual({
      restocked: 2,
      sent_to_repair: 1,
      repair_complete: 1,
      sent_to_supplier: 1,
    });
  });

  it('orders the full chain by date', () => {
    expect(unitReturnTimeline(events, IMEI).map(e => e.type)).toEqual<ReturnEventType[]>([
      'restocked', 'sent_to_repair', 'repair_complete', 'restocked', 'sent_to_supplier',
    ]);
  });
});

// ── Isolation between IMEIs ───────────────────────────────────────────────────
describe('multiple IMEIs do not bleed into each other', () => {
  const events = [
    makeEvent({ imei: 'AAA', type: 'restocked', date: '2026-01-01' }),
    makeEvent({ imei: 'aaa', type: 'restocked', date: '2026-02-01' }), // same unit, lowercase
    makeEvent({ imei: 'BBB', type: 'restocked', date: '2026-03-01' }),
  ];

  it('normalizes case so one physical IMEI is one bucket', () => {
    const grouped = groupReturnEventsByImei(events);
    const map = new Map(grouped);
    expect(map.get('AAA')).toHaveLength(2);
    expect(map.get('BBB')).toHaveLength(1);
    expect(backToInventoryCount(events, 'aaa')).toBe(2);
  });

  it('orders buckets by most-recent event (BBB newest first)', () => {
    expect(groupReturnEventsByImei(events).map(([imei]) => imei)).toEqual(['BBB', 'AAA']);
  });
});

// ── Deterministic tie-breaking for same-day events ────────────────────────────
describe('same-day events are ordered deterministically', () => {
  it('breaks date ties by createdAt then id (newest-first comparator)', () => {
    const a = makeEvent({ id: 'a', date: '2026-01-01', createdAt: '2026-01-01T09:00:00.000Z' });
    const b = makeEvent({ id: 'b', date: '2026-01-01', createdAt: '2026-01-01T17:00:00.000Z' });
    // b is later in the day → newest-first should place b before a.
    expect(compareEventsNewestFirst(a, b)).toBeGreaterThan(0);
    expect(compareEventsNewestFirst(b, a)).toBeLessThan(0);
    const grouped = groupReturnEventsByImei([a, b]);
    expect(grouped[0][1].map(e => e.id)).toEqual(['b', 'a']);
  });
});

// ── Empty / edge ──────────────────────────────────────────────────────────────
describe('edge cases', () => {
  it('returns empty structures for an unknown IMEI', () => {
    expect(unitReturnTimeline([], 'NOPE')).toEqual([]);
    expect(latestReturnEvent([], 'NOPE')).toBeNull();
    expect(backToInventoryCount([], 'NOPE')).toBe(0);
    expect(groupReturnEventsByImei([])).toEqual([]);
  });
});
