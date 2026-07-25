/**
 * Capital and profitability — the same questions the analytics already
 * answered, but in pounds, and with returns taken back out.
 *
 * Two behaviours matter more than the arithmetic:
 *
 *   Aged stock is measured in CAPITAL, not units. Twelve £600 phones and
 *   twelve £90 phones read identically on a unit count and are a completely
 *   different problem.
 *
 *   A returned sale is not profit. The existing supplier tile sums gross
 *   profit across all sales, so a supplier whose stock keeps coming back
 *   still looks good. Here a void removes the profit and raises the return
 *   rate — the number that should change what you buy.
 */
import { describe, it, expect } from 'vitest';
import { capitalPosition, supplierPerformance, modelProfitability } from '../../lib/capital';
import type { InventoryUnit, Sale } from '../../types';

const NOW = Date.parse('2026-07-25T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

function unit(over: Partial<InventoryUnit> & { id: string }): InventoryUnit {
  return {
    imei: `35010000000${over.id.padStart(4, '0')}`,
    model: 'IPHONE 13',
    rawModel: 'IPHONE 13',
    status: 'available',
    buyPrice: 300,
    supplierName: 'ALPHA',
    dateIn: daysAgo(10),
    ...over,
  } as unknown as InventoryUnit;
}

function sale(over: Partial<Sale> & { id: string }): Sale {
  return {
    marketplace: 'AMAZON',
    orderNumber: `ORD-${over.id}`,
    saleDate: daysAgo(5),
    buyPrice: 300,
    salePrice: 420,
    grossProfit: 100,
    supplierName: 'ALPHA',
    ...over,
  } as unknown as Sale;
}

describe('capital position', () => {
  it('reports capital, not unit counts, per age bucket', () => {
    const pos = capitalPosition([
      unit({ id: '1', buyPrice: 600, dateIn: daysAgo(120) }),
      unit({ id: '2', buyPrice: 90, dateIn: daysAgo(120) }),
      unit({ id: '3', buyPrice: 300, dateIn: daysAgo(5) }),
    ], NOW);

    const aged = pos.buckets.find(b => b.label === '90+ days')!;
    expect(aged.units).toBe(2);
    expect(aged.value).toBe(690);       // the number that actually matters
    expect(pos.totalValue).toBe(990);
  });

  it('splits office from supplier-held capital', () => {
    const pos = capitalPosition([
      unit({ id: '1', buyPrice: 300, status: 'available' }),
      unit({ id: '2', buyPrice: 500, status: 'incoming' }),
    ], NOW);
    expect(pos.officeValue).toBe(300);
    expect(pos.shsValue).toBe(500);
    expect(pos.totalValue).toBe(800);
  });

  it('excludes sold stock — that capital came back', () => {
    const pos = capitalPosition([
      unit({ id: '1', buyPrice: 300 }),
      unit({ id: '2', buyPrice: 999, status: 'sold' }),
    ], NOW);
    expect(pos.totalValue).toBe(300);
    expect(pos.totalUnits).toBe(1);
  });

  it('puts undated stock in the OLDEST bucket rather than dropping it', () => {
    // Silently excluding undated units would understate exactly the figure
    // this exists to surface — forgotten stock is the likeliest to be undated.
    const pos = capitalPosition([unit({ id: '1', buyPrice: 400, dateIn: '' })], NOW);
    expect(pos.buckets.find(b => b.label === '90+ days')!.value).toBe(400);
    expect(pos.agedValue).toBe(400);
  });

  it('reports the aged share as a percentage of held capital', () => {
    const pos = capitalPosition([
      unit({ id: '1', buyPrice: 250, dateIn: daysAgo(200) }),
      unit({ id: '2', buyPrice: 750, dateIn: daysAgo(2) }),
    ], NOW);
    expect(pos.agedValue).toBe(250);
    expect(pos.agedShare).toBe(25);
  });

  it('does not divide by zero on an empty shelf', () => {
    const pos = capitalPosition([], NOW);
    expect(pos.totalValue).toBe(0);
    expect(pos.agedShare).toBe(0);
    expect(pos.buckets.every(b => b.share === 0)).toBe(true);
  });
});

describe('supplier performance', () => {
  it('does not credit a supplier for a sale that came back', () => {
    const rows = supplierPerformance([], [
      sale({ id: '1', supplierName: 'ALPHA', grossProfit: 100 }),
      sale({ id: '2', supplierName: 'ALPHA', grossProfit: 100, voidedAt: daysAgo(1) } as any),
    ], NOW);
    const alpha = rows.find(r => r.supplier === 'ALPHA')!;
    expect(alpha.unitsSold).toBe(1);
    expect(alpha.grossProfit).toBe(100);   // not 200
    expect(alpha.returned).toBe(1);
  });

  it('computes return rate over everything attempted, not just what stuck', () => {
    const rows = supplierPerformance([], [
      sale({ id: '1', supplierName: 'BETA' }),
      sale({ id: '2', supplierName: 'BETA' }),
      sale({ id: '3', supplierName: 'BETA', voidedAt: daysAgo(1) } as any),
      sale({ id: '4', supplierName: 'BETA', voidedAt: daysAgo(1) } as any),
    ], NOW);
    expect(rows.find(r => r.supplier === 'BETA')!.returnRate).toBe(50);
  });

  it('surfaces the supplier who looks profitable but keeps sending returns', () => {
    // The point of the whole module: same GP, very different suppliers.
    const rows = supplierPerformance([], [
      sale({ id: 'g1', supplierName: 'GOOD', grossProfit: 100 }),
      sale({ id: 'g2', supplierName: 'GOOD', grossProfit: 100 }),
      sale({ id: 'b1', supplierName: 'BAD', grossProfit: 100 }),
      sale({ id: 'b2', supplierName: 'BAD', grossProfit: 100 }),
      sale({ id: 'b3', supplierName: 'BAD', voidedAt: daysAgo(1) } as any),
      sale({ id: 'b4', supplierName: 'BAD', voidedAt: daysAgo(1) } as any),
    ], NOW);
    const good = rows.find(r => r.supplier === 'GOOD')!;
    const bad = rows.find(r => r.supplier === 'BAD')!;
    expect(good.netProfit).toBe(bad.netProfit);        // identical on GP alone
    expect(bad.returnRate).toBeGreaterThan(good.returnRate);   // the tiebreak
  });

  it('counts capital still held with each supplier', () => {
    const rows = supplierPerformance(
      [unit({ id: '1', supplierName: 'ALPHA', buyPrice: 450 })],
      [sale({ id: '1', supplierName: 'ALPHA' })],
      NOW,
    );
    expect(rows.find(r => r.supplier === 'ALPHA')!.heldValue).toBe(450);
  });

  it('buckets nameless suppliers rather than dropping their sales', () => {
    const rows = supplierPerformance([], [sale({ id: '1', supplierName: '' })], NOW);
    expect(rows.find(r => r.supplier === 'Unattributed')!.unitsSold).toBe(1);
  });

  it('ranks by net profit', () => {
    const rows = supplierPerformance([], [
      sale({ id: '1', supplierName: 'SMALL', grossProfit: 10 }),
      sale({ id: '2', supplierName: 'BIG', grossProfit: 900 }),
    ], NOW);
    expect(rows[0].supplier).toBe('BIG');
  });
});

describe('model profitability', () => {
  const units = [
    unit({ id: '1', imei: '350100000000001', rawModel: 'IPHONE 13', dateIn: daysAgo(40) }),
    unit({ id: '2', imei: '350100000000002', rawModel: 'IPHONE 13', dateIn: daysAgo(20) }),
    unit({ id: '3', imei: '350100000000003', rawModel: 'PIXEL 7', dateIn: daysAgo(10) }),
  ];

  it('joins GP to how long the money was tied up', () => {
    const rows = modelProfitability(units, [
      sale({ id: 's1', imei: '350100000000001', saleDate: daysAgo(10), grossProfit: 100 }),
      sale({ id: 's2', imei: '350100000000002', saleDate: daysAgo(10), grossProfit: 100 }),
    ], NOW);
    const iphone = rows.find(r => r.model === 'IPHONE 13')!;
    expect(iphone.unitsSold).toBe(2);
    expect(iphone.grossProfit).toBe(200);
    expect(iphone.gpPerUnit).toBe(100);
    // 30 days and 10 days held → median 20.
    expect(iphone.medianDaysToSell).toBe(20);
  });

  it('reports held capital per model alongside what it earned', () => {
    const rows = modelProfitability(units, [], NOW);
    expect(rows.find(r => r.model === 'PIXEL 7')!.heldValue).toBe(300);
  });

  it('takes the model from the UNIT, not the sale row', () => {
    // Sale rows carry an operator-typed model that may be a SKU fragment;
    // the unit's name is the one every other screen groups by.
    const rows = modelProfitability(
      [unit({ id: '1', imei: '350100000000001', rawModel: 'IPHONE 13 PRO' })],
      [sale({ id: 's1', imei: '350100000000001', model: 'IP13P-256' } as any)],
      NOW,
    );
    expect(rows.map(r => r.model)).toContain('IPHONE 13 PRO');
  });

  it('does not count a returned sale as sold', () => {
    const rows = modelProfitability(units, [
      sale({ id: 's1', imei: '350100000000001', voidedAt: daysAgo(1) } as any),
    ], NOW);
    const iphone = rows.find(r => r.model === 'IPHONE 13')!;
    expect(iphone.unitsSold).toBe(0);
    expect(iphone.returned).toBe(1);
    expect(iphone.returnRate).toBe(100);
  });

  it('leaves days-to-sell null when nothing has sold', () => {
    expect(modelProfitability(units, [], NOW).every(r => r.medianDaysToSell === null)).toBe(true);
  });
});
