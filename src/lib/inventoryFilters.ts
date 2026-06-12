/**
 * Stock-on-hand predicate for the Inventory Report.
 *
 * Before this helper existed, BuySheet's report filter only excluded
 * `status === 'sold'`, which let soft-deleted (returned-to-supplier) units
 * through and overstated stock by +1 row / +BP per soft-delete (QA report
 * BUG-LR-002). The KPI tile's `officeUnits` filter is narrower (it counts
 * only `available` + `returned_to_inventory` — the units actually ready to
 * sell), so we don't share that. This predicate is the Inventory Report's
 * own rule: everything we own except sold-and-gone or soft-deleted.
 */
import type { InventoryUnit } from '../types';

/**
 * True when the unit counts as physically in stock for inventory totals
 * and the operator-facing Inventory Report.
 *
 * Excluded:
 *   - status === 'sold'              (left the building)
 *   - returnType === 'returned_to_supplier'  (soft-deleted; doc kept for
 *                                             audit only, NOT on-hand)
 *
 * Included:
 *   - status === 'available'   (regular stock)
 *   - status === 'incoming'    (SHS — awaiting receive but already ours)
 *   - returnType === 'returned_to_inventory'  (re-stocked after a refund)
 *   - returnType === 'repair'  (broken phone we still own and are fixing)
 */
export function isStockOnHand(u: InventoryUnit): boolean {
  if (u.status === 'sold') return false;
  if (u.returnType === 'returned_to_supplier') return false;
  return true;
}
