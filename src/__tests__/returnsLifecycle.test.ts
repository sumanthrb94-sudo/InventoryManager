import { describe, it, expect } from 'vitest';
import type { ReturnEvent, ReturnEventType } from '../types';
import type { InventoryUnit, Sale } from '../types';
import {
  normalizeImei,
  compareEventsNewestFirst,
  groupReturnEventsByImei,
  unitReturnTimeline,
  latestReturnEvent,
  countEventsOfType,
  backToInventoryCount,
  dispositionCounts,
  summarizeUnitLife,
  buildUnitHistory,
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

// ── summarizeUnitLife — life history + P&L foundation ──────────────────────────
function makeUnit(o: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'unit-1', imei: '353209102768686', model: 'iPhone 12', brand: 'Apple',
    category: 'iPhone', colour: 'Black', buyPrice: 200, dateIn: '2026-01-01',
    supplierId: 'sup-1', status: 'available', flags: [], notes: '',
    platformListed: false, listingSites: [], ownerId: 'shared',
    createdAt: '2026-01-01T00:00:00.000Z', ...o,
  } as InventoryUnit;
}
function makeSale(o: Partial<Sale> = {}): Sale {
  return {
    id: o.id ?? 'sale-1', unitId: 'unit-1', imei: '353209102768686',
    saleDate: o.saleDate ?? '2026-02-01', quantity: 1, buyPrice: 200, salePrice: 320,
    spMinusBp: 120, marginalTax: 0, commission: 0, marketplace: 'eBay',
    orderNumber: o.id ?? 'ord-1', ...o,
  } as Sale;
}

describe('summarizeUnitLife', () => {
  it('marks a currently-sold unit with its sale date, price and margin', () => {
    const unit = makeUnit({ status: 'sold', saleDate: '2026-02-01', salePrice: 320, postageCost: 8 });
    const life = summarizeUnitLife(unit, [makeSale({ saleDate: '2026-02-01', salePrice: 320 })]);
    expect(life.state).toBe('sold');
    expect(life.soldDate).toBe('2026-02-01');
    expect(life.salePrice).toBe(320);
    expect(life.buyPrice).toBe(200);
    expect(life.grossMargin).toBe(112); // 320 − 200 − 8
    expect(life.timesSold).toBe(1);
    expect(life.timesReturned).toBe(0);
  });

  it('counts every sell→return round-trip: returned 10×, sold the 11th time', () => {
    // 10 prior sales that were each returned (voided) + 1 current active sale.
    const voided: Sale[] = Array.from({ length: 10 }, (_, i) =>
      makeSale({ id: `s${i}`, saleDate: `2026-03-0${(i % 9) + 1}`, voidedAt: `2026-03-1${i % 9}` }),
    );
    const active = makeSale({ id: 's-final', saleDate: '2026-05-01', salePrice: 350 });
    const unit = makeUnit({ status: 'sold', saleDate: '2026-05-01', salePrice: 350 });
    const life = summarizeUnitLife(unit, [...voided, active]);
    expect(life.timesReturned).toBe(10);
    expect(life.timesSold).toBe(11);
    expect(life.state).toBe('sold');
    expect(life.soldDate).toBe('2026-05-01');
  });

  it('reports available / in-repair / to-supplier states from the unit doc', () => {
    expect(summarizeUnitLife(makeUnit({ status: 'available' }), []).state).toBe('available');
    expect(summarizeUnitLife(makeUnit({ status: 'returned', returnType: 'repair' }), []).state).toBe('in_repair');
    expect(summarizeUnitLife(makeUnit({ status: 'returned', returnType: 'returned_to_supplier' }), []).state).toBe('to_supplier');
  });

  it('treats a missing unit doc (soft-deleted to supplier) as to_supplier', () => {
    expect(summarizeUnitLife(null, []).state).toBe('to_supplier');
  });
});

describe('buildUnitHistory', () => {
  it('weaves intake, sales and return events into one chronological story', () => {
    const unit = makeUnit({ dateIn: '2026-01-01', listingDate: '2026-01-05', status: 'sold', saleDate: '2026-04-01' });
    const sales: Sale[] = [
      makeSale({ id: 's1', saleDate: '2026-02-01', salePrice: 300, voidedAt: '2026-02-10', createdAt: '2026-02-01T00:00:00Z' }),
      makeSale({ id: 's2', saleDate: '2026-04-01', salePrice: 330, createdAt: '2026-04-01T00:00:00Z' }),
    ];
    const events: ReturnEvent[] = [
      makeEvent({ type: 'restocked', date: '2026-02-10', comment: 'Customer changed mind', createdAt: '2026-02-10T00:00:00Z' }),
    ];
    const steps = buildUnitHistory(unit, events, sales);
    expect(steps.map(s => s.kind)).toEqual(['intake', 'listed', 'sold', 'restocked', 'sold']);
    // The return step keeps its comment so "a comment for each return" shows.
    expect(steps[3].comment).toBe('Customer changed mind');
    // The first sale is flagged as later-returned.
    expect(steps[2].label).toContain('later returned');
  });

  it('orders same-day intake → sold → returned deterministically', () => {
    const unit = makeUnit({ dateIn: '2026-03-01' });
    const steps = buildUnitHistory(
      unit,
      [makeEvent({ type: 'returned', date: '2026-03-01', createdAt: '2026-03-01T12:00:00Z' })],
      [makeSale({ saleDate: '2026-03-01', createdAt: '2026-03-01T09:00:00Z' })],
    );
    expect(steps.map(s => s.kind)).toEqual(['intake', 'sold', 'returned']);
  });

  it('returns an empty story when there is nothing to show', () => {
    expect(buildUnitHistory(null, [], [])).toEqual([]);
  });

  it('synthesizes the current disposition when no event logged it (imported / legacy)', () => {
    // Unit is To Supplier, but the only logged events are older restocks —
    // the timeline must still show "returned to supplier", not just inventory.
    const unit = makeUnit({
      status: 'returned', returnType: 'returned_to_supplier',
      returnDate: '2026-03-10', returnReason: 'Faulty — back to MHL', supplierName: 'MHL',
    });
    const events: ReturnEvent[] = [
      makeEvent({ type: 'restocked', date: '2026-01-05', comment: 'cycle 1' }),
      makeEvent({ type: 'restocked', date: '2026-02-05', comment: 'cycle 2' }),
    ];
    const steps = buildUnitHistory(unit, events, []);
    const last = steps[steps.length - 1];
    expect(last.kind).toBe('sent_to_supplier');
    expect(last.label).toContain('supplier');
    expect(last.comment).toBe('Faulty — back to MHL');
  });

  it('orders same-day cycles by real timestamp, not grouped by type', () => {
    // All on one day (operator testing). createdAt encodes the true sequence:
    // sold → repair → repaired-back → resold → returned-to-supplier.
    const unit = makeUnit({ dateIn: '2026-06-04', status: 'returned', returnType: 'returned_to_supplier', returnDate: '2026-06-04' });
    const sales: Sale[] = [
      makeSale({ id: 'a', saleDate: '2026-06-04', voidedAt: '2026-06-04', createdAt: '2026-06-04T09:00:00Z' }),
      makeSale({ id: 'b', saleDate: '2026-06-04', voidedAt: '2026-06-04', createdAt: '2026-06-04T12:00:00Z' }),
    ];
    const events: ReturnEvent[] = [
      makeEvent({ type: 'sent_to_repair',   date: '2026-06-04', createdAt: '2026-06-04T10:00:00Z' }),
      makeEvent({ type: 'repair_complete',  date: '2026-06-04', createdAt: '2026-06-04T11:00:00Z' }),
      makeEvent({ type: 'sent_to_supplier', date: '2026-06-04', createdAt: '2026-06-04T13:00:00Z' }),
    ];
    const steps = buildUnitHistory(unit, events, sales);
    // intake first, then strict createdAt order — NOT all 'sold' grouped together.
    expect(steps.map(s => s.kind)).toEqual([
      'intake', 'sold', 'sent_to_repair', 'repair_complete', 'sold', 'sent_to_supplier',
    ]);
  });

  it('carries the createdAt timestamp through (ISO) so the UI can show the time', () => {
    const unit = makeUnit({ dateIn: '2026-06-04' });
    const steps = buildUnitHistory(
      unit,
      [makeEvent({ type: 'restocked', date: '2026-06-04', createdAt: '2026-06-04T14:30:00Z' })],
      [],
    );
    const restock = steps.find(s => s.kind === 'restocked')!;
    expect(restock.at).toBe('2026-06-04T14:30:00.000Z');
  });

  it('normalizes Firestore Timestamp createdAt (serverTimestamp) to ISO', () => {
    // Firestore stores createdAt as serverTimestamp → reads back as a Timestamp
    // object, not a string. Both shapes must yield a parseable ISO so the time
    // of day renders (String(timestamp) used to produce an unparseable value).
    const unit = makeUnit({ dateIn: '2026-06-04' });
    const tsObj = { seconds: Math.floor(Date.parse('2026-06-04T14:30:00Z') / 1000), nanoseconds: 0 };
    const steps = buildUnitHistory(
      unit,
      [makeEvent({ type: 'restocked', date: '2026-06-04', createdAt: tsObj as any })],
      [],
    );
    const restock = steps.find(s => s.kind === 'restocked')!;
    expect(restock.at).toBe('2026-06-04T14:30:00.000Z');
    expect(Number.isNaN(new Date(restock.at!).getTime())).toBe(false);
  });

  it('does NOT duplicate the disposition when a matching event already exists', () => {
    const unit = makeUnit({ status: 'returned', returnType: 'returned_to_supplier', returnDate: '2026-03-10' });
    const events: ReturnEvent[] = [
      makeEvent({ type: 'sent_to_supplier', date: '2026-03-10', comment: 'logged properly' }),
    ];
    const steps = buildUnitHistory(unit, events, []);
    expect(steps.filter(s => s.kind === 'sent_to_supplier')).toHaveLength(1);
  });
});
