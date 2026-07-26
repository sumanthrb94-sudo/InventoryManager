/**
 * One supplier, one row — from either side of the join.
 *
 * Units carry `supplierId`. Imported sales do not: salesImport reads the
 * Supplier column into `supplierName` and never resolves it. Any screen that
 * grouped both by `supplierId` therefore split every supplier in two, and
 * worse, dropped every imported sale into a single `supplierId || 'unknown'`
 * bucket labelled with whichever sale sorted first.
 *
 * The live symptom: a supplier table with NIHAL on it twice — one row holding
 * all 354 sales, £56,910 revenue and a return rate of "—" (no units to divide
 * by), one row holding the units with zero sales — and every other supplier
 * reading £0. The first row was never NIHAL. It was the catch-all.
 *
 * Note what a "parts sum to the whole" check does NOT catch here: the sales
 * total was right. 354 sales were all present, just all in one wrong row.
 * Correct totals, worthless attribution. Hence the last block.
 */
import { describe, it, expect } from 'vitest';
import {
  normaliseSupplierName, buildSupplierIndex, resolveSupplier, groupBySupplier,
} from '../../lib/supplierIdentity';
import type { Supplier } from '../../types';

const supplier = (id: string, name: string) => ({ id, name }) as Supplier;

const CATALOG = [
  supplier('sup-1', 'NIHAL'),
  supplier('sup-2', 'MOBILE KIT'),
  supplier('sup-3', 'RR STOCK'),
];
const index = buildSupplierIndex(CATALOG);

/** A unit, as stock intake writes it. */
const unit = (supplierId?: string, supplierName?: string) => ({ supplierId, supplierName });
/** A sale, as the importer writes it — name only, never an id. */
const importedSale = (supplierName: string) => ({ supplierName });

describe('normaliseSupplierName', () => {
  it('collapses case, spacing and punctuation', () => {
    for (const v of ['NIHAL', 'nihal', ' Nihal ', 'N.I.H.A.L']) {
      expect(normaliseSupplierName(v)).toBe('NIHAL');
    }
  });

  it('keeps genuinely different names apart', () => {
    // MOBILE KIT and MOBIL KIT are a real typo pair in the live data. They
    // are different suppliers until someone says otherwise.
    expect(normaliseSupplierName('MOBILE KIT')).not.toBe(normaliseSupplierName('MOBIL KIT'));
  });
});

describe('resolving a unit', () => {
  it('uses its supplierId', () => {
    const r = resolveSupplier(unit('sup-1', 'NIHAL'), index);
    expect(r).toMatchObject({ key: 'sup-1', name: 'NIHAL', known: true });
  });

  it('prefers the catalog name over whatever the unit stored', () => {
    // The catalog is the source of truth for display; a stale name on a unit
    // should not fork the row.
    expect(resolveSupplier(unit('sup-1', 'nihal ltd'), index).name).toBe('NIHAL');
  });
});

describe('resolving an imported sale — the one with no id', () => {
  it('matches it to the supplier record by name', () => {
    const r = resolveSupplier(importedSale('NIHAL'), index);
    expect(r).toMatchObject({ key: 'sup-1', known: true });
  });

  it('matches regardless of case or spacing', () => {
    expect(resolveSupplier(importedSale('  nihal  '), index).key).toBe('sup-1');
    expect(resolveSupplier(importedSale('Mobile  Kit'), index).key).toBe('sup-2');
  });

  it('lands on the SAME key as the unit for that supplier', () => {
    // This is the whole fix: both sides of the join must agree.
    expect(resolveSupplier(importedSale('NIHAL'), index).key)
      .toBe(resolveSupplier(unit('sup-1'), index).key);
  });
});

describe('attribution that cannot be resolved', () => {
  it('keeps an unknown supplier under its own name, not a shared bucket', () => {
    // The old code merged every unattributed sale into one 'unknown' row.
    // Separate rows are both truer and visibly wrong in a useful way.
    const a = resolveSupplier(importedSale('BRAND NEW SUPPLIER'), index);
    const b = resolveSupplier(importedSale('ANOTHER ONE'), index);
    expect(a.key).not.toBe(b.key);
    expect(a.known).toBe(false);
    expect(a.name).toBe('BRAND NEW SUPPLIER');
  });

  it('keeps an unrecognised id distinct rather than merging it', () => {
    const r = resolveSupplier(unit('sup-deleted', 'GONE LTD'), index);
    expect(r.key).toBe('sup-deleted');
    expect(r.known).toBe(false);
  });

  it('has exactly one bucket for records with no supplier at all', () => {
    expect(resolveSupplier({}, index).key).toBe('unattributed');
    expect(resolveSupplier(unit('', ''), index).key).toBe('unattributed');
  });
});

describe('a duplicated supplier name in the catalog', () => {
  it('resolves consistently rather than by iteration order', () => {
    const dupes = buildSupplierIndex([supplier('a', 'NIHAL'), supplier('b', 'NIHAL')]);
    expect(resolveSupplier(importedSale('NIHAL'), dupes).key)
      .toBe(resolveSupplier(importedSale('nihal'), dupes).key);
  });
});

describe('the live failure, reconstructed', () => {
  // 354 sales carrying only a name, plus units carrying only an id.
  const sales = Array.from({ length: 354 }, () => importedSale('NIHAL'));
  const units = Array.from({ length: 40 }, () => unit('sup-1', 'NIHAL'));

  it('the old keying put every sale in one bucket', () => {
    const oldKeyed = new Map<string, number>();
    for (const s of sales) {
      const key = (s as any).supplierId || 'unknown';
      oldKeyed.set(key, (oldKeyed.get(key) ?? 0) + 1);
    }
    expect(oldKeyed.get('unknown')).toBe(354);
    expect(oldKeyed.has('sup-1')).toBe(false);   // the real supplier: nothing
  });

  it('sales and units now land on the same supplier', () => {
    const salesByKey = groupBySupplier(sales, index, () => ({ n: 0 }), acc => { acc.n++; });
    const unitsByKey = groupBySupplier(units, index, () => ({ n: 0 }), acc => { acc.n++; });
    expect([...salesByKey.keys()]).toEqual(['sup-1']);
    expect([...unitsByKey.keys()]).toEqual(['sup-1']);
    expect(salesByKey.get('sup-1')!.value.n).toBe(354);
    expect(unitsByKey.get('sup-1')!.value.n).toBe(40);
  });

  it('so the return-rate denominator exists — no more "—" on the busiest row', () => {
    const unitsByKey = groupBySupplier(units, index, () => ({ total: 0 }), acc => { acc.total++; });
    expect(unitsByKey.get('sup-1')!.value.total).toBeGreaterThan(0);
  });

  it('a correct TOTAL never proved attribution was right', () => {
    // The reason a sum-to-the-whole check missed this: all 354 sales were
    // present and counted. They were simply all on the wrong row.
    const total = [...groupBySupplier(sales, index, () => ({ n: 0 }), acc => { acc.n++; }).values()]
      .reduce((a, e) => a + e.value.n, 0);
    expect(total).toBe(354);        // true before the fix as well
    expect(groupBySupplier(sales, index, () => ({ n: 0 }), acc => { acc.n++; }).size).toBe(1);
  });
});

describe('groupBySupplier', () => {
  it('merges units and sales for the same supplier under one key', () => {
    const mixed = [unit('sup-2', 'MOBILE KIT'), importedSale('MOBILE KIT'), importedSale('mobile kit')];
    const grouped = groupBySupplier(mixed, index, () => ({ n: 0 }), acc => { acc.n++; });
    expect(grouped.size).toBe(1);
    expect(grouped.get('sup-2')!.value.n).toBe(3);
  });

  it('carries the resolved display name for each group', () => {
    const grouped = groupBySupplier([importedSale('rr stock')], index, () => null, () => {});
    expect(grouped.get('sup-3')!.supplier.name).toBe('RR STOCK');
  });
});
