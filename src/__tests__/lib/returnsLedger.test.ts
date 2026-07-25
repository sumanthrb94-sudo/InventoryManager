import { describe, it, expect } from 'vitest';
import { isOpenReturnUnit, returnUnits, returnUnitsInPeriod, returnCounts } from '../../lib/returnsLedger';
import type { InventoryUnit } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1', model: 'IPHONE 12', status: 'available', flags: [],
  platformListed: false, ownerId: 'shared', createdAt: '2026-01-01',
  ...over,
} as InventoryUnit);

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

describe('returnUnits — one number for every surface', () => {
  it('counts the unit once however many sale docs the return voided', () => {
    // The 5-vs-4 shape: one phone, two voided sale docs. Counting units
    // means the Sell chip and the Returns page cannot disagree.
    const units = [
      unit({ id: 'a', imei: '111', returnType: 'returned_to_inventory', returnDate: '2026-07-21' }),
      unit({ id: 'b', imei: '222', returnType: 'repair', returnDate: '2026-07-22' }),
      unit({ id: 'c', imei: '333' }),
    ];
    expect(returnUnits(units).map(u => u.id)).toEqual(['a', 'b']);
  });
});

describe('returnUnitsInPeriod', () => {
  const units = [
    unit({ id: 'a', returnType: 'returned_to_inventory', returnDate: '2026-07-01' }),
    unit({ id: 'b', returnType: 'repair', returnDate: '2026-07-25' }),
    unit({ id: 'c', returnType: 'returned_to_supplier', returnDate: '2026-06-15' }),
    unit({ id: 'd', returnType: 'repair' }),   // no date — cannot be placed in a window
  ];

  it('filters inclusively on both bounds', () => {
    expect(returnUnitsInPeriod(units, '2026-07-01', '2026-07-25').map(u => u.id)).toEqual(['a', 'b']);
  });

  it('supports open-ended windows', () => {
    expect(returnUnitsInPeriod(units, '2026-07-01').map(u => u.id)).toEqual(['a', 'b']);
    expect(returnUnitsInPeriod(units, undefined, '2026-06-30').map(u => u.id)).toEqual(['c']);
  });

  it('excludes returns with no date from any window', () => {
    expect(returnUnitsInPeriod(units).map(u => u.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('returnCounts', () => {
  it('reports today / month / lifetime off one ledger', () => {
    const units = [
      unit({ id: 'a', returnType: 'returned_to_inventory', returnDate: '2026-07-25' }),
      unit({ id: 'b', returnType: 'repair', returnDate: '2026-07-02' }),
      unit({ id: 'c', returnType: 'repair', returnDate: '2026-05-02' }),
    ];
    expect(returnCounts(units, '2026-07-25', '2026-07-01')).toEqual({ today: 1, month: 2, all: 3 });
  });

  it('is all zeroes on a clean database', () => {
    expect(returnCounts([], '2026-07-25', '2026-07-01')).toEqual({ today: 0, month: 0, all: 0 });
  });
});
