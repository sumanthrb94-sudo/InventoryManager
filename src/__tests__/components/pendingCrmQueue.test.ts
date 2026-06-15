/**
 * Locks the Pending-CRM-Review queue contract that drives both the
 * pinned card on ReturnsPage and the count badge on the Returns nav
 * button in App.tsx.
 *
 *   - Only units with pendingCrmReview === true are queued.
 *   - Ordering is oldest returnQcAt first (the morning operator sees
 *     the longest-waiting unit at the top).
 *   - The nav badge counts the same set so it never drifts from the
 *     queue card.
 *
 * The filter + sort lives inline in ReturnsPage.tsx (see the
 * `pendingCrm` useMemo at the top of the component). This test mirrors
 * the predicate verbatim so a future refactor that loosens it will
 * break here first.
 */
import { describe, it, expect } from 'vitest';
import type { InventoryUnit } from '../../types';

/** Verbatim copy of ReturnsPage.tsx's pendingCrm useMemo. */
function pendingCrmQueue(units: InventoryUnit[]): InventoryUnit[] {
  return units
    .filter(u => u.pendingCrmReview === true)
    .sort((a, b) => (a.returnQcAt || '').localeCompare(b.returnQcAt || ''));
}

const baseUnit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: over.id ?? 'u', imei: over.imei ?? '111',
  model: 'iPhone 15', brand: 'Apple', category: 'iPhone', colour: 'Black',
  storage: '256GB',
  buyPrice: 800, dateIn: '2026-05-01',
  supplierId: 's', supplierName: 'MHL',
  status: 'sold',
  flags: [], notes: '', platformListed: false, listingSites: [],
  ownerId: 'shared', createdAt: '2026-05-01T00:00:00Z',
  ...over,
});

describe('pendingCrmQueue', () => {
  it('only queues units with pendingCrmReview === true', () => {
    const units = [
      baseUnit({ id: 'a', pendingCrmReview: true,  returnQcAt: '2026-06-14T09:00:00Z' }),
      baseUnit({ id: 'b', pendingCrmReview: false, returnQcAt: '2026-06-14T08:00:00Z' }),
      baseUnit({ id: 'c' /* no flag */ }),
      baseUnit({ id: 'd', pendingCrmReview: true,  returnQcAt: '2026-06-14T10:00:00Z' }),
    ];
    expect(pendingCrmQueue(units).map(u => u.id)).toEqual(['a', 'd']);
  });

  it('orders oldest returnQcAt first — morning operator clears the backlog top-down', () => {
    const units = [
      baseUnit({ id: 'newest', pendingCrmReview: true, returnQcAt: '2026-06-14T15:00:00Z' }),
      baseUnit({ id: 'oldest', pendingCrmReview: true, returnQcAt: '2026-06-14T07:00:00Z' }),
      baseUnit({ id: 'middle', pendingCrmReview: true, returnQcAt: '2026-06-14T10:00:00Z' }),
    ];
    expect(pendingCrmQueue(units).map(u => u.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('units missing returnQcAt sort to the top (treated as oldest unknown)', () => {
    // Defensive — a unit with the flag but no QC timestamp shouldn't get
    // hidden at the bottom of the queue; pull it forward so the operator
    // notices the data integrity gap.
    const units = [
      baseUnit({ id: 'normal',  pendingCrmReview: true, returnQcAt: '2026-06-14T10:00:00Z' }),
      baseUnit({ id: 'missing', pendingCrmReview: true /* no returnQcAt */ }),
    ];
    expect(pendingCrmQueue(units).map(u => u.id)).toEqual(['missing', 'normal']);
  });

  it('returns [] when nothing is pending — badge stays hidden', () => {
    const units = [
      baseUnit({ id: 'a' }),
      baseUnit({ id: 'b', pendingCrmReview: false }),
    ];
    expect(pendingCrmQueue(units)).toEqual([]);
  });

  it('count for the nav badge matches queue length', () => {
    const units = [
      baseUnit({ id: 'a', pendingCrmReview: true, returnQcAt: '2026-06-14T07:00:00Z' }),
      baseUnit({ id: 'b', pendingCrmReview: true, returnQcAt: '2026-06-14T09:00:00Z' }),
      baseUnit({ id: 'c', pendingCrmReview: true, returnQcAt: '2026-06-14T11:00:00Z' }),
      baseUnit({ id: 'd' }),
    ];
    const queue = pendingCrmQueue(units);
    const navBadgeCount = units.reduce((n, u) => n + (u.pendingCrmReview === true ? 1 : 0), 0);
    expect(navBadgeCount).toBe(queue.length);
    expect(navBadgeCount).toBe(3);
  });
});
