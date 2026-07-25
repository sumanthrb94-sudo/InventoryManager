import { describe, it, expect } from 'vitest';
import {
  reconcileReturns,
  buildVoidedSaleEvents,
  isOpenReturnUnit,
} from '../../lib/returnsReconciliation';
import type { InventoryUnit, Sale } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1',
  model: 'iPhone 12',
  status: 'available',
  flags: [],
  platformListed: false,
  ownerId: 'shared',
  createdAt: '2026-01-01',
  ...over,
} as InventoryUnit);

const sale = (over: Partial<Sale>): Sale => ({
  id: 's1',
  marketplace: 'eBay',
  orderNumber: '001',
  saleDate: '2026-07-01',
  ownerId: 'shared',
  ...over,
} as Sale);

describe('isOpenReturnUnit', () => {
  it('keeps a returned unit that has not been re-sold', () => {
    expect(isOpenReturnUnit(unit({ returnType: 'returned_to_inventory', returnDate: '2026-07-10' }))).toBe(true);
  });

  it('drops a unit re-sold after its return', () => {
    expect(isOpenReturnUnit(unit({
      status: 'sold', returnType: 'returned_to_inventory',
      returnDate: '2026-07-10', saleDate: '2026-07-20',
    }))).toBe(false);
  });

  it('ignores units that were never returned', () => {
    expect(isOpenReturnUnit(unit({ status: 'sold', saleDate: '2026-07-01' }))).toBe(false);
  });
});

describe('buildVoidedSaleEvents', () => {
  it('counts voided docs plus the legacy unit-linked fallback, without double counting', () => {
    const units = [unit({ id: 'u1', returnType: 'repair', returnDate: '2026-07-05' })];
    const sales = [
      sale({ id: 'voided', voidedAt: '2026-07-05', unitId: 'u1' }),
      sale({ id: 'legacy', unitId: 'u2' }),
    ];
    const events = buildVoidedSaleEvents(units, sales);
    expect(events.map(e => e.sale.id)).toEqual(['voided']);
  });
});

describe('reconcileReturns', () => {
  it('explains the 5-vs-4 gap when one return voided two sale docs', () => {
    // One IMEI with both an imported and an in-app sale doc: a single
    // return voids both (findLinkedSales matches unitId OR imei).
    const units = [
      unit({ id: 'a', imei: '111', returnType: 'returned_to_inventory', returnDate: '2026-07-10' }),
      unit({ id: 'b', imei: '222', returnType: 'returned_to_inventory', returnDate: '2026-07-11' }),
      unit({ id: 'c', imei: '333', returnType: 'returned_to_inventory', returnDate: '2026-07-12' }),
      unit({ id: 'd', imei: '444', returnType: 'returned_to_inventory', returnDate: '2026-07-13' }),
    ];
    const sales = [
      sale({ id: 's-a1', unitId: 'a', imei: '111', voidedAt: '2026-07-10' }),
      sale({ id: 's-a2', imei: '111', voidedAt: '2026-07-10' }),   // duplicate doc, same IMEI
      sale({ id: 's-b',  unitId: 'b', imei: '222', voidedAt: '2026-07-11' }),
      sale({ id: 's-c',  unitId: 'c', imei: '333', voidedAt: '2026-07-12' }),
      sale({ id: 's-d',  unitId: 'd', imei: '444', voidedAt: '2026-07-13' }),
    ];

    const rec = reconcileReturns(units, sales);
    expect(rec.voidedSaleCount).toBe(5);
    expect(rec.openReturnCount).toBe(4);
    expect(rec.gap).toBe(1);
    expect(rec.unexplained).toHaveLength(1);
    expect(rec.unexplained[0].reason).toBe('duplicate_sale');
    expect(rec.unexplained[0].saleId).toBe('s-a2');
  });

  it('explains the same gap when a returned unit was re-sold', () => {
    const units = [
      unit({ id: 'a', imei: '111', returnType: 'returned_to_inventory', returnDate: '2026-07-10' }),
      unit({
        id: 'e', imei: '555', status: 'sold',
        returnType: 'returned_to_inventory', returnDate: '2026-07-01', saleDate: '2026-07-20',
      }),
    ];
    const sales = [
      sale({ id: 's-a', unitId: 'a', imei: '111', voidedAt: '2026-07-10' }),
      sale({ id: 's-e', unitId: 'e', imei: '555', voidedAt: '2026-07-01' }),
    ];

    const rec = reconcileReturns(units, sales);
    expect(rec.voidedSaleCount).toBe(2);
    expect(rec.openReturnCount).toBe(1);
    expect(rec.unexplained.map(r => r.reason)).toEqual(['cycle_closed']);
  });

  it('flags a voided sale whose unit lost its return flags', () => {
    const units = [unit({ id: 'a', imei: '111', status: 'available' })];
    const sales = [sale({ id: 's-a', unitId: 'a', imei: '111', voidedAt: '2026-07-10' })];
    const rec = reconcileReturns(units, sales);
    expect(rec.unexplained.map(r => r.reason)).toEqual(['flags_cleared']);
  });

  it('flags a voided sale with no matching unit', () => {
    const sales = [sale({ id: 's-x', imei: '999', voidedAt: '2026-07-10' })];
    const rec = reconcileReturns([], sales);
    expect(rec.unexplained.map(r => r.reason)).toEqual(['orphan']);
  });

  it('reports open returns that never had a sale doc', () => {
    const units = [unit({ id: 'a', imei: '111', returnType: 'repair', returnDate: '2026-07-10' })];
    const rec = reconcileReturns(units, []);
    expect(rec.openReturnCount).toBe(1);
    expect(rec.voidedSaleCount).toBe(0);
    expect(rec.returnsWithoutVoidedSale.map(u => u.unitId)).toEqual(['a']);
  });

  it('reports no gap when both surfaces agree', () => {
    const units = [unit({ id: 'a', imei: '111', returnType: 'returned_to_inventory', returnDate: '2026-07-10' })];
    const sales = [sale({ id: 's-a', unitId: 'a', imei: '111', voidedAt: '2026-07-10' })];
    const rec = reconcileReturns(units, sales);
    expect(rec.gap).toBe(0);
    expect(rec.unexplained).toHaveLength(0);
    expect(rec.returnsWithoutVoidedSale).toHaveLength(0);
  });
});
