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
  it('charges a whole second handset on top of three legs', () => {
    // The operator's words: "replacement costs a whole second handset".
    const c = returnCostFor(
      unit({ returnType: 'returned_to_inventory', returnOutcome: 'replacement', replacementUnitCost: 300 }),
      sale({ voidOutcome: 'replacement' }),
    );
    expect(c.postage).toBe(30);
    expect(c.replacementHandset).toBe(300);
    expect(c.total).toBe(330);
  });

  it('is more than ten times the carriage-only figure it used to report', () => {
    // Guards the magnitude, not just the arithmetic: a regression to
    // carriage-only would still pass a test that only checked postage.
    const c = returnCostFor(
      unit({ returnOutcome: 'replacement', replacementUnitCost: 300 }),
      sale({ voidOutcome: 'replacement' }),
    );
    expect(c.total).toBeGreaterThan(c.postage * 10);
  });

  it('does NOT discount the faulty unit that came back', () => {
    // The returning handset is repaired and resold, and that resale is counted
    // as its own sale elsewhere. Netting it here would count the recovery
    // twice and quietly shrink every replacement loss.
    const c = returnCostFor(
      unit({ buyPrice: 300, returnOutcome: 'replacement', replacementUnitCost: 300 }),
      sale({ voidOutcome: 'replacement' }),
    );
    expect(c.total).toBe(330);
  });

  it('reports a missing replacement cost rather than assuming zero', () => {
    const c = returnCostFor(unit({ returnOutcome: 'replacement' }), sale({ voidOutcome: 'replacement' }));
    expect(c.replacementHandset).toBe(0);
    expect(c.gaps).toContain('replacement_handset');
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
    ]);
    expect(t.postage).toBe(20 + 20 + 30);
    expect(t.repair).toBe(65);
    expect(t.total).toBe(135);
    // The replacement's handset cost was never entered — the total is a floor.
    expect(t.gapCount).toBe(1);
  });
});
