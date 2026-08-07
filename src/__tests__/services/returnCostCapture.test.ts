/**
 * The three costs the app used to record as zero.
 *
 * Every assertion here runs against the REAL patch builders imported from
 * returnsService, not a mirror of them — a copy would pass whether or not the
 * service actually snapshots anything, which is the trap the repair-cycle bug
 * fell through.
 *
 * The behaviours pinned:
 *   1. A replacement snapshots what the second handset cost, at the moment of
 *      the return, so later edits to that handset cannot restate a closed one.
 *   2. A new return cycle clears the previous cycle's repair invoice.
 *   3. Absent is written as absent, so "not invoiced yet" never becomes "free".
 */
import { describe, it, expect } from 'vitest';
import { buildReturningUnitPatch } from '../../services/returnsService';
import { returnCostFor } from '../../lib/returnLoss';
import type { InventoryUnit } from '../../types';

const u = (over: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'u1', model: 'iPhone 13', storage: '128GB', buyPrice: 300, status: 'sold', ...over,
} as InventoryUnit);

describe('a replacement snapshots the second handset', () => {
  it('records the replacement unit\'s buy price on the returning unit', () => {
    const patch = buildReturningUnitPatch(
      u(), 'returned_to_inventory', '2026-08-05', 'Faulty screen', 'replacement', 10,
      undefined, undefined, u({ id: 'u2', buyPrice: 285 }),
    );
    expect(patch.replacementUnitCost).toBe(285);
    expect(patch.replacedByUnitId).toBe('u2');
  });

  it('is audit data, not a loss — the cost stays carriage-only', () => {
    // The snapshot answers "which handset went out, and what had it cost us",
    // which is worth keeping. It is NOT added to the return's cost: the faulty
    // unit comes back as the replacement ships, so net stock is unchanged and
    // both handsets' prices are already inside the gross profit of the two
    // sales they belong to.
    const patch = buildReturningUnitPatch(
      u(), 'returned_to_inventory', '2026-08-05', 'Faulty screen', 'replacement', 10,
      undefined, undefined, u({ id: 'u2', buyPrice: 285 }),
    );
    const returned = { ...u(), ...patch } as InventoryUnit;
    expect(returned.replacementUnitCost).toBe(285);

    const cost = returnCostFor(returned, { voidedAt: '2026-08-05', voidOutcome: 'replacement' } as any);
    expect(cost.total).toBe(30);          // three carriage legs, nothing more
    expect(cost.gaps).toEqual([]);
  });

  it('writes null rather than NaN when the replacement has no price', () => {
    const patch = buildReturningUnitPatch(
      u(), 'returned_to_inventory', '2026-08-05', 'Faulty screen', 'replacement', 10,
      undefined, undefined, u({ id: 'u2', buyPrice: undefined as any }),
    );
    expect(patch.replacementUnitCost).toBeNull();
  });

  it('does not set a replacement cost on a plain refund', () => {
    const patch = buildReturningUnitPatch(
      u(), 'returned_to_inventory', '2026-08-05', 'Changed mind', 'refund', 10,
    );
    expect(patch.replacementUnitCost).toBeUndefined();
  });
});

describe('a new return cycle clears the previous repair invoice', () => {
  it('nulls repairCost so cycle two does not inherit cycle one\'s bill', () => {
    // Same shape of bug as the stale repairedAt marker: the field describes
    // the cycle that finished. Carried forward, the second repair looks
    // already invoiced and its real cost is never asked for.
    const afterFirstRepair = u({ repairCost: 65, repairedAt: '2026-07-02', status: 'sold' });
    const patch = buildReturningUnitPatch(
      afterFirstRepair, 'repair', '2026-08-05', 'Battery', null, 10,
    );
    expect(patch.repairCost).toBeNull();
    expect(patch.repairedAt).toBeNull();
  });

  it('leaves the second cycle reporting its invoice as outstanding', () => {
    const afterFirstRepair = u({ repairCost: 65, repairedAt: '2026-07-02' });
    const patch = buildReturningUnitPatch(afterFirstRepair, 'repair', '2026-08-05', 'Battery', null, 10);
    const cycleTwo = { ...afterFirstRepair, ...patch } as InventoryUnit;
    // repairCost is null, not 65 — so the loss reports a gap rather than
    // quietly re-charging the first repair's figure.
    const cost = returnCostFor(cycleTwo, { voidedAt: '2026-08-05', voidOutcome: 'repair' } as any);
    expect(cost.repair).toBe(0);
    expect(cost.gaps).toContain('repair_invoice');
  });
});

describe('clearing a cost is not the same as recording one', () => {
  it('a null repairCost reads as missing, a zero reads as free', () => {
    const missing = returnCostFor(
      u({ returnType: 'repair', repairCost: null as any }),
      { voidedAt: '2026-08-05', voidOutcome: 'repair' } as any,
    );
    const free = returnCostFor(
      u({ returnType: 'repair', repairCost: 0 }),
      { voidedAt: '2026-08-05', voidOutcome: 'repair' } as any,
    );
    expect(missing.gaps).toContain('repair_invoice');
    expect(free.gaps).toEqual([]);
    expect(missing.total).toBe(free.total);
  });
});
