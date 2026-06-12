/**
 * Regression: the Inventory Report stock-on-hand predicate.
 *
 * QA caught the .xlsx Inventory Report showing 211 rows while the
 * "All Office Stock" KPI tile showed 210 — the missing exclusion was the
 * soft-deleted (returned_to_supplier) unit. Lock the predicate so a
 * future status enum change can't drift back to overstating stock.
 */
import { describe, it, expect } from 'vitest';
import { isStockOnHand } from '../../lib/inventoryFilters';
import type { InventoryUnit } from '../../types';

const baseUnit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: '1', imei: '1',
  model: 'iPhone SE 3 128GB', brand: 'Apple', category: 'iPhone', colour: 'Black',
  buyPrice: 100, dateIn: '2026-06-01',
  supplierId: 'sup', supplierName: 'IMAX',
  status: 'available',
  flags: [], notes: '', platformListed: false, listingSites: [],
  ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
  ...over,
});

describe('isStockOnHand — Inventory Report row inclusion', () => {
  it('includes regular available stock', () => {
    expect(isStockOnHand(baseUnit({ status: 'available' }))).toBe(true);
  });

  it('includes incoming SHS units (already ours, awaiting receive)', () => {
    expect(isStockOnHand(baseUnit({ status: 'incoming' }))).toBe(true);
  });

  it('includes units returned to inventory (re-stocked after a refund)', () => {
    expect(isStockOnHand(baseUnit({
      status: 'available', returnType: 'returned_to_inventory',
    }))).toBe(true);
  });

  it('includes units in repair (broken phones we still own)', () => {
    expect(isStockOnHand(baseUnit({
      status: 'returned', returnType: 'repair',
    }))).toBe(true);
  });

  it('excludes sold units (left the building)', () => {
    expect(isStockOnHand(baseUnit({ status: 'sold' }))).toBe(false);
  });

  it('excludes soft-deleted returned-to-supplier units — BUG-LR-002', () => {
    // The bug: the old filter only checked `status === 'sold'`, so a
    // unit with returnType='returned_to_supplier' AND status='returned'
    // slipped through and overstated stock by +1 row / +BP.
    expect(isStockOnHand(baseUnit({
      status: 'returned', returnType: 'returned_to_supplier',
    }))).toBe(false);
  });
});
