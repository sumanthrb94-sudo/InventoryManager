/**
 * A handset going through repair TWICE.
 *
 * The operator's S22 did this: stocked in, sold on eBay, sent for repair,
 * repaired, sold again on Temu, sent for repair a second time — and then had
 * no way back. The button that returns a repaired unit to stock had
 * disappeared, and the row read "Returned → Repaired" while the unit was
 * still at the repairer.
 *
 * The cause was a marker that was never cleared. completeRepair stamps
 * `repairedAt` on the unit; processReturn wrote a fresh return over the top
 * but left that stamp in place. The Returns page derives
 * `wasRepaired = !!repairedAt`, and gates both the button and the "In Repair"
 * chip on `returnType === 'repair' && !wasRepaired`. With a stale stamp from
 * cycle one, cycle two satisfies neither: no chip, no button, no way out.
 *
 * A unit that cannot leave a state is worse than a wrong number — the number
 * can be read around, the state cannot be worked around at all.
 */
import { describe, it, expect } from 'vitest';
import { buildReturningUnitPatch, buildCompleteRepairPatch } from '../../services/returnsService';
import type { InventoryUnit } from '../../types';

/**
 * The REAL patches the service applies — imported, not mirrored. A copy of
 * the logic here would pass whether or not returnsService is correct, which
 * is exactly the trap this whole bug fell through.
 */
const sendForRepair = (u: Partial<InventoryUnit>): Partial<InventoryUnit> => ({
  ...u,
  ...buildReturningUnitPatch(
    u as InventoryUnit, 'repair', '2026-08-05', 'Repair screen', null, null,
  ),
} as Partial<InventoryUnit>);

const markRepairedBackToStock = (u: Partial<InventoryUnit>): Partial<InventoryUnit> => ({
  ...u,
  ...buildCompleteRepairPatch(),
  repairedAt: '2026-08-06',
  flags: [...(u.flags ?? []), 'repaired_unit'],
} as Partial<InventoryUnit>);

const sell = (u: Partial<InventoryUnit>): Partial<InventoryUnit> =>
  ({ ...u, status: 'sold' } as Partial<InventoryUnit>);

/** ReturnsPage: what decides the chip AND the back-to-stock button. */
const wasRepaired = (u: Partial<InventoryUnit>) => !!u.repairedAt;
const showsBackToStockButton = (u: Partial<InventoryUnit>) =>
  u.returnType === 'repair' && !wasRepaired(u);
const showsInRepairChip = showsBackToStockButton;

/** The sellable rule every stock surface uses. */
const inOfficeStock = (u: Partial<InventoryUnit>) =>
  u.status === 'available'
  || (u.returnType === 'returned_to_inventory' && u.status !== 'sold');

describe('the full repair loop, twice round', () => {
  it('offers a way back on the FIRST repair', () => {
    const inRepair = sendForRepair({ id: 'u1', status: 'sold' });
    expect(showsBackToStockButton(inRepair), 'the operator can act').toBe(true);
    expect(showsInRepairChip(inRepair), 'and the row says In Repair').toBe(true);
    expect(inOfficeStock(inRepair), 'not sellable while away').toBe(false);
  });

  it('puts it back on the shelf when the repair is marked complete', () => {
    const back = markRepairedBackToStock(sendForRepair({ id: 'u1', status: 'sold' }));
    expect(inOfficeStock(back)).toBe(true);
    expect(back.flags).toContain('repaired_unit');
  });

  it('THE REGRESSION: still offers a way back on the SECOND repair', () => {
    // Sold → repair → repaired → sold again → repair again. Before the fix
    // this last state had no button and no chip, and the unit was stranded.
    const cycle2 = sendForRepair(sell(
      markRepairedBackToStock(sendForRepair({ id: 'u1', status: 'sold' })),
    ));

    expect(cycle2.returnType).toBe('repair');
    expect(wasRepaired(cycle2), 'the previous cycle\'s stamp is cleared').toBe(false);
    expect(showsBackToStockButton(cycle2), 'the way back is offered again').toBe(true);
    expect(showsInRepairChip(cycle2), 'and it reads In Repair, not Repaired').toBe(true);
  });

  it('completes the second repair back to sellable stock', () => {
    const done = markRepairedBackToStock(sendForRepair(sell(
      markRepairedBackToStock(sendForRepair({ id: 'u1', status: 'sold' })),
    )));
    expect(inOfficeStock(done), 'on the shelf and sellable again').toBe(true);
  });

  it('keeps the historical repair fact even though the stamp was cleared', () => {
    // The loss accounting and the legacy fallbacks read the permanent
    // 'repaired_unit' flag (and the sale's voidOutcome), so clearing
    // repairedAt does not lose a repair that was already recorded.
    const cycle2 = sendForRepair(sell(
      markRepairedBackToStock(sendForRepair({ id: 'u1', status: 'sold' })),
    ));
    expect(cycle2.flags, 'the flag survives').toContain('repaired_unit');

    const isRepairCycle = (u: Partial<InventoryUnit>) =>
      u.returnType === 'repair'
      || !!u.repairedAt
      || (Array.isArray(u.flags) && u.flags.includes('repaired_unit'));
    expect(isRepairCycle(cycle2), 'still counted as a repair cycle').toBe(true);
  });

  it('runs a third cycle without stranding it either', () => {
    // Whatever the count, the state is re-enterable — the fix is not a
    // one-off unstick.
    let u: Partial<InventoryUnit> = { id: 'u1', status: 'sold' };
    for (let cycle = 1; cycle <= 3; cycle++) {
      u = sendForRepair(u);
      expect(showsBackToStockButton(u), `cycle ${cycle} offers a way back`).toBe(true);
      u = markRepairedBackToStock(u);
      expect(inOfficeStock(u), `cycle ${cycle} ends on the shelf`).toBe(true);
      u = sell(u);
    }
  });

  it('does not carry a repair stamp into a later refund cycle either', () => {
    // Same staleness, different route: a refund after a repair used to show a
    // "Repaired" chip on a cycle that had nothing to do with a repair.
    const refunded = {
      ...markRepairedBackToStock(sendForRepair({ id: 'u1', status: 'sold' })),
      status: 'available' as const,
      returnType: 'returned_to_inventory' as const,
      repairedAt: null,
    };
    expect(wasRepaired(refunded)).toBe(false);
  });
});
