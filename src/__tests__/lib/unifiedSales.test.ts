/**
 * One sale, one row.
 *
 * Admin → Sales History merged Sale docs with sold InventoryUnits and deduped
 * by comparing the synthesised row's id against the set of Sale doc ids. But
 * a synthesised row's id is the UNIT id, and a Sale doc's id is
 * `marketplace__orderNumber__imei`. Those id spaces cannot collide, so the
 * guard never fired once: 101 imported sales plus 93 sold units rendered as
 * 194 rows, with revenue and gross profit inflated to match.
 *
 * SellSheet had always checked three keys. The bug was that the same merge
 * was written twice and only one copy was right — so the logic now lives in
 * one place, and these tests pin the key that was missing.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDedupeIndex, isDuplicateOfKnownSale, mergeSalesWithSoldUnits,
} from '../../lib/unifiedSales';
import type { InventoryUnit, Sale } from '../../types';

/** A Sale doc, as the importer writes it. */
function saleDoc(over: Partial<Sale> & { id: string }): Sale {
  return {
    marketplace: 'AMAZON',
    orderNumber: 'AMZ-1000',
    saleDate: '2026-07-20',
    buyPrice: 300,
    salePrice: 420,
    grossProfit: 100,
    ...over,
  } as unknown as Sale;
}

/** A sold unit. */
function soldUnit(over: Partial<InventoryUnit> & { id: string }): InventoryUnit {
  return {
    status: 'sold',
    imei: '350100000000001',
    model: 'IPHONE 13',
    buyPrice: 300,
    salePrice: 420,
    saleDate: '2026-07-20',
    salePlatform: 'AMAZON',
    saleOrderId: 'AMZ-1000',
    ...over,
  } as unknown as InventoryUnit;
}

/** Mirrors the components' converter: the synthesised row's id IS the unit id. */
const toSale = (u: InventoryUnit): Sale => ({
  id: u.id,
  marketplace: (u.salePlatform === 'AMAZON' ? 'AMAZON' : 'EBAY') as any,
  orderNumber: u.saleOrderId || '',
  imei: u.imei,
  unitId: u.id,
  saleDate: u.saleDate,
  buyPrice: u.buyPrice,
  salePrice: u.salePrice,
} as unknown as Sale);

describe('the id spaces that could never collide', () => {
  it('a Sale doc id and a unit id are different shapes', () => {
    const doc = saleDoc({ id: 'AMAZON__AMZ-1000__350100000000001', unitId: 'unit-1' });
    const unit = soldUnit({ id: 'unit-1' });
    expect(toSale(unit).id).toBe('unit-1');
    expect(doc.id).not.toBe(toSale(unit).id);
  });

  it('comparing them alone never detects the duplicate — the original bug', () => {
    const doc = saleDoc({ id: 'AMAZON__AMZ-1000__350100000000001', unitId: 'unit-1' });
    const row = toSale(soldUnit({ id: 'unit-1' }));
    const idsOnly = new Set([doc.id]);
    expect(idsOnly.has(row.id)).toBe(false);          // the guard that did nothing
    expect(isDuplicateOfKnownSale(row, buildDedupeIndex([doc]))).toBe(true);
  });
});

describe('the three dedupe keys', () => {
  const doc = saleDoc({ id: 'AMAZON__AMZ-1000__350100000000001', unitId: 'unit-1' });
  const index = buildDedupeIndex([doc]);

  it('catches a row sharing the sale doc id', () => {
    expect(isDuplicateOfKnownSale(saleDoc({ id: doc.id }), index)).toBe(true);
  });

  it('catches a row whose id is the unit the sale already claims', () => {
    expect(isDuplicateOfKnownSale(toSale(soldUnit({ id: 'unit-1' })), index)).toBe(true);
  });

  it('catches a row sharing marketplace + order number', () => {
    // Different unit, same order — one order line already recorded.
    const other = toSale(soldUnit({ id: 'unit-99', saleOrderId: 'AMZ-1000' }));
    expect(isDuplicateOfKnownSale(other, index)).toBe(true);
  });

  it('lets a genuinely different sale through', () => {
    const other = toSale(soldUnit({ id: 'unit-2', saleOrderId: 'AMZ-2000' }));
    expect(isDuplicateOfKnownSale(other, index)).toBe(false);
  });

  it('does not treat a blank order number as a match', () => {
    // Otherwise every legacy unit with no order id would collapse into one.
    const blank = buildDedupeIndex([saleDoc({ id: 's1', orderNumber: '' })]);
    const a = toSale(soldUnit({ id: 'u1', saleOrderId: '' }));
    const b = toSale(soldUnit({ id: 'u2', saleOrderId: '' }));
    expect(isDuplicateOfKnownSale(a, blank)).toBe(false);
    expect(isDuplicateOfKnownSale(b, blank)).toBe(false);
  });
});

describe('the merge', () => {
  it('does not list an imported sale twice', () => {
    const docs = [saleDoc({ id: 'AMAZON__AMZ-1000__350100000000001', unitId: 'unit-1' })];
    const units = [soldUnit({ id: 'unit-1' })];
    expect(mergeSalesWithSoldUnits(docs, units, toSale)).toHaveLength(1);
  });

  it('reproduces the live shape: 101 sales + 93 matched units = 101 rows', () => {
    // The exact ratio from the failing screen.
    const docs = Array.from({ length: 101 }, (_, i) =>
      saleDoc({
        id: `AMAZON__ORD-${i}__35010000000${String(i).padStart(4, '0')}`,
        orderNumber: `ORD-${i}`,
        unitId: i < 93 ? `unit-${i}` : undefined,
      }));
    const units = Array.from({ length: 93 }, (_, i) =>
      soldUnit({ id: `unit-${i}`, saleOrderId: `ORD-${i}` }));

    const merged = mergeSalesWithSoldUnits(docs, units, toSale);
    expect(merged).toHaveLength(101);      // was 194
  });

  it('still surfaces a legacy unit that no Sale doc covers', () => {
    // The reason the merge exists at all — pre-sales-collection history.
    const merged = mergeSalesWithSoldUnits([], [soldUnit({ id: 'legacy-1' })], toSale);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('legacy-1');
  });

  it('keeps every Sale doc, even one with no matching unit', () => {
    // An orphan sale is still revenue; dropping it would understate the books.
    const docs = [saleDoc({ id: 's-orphan', orderNumber: 'ORD-X' })];
    expect(mergeSalesWithSoldUnits(docs, [], toSale)).toHaveLength(1);
  });

  it('never lets two units synthesise the same order twice', () => {
    const units = [
      soldUnit({ id: 'u1', saleOrderId: 'ORD-DUP' }),
      soldUnit({ id: 'u2', saleOrderId: 'ORD-DUP' }),
    ];
    expect(mergeSalesWithSoldUnits([], units, toSale)).toHaveLength(1);
  });

  it('ignores units that are not sold', () => {
    const units = [
      soldUnit({ id: 'u1', status: 'available' } as any),
      soldUnit({ id: 'u2', status: 'incoming' } as any),
    ];
    expect(mergeSalesWithSoldUnits([], units, toSale)).toEqual([]);
  });

  it('ignores a returned unit — the money went back', () => {
    const units = [soldUnit({ id: 'u1', returnType: 'returned_to_inventory' } as any)];
    expect(mergeSalesWithSoldUnits([], units, toSale)).toEqual([]);
  });

  it('ignores a sold unit carrying neither price nor date', () => {
    const units = [soldUnit({ id: 'u1', salePrice: null, saleDate: '' } as any)];
    expect(mergeSalesWithSoldUnits([], units, toSale)).toEqual([]);
  });

  it('applies the transform to every surviving row', () => {
    const merged = mergeSalesWithSoldUnits(
      [saleDoc({ id: 's1' })],
      [soldUnit({ id: 'legacy-1', saleOrderId: 'ORD-Z' })],
      toSale,
      (s) => ({ ...s, salePrice: 999 }),
    );
    expect(merged.every(r => r.salePrice === 999)).toBe(true);
  });
});

describe('the totals that were inflated', () => {
  it('revenue is not double-counted once the merge dedupes', () => {
    const docs = [saleDoc({ id: 'AMAZON__AMZ-1__350100000000001', unitId: 'unit-1', salePrice: 420 })];
    const units = [soldUnit({ id: 'unit-1', salePrice: 420 })];
    const revenue = mergeSalesWithSoldUnits(docs, units, toSale)
      .reduce((a, s) => a + (s.salePrice ?? 0), 0);
    expect(revenue).toBe(420);   // not 840
  });
});
