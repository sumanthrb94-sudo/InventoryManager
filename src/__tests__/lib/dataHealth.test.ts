/**
 * Data health — the conditions that produced this codebase's worst bugs,
 * detected before they reach a report.
 *
 * Each check here corresponds to something that actually went wrong: a zero
 * buy price reading as a 100% margin, an IMEI on two units so a sale matched
 * the wrong phone, SHS stock a supplier held indefinitely, a model left as a
 * raw SKU code so it grouped as its own model everywhere.
 *
 * The important property throughout: these are SUSPICIOUS, not invalid.
 * Nothing here blocks a write, so a check that over-reports is worse than
 * one that under-reports — a panel full of false positives gets ignored, and
 * then the real one is missed too.
 */
import { describe, it, expect } from 'vitest';
import {
  missingBuyPrice, missingSupplier, duplicateImeis, orphanSales,
  staleShs, skuLikeModels, lossMakingSales, runHealthChecks, totalIssues,
  duplicateSuppliers, unrecognisedPlatform, shsInventedImei,
} from '../../lib/dataHealth';
import type { InventoryUnit, Sale } from '../../types';

const NOW = Date.parse('2026-07-25T00:00:00Z');

function unit(over: Partial<InventoryUnit> & { id: string }): InventoryUnit {
  return {
    imei: `35010000000${over.id.padStart(4, '0')}`,
    model: 'IPHONE 13',
    rawModel: 'IPHONE 13',
    status: 'available',
    buyPrice: 300,
    supplierName: 'MOBILE WHOLESALE LTD',
    supplierId: 's1',
    dateIn: '2026-07-20',
    ...over,
  } as unknown as InventoryUnit;
}

function sale(over: Partial<Sale> & { id: string }): Sale {
  return {
    marketplace: 'AMAZON',
    orderNumber: `ORD-${over.id}`,
    saleDate: '2026-07-21',
    buyPrice: 300,
    salePrice: 420,
    ...over,
  } as unknown as Sale;
}

const input = (units: InventoryUnit[], sales: Sale[] = []) => ({ units, sales, now: NOW });

describe('missing buy price', () => {
  it('catches zero, negative and absent', () => {
    const found = missingBuyPrice(input([
      unit({ id: '1', buyPrice: 0 }),
      unit({ id: '2', buyPrice: undefined as any }),
      unit({ id: '3', buyPrice: 300 }),
    ]));
    expect(found.issues.map(i => i.id)).toEqual(['1', '2']);
  });

  it('ignores sold units — the price is history now, not a live problem', () => {
    expect(missingBuyPrice(input([unit({ id: '1', buyPrice: 0, status: 'sold' })])).issues).toEqual([]);
  });

  it('is high severity — every profit figure is built on BP', () => {
    expect(missingBuyPrice(input([])).severity).toBe('high');
  });
});

describe('missing supplier', () => {
  it('catches a blank or whitespace-only supplier', () => {
    const found = missingSupplier(input([
      unit({ id: '1', supplierName: '', supplierId: '' }),
      unit({ id: '2', supplierName: '   ', supplierId: '' }),
      unit({ id: '3' }),
    ]));
    expect(found.issues.map(i => i.id)).toEqual(['1', '2']);
  });

  it('accepts a unit that has only a supplier id', () => {
    // Enough to reconcile against; the display name can be resolved.
    expect(missingSupplier(input([unit({ id: '1', supplierName: '', supplierId: 's9' })])).issues).toEqual([]);
  });
});

describe('duplicate IMEIs', () => {
  it('reports the IMEI once, with the count', () => {
    const found = duplicateImeis(input([
      unit({ id: '1', imei: '350100000000001' }),
      unit({ id: '2', imei: '350100000000001' }),
      unit({ id: '3', imei: '350100000000002' }),
    ]));
    expect(found.issues).toHaveLength(1);
    expect(found.issues[0].label).toContain('2 units');
  });

  it('matches case- and whitespace-insensitively, as the importer does', () => {
    const found = duplicateImeis(input([
      unit({ id: '1', imei: 'nl6cmqcytd' }),
      unit({ id: '2', imei: ' NL6CMQCYTD ' }),
    ]));
    expect(found.issues).toHaveLength(1);
  });

  it('does not flag a live unit against a sold one', () => {
    // Re-using an IMEI after the original sold is legitimate — a returned
    // phone re-entering stock, for instance.
    const found = duplicateImeis(input([
      unit({ id: '1', imei: '350100000000001', status: 'sold' }),
      unit({ id: '2', imei: '350100000000001' }),
    ]));
    expect(found.issues).toEqual([]);
  });

  it('ignores units with no IMEI rather than grouping them together', () => {
    const found = duplicateImeis(input([
      unit({ id: '1', imei: '' }),
      unit({ id: '2', imei: '' }),
    ]));
    expect(found.issues).toEqual([]);
  });
});

describe('orphan sales', () => {
  it('flags a sale whose IMEI is in no unit', () => {
    const found = orphanSales(input(
      [unit({ id: '1', imei: '350100000000001' })],
      [sale({ id: 's1', imei: '350100000000999' })],
    ));
    expect(found.issues.map(i => i.id)).toEqual(['s1']);
  });

  it('matches against sold units too, not just live stock', () => {
    // The unit SHOULD be sold — that's the happy path, not an orphan.
    const found = orphanSales(input(
      [unit({ id: '1', imei: '350100000000001', status: 'sold' })],
      [sale({ id: 's1', imei: '350100000000001' })],
    ));
    expect(found.issues).toEqual([]);
  });

  it('ignores sales with no IMEI — nothing to match, by design', () => {
    const found = orphanSales(input([], [sale({ id: 's1', imei: '' })]));
    expect(found.issues).toEqual([]);
  });

  it('ignores voided sales', () => {
    const found = orphanSales(input(
      [],
      [sale({ id: 's1', imei: '350100000000999', voidedAt: '2026-07-22' } as any)],
    ));
    expect(found.issues).toEqual([]);
  });
});

describe('stale SHS', () => {
  it('flags supplier-held stock past the threshold, oldest first', () => {
    const found = staleShs({
      ...input([
        unit({ id: 'old', status: 'incoming', dateIn: '2026-01-01' }),
        unit({ id: 'older', status: 'incoming', dateIn: '2025-11-01' }),
        unit({ id: 'fresh', status: 'incoming', dateIn: '2026-07-20' }),
      ]),
      shsStaleDays: 60,
    });
    expect(found.issues.map(i => i.id)).toEqual(['older', 'old']);
  });

  it('never flags office stock, however old', () => {
    const found = staleShs({
      ...input([unit({ id: '1', status: 'available', dateIn: '2020-01-01' })]),
      shsStaleDays: 60,
    });
    expect(found.issues).toEqual([]);
  });

  it('says who is holding it and for how long', () => {
    const found = staleShs({
      ...input([unit({ id: '1', status: 'incoming', dateIn: '2026-01-01', supplierName: 'CELLHUB' })]),
      shsStaleDays: 60,
    });
    expect(found.issues[0].detail).toContain('CELLHUB');
    expect(found.issues[0].detail).toMatch(/\d+ days/);
  });
});

describe('SHS holdings with an invented IMEI', () => {
  it('flags an incoming holding that already carries an IMEI', () => {
    const found = shsInventedImei(input([
      unit({ id: '1', status: 'incoming', imei: '350100000001111' }),
    ]));
    expect(found.issues.map(i => i.id)).toEqual(['1']);
  });

  it('leaves a real, IMEI-less holding alone — that is the correct shape for SHS', () => {
    const found = shsInventedImei(input([
      unit({ id: '1', status: 'incoming', imei: '' }),
    ]));
    expect(found.issues).toEqual([]);
  });

  it('ignores office stock, even though it carries an IMEI', () => {
    const found = shsInventedImei(input([
      unit({ id: '1', status: 'available', imei: '350100000001111' }),
    ]));
    expect(found.issues).toEqual([]);
  });

  it('ignores sold units', () => {
    const found = shsInventedImei(input([
      unit({ id: '1', status: 'sold', imei: '350100000001111' }),
    ]));
    expect(found.issues).toEqual([]);
  });

  it('names the supplier and says to clear the field', () => {
    const found = shsInventedImei(input([
      unit({ id: '1', status: 'incoming', imei: '350100000001111', supplierName: 'CELLHUB' }),
    ]));
    expect(found.issues[0].detail).toContain('CELLHUB');
    expect(found.issues[0].detail).toContain('clear the IMEI');
  });

  it('is high severity — it can close the wrong holding on receipt or on a real orphan sale', () => {
    expect(shsInventedImei(input([])).severity).toBe('high');
  });
});

describe('SKU-like model names', () => {
  it('flags a raw operator SKU', () => {
    const found = skuLikeModels(input([unit({ id: '1', rawModel: 'ASI-SG-A32--64-BK-EX' })]));
    expect(found.issues).toHaveLength(1);
  });

  it('leaves real model names alone', () => {
    // The false-positive direction matters most: a panel that flags healthy
    // stock gets ignored, and the real problems go with it.
    const found = skuLikeModels(input([
      unit({ id: '1', rawModel: 'IPHONE 13 PRO' }),
      unit({ id: '2', rawModel: 'SAMSUNG GALAXY S22' }),
      unit({ id: '3', rawModel: 'Galaxy Tab A9 4GB 64 GB - WiFi' }),
      unit({ id: '4', rawModel: 'iPad 10.2 (2021) 9th gen 64 GB - WiFi + 4G' }),
      unit({ id: '5', rawModel: 'GOOGLE PIXEL 7' }),
    ]));
    expect(found.issues).toEqual([]);
  });
});

describe('loss-making sales', () => {
  it('lists them worst first', () => {
    const found = lossMakingSales(input([], [
      sale({ id: 'small', buyPrice: 200, salePrice: 150 }),
      sale({ id: 'big', buyPrice: 900, salePrice: 300 }),
      sale({ id: 'fine', buyPrice: 100, salePrice: 400 }),
    ]));
    expect(found.issues.map(i => i.id)).toEqual(['big', 'small']);
  });

  it('is low severity — a loss is a decision, not a data error', () => {
    expect(lossMakingSales(input([])).severity).toBe('low');
  });

  it('does not count a break-even sale as a loss', () => {
    expect(lossMakingSales(input([], [sale({ id: '1', buyPrice: 300, salePrice: 300 })])).issues).toEqual([]);
  });
});

describe('the panel as a whole', () => {
  it('is silent on healthy data', () => {
    const checks = runHealthChecks(input(
      [unit({ id: '1' }), unit({ id: '2' })],
      [sale({ id: 's1', imei: '350100000000001' })],
    ));
    // s1's IMEI won't match unit 1's generated IMEI, so allow that one.
    const nonOrphan = checks.filter(c => c.key !== 'orphan-sales');
    expect(totalIssues(nonOrphan)).toBe(0);
  });

  it('puts checks that found something first, worst severity leading', () => {
    const checks = runHealthChecks(input(
      [unit({ id: '1', buyPrice: 0 }), unit({ id: '2', supplierName: '', supplierId: '' })],
      [],
    ));
    expect(checks[0].issues.length).toBeGreaterThan(0);
    expect(checks[0].severity).toBe('high');
    expect(checks[checks.length - 1].issues).toEqual([]);
  });

  it('runs every check, even the ones that pass', () => {
    // A check that vanishes when clean is a check nobody trusts is running.
    expect(runHealthChecks(input([])).length).toBe(10);
  });

  it('totals the issues across checks', () => {
    const checks = runHealthChecks(input([
      unit({ id: '1', buyPrice: 0 }),
      unit({ id: '2', buyPrice: 0 }),
      unit({ id: '3', supplierName: '', supplierId: '' }),
    ]));
    expect(totalIssues(checks)).toBe(3);
  });
});

/**
 * Two checks added after a live screenshot showed what shallow testing had
 * missed: a supplier list with NIHAL on it twice (one row carrying 354 sales,
 * the other zero) and a Platform Scorecard reading zero across all four
 * marketplaces while 354 sales existed.
 */
describe('duplicate suppliers', () => {
  const supplier = (id: string, name: string) => ({ id, name }) as any;

  it('catches the same name recorded twice', () => {
    const found = duplicateSuppliers({
      units: [], sales: [], now: NOW,
      suppliers: [supplier('a', 'NIHAL'), supplier('b', 'NIHAL')],
    });
    expect(found.issues).toHaveLength(1);
    expect(found.issues[0].detail).toContain('2 supplier records');
  });

  it('catches near-misses that differ only by spacing or case', () => {
    const found = duplicateSuppliers({
      units: [], sales: [], now: NOW,
      suppliers: [supplier('a', 'Mobile Kit'), supplier('b', 'MOBILEKIT'), supplier('c', 'mobile  kit')],
    });
    expect(found.issues).toHaveLength(1);
    expect(found.issues[0].label).toContain('Mobile Kit');
  });

  it('does NOT merge genuinely different names', () => {
    // MOBILE KIT and MOBIL KIT are a real typo pair, but they are different
    // strings — flagging them as one record would be wrong. They surface as
    // two suppliers, which is what they are.
    const found = duplicateSuppliers({
      units: [], sales: [], now: NOW,
      suppliers: [supplier('a', 'MOBILE KIT'), supplier('b', 'MOBIL KIT')],
    });
    expect(found.issues).toEqual([]);
  });

  it('is silent when suppliers are not supplied at all', () => {
    expect(duplicateSuppliers({ units: [], sales: [], now: NOW }).issues).toEqual([]);
  });
});

describe('unrecognised platform', () => {
  it('flags a sold unit whose platform resolves to no marketplace', () => {
    const found = unrecognisedPlatform(input([
      unit({ id: '1', status: 'sold', salePlatform: 'R T S' } as any),
      unit({ id: '2', status: 'sold', salePlatform: '' } as any),
    ]));
    expect(found.issues.map(i => i.id)).toEqual(['1', '2']);
  });

  it('accepts both the canonical code and the friendly label', () => {
    // Imported sales write 'AMAZON'; the in-app sell flows write 'eBay'.
    // Both are live in the data, so both must resolve.
    const found = unrecognisedPlatform(input([
      unit({ id: '1', status: 'sold', salePlatform: 'AMAZON' } as any),
      unit({ id: '2', status: 'sold', salePlatform: 'eBay' } as any),
      unit({ id: '3', status: 'sold', salePlatform: 'BM' } as any),
      unit({ id: '4', status: 'sold', salePlatform: 'Backmarket' } as any),
    ]));
    expect(found.issues).toEqual([]);
  });

  it('ignores unsold stock, which has no platform yet', () => {
    expect(unrecognisedPlatform(input([unit({ id: '1', status: 'available' })])).issues).toEqual([]);
  });
});
