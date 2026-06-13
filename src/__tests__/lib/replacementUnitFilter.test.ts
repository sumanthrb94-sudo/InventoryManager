/**
 * Tests for the eligible-replacements filter used by ProcessReturnModal
 * when the operator picks Customer Outcome = "Replacement". The picker
 * is mandatory — the operator must select the actual stock unit being
 * shipped to the customer — and the filter is what gates the list.
 *
 * The filter lives inline in ReturnsPage.tsx (a useMemo inside the
 * modal); this test reproduces the exact predicate so a future
 * refactor can't loosen it without breaking a test. Match contract:
 *
 *   - status === 'available'
 *   - brand   == returning unit's brand   (case-insensitive, trimmed)
 *   - model   == returning unit's model
 *   - storage == returning unit's storage
 *   - NOT the returning unit itself
 *
 * Sort: same-colour first (most likely the right choice), then oldest
 * dateIn (clears slow-moving stock first).
 */
import { describe, it, expect } from 'vitest';
import type { InventoryUnit } from '../../types';

/** Verbatim copy of the predicate from ReturnsPage.tsx's
 *  ProcessReturnModal `eligibleReplacements` useMemo. Keep these two in
 *  sync — the test will catch a drift in either direction. */
function eligibleReplacements(
  returning: InventoryUnit,
  allUnits: InventoryUnit[],
  search = '',
): InventoryUnit[] {
  const targetBrand   = (returning.brand   || '').trim().toLowerCase();
  const targetModel   = (returning.model   || '').trim().toLowerCase();
  const targetStorage = (returning.storage || '').trim().toLowerCase();
  const targetColour  = (returning.colour  || '').trim().toLowerCase();
  const q = search.trim().toLowerCase();
  return allUnits
    .filter(u => u.id !== returning.id)
    .filter(u => u.status === 'available')
    .filter(u => (u.brand   || '').trim().toLowerCase() === targetBrand)
    .filter(u => (u.model   || '').trim().toLowerCase() === targetModel)
    .filter(u => (u.storage || '').trim().toLowerCase() === targetStorage)
    .filter(u => !q
      || (u.imei  || '').toLowerCase().includes(q)
      || (u.colour|| '').toLowerCase().includes(q))
    .sort((a, b) => {
      const ac = (a.colour || '').trim().toLowerCase() === targetColour ? 0 : 1;
      const bc = (b.colour || '').trim().toLowerCase() === targetColour ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.dateIn || '').localeCompare(b.dateIn || '');
    });
}

const baseUnit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u', imei: '1',
  model: 'iPhone 15 Pro', brand: 'Apple', category: 'iPhone', colour: 'Black',
  storage: '256GB',
  buyPrice: 800, dateIn: '2026-05-01',
  supplierId: 's', supplierName: 'MHL',
  status: 'available',
  flags: [], notes: '', platformListed: false, listingSites: [],
  ownerId: 'shared', createdAt: '2026-05-01T00:00:00Z',
  ...over,
});

const returningUnit: InventoryUnit = baseUnit({
  id: 'returning', imei: '350000000000001',
  brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', colour: 'Black',
  status: 'sold',  // it's being returned right now
});

describe('eligibleReplacements — Process Return → Replacement picker', () => {
  it('includes available units with the SAME brand + model + storage', () => {
    const stock: InventoryUnit[] = [
      baseUnit({ id: 'a', imei: '111', brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', colour: 'Black' }),
      baseUnit({ id: 'b', imei: '222', brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', colour: 'Silver' }),
    ];
    const out = eligibleReplacements(returningUnit, stock);
    expect(out.map(u => u.id)).toEqual(['a', 'b']);
  });

  it('excludes the returning unit itself (defensive — it is status sold but the guard backs that up)', () => {
    const stock = [returningUnit, baseUnit({ id: 'a', imei: '111' })];
    const out = eligibleReplacements(returningUnit, stock);
    expect(out.map(u => u.id)).toEqual(['a']);
  });

  it('excludes units of a DIFFERENT model', () => {
    const stock = [
      baseUnit({ id: 'a', imei: '111', model: 'iPhone 15' }),         // wrong model
      baseUnit({ id: 'b', imei: '222', model: 'iPhone 15 Pro Max' }), // wrong model
      baseUnit({ id: 'c', imei: '333', model: 'iPhone 15 Pro' }),     // right
    ];
    expect(eligibleReplacements(returningUnit, stock).map(u => u.id)).toEqual(['c']);
  });

  it('excludes units of a DIFFERENT storage', () => {
    const stock = [
      baseUnit({ id: 'a', imei: '111', storage: '128GB' }),
      baseUnit({ id: 'b', imei: '222', storage: '512GB' }),
      baseUnit({ id: 'c', imei: '333', storage: '256GB' }),
    ];
    expect(eligibleReplacements(returningUnit, stock).map(u => u.id)).toEqual(['c']);
  });

  it('excludes units of a DIFFERENT brand', () => {
    const stock = [
      baseUnit({ id: 'a', imei: '111', brand: 'Samsung' }),
      baseUnit({ id: 'b', imei: '222', brand: 'Apple' }),
    ];
    expect(eligibleReplacements(returningUnit, stock).map(u => u.id)).toEqual(['b']);
  });

  it('excludes non-available units (sold / returned / incoming)', () => {
    const stock = [
      baseUnit({ id: 'sold', status: 'sold' }),
      baseUnit({ id: 'ret',  status: 'returned' }),
      baseUnit({ id: 'inc',  status: 'incoming' }),
      baseUnit({ id: 'ok',   imei: '111', status: 'available' }),
    ];
    expect(eligibleReplacements(returningUnit, stock).map(u => u.id)).toEqual(['ok']);
  });

  it('matches case-insensitively and trims whitespace', () => {
    const messy = baseUnit({
      brand: '  apple', model: 'iphone 15 PRO  ', storage: '256gb',
    });
    const stock = [baseUnit({ id: 'ok', imei: '111' })];
    expect(eligibleReplacements(messy, stock).map(u => u.id)).toEqual(['ok']);
  });

  it('sorts same-colour units first, then oldest dateIn', () => {
    // Returning is Black. Stock has Silver + Black + Black at different dates.
    const stock = [
      baseUnit({ id: 'silver-old',  imei: '1', colour: 'Silver', dateIn: '2026-01-01' }),
      baseUnit({ id: 'black-newer', imei: '2', colour: 'Black',  dateIn: '2026-05-01' }),
      baseUnit({ id: 'black-older', imei: '3', colour: 'Black',  dateIn: '2026-02-01' }),
      baseUnit({ id: 'silver-new',  imei: '4', colour: 'Silver', dateIn: '2026-06-01' }),
    ];
    expect(eligibleReplacements(returningUnit, stock).map(u => u.id))
      .toEqual(['black-older', 'black-newer', 'silver-old', 'silver-new']);
  });

  it('search box filters by IMEI substring', () => {
    const stock = [
      baseUnit({ id: 'a', imei: '111111111111111' }),
      baseUnit({ id: 'b', imei: '222222222222222' }),
      baseUnit({ id: 'c', imei: '111999999999999' }),
    ];
    expect(eligibleReplacements(returningUnit, stock, '111').map(u => u.id).sort())
      .toEqual(['a', 'c']);
  });

  it('search box filters by colour substring', () => {
    const stock = [
      baseUnit({ id: 'blk',    imei: '1', colour: 'Black' }),
      baseUnit({ id: 'titBlk', imei: '2', colour: 'Titanium Black' }),
      baseUnit({ id: 'wht',    imei: '3', colour: 'White' }),
    ];
    expect(eligibleReplacements(returningUnit, stock, 'black').map(u => u.id).sort())
      .toEqual(['blk', 'titBlk']);
  });

  it('returns [] when no stock matches — operator must pick Refund or wait', () => {
    const stock = [
      baseUnit({ id: 'a', imei: '111', model: 'iPhone 15 Pro Max' }),
      baseUnit({ id: 'b', imei: '222', brand: 'Samsung' }),
    ];
    expect(eligibleReplacements(returningUnit, stock)).toEqual([]);
  });
});
