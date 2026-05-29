/**
 * saleFromUnit.test.ts — verifies the in-app sale-builder produces a `Sale`
 * doc whose computed fields match the SALES_REPORT_2026_*.xlsx formulas to
 * <= 1e-3, and that off-platform sales return null without throwing.
 */
import { describe, it, expect } from 'vitest';
import { buildSaleFromUnit } from '../../lib/saleFromUnit';
import type { InventoryUnit } from '../../types';

const mockUnit = (overrides: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'unit-1',
  imei: '358485150619154',
  model: 'Galaxy S20',
  buyPrice: 100,
  status: 'available',
  dateIn: '2026-03-01',
  flags: [],
  listingSites: [],
  ownerId: 'shared',
  updatedAt: '2026-04-01',
  createdAt: '2026-03-01',
  ...overrides,
} as any);

describe('buildSaleFromUnit', () => {
  it('returns null for an off-platform listing site (e.g. "Other")', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit(),
      listingSite: 'Other',
      salePrice: 200,
      saleDate: '2026-04-15',
    });
    expect(sale).toBeNull();
  });

  it('AMAZON sale matches client formulas (BP=100, SP=130.03, postage=6.30)', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit({ buyPrice: 100 }),
      listingSite: 'Amazon',
      salePrice: 130.03,
      saleDate: '2026-04-01',
      postage: 6.30,
    })!;
    expect(sale.marketplace).toBe('AMAZON');
    expect(sale.spMinusBp).toBeCloseTo(30.03, 3);
    expect(sale.marginalTax).toBeCloseTo(5.006001, 3);
    expect(sale.commission).toBeCloseTo(9.1021, 3);
    expect(sale.cVat).toBeCloseTo(1.82042, 3);
    expect(sale.dsf).toBeCloseTo(0.182042, 3);
    expect(sale.dsfVat).toBeCloseTo(0.0364084, 3);
    expect(sale.pVat).toBeCloseTo(1.26, 3);
    expect(sale.totalVat).toBeCloseTo(3.1168284, 3);
    expect(sale.grossProfit).toBeCloseTo(5.3230286, 3);
    expect(sale.gpPercent).toBeCloseTo(5.3230286, 3);
    expect(sale.totalVatNtp).toBeCloseTo(1.8891726, 3);
  });

  it('BM sale: paymentMode preserved; Customer Care Fees = 8.99', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit({ buyPrice: 85 }),
      listingSite: 'Back Market',
      salePrice: 134,
      saleDate: '2026-04-01',
      paymentMode: 'Google Pay',
    })!;
    expect(sale.marketplace).toBe('BM');
    expect(sale.paymentMode).toBe('Google Pay');
    expect(sale.customerCareFees).toBeCloseTo(8.99, 9);
    expect(sale.commission).toBeCloseTo(14.74, 3);
    expect(sale.grossProfit).toBeCloseTo(8.5417, 3);
  });

  it('EBAY sale: ROF / FVF / Marketing populated; GP% basis is SP', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit({ buyPrice: 130 }),
      listingSite: 'eBay',
      salePrice: 159.99,
      saleDate: '2026-04-02',
      postage: 6.30,
    })!;
    expect(sale.marketplace).toBe('EBAY');
    expect(sale.rof).toBeCloseTo(0.559965, 3);
    expect(sale.fvf).toBeCloseTo(0.4, 9);
    expect(sale.marketing).toBeCloseTo(7.9995, 3);
    expect(sale.mVat).toBeCloseTo(1.5999, 3);
    expect(sale.grossProfit).toBeCloseTo(-6.2431458, 3);
    // GP% divisor is SP for eBay
    expect(sale.gpPercent).toBeCloseTo((-6.2431458 / 159.99) * 100, 3);
  });

  it('ONBUY sale: no paymentMode, VAT 20% applied on Commission', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit({ buyPrice: 150 }),
      listingSite: 'OnBuy',
      salePrice: 189.99,
      saleDate: '2026-04-02',
      paymentMode: 'should-be-ignored',
    })!;
    expect(sale.marketplace).toBe('ONBUY');
    expect(sale.paymentMode).toBeUndefined();
    expect(sale.commission).toBeCloseTo(13.2993, 3);
    expect(sale.vat20).toBeCloseTo(2.65986, 3);
    expect(sale.grossProfit).toBeCloseTo(8.804507, 3);
  });

  it('order number defaults to INAPP-<unitId> when none provided', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit({ id: 'unit-XYZ' }),
      listingSite: 'Amazon',
      salePrice: 100,
      saleDate: '2026-04-01',
    })!;
    expect(sale.orderNumber).toBe('INAPP-unit-XYZ');
    expect(sale.id).toBe('AMAZON__INAPP-unit-XYZ');
  });

  it('legacy "Backmarket" listing site maps to BM marketplace', () => {
    const sale = buildSaleFromUnit({
      unit: mockUnit(),
      listingSite: 'Backmarket',
      salePrice: 134,
      saleDate: '2026-04-01',
    })!;
    expect(sale.marketplace).toBe('BM');
  });
});
