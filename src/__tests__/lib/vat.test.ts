/**
 * The VAT position — and specifically, the two readings of it.
 *
 * The app has always computed margin VAT as (SP − BP) × 16.67% with no floor,
 * so a phone sold at a loss produced negative VAT that cancelled real VAT
 * owed on profitable sales. Nothing aggregated those figures, so the effect
 * only appeared when a human summed the exported column.
 *
 * These tests pin both readings and, most importantly, that flooring can only
 * ever RAISE the total — a difference in the other direction would mean the
 * clamp is eating VAT rather than restoring it.
 */
import { describe, it, expect } from 'vitest';
import {
  vatPeriodOf, isVatable, vatLineOf, buildVatPeriods, lossMakingLines, buildStockBook,
} from '../../lib/vat';
import type { Sale } from '../../types';

/** A sale carrying only the fields the VAT lens reads. */
function sale(over: Partial<Sale> & { id: string; saleDate: string; buyPrice: number; salePrice: number }): Sale {
  const margin = over.salePrice - over.buyPrice;
  return {
    marketplace: 'AMAZON',
    orderNumber: `ORD-${over.id}`,
    imei: `35010000000000${over.id.slice(-1)}`,
    unitId: over.id,
    supplierId: 's1',
    supplierName: 'MOBILE WHOLESALE LTD',
    quantity: 1,
    marginalTax: Math.round(margin * 16.67) / 100,
    grossProfit: 0,
    spMinusBp: margin,
    ...over,
  } as unknown as Sale;
}

describe('vatPeriodOf — calendar quarters', () => {
  it.each([
    ['2026-01-15', '2026-Q1', 'Jan–Mar 2026', '2026-01-01', '2026-03-31'],
    ['2026-04-01', '2026-Q2', 'Apr–Jun 2026', '2026-04-01', '2026-06-30'],
    ['2026-07-25', '2026-Q3', 'Jul–Sep 2026', '2026-07-01', '2026-09-30'],
    ['2026-12-31', '2026-Q4', 'Oct–Dec 2026', '2026-10-01', '2026-12-31'],
  ])('%s → %s', (date, key, label, from, to) => {
    const p = vatPeriodOf(date)!;
    expect([p.key, p.label, p.from, p.to]).toEqual([key, label, from, to]);
  });

  it('handles February in a leap year', () => {
    expect(vatPeriodOf('2028-02-10')!.to).toBe('2028-03-31');
  });

  it('rejects an unparseable date rather than guessing a quarter', () => {
    for (const bad of ['', 'not-a-date', '2026-13-01']) {
      expect(vatPeriodOf(bad)).toBeNull();
    }
  });
});

describe('a loss-making sale', () => {
  const loss = sale({ id: 'L1', saleDate: '2026-07-10', buyPrice: 420, salePrice: 300 });

  it('produces negative VAT under the historical reading', () => {
    expect(vatLineOf(loss).vatAsComputed).toBeLessThan(0);
  });

  it('produces zero VAT under the margin scheme', () => {
    expect(vatLineOf(loss).vatMarginScheme).toBe(0);
  });

  it('is marked as differing, so it lands in the accountant list', () => {
    expect(vatLineOf(loss).differs).toBe(true);
  });
});

describe('a profitable sale reads identically either way', () => {
  const win = sale({ id: 'W1', saleDate: '2026-07-10', buyPrice: 300, salePrice: 420 });

  it('is untouched by the floor', () => {
    const line = vatLineOf(win);
    expect(line.vatMarginScheme).toBe(line.vatAsComputed);
    expect(line.differs).toBe(false);
    expect(line.vatAsComputed).toBeGreaterThan(0);
  });
});

describe('a break-even sale', () => {
  // Margin exactly zero: no profit, so no VAT — and no difference either.
  const flat = sale({ id: 'E1', saleDate: '2026-07-10', buyPrice: 300, salePrice: 300 });

  it('owes nothing under both readings', () => {
    const line = vatLineOf(flat);
    expect(line.vatAsComputed).toBe(0);
    expect(line.vatMarginScheme).toBe(0);
    expect(line.differs).toBe(false);
  });
});

describe('the period total — the number that was missing', () => {
  const sales = [
    sale({ id: 'W1', saleDate: '2026-07-10', buyPrice: 300, salePrice: 420 }),   // +120
    sale({ id: 'L1', saleDate: '2026-07-11', buyPrice: 420, salePrice: 300 }),   // −120
  ];

  it('the historical reading nets the loss against the profit', () => {
    const [q] = buildVatPeriods(sales);
    expect(q.marginVatAsComputed).toBe(0);
  });

  it('the margin-scheme reading keeps the VAT on the profitable sale', () => {
    const [q] = buildVatPeriods(sales);
    expect(q.marginVatMarginScheme).toBe(20);
  });

  it('reports the difference and the count behind it', () => {
    const [q] = buildVatPeriods(sales);
    expect(q.difference).toBe(20);
    expect(q.lossMakingCount).toBe(1);
    expect(q.saleCount).toBe(2);
  });

  it('flooring can only ever RAISE the total, never lower it', () => {
    // The property that matters: if this ever inverted, the clamp would be
    // eating VAT instead of restoring it.
    const mixed = [
      sale({ id: 'A', saleDate: '2026-01-05', buyPrice: 100, salePrice: 400 }),
      sale({ id: 'B', saleDate: '2026-02-05', buyPrice: 400, salePrice: 100 }),
      sale({ id: 'C', saleDate: '2026-03-05', buyPrice: 250, salePrice: 250 }),
      sale({ id: 'D', saleDate: '2026-05-05', buyPrice: 200, salePrice: 260 }),
      sale({ id: 'E', saleDate: '2026-08-05', buyPrice: 900, salePrice: 300 }),
    ];
    for (const q of buildVatPeriods(mixed)) {
      expect(q.marginVatMarginScheme).toBeGreaterThanOrEqual(q.marginVatAsComputed);
      expect(q.difference).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('voided sales', () => {
  const refunded = sale({
    id: 'V1', saleDate: '2026-07-12', buyPrice: 300, salePrice: 420,
    voidedAt: '2026-07-20', voidOutcome: 'refund',
  } as any);

  it('are not vatable — the money went back to the customer', () => {
    expect(isVatable(refunded)).toBe(false);
  });

  it('are excluded from the period, so a refund cannot inflate the liability', () => {
    const periods = buildVatPeriods([
      refunded,
      sale({ id: 'W9', saleDate: '2026-07-13', buyPrice: 300, salePrice: 420 }),
    ]);
    expect(periods[0].saleCount).toBe(1);
    expect(periods[0].marginVatMarginScheme).toBe(20);
  });
});

describe('periods', () => {
  const sales = [
    sale({ id: 'A', saleDate: '2026-02-05', buyPrice: 100, salePrice: 220 }),
    sale({ id: 'B', saleDate: '2026-07-05', buyPrice: 100, salePrice: 220 }),
    sale({ id: 'C', saleDate: '2026-08-05', buyPrice: 100, salePrice: 220 }),
  ];

  it('splits sales into the quarter they fall in', () => {
    const periods = buildVatPeriods(sales);
    expect(periods.map(p => p.period.key)).toEqual(['2026-Q3', '2026-Q1']);
    expect(periods[0].saleCount).toBe(2);
  });

  it('orders newest first — the open quarter is the one being asked about', () => {
    expect(buildVatPeriods(sales)[0].period.key).toBe('2026-Q3');
  });

  it('carries turnover alongside the tax, so the figure can be eyeballed', () => {
    const [q3] = buildVatPeriods(sales);
    expect(q3.totalSales).toBe(440);
    expect(q3.totalCost).toBe(200);
    expect(q3.totalMargin).toBe(240);
  });
});

describe('input VAT on marketplace fees', () => {
  it('is reclaimable regardless of which margin reading applies', () => {
    const withFees = sale({
      id: 'F1', saleDate: '2026-07-10', buyPrice: 300, salePrice: 420, totalVat: 6,
    } as any);
    const [q] = buildVatPeriods([withFees]);
    expect(q.inputVat).toBe(6);
    expect(q.netPayableMarginScheme).toBe(r2(q.marginVatMarginScheme - 6));
  });

  it('a loss-making sale still reclaims its fee VAT', () => {
    // No margin VAT is due, but the marketplace still charged fees with VAT
    // on them — that input tax does not disappear.
    const lossWithFees = sale({
      id: 'F2', saleDate: '2026-07-10', buyPrice: 420, salePrice: 300, totalVat: 6,
    } as any);
    const [q] = buildVatPeriods([lossWithFees]);
    expect(q.marginVatMarginScheme).toBe(0);
    expect(q.inputVat).toBe(6);
    expect(q.netPayableMarginScheme).toBe(-6);
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('the accountant list', () => {
  it('collects every differing sale, worst loss first', () => {
    const periods = buildVatPeriods([
      sale({ id: 'S', saleDate: '2026-07-01', buyPrice: 200, salePrice: 150 }),   // −50
      sale({ id: 'B', saleDate: '2026-07-02', buyPrice: 900, salePrice: 300 }),   // −600
      sale({ id: 'G', saleDate: '2026-07-03', buyPrice: 100, salePrice: 400 }),   // +300
    ]);
    const losses = lossMakingLines(periods);
    expect(losses.map(l => l.saleId)).toEqual(['B', 'S']);
    expect(losses[0].margin).toBe(-600);
  });
});

describe('the stock book', () => {
  it('is one row per item in date order, with the margin-scheme VAT', () => {
    const periods = buildVatPeriods([
      sale({ id: 'B', saleDate: '2026-07-11', buyPrice: 420, salePrice: 300 }),
      sale({ id: 'A', saleDate: '2026-07-10', buyPrice: 300, salePrice: 420 }),
    ]);
    const book = buildStockBook(periods);
    expect(book.map(r => r.saleDate)).toEqual(['2026-07-10', '2026-07-11']);
    expect(book[0].vatDue).toBe(20);
    expect(book[1].vatDue).toBe(0);      // sold at a loss — no VAT on this item
    expect(book[1].margin).toBe(-120);   // but the loss is still on the record
  });
});
