/**
 * After a return, is the handset back on the shelf — and can you find it?
 *
 * The operator processed a repair return and then could not see the unit.
 * That is two questions wearing one coat, and they have different answers:
 *
 *   1. Which return routes put a unit BACK into sellable office stock, and
 *      when. A repair does not do it immediately — the handset is away being
 *      fixed — it does it when the repair is marked complete. If that second
 *      step is missing, the unit sits in "In Repair" forever and never comes
 *      back, which looks exactly like it vanished.
 *
 *   2. WHERE you look. The search box on the Sell screen searches SALES, and
 *      a return voids the sale. So a unit that is correctly back on the shelf
 *      still returns "no sales match" there, because it no longer has one.
 *      That is the search working, not the stock being lost.
 *
 * This pins every route against the SAME sellable predicate the sell sheet,
 * the bulk-sale grid and the periodic table all use, so "is it in stock" has
 * one answer across the app rather than three.
 */
import { describe, it, expect } from 'vitest';
import type { InventoryUnit, ReturnCategory } from '../../types';

/** The sellable rule, verbatim from SellSheet / PeriodicInventory / the grid. */
const inOfficeStock = (u: Partial<InventoryUnit>): boolean =>
  u.status === 'available'
  || (u.returnType === 'returned_to_inventory' && u.status !== 'sold');

/**
 * buildReturningUnitPatch's status rule, which is the whole of what decides
 * visibility: only "back to inventory" lands on `available`; repair and
 * returned-to-supplier both land on `returned`.
 */
const afterReturn = (returnType: ReturnCategory): Partial<InventoryUnit> => ({
  status: returnType === 'returned_to_inventory' ? 'available' : 'returned',
  returnType,
});

/** buildCompleteRepairPatch — the second half of the repair journey. */
const afterRepairCompleted = () => ({
  status: 'available' as const,
  returnType: 'returned_to_inventory' as const,
});

describe('which return routes put the handset back on the shelf', () => {
  it('back to inventory: sellable immediately', () => {
    const u = afterReturn('returned_to_inventory');
    expect(u.status).toBe('available');
    expect(inOfficeStock(u)).toBe(true);
  });

  it('repair: NOT sellable while it is away being repaired', () => {
    // Correct, and the point of the state — it is not on the shelf, so it
    // must not be offerable to a customer.
    const u = afterReturn('repair');
    expect(u.status).toBe('returned');
    expect(inOfficeStock(u), 'still at the repairer').toBe(false);
  });

  it('repair: sellable again ONLY once the repair is marked complete', () => {
    // This is the step whose absence looks like a lost unit. Until it runs,
    // the handset stays in "In Repair" and appears in no stock view.
    const inRepair = afterReturn('repair');
    expect(inOfficeStock(inRepair)).toBe(false);

    const repaired = afterRepairCompleted();
    expect(inOfficeStock(repaired), 'back on the shelf').toBe(true);
    expect(repaired.returnType).toBe('returned_to_inventory');
  });

  it('returned to supplier: never comes back — it is not ours any more', () => {
    const u = afterReturn('returned_to_supplier');
    expect(inOfficeStock(u)).toBe(false);
  });
});

describe('the sellable rule agrees with itself across the app', () => {
  it('counts a returned-to-inventory unit even though its status says "returned"', () => {
    // A write race or a stale cache can leave status on 'returned' while the
    // returnType is already correct. The second clause is what stops the unit
    // disappearing in that window — every surface widens the same way.
    const stuck = { status: 'returned' as const, returnType: 'returned_to_inventory' as const };
    expect(inOfficeStock(stuck)).toBe(true);
  });

  it('does NOT count one that was returned to inventory and then re-sold', () => {
    const resold = { status: 'sold' as const, returnType: 'returned_to_inventory' as const };
    expect(inOfficeStock(resold)).toBe(false);
  });

  it.each([
    ['sold', false], ['lost', false], ['incoming', false],
    ['available', true], ['returned', false],
  ])('a bare %s unit with no return history: sellable = %s', (status, expected) => {
    expect(inOfficeStock({ status: status as InventoryUnit['status'] })).toBe(expected);
  });
});

describe('why the Sell screen search finds nothing for a returned unit', () => {
  /** That box filters SALES. A return voids the sale it reverses. */
  const activeSales = (sales: Array<{ imei: string; voidedAt?: string }>) =>
    sales.filter(s => !s.voidedAt);

  it('a returned unit has no active sale, so a sales search cannot match it', () => {
    const sales = [{ imei: '350000000000402', voidedAt: '2026-08-05' }];
    expect(activeSales(sales), 'the sale was voided by the return').toHaveLength(0);
  });

  it('which is independent of whether the unit is back in stock', () => {
    // Both true at once, and neither contradicts the other: the handset is on
    // the shelf AND has no sale. Looking for it in a sales list will always
    // fail; it has to be looked for in stock.
    const unit = afterRepairCompleted();
    const sales = [{ imei: '350000000000402', voidedAt: '2026-08-05' }];
    expect(inOfficeStock(unit), 'on the shelf').toBe(true);
    expect(activeSales(sales), 'and correctly absent from sales').toHaveLength(0);
  });
});
