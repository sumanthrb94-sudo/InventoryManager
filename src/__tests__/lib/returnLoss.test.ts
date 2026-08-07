/**
 * What a return costs — the four routes, and the gap between "£0" and
 * "nobody has told us yet".
 *
 * These numbers come from the operator's returns policy, not from reading the
 * old implementation back to itself. Before this module the only cost any
 * return recorded was carriage, so a replacement on a £300 handset booked ~£24
 * of loss against a real ~£324. Each test below pins one of the costs that was
 * missing, and the size of the miss is the point — assertions are written
 * against the policy figure, and would fail if someone reverted the module to
 * carriage-only.
 */
import { describe, it, expect } from 'vitest';
import { returnCostFor, returnRouteFor, totalReturnCost } from '../../lib/returnLoss';
import type { InventoryUnit, Sale } from '../../types';

/** A sold-then-returned unit. £10 leg cost keeps the carriage arithmetic
 *  readable: refund/repair = £20, replacement = £30. */
function unit(over: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'u1',
    model: 'iPhone 13',
    storage: '128GB',
    buyPrice: 300,
    status: 'returned',
    returnLegCost: 10,
    returnDate: '2026-08-05',
    ...over,
  } as InventoryUnit;
}

function sale(over: Partial<Sale> = {}): Sale {
  return {
    id: 's1',
    marketplace: 'AMAZON',
    salePrice: 400,
    postage: 8,
    postageVat: 1.6,
    voidedAt: '2026-08-05',
    ...over,
  } as Sale;
}

describe('a unit that was never returned', () => {
  it('costs nothing and reports no gaps', () => {
    const c = returnCostFor(unit({ status: 'available', returnType: undefined, returnDate: undefined }));
    expect(c.total).toBe(0);
    expect(c.gaps).toEqual([]);
  });
});

describe('refund', () => {
  it('costs two carriage legs and nothing else', () => {
    // The customer is refunded and the unit comes back saleable, so the
    // handset itself is not lost — it is still stock at its purchase price.
    const c = returnCostFor(
      unit({ returnType: 'returned_to_inventory', returnOutcome: 'refund' }),
      sale({ voidOutcome: 'refund' }),
    );
    expect(c.postage).toBe(20);
    expect(c.total).toBe(20);
    expect(c.gaps).toEqual([]);
  });
});

describe('repair', () => {
  it('charges the repair invoice on top of two legs', () => {
    const c = returnCostFor(
      unit({ returnType: 'repair', repairCost: 65 }),
      sale({ voidOutcome: 'repair' }),
    );
    expect(c.postage).toBe(20);
    expect(c.repair).toBe(65);
    expect(c.total).toBe(85);
    expect(c.gaps).toEqual([]);
  });

  it('reports a missing invoice instead of treating the repair as free', () => {
    // This is the distinction the whole module turns on. An un-invoiced repair
    // must not read as a £20 return; it is a £20 return with a bill still to
    // come, and the caller has to be able to say so.
    const c = returnCostFor(unit({ returnType: 'repair' }), sale({ voidOutcome: 'repair' }));
    expect(c.repair).toBe(0);
    expect(c.total).toBe(20);
    expect(c.gaps).toContain('repair_invoice');
  });

  it('treats a genuinely free repair as recorded, not missing', () => {
    const c = returnCostFor(unit({ returnType: 'repair', repairCost: 0 }), sale({ voidOutcome: 'repair' }));
    expect(c.total).toBe(20);
    expect(c.gaps).toEqual([]);
  });
});

describe('replacement', () => {
  it('costs three carriage legs and NOTHING else', () => {
    // The case that looks like it should cost a handset and does not. One
    // unit ships out, the faulty one comes back in, so net stock is unchanged
    // — the postage on three legs is the only thing consumed.
    const c = returnCostFor(
      unit({ returnType: 'returned_to_inventory', returnOutcome: 'replacement', replacementUnitCost: 300 }),
      sale({ voidOutcome: 'replacement' }),
    );
    expect(c.postage).toBe(30);
    expect(c.total).toBe(30);
  });

  it('does not charge the second handset even when its cost is recorded', () => {
    // replacementUnitCost is deliberately still snapshotted on the unit — it
    // records WHICH handset went out and what it had cost. It is audit data,
    // not a loss, and this pins the difference.
    //
    // Charging it double-counts. Both handsets' purchase prices already sit
    // inside the gross profit of the two sales they belong to: the original
    // sale (the customer keeps paying) and the later resale of the unit that
    // came back. Adding it here is a third charge for stock bought twice.
    const withCost = returnCostFor(
      unit({ returnOutcome: 'replacement', replacementUnitCost: 300 }),
      sale({ voidOutcome: 'replacement' }),
    );
    const withoutCost = returnCostFor(
      unit({ returnOutcome: 'replacement' }),
      sale({ voidOutcome: 'replacement' }),
    );
    expect(withCost.total).toBe(withoutCost.total);
    expect(withCost.total).toBe(30);
  });

  it('costs more than a refund only by the extra carriage leg', () => {
    // A replacement pays one more leg than a refund (the replacement going
    // out) and that is the entire difference between the two routes.
    const refund = returnCostFor(
      unit({ returnOutcome: 'refund' }), sale({ voidOutcome: 'refund' }),
    );
    const replacement = returnCostFor(
      unit({ returnOutcome: 'replacement' }), sale({ voidOutcome: 'replacement' }),
    );
    expect(replacement.total - refund.total).toBe(10);   // one leg
  });

  it('reports no outstanding cost — there is nothing left to enter', () => {
    const c = returnCostFor(unit({ returnOutcome: 'replacement' }), sale({ voidOutcome: 'replacement' }));
    expect(c.gaps).toEqual([]);
  });
});

describe('returned to supplier', () => {
  it('nets the credit off the carriage', () => {
    const c = returnCostFor(
      unit({ returnType: 'returned_to_supplier', returnOutcome: 'refund', supplierCreditAmount: 300 }),
      sale({ voidOutcome: 'refund' }),
    );
    expect(c.supplierCredit).toBe(300);
    expect(c.total).toBe(20 - 300);
  });

  it('counts a replacement handset from the supplier as value recovered', () => {
    const c = returnCostFor(
      unit({
        returnType: 'returned_to_supplier',
        returnOutcome: 'refund',
        supplierCreditAmount: 300,
        supplierCreditType: 'replacement_unit',
      }),
      sale({ voidOutcome: 'refund' }),
    );
    expect(c.supplierCredit).toBe(300);
  });

  it('flags a credit that has not landed', () => {
    const c = returnCostFor(
      unit({ returnType: 'returned_to_supplier', returnOutcome: 'refund' }),
      sale({ voidOutcome: 'refund' }),
    );
    expect(c.gaps).toContain('supplier_credit');
  });

  it('does not invent a supplier credit for a unit that never went back', () => {
    const c = returnCostFor(
      unit({ returnType: 'returned_to_inventory', returnOutcome: 'refund' }),
      sale({ voidOutcome: 'refund' }),
    );
    expect(c.gaps).not.toContain('supplier_credit');
  });
});

describe('which route a return took', () => {
  it('trusts the sale doc over the unit', () => {
    // A repaired unit's returnType is flipped to 'returned_to_inventory' when
    // it goes back on the shelf, which would re-classify a historical repair
    // as a refund. Sale.voidOutcome is snapshotted at void time and does not
    // move (BUG-RP-002).
    const route = returnRouteFor(
      { returnType: 'returned_to_inventory', returnOutcome: 'refund', repairedAt: undefined },
      { voidedAt: '2026-08-05', voidOutcome: 'repair' },
    );
    expect(route).toBe('repair');
  });

  it('falls back to the repair marker when no sale is available', () => {
    expect(returnRouteFor({ returnType: 'returned_to_inventory', repairedAt: '2026-08-06' }, null))
      .toBe('repair');
  });

  it('is null for a unit with no return at all', () => {
    expect(returnRouteFor({}, null)).toBeNull();
  });
});

describe('totalling a period', () => {
  it('sums the costs and carries the count of missing figures', () => {
    const t = totalReturnCost([
      { unit: unit({ returnOutcome: 'refund' }), sale: sale({ voidOutcome: 'refund' }) },
      { unit: unit({ returnType: 'repair', repairCost: 65 }), sale: sale({ voidOutcome: 'repair' }) },
      { unit: unit({ returnOutcome: 'replacement' }), sale: sale({ voidOutcome: 'replacement' }) },
      { unit: unit({ returnType: 'repair' }), sale: sale({ voidOutcome: 'repair' }) },
    ]);
    expect(t.postage).toBe(20 + 20 + 30 + 20);
    expect(t.repair).toBe(65);
    expect(t.total).toBe(155);
    // The fourth row is a repair with no invoice entered — the total is a floor.
    expect(t.gapCount).toBe(1);
  });
});
